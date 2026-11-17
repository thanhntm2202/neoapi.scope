"""NeoScope Dashboard — Kính hiển vi sổ lệnh & Buồng thử khớp lệnh (NEO API).

Chạy:  neoscope app   (hoặc: streamlit run src/neoscope/app/main.py)

Mỗi tab trả lời MỘT câu hỏi quyết định; tab Kiểm chứng công khai cả điểm
yếu của mô hình. Chế độ SYNTHETIC luôn treo banner công bố dữ liệu mô phỏng.
"""
from __future__ import annotations

import sys
from pathlib import Path

# `streamlit run main.py` thực thi tệp này như __main__ (không có package
# context) → import tương đối sẽ ImportError. Dùng import TUYỆT ĐỐI và
# bảo đảm src/ nằm trong sys.path khi chạy thẳng từ nguồn chưa cài đặt.
if __package__ in (None, ""):
    _SRC = str(Path(__file__).resolve().parents[2])
    if _SRC not in sys.path:
        sys.path.insert(0, _SRC)

import streamlit as st

from neoscope.app.data import (freshness, load_bars, load_indices, load_quality,
                               load_result, load_snaps, load_summary,
                               session_manifests, sessions_of, settings)
from neoscope.app.views import (view_alerts, view_data, view_execution, view_lhs,
                                view_method, view_overview, view_validation)

st.set_page_config(page_title="NeoScope — NEO API Liquidity Lab", page_icon="🔬",
                   layout="wide", initial_sidebar_state="expanded")

st.markdown("""
<style>
  .block-container {padding-top: 2.2rem; padding-bottom: 2rem; max-width: 1280px;}
  div[data-testid="stMetric"] {background: #f8fafc; border: 1px solid #e2e8f0;
      border-radius: 10px; padding: 10px 14px;}
  div[data-testid="stMetricLabel"] {font-size: 0.82rem;}
  .neo-banner {background: linear-gradient(90deg,#0f766e,#134e4a); color: #fff;
      padding: 14px 18px; border-radius: 12px; margin-bottom: 10px;}
  .neo-banner h1 {margin: 0; font-size: 1.5rem; color: #fff;}
  .neo-banner p {margin: 4px 0 0; font-size: 0.9rem; opacity: 0.92;}
  .neo-synth {background: #fef3c7; border: 1px solid #f59e0b; color: #92400e;
      padding: 8px 14px; border-radius: 10px; font-size: 0.9rem; margin-bottom: 8px;}
  .neo-live {background: #dcfce7; border: 1px solid #16a34a; color: #14532d;
      padding: 8px 14px; border-radius: 10px; font-size: 0.9rem; margin-bottom: 8px;}
  footer {visibility: hidden;}
</style>
""", unsafe_allow_html=True)

s = settings()
mode = s.mode
chash = s.config_hash

snaps = load_snaps(mode, chash)
if snaps.empty:
    st.error("Chưa có dữ liệu curated cho chế độ " + mode +
             ". Chạy `neoscope all` (SYNTHETIC) hoặc `neoscope record` + `neoscope process` (LIVE).")
    st.stop()

sessions = sessions_of(snaps)
summary = load_summary(chash)

with st.sidebar:
    st.markdown("### 🔬 NeoScope")
    st.caption("Kính hiển vi sổ lệnh & buồng thử khớp lệnh trên NEO API (VPBankS)")
    session = st.selectbox("Phiên giao dịch", sessions, index=len(sessions) - 1)
    all_syms = sorted(snaps["symbol"].unique().tolist())
    symbols = st.multiselect("Mã theo dõi", all_syms,
                             default=[x for x in s.watchlist() if x in all_syms] or all_syms)
    st.divider()
    st.markdown(f"**Chế độ:** `{mode}`")
    st.markdown(f"**Cập nhật dữ liệu:** {freshness(snaps)}")
    st.markdown(f"**Múi giờ hiển thị:** Asia/Ho_Chi_Minh (UTC+7)")
    st.markdown(f"**config_hash:** `{chash}`")
    if mode == "LIVE":
        import json as _json
        p = s.data_path("live_status.json")
        if p.exists():
            stt = _json.loads(p.read_text(encoding="utf-8"))
            st.markdown(f"**Kết nối WS:** `{stt.get('state')}` · {stt.get('messages', 0):,} msg")
    st.divider()
    st.caption("⚖️ Công cụ phân tích học thuật — KHÔNG phải khuyến nghị đầu tư, "
               "KHÔNG đặt lệnh thật. Dữ liệu thị trường only.")

st.markdown(
    '<div class="neo-banner"><h1>🔬 NeoScope — Order-book Liquidity X-ray &amp; Execution-cost Laboratory</h1>'
    '<p>Biến sổ lệnh 3 mức + luồng khớp lệnh NEO API thành: điểm sức khỏe thanh khoản · ước tính chi phí thực thi trước khi đặt lệnh · '
    'cảnh báo bất thường truy nguyên được · và tự kiểm chứng công khai. Người dùng: NĐT cá nhân 100tr–5tỷ/lệnh, môi giới, người học vi cấu trúc.</p></div>',
    unsafe_allow_html=True)
if mode == "SYNTHETIC":
    st.markdown('<div class="neo-synth">⚠️ <b>CHẾ ĐỘ SYNTHETIC</b> — toàn bộ dữ liệu là MÔ PHỎNG có gắn nhãn '
                '(seed & generator_version trong manifest), không phải thị trường thật. '
                'Kết quả kiểm chứng phản ánh thế giới mô phỏng; chuyển LIVE khi có quyền NEO API + IP đăng ký.</div>',
                unsafe_allow_html=True)
else:
    st.markdown('<div class="neo-live">📡 <b>CHẾ ĐỘ LIVE</b> — dữ liệu thị trường thật từ NEO API (JWT, 5 RPS, IP đã đăng ký). '
                'Không gọi bất kỳ endpoint đặt lệnh nào.</div>', unsafe_allow_html=True)

bars = load_bars(mode, chash)
bars_lhs = load_result("bars_lhs.parquet", chash)
indices = load_indices(mode, chash)
quality, quality_meta = load_quality(mode, chash)
# Khóa của `results` là TÊN LOGIC (không có đuôi .parquet) — đúng như các
# view tra cứu (`results["alerts"]`, `results["metrics"]`…). Lệch khóa từng
# khiến mọi tab kiểm chứng/cảnh báo im lặng rơi về DataFrame rỗng.
RESULT_FILES = ("metrics", "metrics_coverage", "predictions", "orders",
                "fold_params", "coverage", "alerts", "alert_pr",
                "lhs_ic", "lhs_sensitivity", "obi_direction", "resilience")
results = {name: load_result(f"{name}.parquet", chash) for name in RESULT_FILES}
ctx = {"settings": s, "mode": mode, "snaps": snaps, "bars": bars, "bars_lhs": bars_lhs,
       "indices": indices, "quality": quality, "quality_meta": quality_meta,
       "summary": summary, "results": results, "session": session,
       "sessions": sessions, "symbols": symbols,
       "manifests": session_manifests(mode, chash)}

tabs = st.tabs(["🏠 Tổng quan", "Q1 · Sức khỏe thanh khoản", "Q2 · Ước tính thực thi",
                "Q3 · Cảnh báo bất thường", "Q4 · Kiểm chứng", "🗄 Dữ liệu & Chất lượng",
                "📐 Phương pháp & Giới hạn"])
with tabs[0]:
    view_overview(ctx)
with tabs[1]:
    view_lhs(ctx)
with tabs[2]:
    view_execution(ctx)
with tabs[3]:
    view_alerts(ctx)
with tabs[4]:
    view_validation(ctx)
with tabs[5]:
    view_data(ctx)
with tabs[6]:
    view_method(ctx)
