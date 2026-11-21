import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCalibrationCurve,
  computeIntradayUShape,
  computeLiquidityBeta,
  computePortfolioStress,
  evaluateAlertThresholdLab,
} from './portfolioAndProfileMath.ts';
import type { BarRow, NeoScopeSettings, SnapRow } from '../src/server/types.js';

const MOCK_SETTINGS: NeoScopeSettings = {
  mode: 'SYNTHETIC',
  provider: 'SYNTHETIC',
  dataset_mode: 'SYNTHETIC',
  timezone: 'Asia/Ho_Chi_Minh',
  config_hash: 'deadbeef1234',
  watchlist: { large: ['FPT', 'HPG'], thin: ['NLG', 'DIG'] },
  allSymbols: ['FPT', 'HPG', 'NLG', 'DIG'],
  execution: {
    participation_rate: 0.15,
    horizon_s: 180,
    pi_z: 1.6449,
    fee_rate: 0.0015,
    sell_tax_rate: 0.001,
    order_sizes_vnd: [50_000_000, 5_000_000_000],
  },
  bars: { freq_s: 60 },
};

function makeSnap(partial: Partial<SnapRow> & { symbol: string; ts: string }): SnapRow {
  return {
    ts: partial.ts,
    ts_ms: new Date(partial.ts).getTime(),
    seq: 1,
    symbol: partial.symbol,
    session_date: partial.session_date || '2026-11-16',
    session: partial.session || 'LO_AM',
    group: partial.group || (MOCK_SETTINGS.watchlist.large.includes(partial.symbol) ? 'large' : 'thin'),
    bucket: partial.bucket ?? 1,
    mid: partial.mid ?? 100_000,
    spread_bps: partial.spread_bps ?? 10,
    depth_bid_vnd: partial.depth_bid_vnd ?? 2_000_000_000,
    depth_ask_vnd: partial.depth_ask_vnd ?? 2_000_000_000,
    obi: partial.obi ?? 0,
    microprice: partial.mid ?? 100_000,
    hhi_bid: 0.4,
    hhi_ask: 0.4,
    d_vol: partial.d_vol ?? 5_000,
    d_val: 500_000_000,
    d_f_net_val: partial.d_f_net_val ?? 0,
    bid1: partial.bid1 ?? 99_950,
    bid2: partial.bid2 ?? 99_900,
    bid3: partial.bid3 ?? 99_800,
    ask1: partial.ask1 ?? 100_050,
    ask2: partial.ask2 ?? 100_100,
    ask3: partial.ask3 ?? 100_200,
    bidvol1: partial.bidvol1 ?? 5_000,
    bidvol2: partial.bidvol2 ?? 5_000,
    bidvol3: partial.bidvol3 ?? 5_000,
    askvol1: partial.askvol1 ?? 5_000,
    askvol2: partial.askvol2 ?? 5_000,
    askvol3: partial.askvol3 ?? 5_000,
    last_price: partial.last_price ?? 100_050,
    cum_vol: 100_000,
    cum_val: 10_000_000_000,
    f_remain: 1_000_000,
    f_room: 10_000_000,
    flags: null,
    n_flags: 0,
    ref: 100_000,
    ceiling: 107_000,
    floor: 93_000,
  };
}

test('computePortfolioStress increases cost and drops book coverage under 0.5x depth & 2x spread stress', () => {
  const snaps: SnapRow[] = [
    makeSnap({
      symbol: 'FPT',
      ts: '2026-11-16T02:30:00Z',
      mid: 132_000,
      spread_bps: 7.5,
      bid1: 131_950,
      bid2: 131_900,
      bid3: 131_850,
      bidvol1: 4_000,
      bidvol2: 4_000,
      bidvol3: 4_000,
      depth_bid_vnd: 1_582_800_000,
    }),
    makeSnap({
      symbol: 'NLG',
      ts: '2026-11-16T02:30:00Z',
      mid: 31_200,
      spread_bps: 32,
      bid1: 31_150,
      bid2: 31_100,
      bid3: 31_000,
      bidvol1: 3_000,
      bidvol2: 3_000,
      bidvol3: 3_000,
      depth_bid_vnd: 280_000_000,
    }),
  ];
  const barsLhs = [
    { symbol: 'FPT', lhs: 82.4 },
    { symbol: 'NLG', lhs: 31.2 },
  ];

  const res = computePortfolioStress({
    holdings: [
      { symbol: 'FPT', weightPct: 60 },
      { symbol: 'NLG', weightPct: 40 },
    ],
    totalVnd: 2_000_000_000,
    side: -1,
    snaps,
    barsLhs,
    settings: MOCK_SETTINGS,
  });

  assert.equal(res.rows.length, 2);
  assert.ok(res.weightedLhs !== null && res.weightedLhs > 55 && res.weightedLhs < 66);
  assert.ok(res.stressedImpactBps > res.normalImpactBps);
  assert.ok(res.stressedTotalVnd > res.normalTotalVnd);
  assert.ok(res.stressedCoveragePct <= res.normalCoveragePct);
  assert.ok(res.disclaimer.includes('không phải khuyến nghị đầu tư'));
});

test('computeIntradayUShape groups 15m VN slots chronologically and calculates effective spread', () => {
  const snaps: SnapRow[] = [
    // 09:15 VN = 02:15Z (open LO_AM)
    makeSnap({ symbol: 'FPT', ts: '2026-11-16T02:15:05Z', spread_bps: 20, mid: 100_000, last_price: 100_100, d_vol: 10_000 }),
    makeSnap({ symbol: 'NLG', ts: '2026-11-16T02:16:05Z', spread_bps: 40, mid: 30_000, last_price: 30_060, d_vol: 5_000 }),
    // 10:30 VN = 03:30Z (mid-morning)
    makeSnap({ symbol: 'FPT', ts: '2026-11-16T03:30:05Z', spread_bps: 10, mid: 100_000, last_price: 100_050, d_vol: 5_000 }),
  ];

  const profile = computeIntradayUShape(snaps, MOCK_SETTINGS);
  assert.equal(profile.length, 2);
  assert.equal(profile[0].slot, '09:15');
  assert.equal(profile[1].slot, '10:30');
  // 10,000 + 5,000 out of 20,000 total volume = 75%
  assert.equal(Math.round(profile[0].allVolSharePct), 75);
  assert.equal(profile[0].allQuotedSpreadBps, 30);
  // effective spread at 09:15 for FPT = 20 bps, NLG = 40 bps -> median 30 bps
  assert.ok(Math.abs((profile[0].allEffectiveSpreadBps ?? 0) - 30) < 0.01);
});

test('computeLiquidityBeta recovers positive commonality slope when symbol moves with market depth', () => {
  const bars: BarRow[] = [];
  const syms = ['FPT', 'HPG', 'NLG', 'DIG'];
  const marketMoves = Array.from({ length: 24 }, (_, i) => (i % 2 === 0 ? 0.05 : -0.04));

  for (let t = 0; t < marketMoves.length; t++) {
    const ts = new Date(Date.UTC(2026, 10, 16, 2, t, 0)).toISOString();
    for (const sym of syms) {
      const mult = sym === 'NLG' ? 1.5 : 1.0;
      const baseDepth = 1_000_000_000 * Math.exp(t === 0 ? 0 : marketMoves[t] * mult);
      bars.push({
        symbol: sym,
        bar_ts: ts,
        bar_ts_ms: new Date(ts).getTime(),
        session_date: '2026-11-16',
        group: MOCK_SETTINGS.watchlist.large.includes(sym) ? 'large' : 'thin',
        bucket: 1,
        d_vol: 1000,
        ret_bps: 0,
        spread_bps: 10 + (t % 2 === 0 ? -1 : 1),
        depth_bid_vnd: baseDepth,
        depth_ask_vnd: baseDepth,
        obi_last: 0,
        illiq: 0.1,
      });
    }
  }

  const betas = computeLiquidityBeta(bars, MOCK_SETTINGS);
  assert.equal(betas.length, 4);
  const nlg = betas.find((b) => b.symbol === 'NLG');
  assert.ok(nlg && nlg.depthBeta !== null && nlg.depthBeta > 1.2);
});

test('computeCalibrationCurve checks empirical PI coverage across 50/80/90/95% levels', () => {
  // Construct 100 beyond_book Gaussian-like errors with sigma_is_bps = 10
  const preds = Array.from({ length: 100 }, (_, i) => {
    // Spread errors symmetrically from -22 to +22 bps
    const err = ((i / 99) * 2 - 1) * 20;
    return {
      model: 'full',
      coverage: 0.4,
      e_is_bps: 15,
      sigma_is_bps: 10,
      realized_is_bps: 15 + err,
      lo_bps: 15 - 16.449,
      hi_bps: 15 + 16.449,
    };
  });

  const curve = computeCalibrationCurve(preds, 'beyond_book');
  assert.equal(curve.length, 4);
  assert.deepEqual(
    curve.map((c) => c.nominalPct),
    [50, 80, 90, 95],
  );
  // Higher nominal confidence must have strictly non-decreasing empirical coverage and strictly increasing width
  assert.ok(curve[3].empiricalPct >= curve[0].empiricalPct);
  assert.ok(curve[3].meanWidthBps > curve[2].meanWidthBps);
  assert.ok(curve[2].meanWidthBps > curve[1].meanWidthBps);
});

test('evaluateAlertThresholdLab detects synthetic spread burst and yields PR & z-sweep', () => {
  const trainSnaps: SnapRow[] = Array.from({ length: 40 }, (_, i) =>
    makeSnap({
      symbol: 'FPT',
      session_date: '2026-11-14',
      ts: new Date(Date.UTC(2026, 10, 14, 2, 0, i * 5)).toISOString(),
      bucket: 1,
      spread_bps: 8 + (i % 3), // mean ~9, std ~0.8
    }),
  );

  const testSnaps: SnapRow[] = Array.from({ length: 20 }, (_, i) =>
    makeSnap({
      symbol: 'FPT',
      session_date: '2026-11-16',
      ts: new Date(Date.UTC(2026, 10, 16, 2, 0, i * 5)).toISOString(),
      bucket: 1,
      // Inject sustained 3-tick spread widen at i = 10, 11, 12
      spread_bps: i >= 10 && i <= 12 ? 32 : 9,
    }),
  );

  const truthEvents = [
    {
      session_date: '2026-11-16',
      type: 'FLASH_MOVE',
      symbol: 'FPT',
      start_ts: testSnaps[10].ts,
      end_ts: testSnaps[12].ts,
    },
  ];

  const lab = evaluateAlertThresholdLab(
    [
      { session: '2026-11-14', snaps: trainSnaps },
      { session: '2026-11-16', snaps: testSnaps },
    ],
    truthEvents,
    { zThreshold: 3.0, pctThreshold: 0.99, persistenceN: 3, cooldownS: 60 },
  );

  assert.equal(lab.totalAlerts, 1);
  assert.equal(lab.overallPrecision, 1);
  assert.equal(lab.overallRecall, 1);
  assert.equal(lab.sweep.length, 5);
  assert.equal(lab.protocolSpec.schema_version, 'neoscope.alert_protocol.v1');
});
