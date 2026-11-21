import asyncio
import json

from neoscope.neo_api.ws import NeoMarketWS


def test_neo_market_stream_uses_official_endpoint(settings):
    assert str(settings.neo_api.ws_url) == "wss://neoapi.vpbanks.com.vn/stock-stream/broker"


def test_cancel_during_reconnect_wait_finalizes_capture(tmp_settings, tmp_path, monkeypatch):
    session_dir = tmp_path / "LIVE_NEO_test"
    recorder = NeoMarketWS(tmp_settings, session_dir)

    async def fail_connection():
        raise TimeoutError("auth response timed out")

    monkeypatch.setattr(recorder, "_run_once", fail_connection)

    async def cancel_during_backoff():
        task = asyncio.create_task(recorder.run())
        while not recorder.status_path.exists():
            await asyncio.sleep(0)
        while json.loads(recorder.status_path.read_text(encoding="utf-8"))["state"] != "reconnecting":
            await asyncio.sleep(0.01)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    asyncio.run(cancel_during_backoff())

    manifest_path = session_dir / "manifest.json"
    assert manifest_path.exists()
    assert json.loads(recorder.status_path.read_text(encoding="utf-8"))["state"] == "stopped"
