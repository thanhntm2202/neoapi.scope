"""Kịch bản thử lỗi CÓ CHỦ ĐÍCH trên tầng RAW → chuẩn hóa (chaos engineering).

Mỗi kịch bản tương ứng một tình huống đã xác nhận trong docs NEO API hoặc
một sự cố vận hành thật (mất kết nối, thông điệp lặp/muộn/sai thứ tự, reset
bộ đếm, sổ bắt chéo, giá ngoài biên độ, thiếu trường, sai kiểu).

Hàm `build_chaos_session` dựng một phiên RAW kiểm soát hoàn toàn với các
bẫy bơm tại vị trí biết trước; `EXPECTED_FLAGS` là số đếm KỲ VỌNG tính tay.
Test (tests/test_chaos.py) so khớp từng cờ; scripts/chaos_report.py dùng
cùng nguồn này để sinh docs/chaos_results.md — một nguồn sự thật duy nhất.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path

from neoscope.constants import VN_TZ
from neoscope.data.store import RawWriter

from .conftest import payload

N_TICKS = 60
INTERVAL_S = 5
T0 = datetime(2026, 11, 3, 10, 0, 0, tzinfo=VN_TZ)

# Bảng kịch bản: (vị trí, mô tả, hành vi mong đợi) — đưa thẳng vào báo cáo.
SCENARIO_TABLE: list[tuple[str, str, str]] = [
    ("i=12 (10:01:00)", "Thông điệp LẶP nguyên payload (duplicate)",
     "Loại khỏi curated, đếm vào n_duplicates_dropped; không nhân đôi khối lượng"),
    ("i=15 (10:01:15)", "bidPrice1/askPrice1 = 'ATO' giữa phiên LO (sai ngữ cảnh)",
     "Cờ ATO_ATC + NO_BOOK; mid/chỉ báo sổ lệnh = NaN, không ép số bừa"),
    ("i=18 (10:01:30)", "totalBidQTTY = null (bẫy thật trong payload HPG mẫu)",
     "Cờ NULL_FIELD; giữ NaN, không điền 0"),
    ("sau i=21", "Thông điệp ĐẾN MUỘN 10s, bộ đếm mang trạng thái cũ (i=15)",
     "Cờ LATE_ARRIVAL; delta NaN; state không lùi; tổng khối lượng bảo toàn"),
    ("i=22 (10:01:50)", "arrival_ts LÙI 8s so với thông điệp trước (sai thứ tự)",
     "Cờ OUT_OF_ORDER ở tầng RAW; sắp xếp lại theo (arrival, seq) trước khi tính delta"),
    ("i=30 (10:02:30)", "Sổ BẮT CHÉO: bid1=103 ≥ ask1=102 trong LO",
     "Cờ CROSSED_BOOK; chỉ báo sổ lệnh tại tick = NaN"),
    ("i=33 (10:02:45)", "Giá NGOÀI biên độ: bid1=120 > trần 107",
     "Cờ BEYOND_BAND; loại giá trị phạm lệ khỏi chỉ báo"),
    ("i=36 (10:03:00)", "THIẾU trường mức 3 (bidPrice3/bidVol3 vắng mặt)",
     "Cờ MISSING_LEVEL; độ sâu tính trên mức còn lại"),
    ("i=40..47", "MẤT KẾT NỐI 40s (không có thông điệp, bộ đếm vẫn tích lũy)",
     "Cờ STALE_GAP tại nhịp nối lại; delta hấp thụ toàn bộ khối lượng khoảng trống"),
    ("i=50 (10:04:10)", "SAI KIỂU: bidPrice2 = 'abc' (không ép được số)",
     "Cờ PARSE_FAIL + MISSING_LEVEL; giữ NaN"),
    ("i=59 (10:04:55)", "RESET bộ đếm lũy kế về 0 (phiên mới/lỗi nguồn)",
     "Cờ COUNTER_RESET; delta NaN; state đặt lại, không bịa nhịp âm"),
]

EXPECTED_FLAGS: dict[str, int] = {
    "ATO_ATC": 1,
    "NO_BOOK": 1,
    "NULL_FIELD": 2,  # i=18 totalBidQTTY null + i=36 thiếu bidPrice3 (parse null)
    "LATE_ARRIVAL": 1,
    "OUT_OF_ORDER": 1,
    "CROSSED_BOOK": 1,
    "BEYOND_BAND": 1,
    "MISSING_LEVEL": 2,
    "PARSE_FAIL": 1,
    "STALE_GAP": 1,
    "COUNTER_RESET": 1,
}
EXPECTED_DUPLICATES_DROPPED = 1
GAP_START, GAP_END = 40, 48  # [40, 48) không phát thông điệp


def _cum_vol(i: int) -> int:
    return 10_000 + 1_000 * i


def _cum_val(i: int) -> int:
    return 1_000_000_000 + 100_000_000 * i


def _ts(i: int) -> datetime:
    return T0 + timedelta(seconds=INTERVAL_S * i)


def _base_payload(i: int, **extra) -> dict:
    kw = {"closeVol": 100 + i}
    kw.update(extra)
    return payload("HPG", cum_vol=_cum_vol(i), cum_val=_cum_val(i), **kw)


def build_chaos_session(session_dir: Path) -> dict:
    """Ghi phiên RAW chaos có kiểm soát. Trả về thông tin đối chiếu bảo toàn."""
    w = RawWriter(session_dir, "SYNTHETIC", meta={"purpose": "chaos-test", "synthetic": True})
    prev: dict | None = None
    for i in range(N_TICKS):
        if GAP_START <= i < GAP_END:
            continue  # mất kết nối: bộ đếm sàn vẫn tích lũy
        p = _base_payload(i)
        arrival = _ts(i)

        if i == 12 and prev is not None:
            w.write("stockInfo", prev, arrival)  # lặp nguyên payload trước
        if i == 15:
            p["bidPrice1"] = "ATO"
            p["askPrice1"] = "ATO"
        elif i == 18:
            p["totalBidQTTY"] = None
        elif i == 30:
            p["bidPrice1"] = "103.0"
            p["askPrice1"] = "102.0"
        elif i == 33:
            p["bidPrice1"] = "120.0"
            p["askPrice1"] = "121.0"
        elif i == 36:
            p.pop("bidPrice3", None)
            p.pop("bidVol3", None)
        elif i == 50:
            p["bidPrice2"] = "abc"
        elif i == 59:
            p["totalTradingVolume"] = 0
            p["totalTradingValue"] = 0

        if i == 22:
            # Thông điệp sai thứ tự: arrival lùi 8s, bộ đếm bằng trạng thái i=21
            # (payload khác hash nhờ closeVol) — kiểm tra sắp xếp lại + cờ OOO.
            p = _base_payload(21, closeVol=888)
            arrival = _ts(21) - timedelta(seconds=3)
            w.write("stockInfo", p, arrival)
            prev = p
            continue

        w.write("stockInfo", p, arrival)
        prev = p

        if i == 21:
            # ĐẾN MUỘN: arrival +10s nhưng bộ đếm cũ của i=15 → LATE_ARRIVAL.
            late = _base_payload(15, closeVol=999)
            w.write("stockInfo", late, _ts(21) + timedelta(seconds=10))

    mp = w.close()
    return {
        "manifest": mp,
        "expected_vol_conservation": _cum_vol(58) - _cum_vol(0),
        "expected_val_conservation": _cum_val(58) - _cum_val(0),
    }
