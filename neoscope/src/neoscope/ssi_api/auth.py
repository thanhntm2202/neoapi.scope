"""Create an SSI SDK configuration from environment-only credentials."""
from __future__ import annotations

from ..config import Settings, env_secret


def sdk_config(settings: Settings):
    """Return the official SDK Config without exposing credentials to logs/files."""
    try:
        from ssi_sdk import Config
    except ImportError as exc:  # pragma: no cover - depends on installation
        raise RuntimeError("Thiếu SSI SDK. Cài đặt bằng `pip install -e .`.") from exc

    cfg = settings.ssi_api
    return Config(
        client_id=env_secret("SSI_CLIENT_ID"),
        api_key=env_secret("SSI_API_KEY"),
        api_secret=env_secret("SSI_API_SECRET"),
        api_url=str(cfg.api_url),
        streaming_url=str(cfg.streaming_url),
        timeout_ms=int(cfg.timeout_ms),
        max_retries=int(cfg.max_retries),
        rate_limit_per_second=int(cfg.rate_limit_rps),
        auto_reconnect=True,
        log_level="WARNING",
    )
