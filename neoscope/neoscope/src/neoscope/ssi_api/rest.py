"""REST client SSI FastConnect API v3 — CHỈ DỮ LIỆU THỊ TRƯỜNG.

An toàn theo thiết kế (safety by construction): module này KHÔNG có hàm đặt/sửa/
hủy lệnh và không khởi tạo Trading client của SSI. Kiểm chứng: tìm
`placeOrder|amendOrder|cancelOrder|/order` trong `src/neoscope/ssi_api/`
(kết quả mong đợi: không khớp).

Hai nhóm API phục vụ trực tiếp bài toán vi cấu trúc:
  1. Lịch sử OHLC ngày (DailyOHLCHistory) — bối cảnh dài hạn cho LHS/ILLIQ,
     kiểm chứng chéo độ lớn giá và phát hiện cổ phiếu kiểu "penny"/tách lệch
     đơn vị so với luồng tick (giá nghìn đ VND ↔ VND).
  2. Danh mục chứng khoán (Securities) — hợp lệ hóa watchlist trước khi gọi
     stream, tránh subscribe mã không tồn tại.

Đường dẫn endpoint là cấu hình (settings.yaml → ssi_api.rest) vì SSI có thể đổi
phiên bản đường dẫn; parser JSON phòng thủ theo nhiều dạng tên trường đã công bố.
Toàn bộ lời gọi đi qua token-bucket tần suất; 429/5xx backoff theo cấu hình;
401 làm mới token rồi thử lại đúng một lần.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Any

import httpx
from loguru import logger

from ..config import Settings, env_secret
from ..neo_api.rate_limiter import TokenBucket


class SsiRestError(RuntimeError):
    """Lỗi nghiệp vụ từ SSI REST: mang theo mã lỗi nguồn để truy vết."""

    def __init__(self, code: str | int | None, message: str):
        self.code = code
        super().__init__(f"SSI REST lỗi: code={code} message={message}")


def _first_key(data: dict[str, Any], *names: str) -> Any:
    """Tìm trường theo nhiều tên (phân biệt hoa-thường, snake/camel) — parser phòng thủ."""
    lowered = {k.lower(): v for k, v in data.items()}
    for name in names:
        if name in data:
            return data[name]
        if name.lower() in lowered:
            return lowered[name.lower()]
    return None


@dataclass
class SsiToken:
    access_token: str
    expires_at_mono: float  # monotonic; 0 = không xác định (coi như hết hạn sớm)


class SsiTokenManager:
    """Token OAuth2 của SSI: cache theo TTL, refresh khi gần hết hạn hoặc 401."""

    def __init__(self, settings: Settings, client: "httpx.Client"):
        self.cfg = settings
        self._client = client
        self._lock = threading.Lock()
        self._token: SsiToken | None = None
        self.rest = settings.ssi_api.get("rest", {})

    @property
    def auth_path(self) -> str:
        return str(self.rest.get("auth_path", "api/v3/Market/AccessToken"))

    @property
    def token_ttl_margin_s(self) -> float:
        return float(self.rest.get("token_ttl_margin_s", 120))

    def _request_token(self) -> SsiToken:
        payload = {
            "clientId": env_secret("SSI_CLIENT_ID"),
            "apiKey": env_secret("SSI_API_KEY"),
            "apiSecret": env_secret("SSI_API_SECRET"),
        }
        resp = self._client.post(self.auth_path, json=payload)
        resp.raise_for_status()
        body = resp.json()
        if not isinstance(body, dict):
            raise SsiRestError(None, "token response không phải JSON object")
        # Dạng đã công bố: {"status":"Success","data":{"accessToken":..., "expiresIn":...}}
        # hoặc phẳng {"access_token":...}. Parser không giả định một dạng duy nhất.
        data = body.get("data") if isinstance(body.get("data"), dict) else body
        token = _first_key(data, "accessToken", "access_token", "token")
        if not token:
            raise SsiRestError(_first_key(body, "code", "status"),
                               str(_first_key(body, "message", "error", "msg") or body))
        expires_in = _first_key(data, "expiresIn", "expires_in", "expires")
        ttl = float(expires_in) if isinstance(expires_in, (int, float)) else 300.0
        return SsiToken(access_token=str(token), expires_at_mono=time.monotonic() + ttl)

    def get_token(self) -> str:
        with self._lock:
            if self._token is None or time.monotonic() > self._token.expires_at_mono - self.token_ttl_margin_s:
                self._token = self._request_token()
                logger.info("SSI REST: token mới (TTL còn lại ≈ {:.0f}s)",
                            max(0.0, self._token.expires_at_mono - time.monotonic()))
            return self._token.access_token

    def invalidate(self) -> None:
        with self._lock:
            self._token = None


class SsiRestClient:
    """Client REST chỉ-đọc cho SSI FastConnect API v3."""

    def __init__(self, settings: Settings):
        self.cfg = settings
        ssi = settings.ssi_api
        self.rest = ssi.get("rest", {})
        timeout_s = float(ssi.get("timeout_ms", 20000)) / 1000.0
        self._client = httpx.Client(base_url=str(ssi.get("api_url", "https://api.ssi.com.vn")),
                                    timeout=timeout_s)
        self.tokens = SsiTokenManager(settings, self._client)
        self.bucket = TokenBucket(rate=float(ssi.get("rate_limit_rps", 5)))
        self.max_retries = int(ssi.get("max_retries", 3))

    # ------------------------------------------------------------------ hạ tầng
    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.tokens.get_token()}",
                "Accept": "application/json"}

    def _get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        backoff = float(self.rest.get("backoff_s", 1.0))
        refreshed_after_401 = False
        for attempt in range(self.max_retries + 1):
            self.bucket.acquire_sync()
            try:
                resp = self._client.get(path, params=params, headers=self._headers())
            except httpx.TransportError as e:
                logger.warning("SSI REST lỗi mạng ({}), thử lại {}/{}",
                               type(e).__name__, attempt + 1, self.max_retries)
                if attempt == self.max_retries:
                    raise
                time.sleep(backoff)
                backoff *= 2
                continue
            if resp.status_code == 401 and not refreshed_after_401:
                logger.info("SSI REST 401 — làm mới token rồi thử lại")
                self.tokens.invalidate()
                refreshed_after_401 = True
                continue
            if resp.status_code in (429, 500, 502, 503, 504):
                logger.warning("SSI REST HTTP {} — backoff {:.1f}s", resp.status_code, backoff)
                if attempt == self.max_retries:
                    resp.raise_for_status()
                time.sleep(backoff)
                backoff *= 2
                continue
            resp.raise_for_status()
            body = resp.json()
            if not isinstance(body, dict):
                raise SsiRestError(None, "response không phải JSON object")
            status = str(_first_key(body, "status", "code") or "").lower()
            # SSI dùng status "Success" + code 200; chấp nhận cả số 200/0.
            if status not in {"success", "200", "0", "ok", "true"}:
                raise SsiRestError(_first_key(body, "code", "status"),
                                   str(_first_key(body, "message", "error", "msg") or body))
            return body
        raise SsiRestError(None, "hết số lần thử")

    # ------------------------------------------------- endpoint 1: OHLC ngày
    def daily_ohlc(self, symbol: str, market: str, from_date: str, to_date: str,
                   page_index: int = 1, page_size: int | None = None) -> dict[str, Any]:
        """Lịch sử OHLC ngày — đối chiếu mức giá dài hạn, ngưỡng biến động dài hạn."""
        params: dict[str, Any] = {
            "symbol": symbol.upper(), "market": market.upper(),
            "fromDate": from_date, "toDate": to_date, "pageIndex": page_index,
            "pageSize": int(page_size or self.rest.get("ohlc_page_size", 100)),
            "ascending": "true",
        }
        return self._get(str(self.rest.get("ohlc_path", "api/v3/Market/DailyOHLCHistory")),
                         params)

    def ohlc_frame(self, symbol: str, market: str, from_date: str, to_date: str) -> "pd.DataFrame":
        """Gom toàn bộ trang OHLC ngày thành DataFrame chuẩn hóa (một cột = một đại lượng).

        Chuẩn hóa: ngày → ``session_date`` (YYYY-MM-DD), OHLCV → float, giá giữ đơn vị
        VND như SSI công bố cho endpoint ngày; log cảnh báo nếu Close nhỏ hơn 1% giá
        tham chiếu của tick (dấu hiệu lệch đơn vị nghìn-đ/VND — cần kiểm tra thủ công).
        """
        import pandas as pd

        rows: list[dict[str, Any]] = []
        page = 1
        total_pages = 1
        while page <= total_pages:
            body = self.daily_ohlc(symbol, market, from_date, to_date, page_index=page)
            data = body.get("data")
            items = data if isinstance(data, list) else (
                data.get("items") or data.get("rows") or data.get("content") or
                (body.get("items") if isinstance(body.get("items"), list) else []))
            if not isinstance(items, list):
                items = []
            total_pages = int(_first_key(data if isinstance(data, dict) else body,
                                         "totalPages", "total_pages", "TotalPage") or 1)
            for item in items:
                if not isinstance(item, dict):
                    continue
                rows.append({
                    "symbol": str(_first_key(item, "Symbol", "symbol") or symbol).upper(),
                    "session_date": str(_first_key(item, "TradingDate", "trading_date", "Date", "date") or "")[:10],
                    "open": _first_key(item, "Open", "open"),
                    "high": _first_key(item, "High", "high"),
                    "low": _first_key(item, "Low", "low"),
                    "close": _first_key(item, "Close", "close"),
                    "volume": _first_key(item, "Volume", "volume"),
                    "value": _first_key(item, "Value", "value"),
                })
            page += 1
        frame = pd.DataFrame(rows)
        if frame.empty:
            logger.warning("SSI OHLC: {} không có dữ liệu {} → {}", symbol, from_date, to_date)
            return frame
        for col in ("open", "high", "low", "close", "volume", "value"):
            frame[col] = pd.to_numeric(frame[col], errors="coerce")
        frame = frame.dropna(subset=["close"]).drop_duplicates(
            subset=["symbol", "session_date"]).sort_values("session_date").reset_index(drop=True)
        n_bad = int((frame["close"] <= 0).sum())
        if n_bad:
            logger.warning("SSI OHLC {}: {} bản ghi close ≤ 0 bị loại", symbol, n_bad)
            frame = frame[frame["close"] > 0]
        return frame

    # ----------------------------------------------- endpoint 2: danh mục CK
    def securities(self, market: str | None = None, page_index: int = 1) -> dict[str, Any]:
        """Danh mục chứng khoán — hợp lệ hóa watchlist trước khi subscribe stream."""
        params: dict[str, Any] = {"pageIndex": page_index,
                                  "pageSize": int(self.rest.get("securities_page_size", 1000))}
        if market:
            params["market"] = market.upper()
        return self._get(str(self.rest.get("securities_path", "api/v3/Market/Securities")),
                         params)

    def securities_frame(self, market: str | None = None) -> "pd.DataFrame":
        """Gom danh mục CK thành DataFrame chuẩn hóa: symbol, market, type, lot."""
        import pandas as pd

        rows: list[dict[str, Any]] = []
        page, total_pages = 1, 1
        while page <= total_pages:
            body = self.securities(market, page_index=page)
            data = body.get("data")
            items = data if isinstance(data, list) else (
                data.get("items") or data.get("rows") or data.get("content") or [])
            if not isinstance(items, list):
                items = []
            total_pages = int(_first_key(data if isinstance(data, dict) else body,
                                         "totalPages", "total_pages", "TotalPage") or 1)
            for item in items:
                if isinstance(item, dict):
                    rows.append({
                        "symbol": str(_first_key(item, "Symbol", "symbol") or "").upper(),
                        "market": str(_first_key(item, "Market", "market") or market or ""),
                        "type": _first_key(item, "StockType", "stock_type", "Type", "type"),
                        "lot_size": _first_key(item, "LotSize", "lot_size", "LoT", "lot"),
                    })
            page += 1
        frame = pd.DataFrame(rows).drop_duplicates(subset=["symbol"]).reset_index(drop=True)
        return frame

    def validate_watchlist(self, symbols: list[str], market: str | None = None) -> dict[str, Any]:
        """Đối chiếu watchlist với danh mục SSI; trả về mã hợp lệ/không hợp lệ."""
        catalog = self.securities_frame(market)
        known = set(catalog["symbol"]) if len(catalog) else set()
        requested = {s.upper() for s in symbols}
        return {"valid": sorted(known & requested),
                "unknown": sorted(requested - known),
                "catalog_rows": len(catalog)}

    def compliance_report(self) -> dict[str, float]:
        return {"requests_total": self.bucket.total_acquired,
                "rate_limit_rps": self.bucket.rate,
                "seconds_waited_for_limit": round(self.bucket.total_waited_s, 3)}

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "SsiRestClient":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()
