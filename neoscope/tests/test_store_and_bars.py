"""Kiểm thử tầng lưu trữ: RAW bất biến, manifest sha256, search_ts, bars."""
from __future__ import annotations

import gzip
import hashlib
import json

import numpy as np
import pandas as pd
import pytest

from neoscope.constants import VN_TZ, bucket_of_time, session_of_time, tick_size, round_to_tick
from neoscope.data import pipeline
from neoscope.data.pipeline import build_bars
from neoscope.data.store import (RawWriter, list_session_dirs, read_manifest,
                                 read_parquet, read_raw,
                                 recover_incomplete_session, search_ts,
                                 session_date_of, write_parquet)

from .conftest import payload, snap_row, snaps_frame


# ------------------------------------------------------------------ RAW
def test_raw_roundtrip_and_manifest_hash(tmp_path):
    d = tmp_path / "SYNTH_2026-11-03"
    w = RawWriter(d, "SYNTHETIC", meta={"seed": 42})
    ts = pd.Timestamp("2026-11-03 10:00:00", tz=VN_TZ).to_pydatetime()
    for i in range(5):
        w.write("stockInfo", payload(cum_vol=1000 + i), ts)
    w.write("marketInfo", {"indexCode": "VNINDEX"}, ts)
    mp = w.close()
    man = json.loads(mp.read_text())
    assert man["synthetic"] is True and man["seed"] == 42
    assert man["counts"] == {"stockInfo": 5, "marketInfo": 1}
    assert man["total_messages"] == 6
    for name, digest in man["sha256"].items():
        assert hashlib.sha256((d / name).read_bytes()).hexdigest() == digest
    recs = list(read_raw(d, "stockInfo"))
    assert [r["seq"] for r in recs] == [1, 2, 3, 4, 5]
    assert all(r["channel"] == "stockInfo" for r in recs)
    assert recs[0]["data"]["symbol"] == "HPG"


def test_raw_meta_header_is_not_a_record(tmp_path):
    d = tmp_path / "SYNTH_2026-11-03"
    w = RawWriter(d, "SYNTHETIC")
    w.write("stockInfo", payload())
    w.close()
    with gzip.open(d / "stockInfo.jsonl.gz", "rt", encoding="utf-8") as f:
        first = json.loads(f.readline())
    assert first.get("_meta") is True
    assert len(list(read_raw(d, "stockInfo"))) == 1


def test_raw_append_does_not_duplicate_header(tmp_path):
    d = tmp_path / "LIVE_2026-11-03"
    w = RawWriter(d, "LIVE"); w.write("stockInfo", payload()); w.close()
    w2 = RawWriter(d, "LIVE"); w2.write("stockInfo", payload(cum_vol=2)); w2.close()
    assert len(list(read_raw(d, "stockInfo"))) == 2


def test_read_raw_missing_channel_is_empty(tmp_path):
    assert list(read_raw(tmp_path, "marketVolume")) == []


def test_session_listing_filters_by_mode(tmp_path):
    for name in ("SYNTH_2026-11-03", "SYNTH_2026-11-04", "LIVE_2026-11-05"):
        w = RawWriter(tmp_path / "raw" / name, "SYNTHETIC" if name.startswith("SYNTH") else "LIVE")
        w.write("stockInfo", payload()); w.close()
    (tmp_path / "raw" / "SYNTH_khong_co_manifest").mkdir(parents=True)
    syn = list_session_dirs(tmp_path, "SYNTHETIC")
    live = list_session_dirs(tmp_path, "LIVE")
    assert [session_date_of(p) for p in syn] == ["2026-11-03", "2026-11-04"]
    assert [session_date_of(p) for p in live] == ["2026-11-05"]
    assert len(list_session_dirs(tmp_path)) == 3


def test_process_all_skips_finalized_capture_without_stock_info(tmp_settings, monkeypatch):
    empty = tmp_settings.data_path("raw", f"{tmp_settings.dataset_mode}_2026-11-03_090000_empty")
    RawWriter(empty, tmp_settings.mode).close()

    valid = tmp_settings.data_path("raw", f"{tmp_settings.dataset_mode}_2026-11-04_090000_valid")
    writer = RawWriter(valid, tmp_settings.mode)
    writer.write("stockInfo", payload())
    writer.close()

    processed: list = []
    monkeypatch.setattr(
        pipeline,
        "process_session",
        lambda settings, session_dir, force=False: processed.append(session_dir) or session_dir,
    )

    result = pipeline.process_all(tmp_settings)

    assert result == [valid]
    assert processed == [valid]


def test_process_all_explains_when_only_empty_captures_exist(tmp_settings):
    empty = tmp_settings.data_path("raw", f"{tmp_settings.dataset_mode}_2026-11-03_090000_empty")
    RawWriter(empty, tmp_settings.mode).close()
    incomplete = tmp_settings.data_path("raw", f"{tmp_settings.dataset_mode}_2026-11-03_091000_incomplete")
    incomplete.mkdir(parents=True)
    (incomplete / "stockInfo.jsonl.gz").touch()

    with pytest.raises(RuntimeError, match="Capture chưa hoàn tất") as exc:
        pipeline.process_all(tmp_settings)
    assert incomplete.name in str(exc.value)
    assert "manifest" in str(exc.value)


def test_recover_incomplete_capture_copies_valid_records_and_preserves_source(tmp_path):
    source = tmp_path / "raw" / "LIVE_SSI_2026-11-03_090000_capture"
    writer = RawWriter(source, "LIVE", meta={"provider": "SSI FastConnect API v3",
                                             "session_date": "2026-11-03",
                                             "config_hash": "test-hash"})
    writer.write("stockInfo", payload())
    writer.write("ssi_trade", {"symbol": "HPG"})
    writer.close()
    (source / "manifest.json").unlink()
    original_stock = source / "stockInfo.jsonl.gz"
    with gzip.open(original_stock, "rt", encoding="utf-8") as f:
        contents = f.read()
    with gzip.open(original_stock, "wt", encoding="utf-8") as f:
        f.write(contents)
        f.write('{"seq": 3, "arrival_ts": "truncated')
    compressed = original_stock.read_bytes()
    original_stock.write_bytes(compressed[:-8])
    (source / "ssi_unknown.jsonl.gz").touch()
    before = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in source.iterdir()}

    recovered = recover_incomplete_session(source, "SSI FastConnect API v3")

    after = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in source.iterdir()}
    manifest = read_manifest(recovered)
    assert before == after
    assert not (source / "manifest.json").exists()
    assert manifest["recovered"] is True
    assert manifest["counts"] == {"ssi_trade": 1, "stockInfo": 1}
    assert manifest["recovery"]["discarded_truncated_tail_records"] == {"stockInfo": 1}
    assert manifest["recovery"]["gzip_streams_missing_trailer"] == ["stockInfo.jsonl.gz"]
    assert manifest["recovery"]["omitted_empty_files"] == ["ssi_unknown.jsonl.gz"]
    assert len(list(read_raw(recovered, "stockInfo"))) == 1
    assert recovered in list_session_dirs(tmp_path, "LIVE_SSI")
    for name, digest in manifest["sha256"].items():
        assert hashlib.sha256((recovered / name).read_bytes()).hexdigest() == digest


def test_recover_incomplete_capture_rejects_interior_corruption(tmp_path):
    source = tmp_path / "raw" / "LIVE_SSI_2026-11-03_090000_capture"
    source.mkdir(parents=True)
    header = {"_meta": True, "mode": "LIVE", "provider": "SSI FastConnect API v3",
              "session_date": "2026-11-03", "config_hash": "test-hash"}
    record = {"seq": 1, "channel": "stockInfo", "data": payload()}
    with gzip.open(source / "stockInfo.jsonl.gz", "wt", encoding="utf-8") as f:
        f.write(json.dumps(header) + "\n")
        f.write('{"broken":\n')
        f.write(json.dumps(record) + "\n")

    with pytest.raises(RuntimeError, match="dữ liệu sau dòng JSON lỗi"):
        recover_incomplete_session(source, "SSI FastConnect API v3")

    assert not list(source.parent.glob(f"{source.name}_RECOVERED_*"))


def test_parquet_roundtrip_preserves_tz(tmp_path):
    df = snaps_frame([snap_row(pd.Timestamp("2026-11-03 10:00:00", tz=VN_TZ))])
    p = tmp_path / "x.parquet"
    write_parquet(df, p)
    back = read_parquet(p)
    assert str(back["ts"].dt.tz) == "Asia/Ho_Chi_Minh"
    assert back["mid"].iloc[0] == pytest.approx(101.0)


# ------------------------------------------------------------------ search_ts
@pytest.mark.parametrize("unit", ["s", "ms", "us", "ns"])
def test_search_ts_handles_all_datetime_units(unit):
    """Parquet có thể trả us trong khi Timestamp mang ns — không được ném lỗi."""
    s = pd.Series(pd.date_range("2026-11-03 10:00:00", periods=10, freq="5s", tz=VN_TZ)).dt.as_unit(unit)
    needle = pd.Timestamp("2026-11-03 10:00:22", tz=VN_TZ)  # giữa nhịp 4 và 5
    assert search_ts(s, needle, side="right") == 5
    assert search_ts(s, needle, side="left") == 5
    exact = pd.Timestamp("2026-11-03 10:00:20", tz=VN_TZ)
    assert search_ts(s, exact, side="right") == 5
    assert search_ts(s, exact, side="left") == 4


def test_search_ts_naive_series_vs_aware_needle():
    s = pd.Series(pd.date_range("2026-11-03 10:00:00", periods=5, freq="5s"))
    needle = pd.Timestamp("2026-11-03 10:00:10")
    assert search_ts(s, needle) == 3


def test_search_ts_before_start_and_after_end():
    s = pd.Series(pd.date_range("2026-11-03 10:00:00", periods=5, freq="5s", tz=VN_TZ))
    assert search_ts(s, pd.Timestamp("2026-11-03 09:00:00", tz=VN_TZ)) == 0
    assert search_ts(s, pd.Timestamp("2026-11-03 11:00:00", tz=VN_TZ)) == 5


# ------------------------------------------------------------------ bars
def test_bars_aggregate_deltas_and_ohlclike_mid(settings):
    t0 = pd.Timestamp("2026-11-03 10:00:00", tz=VN_TZ)
    rows = []
    for i in range(24):  # 2 phút × 12 nhịp
        px = 100.0 + i * 0.1
        rows.append(snap_row(t0 + pd.Timedelta(seconds=5 * i),
                             bid=(px, px - 1, px - 2), ask=(px + 2, px + 3, px + 4),
                             d_vol=100.0, d_val=1e7))
    bars = build_bars(snaps_frame(rows), settings)
    assert len(bars) == 2
    assert bars["d_vol"].tolist() == [1200.0, 1200.0]     # 12 nhịp × 100
    assert bars["d_val"].iloc[0] == pytest.approx(1.2e8)
    assert bars["n_snap"].tolist() == [12, 12]
    assert bars["mid_open"].iloc[0] == pytest.approx(101.0)
    assert bars["mid_close"].iloc[0] == pytest.approx(101.0 + 11 * 0.1)
    assert bars["mid_high"].iloc[0] >= bars["mid_close"].iloc[0]


def test_bars_return_is_nan_across_lunch_gap(settings):
    """Nhịp bắc qua nghỉ trưa 90 phút không được tạo lợi nhuận giả."""
    rows = []
    for h, m in ((11, 28), (11, 29), (13, 0), (13, 1)):
        ts = pd.Timestamp(f"2026-11-03 {h:02d}:{m:02d}:00", tz=VN_TZ)
        for k in range(3):
            rows.append(snap_row(ts + pd.Timedelta(seconds=5 * k),
                                 bid=(100.0 if h < 12 else 110.0, 99, 98),
                                 ask=(102.0 if h < 12 else 112.0, 103, 104)))
    bars = build_bars(snaps_frame(rows), settings)
    pm_first = bars[bars["bar_ts"].dt.hour == 13].iloc[0]
    assert np.isnan(pm_first["ret_bps"])
    assert np.isnan(pm_first["illiq"])


def test_bars_exclude_ato_atc_and_lunch(settings):
    rows = []
    for h, m in ((9, 5), (10, 0), (12, 0), (14, 35)):
        ts = pd.Timestamp(f"2026-11-03 {h:02d}:{m:02d}:00", tz=VN_TZ)
        r = snap_row(ts)
        r["session"] = session_of_time(ts.time())
        rows.append(r)
    bars = build_bars(snaps_frame(rows), settings)
    assert len(bars) == 1 and bars["bar_ts"].iloc[0].hour == 10


def test_bars_illiq_matches_definition(settings):
    t0 = pd.Timestamp("2026-11-03 10:00:00", tz=VN_TZ)
    rows = []
    for i in range(24):
        px = 100.0 if i < 12 else 101.0   # bước nhảy 1% giữa hai phút
        rows.append(snap_row(t0 + pd.Timedelta(seconds=5 * i),
                             bid=(px, px - 1, px - 2), ask=(px + 2, px + 3, px + 4),
                             d_vol=1000.0, d_val=1e8))
    bars = build_bars(snaps_frame(rows), settings)
    r = bars.iloc[1]
    # ret = (102 − 101)/101 × 1e4 = 99.0099 bps ; GTGD = 12×1e8 = 1.2 tỷ
    expected_ret = (102.0 - 101.0) / 101.0 * 1e4
    assert r["ret_bps"] == pytest.approx(expected_ret)
    assert r["illiq"] == pytest.approx(abs(expected_ret) / (1.2e9 / 1e9))


# ------------------------------------------------------------------ constants
def test_hose_tick_size_grid():
    assert tick_size(9_990) == 10.0
    assert tick_size(10_000) == 50.0
    assert tick_size(49_999) == 50.0
    assert tick_size(50_000) == 100.0


def test_round_to_tick_modes():
    assert round_to_tick(29_733, "nearest") == 29_750
    assert round_to_tick(29_733, "down") == 29_700
    assert round_to_tick(29_733, "up") == 29_750


def test_bucket_of_time_groups_15min():
    from datetime import time
    assert bucket_of_time(time(10, 0)) == bucket_of_time(time(10, 14))
    assert bucket_of_time(time(10, 15)) != bucket_of_time(time(10, 14))
