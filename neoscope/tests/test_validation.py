"""Kiểm chứng ngoài mẫu: sai số, bootstrap cụm phiên, Wilson, độ phủ PI,
giá trị xây dựng LHS, sức dự báo OBI, precision/recall cảnh báo — tính tay.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest

from neoscope.analytics import validation as V
from neoscope.constants import VN_TZ


def _preds() -> pd.DataFrame:
    """2 mô hình × 2 nhóm × 2 lệnh; sai số chọn để tính tay được."""
    rows = []
    spec = {("full", "large"): ([1.0, -1.0], [0.0, 0.0]),
            ("full", "thin"): ([2.0, -2.0], [0.0, 0.0]),
            ("ladder_only", "large"): ([2.0, 4.0], [0.0, 0.0]),
            ("ladder_only", "thin"): ([6.0, 6.0], [0.0, 0.0])}
    for (model, grp), (errs, reals) in spec.items():
        for i, (e, r) in enumerate(zip(errs, reals)):
            rows.append({"model": model, "group": grp, "order_id": f"{model}-{grp}-{i}",
                         "session_date": "2026-11-10" if i == 0 else "2026-11-11",
                         "e_is_bps": e, "realized_is_bps": r,
                         "coverage": 1.0, "lo_bps": e, "hi_bps": e})
    return pd.DataFrame(rows)


def test_metrics_table_hand_computed():
    m = V.metrics_table(_preds()).set_index(["model", "group"])
    assert m.loc[("full", "large"), "mae_bps"] == pytest.approx(1.0)
    assert m.loc[("full", "large"), "bias_bps"] == pytest.approx(0.0)
    assert m.loc[("ladder_only", "large"), "mae_bps"] == pytest.approx(3.0)
    assert m.loc[("ladder_only", "large"), "rmse_bps"] == pytest.approx(np.sqrt(10.0))
    assert m.loc[("ladder_only", "large"), "bias_bps"] == pytest.approx(3.0)
    # ALL gộp 4 lệnh: full |e| = 1,1,2,2 → MAE 1.5; ladder 2,4,6,6 → 4.5
    assert m.loc[("full", "ALL"), "mae_bps"] == pytest.approx(1.5)
    assert m.loc[("ladder_only", "ALL"), "mae_bps"] == pytest.approx(4.5)


def test_session_bootstrap_clusters_by_session_not_order():
    preds = _preds()
    boot = V.session_bootstrap(preds, "full", "ladder_only", reps=500, seed=7)
    # loss theo phiên: full (1+2)/2=1.5 và (1+2)/2=1.5; ladder (2+6)/2=4 và (4+6)/2=5
    # Δ từng phiên = −2.5, −3.5 → trung bình −3.0; exact sign test with 2/2
    # negative session effects gives a discrete two-sided p-value of 0.5.
    assert boot["n_sessions"] == 2
    assert boot["delta_mae_bps"] == pytest.approx(-3.0)
    assert boot["per_session"]["2026-11-10"] == pytest.approx(-2.5)
    assert boot["per_session"]["2026-11-11"] == pytest.approx(-3.5)
    assert boot["ci95_lo"] >= -3.5 - 1e-9 and boot["ci95_hi"] <= -2.5 + 1e-9
    assert boot["p_two_sided"] == pytest.approx(0.5)
    # tái lập theo seed
    boot2 = V.session_bootstrap(preds, "full", "ladder_only", reps=500, seed=7)
    assert boot == boot2


def test_session_bootstrap_order_filter_applies_to_both_models():
    preds = _preds()
    keep = {"full-large-0", "ladder_only-large-0", "full-thin-1", "ladder_only-thin-1"}
    boot = V.session_bootstrap(preds, "full", "ladder_only", reps=200, seed=7, order_ids=keep)
    # phiên 10: full 1 vs ladder 2 → −1; phiên 11: full 2 vs ladder 6 → −4
    assert boot["per_session"]["2026-11-10"] == pytest.approx(-1.0)
    assert boot["per_session"]["2026-11-11"] == pytest.approx(-4.0)


def test_wilson_interval_hand_computed():
    lo, hi = V._wilson(90, 100)
    # công thức Wilson (1927) với z=1.96, p̂=0.9, n=100 — số đối chiếu công bố
    assert lo == pytest.approx(0.8256, abs=5e-4)
    assert hi == pytest.approx(0.9448, abs=5e-4)
    lo0, hi0 = V._wilson(0, 0)
    assert np.isnan(lo0) and np.isnan(hi0)


def _coverage_preds() -> pd.DataFrame:
    rows = []
    for i in range(4):  # trong sổ: PI suy biến, phủ tất định
        rows.append({"model": "full", "group": "large", "coverage": 1.0,
                     "e_is_bps": 5.0, "lo_bps": 5.0, "hi_bps": 5.0, "realized_is_bps": 5.0})
    for i, real in enumerate([9.0, 10.0, 11.0, 99.0]):  # vượt sổ: 3 phủ, 1 trượt
        rows.append({"model": "full", "group": "thin", "coverage": 0.5,
                     "e_is_bps": 10.0, "lo_bps": 8.0, "hi_bps": 12.0, "realized_is_bps": real})
    return pd.DataFrame(rows)


def test_pi_coverage_splits_degenerate_in_book_regime():
    cov = V.pi_coverage(_coverage_preds()).set_index("group")
    assert cov.loc["ALL", "coverage"] == pytest.approx(7 / 8)
    assert cov.loc["ALL:in_book", "coverage"] == pytest.approx(1.0)
    assert cov.loc["ALL:in_book", "mean_width_bps"] == pytest.approx(0.0)
    assert cov.loc["ALL:beyond_book", "coverage"] == pytest.approx(0.75)
    r = cov.loc["ALL:beyond_book"]
    assert r["wilson_lo"] < r["coverage"] < r["wilson_hi"]


def test_metrics_by_coverage_regime_assignment():
    preds = _coverage_preds()
    preds["model"] = "full"
    mc = V.metrics_by_coverage(preds).set_index(["model", "regime"])
    assert mc.loc[("full", "in_book"), "mae_bps"] == pytest.approx(0.0)
    # vượt sổ: |10−9|,|10−10|,|10−11|,|10−99| = 1,0,1,89 → MAE 22.75
    assert mc.loc[("full", "beyond_book"), "mae_bps"] == pytest.approx(22.75)


def _obi_bars(n: int = 120) -> pd.DataFrame:
    rng = np.random.default_rng(5)
    rows = []
    for sym in ("HPG", "PDR"):
        obi = rng.uniform(-1, 1, n)
        ret = np.empty(n)
        ret[0] = 0.0
        ret[1:] = 10.0 * obi[:-1]  # quan hệ đơn điệu tuyệt đối
        for i in range(n):
            rows.append({"symbol": sym, "session_date": "2026-11-10",
                         "bar_ts": pd.Timestamp("2026-11-10 10:00", tz=VN_TZ) + pd.Timedelta(minutes=i),
                         "obi_last": obi[i], "ret_bps": ret[i]})
    return pd.DataFrame(rows)


def test_obi_direction_quintiles_monotone_out_of_sample():
    tab = V.obi_direction_table(_obi_bars(), ["2026-11-10"])
    assert len(tab) == 5
    assert tab["mean_ret_bps"].is_monotonic_increasing
    assert tab.iloc[0]["p_up"] == pytest.approx(0.0)
    assert tab.iloc[-1]["p_up"] == pytest.approx(1.0)


def test_lhs_forward_ic_perfect_negative_by_construction():
    """8 mã: LHS = 100−10k, |ret| tương lai = k, d_val = 1 tỷ → IC = −1 chính xác."""
    rows = []
    for k in range(1, 9):
        for i in range(40):
            rows.append({"symbol": f"S{k}", "session_date": "2026-11-10",
                         "bar_ts": pd.Timestamp("2026-11-10 10:00", tz=VN_TZ) + pd.Timedelta(minutes=i),
                         "lhs": 100.0 - 10.0 * k, "ret_bps": float(k), "d_val": 1e9})
    ic = V.lhs_forward_ic(pd.DataFrame(rows), ["2026-11-10"])
    assert len(ic) == 1
    assert ic.iloc[0]["mean_ic"] == pytest.approx(-1.0, abs=1e-9)
    assert ic.iloc[0]["n_obs"] >= 10


def test_alert_precision_recall_tolerance_window(tmp_settings):
    ds = "2026-11-03"
    # Keep this fixture explicitly in the synthetic namespace even when a
    # developer's local .env selects LIVE for the app.
    tmp_settings._data["mode"] = "SYNTHETIC"
    tmp_settings._data["provider"] = "SYNTHETIC"
    raw = tmp_settings.data_path("raw", f"SYNTH_{ds}")
    raw.mkdir(parents=True)
    (raw / "manifest.json").write_text(json.dumps({"mode": "SYNTHETIC", "synthetic": True}))
    t = lambda h, m: pd.Timestamp(f"{ds} {h:02d}:{m:02d}:00", tz=VN_TZ).isoformat()
    events = [
        {"type": "DEPTH_EVAPORATION", "symbol": "HPG", "start_ts": t(10, 0), "end_ts": t(10, 5)},
        {"type": "TRADE_BURST", "symbol": "PDR", "start_ts": t(10, 30), "end_ts": t(10, 32)},
    ]
    (raw / "events_truth.json").write_text(json.dumps({"synthetic": True, "events": events}))
    alerts = pd.DataFrame([
        {"session_date": ds, "symbol": "HPG", "type": "DEPTH_EVAPORATION",
         "ts": pd.Timestamp(f"{ds} 10:02:00", tz=VN_TZ)},   # TP trong cửa sổ
        {"session_date": ds, "symbol": "HPG", "type": "DEPTH_EVAPORATION",
         "ts": pd.Timestamp(f"{ds} 10:05:20", tz=VN_TZ)},   # TP nhờ dung sai +30s
        {"session_date": ds, "symbol": "HPG", "type": "DEPTH_EVAPORATION",
         "ts": pd.Timestamp(f"{ds} 10:20:00", tz=VN_TZ)},   # FP ngoài cửa sổ
        {"session_date": ds, "symbol": "PDR", "type": "TRADE_BURST",
         "ts": pd.Timestamp(f"{ds} 10:31:00", tz=VN_TZ)},   # TP
    ])
    pr = V.alert_precision_recall(alerts, tmp_settings, tolerance_s=30.0).set_index("alert_type")
    assert pr.loc["DEPTH_EVAPORATION", "precision"] == pytest.approx(2 / 3)
    assert pr.loc["DEPTH_EVAPORATION", "recall"] == pytest.approx(1.0)
    assert pr.loc["TRADE_BURST", "precision"] == pytest.approx(1.0)
    assert pr.loc["TRADE_BURST", "events_detected"] == 1


def test_alert_pr_empty_without_ground_truth(tmp_settings):
    alerts = pd.DataFrame([{"session_date": "2026-11-03", "symbol": "HPG",
                            "type": "TRADE_BURST", "ts": pd.Timestamp("2026-11-03 10:00", tz=VN_TZ)}])
    assert V.alert_precision_recall(alerts, tmp_settings).empty
