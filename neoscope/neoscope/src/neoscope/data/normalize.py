"""Chuẩn hóa thông điệp NEO API → bản ghi typed + cờ chất lượng + delta.

Xử lý mọi "bẫy" đã xác nhận trong docs chính thức:
- bidPrice1/askPrice1 là CHUỖI, có thể là "ATO"/"ATC";
- totalBidQTTY/totalAskQTTY có thể null;
- KL/GT giao dịch và dòng tiền ngoại là bộ đếm LŨY KẾ trong phiên
  → phải tự tính delta, phát hiện reset;
- timestamp không kèm múi giờ → chuẩn hóa Asia/Ho_Chi_Minh;
- thông điệp lặp / đến muộn / sai thứ tự / thiếu trường.

Thời điểm sự kiện: payload stockInfo KHÔNG có trường thời gian riêng,
nên dùng arrival_ts làm xấp xỉ thời điểm sự kiện (công bố trong từ điển
dữ liệu — sai số cỡ độ trễ mạng, chấp nhận được ở tần suất 5s).

Bộ đếm lũy kế được hiệu trên TRẠNG THÁI ĐƠN ĐIỆU (max đã thấy) sau khi
sắp xếp bản ghi theo arrival_ts: thông điệp mang bộ đếm cũ hơn state là
bằng chứng ĐẾN MUỘN (cờ LATE_ARRIVAL, delta NaN, không lùi state) —
tổng khối lượng được bảo toàn, không bịa nhịp âm. Reset thật (bộ đếm
về 0) tách riêng bằng cờ COUNTER_RESET. Thông điệp sai thứ tự arrival
được gắn cờ OUT_OF_ORDER ở tầng RAW trước khi sắp xếp.
"""
from __future__ import annotations

import hashlib
import json
from collections import deque
from datetime import datetime
from typing import Any

from ..constants import VN_TZ, session_of_time
from .quality import QF

PRICE_SENTINELS = {"ATO", "ATC", "MP", "MTL", "MOK", "MAK", "PLO"}


def parse_price(v: Any) -> tuple[float | None, str | None]:
    """Ép giá về float; trả (giá, cờ). Không bao giờ ném exception."""
    if v is None or v == "":
        return None, QF.NULL_FIELD
    if isinstance(v, (int, float)):
        return float(v), None
    s = str(v).strip().upper()
    if s in PRICE_SENTINELS:
        return None, QF.ATO_ATC
    try:
        return float(s), None
    except ValueError:
        return None, QF.PARSE_FAIL


def parse_num(v: Any) -> tuple[float | None, str | None]:
    if v is None or v == "":
        return None, QF.NULL_FIELD
    try:
        return float(v), None
    except (TypeError, ValueError):
        return None, QF.PARSE_FAIL


def _payload_hash(payload: dict[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()[:24]


class StockNormalizer:
    """Chuẩn hóa luồng stockInfo theo thứ tự arrival, duy trì trạng thái theo mã.

    Trạng thái gồm: hash gần đây (khử lặp), bộ đếm lũy kế trước đó (delta),
    arrival_ts trước đó (phát hiện sai thứ tự / khoảng trống).
    """

    def __init__(self, stale_gap_s: float = 30.0, dedup_window: int = 5):
        self.stale_gap_s = stale_gap_s
        self.dedup_window = dedup_window
        self._state: dict[str, dict[str, Any]] = {}

    def _st(self, symbol: str) -> dict[str, Any]:
        return self._state.setdefault(
            symbol,
            {
                "hashes": deque(maxlen=self.dedup_window),
                "cum_vol": None,
                "cum_val": None,
                "f_buy_val": None,
                "f_sell_val": None,
                "last_ts": None,
            },
        )

    @staticmethod
    def _delta(cur: float | None, state: float | None, flags: list[str]) -> tuple[float | None, bool]:
        """Delta trên trạng thái LŨY KẾ ĐƠN ĐIỆU (state = max đã thấy).

        Bộ đếm của sàn không giảm trong phiên. Nếu cur < state thì thông
        điệp này mang trạng thái CŨ hơn một bản ghi đã thấy → bằng chứng
        nó ĐẾN MUỘN so với thứ tự sự kiện (arrival_ts không phải thời điểm
        sự kiện thật). Xử lý trung thực: gắn cờ LATE_ARRIVAL, delta = NaN
        (không bịa nhịp âm/không), KHÔNG lùi state — phần khối lượng của
        thông điệp muộn được hấp thụ vào delta kế tiếp (bảo toàn tổng).
        cur == 0 với state > 0 là chữ ký RESET thật (phiên mới/lỗi nguồn).
        Trả về (delta, is_reset).
        """
        if cur is None or state is None:
            return None, False  # thiếu/nhịp đầu: không suy được delta
        if cur < state:
            if cur == 0:
                flags.append(QF.COUNTER_RESET)
                return None, True
            flags.append(QF.LATE_ARRIVAL)
            return None, False
        return cur - state, False

    @staticmethod
    def _advance(state: float | None, cur: float | None, is_reset: bool) -> float | None:
        """Cập nhật state đơn điệu; reset thật đưa state về giá trị mới."""
        if cur is None:
            return state
        if state is None or is_reset:
            return cur
        return max(state, cur)

    def normalize(self, rec: dict[str, Any]) -> dict[str, Any] | None:
        """Trả về dòng curated, hoặc None nếu là bản ghi lặp (bị loại)."""
        payload = rec["data"]
        symbol = payload.get("symbol")
        if not symbol:
            return None
        st = self._st(symbol)
        flags: list[str] = []

        ts = datetime.fromisoformat(rec["arrival_ts"])
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=VN_TZ)
        ts = ts.astimezone(VN_TZ)

        # --- khử lặp theo hash payload trong cửa sổ trượt ---
        h = _payload_hash(payload)
        if h in st["hashes"]:
            flags.append(QF.DUPLICATE)
            return None
        st["hashes"].append(h)

        # --- sai thứ tự / khoảng trống ---
        # Cờ sai thứ tự được gắn ở tầng RAW (pipeline) trước khi sắp xếp theo
        # thời điểm sự kiện; ở đây chỉ đọc lại bằng chứng, không suy diễn lại.
        if rec.get("_out_of_order"):
            flags.append(QF.OUT_OF_ORDER)
        if st["last_ts"] is not None:
            if ts < st["last_ts"]:
                flags.append(QF.OUT_OF_ORDER)
            else:
                sess = session_of_time(ts.time())
                prev_sess = session_of_time(st["last_ts"].time())
                # Khoảng trống CHỈ là bất thường khi nằm TRONG cùng một phiên
                # liên tục. Nhịp bắc qua nghỉ trưa / ATO→LO là lịch giao dịch,
                # không phải mất dữ liệu — gắn cờ ở đó sẽ tạo dương tính giả.
                if (sess in {"LO_AM", "LO_PM"} and prev_sess == sess
                        and (ts - st["last_ts"]).total_seconds() > self.stale_gap_s):
                    flags.append(QF.STALE_GAP)
        st["last_ts"] = max(ts, st["last_ts"]) if st["last_ts"] else ts

        row: dict[str, Any] = {
            "ts": ts,
            "seq": rec["seq"],
            "symbol": symbol,
            "session": session_of_time(ts.time()),
        }

        # --- giá tham chiếu / trần / sàn ---
        for src, dst in (("refPrice", "ref"), ("ceilingPrice", "ceiling"), ("floorPrice", "floor")):
            val, fl = parse_num(payload.get(src))
            row[dst] = val
            if fl and src != "refPrice":
                flags.append(fl)

        # --- sổ lệnh 3 mức ---
        for side in ("bid", "ask"):
            for i in (1, 2, 3):
                p, pf = parse_price(payload.get(f"{side}Price{i}"))
                v, vf = parse_num(payload.get(f"{side}Vol{i}"))
                row[f"{side}{i}"] = p
                row[f"{side}vol{i}"] = v
                if pf == QF.ATO_ATC:
                    flags.append(QF.ATO_ATC)
                elif pf:
                    flags.append(pf)
                if i > 1 and (p is None or v is None) and pf != QF.ATO_ATC:
                    flags.append(QF.MISSING_LEVEL)

        # --- giá khớp / OHLC ---
        for src, dst in (
            ("closePrice", "last_price"), ("closeVol", "last_vol"),
            ("openPrice", "open"), ("highPrice", "high"),
            ("lowPrice", "low"), ("averagePrice", "avg_price"),
        ):
            val, fl = parse_num(payload.get(src))
            row[dst] = val

        # --- bộ đếm lũy kế → delta (state đơn điệu, chống thông điệp muộn) ---
        cum_vol, f1 = parse_num(payload.get("totalTradingVolume"))
        cum_val, f2 = parse_num(payload.get("totalTradingValue"))
        row["cum_vol"], row["cum_val"] = cum_vol, cum_val
        row["d_vol"], reset_v = self._delta(cum_vol, st["cum_vol"], flags)
        row["d_val"], reset_a = self._delta(cum_val, st["cum_val"], flags)
        st["cum_vol"] = self._advance(st["cum_vol"], cum_vol, reset_v)
        st["cum_val"] = self._advance(st["cum_val"], cum_val, reset_a)

        # --- tổng cung/cầu hiển thị (có thể null trong payload thật) ---
        tbq, ftb = parse_num(payload.get("totalBidQTTY"))
        taq, fta = parse_num(payload.get("totalAskQTTY"))
        row["total_bid_qty"], row["total_ask_qty"] = tbq, taq
        if ftb:
            flags.append(QF.NULL_FIELD)
        if fta:
            flags.append(QF.NULL_FIELD)

        # --- dòng tiền ngoại (lũy kế) → delta ---
        fbv, _ = parse_num(payload.get("foreignBuyValue"))
        fsv, _ = parse_num(payload.get("foreignSellValue"))
        fnv, _ = parse_num(payload.get("foreignNetValue"))
        row["f_buy_val"], row["f_sell_val"], row["f_net_val"] = fbv, fsv, fnv
        row["d_f_buy_val"], reset_fb = self._delta(fbv, st["f_buy_val"], flags)
        row["d_f_sell_val"], reset_fs = self._delta(fsv, st["f_sell_val"], flags)
        st["f_buy_val"] = self._advance(st["f_buy_val"], fbv, reset_fb)
        st["f_sell_val"] = self._advance(st["f_sell_val"], fsv, reset_fs)
        fbvol, _ = parse_num(payload.get("foreignBuyVolume"))
        fsvol, _ = parse_num(payload.get("foreignSellVolume"))
        row["f_buy_vol"], row["f_sell_vol"] = fbvol, fsvol
        frem, _ = parse_num(payload.get("foreignRemain"))
        froom, _ = parse_num(payload.get("foreignRoom"))
        row["f_remain"], row["f_room"] = frem, froom

        # --- kiểm tra hợp lệ miền giá trị ---
        b1, a1 = row.get("bid1"), row.get("ask1")
        if b1 is not None and a1 is not None:
            if b1 >= a1 and row["session"] in {"LO_AM", "LO_PM"}:
                flags.append(QF.CROSSED_BOOK)
            lo, hi = row.get("floor"), row.get("ceiling")
            if lo is not None and hi is not None and not (lo <= b1 <= hi and lo <= a1 <= hi):
                flags.append(QF.BEYOND_BAND)
        if row.get("bid1") is None and row.get("ask1") is None:
            flags.append(QF.NO_BOOK)

        row["flags"] = sorted(set(flags))
        row["n_flags"] = len(row["flags"])
        return row


def normalize_index_record(rec: dict[str, Any]) -> dict[str, Any] | None:
    """marketInfo: indexValue là chuỗi; indexTime+dateString ghép thành ts UTC+7.

    Mọi trường số được ép kiểu phòng thủ (API thật có thể trả chuỗi cho
    totalVolume/totalValue/advances... — cùng một họ bẫy với indexValue).
    """
    p = rec["data"]
    flags: list[str] = []
    iv, fl = parse_num(p.get("indexValue"))
    if fl:
        flags.append(fl)
    ts = None
    try:
        d, t = p.get("dateString"), p.get("indexTime")
        if d and t:
            ts = datetime.fromisoformat(f"{d}T{t}").replace(tzinfo=VN_TZ)
    except ValueError:
        flags.append(QF.PARSE_FAIL)
    if ts is None:
        ts = datetime.fromisoformat(rec["arrival_ts"]).astimezone(VN_TZ)
        flags.append(QF.NULL_FIELD)

    def _num(key: str) -> float | None:
        v, f = parse_num(p.get(key))
        if f == QF.PARSE_FAIL:
            flags.append(QF.PARSE_FAIL)
        return v

    return {
        "ts": ts,
        "seq": rec["seq"],
        "index_code": p.get("indexCode"),
        "index_value": iv,
        "pct_change": _num("indexPercentChange"),
        "cum_vol": _num("totalVolume"),
        "cum_val": _num("totalValue"),
        "market_status": p.get("marketStatus"),
        "advances": _num("advances"),
        "declines": _num("declines"),
        "no_change": _num("noChange"),
        "n_ceiling": _num("numberOfCe"),
        "n_floor": _num("numberOfFl"),
        "flags": sorted(set(flags)),
    }
