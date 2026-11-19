"""Lưu trữ hai tầng: RAW append-only trong lúc capture + CURATED (Parquet).

- RAW là nguồn sự thật: mọi thông điệp gốc kèm seq + arrival_ts, không sửa.
  Người chấm có thể replay toàn bộ pipeline từ RAW (tính tái lập).
- CURATED là dữ liệu đã chuẩn hóa, mang cờ chất lượng, sẵn sàng cho tài chính.
- Manifest ghi sha256 từng tệp RAW + config_hash để truy vết.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import tempfile
import zlib
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator
from uuid import uuid4

import numpy as np
import pandas as pd

from ..constants import VN_TZ


def now_vn() -> datetime:
    return datetime.now(VN_TZ)


def _sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    """Hash captures with bounded memory, including long high-volume sessions."""
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


def search_ts(series: pd.Series, ts: pd.Timestamp, side: str = "right") -> int:
    """searchsorted BỀN VỮNG với khác biệt đơn vị datetime (us ↔ ns) và múi giờ.

    Parquet (pyarrow) trả datetime64[us] trong khi Timestamp tính từ giây thực
    mang độ phân giải ns → Series.searchsorted của pandas 2.x ném
    'Cannot losslessly convert units'. So sánh bằng int64 epoch UTC (asi8 ×
    hệ số quy đổi về ns) — không nhập nhằng múi giờ, không cảnh báo, O(log n).
    """
    arr = series.array
    scale = {"s": 1_000_000_000, "ms": 1_000_000, "us": 1_000, "ns": 1}[arr.unit]
    vals_ns = arr.asi8 * scale
    needle_ns = pd.Timestamp(ts).value  # ns kể từ epoch UTC
    return int(np.searchsorted(vals_ns, needle_ns, side=side))


def mode_prefix(mode: str) -> str:
    """Session namespace; keep each live provider in a separate series."""
    m = mode.upper()
    if m == "SYNTHETIC":
        return "SYNTH"
    if m in {"LIVE_NEO", "LIVE_SSI"}:
        return m
    return m


def session_dir_name(mode: str, date_str: str) -> str:
    return f"{mode_prefix(mode)}_{date_str}"


class RawWriter:
    """Ghi thông điệp thô theo channel vào JSONL.gz, đánh số sequence."""

    def __init__(self, session_dir: Path, mode: str, meta: dict[str, Any] | None = None):
        self.session_dir = Path(session_dir)
        self.session_dir.mkdir(parents=True, exist_ok=True)
        self.mode = mode.upper()
        self._files: dict[str, Any] = {}
        self._seq = 0
        self._counts: dict[str, int] = {}
        self._meta = meta or {}
        self._closed = False

    def _open(self, channel: str):
        if channel not in self._files:
            path = self.session_dir / f"{channel}.jsonl.gz"
            is_new = not path.exists()
            f = gzip.open(path, "at", encoding="utf-8")
            if is_new:
                header = {
                    "_meta": True,
                    "mode": self.mode,
                    "synthetic": self.mode == "SYNTHETIC",
                    "created_at": now_vn().isoformat(),
                    **self._meta,
                }
                f.write(json.dumps(header, ensure_ascii=False) + "\n")
            self._files[channel] = f
            self._counts.setdefault(channel, 0)
        return self._files[channel]

    def write(self, channel: str, payload: dict[str, Any], arrival_ts: datetime | None = None) -> int:
        self._seq += 1
        rec = {
            "seq": self._seq,
            "arrival_ts": (arrival_ts or now_vn()).isoformat(),
            "channel": channel,
            "data": payload,
        }
        f = self._open(channel)
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        self._counts[channel] += 1
        return self._seq

    def close(self) -> Path:
        if self._closed:
            return self.session_dir / "manifest.json"
        for f in self._files.values():
            f.close()
        self._closed = True
        manifest = {
            "mode": self.mode,
            "synthetic": self.mode == "SYNTHETIC",
            "counts": self._counts,
            "total_messages": self._seq,
            "closed_at": now_vn().isoformat(),
            "sha256": {
                p.name: _sha256_file(p)
                for p in sorted(self.session_dir.glob("*.jsonl.gz"))
            },
            **self._meta,
        }
        mp = self.session_dir / "manifest.json"
        tmp = self.session_dir / "manifest.json.tmp"
        tmp.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(mp)
        return mp


def read_raw(session_dir: Path, channel: str) -> Iterator[dict[str, Any]]:
    """Đọc tuần tự thông điệp thô (bỏ dòng meta)."""
    path = Path(session_dir) / f"{channel}.jsonl.gz"
    if not path.exists():
        return
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            rec = json.loads(line)
            if rec.get("_meta"):
                continue
            yield rec


def read_manifest(session_dir: Path) -> dict[str, Any]:
    mp = Path(session_dir) / "manifest.json"
    return json.loads(mp.read_text(encoding="utf-8")) if mp.exists() else {}


def recover_incomplete_session(session_dir: Path, expected_provider: str) -> Path:
    """Copy complete JSONL records from an interrupted capture into a new session.

    The source is never modified. Only a single malformed final line per
    channel may be discarded; interior corruption or inconsistent metadata
    aborts recovery rather than producing a success-shaped partial capture.
    """
    source = Path(session_dir).resolve()
    if not source.is_dir() or (source / "manifest.json").exists():
        raise RuntimeError(f"Capture không tồn tại hoặc đã hoàn tất: {source}")
    files = sorted(source.glob("*.jsonl.gz"))
    if not files:
        raise RuntimeError(f"Capture không có tệp RAW để phục hồi: {source}")

    headers: list[dict[str, Any]] = []
    counts: dict[str, int] = {}
    sequences: set[int] = set()
    truncated: dict[str, int] = {}
    empty_files: list[str] = []
    missing_trailers: list[str] = []
    valid_streams = 0

    recovered_at = now_vn().isoformat()
    suffix = now_vn().strftime("%Y%m%d_%H%M%S")
    destination = source.with_name(f"{source.name}_RECOVERED_{suffix}_{uuid4().hex[:8]}")
    if destination.exists():
        raise FileExistsError(destination)

    with tempfile.TemporaryDirectory(prefix=".neoscope-recover-", dir=source.parent) as temp_name:
        temp_dir = Path(temp_name)
        for raw_path in files:
            if raw_path.stat().st_size == 0:
                empty_files.append(raw_path.name)
                continue

            output_path = temp_dir / raw_path.name
            channel = raw_path.name.removesuffix(".jsonl.gz")
            count = 0
            last_sequence = 0
            line_number = 0
            saw_header = False
            saw_truncated_tail = False

            def save_line(raw_line: bytes, writer: Any) -> None:
                nonlocal line_number, saw_header, saw_truncated_tail, last_sequence, count
                line_number += 1
                raw_line = raw_line.removesuffix(b"\r")
                if saw_truncated_tail:
                    raise RuntimeError(
                        f"Không thể phục hồi {raw_path}: có dữ liệu sau dòng JSON lỗi "
                        f"{line_number - 1}."
                    )
                try:
                    line = raw_line.decode("utf-8")
                except UnicodeDecodeError:
                    if not saw_header:
                        raise RuntimeError(f"Header RAW không hợp lệ trong {raw_path}.")
                    saw_truncated_tail = True
                    truncated[channel] = 1
                    return
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    if not saw_header:
                        raise RuntimeError(
                            f"Header RAW không hợp lệ trong {raw_path}, dòng {line_number}."
                        )
                    saw_truncated_tail = True
                    truncated[channel] = 1
                    return

                if not isinstance(record, dict):
                    raise RuntimeError(
                        f"Bản ghi RAW không phải object trong {raw_path}, dòng {line_number}."
                    )
                if not saw_header:
                    if record.get("_meta") is not True:
                        raise RuntimeError(f"Thiếu header RAW trong {raw_path}.")
                    if record.get("mode") != "LIVE" or record.get("provider") != expected_provider:
                        raise RuntimeError(
                            f"Không khớp chế độ/nguồn trong header {raw_path}; "
                            f"cần LIVE / {expected_provider}."
                        )
                    headers.append(record)
                    saw_header = True
                else:
                    sequence = record.get("seq")
                    if type(sequence) is not int or sequence <= last_sequence:
                        raise RuntimeError(
                            f"Sequence không hợp lệ trong {raw_path}, dòng {line_number}."
                        )
                    if sequence in sequences:
                        raise RuntimeError(f"Sequence {sequence} bị lặp trong capture.")
                    if record.get("channel") != channel or not isinstance(record.get("data"), dict):
                        raise RuntimeError(
                            f"Channel/data không hợp lệ trong {raw_path}, dòng {line_number}."
                        )
                    sequences.add(sequence)
                    last_sequence = sequence
                    count += 1

                writer.write(line if line.endswith("\n") else line + "\n")

            decompressor = zlib.decompressobj(16 + zlib.MAX_WBITS)
            pending = bytearray()
            with raw_path.open("rb") as raw_file, \
                    gzip.open(output_path, "wt", encoding="utf-8", compresslevel=1) as writer:
                while chunk := raw_file.read(1024 * 1024):
                    try:
                        pending.extend(decompressor.decompress(chunk))
                    except zlib.error as exc:
                        raise RuntimeError(
                            f"Luồng gzip hỏng trước khi kết thúc trong {raw_path}: {exc}"
                        ) from exc
                    start = 0
                    while (newline := pending.find(b"\n", start)) >= 0:
                        save_line(bytes(pending[start:newline]), writer)
                        start = newline + 1
                    if start:
                        del pending[:start]
                try:
                    pending.extend(decompressor.flush())
                except zlib.error as exc:
                    raise RuntimeError(
                        f"Không thể giải nén phần cuối của {raw_path}: {exc}"
                    ) from exc
                if decompressor.unused_data:
                    raise RuntimeError(f"Dữ liệu gzip thừa sau stream trong {raw_path}.")
                if not decompressor.eof:
                    missing_trailers.append(raw_path.name)
                if pending:
                    save_line(bytes(pending), writer)

            if not saw_header:
                raise RuntimeError(f"Không tìm thấy header RAW trong {raw_path}.")
            counts[channel] = count
            valid_streams += 1

        if not valid_streams or counts.get("stockInfo", 0) == 0:
            raise RuntimeError("Capture không có bản ghi stockInfo hoàn chỉnh để phục hồi.")

        reference = headers[0]
        for header in headers[1:]:
            for key in ("session_date", "config_hash", "provider", "mode"):
                if header.get(key) != reference.get(key):
                    raise RuntimeError(f"Metadata {key} không nhất quán giữa các tệp RAW.")

        recovered_meta = {
            key: value for key, value in reference.items()
            if key not in {"_meta", "mode", "synthetic", "created_at"}
        }
        max_sequence = max(sequences, default=0)
        manifest = {
            "mode": "LIVE",
            "synthetic": False,
            "counts": counts,
            "total_messages": sum(counts.values()),
            "closed_at": recovered_at,
            "sha256": {
                path.name: _sha256_file(path)
                for path in sorted(temp_dir.glob("*.jsonl.gz"))
            },
            **recovered_meta,
            "recovered": True,
            "recovery": {
                "source_session": source.name,
                "recovered_at": recovered_at,
                "discarded_truncated_tail_records": truncated,
                "gzip_streams_missing_trailer": missing_trailers,
                "omitted_empty_files": empty_files,
                "missing_sequence_count": max_sequence - len(sequences),
            },
        }
        (temp_dir / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        temp_dir.rename(destination)

    return destination


def list_session_dirs(data_dir: Path, mode: str | None = None) -> list[Path]:
    raw = Path(data_dir) / "raw"
    if not raw.exists():
        return []
    dirs = [p for p in raw.iterdir() if p.is_dir() and (p / "manifest.json").exists()]
    if mode:
        dirs = [p for p in dirs if p.name.startswith(mode_prefix(mode) + "_")]
    return sorted(dirs, key=lambda p: p.name.split("_", 1)[1])


def session_date_of(session_dir: Path) -> str:
    name = session_dir.name
    parts = name.split("_")
    if len(parts) >= 3 and parts[0] == "SYNTH":
        return parts[1]
    if len(parts) >= 4 and parts[0] == "LIVE" and parts[1] in {"NEO", "SSI"}:
        return parts[2]
    return name.rsplit("_", 1)[1]


def write_parquet(df: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(path, index=False)


def read_parquet(path: Path) -> pd.DataFrame:
    return pd.read_parquet(path)
