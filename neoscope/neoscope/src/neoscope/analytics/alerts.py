"""Alert engine — ngưỡng SUY TỪ THỐNG KÊ, không đặt tùy ý.

Cơ sở (docs/thresholds.md):
- Thanh khoản nội ngày hình chữ U → mọi chuẩn hóa theo bucket 15 phút
  giờ-trong-phiên, baseline từ CÁC PHIÊN TRƯỚC (expanding, không nhìn trước).
- Kích hoạt đồng thời: |z| >= 3 VÀ vượt phân vị 99% thực nghiệm CỦA CHÍNH
  MÃ × BUCKET VÀ dai dẳng >= N tick; cooldown 60s chống spam.
  (z-score một mình không đủ vì phân phối thanh khoản đuôi dày — phân vị
  thực nghiệm là lớp bảo vệ phi tham số.)
- LỰA CHỌN THANG ĐO THEO PHÂN PHỐI (biện giải trong docs/thresholds.md):
  * DEPTH_EVAPORATION chuẩn hóa trên thang LOG vì độ sâu tiền phân phối
    log-normal (tích các mức log-normal) → z trên thang thô bị σ phình to,
    không bao giờ chạm −3; log đưa về gần Gauss, phát hiện đúng cú bốc hơi.
  * OBI_EXTREME dùng CỔNG PHÂN VỊ thuần (bỏ z) vì OBI bị chặn [−1,1] —
    z Gauss >= 3 gần như bất khả thi với biến bị chặn; phân vị thực nghiệm
    là tiêu chí đúng cho biến bị chặn.
  * FOREIGN_BURST dùng CỔNG ĐUÔI: |net| >= foreign_tail_mult × p99 của
    phân phối bản ghi ngoại KHÁC 0 (mặc định 2×), dai dẳng N=1. Chuỗi dòng
    ngoại zero-inflated nên p99 toàn mẫu rất nhỏ; tính phân vị trên phần khác 0
    mới tách được burst cực đoan khỏi đuôi thường — ngưỡng suy từ phân phối.
- Mỗi cảnh báo mang EVIDENCE đầy đủ (giá trị, μ, σ, z, phân vị, n mẫu, thang đo)
  → người dùng bấm vào thấy 'vì sao', đúng yêu cầu diễn giải có trách nhiệm.
- Phiên warmup đầu tiên chỉ tích lũy baseline, không cảnh báo (công bố).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..config import Settings

# metric → đặc tả: cột nguồn, chiều bất thường, biến đổi thang đo, cổng kích hoạt,
# số tick dai dẳng (None = dùng cấu hình chung).
METRICS: dict[str, dict] = {
    "SPREAD_WIDEN":      {"col": "spread_bps",    "dir": "high", "tf": "raw", "gate": "z+pct", "persist": None},
    "DEPTH_EVAPORATION": {"col": "depth_bid_vnd", "dir": "low",  "tf": "log", "gate": "z+pct", "persist": None},
    "OBI_EXTREME":       {"col": "obi",           "dir": "high", "tf": "abs", "gate": "pct",   "persist": None},
    "TRADE_BURST":       {"col": "d_vol",         "dir": "high", "tf": "raw", "gate": "z+pct", "persist": None},
    "FOREIGN_BURST":     {"col": "d_f_net_val",   "dir": "high", "tf": "abs", "gate": "tail",  "persist": 1, "pool": "symbol"},
}


def _transform(v: np.ndarray, tf: str) -> np.ndarray:
    if tf == "abs":
        return np.abs(v)
    if tf == "log":
        return np.log1p(np.clip(v, 0.0, None))
    return v


def _metric_values(snaps: pd.DataFrame, alert_type: str) -> np.ndarray:
    spec = METRICS[alert_type]
    return _transform(snaps[spec["col"]].to_numpy(dtype=float), spec["tf"])


def build_baseline(train_snaps: pd.DataFrame, alert_type: str) -> dict:
    """Baseline theo symbol × bucket từ các phiên huấn luyện (trước phiên hiện tại)."""
    spec = METRICS[alert_type]
    df = train_snaps[["symbol", "bucket", spec["col"]]].copy()
    df[spec["col"]] = _transform(df[spec["col"]].to_numpy(dtype=float), spec["tf"])
    df = df.dropna()
    pooled = spec.get("pool") == "symbol"
    # FOREIGN_BURST gộp theo MÃ (không theo bucket): cổng đuôi cần p99 ổn định;
    # bucket thưa giữa phiên có p99≈0 → 3×0=0 → mọi bản ghi ngoại đều lọt (nhiễu).
    groups = df.groupby("symbol") if pooled else df.groupby(["symbol", "bucket"])
    out: dict = {}
    for key, g in groups:
        sym = key if pooled else key[0]
        bucket = "ALL" if pooled else int(key[1])
        vals = np.sort(g[spec["col"]].to_numpy(dtype=float))
        if len(vals) < 30:  # quá ít mẫu → không cảnh báo (công bố)
            continue
        mu = float(vals.mean())
        sd = float(vals.std(ddof=1))
        spread_iqr = float(np.quantile(vals, 0.95) - np.quantile(vals, 0.05))
        sigma_eff = max(sd, 0.05 * spread_iqr, 1e-9)  # sàn σ chống bucket suy biến
        # cổng đuôi FOREIGN tính trên phân phối bản ghi KHÁC 0 (chuỗi zero-inflated
        # có p99 toàn mẫu rất nhỏ → bội số của nó vẫn lọt đuôi thường).
        nz = vals[vals > 0]
        p99_tail = float(np.quantile(nz, 0.99)) if len(nz) >= 30 else float(np.quantile(vals, 0.99))
        out[(sym, bucket)] = {"sorted": vals, "mu": mu, "sigma": sigma_eff,
                              "p99": p99_tail, "n": len(vals)}
    return out


def run_alerts(settings: Settings, snaps_all: pd.DataFrame) -> pd.DataFrame:
    snaps_all = snaps_all.copy()
    if "d_f_net_val" not in snaps_all.columns:
        snaps_all["d_f_net_val"] = snaps_all["d_f_buy_val"] - snaps_all["d_f_sell_val"]
    cfg = settings.alerts
    z_thr = float(cfg.z_threshold)
    pct_thr = float(cfg.pct_threshold)
    tail_mult = float(cfg.get("foreign_tail_mult", 3.0))
    persist_default = int(cfg.persistence_n)
    cooldown = pd.Timedelta(seconds=float(cfg.cooldown_s))
    warmup = int(cfg.warmup_sessions)
    types = list(cfg.types)

    dates = sorted(snaps_all["session_date"].unique())
    alerts: list[dict] = []
    for i, ds in enumerate(dates):
        if i < warmup:
            continue
        train = snaps_all[snaps_all["session_date"].isin(dates[:i])]
        today = snaps_all[snaps_all["session_date"] == ds]
        for atype in types:
            spec = METRICS[atype]
            baseline = build_baseline(train, atype)
            if not baseline:
                continue
            direction, gate = spec["dir"], spec["gate"]
            pooled = spec.get("pool") == "symbol"
            persist_n = int(spec["persist"] if spec["persist"] is not None else persist_default)
            for sym, g in today.groupby("symbol"):
                g = g.sort_values("ts")
                vals = _metric_values(g, atype)
                buckets = g["bucket"].to_numpy()
                ts_arr = g["ts"].to_numpy()
                trig = np.zeros(len(g), dtype=bool)
                z_arr = np.full(len(g), np.nan)
                pct_arr = np.full(len(g), np.nan)
                mu_arr = np.full(len(g), np.nan)
                sd_arr = np.full(len(g), np.nan)
                n_arr = np.zeros(len(g), dtype=int)
                for j in range(len(g)):
                    b = baseline.get((sym, "ALL" if pooled else int(buckets[j])))
                    if b is None or not np.isfinite(vals[j]):
                        continue
                    z = (vals[j] - b["mu"]) / b["sigma"]
                    pct = float(np.searchsorted(b["sorted"], vals[j], side="right")) / b["n"]
                    if gate == "pct":
                        ok = pct >= pct_thr if direction == "high" else pct <= 1.0 - pct_thr
                    elif gate == "tail":
                        ok = vals[j] >= tail_mult * b["p99"] if direction == "high" else \
                             vals[j] <= -tail_mult * b["p99"]
                    else:
                        ok = (z >= z_thr and pct >= pct_thr) if direction == "high" else \
                             (z <= -z_thr and pct <= 1.0 - pct_thr)
                    trig[j] = ok
                    z_arr[j], pct_arr[j] = z, pct
                    mu_arr[j], sd_arr[j], n_arr[j] = b["mu"], b["sigma"], b["n"]
                # dai dẳng + cooldown
                streak = 0
                last_fire: pd.Timestamp | None = None
                for j in range(len(g)):
                    if not trig[j]:
                        streak = 0
                        continue
                    streak += 1
                    if streak < persist_n:
                        continue
                    ts_j = pd.Timestamp(ts_arr[j])
                    if last_fire is not None and ts_j - last_fire < cooldown:
                        continue
                    last_fire = ts_j
                    streak = 0
                    raw_v = g.iloc[j]
                    alerts.append({
                        "session_date": ds, "symbol": sym,
                        "group": settings.group_of(sym),
                        "ts": ts_j, "type": atype, "direction": direction,
                        "scale": spec["tf"],
                        "value": float(vals[j]),
                        "signed_value": float(raw_v[spec["col"]]) if pd.notna(raw_v[spec["col"]]) else np.nan,
                        "mu": mu_arr[j], "sigma": sd_arr[j], "z": z_arr[j],
                        "pct": pct_arr[j], "bucket": int(buckets[j]), "n_train": int(n_arr[j]),
                    })
    return pd.DataFrame(alerts)
