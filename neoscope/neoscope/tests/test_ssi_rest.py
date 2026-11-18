"""Kiểm thử SSI FastConnect v3 REST client (HTTP giả lập, không mạng thật).

Bao phủ: parser token phòng thủ, phân trang OHLC, chuẩn hóa kiểu số, loại bản
ghi close ≤ 0, dedup, retry với 429, refresh token đúng một lần khi 401,
danh mục CK + hợp lệ hóa watchlist, và ràng buộc an toàn: không có endpoint
giao dịch nào tồn tại trong module.
"""
from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest

from neoscope.config import load_settings
from neoscope.ssi_api import rest as rest_mod
from neoscope.ssi_api.rest import SsiRestClient, SsiRestError

SRC = Path(rest_mod.__file__).resolve()


class FakeResponse:
    def __init__(self, status_code: int, body):
        self.status_code = status_code
        self._body = body

    def json(self):
        return self._body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class FakeHttpClient:
    """Ghi lại mọi request; phản hồi theo kịch bản đăng ký trước."""

    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.requests: list[tuple[str, str, dict]] = []  # (method, path, payload-ish)
        self.routes: dict[tuple[str, str], list] = {}
        self.timeout = kwargs.get("timeout")

    def route(self, method: str, path: str, responses: list):
        self.routes[(method, path)] = list(responses)

    def _respond(self, method: str, path: str):
        key = (method, path)
        if key not in self.routes or not self.routes[key]:
            raise AssertionError(f"request không mong đợi: {method} {path}")
        item = self.routes[key].pop(0)
        return item() if callable(item) else item

    def post(self, path, json=None, **kw):
        self.requests.append(("POST", path, json))
        return self._respond("POST", path)

    def get(self, path, params=None, headers=None, **kw):
        self.requests.append(("GET", path, params))
        return self._respond("GET", path)

    def close(self):
        pass


TOKEN_BODY = {"status": "Success", "data": {"accessToken": "tok-123", "expiresIn": 3600}}


def make_client(monkeypatch, tmp_path) -> tuple[SsiRestClient, FakeHttpClient]:
    fake = FakeHttpClient()
    monkeypatch.setattr(rest_mod.httpx, "Client", lambda **kw: fake)
    for var, val in [("SSI_CLIENT_ID", "cid"), ("SSI_API_KEY", "key"), ("SSI_API_SECRET", "sec")]:
        monkeypatch.setenv(var, val)
    s = load_settings()
    client = SsiRestClient(s)
    return client, fake


def test_token_payload_and_cache(monkeypatch, tmp_path):
    client, fake = make_client(monkeypatch, tmp_path)
    fake.route("POST", "api/v3/Market/AccessToken", [FakeResponse(200, TOKEN_BODY)])
    assert client.tokens.get_token() == "tok-123"
    assert client.tokens.get_token() == "tok-123"          # cache: không gọi lại
    assert fake.requests.count(("POST", "api/v3/Market/AccessToken",
                                {"clientId": "cid", "apiKey": "key", "apiSecret": "sec"})) == 1
    client.close()


def test_token_flat_alternate_shape(monkeypatch, tmp_path):
    client, fake = make_client(monkeypatch, tmp_path)
    fake.route("POST", "api/v3/Market/AccessToken",
               [FakeResponse(200, {"access_token": "tok-flat", "expires_in": 60})])
    assert client.tokens.get_token() == "tok-flat"
    client.close()


def test_ohlc_pagination_normalization(monkeypatch, tmp_path):
    client, fake = make_client(monkeypatch, tmp_path)
    fake.route("POST", "api/v3/Market/AccessToken", [FakeResponse(200, TOKEN_BODY)])
    fake.route("GET", "api/v3/Market/DailyOHLCHistory", [
        FakeResponse(200, {"status": "Success", "data": {
            "totalPages": 2,
            "items": [
                {"Symbol": "hpg", "TradingDate": "2026/11/13", "Open": "29.0", "High": 30,
                 "Low": 28.5, "Close": "29.8", "Volume": "1.2E7", "Value": 3.5e11},
                {"Symbol": "HPG", "TradingDate": "2026/11/14", "Open": 29.8, "High": 30.2,
                 "Low": 29.5, "Close": -5, "Volume": 1e7, "Value": 3e11},   # close âm → loại
            ]}}),
        FakeResponse(200, {"status": "Success", "data": {
            "totalPages": 2,
            "items": [
                {"Symbol": "HPG", "TradingDate": "2026/11/14", "Open": 29.8, "High": 30.2,
                 "Low": 29.5, "Close": 30.0, "Volume": 1e7, "Value": 3e11},   # trùng ngày → dedup
                {"Symbol": "HPG", "TradingDate": "2026/11/16", "Open": 30.0, "High": 30.4,
                 "Low": 29.9, "Close": 30.3, "Volume": 9e6, "Value": 2.7e11},
            ]}}),
    ])
    df = client.ohlc_frame("HPG", "HOSE", "2026-11-10", "2026-11-16")
    # 2 mục trang 1 (1 hợp lệ) + 2 mục trang 2 (1 bản ghi trùng ngày bị dedup) = 2 dòng
    assert len(df) == 2
    assert df["symbol"].tolist() == ["HPG", "HPG"]
    assert df["session_date"].tolist() == ["2026/11/13", "2026/11/16"]
    assert (df["close"] > 0).all()
    assert df["close"].tolist() == [29.8, 30.3]
    assert df["volume"].dtype.kind == "f"
    assert list(df.columns) == ["symbol", "session_date", "open", "high",
                                "low", "close", "volume", "value"]
    client.close()


def test_retry_on_429_then_success(monkeypatch, tmp_path):
    client, fake = make_client(monkeypatch, tmp_path)
    fake.route("POST", "api/v3/Market/AccessToken", [FakeResponse(200, TOKEN_BODY)])
    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        if calls["n"] == 1:
            return FakeResponse(429, {})
        return FakeResponse(200, {"status": "Success", "data": {"items": [], "totalPages": 1}})

    fake.route("GET", "api/v3/Market/DailyOHLCHistory", [flaky, flaky])
    monkeypatch.setattr(rest_mod.time, "sleep", lambda *_: None)  # không chờ thật
    df = client.ohlc_frame("HPG", "HOSE", "2026-11-10", "2026-11-16")
    assert df.empty and calls["n"] == 2
    client.close()


def test_401_refreshes_token_once(monkeypatch, tmp_path):
    client, fake = make_client(monkeypatch, tmp_path)
    fake.route("POST", "api/v3/Market/AccessToken", [
        FakeResponse(200, TOKEN_BODY),
        FakeResponse(200, {"status": "Success", "data": {"accessToken": "tok-2", "expiresIn": 3600}}),
    ])
    seq = iter([FakeResponse(401, {}),
                FakeResponse(200, {"status": "Success", "data": {"items": [], "totalPages": 1}})])
    fake.route("GET", "api/v3/Market/Securities", list(seq))
    df = client.securities_frame("HOSE")
    assert df.empty
    auths = [r for r in fake.requests if r[0] == "POST"]
    assert len(auths) == 2  # token cũ + token mới sau 401
    client.close()


def test_error_status_raises(monkeypatch, tmp_path):
    client, fake = make_client(monkeypatch, tmp_path)
    fake.route("POST", "api/v3/Market/AccessToken", [FakeResponse(200, TOKEN_BODY)])
    fake.route("GET", "api/v3/Market/Securities",
               [FakeResponse(200, {"status": "Fail", "code": "MD-403", "message": "forbidden"})])
    with pytest.raises(SsiRestError) as exc_info:
        client.securities_frame("HOSE")
    assert "MD-403" in str(exc_info.value) and "forbidden" in str(exc_info.value)
    client.close()


def test_validate_watchlist_splits_valid_unknown(monkeypatch, tmp_path):
    client, fake = make_client(monkeypatch, tmp_path)
    fake.route("POST", "api/v3/Market/AccessToken", [FakeResponse(200, TOKEN_BODY)])
    fake.route("GET", "api/v3/Market/Securities", [FakeResponse(200, {"status": "Success", "data": [
        {"Symbol": "HPG", "Market": "HOSE", "StockType": "ST", "LotSize": 100},
        {"Symbol": "SSI", "Market": "HOSE", "StockType": "ST", "LotSize": 100},
    ]})])
    result = client.validate_watchlist(["HPG", "SSI", "FAKE9"])
    assert result["valid"] == ["HPG", "SSI"]
    assert result["unknown"] == ["FAKE9"]
    assert result["catalog_rows"] == 2
    client.close()


def test_module_has_no_trading_endpoints():
    """Ràng buộc an toàn tĩnh: REST module SSI không CHỨA LỜI GỌI giao dịch.

    Quét theo cú pháp lời gọi (token + dấu ngoặc) để không vấp các đoạn tài liệu
    cảnh báo trong docstring của chính module.
    """
    text = SRC.read_text(encoding="utf-8").lower()
    for banned in ("placeorder(", "amendorder(", "cancelorder(",
                   "ordernew(", "trading_ws(", "tradingclient("):
        assert banned not in text
    # Chỉ có 2 nhóm endpoint dữ liệu được khai báo
    assert "dailyohlchistory" in text and "securities" in text
