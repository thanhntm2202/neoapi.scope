import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOverviewHeatmapMatrix,
  buildWatchlistHeatmapCells,
  type HeatmapBarInput,
  type HeatmapWatchlistInput,
} from './overviewHeatmap';

const SAMPLE_WATCHLIST: HeatmapWatchlistInput[] = [
  {
    symbol: 'HPG',
    group: 'large',
    groupLabel: 'VN30 lớn',
    midLast: 28_000,
    spreadBps: 12.5,
    volatilityBps: 18.2,
    depthBidB: 8.4,
    obi: 0.42,
    cumVolM: 12.0,
    alertCount: 4,
    rareAlertCount: 2,
  },
  {
    symbol: 'DIG',
    group: 'thin',
    groupLabel: 'Midcap mỏng',
    midLast: 20_000,
    spreadBps: 52.0,
    volatilityBps: 25.0,
    depthBidB: 1.9,
    obi: -0.38,
    cumVolM: 3.5,
    alertCount: 1,
    rareAlertCount: 0,
  },
];

const SAMPLE_BARS: HeatmapBarInput[] = [
  // HPG across 3 15-min slots (09:15, 09:30, 14:00 VN = 02:15, 02:30, 07:00 UTC)
  {
    symbol: 'HPG',
    bar_ts: '2026-11-16T02:15:00.000Z',
    d_val: 2_000_000_000,
    d_f_net_val: 500_000_000,
    ret_bps: 10,
    spread_bps: 10,
    obi_mean: 0.3,
    lhs: 82,
  },
  {
    symbol: 'HPG',
    bar_ts: '2026-11-16T02:30:00.000Z',
    d_val: 2_000_000_000,
    d_f_net_val: 0,
    ret_bps: 5,
    spread_bps: 10,
    obi_mean: 0.2,
    lhs: 80,
  },
  {
    symbol: 'HPG',
    bar_ts: '2026-11-16T07:00:00.000Z',
    d_val: 6_000_000_000, // 3x median slot
    d_f_net_val: 1_500_000_000,
    ret_bps: 25,
    spread_bps: 22, // 2.2x median spread
    obi_mean: 0.65,
    lhs: 64,
  },
  // DIG across 2 slots with negative flow
  {
    symbol: 'DIG',
    bar_ts: '2026-11-16T02:15:00.000Z',
    d_val: 2_500_000_000,
    d_f_net_val: -300_000_000,
    ret_bps: -18,
    spread_bps: 48,
    obi_mean: -0.45,
    lhs: 38,
  },
  {
    symbol: 'DIG',
    bar_ts: '2026-11-16T02:30:00.000Z',
    d_val: 2_500_000_000,
    d_f_net_val: -200_000_000,
    ret_bps: -12,
    spread_bps: 52,
    obi_mean: -0.35,
    lhs: 35,
  },
];

test('buildWatchlistHeatmapCells computes turnover share, signed flow, intensity surge and anomaly flags', () => {
  const cells = buildWatchlistHeatmapCells({
    symbols: ['HPG', 'DIG'],
    watchlist: SAMPLE_WATCHLIST,
    barsLhs: SAMPLE_BARS,
    sortBy: 'flow',
  });

  assert.equal(cells.length, 2);
  // Total turnover: HPG 10B + DIG 5B = 15B
  const hpg = cells.find((c) => c.symbol === 'HPG')!;
  const dig = cells.find((c) => c.symbol === 'DIG')!;

  assert.equal(hpg.turnoverB, 10);
  assert.equal(dig.turnoverB, 5);
  assert.ok(Math.abs(hpg.turnoverSharePct + dig.turnoverSharePct - 100) < 1e-6);

  // Directional flow: HPG all positive (+10B), DIG all negative (-5B)
  assert.equal(hpg.signedFlowB, 10);
  assert.equal(hpg.flowRatioPct, 100);
  assert.equal(hpg.foreignNetB, 2);
  assert.equal(dig.signedFlowB, -5);
  assert.equal(dig.flowRatioPct, -100);

  // Peak slot 14:00 (07:00 UTC) for HPG = 6B vs median 2B => 3.0x
  assert.equal(hpg.peakSlot, '14:00');
  assert.equal(hpg.intensityRatio, 3);
  assert.equal(hpg.isAnomalous, true);
  assert.ok(hpg.anomalyBadge?.includes('P1/P2'));
  assert.ok(hpg.anomalyScore > dig.anomalyScore);
});

test('buildWatchlistHeatmapCells falls back gracefully when bars are empty', () => {
  const cells = buildWatchlistHeatmapCells({
    symbols: ['HPG'],
    watchlist: [SAMPLE_WATCHLIST[0]],
    barsLhs: [],
    sortBy: 'anomaly',
  });

  assert.equal(cells.length, 1);
  // Falls back to cumVolM (12M) * midLast (28,000) = 336B
  assert.equal(cells[0].turnoverB, 336);
  assert.equal(cells[0].turnoverSharePct, 100);
  assert.equal(cells[0].isAnomalous, true); // 2 rare alerts still flag anomaly
});

test('buildOverviewHeatmapMatrix aggregates 15m VN slots for flow, intensity, and anomaly', () => {
  const flowMat = buildOverviewHeatmapMatrix({
    symbols: ['HPG', 'DIG'],
    barsLhs: SAMPLE_BARS,
    metric: 'flow',
    watchlist: SAMPLE_WATCHLIST,
  });

  assert.deepEqual(flowMat.xLabels, ['09:15', '09:30', '14:00']);
  assert.deepEqual(flowMat.ySymbols, ['DIG', 'HPG']); // reversed for Plotly bottom-to-top display
  // DIG row (index 0): [2.5, 2.5, null]
  assert.deepEqual(flowMat.z[0], [2.5, 2.5, null]);
  // HPG row (index 1): [2, 2, 6]
  assert.deepEqual(flowMat.z[1], [2, 2, 6]);

  const intensityMat = buildOverviewHeatmapMatrix({
    symbols: ['HPG', 'DIG'],
    barsLhs: SAMPLE_BARS,
    metric: 'intensity',
    watchlist: SAMPLE_WATCHLIST,
  });
  // HPG intensity at 14:00 = 6B / median(2B) = 3.0
  assert.deepEqual(intensityMat.z[1], [1, 1, 3]);

  const anomalyMat = buildOverviewHeatmapMatrix({
    symbols: ['HPG', 'DIG'],
    barsLhs: SAMPLE_BARS,
    metric: 'anomaly',
    watchlist: SAMPLE_WATCHLIST,
  });
  // HPG spread ratio at 14:00 = 22 / median(10) = 2.2
  assert.deepEqual(anomalyMat.z[1], [1, 1, 2.2]);
});
