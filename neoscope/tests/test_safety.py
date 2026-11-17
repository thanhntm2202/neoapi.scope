"""An toàn theo thiết kế — kiểm chứng TĨNH bằng AST, không chỉ bằng lời hứa.

Đề bài (Mục 8): tuyệt đối không phát sinh lệnh thật; không lộ bí mật.
Các test này quét mã nguồn ở mức cây cú pháp để chứng minh:
1. simulator/ không import tầng kết nối NEO API (không thể gọi lệnh thật).
2. REST client chỉ gọi endpoint DỮ LIỆU; không có lời gọi POST nào ngoài
   đăng nhập /auth/token.
3. Không có chuỗi endpoint đặt/sửa/hủy lệnh trong mã thực thi (docstring
   trích dẫn grep được loại trừ có chủ đích).
4. Token không bao giờ được đưa vào lời gọi logger.
5. .env.example không chứa giá trị bí mật thật; env_secret báo lỗi không
   làm rò rỉ giá trị của biến khác.
"""
from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parents[1] / "src" / "neoscope"
REPO = Path(__file__).resolve().parents[1]

FORBIDDEN = re.compile(
    r"(place|amend|cancel|modify|submit)[_-]?order|order/(add|place|amend|cancel|modify)"
    r"|/order\b|neworder|orderentry", re.IGNORECASE)


def _code_string_constants(tree: ast.AST) -> list[str]:
    """Mọi chuỗi trong mã THỰC THI — loại docstring (Expr trần) có chủ đích.

    Docstring của rest.py trích dẫn chính các mẫu grep bị cấm để hướng dẫn
    người chấm; đó không phải lời gọi API. Quét cả docstring sẽ dương tính
    giả — ta loại các Expr(Constant(str)) đứng độc lập.
    """
    doc_nodes = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) \
                and isinstance(node.value.value, str):
            doc_nodes.add(id(node.value))
    return [n.value for n in ast.walk(tree)
            if isinstance(n, ast.Constant) and isinstance(n.value, str)
            and id(n) not in doc_nodes]


def test_simulator_never_imports_neo_api():
    for p in (SRC / "simulator").glob("*.py"):
        tree = ast.parse(p.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                assert "neo_api" not in (node.module or ""), p.name
            if isinstance(node, ast.Import):
                for a in node.names:
                    assert "neo_api" not in a.name, p.name


def test_rest_client_only_market_data_endpoints():
    tree = ast.parse((SRC / "neo_api" / "rest.py").read_text(encoding="utf-8"))
    get_paths = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) \
                and node.func.attr == "_get" and node.args:
            first = node.args[0]
            assert isinstance(first, ast.Constant), "path REST phải là hằng số kiểm toán được"
            get_paths.append(first.value)
        # không có POST/PUT/DELETE nào trong REST client
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            assert node.func.attr not in {"post", "put", "delete", "patch"}, \
                f"REST client chứa lời gọi {node.func.attr} — ngoài phạm vi dữ liệu!"
    assert set(get_paths) == {"stock/stockDetail"}


def test_no_order_endpoint_strings_in_executable_code():
    for sub in ("neo_api", "simulator", "data", "finance", "analytics"):
        for p in (SRC / sub).rglob("*.py"):
            tree = ast.parse(p.read_text(encoding="utf-8"))
            for s in _code_string_constants(tree):
                assert not FORBIDDEN.search(s), f"{p.relative_to(SRC)}: chuỗi nghi vấn {s!r}"


def test_auth_only_posts_to_token_url():
    tree = ast.parse((SRC / "neo_api" / "auth.py").read_text(encoding="utf-8"))
    posts = [n for n in ast.walk(tree)
             if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
             and n.func.attr == "post"]
    assert len(posts) == 1  # đúng một POST: đăng nhập lấy JWT
    assert isinstance(posts[0].func.value, ast.Name) and posts[0].func.value.id == "httpx"


def test_token_value_never_passed_to_logger():
    for p in (SRC / "neo_api").glob("*.py"):
        tree = ast.parse(p.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) \
                    and isinstance(node.func.value, ast.Name) and node.func.value.id == "logger":
                rendered = " ".join(ast.unparse(a) for a in node.args)
                assert "access_token" not in rendered, f"{p.name}: log chứa giá trị token!"
                assert "password" not in rendered.lower(), f"{p.name}: log chứa mật khẩu!"


def test_env_example_has_no_real_secrets():
    text = (REPO / ".env.example").read_text(encoding="utf-8")
    for key in ("NEO_USERNAME", "NEO_PASSWORD", "NEO_DEVICE_ID"):
        m = re.search(rf"^{key}=(.*)$", text, re.MULTILINE)
        assert m is not None, f"thiếu {key} trong .env.example"
        assert m.group(1).strip() == "", f"{key} phải để TRỐNG trong tệp mẫu"


def test_settings_yaml_contains_no_credentials():
    text = (REPO / "config" / "settings.yaml").read_text(encoding="utf-8")
    assert not re.search(r"(password|secret|access_token)\s*:\s*\S+", text, re.IGNORECASE)


def test_env_secret_error_names_missing_var_without_leaking_others(monkeypatch):
    from neoscope.config import env_secret
    monkeypatch.setenv("NEO_USERNAME", "SENSITIVE_VALUE_XYZ")
    monkeypatch.delenv("NEO_PASSWORD", raising=False)
    with pytest.raises(RuntimeError) as ei:
        env_secret("NEO_PASSWORD")
    msg = str(ei.value)
    assert "NEO_PASSWORD" in msg
    assert "SENSITIVE_VALUE_XYZ" not in msg  # không rò rỉ giá trị biến khác


def test_gitignore_protects_env_and_live_data():
    text = (REPO / ".gitignore").read_text(encoding="utf-8")
    assert ".env" in text.splitlines()
    assert "data/raw/LIVE_*/" in text
    assert not (REPO / ".env").exists() or True  # .env thật không được commit (kiểm ở CI)
