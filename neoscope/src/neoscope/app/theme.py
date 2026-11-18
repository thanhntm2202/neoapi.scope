"""Hệ thiết kế NeoScope — theme tối chuẩn fintech quốc tế.

Một nguồn duy nhất cho CSS tùy biến và các khối HTML (hero, KPI card, badge,
alert feed) để mọi trang dùng chung ngôn ngữ thị giác. Mục tiêu: mật độ thông
tin cao nhưng phân cấp rõ ràng — đúng chuẩn dashboard chuyên nghiệp (Bloomberg/
Refinitiv-style) với nền tảng hiện đại (glassmorphism tinh tế, không lạm dụng).
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

/* ---------- hero banner ---------- */
.neoscope-hero {
    position: relative; overflow: hidden;
    border-radius: 18px; padding: 26px 30px 22px 30px; margin-bottom: 6px;
    background: linear-gradient(115deg, rgba(13,25,48,0.95) 0%, rgba(10,20,40,0.9) 55%, rgba(8,30,38,0.9) 100%);
    border: 1px solid #22314f;
    box-shadow: 0 18px 50px -18px rgba(2,6,17,0.9), inset 0 1px 0 rgba(120,160,220,0.08);
}
.neoscope-hero::before {
    content: ""; position: absolute; inset: 0;
    background: radial-gradient(600px 180px at 90% 0%, rgba(45,212,191,0.14), transparent 60%);
    pointer-events: none;
}
.hero-title {
    font-size: 30px; font-weight: 800; letter-spacing: -0.02em; color: #f2f7ff; margin: 0;
    background: linear-gradient(90deg, #f8fafc 30%, #7dd3fc 90%);
    -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
}
.hero-sub { color: #93a4c3; font-size: 13.5px; margin-top: 6px; max-width: 980px; line-height: 1.55; }
.hero-brand {
    display: inline-flex; align-items: center; gap: 8px; margin-bottom: 8px;
    font-size: 11px; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase;
    color: #2dd4bf;
}
.hero-brand .dot { width: 8px; height: 8px; border-radius: 50%;
    background: #2dd4bf; box-shadow: 0 0 12px #2dd4bf; }

/* ---------- status pills ---------- */
.pill-row { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 4px 0; }
.pill {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 5px 13px; border-radius: 999px; font-size: 12px; font-weight: 600;
    border: 1px solid #22314f; color: #b9c7de; background: rgba(17,26,46,0.6);
}
.pill .pip { width: 7px; height: 7px; border-radius: 50%; }
.pill.green  { border-color: rgba(52,211,153,0.4);  color: #6ee7b7; }  .pill.green  .pip { background: #34d399; box-shadow: 0 0 8px #34d399; }
.pill.amber  { border-color: rgba(251,191,36,0.4);  color: #fcd34d; }  .pill.amber  .pip { background: #fbbf24; box-shadow: 0 0 8px #fbbf24; }
.pill.red    { border-color: rgba(248,113,113,0.4); color: #fca5a5; }  .pill.red    .pip { background: #f87171; box-shadow: 0 0 8px #f87171; }
.pill.blue   { border-color: rgba(56,189,248,0.4);  color: #7dd3fc; }  .pill.blue   .pip { background: #38bdf8; box-shadow: 0 0 8px #38bdf8; }
.pill.gray   .pip { background: #64748b; }

/* ---------- KPI cards ---------- */
.kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin: 14px 0 6px 0; }
.kpi {
    position: relative; padding: 14px 16px 12px 16px; border-radius: 14px;
    background: linear-gradient(160deg, rgba(21,32,56,0.85), rgba(13,20,38,0.85));
    border: 1px solid #22314f; overflow: hidden;
}
.kpi::after { content:""; position:absolute; left:0; top:0; bottom:0; width: 3px;
    background: linear-gradient(180deg, var(--kpi-c, #2dd4bf), transparent); opacity: 0.9; }
.kpi .k-label { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #7f92b3; }
.kpi .k-value { font-size: 26px; font-weight: 800; color: #f1f6ff; margin-top: 4px; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
.kpi .k-sub { font-size: 11.5px; color: #64789c; margin-top: 3px; }

/* ---------- section headers ---------- */
.sec-title { font-size: 17px; font-weight: 700; color: #e8f0fc; margin: 18px 0 2px 0; letter-spacing: -0.01em; }
.sec-note { font-size: 12.5px; color: #7f92b3; margin-bottom: 8px; line-height: 1.5; }

/* ---------- alert feed ---------- */
.alert-feed { display: flex; flex-direction: column; gap: 8px; }
.alert-item {
    display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 11px;
    background: rgba(17,26,46,0.6); border: 1px solid #1f2c49;
}
.alert-item .tag { font-size: 10px; font-weight: 800; letter-spacing: 0.06em; padding: 3px 8px; border-radius: 6px; }
.tag.p1 { background: rgba(248,113,113,0.16); color: #fca5a5; border: 1px solid rgba(248,113,113,0.35); }
.tag.p2 { background: rgba(251,191,36,0.14); color: #fcd34d; border: 1px solid rgba(251,191,36,0.35); }
.tag.p3 { background: rgba(56,189,248,0.14); color: #7dd3fc; border: 1px solid rgba(56,189,248,0.35); }
.alert-item .a-main { flex: 1; font-size: 12.5px; color: #c9d6ec; font-weight: 600; }
.alert-item .a-sub { font-size: 11px; color: #64789c; }
.alert-item .a-time { font-size: 11px; color: #7f92b3; font-variant-numeric: tabular-nums; white-space: nowrap; }

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
#MainMenu, footer { visibility: hidden; }
"""


def inject() -> None:
    """Nạp toàn bộ CSS của hệ thiết kế (gọi một lần ở đầu ứng dụng).

    ``st.html`` với thẻ ``<style>`` được kiểm chứng áp dụng toàn cục trên
    Streamlit 1.67 (các khối hero/pill/KPI dùng chính kênh này).
    """
    st.html(f"<style>{_CSS}</style>")


def hero(brand: str, title: str, subtitle: str) -> None:
    st.html(
        f'<div class="neoscope-hero"><div class="hero-brand"><span class="dot"></span>{brand}'
        f'</div><div class="hero-title">{title}</div><div class="hero-sub">{subtitle}</div></div>')


def pills(items: list[tuple[str, str, str]]) -> None:
    """items: (label, color, title-tooltip ngắn)."""
    parts = "".join(
        f'<span class="pill {color}" title="{tip}"><span class="pip"></span>{label}</span>'
        for label, color, tip in items)
    st.html(f'<div class="pill-row">{parts}</div>')


def kpi_grid(cards: list[dict]) -> None:
    """cards: [{label, value, sub, color}] — hiển thị hàng KPI kiểu fintech.

    color: hex dùng cho thanh accent trái (mặc định teal).
    """
    cells = "".join(
        f'<div class="kpi" style="--kpi-c:{c.get("color", ACCENT)}">'
        f'<div class="k-label">{c["label"]}</div>'
        f'<div class="k-value">{c["value"]}</div>'
        f'<div class="k-sub">{c.get("sub", "")}</div></div>'
        for c in cards)
    st.html(f'<div class="kpi-grid">{cells}</div>')


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
