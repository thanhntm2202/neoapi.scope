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
    phân phối bản ghi ngoại KHÁC 0 (cấu hình: 2×, biện giải docs/thresholds.md),
    dai dẳng N=1. Chuỗi dòng ngoại zero-inflated nên p99 toàn mẫu rất nhỏ;
    tính phân vị trên phần khác 0 mới tách được burst cực đoan khỏi đuôi
    thường — ngưỡng suy từ phân phối.
- Mỗi cảnh báo mang EVIDENCE đầy đủ (giá trị, μ, σ, z, phân vị, n mẫu, thang đo)
  → người dùng bấm vào thấy 'vì sao', đúng yêu cầu diễn giải có trách nhiệm.
- Phiên warmup đầu tiên chỉ tích lũy baseline, không cảnh báo (công bố).

KỸ THUẬT (v1.1.0 — sửa lỗi OOM): baseline expanding được duy trì bằng các
khối mảng float hẹp theo (mã × bucket), KHÔNG sao chép toàn bộ khung
snapshot theo từng phiên × loại cảnh báo. Ngữ nghĩa thống kê giữ nguyên
100% (baseline = toàn bộ phiên trước, cùng công thức μ/σ/p99), nhưng bộ
nhớ đỉnh giảm từ O(n_types × n_sessions × khung_đầy_đủ) xuống O(khung_hẹp)
— chạy được trong môi trường 1 GiB RAM (có test tương đương ngữ nghĩa).
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


def _summarize(sorted_vals: np.ndarray) -> dict:
    """Tóm tắt baseline từ mảng ĐÃ SẮP XẾP — một công thức duy nhất cho mọi đường gọi."""
    mu = float(sorted_vals.mean())
    sd = float(sorted_vals.std(ddof=1))
    spread_iqr = float(np.quantile(sorted_vals, 0.95) - np.quantile(sorted_vals, 0.05))
    sigma_eff = max(sd, 0.05 * spread_iqr, 1e-9)  # sàn σ chống bucket suy biến
    # cổng đuôi FOREIGN tính trên phân phối bản ghi KHÁC 0 (chuỗi zero-inflated
    # có p99 toàn mẫu rất nhỏ → bội số của nó vẫn lọt đuôi thường).
    nz = sorted_vals[sorted_vals > 0]
    p99_tail = float(np.quantile(nz, 0.99)) if len(nz) >= 30 else float(np.quantile(sorted_vals, 0.99))
    return {"sorted": sorted_vals, "mu": mu, "sigma": sigma_eff,
            "p99": p99_tail, "n": len(sorted_vals)}


def build_baseline(train_snaps: pd.DataFrame, alert_type: str) -> dict:
    """Baseline theo symbol × bucket từ các phiên huấn luyện (trước phiên hiện tại).

    Giữ lại làm API tham chiếu (dùng trong test tương đương ngữ nghĩa).
    Đường chạy chính trong run_alerts dùng bộ tích lũy incremental tương đương.
    """
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
        out[(sym, bucket)] = _summarize(vals)
    return out


def _gate_ok(vals_j: float, z: float, pct: float, b: dict,
             direction: str, gate: str, z_thr: float, pct_thr: float,
             tail_mult: float) -> bool:
    if gate == "pct":
        return pct >= pct_thr if direction == "high" else pct <= 1.0 - pct_thr
    if gate == "tail":
        return vals_j >= tail_mult * b["p99"] if direction == "high" else \
            vals_j <= -tail_mult * b["p99"]
    return (z >= z_thr and pct >= pct_thr) if direction == "high" else \
        (z <= -z_thr and pct <= 1.0 - pct_thr)


def _priority(pct: float, direction: str) -> str:
    """Rank a triggered event by its empirical tail rarity, not by loss probability."""
    tail_pct = pct if direction == "high" else 1.0 - pct
    if tail_pct >= 0.999:
        return "P1"
    if tail_pct >= 0.995:
        return "P2"
    return "P3"


def run_alerts(settings: Settings, snaps_all: pd.DataFrame) -> pd.DataFrame:
    """Quét expanding theo phiên — baseline chỉ từ quá khứ, bằng chứng đầy đủ.

    Bộ nhớ: chỉ giữ khung HẸP (các cột metric + khóa) và các khối giá trị
    float theo khóa; không sao chép khung snapshot đầy đủ.
    """
    cfg = settings.alerts
    z_thr = float(cfg.z_threshold)
    pct_thr = float(cfg.pct_threshold)
    tail_mult = float(cfg.get("foreign_tail_mult", 3.0))
    persist_default = int(cfg.persistence_n)
    cooldown = pd.Timedelta(seconds=float(cfg.cooldown_s))
    warmup = int(cfg.warmup_sessions)
    types = list(cfg.types)

    # ---- khung hẹp: chỉ cột cần cho mọi loại cảnh báo ----
    metric_cols = sorted({METRICS[t]["col"] for t in types})
    need = ["symbol", "session_date", "bucket", "ts"] + metric_cols
    extra: list[str] = []
    if "d_f_net_val" in metric_cols and "d_f_net_val" not in snaps_all.columns:
        extra = ["d_f_buy_val", "d_f_sell_val"]
    df = snaps_all[need + extra].copy()
    if extra:
        df["d_f_net_val"] = df["d_f_buy_val"] - df["d_f_sell_val"]
        df = df.drop(columns=extra)
    df = df.sort_values(["session_date", "symbol", "ts"]).reset_index(drop=True)

    dates = sorted(df["session_date"].unique())
    ds_arr = df["session_date"].to_numpy()
    sym_arr = df["symbol"].to_numpy()
    bucket_arr = df["bucket"].to_numpy()
    ts_arr = df["ts"].to_numpy()
    raw_vals = {t: df[METRICS[t]["col"]].to_numpy(dtype=float) for t in types}
    vals_map = {t: _transform(raw_vals[t], METRICS[t]["tf"]) for t in types}
    day_idx = {ds: np.where(ds_arr == ds)[0] for ds in dates}
    day_syms = {ds: pd.unique(sym_arr[day_idx[ds]]) for ds in dates}
    sym_idx = {(ds, sym): day_idx[ds][sym_arr[day_idx[ds]] == sym]
               for ds in dates for sym in day_syms[ds]}

    # lịch sử giá trị theo khóa — mỗi phiên góp một khối (expanding, không nhìn trước)
    hist: dict[str, dict[tuple, list[np.ndarray]]] = {t: {} for t in types}
    hist_n: dict[str, dict[tuple, int]] = {t: {} for t in types}

    def _keys_of(atype: str, idx: np.ndarray) -> dict[tuple, np.ndarray]:
        spec = METRICS[atype]
        v = vals_map[atype][idx]
        ok = np.isfinite(v)
        idx, v = idx[ok], v[ok]
        if spec.get("pool") == "symbol":
            return {(str(sym_arr[idx[0]]), "ALL"): v} if len(idx) else {}
        out: dict[tuple, np.ndarray] = {}
        b = bucket_arr[idx]
        for ub in np.unique(b):
            m = b == ub
            out[(str(sym_arr[idx[0]]), int(ub))] = v[m]
        return out

    alerts: list[dict] = []
    for i, ds in enumerate(dates):
        if i >= warmup:
            for atype in types:
                spec = METRICS[atype]
                pooled = spec.get("pool") == "symbol"
                persist_n = int(spec["persist"] if spec["persist"] is not None else persist_default)
                baseline: dict[tuple, dict] = {}
                for key, chunks in hist[atype].items():
                    if hist_n[atype][key] < 30:
                        continue
                    baseline[key] = _summarize(np.sort(np.concatenate(chunks)))
                if not baseline:
                    continue
                direction, gate = spec["dir"], spec["gate"]
                vals = vals_map[atype]
                raw = raw_vals[atype]
                for sym in day_syms[ds]:
                    idx = sym_idx[(ds, sym)]  # đã sắp theo ts
                    v = vals[idx]
                    bs = bucket_arr[idx]
                    tss = ts_arr[idx]
                    trig = np.zeros(len(idx), dtype=bool)
                    z_arr = np.full(len(idx), np.nan)
                    pct_arr = np.full(len(idx), np.nan)
                    for j in range(len(idx)):
                        b = baseline.get((sym, "ALL" if pooled else int(bs[j])))
                        if b is None or not np.isfinite(v[j]):
                            continue
                        z = (v[j] - b["mu"]) / b["sigma"]
                        pct = float(np.searchsorted(b["sorted"], v[j], side="right")) / b["n"]
                        trig[j] = _gate_ok(v[j], z, pct, b, direction, gate, z_thr, pct_thr, tail_mult)
                        z_arr[j], pct_arr[j] = z, pct
                    # dai dẳng + cooldown
                    streak = 0
                    last_fire: pd.Timestamp | None = None
                    for j in range(len(idx)):
                        if not trig[j]:
                            streak = 0
                            continue
                        streak += 1
                        if streak < persist_n:
                            continue
                        ts_j = pd.Timestamp(tss[j])
                        if last_fire is not None and ts_j - last_fire < cooldown:
                            continue
                        last_fire = ts_j
                        streak = 0
                        gj = idx[j]
                        b = baseline[(sym, "ALL" if pooled else int(bs[j]))]
                        alerts.append({
                            "session_date": ds, "symbol": sym,
                            "group": settings.group_of(sym),
                            "ts": ts_j, "type": atype, "direction": direction,
                            "priority": _priority(float(pct_arr[j]), direction),
                            "scale": spec["tf"],
                            "value": float(v[j]),
                            "signed_value": float(raw[gj]) if np.isfinite(raw[gj]) else np.nan,
                            "mu": b["mu"], "sigma": b["sigma"],
                            "z": float(z_arr[j]), "pct": float(pct_arr[j]),
                            "bucket": int(bs[j]), "n_train": int(b["n"]),
                        })
        # nạp phiên hiện tại vào lịch sử SAU khi đánh giá (không tự nhìn mình)
        for atype in types:
            for sym in day_syms[ds]:
                for key, chunk in _keys_of(atype, sym_idx[(ds, sym)]).items():
                    hist[atype].setdefault(key, []).append(chunk)
                    hist_n[atype][key] = hist_n[atype].get(key, 0) + len(chunk)
    if not alerts:
        # khung rỗng vẫn mang ĐỦ schema — tầng trên (UI/test) không phải
        # phòng thủ KeyError khi không có cảnh báo nào.
        return pd.DataFrame(columns=[
            "session_date", "symbol", "group", "ts", "type", "direction", "priority",
            "scale", "value", "signed_value", "mu", "sigma", "z", "pct",
            "bucket", "n_train"])
    return pd.DataFrame(alerts)
