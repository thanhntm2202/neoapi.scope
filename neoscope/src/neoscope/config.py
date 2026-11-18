"""Load settings.yaml and environment variables for provider selection/secrets.

Nguyên tắc bảo mật: bí mật (username/password/token) CHỈ đọc từ môi trường,
không bao giờ nằm trong YAML hay được ghi vào log/parquet.
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings:
    """Bao mỏng quanh dict YAML với truy cập thuộc tính tiện lợi."""

    def __init__(self, data: dict[str, Any], source: Path):
        self._data = data
        self.source = source

    def __getattr__(self, name: str) -> Any:
        try:
            v = self._data[name]
        except KeyError as e:
            raise AttributeError(name) from e
        return Settings(v, self.source) if isinstance(v, dict) else v

    def get(self, name: str, default: Any = None) -> Any:
        v = self._data.get(name, default)
        return Settings(v, self.source) if isinstance(v, dict) else v

    def as_dict(self) -> dict[str, Any]:
        return self._data

    @property
    def config_hash(self) -> str:
        """Hash cấu hình — ghi vào manifest để truy vết tái lập."""
        raw = yaml.safe_dump(self._data, sort_keys=True, allow_unicode=True)
        return hashlib.sha256(raw.encode()).hexdigest()[:16]

    def watchlist(self) -> list[str]:
        w = self._data["watchlist"]
        return list(w["large"]) + list(w["thin"])

    def group_of(self, symbol: str) -> str:
        return "large" if symbol in self._data["watchlist"]["large"] else "thin"

    def data_path(self, *parts: str) -> Path:
        return REPO_ROOT / self._data["paths"]["data_dir"] / Path(*parts)

    def results_path(self, *parts: str) -> Path:
        base = REPO_ROOT / self._data["paths"]["results_dir"]
        if self.mode == "LIVE":
            base = base / self.provider
        return base / Path(*parts)

    @property
    def provider(self) -> str:
        """Active live feed; NEO is an explicit backup and never auto-mixed with SSI."""
        return "SYNTHETIC" if self.mode == "SYNTHETIC" else str(self._data["provider"])

    @property
    def dataset_mode(self) -> str:
        """Directory selector isolating each live provider's sessions."""
        return "SYNTHETIC" if self.mode == "SYNTHETIC" else f"LIVE_{self.provider}"


def load_settings(path: str | Path | None = None, provider: str | None = None) -> Settings:
    load_dotenv(REPO_ROOT / ".env", override=False)
    p = Path(path) if path else REPO_ROOT / "config" / "settings.yaml"
    with open(p, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    mode = os.environ.get("NEOSCOPE_MODE", data.get("mode", "SYNTHETIC")).upper()
    if mode not in {"SYNTHETIC", "LIVE"}:
        raise ValueError(f"NEOSCOPE_MODE không hợp lệ: {mode}")
    active_provider = (provider or os.environ.get("NEOSCOPE_PROVIDER")
                       or data.get("provider", "SSI")).upper()
    if active_provider not in {"NEO", "SSI"}:
        raise ValueError("NEOSCOPE_PROVIDER phải là NEO hoặc SSI")
    data["mode"] = mode
    data["provider"] = active_provider if mode == "LIVE" else "SYNTHETIC"
    return Settings(data, p)


def env_secret(name: str, required: bool = True) -> str:
    v = os.environ.get(name, "").strip()
    if required and not v:
        raise RuntimeError(
            f"Thiếu biến môi trường {name}. Sao chép .env.example thành .env và điền giá trị. "
            "Không commit .env lên kho mã nguồn."
        )
    return v
