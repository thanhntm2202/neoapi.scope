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

from neoscope.app import theme
from neoscope.app.data import (freshness, load_bars, load_indices, load_quality,
                               load_result, load_snaps, load_summary,
                               session_manifests, sessions_of, settings)
from neoscope.app.views import (view_alerts, view_data, view_execution, view_lhs,
                                view_method, view_overview, view_validation)

st.set_page_config(page_title="NeoScope | Phòng phân tích thanh khoản & vi cấu trúc",
                   page_icon=":material/analytics:", layout="wide", initial_sidebar_state="expanded")
theme.inject()

PAGE_TITLES = {
    "overview": "Tổng quan thị trường",
    "liquidity": "Thanh khoản · so sánh cấu phần LHS",
    "execution-cost": "Mô phỏng chi phí thực thi",
    "alerts": "Cảnh báo bất thường",
    "validation": "Kiểm chứng ngoài mẫu",
    "data-quality": "Dữ liệu & chất lượng",
    "methodology": "Phương pháp & giới hạn",
}

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

# ---- Header chung: hero đầy đủ chỉ ở trang Tổng quan; các trang chuyên sâu
# dùng status strip gọn một hàng để nội dung phân tích bắt đầu ngay đầu trang.
_HEADER: dict = {}


def _build_pills() -> list[tuple[str, str, str]]:
    items: list[tuple[str, str, str]] = []
    if mode == "SYNTHETIC":
        items.append(("DỮ LIỆU MÔ PHỎNG · SYNTHETIC", "amber",
                      "Bộ sinh dữ liệu có seed; không phải thị trường thật"))
    else:
        ws_state = str(_HEADER["live_status"].get("state", "not started")).lower()
        items.append((f"WebSocket · {ws_state}",
                      {"connected": "green", "stale": "amber", "failed": "red"}.get(ws_state, "gray"),
                      "Trạng thái luồng dữ liệu thời gian thực của recorder"))
    items.append((f"Nguồn · {s.provider}", "blue",
                  "SSI FastConnect API v3 là nguồn cốt lõi; NEO là dự phòng"))
    items.append((f"Phiên · {session}", "gray", "Phiên giao dịch đang phân tích"))
    items.append((f"Cập nhật · {freshness(snaps)}", "gray", "Thởi điểm sự kiện gần nhất trong dữ liệu (UTC+7)"))
    return items


def _render_header(url_path: str) -> None:
    if url_path == "overview":
        theme.hero(
            brand=f"NEOSCOPE · NGUỒN {s.provider} FASTCONNECT API v3",
            title="Phòng phân tích thanh khoản &amp; vi cấu trúc thị trường Việt Nam",
            subtitle="Công cụ nghiên cứu cho nhà đầu tư, môi giới và chuyên viên phân tích: đo sức khỏe thanh khoản "
                     "(LHS), ước tính chi phí thực thi lệnh giả định theo Implementation Shortfall, và truy nguyên "
                     "cảnh báo bất thường bằng ngưỡng thống kê. Dữ liệu SSI FastConnect API v3 — chỉ đọc, "
                     "không đặt lệnh thật, không phải khuyến nghị đầu tư.")
        theme.pills(_build_pills())
        st.warning("**DỮ LIỆU MÔ PHỎNG** · Kết quả chỉ kiểm chứng cơ chế trên bộ sinh synthetic, "
                   "không đại diện cho thị trường thật. Seed và phiên bản generator có trong manifest.",
                   icon=":material/science:")
    else:
        theme.status_strip(
            brand="NEOSCOPE",
            title=PAGE_TITLES.get(url_path, ""),
            pills=_build_pills())


def _wrap(url_path: str, view) -> None:
    _render_header(url_path)
    view(ctx)
    theme.footer(s.provider, mode, chash)


def _overview_page() -> None:
    _wrap("overview", view_overview)


def _liquidity_page() -> None:
    _wrap("liquidity", view_lhs)


def _execution_page() -> None:
    _wrap("execution-cost", view_execution)


def _alerts_page() -> None:
    _wrap("alerts", view_alerts)


def _validation_page() -> None:
    _wrap("validation", view_validation)


def _data_page() -> None:
    _wrap("data-quality", view_data)


def _method_page() -> None:
    _wrap("methodology", view_method)


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
                if isinstance(stt.get("subscription_audit"), dict):
                    audit = stt["subscription_audit"]
                    if audit.get("status") == "verified":
                        active_topics = audit.get("active_data_topics") or []
                        st.caption(f"SSI subscriptions: {len(active_topics)} topic đã xác nhận.")
                    elif audit.get("status") == "missing_topics":
                        missing = audit.get("missing_topics") or []
                        st.warning("SSI chưa xác nhận các topic: " + ", ".join(missing))
                    else:
                        st.warning("Chưa xác minh được danh sách topic SSI đang đăng ký.")
                topic_counts = stt.get("topic_messages")
                if isinstance(topic_counts, dict):
                    monitored_topics = (
                        "ssi_quote", "ssi_trade", "ssi_room", "ssi_market",
                        "ssi_indexsummary", "ssi_marketflag",
                    )
                    topic_line = " · ".join(
                        f"{topic}: {topic_counts.get(topic, 0)}" for topic in monitored_topics
                    )
                    st.caption(f"Message theo topic: {topic_line}")
        else:
            st.warning("Chưa có trạng thái recorder. Khởi chạy `neoscope record` để bắt đầu capture.")
    if st.button("Làm mới dữ liệu", icon=":material/refresh:", width="stretch"):
        st.cache_data.clear()
        st.rerun()

_HEADER["live_status"] = live_status

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
