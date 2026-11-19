import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fmtAlertDirection, fmtAlertScale, fmtAlertType } from './format';
import {
  buildIntradayHeatmapMatrix,
  filterSymbolsByQuery,
  filterTapeWindow,
  sortWatchlist,
} from './tradingview';

describe('TradingView UI helpers', () => {
  it('formats all alert types into clean English without underscores and keeps Vietnamese scale/direction', () => {
    assert.equal(fmtAlertType('FOREIGN_BURST'), 'Foreign Burst');
    assert.equal(fmtAlertType('TRADE_BURST'), 'Trade Burst');
    assert.equal(fmtAlertType('SPREAD_WIDEN'), 'Spread Widen');
    assert.equal(fmtAlertType('DEPTH_EVAPORATION'), 'Depth Evaporation');
    assert.equal(fmtAlertType('OBI_EXTREME'), 'OBI Extreme');
    assert.equal(fmtAlertType('CUSTOM_ALERT_CODE'), 'Custom Alert Code');
    assert.equal(fmtAlertScale('log'), 'logarit (log)');
    assert.equal(fmtAlertDirection('high'), 'tăng vọt (đuôi trên)');
  });

  it('filters intraday tape rows by Vietnam session windows cleanly', () => {
    const rows = [
      { ts: '2026-11-16T02:15:00.000Z', ts_ms: Date.parse('2026-11-16T02:15:00.000Z'), mid: 50000 }, // 09:15 VN
      { ts: '2026-11-16T04:15:00.000Z', ts_ms: Date.parse('2026-11-16T04:15:00.000Z'), mid: 50200 }, // 11:15 VN
      { ts: '2026-11-16T06:30:00.000Z', ts_ms: Date.parse('2026-11-16T06:30:00.000Z'), mid: 50500 }, // 13:30 VN
      { ts: '2026-11-16T07:15:00.000Z', ts_ms: Date.parse('2026-11-16T07:15:00.000Z'), mid: 50700 }, // 14:15 VN
      { ts: '2026-11-16T07:35:00.000Z', ts_ms: Date.parse('2026-11-16T07:35:00.000Z'), mid: 50900 }, // 14:35 VN
    ];

    assert.equal(filterTapeWindow(rows, 'ALL').length, 5);
    assert.deepEqual(
      filterTapeWindow(rows, 'AM').map((r) => r.mid),
      [50000, 50200],
    );
    assert.deepEqual(
      filterTapeWindow(rows, 'PM').map((r) => r.mid),
      [50500, 50700, 50900],
    );
    assert.deepEqual(
      filterTapeWindow(rows, '1H').map((r) => r.mid),
      [50700, 50900],
    );
    assert.deepEqual(
      filterTapeWindow(rows, '30M').map((r) => r.mid),
      [50700, 50900],
    );
  });

  it('sorts watchlist rows ascending/descending and keeps null values last', () => {
    const rows = [
      { symbol: 'SSI', spreadBps: 14.2, lhsSeries: [72, 74] },
      { symbol: 'FPT', spreadBps: 8.5, lhsSeries: [88, 91] },
      { symbol: 'DIG', spreadBps: null, lhsSeries: [] },
      { symbol: 'HPG', spreadBps: 11.1, lhsSeries: [80] },
    ];

    assert.deepEqual(
      sortWatchlist(rows, 'spreadBps', 'asc').map((r) => r.symbol),
      ['FPT', 'HPG', 'SSI', 'DIG'],
    );
    assert.deepEqual(
      sortWatchlist(rows, 'spreadBps', 'desc').map((r) => r.symbol),
      ['SSI', 'HPG', 'FPT', 'DIG'],
    );
    assert.deepEqual(
      sortWatchlist(rows, 'lhs', 'desc').map((r) => r.symbol),
      ['FPT', 'HPG', 'SSI', 'DIG'],
    );
  });

  it('filters palette symbols by ticker or group label with metadata fallback', () => {
    const wl = [
      { symbol: 'FPT', group: 'large', groupLabel: 'VN30 lớn', midLast: 132000, spreadBps: 9.1, lhsSeries: [85] },
      { symbol: 'DIG', group: 'thin', groupLabel: 'Midcap mỏng', midLast: 21500, spreadBps: 24.4, lhsSeries: [41] },
    ];
    const resThin = filterSymbolsByQuery(['FPT', 'DIG', 'VCB'], wl, 'mỏng');
    assert.equal(resThin.length, 1);
    assert.equal(resThin[0].symbol, 'DIG');
    assert.equal(resThin[0].lhsLast, 41);

    const resSym = filterSymbolsByQuery(['FPT', 'DIG', 'VCB'], wl, 'vcb');
    assert.equal(resSym.length, 1);
    assert.equal(resSym[0].symbol, 'VCB');
    assert.equal(resSym[0].midLast, null);
  });

  it('aggregates intraday liquidity bars into sorted 15-minute Vietnam slots per symbol', () => {
    const bars = [
      { symbol: 'FPT', bar_ts: '2026-11-16T02:17:00.000Z', lhs: 80, spread_bps: 8.0, depth_bid_vnd: 1.2e9 }, // 09:15 VN
      { symbol: 'FPT', bar_ts: '2026-11-16T02:25:00.000Z', lhs: 84, spread_bps: 10.0, depth_bid_vnd: 1.6e9 }, // 09:15 VN
      { symbol: 'DIG', bar_ts: '2026-11-16T02:18:00.000Z', lhs: 42, spread_bps: 22.5, depth_bid_vnd: 0.4e9 }, // 09:15 VN
      { symbol: 'FPT', bar_ts: '2026-11-16T06:34:00.000Z', lhs: 76, spread_bps: 12.0, depth_bid_vnd: 2.0e9 }, // 13:30 VN
    ];

    const lhsMat = buildIntradayHeatmapMatrix(bars, ['FPT', 'DIG'], 'lhs');
    assert.deepEqual(lhsMat.xLabels, ['09:15', '13:30']);
    assert.deepEqual(lhsMat.ySymbols, ['DIG', 'FPT']);
    assert.deepEqual(lhsMat.z, [
      [42, null],
      [82, 76],
    ]);

    const depthMat = buildIntradayHeatmapMatrix(bars, ['FPT', 'DIG'], 'depth_bid_vnd');
    assert.deepEqual(depthMat.z, [
      [0.4, null],
      [1.4, 2],
    ]);
  });
});
