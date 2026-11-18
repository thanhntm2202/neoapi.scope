"""Regression checks for provider-independent canonical data edge cases.

Each case is either observed in market-data payloads or follows from the
canonical contract (cumulative counters, timestamps without zones). Expected
không chỉ 'không crash' mà là HÀNH VI ĐÚNG: gắn cờ, giữ NaN, bảo toàn tổng.
"""
from __future__ import annotations

from datetime import timedelta

import numpy as np
import pytest

from neoscope.constants import VN_TZ
from neoscope.data.normalize import (StockNormalizer, normalize_index_record,
                                     parse_num, parse_price)
from neoscope.data.quality import QF

from .conftest import payload, raw_rec


# ------------------------------------------------------------------ parse
def test_parse_price_string_as_in_official_payload():
    assert parse_price("29750.0") == (29750.0, None)


def test_parse_price_ato_atc_sentinels():
    for s in ("ATO", "ATC", "ato", " MP ", "MTL", "PLO"):
        v, flag = parse_price(s)
        assert v is None and flag == QF.ATO_ATC


def test_parse_price_null_and_garbage():
    assert parse_price(None) == (None, QF.NULL_FIELD)
    assert parse_price("") == (None, QF.NULL_FIELD)
    assert parse_price("không phải số") == (None, QF.PARSE_FAIL)
    assert parse_price(12345) == (12345.0, None)


def test_parse_num_never_raises():
    assert parse_num("1234.5") == (1234.5, None)
    assert parse_num(None) == (None, QF.NULL_FIELD)
    assert parse_num({"a": 1}) == (None, QF.PARSE_FAIL)


# ------------------------------------------------------------------ traps
def test_null_total_bid_qty_is_flagged_not_zero_filled(vn_dt):
    n = StockNormalizer()
    row = n.normalize(raw_rec(1, vn_dt(10, 0), payload(totalBidQTTY=None, totalAskQTTY=None)))
    assert row["total_bid_qty"] is None and row["total_ask_qty"] is None
    assert QF.NULL_FIELD in row["flags"]
    # chỉ báo sổ 3 mức vẫn tính được — null ở trường tổng không phá sổ
    assert row["bid1"] == 100.0


def test_ato_price_flagged_and_book_not_fabricated(vn_dt):
    n = StockNormalizer()
    row = n.normalize(raw_rec(1, vn_dt(9, 5), payload(bidPrice1="ATO", askPrice1="ATC")))
    assert QF.ATO_ATC in row["flags"]
    assert row["bid1"] is None and row["ask1"] is None


def test_duplicate_payload_dropped_within_window(vn_dt):
    n = StockNormalizer(dedup_window=5)
    p = payload()
    assert n.normalize(raw_rec(1, vn_dt(10, 0), p)) is not None
    assert n.normalize(raw_rec(2, vn_dt(10, 0, 5), dict(p))) is None  # lặp → loại


def test_duplicate_outside_window_is_kept(vn_dt):
    n = StockNormalizer(dedup_window=2)
    p = payload()
    n.normalize(raw_rec(1, vn_dt(10, 0), p))
    for i in range(2, 5):
        n.normalize(raw_rec(i, vn_dt(10, 0, i), payload(cum_vol=10_000 + i)))
    # hash đã rời cửa sổ → bản ghi giống lại được nhận (không khử lặp vĩnh viễn)
    assert n.normalize(raw_rec(9, vn_dt(10, 1), dict(p))) is not None


def test_cumulative_counters_produce_deltas(vn_dt):
    n = StockNormalizer()
    r1 = n.normalize(raw_rec(1, vn_dt(10, 0), payload(cum_vol=1000, cum_val=100_000)))
    r2 = n.normalize(raw_rec(2, vn_dt(10, 0, 5), payload(cum_vol=1500, cum_val=160_000)))
    assert r1["d_vol"] is None            # nhịp đầu: không suy được delta
    assert r2["d_vol"] == 500 and r2["d_val"] == 60_000


def test_late_arrival_does_not_fabricate_negative_volume(vn_dt):
    """Bộ đếm lùi (không về 0) = thông điệp ĐẾN MUỘN, không phải 'nhịp âm'."""
    n = StockNormalizer()
    n.normalize(raw_rec(1, vn_dt(10, 0), payload(cum_vol=1000)))
    n.normalize(raw_rec(2, vn_dt(10, 0, 5), payload(cum_vol=2000)))
    late = n.normalize(raw_rec(3, vn_dt(10, 0, 10), payload(cum_vol=1500)))
    assert QF.LATE_ARRIVAL in late["flags"]
    assert late["d_vol"] is None
    nxt = n.normalize(raw_rec(4, vn_dt(10, 0, 15), payload(cum_vol=2600)))
    # state không lùi (vẫn 2000) → tổng khối lượng được bảo toàn: 600
    assert nxt["d_vol"] == 600


def test_true_counter_reset_is_separate_flag(vn_dt):
    n = StockNormalizer()
    n.normalize(raw_rec(1, vn_dt(10, 0), payload(cum_vol=5000)))
    reset = n.normalize(raw_rec(2, vn_dt(10, 0, 5), payload(cum_vol=0)))
    assert QF.COUNTER_RESET in reset["flags"] and reset["d_vol"] is None
    nxt = n.normalize(raw_rec(3, vn_dt(10, 0, 10), payload(cum_vol=300)))
    assert nxt["d_vol"] == 300  # state đã đặt lại theo phiên mới


def test_volume_conservation_over_late_and_duplicate_stream(vn_dt):
    """Tổng delta phải bằng tổng bộ đếm cuối − đầu, dù có muộn/lặp."""
    n = StockNormalizer()
    seq = [1000, 2000, 1500, 3000, 3000, 4200]  # 1500 muộn, 3000 lặp
    total = 0.0
    for i, cv in enumerate(seq):
        r = n.normalize(raw_rec(i + 1, vn_dt(10, 0, 5 * i), payload(cum_vol=cv)))
        if r is not None and r["d_vol"] is not None:
            total += r["d_vol"]
    assert total == pytest.approx(4200 - 1000)


def test_out_of_order_arrival_flagged(vn_dt):
    n = StockNormalizer()
    n.normalize(raw_rec(1, vn_dt(10, 0, 10), payload(cum_vol=1000)))
    r = n.normalize(raw_rec(2, vn_dt(10, 0, 0), payload(cum_vol=1100)))
    assert QF.OUT_OF_ORDER in r["flags"]


def test_raw_layer_out_of_order_marker_is_honoured(vn_dt):
    n = StockNormalizer()
    rec = raw_rec(1, vn_dt(10, 0), payload())
    rec["_out_of_order"] = True
    assert QF.OUT_OF_ORDER in n.normalize(rec)["flags"]


def test_stale_gap_flagged_only_in_continuous_session(vn_dt):
    n = StockNormalizer(stale_gap_s=30)
    n.normalize(raw_rec(1, vn_dt(10, 0), payload(cum_vol=1)))
    r = n.normalize(raw_rec(2, vn_dt(10, 2), payload(cum_vol=2)))
    assert QF.STALE_GAP in r["flags"]
    n2 = StockNormalizer(stale_gap_s=30)
    n2.normalize(raw_rec(1, vn_dt(11, 35), payload(cum_vol=1)))   # nghỉ trưa
    r2 = n2.normalize(raw_rec(2, vn_dt(13, 5), payload(cum_vol=2)))
    assert QF.STALE_GAP not in r2["flags"]


def test_crossed_book_flagged_in_lo_not_in_ato(vn_dt):
    n = StockNormalizer()
    r = n.normalize(raw_rec(1, vn_dt(10, 0), payload(bid=(105.0, 99, 98), ask=(102.0, 103, 104))))
    assert QF.CROSSED_BOOK in r["flags"]
    n2 = StockNormalizer()
    r2 = n2.normalize(raw_rec(1, vn_dt(9, 5), payload(bid=(105.0, 99, 98), ask=(102.0, 103, 104))))
    assert QF.CROSSED_BOOK not in r2["flags"]  # phiên ATO được phép bắt chéo


def test_beyond_price_band_flagged(vn_dt):
    n = StockNormalizer()
    r = n.normalize(raw_rec(1, vn_dt(10, 0), payload(bid=(120.0, 119, 118), ask=(121.0, 122, 123))))
    assert QF.BEYOND_BAND in r["flags"]


def test_missing_level3_flagged(vn_dt):
    n = StockNormalizer()
    p = payload()
    del p["bidVol3"]
    r = n.normalize(raw_rec(1, vn_dt(10, 0), p))
    assert QF.MISSING_LEVEL in r["flags"] and r["bidvol3"] is None


def test_no_book_flag_when_both_sides_absent(vn_dt):
    n = StockNormalizer()
    p = payload()
    for k in ("bidPrice1", "askPrice1"):
        p[k] = None
    r = n.normalize(raw_rec(1, vn_dt(10, 0), p))
    assert QF.NO_BOOK in r["flags"]


def test_record_without_symbol_is_rejected(vn_dt):
    n = StockNormalizer()
    p = payload()
    del p["symbol"]
    assert n.normalize(raw_rec(1, vn_dt(10, 0), p)) is None


# ------------------------------------------------------------------ timezone
def test_naive_timestamp_is_localized_to_vn(vn_dt):
    n = StockNormalizer()
    rec = raw_rec(1, vn_dt(10, 0), payload())
    rec["arrival_ts"] = "2026-11-03T10:00:00"  # không kèm múi giờ
    row = n.normalize(rec)
    assert str(row["ts"].tzinfo) == "Asia/Ho_Chi_Minh"
    assert row["ts"].hour == 10


def test_utc_timestamp_is_converted_to_vn(vn_dt):
    n = StockNormalizer()
    rec = raw_rec(1, vn_dt(10, 0), payload())
    rec["arrival_ts"] = "2026-11-03T03:00:00+00:00"  # 10:00 giờ VN
    row = n.normalize(rec)
    assert row["ts"].hour == 10 and row["ts"].utcoffset() == timedelta(hours=7)


def test_session_label_from_vn_time(vn_dt):
    n = StockNormalizer()
    assert n.normalize(raw_rec(1, vn_dt(9, 5), payload()))["session"] == "ATO"
    n = StockNormalizer()
    assert n.normalize(raw_rec(1, vn_dt(10, 0), payload()))["session"] == "LO_AM"
    n = StockNormalizer()
    assert n.normalize(raw_rec(1, vn_dt(14, 35), payload()))["session"] == "ATC"
    n = StockNormalizer()
    assert n.normalize(raw_rec(1, vn_dt(12, 0), payload()))["session"] == "LUNCH"


# ------------------------------------------------------------------ index
def test_index_value_string_parsed_and_ts_built(vn_dt):
    p = {"dateString": "2026-11-03", "indexCode": "VNINDEX", "indexValue": "1250.25",
         "indexTime": "10:00:00", "indexPercentChange": "0.52", "totalVolume": "123456",
         "totalValue": 9.9e12, "marketStatus": "LO", "advances": "180", "declines": 120,
         "noChange": 30, "numberOfCe": 3, "numberOfFl": 1}
    row = normalize_index_record(raw_rec(1, vn_dt(10, 0), p, channel="marketInfo"))
    assert row["index_value"] == pytest.approx(1250.25)
    assert row["pct_change"] == pytest.approx(0.52)
    assert row["advances"] == 180.0 and row["cum_vol"] == 123456.0
    assert row["ts"].hour == 10 and str(row["ts"].tzinfo) == "Asia/Ho_Chi_Minh"


def test_index_missing_time_falls_back_to_arrival_with_flag(vn_dt):
    p = {"indexCode": "VN30", "indexValue": "1310.5"}
    row = normalize_index_record(raw_rec(1, vn_dt(10, 30), p, channel="marketInfo"))
    assert QF.NULL_FIELD in row["flags"] and row["ts"].hour == 10


def test_index_bad_value_flagged_not_crash(vn_dt):
    p = {"dateString": "2026-11-03", "indexTime": "10:00:00", "indexCode": "VNINDEX",
         "indexValue": "N/A"}
    row = normalize_index_record(raw_rec(1, vn_dt(10, 0), p, channel="marketInfo"))
    assert row["index_value"] is None and QF.PARSE_FAIL in row["flags"]
