import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeOrderBookImbalance,
  computeTick3LevelObi,
  type BookSnapLike,
} from './orderBookImbalance';

test('computeTick3LevelObi calculates exact 3-level OBI, weighted OBI, and microprice skew', () => {
  const snap: BookSnapLike = {
    ts: '2026-11-16T07:15:00.000Z',
    mid: 30_000,
    bid1: 29_950,
    bid2: 29_900,
    bid3: 29_850,
    ask1: 30_050,
    ask2: 30_100,
    ask3: 30_150,
    bidvol1: 50_000,
    bidvol2: 30_000,
    bidvol3: 20_000,
    askvol1: 10_000,
    askvol2: 10_000,
    askvol3: 10_000,
  };

  const out = computeTick3LevelObi(snap);
  assert.equal(out.hasLevels, true);
  // Total bid = 100k, total ask = 30k => (100 - 30) / 130 = 0.53846
  assert.ok(Math.abs((out.obi3L ?? 0) - 70 / 130) < 1e-6);
  // Weighted (0.55*40k + 0.3*20k + 0.15*10k) / (0.55*60k + 0.3*40k + 0.15*30k) = 29.5 / 49.5 ≈ 0.59596
  assert.ok(Math.abs((out.obiWeighted ?? 0) - 29.5 / 49.5) < 1e-6);
  // Microprice > Mid => positive skew in bps
  assert.ok((out.microSkewBps ?? 0) > 0);
  assert.equal(out.levels.length, 3);
  assert.ok(out.levels[0].levelObi > 0.6);
});

test('analyzeOrderBookImbalance triggers extreme buy and sell pressure regimes accurately', () => {
  const buySnaps: BookSnapLike[] = [
    {
      ts: '2026-11-16T07:10:00.000Z',
      mid: 25_000,
      bid1: 24_950,
      bid2: 24_900,
      bid3: 24_850,
      ask1: 25_050,
      ask2: 25_100,
      ask3: 25_150,
      bidvol1: 60_000,
      bidvol2: 20_000,
      bidvol3: 20_000,
      askvol1: 10_000,
      askvol2: 10_000,
      askvol3: 10_000,
    },
  ];
  const buyRes = analyzeOrderBookImbalance(buySnaps, 'HPG');
  assert.equal(buyRes.regime, 'BUY_PRESSURE_EXTREME');
  assert.equal(buyRes.buySpikeCount, 1);
  assert.equal(buyRes.sellSpikeCount, 0);
  assert.ok(buyRes.bidSharePct > 70);

  const sellSnaps: BookSnapLike[] = [
    {
      ts: '2026-11-16T07:12:00.000Z',
      mid: 25_000,
      bid1: 24_950,
      bid2: 24_900,
      bid3: 24_850,
      ask1: 25_050,
      ask2: 25_100,
      ask3: 25_150,
      bidvol1: 5_000,
      bidvol2: 5_000,
      bidvol3: 5_000,
      askvol1: 60_000,
      askvol2: 20_000,
      askvol3: 20_000,
    },
  ];
  const sellRes = analyzeOrderBookImbalance(sellSnaps, 'DIG');
  assert.equal(sellRes.regime, 'SELL_PRESSURE_EXTREME');
  assert.equal(sellRes.sellSpikeCount, 1);
  assert.ok(sellRes.askSharePct > 80);
});
