import { toVnIsoLocal } from './format';

export type OverviewHeatmapMetric = 'flow' | 'intensity' | 'anomaly';

export interface HeatmapBarInput {
  symbol: string;
  bar_ts: string;
  bar_ts_ms?: number;
  group?: string;
  d_vol?: number | null;
  d_val?: number | null;
  d_f_net_val?: number | null;
  ret_bps?: number | null;
  spread_bps?: number | null;
  depth_bid_vnd?: number | null;
  depth_ask_vnd?: number | null;
  obi_mean?: number | null;
  obi_last?: number | null;
  lhs?: number | null;
}

export interface HeatmapWatchlistInput {
  symbol: string;
  group?: string;
  groupLabel?: string;
  midLast?: number | null;
  spreadBps?: number | null;
  volatilityBps?: number | null;
  depthBidB?: number | null;
  obi?: number | null;
  cumVolM?: number | null;
  alertCount?: number;
  rareAlertCount?: number;
}

export interface WatchlistHeatmapCell {
  symbol: string;
  group: 'large' | 'thin';
  groupLabel: string;
  turnoverB: number;
  turnoverSharePct: number;
  signedFlowB: number;
  flowRatioPct: number;
  foreignNetB: number;
  intensityRatio: number;
  latestIntensityRatio: number;
  peakSlot: string | null;
  spreadBps: number | null;
  spreadWideningRatio: number;
  volatilityBps: number | null;
  lhsLatest: number | null;
  lhsSwing: number;
  depthBidB: number | null;
  obi: number | null;
  cumVolM: number | null;
  alertCount: number;
  rareAlertCount: number;
  anomalyScore: number;
  isAnomalous: boolean;
  anomalyReasons: string[];
  anomalyBadge: string | null;
}

export interface OverviewHeatmapMatrix {
  xLabels: string[];
  ySymbols: string[];
  z: (number | null)[][];
  customText: string[][];
  unit: string;
}

function sampleMedian(arr: number[]): number | null {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

function getVnSlot15m(iso: string): string | null {
  const vnLocal = toVnIsoLocal(iso);
  const timePart = vnLocal.split('T')[1] || '';
  const [hhStr, mmStr] = timePart.split(':');
  const hh = Number(hhStr);
  const mm = Number(mmStr);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  const floored = Math.floor(mm / 15) * 15;
  return `${String(hh).padStart(2, '0')}:${String(floored).padStart(2, '0')}`;
}

function estimateBarTurnoverVnd(bar: HeatmapBarInput, fallbackMid: number | null): number {
  if (bar.d_val !== null && bar.d_val !== undefined && Number.isFinite(Number(bar.d_val))) {
    return Math.max(0, Number(bar.d_val));
  }
  const vol = bar.d_vol !== null && bar.d_vol !== undefined ? Number(bar.d_vol) : 0;
  if (Number.isFinite(vol) && vol > 0 && fallbackMid !== null && fallbackMid > 0) {
    return vol * fallbackMid;
  }
  return 0;
}

export function buildWatchlistHeatmapCells(params: {
  symbols: string[];
  watchlist: HeatmapWatchlistInput[];
  barsLhs: HeatmapBarInput[];
  sortBy?: OverviewHeatmapMetric;
}): WatchlistHeatmapCell[] {
  const { symbols, watchlist, barsLhs, sortBy = 'flow' } = params;
  const targetSymbols =
    symbols.length > 0 ? symbols : watchlist.map((w) => w.symbol);
  if (!targetSymbols.length) return [];

  const symSet = new Set(targetSymbols);
  const wlBySym = new Map<string, HeatmapWatchlistInput>();
  for (const w of watchlist) {
    if (symSet.has(w.symbol)) wlBySym.set(w.symbol, w);
  }

  const barsBySym = new Map<string, HeatmapBarInput[]>();
  for (const b of barsLhs) {
    if (!symSet.has(b.symbol)) continue;
    let arr = barsBySym.get(b.symbol);
    if (!arr) {
      arr = [];
      barsBySym.set(b.symbol, arr);
    }
    arr.push(b);
  }

  const rawCells = targetSymbols.map((sym) => {
    const w = wlBySym.get(sym);
    const symBars = [...(barsBySym.get(sym) || [])].sort(
      (a, b) => (a.bar_ts_ms ?? Date.parse(a.bar_ts)) - (b.bar_ts_ms ?? Date.parse(b.bar_ts)),
    );
    const midLast = w?.midLast ?? null;

    let totalTurnoverVnd = 0;
    let signedFlowVnd = 0;
    let foreignNetVnd = 0;
    const slotTurnovers = new Map<string, number>();
    const spreads: number[] = [];
    const lhsVals: number[] = [];
    let lastObi: number | null = w?.obi ?? null;

    for (const b of symBars) {
      const valVnd = estimateBarTurnoverVnd(b, midLast);
      totalTurnoverVnd += valVnd;

      const ret = b.ret_bps !== null && b.ret_bps !== undefined ? Number(b.ret_bps) : null;
      const obiBar =
        b.obi_mean !== null && b.obi_mean !== undefined
          ? Number(b.obi_mean)
          : b.obi_last !== null && b.obi_last !== undefined
            ? Number(b.obi_last)
            : null;
      if (obiBar !== null && Number.isFinite(obiBar)) {
        lastObi = obiBar;
      }

      if (valVnd > 0) {
        let dirSign = 0;
        if (ret !== null && Number.isFinite(ret) && Math.abs(ret) > 1e-6) {
          dirSign = ret > 0 ? 1 : -1;
        } else if (obiBar !== null && Number.isFinite(obiBar)) {
          dirSign = Math.max(-1, Math.min(1, obiBar));
        }
        signedFlowVnd += valVnd * dirSign;
      }

      if (b.d_f_net_val !== null && b.d_f_net_val !== undefined && Number.isFinite(Number(b.d_f_net_val))) {
        foreignNetVnd += Number(b.d_f_net_val);
      }

      const slot = getVnSlot15m(b.bar_ts);
      if (slot) {
        slotTurnovers.set(slot, (slotTurnovers.get(slot) || 0) + valVnd);
      }

      if (b.spread_bps !== null && b.spread_bps !== undefined && Number.isFinite(Number(b.spread_bps))) {
        spreads.push(Number(b.spread_bps));
      }
      if (b.lhs !== null && b.lhs !== undefined && Number.isFinite(Number(b.lhs))) {
        lhsVals.push(Number(b.lhs));
      }
    }

    if (totalTurnoverVnd <= 0 && w?.cumVolM && midLast) {
      totalTurnoverVnd = w.cumVolM * 1e6 * midLast;
    }

    const slotEntries = Array.from(slotTurnovers.entries()).sort((a, b) => a[0].localeCompare(b[0], 'en'));
    const positiveSlotVals = slotEntries.map(([, v]) => v).filter((v) => v > 0);
    const medSlot = sampleMedian(positiveSlotVals);
    let peakVal = 0;
    let peakSlot: string | null = null;
    for (const [sl, v] of slotEntries) {
      if (v > peakVal) {
        peakVal = v;
        peakSlot = sl;
      }
    }
    const latestSlotVal = slotEntries.length > 0 ? slotEntries[slotEntries.length - 1][1] : 0;
    const intensityRatio = medSlot && medSlot > 0 ? peakVal / medSlot : positiveSlotVals.length ? 1 : 0;
    const latestIntensityRatio = medSlot && medSlot > 0 ? latestSlotVal / medSlot : positiveSlotVals.length ? 1 : 0;

    const medSpread = sampleMedian(spreads);
    const maxSpread = spreads.length ? Math.max(...spreads) : null;
    const latestSpread = w?.spreadBps ?? (spreads.length ? spreads[spreads.length - 1] : null);
    const spreadWideningRatio =
      medSpread && medSpread > 0 && maxSpread !== null ? maxSpread / medSpread : 1;

    const lhsLatest = lhsVals.length ? lhsVals[lhsVals.length - 1] : null;
    const lhsSwing = lhsVals.length >= 2 ? Math.max(...lhsVals) - Math.min(...lhsVals) : 0;

    const alertCount = Number(w?.alertCount ?? 0);
    const rareAlertCount = Number(w?.rareAlertCount ?? 0);
    const volBps = w?.volatilityBps ?? null;

    // Composite Liquidity Anomaly Score (0-100)
    const burstPts = Math.min(35, Math.max(0, (intensityRatio - 1.2) * 18));
    const alertPts = Math.min(35, rareAlertCount * 15 + Math.max(0, alertCount - rareAlertCount) * 4);
    const spreadPts = Math.min(20, Math.max(0, (spreadWideningRatio - 1.2) * 18));
    const volPts = volBps !== null && Number.isFinite(volBps) ? Math.min(10, Math.max(0, (volBps - 14) * 0.6)) : 0;
    const anomalyScore = Math.round(Math.min(100, burstPts + alertPts + spreadPts + volPts));

    const anomalyReasons: string[] = [];
    if (rareAlertCount > 0) anomalyReasons.push(`${rareAlertCount} cảnh báo P1/P2`);
    if (intensityRatio >= 1.9 && peakSlot) anomalyReasons.push(`KL đột biến ×${intensityRatio.toFixed(1)} (${peakSlot})`);
    if (spreadWideningRatio >= 1.65) anomalyReasons.push(`Spread giãn ×${spreadWideningRatio.toFixed(1)}`);
    if (volBps !== null && volBps >= 22) anomalyReasons.push(`Biến động σ=${volBps.toFixed(1)} bps`);

    const isAnomalous =
      rareAlertCount > 0 || intensityRatio >= 2.0 || spreadWideningRatio >= 1.75 || anomalyScore >= 45;

    let anomalyBadge: string | null = null;
    if (rareAlertCount > 0) anomalyBadge = `${rareAlertCount} P1/P2`;
    else if (intensityRatio >= 2.0) anomalyBadge = `×${intensityRatio.toFixed(1)} KL`;
    else if (spreadWideningRatio >= 1.75) anomalyBadge = 'Spread giãn';
    else if (anomalyScore >= 45) anomalyBadge = `Bất thường ${anomalyScore}`;

    const grp: 'large' | 'thin' =
      w?.group === 'thin' || symBars[0]?.group === 'thin' ? 'thin' : 'large';

    return {
      symbol: sym,
      group: grp,
      groupLabel: w?.groupLabel || (grp === 'large' ? 'VN30 lớn' : 'Midcap mỏng'),
      turnoverB: totalTurnoverVnd / 1e9,
      turnoverSharePct: 0,
      signedFlowB: signedFlowVnd / 1e9,
      flowRatioPct: totalTurnoverVnd > 0 ? (signedFlowVnd / totalTurnoverVnd) * 100 : 0,
      foreignNetB: foreignNetVnd / 1e9,
      intensityRatio,
      latestIntensityRatio,
      peakSlot,
      spreadBps: latestSpread,
      spreadWideningRatio,
      volatilityBps: volBps,
      lhsLatest,
      lhsSwing,
      depthBidB: w?.depthBidB ?? null,
      obi: lastObi,
      cumVolM: w?.cumVolM ?? null,
      alertCount,
      rareAlertCount,
      anomalyScore,
      isAnomalous,
      anomalyReasons,
      anomalyBadge,
    };
  });

  const totalWatchlistTurnover = rawCells.reduce((acc, c) => acc + c.turnoverB, 0);
  for (const c of rawCells) {
    c.turnoverSharePct = totalWatchlistTurnover > 0 ? (c.turnoverB / totalWatchlistTurnover) * 100 : 0;
  }

  return rawCells.sort((a, b) => {
    if (sortBy === 'anomaly') {
      return b.anomalyScore - a.anomalyScore || b.rareAlertCount - a.rareAlertCount || b.turnoverB - a.turnoverB;
    }
    if (sortBy === 'intensity') {
      return b.intensityRatio - a.intensityRatio || b.turnoverB - a.turnoverB;
    }
    return b.turnoverB - a.turnoverB || b.anomalyScore - a.anomalyScore;
  });
}

export function buildOverviewHeatmapMatrix(params: {
  symbols: string[];
  barsLhs: HeatmapBarInput[];
  metric: OverviewHeatmapMetric;
  watchlist?: HeatmapWatchlistInput[];
}): OverviewHeatmapMatrix {
  const { symbols, barsLhs, metric, watchlist = [] } = params;
  if (!symbols.length || !barsLhs.length) {
    return { xLabels: [], ySymbols: [], z: [], customText: [], unit: '' };
  }

  const midMap = new Map<string, number>();
  for (const w of watchlist) {
    if (w.midLast !== null && w.midLast !== undefined && Number.isFinite(w.midLast)) {
      midMap.set(w.symbol, w.midLast);
    }
  }

  const symSet = new Set(symbols);
  const slotSet = new Set<string>();
  const agg = new Map<
    string,
    {
      valVnd: number;
      signedFlowVnd: number;
      spreadSum: number;
      spreadCount: number;
      maxSpread: number;
    }
  >();

  for (const b of barsLhs) {
    if (!symSet.has(b.symbol)) continue;
    const slot = getVnSlot15m(b.bar_ts);
    if (!slot) continue;
    slotSet.add(slot);

    const key = `${b.symbol}|${slot}`;
    let entry = agg.get(key);
    if (!entry) {
      entry = { valVnd: 0, signedFlowVnd: 0, spreadSum: 0, spreadCount: 0, maxSpread: 0 };
      agg.set(key, entry);
    }

    const valVnd = estimateBarTurnoverVnd(b, midMap.get(b.symbol) ?? null);
    entry.valVnd += valVnd;

    const ret = b.ret_bps !== null && b.ret_bps !== undefined ? Number(b.ret_bps) : null;
    const obiBar =
      b.obi_mean !== null && b.obi_mean !== undefined
        ? Number(b.obi_mean)
        : b.obi_last !== null && b.obi_last !== undefined
          ? Number(b.obi_last)
          : null;
    if (valVnd > 0) {
      let dirSign = 0;
      if (ret !== null && Number.isFinite(ret) && Math.abs(ret) > 1e-6) dirSign = ret > 0 ? 1 : -1;
      else if (obiBar !== null && Number.isFinite(obiBar)) dirSign = Math.max(-1, Math.min(1, obiBar));
      entry.signedFlowVnd += valVnd * dirSign;
    }

    if (b.spread_bps !== null && b.spread_bps !== undefined && Number.isFinite(Number(b.spread_bps))) {
      const sp = Number(b.spread_bps);
      entry.spreadSum += sp;
      entry.spreadCount += 1;
      if (sp > entry.maxSpread) entry.maxSpread = sp;
    }
  }

  const xLabels = Array.from(slotSet).sort((a, b) => a.localeCompare(b, 'en'));
  const ySymbols = [...symbols].reverse();

  const medianSlotValBySym = new Map<string, number>();
  const medianSpreadBySym = new Map<string, number>();
  for (const sym of ySymbols) {
    const vals: number[] = [];
    const sps: number[] = [];
    for (const slot of xLabels) {
      const e = agg.get(`${sym}|${slot}`);
      if (!e) continue;
      if (e.valVnd > 0) vals.push(e.valVnd);
      if (e.spreadCount > 0) sps.push(e.spreadSum / e.spreadCount);
    }
    const mv = sampleMedian(vals);
    if (mv && mv > 0) medianSlotValBySym.set(sym, mv);
    const ms = sampleMedian(sps);
    if (ms && ms > 0) medianSpreadBySym.set(sym, ms);
  }

  const unit =
    metric === 'flow' ? 'tỷ đ' : metric === 'intensity' ? '× trung vị' : '× spread TB';

  const z: (number | null)[][] = [];
  const customText: string[][] = [];

  for (const sym of ySymbols) {
    const zRow: (number | null)[] = [];
    const tRow: string[] = [];
    const medV = medianSlotValBySym.get(sym) ?? null;
    const medS = medianSpreadBySym.get(sym) ?? null;

    for (const slot of xLabels) {
      const e = agg.get(`${sym}|${slot}`);
      if (!e) {
        zRow.push(null);
        tRow.push(`${sym} · ${slot}: Không có dữ liệu`);
        continue;
      }
      const valB = e.valVnd / 1e9;
      const netB = e.signedFlowVnd / 1e9;
      const intensity = medV && medV > 0 ? e.valVnd / medV : null;
      const avgSpread = e.spreadCount > 0 ? e.spreadSum / e.spreadCount : null;
      const spreadRatio = medS && medS > 0 && avgSpread !== null ? avgSpread / medS : null;

      if (metric === 'flow') {
        const rounded = Math.round(valB * 100) / 100;
        zRow.push(rounded);
        tRow.push(
          `${sym} · ${slot}<br>GTGD: ${valB.toFixed(2)} tỷ đ<br>Dòng tiền ròng: ${netB >= 0 ? '+' : ''}${netB.toFixed(2)} tỷ đ`,
        );
      } else if (metric === 'intensity') {
        const rounded = intensity !== null ? Math.round(intensity * 100) / 100 : null;
        zRow.push(rounded);
        tRow.push(
          `${sym} · ${slot}<br>Cường độ: ${intensity !== null ? `${intensity.toFixed(2)}× trung vị` : '—'}<br>GTGD: ${valB.toFixed(2)} tỷ đ`,
        );
      } else {
        const rounded = spreadRatio !== null ? Math.round(spreadRatio * 100) / 100 : null;
        zRow.push(rounded);
        tRow.push(
          `${sym} · ${slot}<br>Giãn spread: ${spreadRatio !== null ? `${spreadRatio.toFixed(2)}×` : '—'} (TB ${avgSpread !== null ? `${avgSpread.toFixed(1)} bps` : '—'})<br>Cường độ KL: ${intensity !== null ? `${intensity.toFixed(2)}×` : '—'}`,
        );
      }
    }
    z.push(zRow);
    customText.push(tRow);
  }

  return { xLabels, ySymbols, z, customText, unit };
}
