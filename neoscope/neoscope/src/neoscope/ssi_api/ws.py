"""SSI FastConnect v3 market-data recorder (read-only).

Raw SSI messages are retained by topic. Quote/trade/market messages are also
adapted into the existing canonical ``stockInfo``/``marketInfo`` channels so
the established quality, microstructure, and validation pipeline remains
usable. SSI quote prices are quoted in VND thousands in its published examples;
they are converted to VND before entering the canonical pipeline. The SDK-decoded,
provider-shaped message is retained in its topic-specific RAW channel; this is
not a packet-level copy of the original wire bytes.
"""
from __future__ import annotations

import json
import queue
import signal
import threading
import time
from dataclasses import asdict, is_dataclass
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any

from loguru import logger

from ..config import Settings, env_secret
from ..constants import VN_TZ
from ..data.store import RawWriter
from .auth import sdk_config

_QUEUE_STOP = object()


def _as_mapping(message: Any) -> dict[str, Any]:
    if isinstance(message, dict):
        return _json_safe(message)
    if hasattr(message, "model_dump"):
        try:
            return _json_safe(message.model_dump(mode="json", by_alias=True, exclude_none=False))
        except TypeError:
            return _json_safe(message.model_dump(by_alias=True))
    if hasattr(message, "dict"):
        return _json_safe(message.dict(by_alias=True))
    if is_dataclass(message):
        return _json_safe(asdict(message))
    if hasattr(message, "__dict__"):
        return _json_safe({k: v for k, v in vars(message).items() if not k.startswith("_")})
    raise TypeError(f"Kiểu message SSI không hỗ trợ: {type(message).__name__}")


def _json_safe(value: Any) -> Any:
    if isinstance(value, Enum):
        return _json_safe(value.value)
    if isinstance(value, datetime):
        return value.isoformat()
    if is_dataclass(value):
        return _json_safe(asdict(value))
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    return value


def _pick(data: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in data:
            return data[key]
    return None


def _num(value: Any) -> float | None:
    try:
        return float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _ssi_price_to_vnd(value: Any) -> float | None:
    value = _num(value)
    return value * 1000 if value is not None else None


def _levels(values: Any) -> list[list[Any]]:
    if not isinstance(values, (list, tuple)):
        return []
    out: list[list[Any]] = []
    for level in values[:5]:
        if isinstance(level, (list, tuple)) and len(level) >= 2:
            out.append([level[0], level[1]])
    return out


def _quote_side(data: dict[str, Any], side: str) -> list[list[Any]]:
    """Accept raw short-key arrays and the SDK's typed parallel arrays."""
    direct = data.get("bids" if side == "bid" else "asks")
    if direct is not None:
        return _levels(direct)
    prices = data.get(f"{side}_prices", []) or []
    volumes = data.get(f"{side}_volumes", []) or []
    return [[price, volumes[i] if i < len(volumes) else None]
            for i, price in enumerate(prices[:5])]


class SsiMarketWS:
    """Record SSI DATA WebSocket messages with reconnect and audit metadata."""

    def __init__(self, settings: Settings, session_dir: Path):
        self.cfg = settings
        self._capture_date = datetime.now(VN_TZ).date()
        self._stop_detail = ""
        self.writer = RawWriter(session_dir, "LIVE", meta={
            "provider": "SSI FastConnect API v3",
            "source": "SSI FastConnect market-data stream",
            "session_date": datetime.now(VN_TZ).strftime("%Y-%m-%d"),
            "config_hash": settings.config_hash,
            "canonical_price_unit": "VND",
            "ssi_quote_price_conversion": "SSI quote book prices × 1000 to VND; SDK-decoded provider-shaped messages retained, not wire bytes",
        })
        self.status_path = settings.data_path("live_status_ssi.json")
        self._stop = threading.Event()
        self._msg_count = 0
        self._state: dict[str, dict[str, Any]] = {}
        self._last_msg_mono = time.monotonic()
        self._status_state = "starting"
        self._connection_failure: str | None = None
        self._processing_failure: str | None = None
        self._ingest_queue: queue.Queue = queue.Queue(
            maxsize=max(100, int(settings.ssi_api.get("ingest_queue_size", 10_000))))
        self._writer_thread: threading.Thread | None = None
        self._status_lock = threading.Lock()
        self._callback_errors = 0

    def _write_status(self, state: str, detail: str = "") -> None:
        with self._status_lock:
            self._status_state = state
            self.status_path.parent.mkdir(parents=True, exist_ok=True)
            status = json.dumps({
                "state": state, "detail": detail,
                "updated_at": datetime.now(VN_TZ).isoformat(),
                "messages": self._msg_count,
                "queue_depth": self._ingest_queue.qsize(),
                "callback_errors": self._callback_errors,
                "mode": "LIVE", "provider": "SSI FastConnect API v3",
            }, ensure_ascii=False)
            tmp = self.status_path.with_suffix(self.status_path.suffix + ".tmp")
            tmp.write_text(status, encoding="utf-8")
            tmp.replace(self.status_path)

    def _canonical_stock(self, topic: str, data: dict[str, Any]) -> dict[str, Any] | None:
        symbol = str(_pick(data, "s", "symbol") or "").upper()
        if not symbol:
            return None
        state = self._state.setdefault(symbol, {"bids": [], "asks": []})
        if topic == "ssi_quote":
            # Current SSI messages carry the full visible levels. Replace each side atomically;
            # do not interpret a shorter list as a sparse positional delta.
            for side in ("bids", "asks"):
                incoming = _quote_side(data, "bid" if side == "bids" else "ask")
                if side in data or f"{side[:-1]}_prices" in data:
                    state[side] = incoming
        elif topic == "ssi_trade":
            state["trade"] = data
        elif topic == "ssi_market":
            state["market"] = data
        elif topic == "ssi_room":
            state["room"] = data

        bid = state["bids"]
        ask = state["asks"]
        trade = state.get("trade", {})
        market = state.get("market", {})
        room = state.get("room", {})
        canonical: dict[str, Any] = {
            "symbol": symbol,
            "refPrice": _ssi_price_to_vnd(_pick(market, "ref", "refPrice", "ref_price")),
            "ceilingPrice": _ssi_price_to_vnd(_pick(market, "ce", "ceiling", "ceilingPrice")),
            "floorPrice": _ssi_price_to_vnd(_pick(market, "fl", "floor", "floorPrice")),
            "closePrice": _num(_pick(trade, "p", "price")),
            "closeVol": _num(_pick(trade, "q", "quantity")),
            "openPrice": _num(_pick(trade, "o", "openPrice", "open")),
            "highPrice": _num(_pick(trade, "h", "highPrice", "high")),
            "lowPrice": _num(_pick(trade, "l", "lowPrice", "low")),
            "averagePrice": _num(_pick(trade, "a", "avgPrice", "avg")),
            "totalTradingVolume": _num(_pick(trade, "v", "totalVol", "total_volume")),
            "totalTradingValue": (
                (_num(_pick(trade, "a", "avgPrice", "avg")) or 0.0)
                * (_num(_pick(trade, "v", "totalVol", "total_volume")) or 0.0)
                if _num(_pick(trade, "a", "avgPrice", "avg")) is not None
                and _num(_pick(trade, "v", "totalVol", "total_volume")) is not None else None
            ),
            "foreignRoom": _num(_pick(room, "tr", "totalRoom", "total_room")),
            "foreignRemain": _num(_pick(room, "cr", "currentRoom", "current_room")),
            # SSI documents these fields but not whether they are per-event or
            # session-cumulative. Preserve their source values in RAW only until verified.
            "foreignBuyVolume": None,
            "foreignBuyValue": None,
            "foreignSellVolume": None,
            "foreignSellValue": None,
        }
        for side, levels in (("bid", bid), ("ask", ask)):
            for i in range(1, 4):
                level = levels[i - 1] if len(levels) >= i else [None, None]
                canonical[f"{side}Price{i}"] = _ssi_price_to_vnd(level[0])
                canonical[f"{side}Vol{i}"] = _num(level[1])
        event_time = _pick(data, "t", "trading_time")
        if isinstance(event_time, str) and " " in event_time.strip():
            canonical["event_ts"] = event_time.strip()
        # No SSI field equivalent: keep these null rather than fabricating values.
        canonical["totalBidQTTY"] = None
        canonical["totalAskQTTY"] = None
        return canonical

    @staticmethod
    def _topic(message: Any, data: dict[str, Any]) -> str:
        name = type(message).__name__.lower()
        topic = str(_pick(data, "topic", "channel", "type") or "").lower()
        if "marketflag" in name or "marketstatus" in name or (
                ("f" in data or "flag" in data) and ("b" in data or "board" in data)
                and "s" not in data and "symbol" not in data):
            return "ssi_marketflag"
        if "quote" in name or topic.startswith("quote") or "bids" in data or "asks" in data:
            return "ssi_quote"
        if "room" in name or topic.startswith("room") or "tr" in data and "cr" in data:
            return "ssi_room"
        if "market" in name or topic.startswith("market"):
            return "ssi_market"
        if "indexsummary" in name or "index_summary" in name or topic.startswith("indexsummary"):
            return "ssi_indexsummary"
        if "trade" in name or topic.startswith("trade") or "si" in data:
            return "ssi_trade"
        return "ssi_unknown"

    def _on_data(self, message: Any, from_typed_callback: bool = False) -> None:
        """Decode and enqueue quickly; one worker serializes state and writes RAW.

        SSI invokes callbacks on the SDK reader thread. A bounded queue prevents
        disk compression and canonicalization from stalling socket reads. Queue
        saturation fails the capture visibly instead of silently dropping ticks.
        """
        try:
            data = _as_mapping(message)
            topic = self._topic(message, data)
            # The SDK exposes dedicated callbacks for these two message types.
            # Persist only there if its generic callback also forwards them.
            if topic in {"ssi_indexsummary", "ssi_marketflag"} and not from_typed_callback:
                return
            self._last_msg_mono = time.monotonic()
            self._ingest_queue.put_nowait((topic, data))
        except queue.Full:
            self._callback_errors += 1
            self._connection_failure = "SSI ingest queue saturated; capture is incomplete"
            self._stop.set()
        except Exception as exc:  # never log payloads, symbols, or credential-bearing SDK errors
            self._callback_errors += 1
            self._processing_failure = f"SSI callback decode failed: {type(exc).__name__}"
            self._stop.set()
            logger.error("SSI callback failed; capture stopping ({})", type(exc).__name__)

    def _persist_message(self, topic: str, data: dict[str, Any]) -> None:
        self.writer.write(topic, data)
        if topic in {"ssi_quote", "ssi_trade", "ssi_market", "ssi_room"}:
            canonical = self._canonical_stock(topic, data)
            if canonical:
                self.writer.write("stockInfo", canonical)
        elif topic == "ssi_indexsummary":
            summary_data = data.get("data") if isinstance(data.get("data"), dict) else data
            summary_data = {"index": data.get("index"), **summary_data}
            canonical = self._canonical_index(summary_data)
            if canonical:
                self.writer.write("marketInfo", canonical)
        self._msg_count += 1
        if self._status_state == "stale":
            self._write_status("connected")
        elif self._msg_count % 200 == 0:
            self._write_status("connected")

    def _writer_loop(self) -> None:
        while True:
            item = self._ingest_queue.get()
            try:
                if item is _QUEUE_STOP:
                    return
                if self._processing_failure:
                    continue
                try:
                    self._persist_message(*item)
                except Exception as exc:
                    self._callback_errors += 1
                    self._processing_failure = f"SSI capture writer failed: {type(exc).__name__}"
                    self._stop.set()
                    logger.error("SSI capture writer failed; capture stopping ({})", type(exc).__name__)
            finally:
                self._ingest_queue.task_done()

    def _start_writer(self) -> None:
        if self._writer_thread is not None:
            return
        self._writer_thread = threading.Thread(
            target=self._writer_loop, name="neoscope-ssi-raw-writer", daemon=True)
        self._writer_thread.start()

    def _stop_writer(self) -> None:
        worker = self._writer_thread
        if worker is None:
            return
        self._ingest_queue.join()
        self._ingest_queue.put(_QUEUE_STOP)
        worker.join()
        self._writer_thread = None

    def _canonical_index(self, data: dict[str, Any]) -> dict[str, Any] | None:
        code = _pick(data, "s", "index", "index_name", "indexCode")
        if not code:
            return None
        stamp = str(_pick(data, "t", "trading_time") or "")
        date_part, _, time_part = stamp.partition(" ")
        return {
            "indexCode": code,
            "indexValue": _pick(data, "v", "index_value", "indexValue"),
            "indexPercentChange": _pick(data, "cr", "index_ratio_change", "change_percent", "indexPercentChange"),
            "dateString": date_part.replace("/", "-"),
            "indexTime": time_part,
            "totalVolume": _pick(data, "tq", "total_qty", "total_quantity", "totalVolume"),
            "totalValue": _pick(data, "tv", "total_value", "totalValue"),
            "marketStatus": _pick(data, "ss", "trading_session", "status", "marketStatus"),
            "advances": _pick(data, "adv", "advances"),
            "declines": _pick(data, "dec", "declines"),
            "noChange": _pick(data, "nc", "no_change"),
            "numberOfCe": _pick(data, "ce", "ceilings"),
            "numberOfFl": _pick(data, "fl", "floors"),
        }

    def run(self) -> None:
        try:
            from ssi_sdk import Auth, Stream
        except ImportError as exc:  # pragma: no cover - depends on installation
            raise RuntimeError("SSI SDK chưa cài. Chạy `pip install -e .`.") from exc

        self._write_status("starting")
        self._start_writer()
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                signal.signal(sig, lambda *_: self._stop.set())
            except (ValueError, OSError):
                pass
        failed = False
        try:
            cfg = sdk_config(self.cfg)
            with Auth(cfg) as auth:
                # SSI v3 distinguishes REST market data (no OTP) from
                # streaming flows, which can require an OTP by entitlement.
                # Read an optional OTP from the process environment only;
                # never persist or log it. The no-OTP market-data path remains
                # available where the provider permits it.
                otp = env_secret("SSI_OTP", required=False)
                if otp:
                    auth.authenticate(otp=otp)
                else:
                    auth.authenticate()
                with Stream(auth) as stream:
                    ws = stream.streaming
                    ws.on_data = self._on_data
                    ws.on_index_summary = lambda msg: self._on_data(msg, from_typed_callback=True)
                    ws.on_market_flag = lambda msg: self._on_data(msg, from_typed_callback=True)
                    ws.on_connection = self._on_connection
                    ws.connect()
                    symbols = self.cfg.watchlist()
                    ws.subscribe_symbol_trade(symbols)
                    ws.subscribe_symbol_quote(symbols)
                    ws.subscribe_symbol_room(symbols)
                    ws.subscribe_market(symbols)
                    ws.subscribe_index_summary(list(self.cfg.indices))
                    ws.subscribe_market_flag()
                    self._write_status("connected")
                    logger.info("SSI FastConnect v3 stream connected; symbols={} (market data only)", len(symbols))
                    while not self._stop.is_set():
                        ws.wait(timeout_ms=5000)
                        if datetime.now(VN_TZ).date() != self._capture_date:
                            self._stop_detail = "Capture stopped at Vietnam calendar-day boundary; restart for the next date."
                            self._stop.set()
                            break
                        if self._connection_failure or self._processing_failure:
                            raise ConnectionError(
                                "SSI stream stopped because capture could not remain complete: "
                                + (self._connection_failure or self._processing_failure or "unknown failure")
                            )
                        silent_s = time.monotonic() - self._last_msg_mono
                        if silent_s > float(self.cfg.ssi_api.ws_watchdog_s):
                            self._write_status("stale", f"No market message for {silent_s:.0f}s; SDK reconnect is enabled")
        except Exception as exc:
            failed = True
            self._write_status("failed", type(exc).__name__)
            raise
        finally:
            self._stop_writer()
            self.writer.close()
            if failed or self._processing_failure or self._connection_failure:
                self._write_status("failed", self._processing_failure or self._connection_failure or "capture failure")
            else:
                self._write_status("stopped", self._stop_detail)
            logger.info("SSI stream stopped; messages={}", self._msg_count)

    def _on_connection(self, event: Any) -> None:
        raw_state = getattr(event, "state", "connection_event")
        state = str(raw_state.value if isinstance(raw_state, Enum) else raw_state)
        state = state.lower().rsplit(".", 1)[-1]
        error = getattr(event, "error", getattr(event, "err", None))
        detail = type(error).__name__ if error is not None else ""
        if state in {"connected", "reconnected"}:
            self._last_msg_mono = time.monotonic()
        elif state == "failed":
            self._connection_failure = detail or "unrecoverable SDK connection state"
            self._stop.set()
        self._write_status(state, detail)
