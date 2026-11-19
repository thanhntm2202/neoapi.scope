import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BPS,
  expectedIsBps,
  foldParamsFor,
  ladderWalk,
  simulateOrder,
  tradingCostsBps,
} from './executionMath.ts';
import type { SnapRow } from './parquetStore.ts';

test('ladderWalk sweeps multiple price levels accurately for SELL and BUY', () => {
  // SELL hits bid prices [20000, 19950, 19900] with mid 20025
  const sell = ladderWalk(-1, 2500, [20000, 19950, 19900], [1000, 1000, 2000], 20025);
  assert.equal(sell.ok, true);
  assert.equal(sell.filled_vis, 2500);
  assert.equal(sell.qty_res, 0);
  assert.equal(sell.coverage, 1);
  const expectedVwap = (1000 * 20000 + 1000 * 19950 + 500 * 19900) / 2500;
  assert.ok(Math.abs((sell.vwap_vis ?? 0) - expectedVwap) < 1e-6);
  const expectedBps = ((-1 * (expectedVwap - 20025)) / 20025) * BPS;
  assert.ok(Math.abs((sell.cost_vis_bps ?? 0) - expectedBps) < 1e-6);

  // BUY exceeding visible book leaves positive qty_res
  const buy = ladderWalk(1, 5000, [20050, 20100, null], [1000, 1500, null], 20025);
  assert.equal(buy.ok, true);
  assert.equal(buy.filled_vis, 2500);
  assert.equal(buy.qty_res, 2500);
  assert.equal(buy.coverage, 0.5);
});

test('ladderWalk returns ok=false when mid is invalid or book is empty', () => {
  const empty = ladderWalk(1, 1000, [null, null, null], [null, null, null], 20000);
  assert.equal(empty.ok, false);
  assert.equal(empty.coverage, 0);

  const badMid = ladderWalk(-1, 1000, [20000], [5000], null);
  assert.equal(badMid.ok, false);
});

test('expectedIsBps distinguishes in-book deterministic cost vs beyond-book stochastic interval', () => {
  const inBookLadder = ladderWalk(-1, 1000, [20000, 19950], [2000, 2000], 20025);
  const inBookEst = expectedIsBps(-1, 1000, inBookLadder, 25, 0.2, 0.5, 500, 3.0, 0.15, 180, 1.0);
  assert.equal(inBookEst.w_vis, 1);
  assert.equal(inBookEst.sigma_is_bps, 0);
  assert.equal(inBookEst.lo_bps, inBookEst.hi_bps);

  const beyondLadder = ladderWalk(-1, 10000, [20000, 19950], [1000, 1000], 20025);
  const beyondEst = expectedIsBps(-1, 10000, beyondLadder, 25, -0.4, 0.8, 400, 4.0, 0.15, 180, 1.1);
  assert.ok(beyondEst.w_vis < 1);
  assert.ok((beyondEst.sigma_is_bps ?? 0) > 0);
  assert.ok((beyondEst.hi_bps ?? 0) > (beyondEst.lo_bps ?? 0));
});

test('tradingCostsBps applies Vietnam sell tax only on sell side', () => {
  const sell = tradingCostsBps(1e9, -1, 0.0015, 0.001);
  assert.equal(sell.fee_vnd, 1_500_000);
  assert.equal(sell.tax_vnd, 1_000_000);

  const buy = tradingCostsBps(1e9, 1, 0.0015, 0.001);
  assert.equal(buy.fee_vnd, 1_500_000);
  assert.equal(buy.tax_vnd, 0);
});

test('foldParamsFor enforces out-of-sample lookup and warns on training sessions', () => {
  const folds = [
    { fold: 1, group: 'large', test_date: '2026-11-10', kappa_bps_per_s: 0.9, y_cov: 1.0 },
    { fold: 2, group: 'large', test_date: '2026-11-11', kappa_bps_per_s: 1.1, y_cov: 1.05 },
  ];
  const oos = foldParamsFor(folds, '2026-11-11', ['2026-11-10', '2026-11-11']);
  assert.equal(oos.rows.length, 1);
  assert.equal(oos.rows[0].fold, 2);
  assert.ok(oos.note.includes('ngoài mẫu'));

  const train = foldParamsFor(folds, '2026-11-03', ['2026-11-10', '2026-11-11']);
  assert.equal(train.rows[0].fold, 1);
  assert.ok(train.note.includes('MINH HỌA'));
});

test('simulateOrder executes paper walk cleanly without side effects', () => {
  const mkSnap = (ts: number, bid1: number, ask1: number, dVol: number): SnapRow => ({
    ts,
    ts_vn: '',
    seq: 1,
    symbol: 'FPT',
    session_date: '2026-11-16',
    session: 'LO_AM',
    group: 'large',
    bucket: 1,
    mid: (bid1 + ask1) / 2,
    spread_bps: ((ask1 - bid1) / ((bid1 + ask1) / 2)) * BPS,
    depth_bid_vnd: bid1 * 1000,
    depth_ask_vnd: ask1 * 1000,
    obi: 0,
    microprice: (bid1 + ask1) / 2,
    hhi_bid: 0.5,
    hhi_ask: 0.5,
    d_vol: dVol,
    d_val: dVol * bid1,
    d_f_net_val: 0,
    bid1,
    bid2: bid1 - 100,
    bid3: bid1 - 200,
    ask1,
    ask2: ask1 + 100,
    ask3: ask1 + 200,
    bidvol1: 500,
    bidvol2: 500,
    bidvol3: 500,
    askvol1: 500,
    askvol2: 500,
    askvol3: 500,
    last_price: bid1,
    cum_vol: dVol,
    cum_val: dVol * bid1,
    f_remain: 0,
    f_room: 0,
    flags: [],
    n_flags: 0,
    ref: bid1,
    ceiling: bid1 * 1.07,
    floor: bid1 * 0.93,
  });

  const snaps = [
    mkSnap(1000, 100_000, 100_100, 1000),
    mkSnap(6000, 99_900, 100_000, 10_000),
    mkSnap(11000, 99_800, 99_900, 10_000),
  ];

  const sim = simulateOrder(snaps, 1000, -1, 2000, 0.15, 180, 0.0015, 0.001);
  assert.equal(sim.ok, true);
  assert.equal(sim.filled_frac, 1);
  assert.ok(sim.n_steps >= 1);
  assert.ok((sim.realized_is_bps ?? 0) > 0);
});
