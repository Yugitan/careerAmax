import asyncio

import pytest

from app.rate_limiter import AsyncRateLimiter, get_limiter, get_limiter_for_url, _limiters


@pytest.fixture(autouse=True)
def _clear_limiters():
    _limiters.clear()
    yield
    _limiters.clear()


@pytest.mark.asyncio
async def test_acquire_immediate():
    limiter = AsyncRateLimiter(1, 1.0)
    await limiter.acquire()


@pytest.mark.asyncio
async def test_acquire_throttles_second_call():
    limiter = AsyncRateLimiter(1, 0.2)
    await limiter.acquire()
    await limiter.acquire()
    assert limiter._allowance == 0.0


@pytest.mark.asyncio
async def test_allowance_recovers_over_time():
    limiter = AsyncRateLimiter(1, 1.0)
    await limiter.acquire()
    await asyncio.sleep(1.1)
    await limiter.acquire()


@pytest.mark.asyncio
async def test_acquire_spreads_requests():
    limiter = AsyncRateLimiter(1, 0.1)
    start = asyncio.get_event_loop().time()
    await limiter.acquire()
    await limiter.acquire()
    elapsed = asyncio.get_event_loop().time() - start
    assert elapsed >= 0.05


@pytest.mark.asyncio
async def test_multiple_acquires():
    limiter = AsyncRateLimiter(5, 1.0)
    for _ in range(5):
        await limiter.acquire()


def test_get_limiter_default():
    limiter = get_limiter("example.com")
    assert limiter._rate == 1.0
    assert limiter._per == 1.0


def test_get_limiter_cached():
    l1 = get_limiter("example.com")
    l2 = get_limiter("example.com")
    assert l1 is l2


def test_get_limiter_custom_rate():
    limiter = get_limiter("custom.com", rate=5.0, per=10.0)
    assert limiter._rate == 5.0
    assert limiter._per == 10.0


def test_get_limiter_for_url_unknown_domain_uses_default():
    limiter = get_limiter_for_url("https://unknown.example.org/jobs/123")
    assert limiter._rate == 1.0
    assert limiter._per == 1.0
