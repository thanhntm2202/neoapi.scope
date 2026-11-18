"""Hệ thiết kế NeoScope — design system tối chuẩn fintech quốc tế.

Một nguồn duy nhất cho CSS tùy biến và các khối HTML (hero, status strip,
KPI card, badge, alert feed, footer) để mọi trang dùng chung ngôn ngữ thị
giác. Nguyên tắc: mật độ thông tin cao nhưng phân cấp rõ ràng; trang Tổng quan
dùng hero đầy đủ, các trang chuyên sâu dùng status strip gọn một hàng để nội
dung phân tích bắt đầu ngay dưới đầu trang.
"""
from __future__ import annotations

import streamlit as st

# Bảng màu (đồng bộ với .streamlit/config.toml và charts.py)
BG = "#0a0f1c"
CARD = "rgba(19, 28, 48, 0.72)"
BORDER = "#22314f"
TEXT = "#e6edf7"
MUTED = "#8b9bb4"
ACCENT = "#2dd4bf"
ACCENT2 = "#38bdf8"
GOLD = "#fbbf24"
RED = "#f87171"
GREEN = "#34d399"

_CSS = """
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600&display=swap');

html, body, [data-testid="stAppViewContainer"] {
    font-family: 'Inter', 'Segoe UI', sans-serif;
    background:
        radial-gradient(1200px 500px at 85% -10%, rgba(56,189,248,0.07), transparent 60%),
        radial-gradient(900px 420px at -10% 0%, rgba(45,212,191,0.06), transparent 55%),
        #0a0f1c;
}
section[data-testid="stSidebar"] {
    background: linear-gradient(180deg, #0d1424 0%, #0a101e 100%);
    border-right: 1px solid #1a2740;
}
section[data-testid="stSidebar"] * { font-family: 'Inter', sans-serif; }
section[data-testid="stSidebar"] [data-testid="stSidebarUserContent"] { padding-top: 0.5rem; }
section[data-testid="stSidebar"] .stMarkdown h4,
section[data-testid="stSidebar"] .stMarkdown h5 {
    font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase;
    color: #5f729a; font-weight: 700; margin-top: 4px;
}

/* thanh cuộn tinh tế */
::-webkit-scrollbar { width: 9px; height: 9px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #22314f; border-radius: 8px; }
::-webkit-scrollbar-thumb:hover { background: #2e4066; }

/* ---------- hero banner (chỉ trang Tổng quan) ---------- */
.neoscope-hero {
    position: relative; overflow: hidden;
    border-radius: 18px; padding: 24px 30px 20px 30px; margin-bottom: 4px;
    background: linear-gradient(115deg, rgba(13,25,48,0.95) 0%, rgba(10,20,40,0.9) 55%, rgba(8,30,38,0.9) 100%);
    border: 1px solid #22314f;
    box-shadow: 0 18px 50px -18px rgba(2,6,17,0.9), inset 0 1px 0 rgba(120,160,220,0.08);
}
.neoscope-hero::before {
    content: ""; position: absolute; inset: 0;
    background:
        radial-gradient(600px 180px at 90% 0%, rgba(45,212,191,0.14), transparent 60%),
        radial-gradient(400px 200px at 60% 120%, rgba(56,189,248,0.08), transparent 60%);
    pointer-events: none;
}
.hero-title {
    font-size: 28px; font-weight: 800; letter-spacing: -0.02em; color: #f2f7ff; margin: 0;
    background: linear-gradient(90deg, #f8fafc 30%, #7dd3fc 90%);
    -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
}
.hero-sub { color: #93a4c3; font-size: 13px; margin-top: 6px; max-width: 1020px; line-height: 1.55; }
.hero-brand {
    display: inline-flex; align-items: center; gap: 8px; margin-bottom: 8px;
    font-size: 11px; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase;
    color: #2dd4bf;
}
.hero-brand .dot { width: 8px; height: 8px; border-radius: 50%;
    background: #2dd4bf; box-shadow: 0 0 12px #2dd4bf; }

/* ---------- status strip gọn (các trang chuyên sâu) ---------- */
.status-strip {
    display: flex; align-items: center; flex-wrap: wrap; gap: 10px;
    padding: 9px 14px; margin-bottom: 10px; border-radius: 12px;
    background: linear-gradient(90deg, rgba(15,25,46,0.85), rgba(11,19,36,0.75));
    border: 1px solid #1c2a47;
    box-shadow: 0 8px 24px -14px rgba(2,6,17,0.8);
}
.status-strip .s-brand {
    display: inline-flex; align-items: center; gap: 7px;
    font-size: 11px; font-weight: 800; letter-spacing: 0.18em;
    color: #2dd4bf; text-transform: uppercase; margin-right: 2px; white-space: nowrap;
}
.status-strip .s-brand .dot { width: 7px; height: 7px; border-radius: 50%;
    background: #2dd4bf; box-shadow: 0 0 10px #2dd4bf; }
.status-strip .s-title { font-size: 13px; font-weight: 600; color: #c9d6ec; margin-right: auto; }
.status-strip .pill { margin: 0; }

/* ---------- status pills ---------- */
.pill-row { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 2px 0; }
.pill {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 5px 13px; border-radius: 999px; font-size: 12px; font-weight: 600;
    border: 1px solid #22314f; color: #b9c7de; background: rgba(17,26,46,0.6);
    white-space: nowrap;
}
.pill .pip { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.pill.green  { border-color: rgba(52,211,153,0.4);  color: #6ee7b7; }  .pill.green  .pip { background: #34d399; box-shadow: 0 0 8px #34d399; }
.pill.amber  { border-color: rgba(251,191,36,0.4);  color: #fcd34d; }  .pill.amber  .pip { background: #fbbf24; box-shadow: 0 0 8px #fbbf24; }
.pill.red    { border-color: rgba(248,113,113,0.4); color: #fca5a5; }  .pill.red    .pip { background: #f87171; box-shadow: 0 0 8px #f87171; }
.pill.blue   { border-color: rgba(56,189,248,0.4);  color: #7dd3fc; }  .pill.blue   .pip { background: #38bdf8; box-shadow: 0 0 8px #38bdf8; }
.pill.gray   .pip { background: #64748b; }

/* ---------- KPI cards (kèm delta chip) ---------- */
.kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(185px, 1fr)); gap: 12px; margin: 12px 0 4px 0; }
.kpi {
    position: relative; padding: 13px 16px 11px 16px; border-radius: 14px;
    background: linear-gradient(160deg, rgba(21,32,56,0.85), rgba(13,20,38,0.85));
    border: 1px solid #22314f; overflow: hidden;
    transition: border-color 0.18s ease, transform 0.18s ease;
}
.kpi:hover { border-color: #2e4066; transform: translateY(-1px); }
.kpi::after { content:""; position:absolute; left:0; top:0; bottom:0; width: 3px;
    background: linear-gradient(180deg, var(--kpi-c, #2dd4bf), transparent); opacity: 0.9; }
.kpi .k-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.kpi .k-label { flex: 1 1 auto; min-width: 0; font-size: 10.5px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: #7f92b3; }
.kpi .k-delta { font-size: 10.5px; font-weight: 700; padding: 2px 7px; border-radius: 6px; white-space: nowrap; }
.kpi .k-delta.up   { background: rgba(52,211,153,0.14); color: #6ee7b7; }
.kpi .k-delta.down { background: rgba(248,113,113,0.14); color: #fca5a5; }
.kpi .k-delta.flat { background: rgba(100,116,139,0.16); color: #9fb0cc; }
.kpi .k-value { font-size: 25px; font-weight: 800; color: #f1f6ff; margin-top: 4px; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
.kpi .k-sub { font-size: 11px; color: #64789c; margin-top: 3px; }

/* ---------- section headers ---------- */
.sec-title { font-size: 16.5px; font-weight: 700; color: #e8f0fc; margin: 18px 0 2px 0; letter-spacing: -0.01em; }
.sec-note { font-size: 12.5px; color: #7f92b3; margin-bottom: 8px; line-height: 1.5; }

/* ---------- alert feed ---------- */
.alert-feed { display: flex; flex-direction: column; gap: 8px; }
.alert-item {
    display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 11px;
    background: rgba(17,26,46,0.6); border: 1px solid #1f2c49;
    transition: border-color 0.15s ease;
}
.alert-item:hover { border-color: #2e4066; }
.alert-item .tag { font-size: 10px; font-weight: 800; letter-spacing: 0.06em; padding: 3px 8px; border-radius: 6px; flex: none; }
.tag.p1 { background: rgba(248,113,113,0.16); color: #fca5a5; border: 1px solid rgba(248,113,113,0.35); }
.tag.p2 { background: rgba(251,191,36,0.14); color: #fcd34d; border: 1px solid rgba(251,191,36,0.35); }
.tag.p3 { background: rgba(56,189,248,0.14); color: #7dd3fc; border: 1px solid rgba(56,189,248,0.35); }
.alert-item .a-main { flex: 1; font-size: 12.5px; color: #c9d6ec; font-weight: 600; }
.alert-item .a-sub { font-size: 11px; color: #64789c; }
.alert-item .a-time { font-size: 11px; color: #7f92b3; font-variant-numeric: tabular-nums; white-space: nowrap; }

/* ---------- footer ---------- */
.neoscope-footer {
    margin-top: 34px; padding: 16px 20px; border-radius: 14px;
    background: linear-gradient(160deg, rgba(15,23,42,0.6), rgba(10,16,30,0.6));
    border: 1px solid #1a2740;
    font-size: 11.5px; color: #64789c; line-height: 1.6;
}
.neoscope-footer b { color: #8b9bb4; }
.neoscope-footer .f-row { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 6px; }
.neoscope-footer .f-item { display: inline-flex; align-items: center; gap: 6px; }
.neoscope-footer .f-item::before { content: ""; width: 4px; height: 4px; border-radius: 50%; background: #2dd4bf; }

/* ---------- misc polish ---------- */
[data-testid="stMetric"] { background: linear-gradient(160deg, rgba(21,32,56,0.85), rgba(13,20,38,0.85));
    border: 1px solid #22314f; border-radius: 14px; padding: 12px 14px; }
[data-testid="stMetricValue"] { font-size: 1.35rem !important; white-space: nowrap;
    font-variant-numeric: tabular-nums; }
[data-testid="stMetricLabel"] { font-size: 0.78rem !important; letter-spacing: 0.04em; }
[data-testid="stMetricLabel"] * { white-space: normal !important; }
[data-testid="stDataFrame"], [data-testid="stTable"] { border-radius: 12px; }
div[data-testid="stExpander"] { border: 1px solid #22314f; border-radius: 12px; background: rgba(15,23,42,0.5); }
.streamlit-expanderHeader { font-weight: 600; color: #c9d6ec; }
hr { border-color: #1f2c49; }
.stInfo, .stWarning, .stError, .stSuccess { border-radius: 12px; }
h1, h2, h3 { letter-spacing: -0.015em; }
#MainMenu, footer { visibility: hidden; }
"""


def inject() -> None:
    """Nạp toàn bộ CSS của hệ thiết kế (gọi một lần ở đầu ứng dụng).

    ``st.html`` với thẻ ``<style>`` được kiểm chứng áp dụng toàn cục trên
    Streamlit 1.67 (các khối hero/pill/KPI dùng chính kênh này).
    """
    st.html(f"<style>{_CSS}</style>")


def hero(brand: str, title: str, subtitle: str) -> None:
    """Hero đầy đủ — chỉ dùng ở trang Tổng quan."""
    st.html(
        f'<div class="neoscope-hero"><div class="hero-brand"><span class="dot"></span>{brand}'
        f'</div><div class="hero-title">{title}</div><div class="hero-sub">{subtitle}</div></div>')


def status_strip(brand: str, title: str, pills: list[tuple[str, str, str]]) -> None:
    """Thanh trạng thái gọn một hàng — dùng ở các trang chuyên sâu để nội dung
    phân tích bắt đầu ngay, không lặp lại hero đầy đủ của trang Tổng quan."""
    pill_html = "".join(
        f'<span class="pill {color}" title="{tip}"><span class="pip"></span>{label}</span>'
        for label, color, tip in pills)
    st.html(
        f'<div class="status-strip"><span class="s-brand"><span class="dot"></span>{brand}</span>'
        f'<span class="s-title">{title}</span>{pill_html}</div>')


def pills(items: list[tuple[str, str, str]]) -> None:
    """items: (label, color, title-tooltip ngắn)."""
    parts = "".join(
        f'<span class="pill {color}" title="{tip}"><span class="pip"></span>{label}</span>'
        for label, color, tip in items)
    st.html(f'<div class="pill-row">{parts}</div>')


def kpi_grid(cards: list[dict]) -> None:
    """cards: [{label, value, sub, color, delta?, delta_dir?}] — hàng KPI kiểu fintech.

    color: hex dùng cho thanh accent trái (mặc định teal).
    delta (tùy chọn): chuỗi hiển thị trong chip nhỏ, vd "−0.4 so với phiên trước";
    delta_dir: 'up' | 'down' | 'flat' — 'down' tô đỏ, 'up' tô xanh.
    """
    cells = []
    for c in cards:
        delta_html = ""
        if c.get("delta"):
            ddir = c.get("delta_dir", "flat")
            delta_html = f'<span class="k-delta {ddir}">{c["delta"]}</span>'
        cells.append(
            f'<div class="kpi" style="--kpi-c:{c.get("color", ACCENT)}">'
            f'<div class="k-top"><span class="k-label">{c["label"]}</span>{delta_html}</div>'
            f'<div class="k-value">{c["value"]}</div>'
            f'<div class="k-sub">{c.get("sub", "")}</div></div>')
    st.html(f'<div class="kpi-grid">{"".join(cells)}</div>')


def section(title: str, note: str = "") -> None:
    note_html = f'<div class="sec-note">{note}</div>' if note else ""
    st.html(f'<div class="sec-title">{title}</div>{note_html}')


def alert_feed(items: list[dict], empty_text: str = "Không có cảnh báo nào khớp bộ lọc.") -> None:
    """items: [{priority('P1'|'P2'|'P3'), title, sub, time}]."""
    if not items:
        st.html(f'<div class="alert-item"><div class="a-sub">{empty_text}</div></div>')
        return
    rows = "".join(
        f'<div class="alert-item"><span class="tag {i["priority"].lower()}">{i["priority"]}</span>'
        f'<div style="flex:1"><div class="a-main">{i["title"]}</div>'
        f'<div class="a-sub">{i.get("sub", "")}</div></div>'
        f'<div class="a-time">{i.get("time", "")}</div></div>'
        for i in items)
    st.html(f'<div class="alert-feed">{rows}</div>')


def footer(provider: str, mode: str, config_hash: str) -> None:
    """Chân trang thống nhất: bản chất công cụ học thuật + truy vết cấu hình."""
    st.html(
        '<div class="neoscope-footer"><b>NeoScope</b> — công cụ phân tích thanh khoản &amp; vi cấu trúc '
        'thị trường chứng khoán Việt Nam. Sản phẩm phục vụ nghiên cứu và hỗ trợ ra quyết định; '
        '<b>không phải khuyến nghị đầu tư</b>, không đặt lệnh thật, không dự báo giá dài hạn.'
        '<div class="f-row">'
        '<span class="f-item">Nguồn dữ liệu: SSI FastConnect API v3 (NEO API dự phòng)</span>'
        '<span class="f-item">Múi giờ chuẩn: Asia/Ho_Chi_Minh (UTC+7)</span>'
        f'<span class="f-item">Chế độ: {mode} · Nguồn: {provider}</span>'
        f'<span class="f-item">config_hash: <code>{config_hash[:12]}…</code></span>'
        '</div></div>')
