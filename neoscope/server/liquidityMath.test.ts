import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionNarrative, computeWeightedLhs, spearmanRankCorrelation } from './liquidityMath.ts';

test('spearmanRankCorrelation handles perfect, inverse, and tied ranks cleanly', () => {
  assert.ok(Math.abs((spearmanRankCorrelation([1, 2, 3, 4], [10, 20, 30, 40]) ?? 0) - 1) < 1e-9);
  assert.ok(Math.abs((spearmanRankCorrelation([1, 2, 3, 4], [40, 30, 20, 10]) ?? 0) + 1) < 1e-9);
  const tied = spearmanRankCorrelation([1, 2, 2, 4], [10, 20, 20, 40]);
  assert.ok(tied !== null && Math.abs(tied - 1) < 1e-9);
});

test('computeWeightedLhs updates ranks and preserves exact baseline under equal weights', () => {
  const sampleRows = [
    { symbol: 'FPT', group: 'large', lhs: 80, r_tightness: 0.9, r_depth: 0.8, r_immediacy: 0.8, r_stability: 0.7, r_balance: 0.8 },
    { symbol: 'DIG', group: 'thin', lhs: 40, r_tightness: 0.2, r_depth: 0.3, r_immediacy: 0.4, r_stability: 0.6, r_balance: 0.5 },
    { symbol: 'VCB', group: 'large', lhs: 70, r_tightness: 0.7, r_depth: 0.9, r_immediacy: 0.6, r_stability: 0.8, r_balance: 0.5 },
  ];

  const eq = computeWeightedLhs(sampleRows, {
    tightness: 1,
    depth: 1,
    immediacy: 1,
    stability: 1,
    balance: 1,
  });
  assert.equal(eq.items.length, 3);
  assert.equal(eq.items[0].symbol, 'FPT');
  assert.equal(eq.items[0].rankDelta, 0);
  assert.ok(Math.abs((eq.spearmanVsBaseline ?? 0) - 1) < 1e-9);

  // Heavily overweight depth -> VCB (r_depth 0.9) should overtake FPT (r_depth 0.8)
  const depthHeavy = computeWeightedLhs(sampleRows, {
    tightness: 0,
    depth: 5,
    immediacy: 0,
    stability: 0,
    balance: 0,
  });
  assert.equal(depthHeavy.items[0].symbol, 'VCB');
  assert.equal(depthHeavy.items[0].customLhs, 90);
  assert.equal(depthHeavy.items[0].rankDelta, 1);
});

test('buildSessionNarrative synthesizes deterministic VN30 vs Midcap insights without fabricated metrics', () => {
  const res = buildSessionNarrative({
    session: '2026-11-16',
    mode: 'SYNTHETIC',
    watchlistRows: [
      { symbol: 'FPT', groupLabel: 'VN30 lớn', lhsSeries: [95], mid: 128350, spreadBps: 7.8, depthBidB: 12.17, obi: -0.39, cumVolM: 3.78 },
      { symbol: 'DIG', groupLabel: 'Midcap mỏng', lhsSeries: [42], mid: 18900, spreadBps: 52.9, depthBidB: 2.85, obi: 0.1, cumVolM: 5.48 },
    ],
    lhsRanking: [
      { symbol: 'FPT', lhs: 95 },
      { symbol: 'DIG', lhs: 42 },
    ],
    alertCount: 12,
    rareCount: 9,
    alertTypes: { TRADE_BURST: 7, SPREAD_WIDEN: 5 },
  });

  assert.ok(res.headline.includes('2026-11-16'));
  assert.ok(res.bullets.some((b) => b.includes('7.8 bps') && b.includes('52.9 bps')));
  assert.ok(res.bullets.some((b) => b.includes('FPT') && b.includes('DIG')));
  assert.ok(res.bullets.some((b) => b.includes('TRADE_BURST')));
  assert.ok(res.caveat.includes('mô phỏng'));
});
