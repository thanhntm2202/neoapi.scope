"""Alert engine: cổng kích hoạt tính tay, không nhìn trước, tương đương ngữ nghĩa.

Bộ tích lũy baseline incremental (v1.1.0, tối ưu RAM) phải cho KẾT QUẢ
GIỐNG HỆT đường tham chiếu build_baseline() dựng lại từ toàn bộ phiên trước.
Test này khóa lời hứa đó — mọi tối ưu bộ nhớ sau này phải vượt qua nó.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from neoscope.analytics.alerts import (METRICS, _gate_ok, _priority, _transform,
                                       build_baseline, run_alerts)
from neoscope.constants import VN_TZ

from .conftest import snap_row, snaps_frame

DATES = ["2026-11-03", "2026-11-04", "2026-11-05"]
N_TICKS = 180  # 15 phút, một bucket 40


@pytest.mark.parametrize(("pct", "direction", "expected"), [
    (0.999, "high", "P1"),
    (0.995, "high", "P2"),
    (0.990, "high", "P3"),
    (0.001, "low", "P1"),
    (0.005, "low", "P2"),
    (0.010, "low", "P3"),
])
def test_alert_priority_is_empirical_tail_rank(pct, direction, expected):
    assert _priority(pct, direction) == expected


def _make_snaps(dates=DATES, seed=11, spike: dict | None = None) -> pd.DataFrame:
    """Hai mã × N_TICKS nhịp/phiên; metric kiểm soát hoàn toàn bằng rngseed.

    spike: cấu hình bơm bất thường vào phiên CUỐI, ví dụ
    {"symbol": "HPG", "col": "spread_bps", "start": 60, "n": 10, "value": 100.0}
    """
    rng = np.random.default_rng(seed)
    rows = []
    for ds in dates:
        y, m, d = map(int, ds.split("-"))
        t0 = pd.Timestamp(year=y, month=m, day=d, hour=10, tz=VN_TZ)
        for sym, grp in (("HPG", "large"), ("PDR", "thin")):
            for i in range(N_TICKS):
                rows.append(snap_row(t0 + pd.Timedelta(seconds=5 * i), sym,
                                     session_date=ds, group=grp,
                                     d_vol=1000.0, d_val=1e8))
    df = snaps_frame(rows)
    # ghi đè metric có kiểm soát (alert engine chỉ đọc các cột này)
    base_spread = df["symbol"].map({"HPG": 10.0, "PDR": 30.0})
    df["spread_bps"] = base_spread + rng.normal(0, 0.3, len(df))
    df["depth_bid_vnd"] = np.exp(rng.normal(np.log(3e8), 0.2, len(df)))
    df["obi"] = rng.uniform(-0.3, 0.3, len(df))
    df["d_vol"] = rng.poisson(1000, len(df)).astype(float)
    net = np.where(rng.random(len(df)) < 0.05, 1e6, 0.0) * rng.choice([-1, 1], len(df))
    df["d_f_net_val"] = net
    if spike:
        last = df["session_date"] == dates[-1]
        m = last & (df["symbol"] == spike["symbol"])
        idx = df.index[m][spike["start"]:spike["start"] + spike["n"]]
        df.loc[idx, spike["col"]] = spike["value"]
    return df


def _reference_alerts(settings, snaps: pd.DataFrame) -> pd.DataFrame:
    """Đường tham chiếu: dựng lại baseline TỪ ĐẦU mỗi phiên bằng build_baseline.

    Độc lập với bộ tích lũy incremental của run_alerts; cùng công thức
    μ/σ/p99 và cùng cổng/persistence/cooldown (dùng chung _gate_ok).
    """
    cfg = settings.alerts
    dates = sorted(snaps["session_date"].unique())
    out = []
    for i, ds in enumerate(dates):
        if i < int(cfg.warmup_sessions):
            continue
        train = snaps[snaps["session_date"].isin(dates[:i])]
        day = snaps[snaps["session_date"] == ds]
        for atype in cfg.types:
            spec = METRICS[atype]
            pooled = spec.get("pool") == "symbol"
            persist = int(spec["persist"] if spec["persist"] is not None else cfg.persistence_n)
            baseline = build_baseline(train, atype)
            for sym, g in day.groupby("symbol"):
                g = g.sort_values("ts")
                vals = _transform(g[spec["col"]].to_numpy(dtype=float), spec["tf"])
                streak, last_fire = 0, None
                for j, (_, row) in enumerate(g.iterrows()):
                    key = (sym, "ALL" if pooled else int(row["bucket"]))
                    b = baseline.get(key)
                    trig = False
                    z = pct = np.nan
                    if b is not None and np.isfinite(vals[j]):
                        z = (vals[j] - b["mu"]) / b["sigma"]
                        pct = float(np.searchsorted(b["sorted"], vals[j], side="right")) / b["n"]
                        trig = _gate_ok(vals[j], z, pct, b, spec["dir"], spec["gate"],
                                        float(cfg.z_threshold), float(cfg.pct_threshold),
                                        float(cfg.foreign_tail_mult))
                    if not trig:
                        streak = 0
                        continue
                    streak += 1
                    if streak < persist:
                        continue
                    ts_j = pd.Timestamp(row["ts"])
                    if last_fire is not None and ts_j - last_fire < pd.Timedelta(seconds=float(cfg.cooldown_s)):
                        continue
                    last_fire, streak = ts_j, 0
                    out.append({"session_date": ds, "symbol": sym, "ts": ts_j,
                                "type": atype, "z": z, "pct": pct})
    return pd.DataFrame(out)


def _keyset(df: pd.DataFrame) -> set:
    return {(r.session_date, r.symbol, str(r.ts), r.type) for r in df.itertuples()}


def test_warmup_session_has_no_alerts(settings):
    snaps = _make_snaps(spike={"symbol": "HPG", "col": "spread_bps", "start": 60, "n": 10, "value": 200.0})
    alerts = run_alerts(settings, snaps)
    assert not alerts.empty
    assert (alerts["session_date"] != DATES[0]).all()


def test_no_lookahead_truncation_invariance(settings):
    """Cắt bỏ tương lai không được làm đổi cảnh báo của quá khứ."""
    spike = {"symbol": "HPG", "col": "spread_bps", "start": 60, "n": 10, "value": 200.0}
    snaps_full = _make_snaps(spike=spike)
    full = run_alerts(settings, snaps_full)
    trunc_snaps = snaps_full[snaps_full["session_date"].isin(DATES[:2])].copy()
    trunc = run_alerts(settings, trunc_snaps)
    a = full[full["session_date"].isin(DATES[:2])]
    assert _keyset(a) == _keyset(trunc)


def test_hand_computed_spread_gate(settings):
    """Spread 10→100 bps: z khổng lồ, pct=1.0, dai dẳng 3 → đúng 1 cảnh báo
    (cooldown 60s chặn các nhịp kế tiếp trong chuỗi 10 nhịp)."""
    snaps = _make_snaps()
    # baseline spread hằng số để tính tay được
    snaps["spread_bps"] = snaps["symbol"].map({"HPG": 10.0, "PDR": 30.0})
    last = snaps["session_date"] == DATES[-1]
    idx = snaps.index[last & (snaps["symbol"] == "HPG")][60:70]
    snaps.loc[idx, "spread_bps"] = 100.0
    alerts = run_alerts(settings, snaps)
    sp = alerts[(alerts["type"] == "SPREAD_WIDEN") & (alerts["symbol"] == "HPG")]
    assert len(sp) == 1
    a = sp.iloc[0]
    assert a["session_date"] == DATES[-1]
    assert a["pct"] == 1.0 and a["z"] > 3.0
    assert int(a["n_train"]) == 2 * N_TICKS
    # fires tại nhịp thứ 3 của chuỗi spike (persistence=3)
    assert pd.Timestamp(a["ts"]) == snaps.loc[idx[2], "ts"]


def test_persistence_blocks_short_spike(settings):
    snaps = _make_snaps()
    snaps["spread_bps"] = snaps["symbol"].map({"HPG": 10.0, "PDR": 30.0})
    last = snaps["session_date"] == DATES[-1]
    idx = snaps.index[last & (snaps["symbol"] == "HPG")][60:62]  # chỉ 2 nhịp < 3
    snaps.loc[idx, "spread_bps"] = 100.0
    alerts = run_alerts(settings, snaps)
    assert alerts[alerts["type"] == "SPREAD_WIDEN"].empty


def test_cooldown_spacing(settings):
    snaps = _make_snaps()
    snaps["spread_bps"] = snaps["symbol"].map({"HPG": 10.0, "PDR": 30.0})
    last = snaps["session_date"] == DATES[-1]
    idx = snaps.index[last & (snaps["symbol"] == "HPG")][60:100]  # 40 nhịp = 200s
    snaps.loc[idx, "spread_bps"] = 100.0
    alerts = run_alerts(settings, snaps)
    sp = alerts[(alerts["type"] == "SPREAD_WIDEN") & (alerts["symbol"] == "HPG")].sort_values("ts")
    assert len(sp) == 4  # fires tại +10s, +70s, +130s, +190s
    gaps = sp["ts"].diff().dropna().dt.total_seconds()
    assert (gaps >= 60.0).all()


def test_foreign_tail_gate_on_zero_inflated(settings):
    """|net|=5 triệu ≥ 2×p99(phần khác 0 ≈ 1 triệu) → bắn; 1.5 triệu → không."""
    snaps = _make_snaps()
    last = snaps["session_date"] == DATES[-1]
    hpg = snaps.index[last & (snaps["symbol"] == "HPG")]
    snaps.loc[hpg[60], "d_f_net_val"] = 5e6
    snaps.loc[hpg[80], "d_f_net_val"] = -5e6
    snaps.loc[hpg[100], "d_f_net_val"] = 1.5e6  # dưới cổng đuôi
    alerts = run_alerts(settings, snaps)
    fb = alerts[(alerts["type"] == "FOREIGN_BURST") & (alerts["symbol"] == "HPG")]
    assert len(fb) == 2
    assert set(fb["value"]) == {5e6}
    assert (fb["pct"] >= 0.99).all()


def test_obi_gate_is_percentile_not_z(settings):
    """OBI bị chặn [−1,1]: giá trị 0.35 hiếm (pct≈1) nhưng z<3 vẫn phải bắn —
    chứng minh cổng phân vị thuần cho biến bị chặn (docs/thresholds.md)."""
    snaps = _make_snaps()  # obi nền ~ U(-0.3, 0.3): mu|obi|≈0.15, sd≈0.17
    last = snaps["session_date"] == DATES[-1]
    idx = snaps.index[last & (snaps["symbol"] == "HPG")][60:63]
    snaps.loc[idx, "obi"] = 0.35
    alerts = run_alerts(settings, snaps)
    ob = alerts[(alerts["type"] == "OBI_EXTREME") & (alerts["symbol"] == "HPG")]
    assert len(ob) >= 1
    assert (ob["z"].abs() < 3.0).any()  # bắn nhờ phân vị, KHÔNG nhờ z
    assert (ob["pct"] >= 0.99).all()


def test_incremental_equals_reference_baseline(settings):
    """Tương đương ngữ nghĩa: incremental (run_alerts) == build_baseline tham chiếu."""
    snaps = _make_snaps(seed=29, spike={"symbol": "PDR", "col": "depth_bid_vnd",
                                        "start": 40, "n": 12, "value": 1e6})
    got = run_alerts(settings, snaps)
    ref = _reference_alerts(settings, snaps)
    assert _keyset(got) == _keyset(ref)
    mg = got.merge(ref, on=["session_date", "symbol", "ts", "type"], suffixes=("_g", "_r"))
    assert len(mg) == len(got) == len(ref)
    np.testing.assert_allclose(mg["z_g"], mg["z_r"], rtol=1e-9, atol=1e-9)
    np.testing.assert_allclose(mg["pct_g"], mg["pct_r"], rtol=1e-9, atol=1e-9)


def test_depth_evaporation_uses_log_scale(settings):
    """Bốc hơi độ sâu 3e8 → 1e6: phát hiện trên thang log (z đủ âm)."""
    snaps = _make_snaps(spike={"symbol": "PDR", "col": "depth_bid_vnd",
                               "start": 50, "n": 12, "value": 1e6})
    alerts = run_alerts(settings, snaps)
    de = alerts[(alerts["type"] == "DEPTH_EVAPORATION") & (alerts["symbol"] == "PDR")]
    assert len(de) >= 1
    assert (de["scale"] == "log").all()
    assert (de["z"] <= -3.0).all()
