import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inspectProviderReadiness,
  scaleSsiQuotePrice,
  scaleSsiTradePrice,
  testSsiFastConnectConnection,
  TokenBucketLimiter,
} from './ssiFastConnect.ts';
import { loadSettings } from './config.ts';

test('SSI FastConnect v3 unit scaler converts thousand-VND quotes cleanly and preserves nulls', () => {
  assert.equal(scaleSsiQuotePrice(29.85), 29850);
  assert.equal(scaleSsiQuotePrice('132.0'), 132000);
  assert.equal(scaleSsiQuotePrice(62000), 62000);
  assert.equal(scaleSsiQuotePrice(null), null);
  assert.equal(scaleSsiQuotePrice('ATO'), null);

  assert.equal(scaleSsiTradePrice(29850), 29850);
  assert.equal(scaleSsiTradePrice(null), null);
});

test('TokenBucketLimiter enforces SSI 5 req/s rate budget and refills over time', () => {
  let now = 1_000_000;
  const limiter = new TokenBucketLimiter(5, () => now);
  for (let i = 0; i < 5; i++) {
    assert.equal(limiter.tryConsume(1), true);
  }
  assert.equal(limiter.tryConsume(1), false);

  // Advance 400ms -> refills 2 tokens (5 * 0.4)
  now += 400;
  assert.equal(limiter.tryConsume(1), true);
  assert.equal(limiter.tryConsume(1), true);
  assert.equal(limiter.tryConsume(1), false);
});

test('testSsiFastConnectConnection fails gracefully with clear Vietnamese message when credentials are absent', async () => {
  const prevId = process.env.SSI_CLIENT_ID;
  const prevKey = process.env.SSI_API_KEY;
  const prevSecret = process.env.SSI_API_SECRET;
  delete process.env.SSI_CLIENT_ID;
  delete process.env.SSI_API_KEY;
  delete process.env.SSI_API_SECRET;

  try {
    const s = loadSettings();
    const readiness = inspectProviderReadiness(s);
    assert.equal(readiness.readyForLiveRest, false);

    const probe = await testSsiFastConnectConnection(s);
    assert.equal(probe.ok, false);
    assert.equal(probe.stage, 'CREDENTIALS');
    assert.ok(probe.message.includes('SSI_CLIENT_ID'));
  } finally {
    if (prevId !== undefined) process.env.SSI_CLIENT_ID = prevId;
    if (prevKey !== undefined) process.env.SSI_API_KEY = prevKey;
    if (prevSecret !== undefined) process.env.SSI_API_SECRET = prevSecret;
  }
});

test('testSsiFastConnectConnection handles mocked SSI OAuth2 success and HTTP 401 cleanly', async () => {
  const prevId = process.env.SSI_CLIENT_ID;
  const prevKey = process.env.SSI_API_KEY;
  const prevSecret = process.env.SSI_API_SECRET;
  process.env.SSI_CLIENT_ID = 'demo-client';
  process.env.SSI_API_KEY = 'demo-key';
  process.env.SSI_API_SECRET = 'demo-secret';

  try {
    const s = loadSettings();
    const okRes = await testSsiFastConnectConnection(s, async () => {
      return new Response(JSON.stringify({ data: { accessToken: 'tok-123' } }), { status: 200 });
    });
    assert.equal(okRes.ok, true);
    assert.equal(okRes.statusCode, 200);

    const failRes = await testSsiFastConnectConnection(s, async () => {
      return new Response('Unauthorized', { status: 401 });
    });
    assert.equal(failRes.ok, false);
    assert.equal(failRes.statusCode, 401);
  } finally {
    if (prevId === undefined) delete process.env.SSI_CLIENT_ID;
    else process.env.SSI_CLIENT_ID = prevId;
    if (prevKey === undefined) delete process.env.SSI_API_KEY;
    else process.env.SSI_API_KEY = prevKey;
    if (prevSecret === undefined) delete process.env.SSI_API_SECRET;
    else process.env.SSI_API_SECRET = prevSecret;
  }
});
