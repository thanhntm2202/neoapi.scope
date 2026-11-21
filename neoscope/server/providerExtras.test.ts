import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSystemSelfCheck,
  fetchSsiRestContext,
  simulateChaosScenario,
  testNeoApiConnection,
} from './providerExtras.ts';
import { loadSettings } from './config.ts';

test('testNeoApiConnection fails gracefully without credentials and succeeds on mocked JWT response', async () => {
  const prevUser = process.env.NEO_USERNAME;
  const prevPass = process.env.NEO_PASSWORD;
  delete process.env.NEO_USERNAME;
  delete process.env.NEO_PASSWORD;

  try {
    const s = loadSettings();
    const missingRes = await testNeoApiConnection(s);
    assert.equal(missingRes.ok, false);
    assert.equal(missingRes.stage, 'CREDENTIALS');
    assert.ok(missingRes.message.includes('NEO_USERNAME'));

    process.env.NEO_USERNAME = 'demo-user';
    process.env.NEO_PASSWORD = 'demo-password';
    const okRes = await testNeoApiConnection(s, async () => {
      return new Response(
        JSON.stringify({ status: 1, data: { access_token: 'jwt-neo-123', expires_in: 10800 } }),
        { status: 200 },
      );
    });
    assert.equal(okRes.ok, true);
    assert.equal(okRes.statusCode, 200);
    assert.equal(okRes.expiresInS, 10800);
    // Ensure secret token is never leaked in output
    assert.equal(JSON.stringify(okRes).includes('jwt-neo-123'), false);
    assert.equal(JSON.stringify(okRes).includes('demo-password'), false);
  } finally {
    if (prevUser === undefined) delete process.env.NEO_USERNAME;
    else process.env.NEO_USERNAME = prevUser;
    if (prevPass === undefined) delete process.env.NEO_PASSWORD;
    else process.env.NEO_PASSWORD = prevPass;
  }
});

test('fetchSsiRestContext validates inputs, handles missing keys safely, and parses mocked SSI Securities + DailyOHLC', async () => {
  const prevId = process.env.SSI_CLIENT_ID;
  const prevKey = process.env.SSI_API_KEY;
  const prevSecret = process.env.SSI_API_SECRET;
  delete process.env.SSI_CLIENT_ID;
  delete process.env.SSI_API_KEY;
  delete process.env.SSI_API_SECRET;

  try {
    const s = loadSettings();
    await assert.rejects(() => fetchSsiRestContext(s, { symbol: 'BAD$SYM' }), /không hợp lệ/);

    const fallback = await fetchSsiRestContext(s, { symbol: 'FPT', market: 'HOSE' });
    assert.equal(fallback.ok, false);
    assert.equal(fallback.source, 'SAFE_FALLBACK');
    assert.equal(fallback.watchlistCheck.symbolKnownInWatchlist, true);
    assert.equal(fallback.watchlistCheck.group, 'large');

    process.env.SSI_CLIENT_ID = 'cid';
    process.env.SSI_API_KEY = 'ckey';
    process.env.SSI_API_SECRET = 'csec';

    const liveRes = await fetchSsiRestContext(
      s,
      { symbol: 'FPT', market: 'HOSE', fromDate: '2026-11-01', toDate: '2026-11-16' },
      async (url) => {
        const u = String(url);
        if (u.includes('AccessToken')) {
          return new Response(JSON.stringify({ status: 'Success', data: { accessToken: 'ssi-tok' } }), { status: 200 });
        }
        if (u.includes('Securities')) {
          return new Response(
            JSON.stringify({ status: 'Success', data: [{ Symbol: 'FPT', Market: 'HOSE' }, { Symbol: 'HPG', Market: 'HOSE' }] }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            status: 'Success',
            data: [{ TradingDate: '16/11/2026', Open: 131000, High: 133000, Low: 130500, Close: 132000, Volume: 2800000 }],
          }),
          { status: 200 },
        );
      },
    );
    assert.equal(liveRes.ok, true);
    assert.equal(liveRes.source, 'LIVE_SSI_REST');
    assert.equal(liveRes.watchlistCheck.ssiListedMatched, true);
    assert.equal(liveRes.watchlistCheck.catalogCount, 2);
    assert.equal(liveRes.ohlcRows.length, 1);
    assert.equal(liveRes.ohlcRows[0].close, 132000);
    assert.equal(JSON.stringify(liveRes).includes('ssi-tok'), false);
  } finally {
    if (prevId === undefined) delete process.env.SSI_CLIENT_ID;
    else process.env.SSI_CLIENT_ID = prevId;
    if (prevKey === undefined) delete process.env.SSI_API_KEY;
    else process.env.SSI_API_KEY = prevKey;
    if (prevSecret === undefined) delete process.env.SSI_API_SECRET;
    else process.env.SSI_API_SECRET = prevSecret;
  }
});

test('simulateChaosScenario returns concrete deterministic evidence across all 4 fault scenarios', () => {
  const ids = ['RATE_LIMIT_429', 'STALE_GAP_30S', 'DIRTY_DATA_TRAPS', 'MISSING_FOLD_PARAMS'] as const;
  for (const id of ids) {
    const out = simulateChaosScenario(id);
    assert.equal(out.id, id);
    assert.equal(out.verifiedSafe, true);
    assert.ok(out.sampleRows.length >= 2);
  }
});

test('buildSystemSelfCheck reports read-only safety and curated ledger status cleanly', () => {
  const s = loadSettings();
  const res = buildSystemSelfCheck({
    settings: s,
    summary: { orders: { n: 1200 }, metrics_by_coverage: [{ model: 'full' }] },
    qualityMeta: [{ n_raw: 220000, n_curated: 216000, n_duplicates_dropped: 900 }],
    availableDatasets: [
      { id: 'SYNTHETIC', label: 'SYNTHETIC', sessions: 10 },
      { id: 'LIVE_SSI', label: 'LIVE_SSI', sessions: 0 },
      { id: 'LIVE_NEO', label: 'LIVE_NEO', sessions: 0 },
    ],
  });
  assert.equal(res.overallOk, true);
  assert.equal(res.passCount, res.totalCount);
});
