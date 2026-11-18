"""Token-bucket 5 RPS: bằng chứng tuân thủ giới hạn tần suất NEO API.

Đề bài yêu cầu 'không gửi yêu cầu REST dày đặc vượt giới hạn dịch vụ'.
Test này đo THỜI GIAN THỰC của chuỗi acquire để chứng minh cơ chế hoạt
động, không chỉ đếm số học.
"""
from __future__ import annotations

import asyncio
import time

import pytest

from neoscope.neo_api.rate_limiter import TokenBucket


def test_burst_then_throttle_enforces_rate():
    bucket = TokenBucket(rate=5.0)
    t0 = time.monotonic()
    for _ in range(8):  # 5 token sẵn + 3 phải chờ nạp (3/5 = 0.6s)
        bucket.acquire_sync()
    elapsed = time.monotonic() - t0
    assert elapsed >= 0.55, f"8 request chỉ mất {elapsed:.3f}s — vượt 5 RPS!"
    assert bucket.total_acquired == 8
    assert bucket.total_waited_s > 0.0


def test_refill_allows_new_request_after_wait():
    bucket = TokenBucket(rate=5.0)
    for _ in range(5):
        bucket.acquire_sync()
    time.sleep(0.25)  # nạp thêm ~1.25 token
    t0 = time.monotonic()
    bucket.acquire_sync()
    assert time.monotonic() - t0 < 0.15  # không phải chờ thêm


def test_async_variant_same_discipline():
    async def run():
        bucket = TokenBucket(rate=5.0)
        t0 = time.monotonic()
        for _ in range(7):  # 2 token chờ nạp → ≥ 0.4s
            await bucket.acquire()
        return time.monotonic() - t0, bucket.total_acquired

    elapsed, n = asyncio.run(run())
    assert elapsed >= 0.35
    assert n == 7


def test_capacity_defaults_to_rate_one_second_burst():
    bucket = TokenBucket(rate=5.0)
    assert bucket.capacity == 5.0  # burst tối đa 1 giây — đúng tinh thần 5 RPS
    custom = TokenBucket(rate=5.0, capacity=2.0)
    assert custom.capacity == 2.0
