"""Bộ mô phỏng SYNTHETIC: gắn nhãn trung thực + bơm đủ bẫy + ground-truth.

Liêm chính học thuật (đề mục 13): dữ liệu giả phải CÔNG BỐ là giả.
Test này khóa các thuộc tính đó ở mức kiểm thử tự động.
"""
from __future__ import annotations

import json

import numpy as np

from neoscope.data.store import list_session_dirs, read_manifest, read_raw
from neoscope.synth.generator import generate_dataset


def test_synthetic_label_everywhere(small_settings):
    generate_dataset(small_settings)
    d = list_session_dirs(small_settings.data_path(), "SYNTHETIC")[0]
    assert d.name.startswith("SYNTH_")
    man = read_manifest(d)
    assert man["synthetic"] is True and man["mode"] == "SYNTHETIC"
    assert "seed" in man and "generator_version" in man
    truth = json.loads((d / "events_truth.json").read_text(encoding="utf-8"))
    assert truth["synthetic"] is True
    assert all(e["synthetic"] is True for e in truth["events"])


def test_ground_truth_events_cover_all_types(small_settings):
    generate_dataset(small_settings)
    d = list_session_dirs(small_settings.data_path(), "SYNTHETIC")[0]
    truth = json.loads((d / "events_truth.json").read_text(encoding="utf-8"))
    types = {e["type"] for e in truth["events"]}
    assert types == {"DEPTH_EVAPORATION", "TRADE_BURST", "FLASH_MOVE",
                     "FOREIGN_BURST", "OBI_SHOCK"}
    for e in truth["events"]:
        assert e["start_ts"] <= e["end_ts"]
        assert e["symbol"] in small_settings.watchlist()


def test_traps_actually_present_in_raw(small_settings):
    """Các bẫy NEO phải THẬT SỰ xuất hiện trong RAW (không chỉ khai báo)."""
    generate_dataset(small_settings)
    d = list_session_dirs(small_settings.data_path(), "SYNTHETIC")[0]
    recs = list(read_raw(d, "stockInfo"))
    payloads = [r["data"] for r in recs]

    # giá mức 1 là CHUỖI như docs; có ký tự ATO/ATC
    assert all(isinstance(p["bidPrice1"], str) for p in payloads)
    assert any(p["bidPrice1"] == "ATO" for p in payloads)
    assert any(p["bidPrice1"] == "ATC" for p in payloads)
    # null thật
    assert any(p["totalBidQTTY"] is None for p in payloads)
    # thông điệp lặp: generator phát lại payload CỦA NHỊP TRƯỚC (retransmission)
    # → phát hiện bằng cửa sổ 2 payload gần nhất theo mã
    from collections import deque
    dup = 0
    prev: dict = {}
    for r in recs:
        sym = r["data"]["symbol"]
        win = prev.setdefault(sym, deque(maxlen=2))
        if any(old == r["data"] for old in win):
            dup += 1
        win.append(r["data"])
    assert dup > 0
    # arrival không đơn điệu theo seq (muộn/sai thứ tự)
    last: dict = {}
    disordered = 0
    for r in recs:
        sym = r["data"]["symbol"]
        if sym in last and r["arrival_ts"] < last[sym]:
            disordered += 1
        last[sym] = max(last.get(sym, r["arrival_ts"]), r["arrival_ts"])
    assert disordered > 0
    # indexValue là chuỗi
    idx = list(read_raw(d, "marketInfo"))
    assert idx and all(isinstance(r["data"]["indexValue"], str) for r in idx)


def test_mid_stays_within_price_band(small_settings):
    generate_dataset(small_settings)
    d = list_session_dirs(small_settings.data_path(), "SYNTHETIC")[0]
    for r in read_raw(d, "stockInfo"):
        p = r["data"]
        if p["bidPrice1"] in ("ATO", "ATC"):
            continue
        b, a = float(p["bidPrice1"]), float(p["askPrice1"])
        assert p["floorPrice"] <= b <= p["ceilingPrice"]
        assert p["floorPrice"] <= a <= p["ceilingPrice"]
        assert b < a  # sổ không bắt chéo trong thế giới mô phỏng sạch
