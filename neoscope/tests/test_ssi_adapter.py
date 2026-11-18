"""Contract tests for SSI FastConnect v3 decoding and canonicalization."""
from __future__ import annotations

import copy
import json
import sys
from datetime import datetime
from enum import Enum
from types import SimpleNamespace

import pytest

from neoscope.config import Settings
from neoscope.data.store import read_raw
from neoscope.ssi_api.auth import sdk_config
from neoscope.ssi_api.ws import SsiMarketWS, _as_mapping, _ssi_price_to_vnd


class _Side(Enum):
    BUY = "B"


class _TypedQuote:
    """Small stand-in for the Pydantic message objects returned by SSI SDK."""

    def model_dump(self, *, mode, by_alias, exclude_none):
        assert mode == "json"
        assert by_alias is True
        assert exclude_none is False
        return {
            "s": "SSI",
            "t": datetime(2026, 7, 29, 9, 15, 32).isoformat(),
            "bids": [["45.45", "3200"], ["45.40", "1500"]],
            "asks": [["45.50", "2800"]],
            "side": _Side.BUY,
        }


def test_typed_sdk_message_is_json_safe_and_keeps_aliases():
    msg = _as_mapping(_TypedQuote())
    assert msg["s"] == "SSI"
    assert msg["side"] == "B"
    assert msg["t"] == "2026-07-29T09:15:32"


def test_quote_prices_scale_to_vnd_and_leave_missing_levels_null(settings, tmp_path):
    ws = SsiMarketWS(settings, tmp_path / "capture")
    quote = {
        "s": "SSI",
        "t": "2026/07/29 09:15:32",
        "bids": [["45.45", "3200"], ["45.40", "1500"]],
        "asks": [["45.50", "2800"]],
    }

    canonical = ws._canonical_stock("ssi_quote", quote)

    assert _ssi_price_to_vnd("45.45") == 45450.0
    assert canonical["bidPrice1"] == 45450.0
    assert canonical["bidPrice2"] == 45400.0
    assert canonical["bidVol1"] == 3200.0
    assert canonical["askPrice1"] == 45500.0
    assert canonical["askVol1"] == 2800.0
    assert canonical["bidPrice3"] is None
    assert canonical["askPrice2"] is None
    assert canonical["totalBidQTTY"] is None
    assert canonical["totalAskQTTY"] is None
    ws.writer.close()


def test_trade_and_market_fields_keep_documented_vnd_units(settings, tmp_path):
    ws = SsiMarketWS(settings, tmp_path / "capture")
    market = {"s": "SSI", "ref": "45.30", "ce": "48.50", "fl": "42.10"}
    trade = {"s": "SSI", "t": "2026/07/29 09:15:32", "p": "45500",
             "q": "1000", "a": "45350", "v": "1250000"}

    ws._canonical_stock("ssi_market", market)
    canonical = ws._canonical_stock("ssi_trade", trade)

    assert canonical["refPrice"] == 45300.0
    assert canonical["ceilingPrice"] == 48500.0
    assert canonical["floorPrice"] == 42100.0
    assert canonical["closePrice"] == 45500.0
    assert canonical["averagePrice"] == 45350.0
    assert canonical["totalTradingVolume"] == 1250000.0
    assert canonical["totalTradingValue"] == 45350.0 * 1250000.0
    assert canonical["event_ts"] == "2026/07/29 09:15:32"
    ws.writer.close()


def test_callback_writes_topic_raw_and_derived_canonical_record(settings, tmp_path):
    session = tmp_path / "capture"
    ws = SsiMarketWS(settings, session)
    ws._start_writer()
    ws._on_data({
        "topic": "quote",
        "s": "SSI",
        "t": "2026/07/29 09:15:32",
        "bids": [["45.45", "3200"]],
        "asks": [["45.50", "2800"]],
    })
    ws._stop_writer()
    ws.writer.close()

    raw = list(read_raw(session, "ssi_quote"))
    canonical = list(read_raw(session, "stockInfo"))
    assert len(raw) == len(canonical) == 1
    assert raw[0]["data"]["bids"] == [["45.45", "3200"]]
    assert canonical[0]["data"]["bidPrice1"] == 45450.0
    assert canonical[0]["data"]["closePrice"] is None


def test_queue_saturation_marks_capture_incomplete_instead_of_dropping_silently(
        settings, tmp_path):
    isolated = Settings(copy.deepcopy(settings.as_dict()), settings.source)
    isolated._data["paths"]["data_dir"] = str(tmp_path / "data")
    isolated._data["ssi_api"]["ingest_queue_size"] = 100
    ws = SsiMarketWS(isolated, tmp_path / "capture")
    quote = {"topic": "quote", "s": "SSI", "bids": [["45.45", "3200"]],
             "asks": [["45.50", "2800"]]}

    for _ in range(100):
        ws._on_data(quote)
    ws._on_data(quote)

    assert ws._ingest_queue.full()
    assert ws._connection_failure == "SSI ingest queue saturated; capture is incomplete"
    assert ws._callback_errors == 1
    assert ws._stop.is_set()
    while not ws._ingest_queue.empty():
        ws._ingest_queue.get_nowait()
        ws._ingest_queue.task_done()
    ws.writer.close()


def test_index_summary_maps_breadth_and_exchange_totals(settings, tmp_path):
    ws = SsiMarketWS(settings, tmp_path / "capture")
    ws._start_writer()
    msg = {
        "topic": "indexsummary",
        "data": {"s": "VNINDEX", "b": "HOSE", "ss": "LO", "t": "2026/07/29 10:00:00",
                 "v": "1290.25", "cr": "0.42", "adv": "180", "dec": "90", "nc": "45",
                 "ce": "4", "fl": "1", "tmv": "1000000000", "tmq": "500000", "tv": "1100000000",
                 "tq": "510000"},
    }

    ws._on_data(msg, from_typed_callback=True)
    ws._stop_writer()
    ws.writer.close()
    index = list(read_raw(tmp_path / "capture", "marketInfo"))[0]["data"]

    assert index["indexCode"] == "VNINDEX"
    assert index["indexValue"] == "1290.25"
    assert index["indexPercentChange"] == "0.42"
    assert index["advances"] == "180"
    assert index["declines"] == "90"
    assert index["totalVolume"] == "510000"
    assert index["totalValue"] == "1100000000"


def test_sdk_config_uses_environment_credentials_and_market_data_defaults(
        settings, tmp_path, monkeypatch):
    isolated = Settings(copy.deepcopy(settings.as_dict()), settings.source)
    isolated._data["paths"]["data_dir"] = str(tmp_path / "data")
    for key, value in (("SSI_CLIENT_ID", "client-test"),
                       ("SSI_API_KEY", "key-test"),
                       ("SSI_API_SECRET", "secret-test")):
        monkeypatch.setenv(key, value)

    class FakeConfig:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    monkeypatch.setitem(sys.modules, "ssi_sdk", SimpleNamespace(Config=FakeConfig))
    cfg = sdk_config(isolated)

    assert cfg.kwargs["client_id"] == "client-test"
    assert cfg.kwargs["api_key"] == "key-test"
    assert cfg.kwargs["api_secret"] == "secret-test"
    assert cfg.kwargs["auto_reconnect"] is True
    assert cfg.kwargs["log_level"] == "WARNING"
    assert cfg.kwargs["timeout_ms"] > 0


def test_installed_ssi_sdk_accepts_config_and_market_stream_methods(
        settings, tmp_path, monkeypatch):
    import ssi_sdk
    from ssi_sdk import Auth, Stream

    isolated = Settings(copy.deepcopy(settings.as_dict()), settings.source)
    isolated._data["paths"]["data_dir"] = str(tmp_path / "data")
    monkeypatch.setenv("SSI_CLIENT_ID", "client-test")
    monkeypatch.setenv("SSI_API_KEY", "key-test")
    monkeypatch.setenv("SSI_API_SECRET", "secret-test")
    config = sdk_config(isolated)

    assert isinstance(config, ssi_sdk.Config)
    assert config.api_url == isolated.ssi_api.api_url
    assert config.streaming_url == isolated.ssi_api.streaming_url
    assert config.auto_reconnect is True
    with Auth(config) as auth:
        with Stream(auth) as stream:
            for method in ("connect", "wait", "subscribe_symbol_trade",
                           "subscribe_symbol_quote", "subscribe_symbol_room",
                           "subscribe_market", "subscribe_index_summary",
                           "subscribe_market_flag"):
                assert callable(getattr(stream.streaming, method))


@pytest.mark.parametrize(
    ("otp", "expected_auth"),
    [("", ("authenticate_no_otp",)), ("otp-test", ("authenticate_with_otp", "otp-test"))],
)
def test_recorder_uses_only_market_data_stream_and_closes_capture(
        settings, tmp_path, monkeypatch, otp, expected_auth):
    isolated = Settings(copy.deepcopy(settings.as_dict()), settings.source)
    isolated._data["paths"]["data_dir"] = str(tmp_path / "data")
    capture = tmp_path / "capture"
    calls = []
    recorder_ref = {}

    class FakeAuth:
        def __init__(self, config):
            calls.append(("auth_init", config))

        def __enter__(self):
            return self

        def __exit__(self, *_):
            calls.append(("auth_close",))

        def authenticate(self, otp=None):
            calls.append(("authenticate_with_otp", otp) if otp else ("authenticate_no_otp",))

    class FakeStreaming:
        def connect(self):
            assert callable(self.on_data)
            assert callable(self.on_index_summary)
            assert callable(self.on_market_flag)
            assert callable(self.on_connection)
            calls.append(("connect",))

        def subscribe_symbol_trade(self, symbols): calls.append(("trade", symbols))
        def subscribe_symbol_quote(self, symbols): calls.append(("quote", symbols))
        def subscribe_symbol_room(self, symbols): calls.append(("room", symbols))
        def subscribe_market(self, symbols): calls.append(("market", symbols))
        def subscribe_index_summary(self, indices): calls.append(("indexsummary", indices))
        def subscribe_market_flag(self): calls.append(("marketflag",))

        def wait(self, timeout_ms):
            calls.append(("wait", timeout_ms))
            self.on_data({"topic": "quote", "s": "SSI", "t": "2026/07/29 09:15:32",
                          "bids": [["45.45", "3200"]], "asks": [["45.50", "2800"]]})
            recorder_ref["recorder"]._stop.set()

    class FakeStream:
        def __init__(self, auth):
            self.streaming = FakeStreaming()
            calls.append(("stream_init",))

        def __enter__(self):
            return self

        def __exit__(self, *_):
            calls.append(("stream_close",))

    monkeypatch.setitem(sys.modules, "ssi_sdk", SimpleNamespace(
        Auth=FakeAuth, Stream=FakeStream,
        Config=lambda **kwargs: SimpleNamespace(**kwargs),
    ))
    monkeypatch.setenv("SSI_CLIENT_ID", "client-test")
    monkeypatch.setenv("SSI_API_KEY", "key-test")
    monkeypatch.setenv("SSI_API_SECRET", "secret-test")
    monkeypatch.setenv("SSI_OTP", otp)
    recorder = SsiMarketWS(isolated, capture)
    recorder_ref["recorder"] = recorder

    recorder.run()

    assert expected_auth in calls
    assert ("stream_close",) in calls
    assert all(call[0] not in {"trade_order", "trading_ws"} for call in calls)
    assert {"trade", "quote", "room", "market", "indexsummary", "marketflag"}.issubset(
        {call[0] for call in calls})
    manifest = json.loads((capture / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["counts"]["ssi_quote"] == 1
    assert manifest["counts"]["stockInfo"] == 1
    status = json.loads((tmp_path / "data" / "live_status_ssi.json").read_text(encoding="utf-8"))
    assert status["state"] == "stopped"
    assert "secret-test" not in json.dumps(manifest)
    assert "secret-test" not in json.dumps(status)
    assert otp not in json.dumps(manifest)
    assert otp not in json.dumps(status)

