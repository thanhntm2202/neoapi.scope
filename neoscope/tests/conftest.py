"""Fixtures dùng chung — dữ liệu kiểm thử TỰ SINH, tách biệt dữ liệu dự án.

Nguyên tắc: unit test không đọc/ghi vào data/ của dự án; mọi test cần ổ đĩa
đều dùng tmp_path. Nhờ vậy `pytest` chạy được trên máy người chấm ngay cả
khi chưa sinh bộ SYNTHETIC đầy đủ.
"""
from __future__ import annotations

import copy
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from neoscope.config import load_settings
from neoscope.constants import VN_TZ, bucket_of_time
from neoscope.finance.microstructure import add_microstructure_cols

REPO_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session")
def settings():
    return load_settings()


@pytest.fixture
def tmp_settings(tmp_path):
    """Settings trỏ data/results vào thư mục tạm — không đụng dữ án dự án."""
    s = load_settings()
    data = copy.deepcopy(s.as_dict())
    data["paths"]["data_dir"] = str(tmp_path / "data")
    data["paths"]["results_dir"] = str(tmp_path / "data" / "results")
    from neoscope.config import Settings
    return Settings(data, s.source)


@pytest.fixture
def small_settings(tmp_path):
    """Bộ mô phỏng THU NHỎ (2 mã, 1 phiên) cho test tích hợp nhanh.

    Vẫn dùng đúng SessionSimulator của dự án — không mock logic tài chính.
    """
    s = load_settings()
    data = copy.deepcopy(s.as_dict())
    data["paths"]["data_dir"] = str(tmp_path / "data")
    data["paths"]["results_dir"] = str(tmp_path / "data" / "results")
    data["watchlist"] = {"large": ["HPG"], "thin": ["PDR"]}
    data["synth"]["n_sessions"] = 1
    from neoscope.config import Settings
    return Settings(data, s.source)


def raw_rec(seq: int, ts: datetime, payload: dict, channel: str = "stockInfo") -> dict:
    return {"seq": seq, "arrival_ts": ts.isoformat(), "channel": channel, "data": payload}


def payload(symbol: str = "HPG", bid=(100.0, 99.0, 98.0), ask=(102.0, 103.0, 104.0),
            bvol=(1000, 2000, 3000), avol=(500, 500, 1000), cum_vol: int = 10_000,
            cum_val: int = 1_000_000_000, **extra) -> dict:
    """Canonical stockInfo fixture (string book prices exercise safe parsing)."""
    p: dict = {
        "symbol": symbol, "refPrice": 100.0, "ceilingPrice": 107.0, "floorPrice": 93.0,
        "bidPrice1": f"{bid[0]:.1f}", "bidPrice2": bid[1], "bidPrice3": bid[2],
        "askPrice1": f"{ask[0]:.1f}", "askPrice2": ask[1], "askPrice3": ask[2],
        "bidVol1": bvol[0], "bidVol2": bvol[1], "bidVol3": bvol[2],
        "askVol1": avol[0], "askVol2": avol[1], "askVol3": avol[2],
        "closePrice": 101.0, "closeVol": 100, "openPrice": 100.0,
        "highPrice": 102.0, "lowPrice": 99.0, "averagePrice": 100.5,
        "totalTradingVolume": cum_vol, "totalTradingValue": cum_val,
        "totalBidQTTY": sum(bvol) * 2, "totalAskQTTY": sum(avol) * 2,
        "foreignBuyVolume": 0, "foreignSellVolume": 0,
        "foreignBuyValue": 0, "foreignSellValue": 0, "foreignNetValue": 0,
        "foreignRemain": 1_000_000, "foreignRoom": 5_000_000,
    }
    p.update(extra)
    return p


def snap_row(ts: pd.Timestamp, symbol: str = "HPG", *, bid=(100.0, 99.0, 98.0),
             ask=(102.0, 103.0, 104.0), bvol=(1000, 2000, 3000), avol=(500, 500, 1000),
             d_vol: float = 1000.0, d_val: float = 1e8, d_f_buy_val: float = 0.0,
             d_f_sell_val: float = 0.0, flags=(), session_date: str = "2026-11-03",
             group: str = "large", cum_vol: float = 1e6, cum_val: float = 1e11) -> dict:
    row = {
        "ts": ts, "seq": 0, "symbol": symbol, "session_date": session_date, "group": group,
        "session": "LO_AM" if ts.hour < 12 else "LO_PM",
        "bid1": bid[0], "bid2": bid[1], "bid3": bid[2],
        "ask1": ask[0], "ask2": ask[1], "ask3": ask[2],
        "bidvol1": bvol[0], "bidvol2": bvol[1], "bidvol3": bvol[2],
        "askvol1": avol[0], "askvol2": avol[1], "askvol3": avol[2],
        "d_vol": d_vol, "d_val": d_val, "cum_vol": cum_vol, "cum_val": cum_val,
        "d_f_buy_val": d_f_buy_val, "d_f_sell_val": d_f_sell_val,
        "last_price": (bid[0] + ask[0]) / 2, "flags": list(flags), "n_flags": len(list(flags)),
        "ref": 100.0, "ceiling": 107.0, "floor": 93.0,
        "total_bid_qty": sum(bvol) * 2, "total_ask_qty": sum(avol) * 2,
        "f_remain": 1e6, "f_room": 5e6,
    }
    row["d_f_net_val"] = d_f_buy_val - d_f_sell_val
    return row


def snaps_frame(rows: list[dict]) -> pd.DataFrame:
    """Khung snapshot 'curated-like' đầy đủ chỉ báo + bucket (giống pipeline)."""
    df = pd.DataFrame(rows)
    df["ts"] = pd.to_datetime(df["ts"])
    if df["ts"].dt.tz is None:
        df["ts"] = df["ts"].dt.tz_localize(VN_TZ)
    df = add_microstructure_cols(df)
    df["bucket"] = df["ts"].dt.time.map(lambda t: bucket_of_time(t, 15))
    return df.sort_values(["symbol", "ts"]).reset_index(drop=True)


@pytest.fixture
def t0() -> pd.Timestamp:
    return pd.Timestamp("2026-11-03 10:00:00", tz=VN_TZ)


@pytest.fixture
def mini_snaps(t0) -> pd.DataFrame:
    """60 nhịp 5s của một mã, sổ lệnh không đổi — nền cho test tính tay."""
    rows = [snap_row(t0 + pd.Timedelta(seconds=5 * i), d_vol=1000.0, d_val=1.01e8)
            for i in range(60)]
    return snaps_frame(rows)


@pytest.fixture
def vn_dt():
    def _f(h: int, m: int, s: int = 0, day: int = 3) -> datetime:
        return datetime(2026, 11, day, h, m, s, tzinfo=VN_TZ)
    return _f
