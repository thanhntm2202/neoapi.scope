"""Kiểm thử TÍNH TAY các chỉ báo vi cấu trúc (Bloom: Vận dụng → Đánh giá).

Mỗi kỳ vọng đều tính bằng tay trong docstring, không lấy từ chính hàm đang
test (tránh 'test tự xác nhận'). Bổ sung các ca biên mà code sinh viên
thường vỡ: sổ trống một phía, trần/sàn, KL=0, NaN lan truyền.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from neoscope.finance.microstructure import (BPS, add_microstructure_cols,
                                             book_slope_bps_per_k, depth_hhi,
                                             depth_vnd, mid_price, microprice,
                                             obi, spread_bps)

from .conftest import snap_row, snaps_frame


def test_mid_and_spread_hand_computed():
    # m = (100 + 102)/2 = 101 ; s = 2/101 × 1e4 = 198.019801... bps
    assert mid_price(100.0, 102.0) == pytest.approx(101.0)
    assert spread_bps(100.0, 102.0) == pytest.approx(2 / 101 * BPS)


def test_spread_zero_when_locked_book():
    assert spread_bps(100.0, 100.0) == pytest.approx(0.0)


def test_spread_nan_when_one_side_missing():
    assert np.isnan(spread_bps(np.nan, 102.0))
    assert np.isnan(mid_price(100.0, np.nan))


def test_depth_vnd_hand_computed():
    # 100×1000 + 99×2000 + 98×3000 = 100000 + 198000 + 294000 = 592000 VND
    assert depth_vnd(100, 99, 98, 1000, 2000, 3000) == pytest.approx(592_000.0)


def test_depth_vnd_skips_missing_level_not_zero_fill():
    # thiếu mức 3 → chỉ cộng 2 mức đầu, KHÔNG coi mức thiếu là 0 rồi báo đủ sổ
    assert depth_vnd(100, 99, np.nan, 1000, 2000, 3000) == pytest.approx(298_000.0)
    assert np.isnan(depth_vnd(np.nan, np.nan, np.nan, 1, 2, 3))


def test_obi_hand_computed_and_bounds():
    # ΣV_bid = 6000, ΣV_ask = 2000 → (6000−2000)/8000 = 0.5
    assert obi(1000, 2000, 3000, 500, 500, 1000) == pytest.approx(0.5)
    assert obi(1, 0, 0, 0, 0, 0) == pytest.approx(1.0)   # trần: chỉ có dư mua
    assert obi(0, 0, 0, 1, 0, 0) == pytest.approx(-1.0)  # sàn: chỉ có dư bán
    assert np.isnan(obi(0, 0, 0, 0, 0, 0))              # sổ trống cả hai phía


def test_microprice_hand_computed():
    # (100×3000 + 102×1000)/(1000+3000) = 402000/4000 = 100.5
    assert microprice(100, 102, 1000, 3000) == pytest.approx(100.5)
    # dư mua dày → microprice > mid (kéo về phía bị 'ăn')
    assert microprice(100, 102, 3000, 1000) > mid_price(100, 102)


def test_hhi_hand_computed():
    # w = (1/6, 2/6, 3/6) → Σw² = (1+4+9)/36 = 0.388888...
    assert depth_hhi(1000, 2000, 3000) == pytest.approx(14 / 36)
    assert depth_hhi(1000, 1000, 1000) == pytest.approx(1 / 3)  # trải đều
    assert depth_hhi(1000, 0, 0) == pytest.approx(1.0)          # dồn một mức
    assert np.isnan(depth_hhi(0, 0, 0))


def test_book_slope_hand_computed():
    # |98 − 100|/101 × 1e4 = 198.0198 bps trên 6 nghìn cp → 33.0033 bps/nghìn cp
    assert book_slope_bps_per_k(100, 98, 101, 1000, 2000, 3000) == pytest.approx(
        (2 / 101 * BPS) / 6.0)
    assert np.isnan(book_slope_bps_per_k(100, np.nan, 101, 1000, 2000, 3000))


def test_vectorized_matches_scalar():
    b = np.array([100.0, 200.0, np.nan]); a = np.array([102.0, 202.0, 300.0])
    got = spread_bps(b, a)
    assert got[0] == pytest.approx(spread_bps(100.0, 102.0))
    assert got[1] == pytest.approx(spread_bps(200.0, 202.0))
    assert np.isnan(got[2])


def test_add_cols_nulls_book_indicators_on_invalid_flags(t0):
    """Sổ bắt chéo / ATO / ngoài biên độ → chỉ báo sổ lệnh phải NaN, không 'bịa'."""
    rows = [
        snap_row(t0, flags=()),
        snap_row(t0 + pd.Timedelta(seconds=5), flags=("CROSSED_BOOK",)),
        snap_row(t0 + pd.Timedelta(seconds=10), flags=("ATO_ATC",)),
        snap_row(t0 + pd.Timedelta(seconds=15), flags=("BEYOND_BAND",)),
        snap_row(t0 + pd.Timedelta(seconds=20), flags=("NULL_FIELD",)),
    ]
    df = snaps_frame(rows)
    assert np.isfinite(df.loc[0, "spread_bps"])
    for i in (1, 2, 3):
        assert np.isnan(df.loc[i, "mid"])
        assert np.isnan(df.loc[i, "spread_bps"])
        assert np.isnan(df.loc[i, "obi"])
    # NULL_FIELD (totalBidQTTY null) KHÔNG được phá chỉ báo sổ 3 mức
    assert np.isfinite(df.loc[4, "spread_bps"])


def test_add_cols_preserves_trade_fields_on_invalid_book(t0):
    df = snaps_frame([snap_row(t0, flags=("NO_BOOK",), d_vol=1234.0)])
    assert df.loc[0, "d_vol"] == 1234.0  # trường giao dịch giữ nguyên
