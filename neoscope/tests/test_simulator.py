"""Buồng thử khớp lệnh: khớp tính tay, bảo toàn, phí/thuế, sinh lệnh tất định.

Buồng thử là 'nguồn sự thật thực hiện' của kiểm chứng ngoài mẫu — bản thân
nó phải được kiểm chứng bằng các ca tính tay được trước đã.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from neoscope.constants import VN_TZ
from neoscope.finance.execution import ladder_walk
from neoscope.simulator.matching import generate_orders, simulate_order

from .conftest import snap_row, snaps_frame

T0 = pd.Timestamp("2026-11-03 10:00:00", tz=VN_TZ)
FEE, TAX = 0.0015, 0.001


def _snaps(n: int = 60, d_vol: float = 1000.0) -> pd.DataFrame:
    """Sổ bid 100/99/98 × 1000/2000/3000, ask 102/103/104, mid 101 bất biến."""
    return snaps_frame([snap_row(T0 + pd.Timedelta(seconds=5 * i),
                                 d_vol=d_vol, d_val=d_vol * 101.0)
                        for i in range(n)])


def test_in_book_fill_equals_ladder_deterministically():
    snaps = _snaps()
    qty = 1500.0
    sim = simulate_order(snaps, T0, -1, qty, 0.15, 180.0, FEE, TAX)
    lad = ladder_walk(-1, qty, [100.0, 99.0, 98.0], [1000.0, 2000.0, 3000.0], 101.0)
    assert sim.ok and sim.filled_frac == pytest.approx(1.0)
    assert sim.n_steps == 0  # không cần tham gia thị trường
    assert sim.realized_is_bps == pytest.approx(lad.cost_vis_bps, rel=1e-12)
    expected = (101.0 - (1000 * 100 + 500 * 99) / 1500) / 101.0 * 1e4
    assert sim.realized_is_bps == pytest.approx(expected, rel=1e-9)
    # phí + thuế bán tính trên giá trị thực khớp
    executed = 1000 * 100 + 500 * 99
    assert sim.fee_vnd == pytest.approx(executed * FEE)
    assert sim.tax_vnd == pytest.approx(executed * TAX)


def test_beyond_book_participation_cap_hand_computed():
    snaps = _snaps()
    qty = 7000.0  # sổ bid chỉ có 6000 → dư 1000
    sim = simulate_order(snaps, T0, -1, qty, 0.15, 180.0, FEE, TAX)
    # mỗi nhịp hấp thụ tối đa 0.15×1000 = 150 cp tại bid1 = 100
    # 1000/150 → 7 nhịp (6×150 + 100), hoàn thành lúc 35s
    assert sim.n_steps == 7
    assert sim.exec_time_s == pytest.approx(35.0)
    assert sim.filled_frac == pytest.approx(1.0)
    notional = (1000 * 100 + 2000 * 99 + 3000 * 98) + 1000 * 100
    expected = (101.0 - notional / qty) / 101.0 * 1e4
    assert sim.realized_is_bps == pytest.approx(expected, rel=1e-9)
    assert sim.vwap_exec == pytest.approx(notional / qty, rel=1e-9)


def test_unfilled_marked_to_mid_with_flag():
    snaps = _snaps()
    qty = 7000.0
    sim = simulate_order(snaps, T0, -1, qty, 0.15, 10.0, FEE, TAX)  # chân trời 10s → 2 nhịp
    assert "UNFILLED_PARTIAL" in sim.flags
    assert sim.filled_frac == pytest.approx((6000 + 300) / qty)
    assert sim.unfilled_frac == pytest.approx(700 / qty)
    notional = (1000 * 100 + 2000 * 99 + 3000 * 98) + 300 * 100 + 700 * 101.0
    expected = (101.0 - notional / qty) / 101.0 * 1e4
    assert sim.realized_is_bps == pytest.approx(expected, rel=1e-9)
    # phí/thuế chỉ trên phần THỰC khớp (6300 cp), không trên phần định giá theo mid
    executed = (1000 * 100 + 2000 * 99 + 3000 * 98) + 300 * 100
    assert sim.fee_vnd == pytest.approx(executed * FEE)


def test_zero_liquidity_residual_is_opportunity_cost_not_free():
    snaps = _snaps(d_vol=0.0)
    qty = 7000.0
    sim = simulate_order(snaps, T0, -1, qty, 0.15, 180.0, FEE, TAX)
    assert sim.n_steps == 0
    assert sim.unfilled_frac == pytest.approx(1000 / qty)
    notional = (1000 * 100 + 2000 * 99 + 3000 * 98) + 1000 * 101.0
    expected = (101.0 - notional / qty) / 101.0 * 1e4
    assert sim.realized_is_bps == pytest.approx(expected, rel=1e-9)


def test_buy_side_mirror_and_tax_asymmetry():
    snaps = _snaps()
    qty = 1500.0  # ask 500+500+1000 = 2000 → khớp trọn: 500@102 + 500@103 + 500@104
    sim = simulate_order(snaps, T0, +1, qty, 0.15, 180.0, FEE, TAX)
    notional = 500 * 102 + 500 * 103 + 500 * 104
    expected = (notional / qty - 101.0) / 101.0 * 1e4
    assert sim.realized_is_bps == pytest.approx(expected, rel=1e-9)
    assert sim.tax_vnd == 0.0  # thuế TNCN chỉ áp phía BÁN
    assert sim.fee_vnd == pytest.approx(notional * FEE)


def test_no_arrival_snapshot_refuses_to_simulate():
    snaps = _snaps()
    sim = simulate_order(snaps, T0 - pd.Timedelta(seconds=10), -1, 1000.0,
                         0.15, 180.0, FEE, TAX)
    assert not sim.ok and "NO_ARRIVAL_SNAP" in sim.flags
    assert np.isnan(sim.realized_is_bps)


def test_generate_orders_deterministic_and_session_safe():
    # dựng phiên có cả sáng/chiều để kiểm tra loại lệnh bắc qua nghỉ trưa
    rows = []
    for start, minutes in (("09:15", 135), ("13:00", 90)):
        t = pd.Timestamp(f"2026-11-03 {start}:00", tz=VN_TZ)
        for i in range(minutes * 12):
            rows.append(snap_row(t + pd.Timedelta(seconds=5 * i)))
    session = snaps_frame(rows)
    kw = dict(symbols=["HPG"], orders_per_symbol=40, size_range_vnd=(5e7, 5e9),
              seed=123, horizon_s=180.0)
    o1 = generate_orders(session, **kw)
    o2 = generate_orders(session, **kw)
    pd.testing.assert_frame_equal(o1, o2)  # tất định theo seed
    o3 = generate_orders(session, **{**kw, "seed": 124})
    assert not o1["ts"].isin(o3["ts"]).all()
    assert (o1["qty_shares"] % 100 == 0).all()
    assert (o1["notional_vnd"] >= 5e7 * 0.9).all() and (o1["notional_vnd"] <= 5e9 * 1.1).all()
    from neoscope.constants import session_of_time
    for _, r in o1.iterrows():
        s0 = session_of_time(r["ts"].time())
        s1 = session_of_time((r["ts"] + pd.Timedelta(seconds=180)).time())
        assert s0 == s1 and s0 in {"LO_AM", "LO_PM"}  # không bắc qua nghỉ trưa
