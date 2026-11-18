"""Kiểm thử mô hình chi phí thực thi: ladder walk, E[IS], PI, phí/thuế.

Kỳ vọng tính tay; ca suy biến (Q=0, sổ trống, Q > toàn sổ, không có profile
khối lượng, hết chân trời) phải được xử lý tường minh bằng cờ, không ném số.
"""
from __future__ import annotations

import math

import numpy as np
import pytest

from neoscope.finance.execution import (LadderResult, expected_is_bps,
                                        ladder_walk, trading_costs_bps)

PRICES = [100.0, 99.0, 98.0]
VOLS = [1000.0, 2000.0, 3000.0]
MID = 101.0


def test_ladder_sell_partial_hand_computed():
    # bán 2500 cp: 1000@100 + 1500@99 → notional 248500, VWAP 99.4
    # IS = −1×(99.4 − 101)/101 × 1e4 = 158.4158 bps
    r = ladder_walk(-1, 2500, PRICES, VOLS, MID)
    assert r.ok and r.filled_vis == 2500 and r.qty_res == 0
    assert r.vwap_vis == pytest.approx(99.4)
    assert r.cost_vis_bps == pytest.approx(1.6 / 101 * 1e4)
    assert r.coverage == pytest.approx(1.0)
    assert [(f["price"], f["qty"]) for f in r.fills] == [(100.0, 1000.0), (99.0, 1500.0)]


def test_ladder_sell_beyond_book_hand_computed():
    # bán 7000 cp: sổ chỉ có 6000 → VWAP = 592000/6000 = 98.66667
    r = ladder_walk(-1, 7000, PRICES, VOLS, MID)
    assert r.filled_vis == 6000 and r.qty_res == 1000
    assert r.vwap_vis == pytest.approx(592_000 / 6000)
    assert r.coverage == pytest.approx(6000 / 7000)
    assert r.cost_vis_bps == pytest.approx((101 - 592_000 / 6000) / 101 * 1e4)


def test_ladder_buy_mirror_sign():
    # mua 2500: 1000@102 + 1500@103 → VWAP 102.6 ; IS = +(102.6−101)/101×1e4
    r = ladder_walk(+1, 2500, [102.0, 103.0, 104.0], VOLS, MID)
    assert r.vwap_vis == pytest.approx(102.6)
    assert r.cost_vis_bps == pytest.approx(1.6 / 101 * 1e4)
    assert r.cost_vis_bps > 0  # chi phí luôn dương cho lệnh chủ động


def test_ladder_degenerate_cases():
    assert not ladder_walk(-1, 0, PRICES, VOLS, MID).ok          # Q = 0
    assert not ladder_walk(-1, 100, [], [], MID).ok              # sổ trống
    assert not ladder_walk(-1, 100, PRICES, VOLS, float("nan")).ok
    assert not ladder_walk(-1, 100, [None] * 3, [None] * 3, MID).ok
    r = ladder_walk(-1, 100, [100.0, None, None], [1000.0, None, None], MID)
    assert r.ok and r.filled_vis == 100  # mức thiếu bị bỏ qua, không chặn lệnh


def test_expected_is_fully_in_book_is_deterministic():
    lad = ladder_walk(-1, 2500, PRICES, VOLS, MID)
    e = expected_is_bps(-1, 2500, lad, hs_bps=99.0, obi_now=0.8,
                        kappa_bps_per_s=0.1, v_rate_shares_per_s=100.0,
                        sigma_bps_per_s=2.0, rho=0.15, horizon_s=180.0, y_risk=1.0)
    assert e.e_is_bps == pytest.approx(lad.cost_vis_bps)
    assert e.sigma_is_bps == 0.0 and e.lo_bps == e.hi_bps == e.e_is_bps
    assert e.w_vis == 1.0 and e.w_res == 0.0 and e.w_unf == 0.0
    assert e.tau_s == 0.0 and not e.flags


def test_expected_is_beyond_book_hand_computed():
    """Q=7000, sổ 6000 → phần dư 1000 cp; v=100 cp/s, ρ=0.15 → τ=66.667s.

    E = w_vis·cost_vis + w_res·(hs + s·μ·τ/2)
    μ = κ·OBI = 0.1×0.5 = 0.05 bps/s ; s = −1 ; hs = 10 bps
    σ_IS = Y·σ·sqrt(w_res²·τ/3)
    """
    lad = ladder_walk(-1, 7000, PRICES, VOLS, MID)
    e = expected_is_bps(-1, 7000, lad, hs_bps=10.0, obi_now=0.5,
                        kappa_bps_per_s=0.1, v_rate_shares_per_s=100.0,
                        sigma_bps_per_s=2.0, rho=0.15, horizon_s=180.0,
                        y_risk=1.5, pi_z=1.6449)
    tau = 1000 / (0.15 * 100)
    w_vis, w_res = 6000 / 7000, 1000 / 7000
    mu = 0.1 * 0.5
    exp = w_vis * lad.cost_vis_bps + w_res * (10.0 + (-1) * mu * tau / 2)
    sig = 1.5 * 2.0 * math.sqrt(w_res ** 2 * tau / 3)
    assert e.tau_s == pytest.approx(tau)
    assert e.e_is_bps == pytest.approx(exp)
    assert e.sigma_is_bps == pytest.approx(sig)
    assert e.lo_bps == pytest.approx(exp - 1.6449 * sig)
    assert e.hi_bps == pytest.approx(exp + 1.6449 * sig)
    assert e.w_unf == 0.0 and not e.flags


def test_expected_is_horizon_capped_marks_unfilled():
    """Lệnh quá lớn so với thanh khoản nhịp → phần chưa khớp định giá theo mid."""
    lad = LadderResult(filled_vis=1000, qty_res=99_000, vwap_vis=100.0,
                       cost_vis_bps=50.0, coverage=0.01)
    e = expected_is_bps(-1, 100_000, lad, hs_bps=10.0, obi_now=0.0,
                        kappa_bps_per_s=0.1, v_rate_shares_per_s=10.0,
                        sigma_bps_per_s=2.0, rho=0.15, horizon_s=180.0, y_risk=1.0)
    assert "HORIZON_CAPPED" in e.flags
    filled_res = 0.15 * 10 * 180
    assert e.w_res == pytest.approx(filled_res / 100_000)
    assert e.w_unf == pytest.approx(99_000 / 100_000 - filled_res / 100_000)
    assert e.tau_s == 180.0
    assert e.w_vis + e.w_res + e.w_unf == pytest.approx(1.0)


def test_expected_is_no_liquidity_profile_flag():
    lad = LadderResult(1000, 1000, 100.0, 50.0, 0.5)
    e = expected_is_bps(-1, 2000, lad, 10.0, 0.0, 0.1, 0.0, 2.0, 0.15, 180.0, 1.0)
    assert "NO_LIQUIDITY_PROFILE" in e.flags
    assert e.w_unf == 1.0 and e.w_res == 0.0


def test_expected_is_no_book_returns_nan_not_zero():
    lad = ladder_walk(-1, 100, [], [], MID)
    e = expected_is_bps(-1, 100, lad, 10.0, 0.0, 0.1, 10.0, 2.0, 0.15, 180.0, 1.0)
    assert "NO_BOOK" in e.flags and np.isnan(e.e_is_bps)


def test_expected_is_missing_sigma_flags_and_zero_risk():
    lad = LadderResult(1000, 1000, 100.0, 50.0, 0.5)
    e = expected_is_bps(-1, 2000, lad, 10.0, 0.0, 0.1, 100.0, np.nan, 0.15, 180.0, 1.0)
    assert "NO_VOL_ESTIMATE" in e.flags and e.sigma_is_bps == 0.0


def test_pi_width_grows_with_order_size_square_root_law():
    """Rủi ro thời điểm tăng theo √τ — định luật căn bậc hai phải XUẤT HIỆN
    từ giao thức, không bị áp đặt: gấp 4 lần phần dư → σ tăng ~2 lần."""
    sig = []
    for q_res in (1000.0, 4000.0):
        lad = LadderResult(1000, q_res, 100.0, 50.0, 1000 / (1000 + q_res))
        e = expected_is_bps(-1, 1000 + q_res, lad, 10.0, 0.0, 0.1, 100.0, 2.0,
                            0.15, 1e9, 1.0)
        sig.append(e.sigma_is_bps)
    # w_res khác nhau nên không đúng bằng 2, nhưng phải tăng đơn điệu và
    # gần bậc hai khi w_res → 1 (lệnh rất lớn so với sổ)
    assert sig[1] > sig[0]
    big = []
    for q_res in (1e6, 4e6):
        lad = LadderResult(1.0, q_res, 100.0, 50.0, 1.0 / (1.0 + q_res))
        e = expected_is_bps(-1, 1 + q_res, lad, 10.0, 0.0, 0.1, 100.0, 2.0,
                            0.15, 1e12, 1.0)
        big.append(e.sigma_is_bps)
    assert big[1] / big[0] == pytest.approx(2.0, rel=1e-3)


def test_trading_costs_vn_tax_only_on_sell():
    buy = trading_costs_bps(1e9, +1, 0.0015, 0.001)
    sell = trading_costs_bps(1e9, -1, 0.0015, 0.001)
    assert buy["fee_vnd"] == pytest.approx(1.5e6) and buy["tax_vnd"] == 0.0
    assert sell["fee_vnd"] == pytest.approx(1.5e6) and sell["tax_vnd"] == pytest.approx(1e6)
    assert sell["fee_bps"] == pytest.approx(15.0) and sell["tax_bps"] == pytest.approx(10.0)
