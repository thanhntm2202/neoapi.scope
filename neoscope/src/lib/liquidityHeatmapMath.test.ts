import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLiquidityHeatmap2D,
  computeBivariateHsl,
  type LiquidityHeatmapBarInput,
} from './liquidityHeatmapMath';

test('computeBivariateHsl encodes Value/Time in lightness/hue and micro-volatility in saturation', () => {
  const calmInflow = computeBivariateHsl({
    valuePerMinB: 0.5,
    signedFlowPerMinB: 0.4,
    microVolBps: 4,
    maxValuePerMinB: 2.0,
    maxMicroVolBps: 40,
    colorMode: 'directional',
  });
  const turbulentInflow = computeBivariateHsl({
    valuePerMinB: 2.0,
    signedFlowPerMinB: 1.6,
    microVolBps: 38,
    maxValuePerMinB: 2.0,
    maxMicroVolBps: 40,
    colorMode: 'directional',
  });
  const outflow = computeBivariateHsl({
    valuePerMinB: 1.5,
    signedFlowPerMinB: -1.2,
    microVolBps: 25,
    maxValuePerMinB: 2.0,
    maxMicroVolBps: 40,
    colorMode: 'directional',
  });

  // Positive flow -> emerald hue (168), negative flow -> crimson hue (4)
  assert.equal(calmInflow.hueDeg, 168);
  assert.equal(turbulentInflow.hueDeg, 168);
  assert.equal(outflow.hueDeg, 4);

  // Higher micro-volatility -> strictly higher saturation
  assert.ok(turbulentInflow.saturationPct > calmInflow.saturationPct);
  // Higher Value/Time -> strictly brighter lightness
  assert.ok(turbulentInflow.lightnessPct > calmInflow.lightnessPct);
});

test('buildLiquidityHeatmap2D builds 2D symbol x 15m matrix sorted by average Value/Time', () => {
  const bars: LiquidityHeatmapBarInput[] = [
    // HPG: high Value/Time (2.0B/min) and high micro-volatility at 09:15 (02:15 UTC)
    { symbol: 'HPG', group: 'large', bar_ts: '2026-11-16T02:15:00.000Z', d_val: 1_500_000_000, ret_bps: 30, spread_bps: 14 },
    { symbol: 'HPG', group: 'large', bar_ts: '2026-11-16T02:16:00.000Z', d_val: 2_500_000_000, ret_bps: -25, spread_bps: 16 },
    // DIG: lower Value/Time (0.4B/min) at 09:30 (02:30 UTC)
    { symbol: 'DIG', group: 'thin', bar_ts: '2026-11-16T02:30:00.000Z', d_val: 400_000_000, ret_bps: -5, spread_bps: 48 },
  ];

  const mat = buildLiquidityHeatmap2D({
    symbols: ['DIG', 'HPG'],
    barsLhs: bars,
    colorMode: 'directional',
  });

  assert.deepEqual(mat.xSlots, ['09:15', '09:30']);
  // Sorted descending by avgValuePerMinB => HPG first
  assert.equal(mat.yRows[0].symbol, 'HPG');
  assert.equal(mat.yRows[1].symbol, 'DIG');

  const hpg0915 = mat.yRows[0].cells[0]!;
  assert.equal(hpg0915.valuePerMinB, 2); // (1.5B + 2.5B) / 2 bars = 2.0B/min
  assert.ok(hpg0915.microVolBps > 30); // std([30, -25]) ≈ 38.89 bps
  assert.equal(hpg0915.isHighVol, true);
  assert.equal(mat.yRows[0].cells[1], null);
  assert.equal(mat.yRows[1].cells[0], null);
  assert.equal(mat.yRows[1].cells[1]!.valuePerMinB, 0.4);
});
