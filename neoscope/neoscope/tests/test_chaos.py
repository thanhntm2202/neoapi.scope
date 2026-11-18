"""Chaos test tầng dữ liệu: bơm bẫy có chủ đích → ĐẾM CỜ KHỚP TÍNH TAY.

Đây là bằng chứng TC6 (kiểm thử có kịch bản, không chỉ đường thuận):
mỗi tình huống lỗi có hành vi mong đợi định trước và kết quả thật đối chiếu.
Kịch bản dùng chung với scripts/chaos_report.py (một nguồn sự thật).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from neoscope.data.pipeline import process_session
from neoscope.data.store import read_manifest, read_parquet, read_raw

from .chaos_scenarios import (EXPECTED_DUPLICATES_DROPPED, EXPECTED_FLAGS,
                              build_chaos_session)


def _run(tmp_settings, tmp_path):
    session_dir = tmp_settings.data_path("raw", "SYNTH_2026-11-03")
    info = build_chaos_session(session_dir)
    out = process_session(tmp_settings, session_dir, force=True)
    snaps = read_parquet(out / "snapshots.parquet")
    quality = read_parquet(out / "quality.parquet")
    meta = read_parquet(out / "quality_meta.parquet")
    return info, snaps, quality, meta


def test_every_flag_matches_hand_computed_count(tmp_settings, tmp_path):
    _, snaps, quality, _ = _run(tmp_settings, tmp_path)
    observed = quality.groupby("flags")["n"].sum().to_dict()
    observed = {str(k): int(v) for k, v in observed.items()}
    assert observed == EXPECTED_FLAGS, f"lệch cờ: {observed}"


def test_duplicates_dropped_and_counted(tmp_settings, tmp_path):
    _, snaps, _, meta = _run(tmp_settings, tmp_path)
    assert int(meta["n_duplicates_dropped"].iloc[0]) == EXPECTED_DUPLICATES_DROPPED
    assert int(meta["n_raw"].iloc[0]) - int(meta["n_curated"].iloc[0]) == EXPECTED_DUPLICATES_DROPPED
    assert len(snaps) == int(meta["n_curated"].iloc[0])


def test_volume_conservation_despite_late_ooo_gap(tmp_settings, tmp_path):
    """Tổng delta phải bằng hiệu bộ đếm đầu–cuối (trước reset): không mất,
    không nhân đôi khối lượng dù có thông điệp muộn/sai thứ tự/khoảng trống."""
    info, snaps, _, _ = _run(tmp_settings, tmp_path)
    assert int(snaps["d_vol"].sum(skipna=True)) == info["expected_vol_conservation"]
    assert int(snaps["d_val"].sum(skipna=True)) == info["expected_val_conservation"]
    # không có nhịp âm nào bị bịa ra
    assert (snaps["d_vol"].dropna() >= 0).all()
    assert (snaps["d_val"].dropna() >= 0).all()


def test_invalid_book_ticks_have_nan_indicators(tmp_settings, tmp_path):
    _, snaps, _, _ = _run(tmp_settings, tmp_path)
    bad = snaps[snaps["flags"].apply(
        lambda fl: any(f in fl for f in ("CROSSED_BOOK", "NO_BOOK", "ATO_ATC", "BEYOND_BAND")))]
    assert len(bad) == 3  # tick ATO (mang cả NO_BOOK), tick crossed, tick beyond-band
    assert bad["mid"].isna().all()
    assert bad["spread_bps"].isna().all()
    assert bad["obi"].isna().all()


def test_late_message_delta_nan_and_state_not_rewound(tmp_settings, tmp_path):
    _, snaps, _, _ = _run(tmp_settings, tmp_path)
    late = snaps[snaps["flags"].apply(lambda fl: "LATE_ARRIVAL" in fl)]
    assert len(late) == 1
    assert late["d_vol"].isna().all() and late["d_val"].isna().all()
    # Bộ đếm QUAN SÁT được đơn điệu theo thời gian sự kiện, ngoại trừ chính
    # các thông điệp muộn/reset (chúng mang trạng thái cũ — đã gắn cờ).
    clean = snaps[snaps["flags"].apply(
        lambda fl: not any(f in fl for f in ("LATE_ARRIVAL", "COUNTER_RESET")))]
    cum = clean["cum_vol"].dropna()
    assert (cum.diff().dropna() >= 0).all()


def test_reset_flagged_not_fabricated_negative(tmp_settings, tmp_path):
    _, snaps, _, _ = _run(tmp_settings, tmp_path)
    reset = snaps[snaps["flags"].apply(lambda fl: "COUNTER_RESET" in fl)]
    assert len(reset) == 1
    assert reset["d_vol"].isna().all()


def test_gap_absorbed_into_next_delta(tmp_settings, tmp_path):
    _, snaps, _, _ = _run(tmp_settings, tmp_path)
    gap_row = snaps[snaps["flags"].apply(lambda fl: "STALE_GAP" in fl)]
    assert len(gap_row) == 1
    # 9 nhịp bị mất (40..47 không phát + nhịp nối lại) → delta 9.000 cp
    assert int(gap_row["d_vol"].iloc[0]) == 9_000


def test_manifest_sha256_integrity(tmp_settings, tmp_path):
    import hashlib
    session_dir = tmp_settings.data_path("raw", "SYNTH_2026-11-03")
    build_chaos_session(session_dir)
    man = read_manifest(session_dir)
    for name, digest in man["sha256"].items():
        assert hashlib.sha256((session_dir / name).read_bytes()).hexdigest() == digest
    n = sum(1 for _ in read_raw(session_dir, "stockInfo"))
    assert n == man["counts"]["stockInfo"]
