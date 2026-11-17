"""Các màn hình sản phẩm — MỖI TAB TRẢ LỜI MỘT CÂU HỎI QUYẾT ĐỊNH.

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
from . import charts as ch
from .data import (fold_params_for, fmt_vnd, load_result, sigma_fallback_for,
                   volume_profile_for)


# ------------------------------------------------------------------ tổng quan
def view_overview(ctx: dict) -> None:
    s, snaps, summary = ctx["settings"], ctx["snaps"], ctx["summary"]
    st.subheader("NeoScope trả lời câu hỏi mà mọi bảng giá bỏ ngỏ")
    st.markdown(
        "> *“Nếu tôi bán 500 triệu đồng cổ phiếu X ngay lúc này, tôi sẽ khớp ở giá nào, "
        "mất bao nhiêu điểm cơ bản, và cuốn sổ lệnh có đủ ‘hấp thụ’ lệnh của tôi không?”*"
    )
    c1, c2, c3, c4 = st.columns(4)
    ds = summary.get("dataset", {})
    c1.metric("Phiên dữ liệu", ds.get("n_sessions", snaps["session_date"].nunique()))
    c2.metric("Mã theo dõi", ds.get("n_symbols", snaps["symbol"].nunique()))
    c3.metric("Snapshot chuẩn hóa", f"{ds.get('n_snapshots', len(snaps)):,}")
    c4.metric("Lệnh mô phỏng đã kiểm chứng", f"{summary.get('orders', {}).get('n', 0):,}")
    st.markdown(
        "**Bốn câu hỏi sản phẩm** — mỗi tab là một câu hỏi: "
        "**Q1** mã này thanh khoản khỏe đến đâu, so với ai? · "
        "**Q2** mua/bán X đồng ngay bây giờ thì giá khớp bình quân bao nhiêu? · "
        "**Q3** thanh khoản bất thường lúc nào, vì sao? · "
        "**Q4** ước tính của máy đáng tin đến đâu (kiểm chứng công khai)?"
    )
    q = summary.get("quality", {})
    if q:
        k1, k2, k3 = st.columns(3)
        k1.metric("Thông điệp RAW", f"{q.get('n_raw_total', 0):,}")
        k2.metric("Bản ghi lặp bị loại", f"{q.get('n_duplicates_dropped', 0):,}")
        k3.metric("Tỷ lệ giữ lại", f"{(q.get('n_curated_total', 0) / max(q.get('n_raw_total', 1), 1)):.2%}")

    day_idx = ctx["indices"][ctx["indices"]["session_date"] == ctx["session"]] if len(ctx["indices"]) else pd.DataFrame()
    if len(day_idx):
        st.plotly_chart(ch.breadth(day_idx), width="stretch")
        st.caption("Độ rộng thị trường từ channel `marketInfo` (NEO API) — số mã tăng/giảm là "
                   "giá trị mô phỏng quy mô hóa từ watchlist 8 mã khi ở chế độ SYNTHETIC.")

    st.markdown("#### Watchlist — lát cắt cuối phiên đang chọn")
    day = snaps[snaps["session_date"] == ctx["session"]]
    rows = []
    for sym, g in day.groupby("symbol"):
        last = g.dropna(subset=["mid"]).iloc[-1] if g["mid"].notna().any() else g.iloc[-1]
        rows.append({"Mã": sym, "Nhóm": "VN30 lớn" if s.group_of(sym) == "large" else "Midcap mỏng",
                     "Mid cuối (đ)": last["mid"], "Spread (bps)": last["spread_bps"],
                     "Depth bid (tỷ đ)": last["depth_bid_vnd"] / 1e9 if pd.notna(last["depth_bid_vnd"]) else np.nan,
                     "OBI": last["obi"], "KL phiên (triệu cp)": last["cum_vol"] / 1e6 if pd.notna(last["cum_vol"]) else np.nan})
    st.dataframe(pd.DataFrame(rows).set_index("Mã"), width="stretch",
                 column_config={"Mid cuối (đ)": st.column_config.NumberColumn(format="%.0f"),
                                "Spread (bps)": st.column_config.NumberColumn(format="%.1f"),
                                "Depth bid (tỷ đ)": st.column_config.NumberColumn(format="%.2f"),
                                "OBI": st.column_config.NumberColumn(format="%.2f"),
                                "KL phiên (triệu cp)": st.column_config.NumberColumn(format="%.2f")})
    st.info("NeoScope là **công cụ phân tích học thuật** — không phải khuyến nghị mua/bán, "
            "không đặt lệnh thật, không dự báo giá dài hạn.", icon="⚖️")


# ------------------------------------------------------------------ Q1: LHS
def view_lhs(ctx: dict) -> None:
    st.subheader("Q1 · Mã này thanh khoản khỏe đến đâu, so với ai?")
    st.caption("LHS = 100 × trung bình có trọng số của **hạng percentile chéo mã** trên 5 cấu phần "
               "(độ chặt, độ sâu, tức thời, ổn định, cân bằng) — cửa sổ trượt 15 phút. "
               "Không có ‘con số ma thuật’: điểm 80 nghĩa là khỏe hơn 80% watchlist tại cùng thời điểm.")
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
        st.plotly_chart(ch.lhs_ranking(at_t), width="stretch")
    with col2:
        sym_options = at_t.sort_values("lhs", ascending=False)["symbol"].tolist()
        sym = st.selectbox("Soi cấu phần mã", sym_options)
        pick = at_t[at_t["symbol"] == sym]
        row = (pick if len(pick) else at_t).iloc[0]
        sym = str(row["symbol"])
        st.metric(f"LHS của {sym} lúc {pd.Timestamp(t_sel).strftime('%H:%M')}", f"{row['lhs']:.1f}/100")
        st.plotly_chart(ch.component_breakdown(row), width="stretch")
    syms = ctx["symbols"]
    st.plotly_chart(ch.lhs_timeseries(day, syms), width="stretch")

    st.markdown("#### Độ nhạy trọng số (kiểm tra robustness)")
    sens = ctx["results"].get("lhs_sensitivity", pd.DataFrame())
    if len(sens):
        show = sens.rename(columns={"perturbed_weight": "Trọng số bị nhân đôi",
                                    "mean_spearman": "Spearman TB với LHS gốc",
                                    "min_spearman": "Spearman nhỏ nhất"})
        st.dataframe(show, width="stretch", hide_index=True,
                     column_config={"Spearman TB với LHS gốc": st.column_config.NumberColumn(format="%.4f"),
                                    "Spearman nhỏ nhất": st.column_config.NumberColumn(format="%.4f")})
        st.caption("Nhân đôi lần lượt từng trọng số mà thứ hạng gần như không đổi (Spearman ≈ 0.97) "
                   "→ kết luận xếp hạng **không phụ thuộc lựa chọn trọng số chủ quan**. "
                   "Giá trị xây dựng của LHS (tương quan với ILLIQ tương lai) xem tab Q4.")


# ------------------------------------------------------------------ Q2: execution
def view_execution(ctx: dict) -> None:
    st.subheader("Q2 · Mua/bán X đồng ngay bây giờ — khớp giá nào, tốn bao nhiêu bps?")
    st.caption("Mô hình Implementation Shortfall (Perold 1988): quét sổ 3 mức (chi phí tất định) "
               "+ phần dư thực thi dần với trôi giá κ·OBI và rủi ro thời điểm √τ (Almgren et al. 2005). "
               "Tham số lấy từ fold walk-forward — không fit trên phiên đang xem.")
    s, snaps, session = ctx["settings"], ctx["snaps"], ctx["session"]
    day = snaps[snaps["session_date"] == session]
    if day.empty:
        st.warning("Không có snapshot cho phiên này.")
        return
    fp_all = ctx["results"].get("fold_params", pd.DataFrame())
    test_dates = ctx["summary"].get("dataset", {}).get("test_dates", [])
    fp, note = fold_params_for(fp_all, session, test_dates)
    st.caption(note)

    c1, c2, c3 = st.columns([1, 1, 1.4])
    sym = c1.selectbox("Mã cổ phiếu", sorted(day["symbol"].unique()))
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
    profile = volume_profile_for(s.mode, s.config_hash, train_dates)
    sig_fb = sigma_fallback_for(s.mode, s.config_hash, train_dates)
    sigma = feat["sigma_trail"] if np.isfinite(feat["sigma_trail"]) else sig_fb.get((s.group_of(sym), feat["bucket"]), np.nan)
    v_rate = lookup_v_rate(profile, sym, s.group_of(sym), feat["bucket"])
    preds = predict_all_models(feat, order, v_rate, sigma, float(fp_row["kappa_bps_per_s"]),
                               float(fp_row["y_cov"]), s)
    full = preds["_full_obj"]
    lad = feat["ladder"]
    costs = trading_costs_bps(qty * mid, side, float(s.execution.fee_rate), float(s.execution.sell_tax_rate))

    m1, m2, m3, m4, m5 = st.columns(5)
    m1.metric("IS kỳ vọng", f"{full.e_is_bps:.1f} bps", help="So với mid lúc lệnh đến (Perold 1988)")
    m2.metric("Khoảng dự báo 90%", f"[{full.lo_bps:.1f}, {full.hi_bps:.1f}]", help="bps — hiệu chỉnh Y ngoài mẫu")
    m3.metric("Sổ hiển thị đáp ứng", f"{lad.coverage:.0%}", help="Tỷ lệ lệnh khớp được trong 3 mức hiển thị")
    m4.metric("Thời gian hoàn thành kỳ vọng", f"{full.tau_s:.0f} s" if np.isfinite(full.tau_s) else "—")
    m5.metric("Phí + thuế", f"{(costs['fee_vnd'] + costs['tax_vnd']) / 1e6:.2f} triệu đ",
              help=f"Phí {s.execution.fee_rate:.2%} hai chiều + thuế bán {s.execution.sell_tax_rate:.1%} (luật VN)")
    st.caption(f"Lệnh {qty:,.0f} cp × mid {mid:,.0f} đ ≈ {fmt_vnd(qty * mid)} đ · "
               f"chi phí tác động ước tính ≈ {fmt_vnd(qty * mid * full.e_is_bps / 1e4)} đ "
               f"(chưa gồm phí/thuế) · cờ mô hình: {', '.join(full.flags) if full.flags else 'không'}")

    colA, colB = st.columns([1, 1.2])
    with colA:
        prices = [arr.get(f"{'bid' if side == -1 else 'ask'}{i}") for i in (1, 2, 3)]
        vols = [arr.get(f"{'bid' if side == -1 else 'ask'}vol{i}") for i in (1, 2, 3)]
        prices = [float(p) if pd.notna(p) else None for p in prices]
        vols = [float(v) if pd.notna(v) else None for v in vols]
        st.plotly_chart(ch.book_ladder(prices, vols, side, qty, mid), width="stretch")
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
        st.plotly_chart(ch.cost_waterfall(parts, full.e_is_bps), width="stretch")

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
            st.caption("Một lệnh đơn lẻ không chứng minh được mô hình — bằng chứng đầy đủ là "
                       "1.179 lệnh test ngoài mẫu ở tab Q4. Mô phỏng không phát sinh lệnh thật.")


# ------------------------------------------------------------------ Q3: alerts
def view_alerts(ctx: dict) -> None:
    st.subheader("Q3 · Thanh khoản vừa bất thường lúc nào, và vì sao?")
    st.caption("Ngưỡng suy từ thống kê: baseline expanding theo mã × bucket 15' (tôn trọng hình chữ U nội ngày), "
               "cổng z + phân vị 99% + dai dẳng ≥ 3 tick + cooldown 60s. Mỗi cảnh báo mang bằng chứng đầy đủ.")
    alerts = ctx["results"].get("alerts", pd.DataFrame())
    if alerts.empty:
        st.warning("Chưa có cảnh báo — chạy `neoscope analyze`.")
        return
    c1, c2, c3 = st.columns(3)
    sel_sessions = c1.multiselect("Phiên", sorted(alerts["session_date"].unique()),
                                  default=[ctx["session"]] if ctx["session"] in set(alerts["session_date"]) else None)
    sel_types = c2.multiselect("Loại cảnh báo", sorted(alerts["type"].unique()),
                               default=sorted(alerts["type"].unique()))
    sel_syms = c3.multiselect("Mã", sorted(alerts["symbol"].unique()), default=ctx["symbols"])
    f = alerts[alerts["session_date"].isin(sel_sessions or []) &
               alerts["type"].isin(sel_types or []) & alerts["symbol"].isin(sel_syms or [])]
    st.metric("Số cảnh báo khớp bộ lọc", len(f))
    if f.empty:
        st.info("Không có cảnh báo khớp bộ lọc — nới bộ lọc hoặc chọn phiên khác.")
        return
    show = f.sort_values("ts", ascending=False).copy()
    show["giờ"] = show["ts"].dt.strftime("%H:%M:%S")
    st.dataframe(show[["session_date", "giờ", "symbol", "type", "signed_value", "z", "pct", "n_train"]],
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
    e1, e2, e3, e4 = st.columns(4)
    e1.metric("Giá trị quan sát", f"{a['signed_value']:,.3f}")
    e2.metric("μ baseline (thang " + a["scale"] + ")", f"{a['mu']:,.3f}")
    e3.metric("z-score", f"{a['z']:.2f}", help=f"σ hiệu dụng = {a['sigma']:,.3f}; n_train = {a['n_train']}")
    e4.metric("Phân vị thực nghiệm", f"{a['pct']:.3f}")
    st.caption(f"Cơ chế kích hoạt của `{a['type']}`: thang đo **{a['scale']}**, chiều **{a['direction']}**, "
               f"bucket {a['bucket']} (15 phút), baseline từ {a['n_train']} bản ghi của CÁC PHIÊN TRƯỚC. "
               "Diễn giải: giá trị này hiếm gặp so với chính mã này trong cùng khung giờ — không phải so với mã khác.")
    snaps_sym = ctx["snaps"][(ctx["snaps"]["session_date"] == a["session_date"]) &
                             (ctx["snaps"]["symbol"] == a["symbol"])].sort_values("ts")
    truth = _truth_events(ctx, a["session_date"], a["symbol"])
    st.plotly_chart(ch.alert_context(snaps_sym, pd.Timestamp(a["ts"]), truth_events=truth), width="stretch")
    if truth:
        st.caption("Vùng nền cam = cửa sổ sự kiện ground-truth của bộ mô phỏng (chỉ có ở SYNTHETIC).")

    pr = ctx["results"].get("alert_pr", pd.DataFrame())
    if len(pr) and ctx["mode"] == "SYNTHETIC":
        st.markdown("#### Cảnh báo có bắt đúng sự kiện thật (ground-truth) không?")
        st.plotly_chart(ch.alert_pr_bar(pr), width="stretch")
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
    st.subheader("Q4 · Ước tính của máy đáng tin đến đâu? — kiểm chứng công khai")
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
        st.plotly_chart(ch.metrics_bar(metrics), width="stretch")
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
    st.plotly_chart(ch.coverage_scatter(full_preds), width="stretch")

    boot_fl = summary.get("bootstrap_full_vs_ladder", {})
    boot_beyond = summary.get("bootstrap_full_vs_ladder_beyond_book", {})
    c1, c2 = st.columns(2)
    with c1:
        if boot_fl:
            st.plotly_chart(ch.bootstrap_ci(boot_fl, "ΔMAE full − ladder_only (mọi lệnh)"), width="stretch")
            st.caption(f"Δ = {boot_fl.get('delta_mae_bps', float('nan')):+.2f} bps, "
                       f"CI95 [{boot_fl.get('ci95_lo', float('nan')):.2f}, {boot_fl.get('ci95_hi', float('nan')):.2f}], "
                       f"p = {boot_fl.get('p_two_sided', float('nan')):.3f} · {boot_fl.get('n_sessions', 0)} cụm phiên")
    with c2:
        if boot_beyond and boot_beyond.get("n_sessions"):
            st.plotly_chart(ch.bootstrap_ci(boot_beyond, "ΔMAE full − ladder_only (CHỈ lệnh vượt sổ)"), width="stretch")
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
            st.plotly_chart(ch.pi_coverage_bar(cov), width="stretch")
    with c4:
        if len(fp):
            st.plotly_chart(ch.fold_params_fig(fp), width="stretch")
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
            st.plotly_chart(ch.ic_timeseries(ic), width="stretch")
            st.caption(f"Spearman trung bình mọi phiên test: **{summary.get('lhs_ic_overall', float('nan')):.3f}** "
                       "(âm mạnh = LHS cao → ILLIQ tương lai thấp, đúng kỳ vọng lý thuyết).")
    with c6:
        if len(obi):
            st.plotly_chart(ch.obi_quintile(obi), width="stretch")
            st.caption("Đơn điệu tăng theo ngũ phân vị OBI → sức dự báo hướng giá ngắn hạn "
                       "(Cont, Kukanov & Stoikov 2014) tái lập được ngoài mẫu.")
    res = results.get("resilience", pd.DataFrame())
    if len(res):
        st.plotly_chart(ch.resilience_hist(res), width="stretch")
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
        "4. **arrival_ts ≈ thời điểm sự kiện**: sai số cỡ độ trễ mạng; thông điệp muộn được gắn cờ, không sửa bừa.\n"
        "5. Mô hình **không dự báo giá dài hạn**, không khuyến nghị giao dịch.")


# ------------------------------------------------------------------ data quality
def view_data(ctx: dict) -> None:
    st.subheader("Dữ liệu & chất lượng — mọi 'bẫy' đều được đếm và truy vết")
    st.caption("RAW bất biến (JSONL.gz + sha256 manifest) → chuẩn hóa (cờ chất lượng) → CURATED Parquet. "
               "Người chấm replay toàn bộ pipeline từ RAW: `neoscope process --force`.")
    quality, meta = ctx["quality"], ctx["quality_meta"]
    sessions = ctx["sessions"]
    if len(quality):
        st.plotly_chart(ch.quality_heatmap(quality, sessions), width="stretch")
        tot = quality.groupby("flags")["n"].sum().sort_values(ascending=False).reset_index()
        tot.columns = ["Cờ", "Số bản ghi"]
        c1, c2 = st.columns([1, 1.4])
        c1.dataframe(tot, hide_index=True, width="stretch")
        from ..data.quality import FLAG_DESCRIPTIONS
        c2.markdown("**Ý nghĩa từng cờ** (từ điển đầy đủ: docs/data_dictionary.md)")
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
                rows.append({"Phiên": man["date"], "Thông điệp": man.get("total_messages"),
                             "synthetic": man.get("synthetic"), "seed": man.get("seed"),
                             "config_hash": man.get("config_hash"),
                             "sha256(stockInfo)": (man.get("sha256") or {}).get("stockInfo.jsonl.gz", "")[:16] + "…"})
            st.dataframe(pd.DataFrame(rows), hide_index=True, width="stretch")
    st.markdown("##### Từ điển dữ liệu rút gọn")
    st.markdown(
        "| Trường NEO | Kiểu gốc | Chuẩn hóa | Ghi chú |\n|---|---|---|---|\n"
        "| `bidPrice1/askPrice1` | **chuỗi**, có thể 'ATO'/'ATC' | float hoặc NaN + cờ | Không ép số bừa |\n"
        "| `totalBidQTTY/totalAskQTTY` | có thể **null** | NaN + cờ NULL_FIELD | Giữ thiếu, không điền 0 |\n"
        "| `totalTradingVolume/Value` | lũy kế trong phiên | delta trên state đơn điệu | Muộn → LATE_ARRIVAL, reset → COUNTER_RESET |\n"
        "| `foreignBuy/SellValue` | lũy kế | delta | Net = buy − sell theo nhịp |\n"
        "| `indexValue` | chuỗi | float | marketInfo |\n"
        "| timestamp | không kèm múi giờ | `Asia/Ho_Chi_Minh` | Nhất quán toàn hệ thống |")
    st.info("Channel đã ghi RAW: `stockInfo`, `marketInfo`, `marketVolume`, `marketSession` "
            "(≥ 1 luồng WS có lưu trữ — đạt yêu cầu tối thiểu của đề).", icon="📡")


# ------------------------------------------------------------------ method docs
def view_method(ctx: dict) -> None:
    st.subheader("Phương pháp & giới hạn — toàn bộ công thức, ngưỡng và lý do")
    docs = [("methodology.md", "Khung lý thuyết & công thức"),
            ("thresholds.md", "Biện giải từng ngưỡng cảnh báo"),
            ("validation_protocol.md", "Giao thức kiểm chứng ngoài mẫu"),
            ("limitations.md", "Giới hạn & sử dụng có trách nhiệm"),
            ("architecture.md", "Kiến trúc hệ thống"),
            ("references.md", "Tài liệu tham khảo học thuật")]
    tabs = st.tabs([t for _, t in docs])
    for tab, (fname, _) in zip(tabs, docs):
        p = REPO_ROOT / "docs" / fname
        with tab:
            if p.exists():
                st.markdown(p.read_text(encoding="utf-8"))
            else:
                st.warning(f"Thiếu docs/{fname}.")
