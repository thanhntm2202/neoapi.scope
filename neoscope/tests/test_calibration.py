"""Hiệu chỉnh tham số: hồi quy qua gốc tính tay, profile, fit_y, chống nhìn trước.

Mọi tham số của mô hình thực thi (κ, v̂, σ̂, Y) phải đến từ QUÁ KHỨ so với
thời điểm đặt lệnh. Các test này khóa từng cơ chế bằng số tính tay được.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from neoscope.analytics.calibration import (fit_kappa, fit_y, lookup_v_rate,
                                            predict_all_models, sigma_fallback,
                                            static_features, volume_profile)
from neoscope.constants import VN_TZ

from .conftest import snap_row, snaps_frame

T0 = pd.Timestamp("2026-11-03 10:00:00", tz=VN_TZ)


def _kappa_bars(beta: float = 2.0, n: int = 61) -> pd.DataFrame:
    """ret_bps[i] = beta·OBI[i−1] → κ qua gốc phải khôi phục đúng beta/60."""
    rng = np.random.default_rng(3)
    obi = rng.uniform(-0.9, 0.9, n)
    ret = np.empty(n)
    ret[0] = 0.0
    ret[1:] = beta * obi[:-1]
    return pd.DataFrame({
        "symbol": "HPG", "session_date": "2026-11-03", "group": "large",
        "bar_ts": [T0 + pd.Timedelta(minutes=i) for i in range(n)],
        "obi_last": obi, "ret_bps": ret,
    })


def test_kappa_recovers_hand_computed_slope():
    df = fit_kappa(_kappa_bars(beta=2.0))
    r = df.iloc[0]
    assert r["kappa_bps_per_s"] == pytest.approx(2.0 / 60.0, rel=1e-9)
    assert r["r2"] == pytest.approx(1.0, abs=1e-9)
    assert r["se"] == pytest.approx(0.0, abs=1e-9)
    assert r["n"] == 60  # bar cuối không có ret_next → loại


def test_kappa_negative_slope_clipped_to_economic_prior():
    df = fit_kappa(_kappa_bars(beta=-2.0))
    assert df.iloc[0]["kappa_bps_per_s"] == 0.0  # tiên nghiệm: OBI dương không kéo giá xuống


def test_kappa_excludes_non_adjacent_bars():
    bars = _kappa_bars()
    # kéo bar 30 ra xa 2 phút → ret_next của bar 29 bắc qua khoảng trống → loại
    bars.loc[30:, "bar_ts"] = bars.loc[30:, "bar_ts"] + pd.Timedelta(minutes=1)
    df = fit_kappa(bars)
    assert df.iloc[0]["n"] == 59


def test_kappa_too_few_samples_returns_zero_not_crash():
    df = fit_kappa(_kappa_bars(n=10))
    assert df.iloc[0]["kappa_bps_per_s"] == 0.0
    assert df.iloc[0]["n"] < 50


def _profile_bars() -> pd.DataFrame:
    rows = []
    for sym, grp, dv in (("HPG", "large", 600.0), ("PDR", "thin", 300.0)):
        for ds in ("2026-11-03", "2026-11-04"):
            for i in range(4):
                rows.append({"symbol": sym, "group": grp, "session_date": ds,
                             "bucket": 40, "d_vol": dv,
                             "ret_bps": 1.0 if i % 2 else -1.0,
                             "bar_ts": T0 + pd.Timedelta(minutes=i)})
    return pd.DataFrame(rows)


def test_volume_profile_hand_computed_and_fallback_chain():
    bars = _profile_bars()
    prof = volume_profile(bars)
    assert prof[("HPG", 40)] == pytest.approx(10.0)   # 600 cp/phút / 60
    assert prof[("PDR", 40)] == pytest.approx(5.0)
    assert prof[("GRP", "large", 40)] == pytest.approx(10.0)
    assert prof[("SYM", "HPG")] == pytest.approx(10.0)
    # bucket chưa từng thấy → fallback nhóm → fallback mã
    assert lookup_v_rate(prof, "HPG", "large", 99) == pytest.approx(10.0)
    assert np.isnan(lookup_v_rate(prof, "XXX", "nope", 99))


def test_sigma_fallback_scales_minute_to_sqrt_second():
    bars = _profile_bars()
    fb = sigma_fallback(bars)
    expected = bars[bars["group"] == "large"]["ret_bps"].std() / np.sqrt(60.0)
    assert fb[("large", 40)] == pytest.approx(expected)


def test_fit_y_hand_computed_quantile_and_rmse():
    rows = ([{"e_resid": 1.0, "sigma_used": 1.0, "tau_eff": 1.0}] * 36
            + [{"e_resid": 2.0, "sigma_used": 1.0, "tau_eff": 1.0}] * 4)
    y_cov, y_rmse, n = fit_y(rows)
    # ratio = |e|/x: 36×1.0 + 4×2.0 → q90 nội suy tuyến tính = 1.1
    assert n == 40
    assert y_cov == pytest.approx(1.1 / 1.6449, rel=1e-9)
    assert y_rmse == pytest.approx(np.sqrt(52.0 / 40.0), rel=1e-9)


def test_fit_y_small_sample_defaults_to_one():
    y_cov, y_rmse, n = fit_y([{"e_resid": 1.0, "sigma_used": 1.0, "tau_eff": 1.0}] * 5)
    assert (y_cov, y_rmse, n) == (1.0, 1.0, 5)


def _snaps_and_bars(n_min: int = 10):
    snaps = snaps_frame([snap_row(T0 + pd.Timedelta(seconds=5 * i))
                         for i in range(n_min * 12)])
    bars = pd.DataFrame({
        "bar_ts": [T0 + pd.Timedelta(minutes=i) for i in range(n_min)],
        "ret_bps": [(-1.0) ** i * (i + 1) for i in range(n_min)],
    })
    return snaps, bars


def test_static_features_sigma_uses_only_completed_bars(settings):
    snaps, bars = _snaps_and_bars()
    ts0 = T0 + pd.Timedelta(minutes=7, seconds=20)
    order = {"ts": ts0, "side": -1, "qty_shares": 1000.0}
    f1 = static_features(order, snaps, bars, settings)
    assert f1 is not None
    # bar 10:07 chứa ts0 → CHƯA hoàn chỉnh tại ts0 → sửa nó không được đổi σ
    mutated = bars.copy()
    mutated.loc[mutated["bar_ts"] >= T0 + pd.Timedelta(minutes=7), "ret_bps"] = 1e6
    f2 = static_features(order, snaps, mutated, settings)
    assert f1["sigma_trail"] == pytest.approx(f2["sigma_trail"], rel=1e-12)
    # σ đúng bằng std của 7 bar đã hoàn chỉnh (10:00..10:06), quy đổi /√60
    expected = bars.iloc[:7]["ret_bps"].std() / np.sqrt(60.0)
    assert f1["sigma_trail"] == pytest.approx(expected, rel=1e-9)


def test_static_features_arrival_snap_is_last_at_or_before_order(settings):
    snaps, bars = _snaps_and_bars()
    ts0 = T0 + pd.Timedelta(minutes=7, seconds=22)  # giữa hai nhịp 5s
    order = {"ts": ts0, "side": -1, "qty_shares": 1000.0}
    f = static_features(order, snaps, bars, settings)
    expected_mid = float(snaps.iloc[snaps.index[snaps["ts"] <= ts0][-1]]["mid"])
    assert f["mid_arr"] == pytest.approx(expected_mid)
    # sửa sổ lệnh TƯƠNG LAI không được đổi đặc trưng tại thời điểm đặt
    mutated = snaps.copy()
    mutated.loc[mutated["ts"] > ts0, ["bid1", "bid2", "bid3"]] = 1.0
    f2 = static_features(order, mutated, bars, settings)
    assert f["ladder"].vwap_vis == pytest.approx(f2["ladder"].vwap_vis)


def test_static_features_before_first_snap_returns_none(settings):
    snaps, bars = _snaps_and_bars()
    order = {"ts": T0 - pd.Timedelta(seconds=1), "side": -1, "qty_shares": 1000.0}
    assert static_features(order, snaps, bars, settings) is None


def test_predict_models_in_book_all_agree_on_deterministic_cost(settings):
    snaps, bars = _snaps_and_bars()
    order = {"ts": T0 + pd.Timedelta(minutes=7, seconds=20), "side": -1, "qty_shares": 1000.0}
    f = static_features(order, snaps, bars, settings)
    preds = predict_all_models(f, order, v_rate=10.0, sigma=1.0,
                               kappa=0.1, y_risk=1.0, settings=settings)
    # lệnh 1000 cp nằm trọn mức 1 (1000 cp) → chi phí tất định, không rủi ro
    assert preds["full"]["e"] == pytest.approx(preds["ladder_only"]["e"])
    assert preds["full"]["sigma"] == 0.0
    assert preds["naive_mid"]["e"] == 0.0
    expected = (101.0 - 100.0) / 101.0 * 1e4  # bán tại bid 100, mid 101
    assert preds["full"]["e"] == pytest.approx(expected, rel=1e-9)


def test_predict_models_beyond_book_full_adds_drift_and_risk(settings):
    snaps, bars = _snaps_and_bars()
    qty = 10_000.0  # vượt toàn bộ sổ bid 6000 cp
    order = {"ts": T0 + pd.Timedelta(minutes=7, seconds=20), "side": -1, "qty_shares": qty}
    f = static_features(order, snaps, bars, settings)
    preds = predict_all_models(f, order, v_rate=10.0, sigma=1.0,
                               kappa=0.1, y_risk=1.0, settings=settings)
    lad = f["ladder"]
    w_vis, w_res = lad.filled_vis / qty, lad.qty_res / qty
    hs = f["hs_bps"]
    assert preds["ladder_only"]["e"] == pytest.approx(w_vis * lad.cost_vis_bps + w_res * hs)
    # full = ladder_only + phần trôi giá kỳ vọng (OBI>0 trong fixture → bán bị bất lợi)
    full = preds["_full_obj"]
    mu = 0.1 * f["obi_now"]
    if full.w_unf == 0:
        extra = w_res * (-1) * mu * full.tau_s / 2
    else:
        extra = (full.w_res * (-1) * mu * full.tau_s / 2
                 + full.w_unf * (-1) * mu * float(settings.execution.horizon_s))
    assert full.e_is_bps == pytest.approx(preds["ladder_only"]["e"] + extra, rel=1e-9)
    assert full.sigma_is_bps > 0  # có phơi nhiễm thời gian → phải có rủi ro
