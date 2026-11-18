"""Các màn hình sản phẩm — mỗi trang trả lời một câu hỏi quyết định.

Không trưng bày số: mỗi màn hình mở đầu bằng câu hỏi người dùng đang cần
trả lời, kết thúc bằng diễn giải có trách nhiệm (kèm giới hạn khi cần).
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
import streamlit as st

from ..analytics.calibration import lookup_v_rate, predict_all_models, static_features
from ..config import REPO_ROOT
from ..data.store import search_ts
from ..finance.execution import trading_costs_bps
from ..simulator.matching import simulate_order
from . import charts as ch, theme
from .data import (fold_params_for, fmt_vnd, load_result, sigma_fallback_for,
                   volume_profile_for)


# ------------------------------------------------------------------ tổng quan
def _last_valid(day: pd.DataFrame, col: str) -> pd.Series:
    """Giá trị HỢP LỆ CUỐI CÙNG của mỗi mã trong phiên (bỏ qua snapshot null ở
    đầu/cuối phiên ATO-ATC nơi sổ lệnh không hợp lệ) — lát cắt cuối thô `tail(1)`
    từng khiến KPI Spread/Depth hiển thị '—' dù dữ liệu phiên có đầy đủ."""
    if day.empty or col not in day:
        return pd.Series(dtype=float)
    g = day[["symbol", col]].dropna(subset=[col])
    return g.groupby("symbol", sort=False).tail(1).set_index("symbol")[col]


def view_overview(ctx: dict) -> None:
    s, snaps, summary = ctx["settings"], ctx["snaps"], ctx["summary"]
    st.subheader("Tổng quan thị trường")
    st.caption("Bảng điều khiển nghiên cứu cho nhà đầu tư, môi giới và chuyên viên phân tích. "
               "Bắt đầu bằng trạng thái thanh khoản của phiên, sau đó mở chi tiết hoặc thử một lệnh giả định.")
    day = snaps[(snaps["session_date"] == ctx["session"]) &
                snaps["symbol"].isin(ctx["symbols"])].sort_values("ts")
    lhs_day = ctx["bars_lhs"]
    if len(lhs_day):
        lhs_day = lhs_day[(lhs_day["session_date"] == ctx["session"]) &
                          lhs_day["symbol"].isin(ctx["symbols"])].sort_values("bar_ts")
    else:
        lhs_day = pd.DataFrame()

    # ---- phiên trước đó để tính delta cho KPI ----
    sessions = ctx["sessions"]
    prev_session = sessions[sessions.index(ctx["session"]) - 1] if ctx["session"] in sessions[1:] else None
    prev = snaps[(snaps["session_date"] == prev_session) & snaps["symbol"].isin(ctx["symbols"])] if prev_session else pd.DataFrame()

    spread = _last_valid(day, "spread_bps")
    depth = pd.concat([_last_valid(day, "depth_bid_vnd"), _last_valid(day, "depth_ask_vnd")]).dropna()
    latest = day.groupby("symbol", as_index=False, sort=False).tail(1) if not day.empty else day
    alerts = ctx["results"].get("alerts", pd.DataFrame())
    if len(alerts):
        alert_cut = alerts[(alerts["session_date"] == ctx["session"]) &
                           alerts["symbol"].isin(ctx["symbols"])]
        alert_count = len(alert_cut)
        rare_count = int(alert_cut.get("priority", pd.Series(index=alert_cut.index, dtype=str)).isin(["P1", "P2"]).sum())
    else:
        alert_count = rare_count = 0

    def _delta(now: float, series_prev: pd.Series, fmt: str, invert: bool = False) -> tuple[str, str]:
        """Chênh lệch trung vị so với phiên trước → (text, hướng màu)."""
        if prev_session and len(series_prev) and np.isfinite(now):
            d = now - float(series_prev.median())
            if abs(d) <= 1e-12:
                return "=", "flat"
            good = (d < 0) if invert else (d > 0)
            return fmt.format(d), ("up" if good else "down")
        return "", "flat"

    spread_now = float(spread.median()) if len(spread) else np.nan
    depth_now = float(depth.median() / 1e9) if len(depth) else np.nan
    lhs_latest = lhs_day.dropna(subset=["lhs"]).groupby("symbol", sort=False).tail(1) if len(lhs_day) else pd.DataFrame()
    lhs_now = float(lhs_latest["lhs"].median()) if len(lhs_latest) and lhs_latest["lhs"].notna().any() else np.nan
    spread_prev = _last_valid(prev, "spread_bps") if prev_session else pd.Series(dtype=float)
    depth_prev = (pd.concat([_last_valid(prev, "depth_bid_vnd"), _last_valid(prev, "depth_ask_vnd")]).dropna()
                  if prev_session else pd.Series(dtype=float))
    lhs_prev = pd.Series(dtype=float)
    if prev_session and len(ctx["bars_lhs"]):
        lp = ctx["bars_lhs"][(ctx["bars_lhs"]["session_date"] == prev_session) &
                             ctx["bars_lhs"]["symbol"].isin(ctx["symbols"])].dropna(subset=["lhs"])
        if len(lp):
            lhs_prev = lp.groupby("symbol", sort=False).tail(1)["lhs"]

    d_spread = _delta(spread_now, spread_prev, "{:+.2f} bps", invert=True)
    d_depth = _delta(depth_now, depth_prev / 1e9, "{:+.2f} tỷ")
    d_lhs = _delta(lhs_now, lhs_prev, "{:+.1f} điểm")

    theme.kpi_grid([
        {"label": "Mã trong lát cắt", "value": f"{len(latest):,}",
         "sub": "có snapshot trong phiên", "color": "#38bdf8"},
        {"label": "Spread trung vị",
         "value": f"{spread_now:.2f} bps" if np.isfinite(spread_now) else "—",
         "sub": "chi phí tức thờI · thấp hơn = tốt hơn", "color": "#2dd4bf",
         "delta": d_spread[0], "delta_dir": d_spread[1]},
        {"label": "Độ sâu hiển thị",
         "value": f"{depth_now:.2f} tỷ đ" if np.isfinite(depth_now) else "—",
         "sub": "depth bid/ask 3 mức · giá trị hợp lệ cuối phiên", "color": "#a78bfa",
         "delta": d_depth[0], "delta_dir": d_depth[1]},
        {"label": "LHS trung vị",
         "value": f"{lhs_now:.1f}/100" if np.isfinite(lhs_now) else "—",
         "sub": "sức khỏe thanh khoản tổng hợp", "color": "#34d399",
         "delta": d_lhs[0], "delta_dir": d_lhs[1]},
        {"label": "Cảnh báo · P1/P2", "value": f"{rare_count} / {alert_count}",
         "sub": "hiếm / tổng số cảnh báo phiên",
         "color": "#fbbf24" if rare_count else "#64748b"},
    ])

    # ---------------- Alert Pulse Feed: dòng chảy cảnh báo gần nhất của phiên ----------------
    if len(alerts):
        alert_cut_feed = alerts[(alerts["session_date"] == ctx["session"]) &
                                alerts["symbol"].isin(ctx["symbols"])]
        if len(alert_cut_feed):
            feed = alert_cut_feed.sort_values("ts", ascending=False).head(6)
            items = [{
                "priority": str(r.get("priority", "P3")),
                "title": f"{r['symbol']} · {r['type']}",
                "sub": f"z = {r['z']:.2f} · phân vị {r['pct']:.3f} · n_train = {r['n_train']}",
                "time": pd.Timestamp(r["ts"]).strftime("%H:%M:%S"),
            } for _, r in feed.iterrows()]
            theme.section("Alert Pulse · cảnh báo mới nhất trong phiên",
                          "Sáu cảnh báo gần nhất khớp bộ lọc; truy nguyên đầy đủ ở trang Cảnh báo.")
            theme.alert_feed(items)

    ds = summary.get("dataset", {})
    day_idx = ctx["indices"][ctx["indices"]["session_date"] == ctx["session"]] if len(ctx["indices"]) else pd.DataFrame()
    chart_left, chart_right = st.columns([1.15, 1])
    with chart_left:
        st.markdown("#### Độ rộng thị trường")
        if len(day_idx):
            st.plotly_chart(ch.breadth(day_idx), width="stretch",
                            alt="Độ rộng thị trường: số mã tăng, giảm và đứng giá trong phiên đã chọn.")
            source = {"NEO": "NEO `marketInfo`", "SSI": "SSI `indexsummary`",
                      "SYNTHETIC": "bộ sinh dữ liệu mô phỏng"}.get(s.provider, s.provider)
            st.caption(f"Nguồn: {source} · trạng thái chỉ số của phiên đang xem.")
        else:
            st.info("Nguồn hiện tại không có dữ liệu độ rộng cho phiên này.")
    with chart_right:
        st.markdown("#### Xếp hạng thanh khoản")
        lhs_valid = lhs_day.dropna(subset=["lhs"]) if len(lhs_day) else pd.DataFrame()
        if len(lhs_valid):
            t_latest = lhs_valid["bar_ts"].max()
            rank = lhs_valid[lhs_valid["bar_ts"] == t_latest]
            st.plotly_chart(ch.lhs_ranking(rank), width="stretch",
                            alt="Xếp hạng LHS của các mã được chọn tại thởi điểm có dữ liệu mới nhất.")
            st.caption(f"Cắt ngang lúc {pd.Timestamp(t_latest).strftime('%H:%M')} UTC+7 · điểm tương đối.")
        else:
            st.info("Chưa đủ dữ liệu liên tục để tính LHS; cần ít nhất năm bar.")

    # ---------------- Băng thanh khoản nội phiên (mã tự chọn) ----------------
    if not day.empty:
        tape_syms = sorted(day["symbol"].unique())
        sel_col, _ = st.columns([1, 3])
        tape_sym = sel_col.selectbox("Soi băng thanh khoản nội phiên của mã", tape_syms,
                                     key="ov_tape_sym")
        tape_day = day[day["symbol"] == tape_sym]
        if len(tape_day):
            st.plotly_chart(ch.tape(tape_day), width="stretch",
                            alt=f"Băng giao dịch nội phiên của {tape_sym}: mid, giá khớp và độ sâu hai phía.")

    # ---------------- Watchlist (kèm sparkline LHS) ----------------
    st.markdown("#### Watchlist · snapshot gần nhất theo mã")
    if day.empty:
        st.info("Không có snapshot phù hợp bộ lọc. Chọn mã khác hoặc kiểm tra lại nguồn dữ liệu.")
        return
    lhs_series: dict[str, list[float]] = {}
    if len(lhs_day):
        for sym, g in lhs_day.dropna(subset=["lhs"]).groupby("symbol", sort=False):
            lhs_series[sym] = g.sort_values("bar_ts")["lhs"].round(1).tolist()
    def _num(v) -> float:
        """None/NaN → np.nan để bảng hiển thị ô trống thay vì chữ 'None'."""
        try:
            f = float(v)
        except (TypeError, ValueError):
            return np.nan
        return f if np.isfinite(f) else np.nan

    mid_last = _last_valid(day, "mid")
    obi_last = _last_valid(day, "obi")
    rows = []
    for _, last in latest.iterrows():
        sym = last["symbol"]
        depth_bid_last = _last_valid(day[day["symbol"] == sym], "depth_bid_vnd").get(sym, np.nan)
        rows.append({"Mã": sym, "Nhóm": "VN30 lớn" if s.group_of(sym) == "large" else "Midcap mỏng",
                     "LHS phiên": lhs_series.get(sym, []),
                     "Mid cuối (đ)": _num(mid_last.get(sym, np.nan)),
                     "Spread (bps)": _num(spread.get(sym, np.nan)),
                     "Depth bid (tỷ đ)": depth_bid_last / 1e9 if pd.notna(depth_bid_last) else np.nan,
                     "OBI": _num(obi_last.get(sym, np.nan)),
                     "KL phiên (triệu cp)": _num(last["cum_vol"]) / 1e6})
    wl = pd.DataFrame(rows).set_index("Mã").sort_values("Mid cuối (đ)", ascending=False)
    with st.container(border=True):
        st.dataframe(wl, width="stretch",
                     column_config={
                         "LHS phiên": st.column_config.LineChartColumn(
                             "LHS trong phiên", y_min=0, y_max=100, width="medium"),
                         "Mid cuối (đ)": st.column_config.NumberColumn(format="%.0f"),
                         "Spread (bps)": st.column_config.NumberColumn(format="%.1f"),
                         "Depth bid (tỷ đ)": st.column_config.NumberColumn(format="%.2f"),
                         "OBI": st.column_config.NumberColumn(format="%.2f"),
                         "KL phiên (triệu cp)": st.column_config.NumberColumn(format="%.2f")})
        st.download_button("⬇ Tải watchlist (CSV)", wl.drop(columns=["LHS phiên"]).to_csv().encode("utf-8-sig"),
                           file_name=f"neoscope_watchlist_{ctx['session']}.csv", mime="text/csv")
    with st.expander("Phạm vi sử dụng & độ bao phủ nghiên cứu"):
        st.info("NeoScope là **công cụ phân tích học thuật** — không phải khuyến nghị mua/bán, "
                "không đặt lệnh thật, không dự báo giá dài hạn.", icon="⚖️")
        q = summary.get("quality", {})
        with st.grid("auto", min_column_width=170, gap="small"):
            st.metric("Phiên trong tập", ds.get("n_sessions", snaps["session_date"].nunique()))
            st.metric("Mã trong tập", ds.get("n_symbols", snaps["symbol"].nunique()))
            st.metric("Snapshot curated", f"{ds.get('n_snapshots', len(snaps)):,}")
            st.metric("Lệnh test OOS", f"{summary.get('orders', {}).get('n', 0):,}",
                      help="Lệnh giả lập ngoài mẫu; không phải giao dịch thật.")
            if q:
                st.metric("RAW được chuẩn hóa", f"{(q.get('n_curated_total', 0) / max(q.get('n_raw_total', 1), 1)):.1%}")
                st.metric("Bản ghi lặp đã loại", f"{q.get('n_duplicates_dropped', 0):,}")


# ------------------------------------------------------------------ Q1: LHS
def view_lhs(ctx: dict) -> None:
    st.subheader("Thanh khoản · Mã này khỏe đến đâu, so với nhóm?")
    st.caption("LHS = 100 × trung bình có trọng số của **hạng percentile chéo mã** trên 5 cấu phần "
               "(độ chặt, độ sâu, tức thời, ổn định, cân bằng) — cửa sổ trượt 15 phút. "
               "Điểm 80 là điểm tổng hợp tương đối, không phải percentile của LHS hay xác suất khỏe hơn 80% mã.")
    bars_lhs, session = ctx["bars_lhs"], ctx["session"]
    day = bars_lhs[bars_lhs["session_date"] == session]
    if day.empty:
        st.warning("Chưa có LHS cho phiên này — chạy `neoscope analyze`.")
        return
    valid = day.dropna(subset=["lhs"])
    if valid.empty:
        st.warning("Phiên này chưa có LHS hợp lệ (cần ≥5 bar liên tiếp để dựng cửa sổ trượt 15').")
        return
    times = sorted(valid["bar_ts"].unique())
    t_sel = st.select_slider("Thời điểm đánh giá (UTC+7)", options=times,
                             value=times[-1], format_func=lambda t: pd.Timestamp(t).strftime("%H:%M"))
    at_t = valid[valid["bar_ts"] == t_sel]
    if at_t.empty:
        # Giá trị widget cũ (phiên trước) không còn trong options của phiên mới
        # → rơi về lát cắt cuối cùng thay vì ném IndexError.
        t_sel = times[-1]
        at_t = valid[valid["bar_ts"] == t_sel]
    col1, col2 = st.columns([1.1, 1])
    with col1:
        st.plotly_chart(ch.lhs_ranking(at_t), width="stretch",
                        alt="Xếp hạng điểm sức khỏe thanh khoản giữa các mã tại thời điểm đã chọn.")
    with col2:
        sym_options = at_t.sort_values("lhs", ascending=False)["symbol"].tolist()
        sym = st.selectbox("Soi cấu phần mã", sym_options)
        pick = at_t[at_t["symbol"] == sym]
        row = (pick if len(pick) else at_t).iloc[0]
        sym = str(row["symbol"])
        g1, g2 = st.columns([1, 1.35])
        with g1:
            st.plotly_chart(ch.lhs_gauge(float(row["lhs"]), sym, str(row.get("group", "large"))),
                            width="stretch",
                            alt=f"Đồng hồ LHS của {sym} tại thởi điểm đã chọn.")
        with g2:
            st.plotly_chart(ch.component_breakdown(row), width="stretch",
                            alt="Năm cấu phần percentile giải thích điểm LHS của mã đã chọn.")

    theme.section("Liquidity Radar · so 'chân dung' thanh khoản giữa hai mã",
                  "Cùng một điểm LHS có thể đến từ hình dáng rất khác nhau — radar cho thấy mã nào chắc ở đâu, "
                  "yếu ở đâu (hạng percentile chéo watchlist, càng rộng càng khỏe).")
    radar_options = at_t.sort_values("lhs", ascending=False)["symbol"].tolist()
    rc1, rc2 = st.columns(2)
    sym_a = rc1.selectbox("Mã A", radar_options, index=0, key="radar_a")
    sym_b = rc2.selectbox("Mã B", [x for x in radar_options if x != sym_a] or radar_options,
                          index=0, key="radar_b")
    rows_radar = []
    for s_ in dict.fromkeys([sym_a, sym_b]):  # giữ thứ tự, loại trùng
        p = at_t[at_t["symbol"] == s_]
        if len(p):
            rows_radar.append((s_, p.iloc[0]))
    if len(rows_radar) >= 2:
        st.plotly_chart(ch.lhs_radar(rows_radar), width="stretch",
                        alt="Radar so sánh năm cấu phần LHS của hai mã đã chọn.")
    else:
        st.info("Chọn hai mã khác nhau để so radar.")
    theme.section("Diễn biến LHS trong phiên",
                  "Cửa sổ trượt 15 phút; nét liền = nhóm thanh khoản cao, nét chấm = nhóm midcap mỏng.")
    syms = ctx["symbols"]
    st.plotly_chart(ch.lhs_timeseries(day, syms), width="stretch",
                    alt="Diễn biến điểm LHS trong ngày của các mã được chọn.")

    theme.section("Phân phối LHS trong phiên",
                  "Hai nhóm thanh khoản tách bạch đến đâu trong cùng một phiên — khoảng cách giữa hai phân phối "
                  "chính là 'phí' rủi ro thanh khoản của nhóm midcap mỏng.")
    st.plotly_chart(ch.lhs_dist(day), width="stretch",
                    alt="Phân phối điểm LHS của từng nhóm thanh khoản trong phiên.")

    st.markdown("#### Độ nhạy trọng số (kiểm tra robustness)")
    sens = ctx["results"].get("lhs_sensitivity", pd.DataFrame())
    if len(sens):
        show = sens.rename(columns={"perturbed_weight": "Trọng số bị nhân đôi",
                                    "mean_spearman": "Spearman TB với LHS gốc",
                                    "min_spearman": "Spearman nhỏ nhất"})
        st.dataframe(show, width="stretch", hide_index=True,
                     column_config={"Spearman TB với LHS gốc": st.column_config.NumberColumn(format="%.4f"),
                                    "Spearman nhỏ nhất": st.column_config.NumberColumn(format="%.4f")})
        mean_rho = float(sens["mean_spearman"].mean())
        min_rho = float(sens["min_spearman"].min())
        st.caption(f"Khi nhân đôi từng trọng số, Spearman trung bình theo cấu hình hiện tại là {mean_rho:.3f}; "
                   f"giá trị thấp nhất theo thời điểm là {min_rho:.3f}. Đây chỉ là độ nhạy thứ hạng với lựa chọn trọng số, "
                   "không chứng minh LHS đo đúng thanh khoản. Giá trị xây dựng so với ILLIQ tương lai xem tab Q4.")


# ------------------------------------------------------------------ Q2: execution
def view_execution(ctx: dict) -> None:
    st.subheader("Mô phỏng chi phí · Lệnh giả định sẽ tác động sổ ra sao?")
    st.caption("Mô hình Implementation Shortfall (Perold 1988): quét sổ 3 mức (chi phí tất định) "
               "+ phần dư thực thi dần với trôi giá κ·OBI và rủi ro thời điểm √τ (Almgren et al. 2005). "
               "Tham số lấy từ fold walk-forward — không fit trên phiên đang xem.")
    s, snaps, session = ctx["settings"], ctx["snaps"], ctx["session"]
    if not ctx["symbols"]:
        st.info("Chọn ít nhất một mã trong bộ lọc watchlist để mô phỏng.")
        return
    day = snaps[(snaps["session_date"] == session) &
                snaps["symbol"].isin(ctx["symbols"])]
    if day.empty:
        st.warning("Không có snapshot cho phiên này.")
        return
    fp_all = ctx["results"].get("fold_params", pd.DataFrame())
    test_dates = ctx["summary"].get("dataset", {}).get("test_dates", [])
    fp, note = fold_params_for(fp_all, session, test_dates)
    st.caption(note)

    c1, c2, c3 = st.columns([1, 1, 1.4])
    available_symbols = sorted(day["symbol"].unique())
    if not available_symbols:
        st.info("Chưa chọn mã nào trong bộ lọc watchlist.")
        return
    sym = c1.selectbox("Mã cổ phiếu", available_symbols)
    side_label = c2.radio("Hướng lệnh", ["BÁN (quét bid)", "MUA (quét ask)"], horizontal=True)
    side = -1 if side_label.startswith("BÁN") else 1
    notional = c3.select_slider("Quy mô lệnh (VND)",
                                options=[50e6, 100e6, 200e6, 500e6, 1e9, 2e9, 3e9, 5e9],
                                value=500e6, format_func=fmt_vnd)
    g = day[day["symbol"] == sym].sort_values("ts").reset_index(drop=True)
    lo = g[g["session"].isin(["LO_AM", "LO_PM"])].dropna(subset=["mid"])
    if lo.empty:
        st.warning("Mã này không có sổ lệnh hợp lệ trong phiên LO.")
        return
    t_options = lo["ts"].tolist()
    ts0 = st.select_slider("Thời điểm đặt lệnh (UTC+7)", options=t_options,
                           value=t_options[len(t_options) // 2],
                           format_func=lambda t: pd.Timestamp(t).strftime("%H:%M:%S"))
    idx = search_ts(g["ts"], ts0, side="right") - 1
    arr = g.iloc[max(idx, 0)]
    mid = float(arr["mid"])
    qty = max(round(notional / mid / 100) * 100, 100)

    bars_day = ctx["bars"][(ctx["bars"]["session_date"] == session) & (ctx["bars"]["symbol"] == sym)]
    bars_day = bars_day.sort_values("bar_ts").reset_index(drop=True)
    order = {"ts": ts0, "side": side, "qty_shares": float(qty)}
    feat = static_features(order, g, bars_day, s)
    if feat is None:
        st.error("Không dựng được sổ lệnh hợp lệ tại thời điểm này (cờ NO_BOOK/ATO_ATC) — mô hình từ chối ước tính.")
        return
    if fp.empty:
        st.error("Chưa có tham số fold — chạy `neoscope validate` trước.")
        return
    fp_row = fp[fp["group"] == s.group_of(sym)].iloc[0]
    train_dates = [d for d in ctx["summary"].get("dataset", {}).get("dates", []) if d < str(fp_row["test_date"])]
    profile = volume_profile_for(s.dataset_mode, s.config_hash, train_dates)
    sig_fb = sigma_fallback_for(s.dataset_mode, s.config_hash, train_dates)
    sigma = feat["sigma_trail"] if np.isfinite(feat["sigma_trail"]) else sig_fb.get((s.group_of(sym), feat["bucket"]), np.nan)
    v_rate = lookup_v_rate(profile, sym, s.group_of(sym), feat["bucket"])
    preds = predict_all_models(feat, order, v_rate, sigma, float(fp_row["kappa_bps_per_s"]),
                               float(fp_row["y_cov"]), s)
    full = preds["_full_obj"]
    lad = feat["ladder"]
    costs = trading_costs_bps(qty * mid, side, float(s.execution.fee_rate), float(s.execution.sell_tax_rate))

    with st.grid("auto", min_column_width=175, gap="medium"):
        st.metric("IS kỳ vọng", f"{full.e_is_bps:.1f} bps", help="So với mid lúc lệnh đến (Perold 1988).", border=True)
        st.metric("Khoảng dự báo 90%", f"[{full.lo_bps:.1f}, {full.hi_bps:.1f}]", help="Khoảng hiệu chỉnh ngoài mẫu.", border=True)
        st.metric("Đáp ứng trong sổ", f"{lad.coverage:.0%}", help="Tỷ lệ quy mô lệnh được phủ bởi 3 mức hiển thị.", border=True)
        st.metric("Thời gian mô phỏng", f"{full.tau_s:.0f} giây" if np.isfinite(full.tau_s) else "—", border=True)
        st.metric("Phí + thuế ước tính", f"{(costs['fee_vnd'] + costs['tax_vnd']) / 1e6:.2f} triệu đ",
                  help=f"Theo cấu hình: phí {s.execution.fee_rate:.2%}, thuế bán {s.execution.sell_tax_rate:.1%}.", border=True)
    st.caption(f"Lệnh {qty:,.0f} cp × mid {mid:,.0f} đ ≈ {fmt_vnd(qty * mid)} đ · "
               f"chi phí tác động ước tính ≈ {fmt_vnd(qty * mid * full.e_is_bps / 1e4)} đ "
               f"(chưa gồm phí/thuế) · cờ mô hình: {', '.join(full.flags) if full.flags else 'không'}")

    colA, colB = st.columns([1, 1.2])
    with colA:
        prices = [arr.get(f"{'bid' if side == -1 else 'ask'}{i}") for i in (1, 2, 3)]
        vols = [arr.get(f"{'bid' if side == -1 else 'ask'}vol{i}") for i in (1, 2, 3)]
        prices = [float(p) if pd.notna(p) else None for p in prices]
        vols = [float(v) if pd.notna(v) else None for v in vols]
        st.plotly_chart(ch.book_ladder(prices, vols, side, qty, mid), width="stretch",
                        alt="Khối lượng hiển thị ở ba mức giá và phần lệnh mô phỏng khớp tại từng mức.")
        if lad.fills:
            fills = pd.DataFrame(lad.fills).rename(columns={"price": "Giá khớp (đ)", "qty": "KL ăn (cp)"})
            fills["Chi phí (bps)"] = side * (fills["Giá khớp (đ)"] - mid) / mid * 1e4
            st.dataframe(fills, hide_index=True, width="stretch",
                         column_config={"Giá khớp (đ)": st.column_config.NumberColumn(format="%.0f"),
                                        "KL ăn (cp)": st.column_config.NumberColumn(format="%.0f"),
                                        "Chi phí (bps)": st.column_config.NumberColumn(format="%.2f")})
    with colB:
        w_res = full.w_res
        w_unf = full.w_unf
        mu = full.detail["mu_bps_per_s"]
        parts = {"Sweep sổ hiển thị": full.w_vis * (lad.cost_vis_bps or 0.0)}
        if w_res > 0:
            parts["Nửa spread phần dư"] = w_res * full.detail["hs_bps"]
            parts["Trôi giá κ·OBI (phần dư)"] = w_res * side * mu * full.tau_s / 2
        if w_unf > 0:
            parts["Chi phí cơ hội phần chưa khớp"] = w_unf * side * mu * float(s.execution.horizon_s)
        st.plotly_chart(ch.cost_waterfall(parts, full.e_is_bps), width="stretch",
                        alt="Phân rã các thành phần chi phí thành implementation shortfall kỳ vọng.")

    st.markdown("##### So sánh với benchmark (cùng thông tin tại thời điểm đặt)")
    bench = pd.DataFrame([
        {"Mô hình": "naive_mid (bỏ qua mọi chi phí)", "E[IS] bps": 0.0},
        {"Mô hình": "ladder_only (phần dư tại giá tốt nhất, không trôi giá)", "E[IS] bps": preds["ladder_only"]["e"]},
        {"Mô hình": "full (ladder + trôi giá + rủi ro thời điểm)", "E[IS] bps": preds["full"]["e"]},
    ])
    st.dataframe(bench, hide_index=True, width="stretch",
                 column_config={"E[IS] bps": st.column_config.NumberColumn(format="%.2f")})

    with st.expander("🔍 Minh bạch tham số & giả định tại thời điểm đặt"):
        st.json({
            "mid_arrival_vnd": mid, "half_spread_bps": feat["hs_bps"], "OBI_now": feat["obi_now"],
            "kappa_bps_per_s (fold)": float(fp_row["kappa_bps_per_s"]),
            "Y_coverage (fold)": float(fp_row["y_cov"]),
            "sigma_bps_per_sqrt_s": float(sigma) if np.isfinite(sigma) else None,
            "v_rate_shares_per_s (profile train)": float(v_rate) if np.isfinite(v_rate) else None,
            "participation_rho": float(s.execution.participation_rate),
            "horizon_s": float(s.execution.horizon_s),
            "mu_drift_bps_per_s": full.detail["mu_bps_per_s"],
            "tau_eff_s": full.detail["tau_eff"],
            "weights": {"vis": full.w_vis, "res": full.w_res, "unf": full.w_unf},
        })
        st.caption("Giả định công bố: tiếp cận toàn bộ KL hiển thị (không mô phỏng hàng đợi); "
                   "sổ tương lai không phản hồi lệnh của ta (không own-impact) → với lệnh rất lớn, "
                   "ước tính là cận dưới. Xem docs/limitations.md.")

    st.markdown("##### Buồng thử: tự kiểm chứng ước tính bằng khớp lệnh mô phỏng")
    if st.button("▶ Khớp lệnh này trong buồng thử (paper simulator)", type="primary"):
        sim = simulate_order(g, ts0, side, float(qty), float(s.execution.participation_rate),
                             float(s.execution.horizon_s), float(s.execution.fee_rate),
                             float(s.execution.sell_tax_rate))
        if not sim.ok:
            st.error(f"Mô phỏng không khả thi: {sim.flags}")
        else:
            r1, r2, r3, r4 = st.columns(4)
            r1.metric("IS thực hiện (mô phỏng)", f"{sim.realized_is_bps:.1f} bps")
            r2.metric("Dự báo full", f"{full.e_is_bps:.1f} bps",
                      delta=f"sai số {full.e_is_bps - sim.realized_is_bps:+.1f} bps", delta_color="off")
            r3.metric("Khớp thực tế", f"{sim.filled_frac:.0%}", help=f"{sim.n_steps} nhịp tham gia, {sim.exec_time_s:.0f}s")
            r4.metric("VWAP thực hiện", f"{sim.vwap_exec:,.0f} đ")
            inside = full.lo_bps <= sim.realized_is_bps <= full.hi_bps
            st.success(f"Thực hiện nằm TRONG khoảng dự báo 90% [{full.lo_bps:.1f}, {full.hi_bps:.1f}] bps."
                       if inside else
                       f"Thực hiện nằm NGOÀI khoảng dự báo 90% — đuôi rủi ro là có thật; "
                       f"độ phủ tổng thể xem tab Q4 (không phải lúc nào cũng phủ).")
            preds_all = ctx["results"].get("predictions", pd.DataFrame())
            n_oos = int(len(preds_all[preds_all["model"] == "full"])) if len(preds_all) else 0
            st.caption("Một lệnh đơn lẻ không chứng minh được mô hình — bằng chứng đầy đủ là "
                       f"{n_oos:,} lệnh test ngoài mẫu ở tab Q4. Mô phỏng không phát sinh lệnh thật.")


# ------------------------------------------------------------------ Q3: alerts
def view_alerts(ctx: dict) -> None:
    st.subheader("Cảnh báo · Điều gì bất thường, xảy ra khi nào và vì sao?")
    st.caption("Ngưỡng suy từ thống kê: baseline expanding theo mã × bucket 15' (tôn trọng hình chữ U nội ngày), "
               "cổng z + phân vị 99% + dai dẳng ≥ 3 tick + cooldown 60s. Mỗi cảnh báo mang bằng chứng đầy đủ.")
    alerts = ctx["results"].get("alerts", pd.DataFrame())
    if alerts.empty:
        st.warning("Chưa có cảnh báo — chạy `neoscope analyze`.")
        return
    if "priority" not in alerts:
        alerts = alerts.assign(priority="P3")
    c1, c2, c3, c4 = st.columns(4)
    sel_sessions = c1.multiselect("Phiên", sorted(alerts["session_date"].unique()),
                                  default=[ctx["session"]] if ctx["session"] in set(alerts["session_date"]) else None)
    sel_types = c2.multiselect("Loại cảnh báo", sorted(alerts["type"].unique()),
                               default=sorted(alerts["type"].unique()))
    alert_symbols = sorted(alerts["symbol"].unique())
    default_symbols = [x for x in ctx["symbols"] if x in alert_symbols]
    sel_syms = c3.multiselect("Mã", alert_symbols, default=default_symbols)
    priorities = [p for p in ["P1", "P2", "P3"] if p in set(alerts["priority"])]
    sel_priority = c4.multiselect("Mức ưu tiên", priorities, default=priorities,
                                  format_func=lambda p: {"P1": "P1 · Rất hiếm", "P2": "P2 · Hiếm",
                                                         "P3": "P3 · Bất thường"}.get(p, p))
    f = alerts[alerts["session_date"].isin(sel_sessions or []) &
               alerts["type"].isin(sel_types or []) & alerts["symbol"].isin(sel_syms or [])]
    f = f[f["priority"].isin(sel_priority or [])]
    theme.kpi_grid([
        {"label": "Cảnh báo khớp bộ lọc", "value": f"{len(f):,}",
         "sub": "tất cả mức ưu tiên", "color": "#38bdf8"},
        {"label": "P1 · Rất hiếm", "value": f"{int((f.get('priority', '') == 'P1').sum()):,}",
         "sub": "đuôi phân vị ≥ 99,9%", "color": "#f87171"},
        {"label": "P2 · Hiếm", "value": f"{int((f.get('priority', '') == 'P2').sum()):,}",
         "sub": "đuôi phân vị ≥ 99,5%", "color": "#fbbf24"},
        {"label": "Mã có cảnh báo", "value": f"{f['symbol'].nunique():,}" if len(f) else "0",
         "sub": "khác nhau trong lát cắt", "color": "#a78bfa"},
    ])
    if f.empty:
        st.info("Không có cảnh báo khớp bộ lọc — nới bộ lọc hoặc chọn phiên khác.")
        return
    st.plotly_chart(ch.alert_timeline(f), width="stretch",
                    alt="Timeline cảnh báo: thờI điểm × loại, kích thước và màu theo mức ưu tiên.")
    with st.expander("⬇ Xuất danh sách cảnh báo (CSV)"):
        st.download_button("Tải CSV", f.to_csv(index=False).encode("utf-8-sig"),
                           file_name="neoscope_alerts.csv", mime="text/csv")
    priority_rank = {"P1": 0, "P2": 1, "P3": 2}
    show = f.assign(_priority_rank=f.get("priority", "P3").map(priority_rank)).sort_values(
        ["_priority_rank", "ts"], ascending=[True, False]).copy()
    show["Mức ưu tiên"] = show.get("priority", "P3").map(
        {"P1": "P1 · Rất hiếm", "P2": "P2 · Hiếm", "P3": "P3 · Bất thường"})
    show["giờ"] = show["ts"].dt.strftime("%H:%M:%S")
    st.dataframe(show[["Mức ưu tiên", "session_date", "giờ", "symbol", "type",
                       "signed_value", "z", "pct", "n_train"]],
                 hide_index=True, width="stretch", height=260,
                 column_config={"signed_value": st.column_config.NumberColumn("Giá trị (thang gốc)", format="%.3f"),
                                "z": st.column_config.NumberColumn(format="%.2f"),
                                "pct": st.column_config.NumberColumn("Phân vị", format="%.3f"),
                                "n_train": st.column_config.NumberColumn("n baseline")})
    st.markdown("#### Truy nguyên một cảnh báo")
    f = f.sort_values("ts").reset_index(drop=True)
    labels = [f"{i} · {r.session_date} {pd.Timestamp(r.ts).strftime('%H:%M:%S')} · {r.symbol} · {r.type}"
              for i, r in f.iterrows()]
    pick = st.selectbox("Chọn cảnh báo để soi bằng chứng", range(len(labels)), format_func=lambda i: labels[i])
    a = f.iloc[pick]
    e1, e2, e3 = st.columns(3)
    e1.metric("Mức ưu tiên", {"P1": "P1 · Rất hiếm", "P2": "P2 · Hiếm",
                               "P3": "P3 · Bất thường"}.get(a.get("priority", "P3"), "P3"),
              help="Xếp hạng theo độ hiếm ở đuôi phân phối lịch sử; không phải xác suất thua lỗ.")
    e2.metric("Giá trị quan sát", f"{a['signed_value']:,.3f}")
    e3.metric("μ baseline (thang " + a["scale"] + ")", f"{a['mu']:,.3f}")
    e4, e5 = st.columns(2)
    e4.metric("z-score", f"{a['z']:.2f}", help=f"σ hiệu dụng = {a['sigma']:,.3f}; n_train = {a['n_train']}")
    e5.metric("Phân vị thực nghiệm", f"{a['pct']:.3f}")
    st.caption(f"Cơ chế kích hoạt của `{a['type']}`: thang đo **{a['scale']}**, chiều **{a['direction']}**, "
               f"bucket {a['bucket']} (15 phút), baseline từ {a['n_train']} bản ghi của CÁC PHIÊN TRƯỚC. "
                "Diễn giải: giá trị này hiếm gặp so với chính mã này trong cùng khung giờ — không phải so với mã khác. "
                "Ưu tiên P1/P2/P3 lần lượt ứng với đuôi phân vị lịch sử ≥99,9%/99,5%/99%; đây là mức sàng lọc, "
                "không phải xác suất tổn thất hay khuyến nghị giao dịch.")
    snaps_sym = ctx["snaps"][(ctx["snaps"]["session_date"] == a["session_date"]) &
                             (ctx["snaps"]["symbol"] == a["symbol"])].sort_values("ts")
    truth = _truth_events(ctx, a["session_date"], a["symbol"])
    st.plotly_chart(ch.alert_context(snaps_sym, pd.Timestamp(a["ts"]), truth_events=truth),
                    width="stretch", alt="Diễn biến giá, độ sâu và khối lượng quanh thời điểm cảnh báo.")
    if truth:
        st.caption("Vùng nền cam = cửa sổ sự kiện ground-truth của bộ mô phỏng (chỉ có ở SYNTHETIC).")

    pr = ctx["results"].get("alert_pr", pd.DataFrame())
    if len(pr) and ctx["mode"] == "SYNTHETIC":
        st.markdown("#### Cảnh báo có bắt đúng sự kiện thật (ground-truth) không?")
        st.plotly_chart(ch.alert_pr_bar(pr), width="stretch",
                        alt="Precision và recall của cảnh báo so với sự kiện ground-truth synthetic.")
        st.dataframe(pr.rename(columns={"alert_type": "Loại", "n_alerts": "Số cảnh báo", "tp": "TP",
                                        "precision": "Precision", "n_events_mapped": "Số sự kiện",
                                        "events_detected": "Bắt được", "recall": "Recall"}),
                     hide_index=True, width="stretch",
                     column_config={"Precision": st.column_config.NumberColumn(format="%.2f"),
                                    "Recall": st.column_config.NumberColumn(format="%.2f")})
        st.caption("Precision/recall đo trên sự kiện MÔ PHỎNG có chủ đích — kiểm chứng CƠ CHẾ, "
                   "không phải bằng chứng hiệu quả ngoài đời thật. Dung sai khớp ±30s công bố trong docs.")


def _truth_events(ctx: dict, session_date: str, symbol: str) -> list[dict]:
    if ctx["mode"] != "SYNTHETIC":
        return []
    p = ctx["settings"].data_path("raw", f"SYNTH_{session_date}", "events_truth.json")
    if not p.exists():
        return []
    ev = json.loads(p.read_text(encoding="utf-8"))["events"]
    return [e for e in ev if e["symbol"] == symbol]


# ------------------------------------------------------------------ Q4: validation
def view_validation(ctx: dict) -> None:
    st.subheader("Kiểm chứng · Ước tính đáng tin đến đâu?")
    st.caption("Walk-forward 5 folds (train 1..k → test k+1), bootstrap THEO CỤM PHIÊN, "
               "độ phủ PI + Wilson CI, phân rã theo chế độ phủ sổ. Đưa cả điểm yếu lên giao diện "
               "là chủ đích: kết quả không được trình bày vượt quá khả năng mô hình.")
    summary, results = ctx["summary"], ctx["results"]
    metrics = results.get("metrics", pd.DataFrame())
    preds = results.get("predictions", pd.DataFrame())
    if metrics.empty or preds.empty:
        st.warning("Chưa có kết quả kiểm chứng — chạy `neoscope validate`.")
        return
    colA, colB = st.columns([1, 1.3])
    with colA:
        st.plotly_chart(ch.metrics_bar(metrics), width="stretch",
                        alt="So sánh MAE ngoài mẫu giữa mô hình đầy đủ và các benchmark.")
    with colB:
        st.markdown("##### Bảng sai số ngoài mẫu (bps)")
        st.dataframe(metrics.rename(columns={"model": "Mô hình", "group": "Nhóm", "n": "n lệnh",
                                             "mae_bps": "MAE", "rmse_bps": "RMSE", "bias_bps": "Bias"}),
                     hide_index=True, width="stretch",
                     column_config={"MAE": st.column_config.NumberColumn(format="%.2f"),
                                    "RMSE": st.column_config.NumberColumn(format="%.2f"),
                                    "Bias": st.column_config.NumberColumn(format="%+.2f")})
    mcov = results.get("metrics_coverage", pd.DataFrame())
    if len(mcov):
        st.markdown("##### Phân rã trung thực: trong sổ vs vượt sổ")
        st.dataframe(mcov.rename(columns={"model": "Mô hình", "regime": "Chế độ", "n": "n",
                                          "mae_bps": "MAE", "rmse_bps": "RMSE", "bias_bps": "Bias"}),
                     hide_index=True, width="stretch",
                     column_config={"MAE": st.column_config.NumberColumn(format="%.2f"),
                                    "RMSE": st.column_config.NumberColumn(format="%.2f"),
                                    "Bias": st.column_config.NumberColumn(format="%+.2f")})
        st.caption("⚠️ Sai số ≈ 0 của lệnh **trong sổ** là HỆ QUẢ CỦA GIẢ ĐỊNH quét toàn bộ KL hiển thị "
                   "(realized == ladder một cách tất định), KHÔNG phải bằng chứng mô hình giỏi. "
                   "Giá trị gia tăng thật nằm ở chế độ **vượt sổ** — nơi mô hình full phải thắng benchmark.")
    full_preds = preds[preds["model"] == "full"]
    st.plotly_chart(ch.coverage_scatter(full_preds), width="stretch",
                    alt="Đối chiếu implementation shortfall dự báo và thực hiện cho từng lệnh test.")

    boot_fl = summary.get("bootstrap_full_vs_ladder", {})
    boot_beyond = summary.get("bootstrap_full_vs_ladder_beyond_book", {})
    c1, c2 = st.columns(2)
    with c1:
        if boot_fl:
            st.plotly_chart(ch.bootstrap_ci(boot_fl, "ΔMAE full − ladder_only (mọi lệnh)"),
                            width="stretch", alt="Khoảng tin cậy bootstrap theo phiên cho chênh lệch MAE trên toàn bộ lệnh.")
            st.caption(f"Δ = {boot_fl.get('delta_mae_bps', float('nan')):+.2f} bps, "
                       f"CI95 [{boot_fl.get('ci95_lo', float('nan')):.2f}, {boot_fl.get('ci95_hi', float('nan')):.2f}], "
                       f"p = {boot_fl.get('p_two_sided', float('nan')):.3f} · {boot_fl.get('n_sessions', 0)} cụm phiên")
    with c2:
        if boot_beyond and boot_beyond.get("n_sessions"):
            st.plotly_chart(ch.bootstrap_ci(boot_beyond, "ΔMAE full − ladder_only (CHỈ lệnh vượt sổ)"),
                            width="stretch", alt="Khoảng tin cậy bootstrap theo phiên cho lệnh vượt sổ hiển thị.")
            st.caption(f"Δ = {boot_beyond.get('delta_mae_bps', float('nan')):+.2f} bps, "
                       f"CI95 [{boot_beyond.get('ci95_lo', float('nan')):.2f}, {boot_beyond.get('ci95_hi', float('nan')):.2f}], "
                       f"p = {boot_beyond.get('p_two_sided', float('nan')):.3f} — đây là bằng chứng THEN CHỐT.")
    st.caption("Bootstrap theo cụm phiên (không theo lệnh) vì sai số các lệnh cùng phiên tương quan "
               "chế độ thị trường. Chỉ 5 cụm test → công suất thống kê hạn chế, CI rộng là trung thực.")

    cov = results.get("coverage", pd.DataFrame())
    fp = results.get("fold_params", pd.DataFrame())
    c3, c4 = st.columns(2)
    with c3:
        if len(cov):
            st.plotly_chart(ch.pi_coverage_bar(cov), width="stretch",
                            alt="Độ phủ thực tế của khoảng dự báo theo nhóm và chế độ phủ sổ.")
    with c4:
        if len(fp):
            st.plotly_chart(ch.fold_params_fig(fp), width="stretch",
                            alt="Tham số hiệu chỉnh theo từng fold walk-forward.")
    if len(cov):
        bb = cov[cov["group"] == "ALL:beyond_book"]
        if len(bb):
            r = bb.iloc[0]
            st.caption(f"Độ phủ PI 90% ở chế độ vượt sổ: **{r['coverage']:.1%}** "
                       f"(Wilson [{r['wilson_lo']:.1%}, {r['wilson_hi']:.1%}], n={r['n']}). "
                       "Độ phủ toàn mẫu cao hơn danh nghĩa vì lệnh trong sổ có PI suy biến bề rộng 0 — "
                       "đã tách bạch để không ‘khoe’ độ phủ ảo.")

    st.markdown("##### Giá trị xây dựng của LHS & sức dự báo của OBI (ngoài mẫu)")
    ic = results.get("lhs_ic", pd.DataFrame())
    obi = results.get("obi_direction", pd.DataFrame())
    c5, c6 = st.columns(2)
    with c5:
        if len(ic):
            st.plotly_chart(ch.ic_timeseries(ic), width="stretch",
                            alt="Tương quan thứ hạng giữa LHS và illiquidity tương lai trên các phiên test.")
            st.caption(f"Spearman trung bình mọi phiên test: **{summary.get('lhs_ic_overall', float('nan')):.3f}** "
                       "(âm mạnh = LHS cao → ILLIQ tương lai thấp, đúng kỳ vọng lý thuyết).")
    with c6:
        if len(obi):
            st.plotly_chart(ch.obi_quintile(obi), width="stretch",
                            alt="Lợi nhuận một phút tiếp theo theo ngũ phân vị OBI ngoài mẫu.")
            st.caption("Đơn điệu tăng theo ngũ phân vị OBI → sức dự báo hướng giá ngắn hạn "
                       "(Cont, Kukanov & Stoikov 2014) tái lập được ngoài mẫu.")
    res = results.get("resilience", pd.DataFrame())
    if len(res):
        st.plotly_chart(ch.resilience_hist(res), width="stretch",
                        alt="Phân phối thời gian phục hồi độ sâu sau các nhịp khối lượng cao.")
        rs = summary.get("resilience", {})
        if rs:
            st.json(rs)
            st.caption("Median thời gian phục hồi độ sâu sau cú sốc khối lượng theo nhóm — "
                       "nhóm midcap mỏng phục hồi chậm/kém hơn là rủi ro thanh khoản động đo được.")

    st.markdown("##### Giới hạn trung thực (đọc trước khi tin bất kỳ con số nào ở trên)")
    st.markdown(
        "1. **Dữ liệu SYNTHETIC** (khi ở chế độ mô phỏng): kết quả kiểm chứng là của THẾ GIỚI MÔ PHỎNG, "
        "không phải thị trường thật; ground-truth chỉ tồn tại trong mô phỏng.\n"
        "2. **Sổ 3 mức**: phần vượt sổ phải giả định tham gia thị trường; không mô phỏng hàng đợi/own-impact "
        "→ chi phí lệnh rất lớn là cận dưới.\n"
        "3. **5 cụm phiên test**: công suất thống kê thấp; CI rộng phản ánh đúng bất định.\n"
        "4. **event_ts theo nguồn, fallback arrival_ts**: sai lệch thứ tự được gắn cờ; thông điệp muộn không bị sửa bừa.\n"
        "5. Mô hình **không dự báo giá dài hạn**, không khuyến nghị giao dịch.")


# ------------------------------------------------------------------ data quality
def view_data(ctx: dict) -> None:
    st.subheader("Dữ liệu & chất lượng — mọi 'bẫy' đều được đếm và truy vết")
    st.caption("RAW append-only khi capture (JSONL.gz + SHA-256 manifest lúc đóng phiên) → "
               "chuẩn hóa (cờ chất lượng) → CURATED Parquet. "
               "Người chấm replay toàn bộ pipeline từ RAW: `neoscope process --force`.")
    quality, meta = ctx["quality"], ctx["quality_meta"]
    sessions = ctx["sessions"]
    if len(quality):
        st.plotly_chart(ch.quality_heatmap(quality, sessions), width="stretch",
                        alt="Bản đồ nhiệt các cờ chất lượng dữ liệu theo phiên.")
        tot = quality.groupby("flags")["n"].sum().sort_values(ascending=False).reset_index()
        tot.columns = ["Cờ", "Số bản ghi"]
        c1, c2 = st.columns([1, 1.4])
        c1.dataframe(tot, hide_index=True, width="stretch")
        from ..data.quality import FLAG_DESCRIPTIONS
        c2.markdown("**Ý nghĩa từng cờ** (xem docs/provider_contracts.md và docs/ssi_fastconnect.md)")
        c2.table(pd.DataFrame({"Cờ": list(FLAG_DESCRIPTIONS.keys()),
                               "Xử lý": list(FLAG_DESCRIPTIONS.values())}).set_index("Cờ"))
    if len(meta):
        st.markdown("##### Sổ cái pipeline theo phiên")
        m = meta.rename(columns={"session_date": "Phiên", "n_raw": "RAW", "n_curated": "Curated",
                                 "n_duplicates_dropped": "Lặp bị loại"})
        st.dataframe(m, hide_index=True, width="stretch")
    mans = ctx["manifests"]
    if mans:
        with st.expander("🔐 Manifest truy vết (sha256 từng tệp RAW + config_hash + seed)"):
            rows = []
            for man in mans:
                rows.append({"Phiên": man["date"], "Capture": man.get("session_dir"),
                             "Thông điệp": man.get("total_messages"),
                             "synthetic": man.get("synthetic"), "seed": man.get("seed"),
                             "config_hash": man.get("config_hash"),
                             "sha256(stockInfo)": (man.get("sha256") or {}).get("stockInfo.jsonl.gz", "")[:16] + "…"})
            st.dataframe(pd.DataFrame(rows), hide_index=True, width="stretch")
    st.markdown(f"##### Từ điển dữ liệu rút gọn — {ctx['settings'].provider}")
    if ctx["settings"].provider == "SSI":
        st.markdown(
            "| Trường nguồn | Kiểu/đơn vị | Chuẩn hóa | Ghi chú |\n|---|---|---|---|\n"
            "| `bid_prices` / `ask_prices` | danh sách, nghìn VND | VND; ba mức đầu | Giữ payload SSI trong RAW |\n"
            "| `price`, `avg` | VND | giữ VND | Giá giao dịch/giá bình quân |\n"
            "| `total_volume` | lũy kế phiên | delta | Giá trị giao dịch xấp xỉ từ avg × volume |\n"
            "| ngoại mua/bán | semantics chưa xác nhận | không đưa vào flow analytics | RAW giữ nguyên |\n"
            "| `indexsummary.data` | payload SSI | marketInfo | Thời gian sự kiện/arrival hiển thị theo UTC+7 |")
        channels = "ssi_quote, ssi_trade, ssi_room, ssi_market, ssi_indexsummary"
    elif ctx["settings"].provider == "NEO":
        st.markdown(
            "| Trường NEO | Kiểu gốc | Chuẩn hóa | Ghi chú |\n|---|---|---|---|\n"
            "| `bidPrice1/askPrice1` | chuỗi, có thể ATO/ATC | float hoặc null + cờ | Không ép số bừa |\n"
            "| `totalBidQTTY/totalAskQTTY` | có thể null | null + cờ | Không điền 0 |\n"
            "| `totalTradingVolume/Value` | lũy kế phiên | delta đơn điệu | Muộn/reset được gắn cờ |\n"
            "| foreign flow | phụ thuộc payload NEO | cờ chất lượng | Theo hợp đồng NEO được cấu hình |\n"
            "| `indexValue` | có thể là chuỗi | float | marketInfo |\n"
            "| timestamp | có thể thiếu múi giờ | `Asia/Ho_Chi_Minh` | Nguồn thời gian giữ trong RAW |")
        channels = "stockInfo, marketInfo, marketVolume, marketSession"
    else:
        st.markdown("Dữ liệu mô phỏng theo schema canonical; xem manifest để biết seed và phiên bản bộ sinh.")
        channels = "stockInfo, marketInfo"
    st.info(f"Channel RAW của nguồn đang chọn: `{channels}`.", icon="📡")


# ------------------------------------------------------------------ method docs
def view_method(ctx: dict) -> None:
    st.subheader("Phương pháp & giới hạn — toàn bộ công thức, ngưỡng và lý do")
    st.caption("Tài liệu được viết thành các mục ngắn để tra cứu khi cần; các kết quả chính vẫn nằm ở từng màn hình phân tích.")
    docs = [("methodology.md", "Khung lý thuyết & công thức"),
            ("thresholds.md", "Biện giải từng ngưỡng cảnh báo"),
            ("validation_protocol.md", "Giao thức kiểm chứng ngoài mẫu"),
            ("limitations.md", "Giới hạn & sử dụng có trách nhiệm"),
            ("architecture.md", "Kiến trúc hệ thống"),
            ("references.md", "Tài liệu tham khảo học thuật")]
    labels = [label for _, label in docs]
    selected = st.selectbox("Chọn mục tài liệu", labels)
    fname = docs[labels.index(selected)][0]
    p = REPO_ROOT / "docs" / fname
    with st.container(border=True):
        if p.exists():
            st.markdown(p.read_text(encoding="utf-8"))
        else:
            st.warning(f"Thiếu docs/{fname}.")
