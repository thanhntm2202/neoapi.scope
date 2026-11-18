"""LHS: hạng percentile tính tay, không nhìn trước, độ nhạy trọng số.

Khóa ba lời hứa của chỉ số tổng hợp:
1. LHS = 100 × trung bình có trọng số của hạng percentile CHÉO MÃ tại cùng
   thời điểm — kiểm chứng bằng bảng số tính tay được (kể cả hạng đồng hạng).
2. Cửa sổ trượt chỉ nhìn QUÁ KHỨ: sửa dữ liệu tương lai không đổi LHS quá khứ.
3. Xếp hạng bền với lựa chọn trọng số (độ nhạy Spearman).
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from neoscope.analytics.lhs import COMPONENTS, compute_lhs, lhs_sensitivity
from neoscope.constants import VN_TZ

SYMS = ["HPG", "VCB", "FPT", "SSI"]  # thứ tự 'sức khỏe' giảm dần theo thiết kế
N_BARS = 20


def _bars(seed_spread=None) -> pd.DataFrame:
    """4 mã × 20 bar phút, mọi cấu phần HẰNG SỐ theo mã → tính tay được.

    spread 5/10/15/20 bps; depth 4/3/2/1 tỷ; |ret| 1/2/3/4 bps trên d_val 1 tỷ
    → ILLIQ cửa sổ = 1/2/3/4; std(spread) = 0 (đồng hạng); |OBI| 0.1..0.4.
    """
    rows = []
    t0 = pd.Timestamp("2026-11-03 10:00:00", tz=VN_TZ)
    for k, sym in enumerate(SYMS):
        for i in range(N_BARS):
            rows.append({
                "symbol": sym, "session_date": "2026-11-03", "group": "large",
                "bar_ts": t0 + pd.Timedelta(minutes=i),
                "spread_bps": 5.0 * (k + 1),
                "depth_bid_vnd": (4 - k) * 1e9, "depth_ask_vnd": (4 - k) * 1e9,
                "ret_bps": float(k + 1), "d_val": 1e9,
                "obi_last": 0.1 * (k + 1),
            })
    return pd.DataFrame(rows)


def test_lhs_hand_computed_with_tied_stability(settings):
    out = compute_lhs(_bars(), settings)
    at_t = out[out["bar_ts"] == out["bar_ts"].max()].set_index("symbol")
    # hạng percentile chéo 4 mã: best=1.0, worst=0.25; stability đồng hạng
    # (std=0 cho mọi mã) → rank trung bình (1+2+3+4)/4/4 = 0.625.
    expected = {"HPG": 100 * (4 * 1.00 + 0.625) / 5,   # 92.5
                "VCB": 100 * (4 * 0.75 + 0.625) / 5,   # 72.5
                "FPT": 100 * (4 * 0.50 + 0.625) / 5,   # 52.5
                "SSI": 100 * (4 * 0.25 + 0.625) / 5}   # 32.5
    for sym, e in expected.items():
        assert at_t.loc[sym, "lhs"] == pytest.approx(e, abs=1e-9), sym
    assert at_t.loc["HPG", "r_stability"] == pytest.approx(0.625)
    assert at_t.loc["SSI", "r_tightness"] == pytest.approx(0.25)


def test_lhs_warmup_bars_are_nan_not_fabricated(settings):
    out = compute_lhs(_bars(), settings)
    first = out[out["bar_ts"] == out["bar_ts"].min()]
    assert first["lhs"].isna().all()  # min_periods=5: chưa đủ cửa sổ → không bịa điểm


def test_lhs_no_lookahead_future_edit_does_not_change_past(settings):
    bars = _bars()
    base = compute_lhs(bars, settings)
    cutoff = base["bar_ts"].unique()[9]
    mutated = bars.copy()
    late = mutated["bar_ts"] > cutoff
    mutated.loc[late, "spread_bps"] = 999.0
    mutated.loc[late, "d_val"] = 1.0
    after = compute_lhs(mutated, settings)
    m = base["bar_ts"] <= cutoff
    pd.testing.assert_series_equal(base.loc[m, "lhs"], after.loc[m, "lhs"],
                                   check_names=False)


def test_lhs_ranks_are_cross_sectional_at_same_timestamp(settings):
    out = compute_lhs(_bars(), settings).dropna(subset=["lhs"])
    for _, g in out.groupby("bar_ts"):
        assert sorted(g["r_tightness"].tolist()) == pytest.approx([0.25, 0.5, 0.75, 1.0])
        # tổng hạng mỗi cấu phần tại một thời điểm = n(n+1)/2 / n (không có mã lạ)
        assert g["r_depth"].sum() == pytest.approx(2.5)


def test_lhs_sensitivity_identical_ordering_gives_spearman_one(settings):
    bars_lhs = compute_lhs(_bars(), settings)
    sens = lhs_sensitivity(bars_lhs, settings)
    assert set(sens["perturbed_weight"]) == set(COMPONENTS)
    # mọi cấu phần cùng thứ hạng trong thiết kế này → đổi trọng số không đổi thứ hạng
    assert (sens["mean_spearman"] >= 0.999).all()


def test_lhs_insufficient_symbols_still_bounded(settings):
    bars = _bars()
    one = bars[bars["symbol"] == "HPG"]
    out = compute_lhs(one, settings).dropna(subset=["lhs"])
    # một mã duy nhất: mọi hạng = 1.0 → LHS = 100 (đúng định nghĩa, không crash)
    assert np.allclose(out["lhs"].to_numpy(dtype=float), 100.0)
