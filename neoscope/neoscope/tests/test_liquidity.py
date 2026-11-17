"""Kiểm thử thanh khoản động: ILLIQ Amihud, σ nội ngày, resilience."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from neoscope.constants import VN_TZ
from neoscope.finance.liquidity import (amihud_bps_per_bn,
                                        realized_sigma_bps_per_s,
                                        resilience_episodes)

from .conftest import snap_row, snaps_frame


def test_amihud_hand_computed():
    # |10 bps| / (2 tỷ / 1 tỷ) = 5 bps trên mỗi tỷ đồng
    assert amihud_bps_per_bn(10.0, 2e9) == pytest.approx(5.0)
    assert amihud_bps_per_bn(-10.0, 2e9) == pytest.approx(5.0)  # trị tuyệt đối


def test_amihud_zero_value_is_nan_not_inf():
    assert np.isnan(amihud_bps_per_bn(10.0, 0.0))
    assert np.isnan(amihud_bps_per_bn(np.nan, 1e9))


def test_realized_sigma_scaling_from_minutes_to_seconds():
    s = pd.Series([10.0, -10.0] * 10)
    got = realized_sigma_bps_per_s(s, window_bars=20).iloc[-1]
    assert got == pytest.approx(s.std() / np.sqrt(60.0))


def test_realized_sigma_needs_min_periods():
    s = pd.Series([1.0, 2.0, 3.0])
    assert realized_sigma_bps_per_s(s, window_bars=15).isna().all()


def _resilience_frame(depth_shock: float, recover_after: int | None):
    """60 nhịp baseline depth 592000; tại nhịp 30 có burst KL lớn.

    Sau burst: depth giảm còn depth_shock; nếu recover_after (nhịp) thì
    phục hồi về baseline → thời gian phục hồi = recover_after×5s.
    """
    t0 = pd.Timestamp("2026-11-03 10:00:00", tz=VN_TZ)
    rows = []
    for i in range(80):
        depth_scale = 1.0
        if i > 30:
            depth_scale = depth_shock
            if recover_after is not None and i > 30 + recover_after:
                depth_scale = 1.0
        v = tuple(int(x * depth_scale) for x in (1000, 2000, 3000))
        rows.append(snap_row(t0 + pd.Timedelta(seconds=5 * i), bvol=v,
                             d_vol=1000.0 if i != 31 else 500_000.0))
    return snaps_frame(rows)


def test_resilience_recovery_time_hand_computed():
    df = _resilience_frame(depth_shock=0.2, recover_after=6)
    ep = resilience_episodes(df, burst_quantile=0.95, recovery_frac=0.8,
                             pre_window_s=60, max_horizon_s=300)
    assert len(ep) >= 1
    hit = ep[~ep["unrecovered"]]
    assert len(hit) >= 1
    # burst ở nhịp 31; độ sâu phục hồi từ nhịp 37 → (37−31)×5s = 30s
    assert hit["recover_s"].min() == pytest.approx(30.0)
    assert hit["pre_depth"].iloc[0] == pytest.approx(592_000.0)


def test_resilience_marks_unrecovered():
    df = _resilience_frame(depth_shock=0.1, recover_after=None)
    ep = resilience_episodes(df, burst_quantile=0.95, recovery_frac=0.8,
                             pre_window_s=60, max_horizon_s=120)
    assert len(ep) >= 1 and ep["unrecovered"].all()
    assert ep["recover_s"].isna().all()


def test_resilience_too_short_series_returns_empty_schema():
    t0 = pd.Timestamp("2026-11-03 10:00:00", tz=VN_TZ)
    df = snaps_frame([snap_row(t0 + pd.Timedelta(seconds=5 * i)) for i in range(10)])
    ep = resilience_episodes(df)
    assert ep.empty
    assert list(ep.columns) == ["ts", "pre_depth", "recover_s", "unrecovered"]
