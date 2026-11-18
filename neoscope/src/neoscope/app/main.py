"""NeoScope — thanh khoản, chi phí thực thi và cảnh báo thị trường.

Chạy:  neoscope app   (hoặc: streamlit run src/neoscope/app/main.py)

Mỗi trang trả lời một câu hỏi quyết định. Chế độ SYNTHETIC luôn công bố rõ
rằng dữ liệu là mô phỏng và không phải bằng chứng thị trường.
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
import pandas as pd

from neoscope.app.data import (freshness, load_bars, load_indices, load_quality,
                               load_result, load_snaps, load_summary,
                               session_manifests, sessions_of, settings)
from neoscope.app.views import (view_alerts, view_data, view_execution, view_lhs,
                                view_method, view_overview, view_validation)

st.set_page_config(page_title="NeoScope | Phân tích thanh khoản", page_icon=":material/analytics:",
                   layout="wide", initial_sidebar_state="expanded")

LOAD_WARNINGS: list[str] = []


def _load_optional(label: str, loader, *args, default):
    try:
        return loader(*args)
    except Exception as exc:  # A corrupt optional artifact must not blank the whole dashboard.
        LOAD_WARNINGS.append(f"Không nạp được {label}: {type(exc).__name__}: {exc}")
        return default

s = settings()
mode = s.mode
data_mode = s.dataset_mode
chash = s.config_hash

try:
    snaps = load_snaps(data_mode, chash)
except Exception as exc:
    st.error(f"Không đọc được dữ liệu curated: {type(exc).__name__}: {exc}")
    st.info("Kiểm tra tệp Parquet và chạy lại `neoscope --mode SYNTHETIC process --force` "
            "hoặc `process` cho namespace LIVE.")
    st.stop()
if snaps.empty:
    st.error(f"Chưa có dữ liệu curated cho chế độ {mode} / nguồn {s.provider}. "
             "Chạy `neoscope all` (SYNTHETIC) hoặc chọn provider, rồi `neoscope record` + `neoscope process` (LIVE).")
    st.stop()

sessions = sessions_of(snaps)

ctx: dict = {}


def _overview_page() -> None:
    view_overview(ctx)


def _liquidity_page() -> None:
    view_lhs(ctx)


def _execution_page() -> None:
    view_execution(ctx)


def _alerts_page() -> None:
    view_alerts(ctx)


def _validation_page() -> None:
    view_validation(ctx)


def _data_page() -> None:
    view_data(ctx)


def _method_page() -> None:
    view_method(ctx)


page = st.navigation(
    {
        "Phân tích": [
            st.Page(_overview_page, title="Tổng quan", url_path="overview", icon=":material/dashboard:",
                    help="Tóm tắt dữ liệu phiên, độ rộng thị trường và watchlist đã chọn."),
            st.Page(_liquidity_page, title="Thanh khoản", url_path="liquidity", icon=":material/waterfall_chart:",
                    help="So sánh điểm LHS, các cấu phần thanh khoản và diễn biến trong phiên."),
            st.Page(_execution_page, title="Mô phỏng chi phí", url_path="execution-cost", icon=":material/candlestick_chart:",
                    help="Ước tính impact, phí và thuế cho lệnh giả định; không gửi lệnh thật."),
            st.Page(_alerts_page, title="Cảnh báo", url_path="alerts", icon=":material/notifications_active:",
                    help="Lọc và truy nguyên bất thường theo mã, phiên, loại và mức ưu tiên."),
            st.Page(_validation_page, title="Kiểm chứng", url_path="validation", icon=":material/fact_check:",
                    help="Đánh giá ngoài mẫu, benchmark, độ phủ và độ bất định của mô hình."),
        ],
        "Quản trị nghiên cứu": [
            st.Page(_data_page, title="Dữ liệu & chất lượng", url_path="data-quality", icon=":material/database:",
                    help="Kiểm tra nguồn, độ mới, chất lượng bản ghi và manifest truy vết."),
            st.Page(_method_page, title="Phương pháp & giới hạn", url_path="methodology", icon=":material/menu_book:",
                    help="Tra cứu công thức, ngưỡng, giao thức kiểm chứng và các giới hạn."),
        ],
    },
    position="sidebar",
)

live_status: dict = {}
with st.sidebar:
    st.markdown("#### Bộ lọc dữ liệu")
    session = st.selectbox("Phiên giao dịch", sessions, index=len(sessions) - 1)
    all_syms = sorted(snaps["symbol"].unique().tolist())
    symbols = st.multiselect("Mã theo dõi", all_syms,
                             default=[x for x in s.watchlist() if x in all_syms] or all_syms)
    with st.expander("Trạng thái kết nối & tái lập"):
        st.caption(f"Múi giờ: Asia/Ho_Chi_Minh · config_hash: `{chash}`")
    if mode == "LIVE":
        import json as _json
        p = s.data_path(f"live_status_{s.provider.lower()}.json")
        if p.exists():
            try:
                stt = _json.loads(p.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                st.warning("Không đọc được trạng thái recorder; hãy kiểm tra tiến trình ghi dữ liệu.")
            else:
                live_status = stt
                ws_state = str(stt.get("state", "unknown")).lower()
                status_line = (f"WebSocket `{ws_state}` · {stt.get('messages', 0):,} messages · "
                               f"queue {stt.get('queue_depth', 0):,} · lỗi callback "
                               f"{stt.get('callback_errors', 0)}")
                if ws_state == "failed":
                    st.error(status_line)
                elif ws_state == "stale":
                    st.warning(status_line)
                elif ws_state == "connected":
                    st.success(status_line)
                else:
                    st.info(status_line)
                if stt.get("detail"):
                    st.caption(stt["detail"])
        else:
            st.warning("Chưa có trạng thái recorder. Khởi chạy `neoscope record` để bắt đầu capture.")
    if st.button("Làm mới dữ liệu", icon=":material/refresh:", width="stretch"):
        st.cache_data.clear()
        st.rerun()

st.title("NeoScope")
st.caption("Công cụ nghiên cứu cho nhà đầu tư, môi giới và nhà phân tích: đo thanh khoản, "
           "ước tính chi phí lệnh giả định và truy nguyên cảnh báo.")
with st.container(horizontal=True, gap="medium"):
    if mode == "SYNTHETIC":
        st.badge("DỮ LIỆU MÔ PHỎNG", icon=":material/science:", color="orange")
    else:
        ws_state = str(live_status.get("state", "not started")).lower()
        ws_color = {"connected": "green", "stale": "orange", "failed": "red"}.get(ws_state, "gray")
        st.badge(f"WebSocket · {ws_state}", icon=":material/cable:", color=ws_color)
    st.badge(f"Nguồn · {s.provider}", icon=":material/database:", color="blue")
    st.badge(f"Phiên · {session}", icon=":material/calendar_today:", color="gray")
    st.badge(f"Cập nhật · {freshness(snaps)} · UTC+7", icon=":material/schedule:", color="gray")
if mode == "SYNTHETIC":
    st.warning("**DỮ LIỆU MÔ PHỎNG** · Kết quả chỉ kiểm chứng cơ chế trên bộ sinh synthetic, "
               "không đại diện cho thị trường thật. Seed và phiên bản generator có trong manifest.",
               icon=":material/science:")
else:
    st.info(f"**DỮ LIỆU LIVE · {s.provider}** · Dữ liệu và kết quả được tách theo nguồn. "
            "Ứng dụng không gọi endpoint đặt lệnh.", icon=":material/candlestick_chart:")

bars = _load_optional("bars", load_bars, data_mode, chash, default=pd.DataFrame())
bars_lhs = _load_optional("LHS", load_result, "bars_lhs.parquet", chash, default=pd.DataFrame())
indices = _load_optional("indices", load_indices, data_mode, chash, default=pd.DataFrame())
quality, quality_meta = _load_optional("quality", load_quality, data_mode, chash,
                                       default=(pd.DataFrame(), pd.DataFrame()))
# Khóa của `results` là TÊN LOGIC (không có đuôi .parquet) — đúng như các
# view tra cứu (`results["alerts"]`, `results["metrics"]`…). Lệch khóa từng
# khiến mọi tab kiểm chứng/cảnh báo im lặng rơi về DataFrame rỗng.
RESULT_FILES = ("metrics", "metrics_coverage", "predictions", "orders",
                "fold_params", "coverage", "alerts", "alert_pr",
                "lhs_ic", "lhs_sensitivity", "obi_direction", "resilience")
results = {name: _load_optional(name, load_result, f"{name}.parquet", chash,
                                default=pd.DataFrame()) for name in RESULT_FILES}
summary = _load_optional("summary", load_summary, chash, default={})
manifests = _load_optional("session manifests", session_manifests, data_mode, chash,
                           default=[])
ctx.update({"settings": s, "mode": mode, "snaps": snaps, "bars": bars, "bars_lhs": bars_lhs,
       "indices": indices, "quality": quality, "quality_meta": quality_meta,
       "summary": summary, "results": results, "session": session,
       "sessions": sessions, "symbols": symbols,
        "manifests": manifests})

for load_warning in LOAD_WARNINGS:
    st.warning(load_warning)

page.run()
