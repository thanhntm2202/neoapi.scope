"""Thư viện biểu đồ Plotly của NeoScope — nhất quán, chú thích tiếng Việt.

Quy ước: trục thời gian luôn UTC+7; màu nhóm large/thin cố định để người
dùng không phải học lại chú giải giữa các màn hình; mọi hình đều có tiêu đề
trả lời câu hỏi, không trang trí.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots

C_LARGE = "#38bdf8"
C_THIN = "#fbbf24"
C_ACCENT = "#2dd4bf"
C_BAD = "#f87171"
C_GOOD = "#34d399"
C_GRID = "#1c2942"
C_TEXT = "#b8c5da"
C_MUTED = "#64789c"
GROUP_COLORS = {"large": C_LARGE, "thin": C_THIN}
MODEL_COLORS = {"naive_mid": "#64748b", "ladder_only": "#fbbf24", "full": "#2dd4bf"}


def _base(fig: go.Figure, height: int = 360, title: str | None = None) -> go.Figure:
    fig.update_layout(
        template="plotly_dark", height=height,
        margin=dict(l=10, r=10, t=48 if title else 24, b=10),
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        font=dict(family="Inter, Segoe UI, sans-serif", size=13, color=C_TEXT),
        title=dict(text=title, font=dict(size=15, color="#e8f0fc")) if title else None,
        legend=dict(orientation="h", yanchor="bottom", y=1.02, x=0,
                    font=dict(size=11, color=C_TEXT), bgcolor="rgba(10,15,28,0.6)"),
        hoverlabel=dict(font_size=12, bgcolor="#0d1424", font_color="#e6edf7",
                        bordercolor="#22314f"),
    )
    fig.update_xaxes(gridcolor=C_GRID, zerolinecolor=C_GRID, linecolor=C_GRID)
    fig.update_yaxes(gridcolor=C_GRID, zerolinecolor=C_GRID, linecolor=C_GRID)
    return fig


def lhs_ranking(df_latest: pd.DataFrame) -> go.Figure:
    d = df_latest.sort_values("lhs")
    fig = go.Figure(go.Bar(
        x=d["lhs"], y=d["symbol"], orientation="h",
        marker_color=[GROUP_COLORS.get(g, C_ACCENT) for g in d["group"]],
        text=[f"{v:.1f}" for v in d["lhs"]], textposition="outside",
        hovertemplate="%{y}: LHS %{x:.1f}/100<extra></extra>",
    ))
    fig.update_xaxes(range=[0, 108], title="Liquidity Health Score (0–100)")
    return _base(fig, 340, "Xếp hạng sức khỏe thanh khoản tại thời điểm chọn")


def lhs_timeseries(day_lhs: pd.DataFrame, symbols: list[str]) -> go.Figure:
    fig = go.Figure()
    for sym in symbols:
        g = day_lhs[day_lhs["symbol"] == sym].dropna(subset=["lhs"])
        grp = g["group"].iloc[0] if len(g) else "large"
        fig.add_trace(go.Scatter(x=g["bar_ts"], y=g["lhs"], name=sym,
                                 line=dict(color=GROUP_COLORS.get(grp, C_ACCENT),
                                           width=1.6, dash="dot" if grp == "thin" else "solid"),
                                 hovertemplate=f"{sym} %{{x|%H:%M}} LHS %{{y:.1f}}<extra></extra>"))
    fig.update_yaxes(range=[0, 100], title="LHS")
    fig.update_xaxes(title="Giờ phiên (UTC+7)")
    return _base(fig, 360, "Diễn biến LHS trong phiên (cửa sổ trượt 15 phút)")


def component_breakdown(row: pd.Series) -> go.Figure:
    comps = ["tightness", "depth", "immediacy", "stability", "balance"]
    labels = ["Độ chặt spread", "Độ sâu", "Tức thời (ILLIQ)", "Ổn định spread", "Cân bằng OBI"]
    vals = [100 * float(row[f"r_{c}"]) for c in comps]
    fig = go.Figure(go.Bar(x=labels, y=vals, marker_color=C_ACCENT,
                           text=[f"{v:.0f}" for v in vals], textposition="outside",
                           hovertemplate="%{x}: hạng percentile %{y:.0f}%<extra></extra>"))
    fig.update_yaxes(range=[0, 110], title="Percentile chéo watchlist (%)")
    return _base(fig, 320, f"Cấu phần LHS của {row['symbol']} — 'khỏe' ở đâu, 'yếu' ở đâu")


def book_ladder(prices: list, vols: list, side: int, qty: float, mid: float) -> go.Figure:
    """Sổ lệnh 3 mức phía bị quét + phần lệnh ăn vào từng mức."""
    levels = [(p, v) for p, v in zip(prices, vols) if p is not None and v is not None and np.isfinite(p) and np.isfinite(v)]
    fig = go.Figure()
    remaining = qty
    xs, ys, taken, texts = [], [], [], []
    for i, (p, v) in enumerate(levels, 1):
        t = min(remaining, v)
        remaining -= t
        xs.append(v); ys.append(f"Mức {i} · {p:,.0f}đ")
        taken.append(t)
        texts.append(f"KL hiển thị {v:,.0f} — lệnh ăn {t:,.0f}")
    fig.add_trace(go.Bar(x=xs, y=ys, orientation="h", name="KL hiển thị",
                         marker_color="#cbd5e1", hovertemplate="%{y}: %{x:,.0f} cp<extra></extra>"))
    fig.add_trace(go.Bar(x=taken, y=ys, orientation="h", name="Lệnh của bạn ăn vào",
                         marker_color=C_BAD if side == 1 else C_GOOD,
                         hovertemplate="%{y}: lệnh ăn %{x:,.0f} cp<extra></extra>"))
    fig.update_layout(barmode="overlay")
    fig.update_xaxes(title="Khối lượng (cổ phiếu)")
    ttl = ("Lệnh MUA quét phía BÁN (ask)" if side == 1 else "Lệnh BÁN quét phía MUA (bid)")
    return _base(fig, 300, ttl + ("" if remaining <= 0 else f" — còn {remaining:,.0f} cp vượt sổ hiển thị"))


def cost_waterfall(parts: dict[str, float], total: float) -> go.Figure:
    labels = list(parts.keys()) + ["Tổng IS kỳ vọng"]
    vals = list(parts.values())
    fig = go.Figure(go.Waterfall(
        x=labels, y=vals + [0], measure=["relative"] * len(vals) + ["total"],
        connector=dict(line=dict(color="#94a3b8")),
        increasing=dict(marker=dict(color=C_BAD)),
        decreasing=dict(marker=dict(color=C_GOOD)),
        totals=dict(marker=dict(color=C_ACCENT)),
        text=[f"{v:+.1f}" for v in vals] + [f"{total:.1f} bps"], textposition="outside",
    ))
    fig.update_yaxes(title="bps so với mid lúc đến")
    return _base(fig, 330, "Phân rã chi phí thực thi kỳ vọng (Implementation Shortfall)")


def alert_context(snaps_sym: pd.DataFrame, alert_ts: pd.Timestamp,
                  window_min: int = 10, truth_events: list[dict] | None = None) -> go.Figure:
    t0, t1 = alert_ts - pd.Timedelta(minutes=window_min), alert_ts + pd.Timedelta(minutes=window_min)
    g = snaps_sym[(snaps_sym["ts"] >= t0) & (snaps_sym["ts"] <= t1)]
    fig = make_subplots(rows=3, cols=1, shared_xaxes=True, row_heights=[0.45, 0.3, 0.25],
                        vertical_spacing=0.05,
                        subplot_titles=("Mid & giá khớp", "Độ sâu phía mua (VND)", "KL khớp mỗi nhịp 5s"))
    fig.add_trace(go.Scatter(x=g["ts"], y=g["mid"], name="Mid", line=dict(color=C_ACCENT, width=1.5)), row=1, col=1)
    fig.add_trace(go.Scatter(x=g["ts"], y=g["last_price"], name="Giá khớp", mode="markers",
                             marker=dict(size=3, color="#94a3b8")), row=1, col=1)
    fig.add_trace(go.Scatter(x=g["ts"], y=g["depth_bid_vnd"], name="Depth bid",
                             line=dict(color=C_LARGE, width=1.3)), row=2, col=1)
    fig.add_trace(go.Bar(x=g["ts"], y=g["d_vol"], name="d_vol", marker_color="#64748b"), row=3, col=1)
    fig.add_vline(x=alert_ts, line_color=C_BAD, line_dash="dash",
                  annotation_text="cảnh báo", annotation_position="top")
    if truth_events:
        for e in truth_events:
            s = pd.Timestamp(e["start_ts"]); t = pd.Timestamp(e["end_ts"])
            if t >= t0 and s <= t1:
                fig.add_vrect(x0=max(s, t0), x1=min(t, t1), fillcolor="#f59e0b", opacity=0.12,
                              line_width=0, row="all", col=1)
    fig.update_xaxes(title="Giờ (UTC+7)", row=3, col=1)
    return _base(fig, 520, "Truy nguyên cảnh báo: chuyện gì đã xảy ra quanh thời điểm kích hoạt")


def metrics_bar(metrics: pd.DataFrame) -> go.Figure:
    d = metrics[metrics["group"] == "ALL"]
    fig = go.Figure()
    for _, r in d.iterrows():
        fig.add_trace(go.Bar(x=[r["model"]], y=[r["mae_bps"]], name=r["model"],
                             marker_color=MODEL_COLORS.get(r["model"], C_ACCENT),
                             text=[f"{r['mae_bps']:.2f}"], textposition="outside",
                             hovertemplate=f"{r['model']}: MAE %{{y:.2f}} bps (n={r['n']})<extra></extra>"))
    fig.update_layout(showlegend=False)
    fig.update_yaxes(title="MAE ngoài mẫu (bps)")
    return _base(fig, 320, "Sai số tuyệt đối trung bình — 3 mô hình, toàn bộ lệnh test")


def coverage_scatter(preds_full: pd.DataFrame) -> go.Figure:
    d = preds_full.copy()
    d["regime"] = np.where(d["coverage"] >= 1.0, "trong sổ (tất định)", "vượt sổ (rủi ro)")
    fig = go.Figure()
    for reg, color in (("trong sổ (tất định)", "#94a3b8"), ("vượt sổ (rủi ro)", C_ACCENT)):
        g = d[d["regime"] == reg]
        fig.add_trace(go.Scatter(x=g["realized_is_bps"], y=g["e_is_bps"], mode="markers", name=reg,
                                 marker=dict(size=5, color=color, opacity=0.6),
                                 hovertemplate="realized %{x:.1f} bps<br>dự báo %{y:.1f} bps<extra></extra>"))
    lim = float(np.nanpercentile(np.abs(np.r_[d["realized_is_bps"], d["e_is_bps"]]), 99.5)) + 5
    fig.add_trace(go.Scatter(x=[-lim, lim], y=[-lim, lim], mode="lines", name="y = x",
                             line=dict(color=C_BAD, dash="dash", width=1)))
    fig.update_xaxes(title="IS thực hiện (bps)", range=[-lim, lim])
    fig.update_yaxes(title="IS dự báo (bps)", range=[-lim, lim])
    return _base(fig, 400, "Dự báo vs thực hiện — lệnh vượt sổ mới là nơi mô hình phải chứng minh giá trị")


def bootstrap_ci(boot: dict, title: str) -> go.Figure:
    per = boot.get("per_session", {})
    fig = go.Figure()
    if per:
        xs = list(per.keys()); ys = list(per.values())
        fig.add_trace(go.Scatter(x=xs, y=ys, mode="markers", name="ΔMAE từng phiên test",
                                 marker=dict(size=9, color=C_LARGE)))
    d = boot.get("delta_mae_bps", np.nan)
    lo, hi = boot.get("ci95_lo", np.nan), boot.get("ci95_hi", np.nan)
    fig.add_trace(go.Scatter(x=["GỘP (bootstrap cụm phiên)"], y=[d], mode="markers",
                             error_y=dict(type="data", symmetric=False,
                                          array=[hi - d], arrayminus=[d - lo], color=C_BAD),
                             marker=dict(size=12, color=C_BAD), name="ΔMAE gộp + CI95"))
    fig.add_hline(y=0, line_dash="dash", line_color="#64748b")
    fig.update_yaxes(title="ΔMAE (bps) — âm = full tốt hơn")
    return _base(fig, 330, title)


def pi_coverage_bar(cov: pd.DataFrame) -> go.Figure:
    d = cov[cov["group"].isin(["ALL", "ALL:in_book", "ALL:beyond_book"])].copy()
    labels = {"ALL": "Tất cả lệnh", "ALL:in_book": "Trong sổ (PI suy biến)", "ALL:beyond_book": "Vượt sổ (PI có ý nghĩa)"}
    d["label"] = d["group"].map(labels)
    fig = go.Figure()
    fig.add_trace(go.Bar(x=d["label"], y=d["coverage"] * 100,
                         error_y=dict(type="data", symmetric=False,
                                      array=(d["wilson_hi"] - d["coverage"]) * 100,
                                      arrayminus=(d["coverage"] - d["wilson_lo"]) * 100),
                         marker_color=[C_ACCENT, "#94a3b8", C_LARGE],
                         text=[f"{v:.1f}%" for v in d["coverage"] * 100], textposition="outside"))
    fig.add_hline(y=90, line_dash="dash", line_color=C_BAD, annotation_text="danh nghĩa 90%")
    fig.update_yaxes(range=[0, 112], title="Độ phủ thực nghiệm (%) + Wilson CI95")
    return _base(fig, 330, "Khoảng dự báo 90% có phủ đúng 90% không?")


def obi_quintile(tab: pd.DataFrame) -> go.Figure:
    fig = make_subplots(specs=[[{"secondary_y": True}]])
    fig.add_trace(go.Bar(x=tab["quintile"], y=tab["mean_ret_bps"], name="Lợi nhuận phút kế tiếp (bps)",
                         marker_color=[C_BAD if v < 0 else C_GOOD for v in tab["mean_ret_bps"]]), secondary_y=False)
    fig.add_trace(go.Scatter(x=tab["quintile"], y=tab["p_up"] * 100, name="P(tăng) %",
                             line=dict(color=C_ACCENT, width=2), mode="lines+markers"), secondary_y=True)
    fig.update_xaxes(title="Ngũ phân vị OBI (1 = cung áp đảo, 5 = cầu áp đảo)", dtick=1)
    fig.update_yaxes(title="bps", secondary_y=False)
    fig.update_yaxes(title="%", secondary_y=True, range=[0, 100])
    return _base(fig, 330, "OBI có dự báo hướng giá 1 phút ngoài mẫu? (Cont et al. 2014)")


def ic_timeseries(ic: pd.DataFrame) -> go.Figure:
    fig = go.Figure()
    fig.add_trace(go.Scatter(x=ic["session_date"], y=ic["mean_ic"], mode="lines+markers",
                             error_y=dict(type="data", array=ic["std_ic"], visible=True),
                             line=dict(color=C_ACCENT, width=2), name="Spearman TB trong phiên"))
    fig.add_hline(y=0, line_dash="dash", line_color="#64748b")
    fig.update_yaxes(title="Spearman(LHS_t, ILLIQ 15' tương lai)")
    fig.update_xaxes(title="Phiên test")
    return _base(fig, 320, "Giá trị xây dựng của LHS: điểm cao → ILLIQ tương lai thấp (kỳ vọng âm)")


def quality_heatmap(quality: pd.DataFrame, sessions: list[str]) -> go.Figure:
    if quality.empty:
        return go.Figure()
    piv = quality.pivot_table(index="flags", columns="session_date", values="n", aggfunc="sum").fillna(0)
    piv = piv.reindex(columns=sessions)
    fig = go.Figure(go.Heatmap(z=piv.values, x=piv.columns.tolist(), y=piv.index.tolist(),
                               colorscale="YlOrRd", hovertemplate="%{y} · %{x}: %{z} bản ghi<extra></extra>"))
    fig.update_yaxes(autorange="reversed")
    return _base(fig, 380, "Bản đồ cờ chất lượng theo phiên — mọi 'bẫy' dữ liệu đều được đếm")


def breadth(indices_day: pd.DataFrame) -> go.Figure:
    d = indices_day[indices_day["index_code"] == "VNINDEX"].sort_values("ts")
    fig = make_subplots(specs=[[{"secondary_y": True}]])
    fig.add_trace(go.Scatter(x=d["ts"], y=d["advances"], name="Số mã tăng", stackgroup="one",
                             line=dict(width=0.5, color=C_GOOD), fillcolor="rgba(22,163,74,0.35)"), secondary_y=False)
    fig.add_trace(go.Scatter(x=d["ts"], y=-d["declines"], name="Số mã giảm (âm)", stackgroup="two",
                             line=dict(width=0.5, color=C_BAD), fillcolor="rgba(220,38,38,0.35)"), secondary_y=False)
    fig.add_trace(go.Scatter(x=d["ts"], y=d["index_value"], name="VNINDEX",
                             line=dict(color=C_ACCENT, width=2)), secondary_y=True)
    fig.update_yaxes(title="Số mã (watchlist quy mô hóa)", secondary_y=False)
    fig.update_yaxes(title="Điểm chỉ số", secondary_y=True)
    fig.update_xaxes(title="Giờ (UTC+7)")
    return _base(fig, 340, "Độ rộng thị trường trong phiên")


def fold_params_fig(fp: pd.DataFrame) -> go.Figure:
    fig = make_subplots(rows=1, cols=2, subplot_titles=("κ (bps/giây trên mỗi OBI)", "Y (hệ số rủi ro thời điểm)"))
    for grp, color in GROUP_COLORS.items():
        g = fp[fp["group"] == grp].sort_values("fold")
        fig.add_trace(go.Scatter(x=g["fold"], y=g["kappa_bps_per_s"], name=f"κ {grp}",
                                 line=dict(color=color, width=2), mode="lines+markers",
                                 error_y=dict(type="data", array=g["kappa_se"], visible=True)), row=1, col=1)
        fig.add_trace(go.Scatter(x=g["fold"], y=g["y_cov"], name=f"Y {grp}",
                                 line=dict(color=color, width=2, dash="dot"), mode="lines+markers",
                                 showlegend=False), row=1, col=2)
    fig.update_xaxes(title="Fold walk-forward", dtick=1)
    return _base(fig, 320, "Tham số hiệu chỉnh qua các fold — ổn định thì đáng tin, dao động thì phải thận trọng")


def resilience_hist(res: pd.DataFrame) -> go.Figure:
    fig = go.Figure()
    for grp, color in GROUP_COLORS.items():
        g = res[(res["group"] == grp) & res["recover_s"].notna()]
        fig.add_trace(go.Histogram(x=g["recover_s"], name=f"{grp} (n={len(g)})",
                                   marker_color=color, opacity=0.65, nbinsx=40))
    fig.update_layout(barmode="overlay")
    fig.update_xaxes(title="Thời gian phục hồi độ sâu (giây)", range=[0, 180])
    fig.update_yaxes(title="Số episode")
    return _base(fig, 320, "Khả năng phục hồi sau cú sốc khối lượng (resilience)")


def lhs_radar(rows: list[tuple[str, pd.Series]]) -> go.Figure:
    """Radar 5 cấu phần LHS — so trực quan 'chân dung thanh khoản' của 1–2 mã.

    rows: [(symbol, row_của_bars_lhs)] — mỗi row phải có r_tightness, r_depth,
    r_immediacy, r_stability, r_balance (hạng percentile 0–1).
    """
    comps = ["tightness", "depth", "immediacy", "stability", "balance"]
    labels = ["Độ chặt spread", "Độ sâu", "Tức thời (ILLIQ)", "Ổn định spread", "Cân bằng OBI"]
    fig = go.Figure()
    for symbol, row in rows:
        vals = [100 * float(row[f"r_{c}"]) for c in comps]
        grp = row.get("group", "large")
        color = GROUP_COLORS.get(grp, C_ACCENT)
        fig.add_trace(go.Scatterpolar(
            r=vals + [vals[0]], theta=labels + [labels[0]], name=symbol,
            line=dict(color=color, width=2.2),
            fillcolor=color, fill="toself",
            opacity=0.18 if len(rows) > 1 else 0.30,
            hovertemplate=f"{symbol} %{{theta}}: %{{r:.0f}}%<extra></extra>",
        ))
    fig.update_layout(
        polar=dict(
            bgcolor="rgba(0,0,0,0)",
            radialaxis=dict(range=[0, 100], gridcolor=C_GRID, tickfont=dict(size=10, color=C_MUTED),
                            tickvals=[25, 50, 75, 100]),
            angularaxis=dict(gridcolor=C_GRID, tickfont=dict(size=11.5, color=C_TEXT)),
        ),
        showlegend=True,
    )
    return _base(fig, 420, "Radar 5 cấu phần thanh khoản — hình dáng quan trọng hơn điểm tổng")


def alert_pr_bar(pr: pd.DataFrame) -> go.Figure:
    fig = go.Figure()
    fig.add_trace(go.Bar(x=pr["alert_type"], y=pr["precision"] * 100, name="Precision",
                         marker_color=C_ACCENT, text=[f"{v:.0f}%" for v in pr["precision"] * 100], textposition="outside"))
    fig.add_trace(go.Bar(x=pr["alert_type"], y=pr["recall"] * 100, name="Recall (theo sự kiện)",
                         marker_color=C_LARGE, text=[f"{v:.0f}%" for v in pr["recall"] * 100], textposition="outside"))
    fig.update_yaxes(range=[0, 115], title="%")
    fig.update_layout(barmode="group")
    return _base(fig, 330, "Đối chiếu cảnh báo với sự kiện ground-truth (chỉ có ở chế độ SYNTHETIC)")


# ------------------------------------------------------------------ bổ sung nâng cấp UI
def lhs_gauge(value: float, symbol: str, group: str) -> go.Figure:
    """Đồng hồ LHS của một mã — đọc nhanh mức sức khỏe thanh khoản tại một thởi điểm."""
    color = GROUP_COLORS.get(group, C_ACCENT)
    fig = go.Figure(go.Indicator(
        mode="gauge+number", value=value,
        number=dict(font=dict(size=30, color="#f1f6ff"), suffix="/100"),
        title=dict(text=f"LHS · {symbol}", font=dict(size=13, color=C_TEXT)),
        gauge=dict(
            axis=dict(range=[0, 100], tickfont=dict(size=10, color=C_MUTED), tickcolor=C_GRID),
            bar=dict(color=color, thickness=0.28),
            bgcolor="rgba(17,26,46,0.5)",
            bordercolor=C_GRID, borderwidth=1,
            steps=[
                dict(range=[0, 33], color="rgba(248,113,113,0.10)"),
                dict(range=[33, 66], color="rgba(251,191,36,0.10)"),
                dict(range=[66, 100], color="rgba(52,211,153,0.10)"),
            ],
        )))
    fig.update_layout(margin=dict(l=24, r=24, t=42, b=8))
    return _base(fig, 235, None)


def tape(snaps_day_sym: pd.DataFrame) -> go.Figure:
    """Băng giao dịch nội phiên: mid + độ sâu hai phía + khối lượng từng nhịp.

    Cho ngưởi dùng 'thấy' toàn bộ hành trình thanh khoản của mã trong phiên —
    đây là lớp trực quan cấp cao còn thiếu của dashboard.
    """
    g = snaps_day_sym.sort_values("ts")
    fig = make_subplots(rows=2, cols=1, shared_xaxes=True, row_heights=[0.62, 0.38],
                        vertical_spacing=0.06,
                        subplot_titles=("Mid & giá khớp", "Độ sâu hiển thị hai phía (VND)"))
    fig.add_trace(go.Scatter(x=g["ts"], y=g["mid"], name="Mid", line=dict(color=C_ACCENT, width=1.6)), row=1, col=1)
    lp = g["last_price"].dropna()
    fig.add_trace(go.Scatter(x=g.loc[lp.index, "ts"], y=lp, name="Giá khớp", mode="markers",
                             marker=dict(size=3, color="#94a3b8", opacity=0.7)), row=1, col=1)
    for col, name, color, fill in (("depth_bid_vnd", "Depth bid", C_LARGE, "rgba(56,189,248,0.18)"),
                                   ("depth_ask_vnd", "Depth ask", C_THIN, "rgba(251,191,36,0.14)")):
        if col in g:
            fig.add_trace(go.Scatter(x=g["ts"], y=g[col], name=name, line=dict(color=color, width=1.2),
                                     fillcolor=fill, fill="tozeroy"), row=2, col=1)
    fig.update_xaxes(title="Giờ (UTC+7)", row=2, col=1)
    sym = g["symbol"].iloc[0] if len(g) else "—"
    fig = _base(fig, 420, f"Băng thanh khoản nội phiên · {sym}")
    fig.update_layout(legend=dict(orientation="h", yanchor="top", y=-0.22, x=0))
    return fig


def alert_timeline(alerts: pd.DataFrame) -> go.Figure:
    """Timeline cảnh báo: trục giờ × loại cảnh báo, kích thước và màu theo mức ưu tiên.

    Cho thấy phân bố thờI điểm bất thường trong phiên — nhận diện cụm sự kiện
    (vd nhiều mã cùng sốc vào một khung giờ) mà bảng không thể hiện được.
    """
    d = alerts.copy()
    prio_color = {"P1": C_BAD, "P2": "#fbbf24", "P3": C_LARGE}
    d["color"] = d.get("priority", "P3").map(lambda p: prio_color.get(p, C_LARGE))
    d["size"] = d.get("priority", "P3").map({"P1": 13, "P2": 10, "P3": 8}).fillna(8)
    fig = go.Figure()
    for sym, g in d.groupby("symbol"):
        fig.add_trace(go.Scatter(
            x=g["ts"], y=g["type"], mode="markers", name=sym,
            marker=dict(size=g["size"], color=g["color"], opacity=0.85, line=dict(width=1, color="#0a0f1c")),
            hovertemplate=(f"{sym} · %{{y}}<br>%{{x|%H:%M:%S}} · z=%{{customdata:.2f}}<extra></extra>"),
            customdata=g["z"] if "z" in g else None))
    fig.update_xaxes(title="Giờ (UTC+7)")
    fig.update_yaxes(title=None, automargin=True)
    fig = _base(fig, 340, "Timeline cảnh báo trong các phiên đã chọn — cụm sự kiện nhìn một lần thấy ngay")
    # legend nhiều mã: đặt dưới cùng để không đè tiêu đề
    fig.update_layout(legend=dict(orientation="h", yanchor="top", y=-0.28, x=0))
    return fig


def lhs_dist(day_lhs: pd.DataFrame) -> go.Figure:
    """Phân phối LHS trong phiên theo nhóm — độ tách biệt giữa nhóm thanh khoản cao và mỏng."""
    fig = go.Figure()
    for grp, color in GROUP_COLORS.items():
        g = day_lhs[(day_lhs["group"] == grp) & day_lhs["lhs"].notna()]
        if len(g):
            fig.add_trace(go.Histogram(x=g["lhs"], name=f"Nhóm {grp} (n={len(g):,} bar)",
                                       marker_color=color, opacity=0.6, nbinsx=30,
                                       hovertemplate="LHS %{x:.0f}: %{y} bar<extra></extra>"))
    fig.update_layout(barmode="overlay")
    fig.update_xaxes(title="LHS (0–100)", range=[0, 100])
    fig.update_yaxes(title="Số bar 1 phút")
    return _base(fig, 300, "Phân phối LHS nội phiên theo nhóm thanh khoản")
