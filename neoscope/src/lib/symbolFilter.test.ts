import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMarkerPercent,
  computeSymbolSignals,
  defaultThresholdForMode,
  filterSymbolsBySignal,
  getSignalRange,
  getSliderBounds,
  snapThresholdToStep,
} from './symbolFilter';

const GROUP_MAP: Record<string, 'large' | 'thin'> = {
  FPT: 'large',
  VCB: 'large',
  DIG: 'thin',
  NLG: 'thin',
};

const SAMPLE_BARS = [
  { symbol: 'FPT', bar_ts_ms: 1000, ret_bps: 10, lhs: 85, spread_bps: 8 },
  { symbol: 'FPT', bar_ts_ms: 2000, ret_bps: -10, lhs: 95, spread_bps: 7.5 },
  { symbol: 'VCB', bar_ts_ms: 1000, ret_bps: 4, lhs: 60, spread_bps: 15 },
  { symbol: 'VCB', bar_ts_ms: 2000, ret_bps: 6, lhs: 65, spread_bps: 16 },
  { symbol: 'DIG', bar_ts_ms: 1000, ret_bps: 40, lhs: 40, spread_bps: 55 },
  { symbol: 'DIG', bar_ts_ms: 2000, ret_bps: -20, lhs: 35, spread_bps: 52 },
  { symbol: 'NLG', bar_ts_ms: 1000, ret_bps: null, lhs: null, spread_bps: 45 },
];

const SAMPLE_ALERTS = [
  { symbol: 'DIG', priority: 'P1' },
  { symbol: 'DIG', priority: 'P3' },
  { symbol: 'FPT', priority: 'P2' },
];

test('computeSymbolSignals calculates volatility, latest LHS, and alert counts accurately', () => {
  const signals = computeSymbolSignals(SAMPLE_BARS, SAMPLE_ALERTS, ['FPT', 'VCB', 'DIG', 'NLG'], GROUP_MAP);
  assert.equal(signals.length, 4);

  const fpt = signals.find((s) => s.symbol === 'FPT')!;
  // sample std of [10, -10] is sqrt((100 + 100) / 1) = 14.142...
  assert.equal(fpt.volatilityBps, 14.14);
  assert.equal(fpt.lhsLast, 95);
  assert.equal(fpt.alertCount, 1);
  assert.equal(fpt.rareAlertCount, 1);

  const dig = signals.find((s) => s.symbol === 'DIG')!;
  // sample std of [40, -20] is sqrt((900 + 900) / 1) = 42.426...
  assert.equal(dig.volatilityBps, 42.43);
  assert.equal(dig.lhsLast, 35);
  assert.equal(dig.alertCount, 2);
  assert.equal(dig.rareAlertCount, 1);

  const nlg = signals.find((s) => s.symbol === 'NLG')!;
  assert.equal(nlg.volatilityBps, null);
  assert.equal(nlg.lhsLast, null);
});

test('filterSymbolsBySignal filters high_vol, high_lhs, low_lhs, and none in original order', () => {
  const all = ['FPT', 'VCB', 'DIG', 'NLG'];
  const signals = computeSymbolSignals(SAMPLE_BARS, SAMPLE_ALERTS, all, GROUP_MAP);

  assert.deepEqual(filterSymbolsBySignal(all, signals, 'none', 0), all);
  assert.deepEqual(filterSymbolsBySignal(all, signals, 'high_vol', 15), ['DIG']);
  assert.deepEqual(filterSymbolsBySignal(all, signals, 'high_vol', 10), ['FPT', 'DIG']);
  assert.deepEqual(filterSymbolsBySignal(all, signals, 'high_lhs', 70), ['FPT']);
  assert.deepEqual(filterSymbolsBySignal(all, signals, 'low_lhs', 65), ['VCB', 'DIG']);
  assert.deepEqual(filterSymbolsBySignal(all, signals, 'high_vol', 100), []);
});

test('getSignalRange computes min, max, median, mean and marker helpers align cleanly', () => {
  const all = ['FPT', 'VCB', 'DIG', 'NLG'];
  const signals = computeSymbolSignals(SAMPLE_BARS, SAMPLE_ALERTS, all, GROUP_MAP);

  const volRange = getSignalRange(signals, 'volatilityBps');
  assert.ok(volRange);
  assert.equal(volRange.min, 1.41);
  assert.equal(volRange.max, 42.43);
  assert.equal(volRange.median, 14.14);
  // (14.14 + 1.41 + 42.43) / 3 = 19.3266... -> 19.33
  assert.equal(volRange.mean, 19.33);

  const volBounds = getSliderBounds('high_vol', volRange);
  assert.deepEqual(volBounds, { min: 0, max: 45, step: 1 });
  assert.equal(computeMarkerPercent(22.5, 0, 45), 50);
  assert.equal(computeMarkerPercent(-5, 0, 45), 0);
  assert.equal(computeMarkerPercent(80, 0, 45), 100);
  assert.equal(computeMarkerPercent(10, 10, 10), 50);
  assert.equal(snapThresholdToStep(19.33, volBounds), 19);

  const lhsBounds = getSliderBounds('high_lhs', getSignalRange(signals, 'lhsLast'));
  assert.deepEqual(lhsBounds, { min: 0, max: 100, step: 2.5 });
  assert.equal(snapThresholdToStep(66.2, lhsBounds), 65);

  const volDef = defaultThresholdForMode('high_vol', signals);
  assert.ok(volDef >= 1 && volDef <= 43);
  assert.equal(defaultThresholdForMode('high_lhs', signals), 70);
  assert.equal(defaultThresholdForMode('low_lhs', signals), 45);
});
