import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCostCurve,
  buildOrderBookFromSnap,
  COST_CURVE_NOTIONALS,
  expectedIsBps,
  foldParamsFor,
  ladderWalk,
  tradingCostsBps,
} from './analytics.js';
import { sessionDateOf } from './store.js';
import type { NeoScopeSettings, SnapRow } from './types.js';

function makeSettings(): NeoScopeSettings {
  return {
    mode: 'SYNTHETIC',
    provider: 'SYNTHETIC',
    dataset_mode: 'SYNTHETIC',
    timezone: 'Asia/Ho_Chi_Minh',
    config_hash: 'test',
    watchlist: { large: ['FPT'], thin: ['DIG'] },
    allSymbols: ['FPT', 'DIG'],
    execution: {
      participation_rate: 0.15,
      horizon_s: 180,
      pi_z: 1.6449,
      fee_rate: 0.0015,
      sell_tax_rate: 0.001,
      order_sizes_vnd: [100e6, 1e9],
    },
    bars: { freq_s: 60 },
  };
}

function makeSnap(overrides: Partial<SnapRow> = {}): SnapRow {
  return {
    ts: '2026-11-16T02:30:00.000Z',
    ts_ms: 1794796200000,
    seq: 1,
    symbol: 'FPT',
    session_date: '2026-11-16',
    session: 'LO_AM',
    group: 'large',
    bucket: 2,
    mid: 130000,
    spread_bps: 15.38,
    depth_bid_vnd: 650000000,
    depth_ask_vnd: 520000000,
    obi: 0.25,
    microprice: 130025,
    hhi_bid: 0.4,
    hhi_ask: 0.4,
    d_vol: 1000,
    d_val: 130000000,
    d_f_net_val: 0,
    bid1: 129900,
    bid2: 129800,
    bid3: 129700,
    ask1: 130100,
    ask2: 130200,
    ask3: 130300,
    bidvol1: 2000,
    bidvol2: 3000,
    bidvol3: 5000,
    askvol1: 1500,
    askvol2: 2500,
    askvol3: 4000,
    last_price: 130000,
    cum_vol: 500000,
    cum_val: 65000000000,
    f_remain: 100000,
    f_room: 1000000,
    flags: null,
    n_flags: 0,
    ref: 129500,
    ceiling: 138500,
    floor: 120500,
    ...overrides,
  };
}

test('sessionDateOf parses SYNTH and LIVE_SSI/LIVE_NEO folder names', () => {
  assert.equal(sessionDateOf('SYNTH_2026-11-16'), '2026-11-16');
  assert.equal(sessionDateOf('LIVE_SSI_2026-11-19_091955_abc'), '2026-11-19');
  assert.equal(sessionDateOf('LIVE_NEO_2026-11-19'), '2026-11-19');
});

test('buildOrderBookFromSnap builds 3 bid & ask levels and maxVol', () => {
  const ob = buildOrderBookFromSnap(makeSnap());
  assert.ok(ob);
  assert.equal(ob.mid, 130000);
  assert.equal(ob.bids.length, 3);
  assert.equal(ob.asks.length, 3);
  assert.equal(ob.bids[0].price, 129900);
  assert.equal(ob.asks[2].vol, 4000);
  assert.equal(ob.maxVol, 5000);
});

test('buildOrderBookFromSnap returns null when mid is invalid', () => {
  assert.equal(buildOrderBookFromSnap(makeSnap({ mid: null })), null);
  assert.equal(buildOrderBookFromSnap(makeSnap({ mid: 0 })), null);
});

test('ladderWalk sweeps across levels and tracks residual', () => {
  const res = ladderWalk(1, 5000, [130100, 130200, 130300], [1500, 2500, 4000], 130000);
  assert.equal(res.ok, true);
  assert.equal(res.filled_vis, 5000);
  assert.equal(res.qty_res, 0);
  assert.equal(res.coverage, 1);
  assert.equal(res.fills.length, 3);

  const partial = ladderWalk(1, 10000, [130100, 130200, 130300], [1500, 2500, 4000], 130000);
  assert.equal(partial.filled_vis, 8000);
  assert.equal(partial.qty_res, 2000);
  assert.equal(partial.coverage, 0.8);
});

test('expectedIsBps and tradingCostsBps compute coherent estimates', () => {
  const lad = ladderWalk(-1, 4000, [129900, 129800, 129700], [2000, 3000, 5000], 130000);
  const est = expectedIsBps({
    side: -1,
    qty: 4000,
    ladder: lad,
    hs_bps: 7.69,
    obi_now: 0.25,
    kappa_bps_per_s: 0.05,
    v_rate_shares_per_s: 50,
    sigma_bps_per_s: 1.5,
    rho: 0.15,
    horizon_s: 180,
    y_risk: 1.0,
    pi_z: 1.6449,
  });
  assert.ok(est.e_is_bps > 0);
  assert.equal(est.w_vis, 1);
  const tc = tradingCostsBps(520_000_000, -1, 0.0015, 0.001);
  assert.equal(tc.fee_bps, 15);
  assert.equal(tc.tax_bps, 10);
});

test('foldParamsFor handles empty fold list cleanly', () => {
  const res = foldParamsFor([], '2026-11-19', []);
  assert.equal(res.rows.length, 0);
  assert.ok(res.note.includes('validate'));
});

test('buildCostCurve evaluates all 8 notionals with decreasing coverage and valid bounds', () => {
  const settings = makeSettings();
  const fullCurve = buildCostCurve({
    mid: 130000,
    side: -1,
    prices: [129900, 129800, 129700],
    vols: [2000, 3000, 5000],
    hs_bps: 7.69,
    obi_now: 0.25,
    v_rate: 40,
    sigma: 1.4,
    kappa: 0.04,
    y_risk: 1.0,
    settings,
    hasFoldModel: true,
  });

  assert.equal(fullCurve.length, COST_CURVE_NOTIONALS.length);
  assert.equal(fullCurve[0].notional, 50e6);
  assert.equal(fullCurve[0].coverage, 1);
  assert.ok(fullCurve[fullCurve.length - 1].coverage < 1);
  assert.ok(fullCurve[fullCurve.length - 1].cost_vis_bps! >= fullCurve[0].cost_vis_bps!);
  for (const pt of fullCurve) {
    assert.ok(pt.e_is_bps !== null && pt.lo_bps !== null && pt.hi_bps !== null);
    assert.ok(pt.lo_bps! <= pt.e_is_bps! && pt.e_is_bps! <= pt.hi_bps!);
  }

  const detCurve = buildCostCurve({
    mid: 130000,
    side: -1,
    prices: [129900, 129800, 129700],
    vols: [2000, 3000, 5000],
    hs_bps: 7.69,
    obi_now: 0.25,
    v_rate: null,
    sigma: null,
    kappa: 0,
    y_risk: 1.0,
    settings,
    hasFoldModel: false,
  });
  assert.equal(detCurve.length, COST_CURVE_NOTIONALS.length);
  for (const pt of detCurve) {
    assert.ok(pt.cost_vis_bps !== null);
    assert.equal(pt.e_is_bps, null);
    assert.equal(pt.lo_bps, null);
    assert.equal(pt.hi_bps, null);
  }
});
