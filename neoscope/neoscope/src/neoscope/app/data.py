"""Lớp dữ liệu của dashboard — nạp có kiểm soát bộ nhớ, cache theo phiên.

Nguyên tắc:
- Chỉ nạp các cột cần cho hiển thị (khung snapshot đầy đủ 56 cột không
  được giữ trong tiến trình Streamlit — môi trường 1 GiB RAM).
- Mọi dấu thời gian hiển thị theo Asia/Ho_Chi_Minh (UTC+7).
- Tham số ước tính thực thi lấy từ FOLD walk-forward tương ứng phiên đang
  xem — không bao giờ dùng tham số fit trên chính phiên đó (chống nhìn trước).
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd
import streamlit as st

from ..config import load_settings
from ..data.store import list_session_dirs, read_manifest, read_parquet, session_date_of

SNAP_COLS = ["ts", "seq", "symbol", "session_date", "session", "group", "bucket",
             "mid", "spread_bps", "depth_bid_vnd", "depth_ask_vnd", "obi",
             "microprice", "hhi_bid", "hhi_ask", "d_vol", "d_val", "d_f_net_val",
             "bid1", "bid2", "bid3", "ask1", "ask2", "ask3",
             "bidvol1", "bidvol2", "bidvol3", "askvol1", "askvol2", "askvol3",
             "last_price", "cum_vol", "cum_val", "f_remain", "f_room",
             "flags", "n_flags", "ref", "ceiling", "floor"]


def settings():
    return load_settings()


@st.cache_data(show_spinner="Nạp dữ liệu curated…")
def load_snaps(mode: str, config_hash: str) -> pd.DataFrame:
    s = settings()
    frames = []
    for d in list_session_dirs(s.data_path(), mode):
        p = s.data_path("curated", d.name, "snapshots.parquet")
        if p.exists():
            df = read_parquet(p)
            keep = [c for c in SNAP_COLS if c in df.columns]
            frames.append(df[keep])
    if not frames:
        return pd.DataFrame(columns=SNAP_COLS)
    out = pd.concat(frames, ignore_index=True)
    return out.sort_values(["session_date", "symbol", "ts"]).reset_index(drop=True)


@st.cache_data(show_spinner=False)
def load_bars(mode: str, config_hash: str) -> pd.DataFrame:
    s = settings()
    frames = []
    for d in list_session_dirs(s.data_path(), mode):
        p = s.data_path("curated", d.name, "bars.parquet")
        if p.exists():
            frames.append(read_parquet(p))
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


@st.cache_data(show_spinner=False)
def load_indices(mode: str, config_hash: str) -> pd.DataFrame:
    s = settings()
    frames = []
    for d in list_session_dirs(s.data_path(), mode):
        p = s.data_path("curated", d.name, "indices.parquet")
        if p.exists():
            frames.append(read_parquet(p))
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


@st.cache_data(show_spinner=False)
def load_quality(mode: str, config_hash: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    s = settings()
    q, m = [], []
    for d in list_session_dirs(s.data_path(), mode):
        for name, acc in (("quality.parquet", q), ("quality_meta.parquet", m)):
            p = s.data_path("curated", d.name, name)
            if p.exists():
                acc.append(read_parquet(p))
    return (pd.concat(q, ignore_index=True) if q else pd.DataFrame(),
            pd.concat(m, ignore_index=True) if m else pd.DataFrame())


@st.cache_data(show_spinner=False)
def load_result(name: str, config_hash: str) -> pd.DataFrame:
    s = settings()
    p = s.results_path(name)
    return read_parquet(p) if p.exists() else pd.DataFrame()


@st.cache_data(show_spinner=False)
def load_summary(config_hash: str) -> dict:
    s = settings()
    p = s.results_path("summary.json")
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


@st.cache_data(show_spinner=False)
def session_manifests(mode: str, config_hash: str) -> list[dict]:
    s = settings()
    out = []
    for d in list_session_dirs(s.data_path(), mode):
        man = read_manifest(d)
        out.append({"session_dir": d.name, "date": session_date_of(d), **man})
    return out


def sessions_of(snaps: pd.DataFrame) -> list[str]:
    return sorted(snaps["session_date"].unique().tolist()) if len(snaps) else []


def fold_params_for(fold_params: pd.DataFrame, session_date: str,
                    test_dates: list[str]) -> tuple[pd.DataFrame, str]:
    """Chọn fold có tham số HỢP LỆ cho phiên đang xem (không nhìn trước).

    - Phiên là ngày test của fold k → dùng fold k (đúng giao thức ngoài mẫu).
    - Phiên thuộc tập huấn luyện → dùng fold ĐẦU TIÊN và ghi chú minh họa.
    - LIVE/chưa có fold → dùng fold cuối cùng (tham số mới nhất).
    """
    if fold_params.empty:
        return pd.DataFrame(), "Chưa có tham số hiệu chỉnh — chạy `neoscope validate`."
    folds = sorted(fold_params["fold"].unique())
    if session_date in test_dates:
        k = folds[test_dates.index(session_date)]
        note = f"Tham số fold {k}: huấn luyện trên các phiên TRƯỚC {session_date} (ngoài mẫu đúng nghĩa)."
    elif session_date in set(fold_params["test_date"]):
        k = int(fold_params.loc[fold_params["test_date"] == session_date, "fold"].iloc[0])
        note = f"Tham số fold {k} (phiên này là ngày test của fold đó)."
    else:
        k = folds[0]
        note = (f"⚠️ Phiên {session_date} nằm trong tập huấn luyện của mọi fold — "
                f"dùng tham số fold {k} sớm nhất chỉ để MINH HỌA, không phải kết quả ngoài mẫu.")
    return fold_params[fold_params["fold"] == k], note


@lru_cache(maxsize=8)
def _volume_profile_cached(mode: str, config_hash: str, train_dates_key: tuple) -> dict:
    from ..analytics.calibration import volume_profile
    bars = load_bars(mode, config_hash)
    tr = bars[bars["session_date"].isin(train_dates_key)]
    return volume_profile(tr)


def volume_profile_for(mode: str, config_hash: str, train_dates: list[str]) -> dict:
    return _volume_profile_cached(mode, config_hash, tuple(sorted(train_dates)))


def sigma_fallback_for(mode: str, config_hash: str, train_dates: list[str]) -> dict:
    from ..analytics.calibration import sigma_fallback
    bars = load_bars(mode, config_hash)
    return sigma_fallback(bars[bars["session_date"].isin(train_dates)])


def fmt_vnd(x: float) -> str:
    if x is None or not np.isfinite(x):
        return "—"
    if abs(x) >= 1e9:
        return f"{x/1e9:,.2f} tỷ"
    if abs(x) >= 1e6:
        return f"{x/1e6:,.1f} triệu"
    return f"{x:,.0f}"


def freshness(snaps: pd.DataFrame) -> str:
    if snaps.empty:
        return "chưa có dữ liệu"
    ts = snaps["ts"].max()
    return pd.Timestamp(ts).strftime("%H:%M:%S %d/%m/%Y (UTC+7)")
