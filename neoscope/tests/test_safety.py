"""Static safety checks for both market-data-only provider connectors."""
from __future__ import annotations

import ast
import re
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src" / "neoscope"
REPO = Path(__file__).resolve().parents[1]
FORBIDDEN = re.compile(
    r"(place|amend|cancel|modify|submit)[_-]?order|order/(add|place|amend|cancel|modify)"
    r"|/order\b|neworder|orderentry", re.IGNORECASE)


def _code_strings(tree: ast.AST) -> list[str]:
    doc_nodes = {id(node.value) for node in ast.walk(tree)
                 if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                 and isinstance(node.value.value, str)}
    return [node.value for node in ast.walk(tree)
            if isinstance(node, ast.Constant) and isinstance(node.value, str)
            and id(node) not in doc_nodes]


def test_simulator_never_imports_provider_clients():
    for p in (SRC / "simulator").glob("*.py"):
        tree = ast.parse(p.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                assert not any(provider in (node.module or "") for provider in ("neo_api", "ssi_api"))
            if isinstance(node, ast.Import):
                assert all(not any(provider in alias.name for provider in ("neo_api", "ssi_api"))
                           for alias in node.names)


def test_provider_code_has_no_state_changing_routes():
    for provider in ("neo_api", "ssi_api"):
        for p in (SRC / provider).rglob("*.py"):
            tree = ast.parse(p.read_text(encoding="utf-8"))
            for value in _code_strings(tree):
                assert not FORBIDDEN.search(value), f"{p.relative_to(SRC)}: {value!r}"


def test_neo_rest_is_read_only_and_auth_posts_only_for_token():
    tree = ast.parse((SRC / "neo_api" / "rest.py").read_text(encoding="utf-8"))
    paths = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            assert node.func.attr not in {"post", "put", "delete", "patch"}
            if node.func.attr == "_get" and node.args:
                assert isinstance(node.args[0], ast.Constant)
                paths.append(node.args[0].value)
    assert paths == ["stock/stockDetail"]
    auth_tree = ast.parse((SRC / "neo_api" / "auth.py").read_text(encoding="utf-8"))
    posts = [node for node in ast.walk(auth_tree)
             if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
             and node.func.attr == "post"]
    assert len(posts) == 1


def test_ssi_connector_does_not_import_trading_clients():
    for p in (SRC / "ssi_api").rglob("*.py"):
        tree = ast.parse(p.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                assert not any(alias.name in {"Trading", "AsyncTrading", "TradingWSClient"}
                               for alias in node.names), p.name


def test_env_example_has_no_credentials():
    text = (REPO / ".env.example").read_text(encoding="utf-8")
    for key in ("NEO_USERNAME", "NEO_PASSWORD", "NEO_DEVICE_ID",
                "SSI_CLIENT_ID", "SSI_API_KEY", "SSI_API_SECRET"):
        match = re.search(rf"^{key}=(.*)$", text, re.MULTILINE)
        assert match is not None and match.group(1).strip() == ""


def test_settings_yaml_contains_no_credentials():
    text = (REPO / "config" / "settings.yaml").read_text(encoding="utf-8")
    assert not re.search(r"(username|password|api_key|api_secret|access_token)\s*:\s*\S+",
                         text, re.IGNORECASE)


def test_env_secret_error_does_not_leak_other_values(monkeypatch):
    from neoscope.config import env_secret
    monkeypatch.setenv("SSI_CLIENT_ID", "SENSITIVE_VALUE_XYZ")
    monkeypatch.delenv("SSI_API_SECRET", raising=False)
    try:
        env_secret("SSI_API_SECRET")
    except RuntimeError as exc:
        assert "SSI_API_SECRET" in str(exc)
        assert "SENSITIVE_VALUE_XYZ" not in str(exc)
    else:
        raise AssertionError("missing secret should fail closed")


def test_gitignore_protects_credentials_and_live_captures():
    text = (REPO / ".gitignore").read_text(encoding="utf-8")
    assert ".env" in text.splitlines()
    assert "data/raw/LIVE_*/" in text
    assert "data/curated/LIVE_*/" in text
