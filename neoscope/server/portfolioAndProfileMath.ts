import { ladderWalk, tradingCostsBps } from '../src/server/analytics.js';
import type { BarRow, NeoScopeSettings, SnapRow } from '../src/server/types.js';

const BPS = 10_000.0;

export interface PortfolioHoldingInput {
  symbol: string;
  weightPct: number;
}

export interface PortfolioHoldingStressRow {
  symbol: string;
  group: 'large' | 'thin';
  weightPct: number;
  allocVnd: number;
  qty: number;
  mid: number | null;
  lhs: number | null;
  spreadBps: number | null;
  normalCoveragePct: number;
  stressedCoveragePct: number;
  normalImpactBps: number | null;
  stressedImpactBps: number | null;
  feeTaxBps: number;
  normalTotalBps: number | null;
  stressedTotalBps: number | null;
  normalCostVnd: number | null;
  stressedCostVnd: number | null;
  stressedCostSharePct: number;
  depthMultipleStress: number | null;
}

export interface PortfolioStressResult {
  totalVnd: number;
  side: 1 | -1;
  weightedLhs: number | null;
  normalCoveragePct: number;
  stressedCoveragePct: number;
  normalImpactBps: number;
  stressedImpactBps: number;
  feeTaxBps: number;
  normalTotalBps: number;
  stressedTotalBps: number;
  normalTotalVnd: number;
  stressedTotalVnd: number;
  stressDeltaVnd: number;
  maxCostShareSymbol: string | null;
  maxCostSharePct: number;
  concentrationWarning: string | null;
  rows: PortfolioHoldingStressRow[];
  disclaimer: string;
}

export function computePortfolioStress(params: {
  holdings: PortfolioHoldingInput[];
  totalVnd: number;
  side: 1 | -1;
  snaps: SnapRow[];
  barsLhs: Record<string, any>[];
  settings: NeoScopeSettings;
}): PortfolioStressResult {
  const { holdings, totalVnd, side, snaps, barsLhs, settings } = params;
  const cleanTotalVnd = Number.isFinite(totalVnd) && totalVnd > 0 ? totalVnd : 1_000_000_000;
  const positiveHoldings = holdings.filter((h) => h.symbol && Number.isFinite(h.weightPct) && h.weightPct > 0);
  const rawWeightSum = positiveHoldings.reduce((s, h) => s + h.weightPct, 0);

  const latestSnapBySym = new Map<string, SnapRow>();
  for (const s of snaps) {
    if (s.mid !== null && Number.isFinite(s.mid) && s.mid > 0) {
      latestSnapBySym.set(s.symbol, s);
    }
  }

  const latestLhsBySym = new Map<string, number>();
  for (const b of barsLhs) {
    if (b.symbol && b.lhs !== null && Number.isFinite(Number(b.lhs))) {
      latestLhsBySym.set(String(b.symbol), Number(b.lhs));
    }
  }

  const tcSample = tradingCostsBps(
    cleanTotalVnd,
    side,
    settings.execution.fee_rate,
    settings.execution.sell_tax_rate,
  );
  const feeTaxBps = tcSample.fee_bps + tcSample.tax_bps;

  const largeSet = new Set(settings.watchlist.large);
  const draftRows: PortfolioHoldingStressRow[] = positiveHoldings.map((h) => {
    const normWeight = rawWeightSum > 0 ? h.weightPct / rawWeightSum : 0;
    const allocVnd = cleanTotalVnd * normWeight;
    const snap = latestSnapBySym.get(h.symbol);
    const grp: 'large' | 'thin' = largeSet.has(h.symbol) ? 'large' : 'thin';
    const lhs = latestLhsBySym.get(h.symbol) ?? null;

    if (!snap || snap.mid === null || !Number.isFinite(snap.mid) || snap.mid <= 0) {
      return {
        symbol: h.symbol,
        group: grp,
        weightPct: normWeight * 100,
        allocVnd,
        qty: 0,
        mid: null,
        lhs,
        spreadBps: null,
        normalCoveragePct: 0,
        stressedCoveragePct: 0,
        normalImpactBps: null,
        stressedImpactBps: null,
        feeTaxBps,
        normalTotalBps: null,
        stressedTotalBps: null,
        normalCostVnd: null,
        stressedCostVnd: null,
        stressedCostSharePct: 0,
        depthMultipleStress: null,
      };
    }

    const mid = snap.mid;
    const qty = Math.max(Math.round(allocVnd / mid / 100) * 100, 100);
    const prices = side === -1 ? [snap.bid1, snap.bid2, snap.bid3] : [snap.ask1, snap.ask2, snap.ask3];
    const vols = side === -1 ? [snap.bidvol1, snap.bidvol2, snap.bidvol3] : [snap.askvol1, snap.askvol2, snap.askvol3];

    const spreadBps = snap.spread_bps !== null && Number.isFinite(snap.spread_bps) ? snap.spread_bps : 10;
    const hsBps = spreadBps / 2.0;

    // Normal scenario
    const ladNorm = ladderWalk(side, qty, prices, vols, mid);
    const wVisNorm = ladNorm.ok ? ladNorm.filled_vis / qty : 0;
    const normalImpactBps = ladNorm.ok
      ? wVisNorm * (ladNorm.cost_vis_bps ?? 0) + (1 - wVisNorm) * hsBps
      : hsBps;

    // Stressed scenario: spread x 2.0, visible depth x 0.5
    const stressPrices = prices.map((p) => (p !== null && Number.isFinite(p) ? mid + 2.0 * (p - mid) : null));
    const stressVols = vols.map((v) => (v !== null && Number.isFinite(v) ? Math.max(Math.floor(v * 0.5), 0) : null));
    const ladStress = ladderWalk(side, qty, stressPrices, stressVols, mid);
    const wVisStress = ladStress.ok ? ladStress.filled_vis / qty : 0;
    const stressedImpactBps = ladStress.ok
      ? wVisStress * (ladStress.cost_vis_bps ?? 0) + (1 - wVisStress) * (hsBps * 2.0)
      : hsBps * 2.0;

    const normalTotalBps = normalImpactBps + feeTaxBps;
    const stressedTotalBps = stressedImpactBps + feeTaxBps;
    const normalCostVnd = (normalTotalBps / BPS) * allocVnd;
    const stressedCostVnd = (stressedTotalBps / BPS) * allocVnd;

    const sideDepth = side === -1 ? snap.depth_bid_vnd : snap.depth_ask_vnd;
    const stressedSideDepth = sideDepth !== null && Number.isFinite(sideDepth) && sideDepth > 0 ? sideDepth * 0.5 : null;
    const depthMultipleStress = stressedSideDepth ? allocVnd / stressedSideDepth : null;

    return {
      symbol: h.symbol,
      group: grp,
      weightPct: normWeight * 100,
      allocVnd,
      qty,
      mid,
      lhs,
      spreadBps,
      normalCoveragePct: ladNorm.coverage * 100,
      stressedCoveragePct: ladStress.coverage * 100,
      normalImpactBps,
      stressedImpactBps,
      feeTaxBps,
      normalTotalBps,
      stressedTotalBps,
      normalCostVnd,
      stressedCostVnd,
      stressedCostSharePct: 0,
      depthMultipleStress,
    };
  });

  const validRows = draftRows.filter((r) => r.mid !== null);
  const validAllocSum = validRows.reduce((s, r) => s + r.allocVnd, 0);
  const lhsWeightSum = validRows.reduce((s, r) => s + (r.lhs !== null ? r.allocVnd : 0), 0);
  const weightedLhs =
    lhsWeightSum > 0
      ? validRows.reduce((s, r) => s + (r.lhs !== null ? r.lhs * r.allocVnd : 0), 0) / lhsWeightSum
      : null;

  const normalTotalVnd = validRows.reduce((s, r) => s + (r.normalCostVnd ?? 0), 0);
  const stressedTotalVnd = validRows.reduce((s, r) => s + (r.stressedCostVnd ?? 0), 0);
  const normalImpactBps =
    validAllocSum > 0
      ? validRows.reduce((s, r) => s + (r.normalImpactBps ?? 0) * r.allocVnd, 0) / validAllocSum
      : 0;
  const stressedImpactBps =
    validAllocSum > 0
      ? validRows.reduce((s, r) => s + (r.stressedImpactBps ?? 0) * r.allocVnd, 0) / validAllocSum
      : 0;
  const normalCoveragePct =
    validAllocSum > 0
      ? validRows.reduce((s, r) => s + r.normalCoveragePct * r.allocVnd, 0) / validAllocSum
      : 0;
  const stressedCoveragePct =
    validAllocSum > 0
      ? validRows.reduce((s, r) => s + r.stressedCoveragePct * r.allocVnd, 0) / validAllocSum
      : 0;

  let maxCostShareSymbol: string | null = null;
  let maxCostSharePct = 0;
  for (const r of draftRows) {
    if (stressedTotalVnd > 0 && r.stressedCostVnd !== null) {
      r.stressedCostSharePct = (r.stressedCostVnd / stressedTotalVnd) * 100;
      if (r.stressedCostSharePct > maxCostSharePct) {
        maxCostSharePct = r.stressedCostSharePct;
        maxCostShareSymbol = r.symbol;
      }
    }
  }

  let concentrationWarning: string | null = null;
  if (maxCostShareSymbol && maxCostSharePct >= 45) {
    concentrationWarning = `Rủi ro tập trung thanh khoản: riêng ${maxCostShareSymbol} chiếm ${maxCostSharePct.toFixed(1)}% tổng chi phí thoát lệnh khi stress (độ sâu giảm 50%, spread ×2).`;
  } else if (stressedCoveragePct < 60 && validRows.length > 0) {
    concentrationWarning = `Khi stress thanh khoản, toàn danh mục chỉ khớp ngay ${stressedCoveragePct.toFixed(0)}% trong 3 mức giá — cần chia nhỏ đợt hoặc kéo dài chân trời thoát lệnh.`;
  }

  return {
    totalVnd: cleanTotalVnd,
    side,
    weightedLhs,
    normalCoveragePct,
    stressedCoveragePct,
    normalImpactBps,
    stressedImpactBps,
    feeTaxBps,
    normalTotalBps: normalImpactBps + feeTaxBps,
    stressedTotalBps: stressedImpactBps + feeTaxBps,
    normalTotalVnd,
    stressedTotalVnd,
    stressDeltaVnd: stressedTotalVnd - normalTotalVnd,
    maxCostShareSymbol,
    maxCostSharePct,
    concentrationWarning,
    rows: draftRows,
    disclaimer:
      'Mô phỏng stress danh mục giả định spread ×2 và độ sâu 3 mức giảm 50% (không mô phỏng queue position hay phản hồi own-impact chéo nhịp). Chỉ phục vụ nghiên cứu học thuật — không phải khuyến nghị đầu tư.',
  };
}

function sampleMedian(arr: number[]): number | null {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[m - 1] + sorted[m]) / 2 : sorted[m];
}

const VN_OFFSET_MS = 7 * 3600 * 1000;

function getVnSlot15mFromSnap(s: Pick<SnapRow, 'ts' | 'ts_ms'>): { label: string; sortKey: number } | null {
  const ms = typeof s.ts_ms === 'number' && Number.isFinite(s.ts_ms) ? s.ts_ms : Date.parse(s.ts);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + VN_OFFSET_MS);
  const hh = d.getUTCHours();
  const mm = d.getUTCMinutes();
  const slotMin = Math.floor(mm / 15) * 15;
  const label = `${hh < 10 ? '0' : ''}${hh}:${slotMin < 10 ? '0' : ''}${slotMin}`;
  return { label, sortKey: hh * 60 + slotMin };
}

export interface IntradayUShapePoint {
  slot: string;
  sortKey: number;
  allQuotedSpreadBps: number | null;
  allEffectiveSpreadBps: number | null;
  allDepthB: number | null;
  allVolSharePct: number;
  largeQuotedSpreadBps: number | null;
  thinQuotedSpreadBps: number | null;
  largeDepthB: number | null;
  thinDepthB: number | null;
  largeVolSharePct: number;
  thinVolSharePct: number;
  nObs: number;
}

export function computeIntradayUShape(
  snaps: SnapRow[],
  settings: NeoScopeSettings,
  symbolSet?: Set<string>,
): IntradayUShapePoint[] {
  const largeSet = new Set(settings.watchlist.large);
  type BucketAcc = {
    sortKey: number;
    allSpread: number[];
    allEffSpread: number[];
    allDepth: number[];
    largeSpread: number[];
    thinSpread: number[];
    largeDepth: number[];
    thinDepth: number[];
    allVol: number;
    largeVol: number;
    thinVol: number;
    nObs: number;
  };
  const map = new Map<string, BucketAcc>();
  let totalAllVol = 0;
  let totalLargeVol = 0;
  let totalThinVol = 0;

  for (const s of snaps) {
    if (symbolSet && symbolSet.size > 0 && !symbolSet.has(s.symbol)) continue;
    if (s.session !== 'LO_AM' && s.session !== 'LO_PM') continue;
    const slot = getVnSlot15mFromSnap(s);
    if (!slot) continue;

    let acc = map.get(slot.label);
    if (!acc) {
      acc = {
        sortKey: slot.sortKey,
        allSpread: [],
        allEffSpread: [],
        allDepth: [],
        largeSpread: [],
        thinSpread: [],
        largeDepth: [],
        thinDepth: [],
        allVol: 0,
        largeVol: 0,
        thinVol: 0,
        nObs: 0,
      };
      map.set(slot.label, acc);
    }
    acc.nObs += 1;
    const isLarge = s.group ? s.group === 'large' : largeSet.has(s.symbol);

    if (s.spread_bps !== null && Number.isFinite(s.spread_bps) && s.spread_bps >= 0) {
      acc.allSpread.push(s.spread_bps);
      if (isLarge) acc.largeSpread.push(s.spread_bps);
      else acc.thinSpread.push(s.spread_bps);
    }

    if (
      s.last_price !== null &&
      s.mid !== null &&
      Number.isFinite(s.last_price) &&
      Number.isFinite(s.mid) &&
      s.mid > 0 &&
      s.last_price > 0
    ) {
      const eff = (2 * Math.abs(s.last_price - s.mid) / s.mid) * BPS;
      if (Number.isFinite(eff) && eff < 500) {
        acc.allEffSpread.push(eff);
      }
    }

    if (
      s.depth_bid_vnd !== null &&
      s.depth_ask_vnd !== null &&
      Number.isFinite(s.depth_bid_vnd) &&
      Number.isFinite(s.depth_ask_vnd)
    ) {
      const depthB = (s.depth_bid_vnd + s.depth_ask_vnd) / 2 / 1e9;
      acc.allDepth.push(depthB);
      if (isLarge) acc.largeDepth.push(depthB);
      else acc.thinDepth.push(depthB);
    }

    if (s.d_vol !== null && Number.isFinite(s.d_vol) && s.d_vol > 0) {
      acc.allVol += s.d_vol;
      totalAllVol += s.d_vol;
      if (isLarge) {
        acc.largeVol += s.d_vol;
        totalLargeVol += s.d_vol;
      } else {
        acc.thinVol += s.d_vol;
        totalThinVol += s.d_vol;
      }
    }
  }

  return Array.from(map.entries())
    .sort((a, b) => a[1].sortKey - b[1].sortKey)
    .map(([slot, acc]) => ({
      slot,
      sortKey: acc.sortKey,
      allQuotedSpreadBps: sampleMedian(acc.allSpread),
      allEffectiveSpreadBps: sampleMedian(acc.allEffSpread),
      allDepthB: sampleMedian(acc.allDepth),
      allVolSharePct: totalAllVol > 0 ? (acc.allVol / totalAllVol) * 100 : 0,
      largeQuotedSpreadBps: sampleMedian(acc.largeSpread),
      thinQuotedSpreadBps: sampleMedian(acc.thinSpread),
      largeDepthB: sampleMedian(acc.largeDepth),
      thinDepthB: sampleMedian(acc.thinDepth),
      largeVolSharePct: totalLargeVol > 0 ? (acc.largeVol / totalLargeVol) * 100 : 0,
      thinVolSharePct: totalThinVol > 0 ? (acc.thinVol / totalThinVol) * 100 : 0,
      nObs: acc.nObs,
    }));
}

export interface LiquidityBetaRow {
  symbol: string;
  group: 'large' | 'thin';
  depthBeta: number | null;
  depthR2: number | null;
  spreadBeta: number | null;
  spreadR2: number | null;
  nObs: number;
  regimeNote: string;
}

function olsSlopeAndR2(xs: number[], ys: number[]): { beta: number | null; r2: number | null } {
  if (xs.length < 10 || xs.length !== ys.length) return { beta: null, r2: null };
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  if (sxx <= 1e-12) return { beta: null, r2: null };
  const beta = sxy / sxx;
  const r2 = syy > 1e-12 ? (sxy * sxy) / (sxx * syy) : 0;
  return { beta, r2 };
}

/**
 * Chordia–Roll–Subrahmanyam (2000) liquidity commonality regression:
 * regress delta log(depth_{i,t}) and delta spread_{i,t} on cross-sectional median changes.
 */
export function computeLiquidityBeta(
  bars: BarRow[],
  settings: NeoScopeSettings,
): LiquidityBetaRow[] {
  const largeSet = new Set(settings.watchlist.large);
  const bySymSession = new Map<string, BarRow[]>();
  for (const b of bars) {
    const k = `${b.symbol}|${b.session_date}`;
    const arr = bySymSession.get(k) || [];
    arr.push(b);
    bySymSession.set(k, arr);
  }

  interface BarDiff {
    symbol: string;
    group: 'large' | 'thin';
    tsKey: string;
    dLogDepth: number | null;
    dSpread: number | null;
  }
  const diffs: BarDiff[] = [];
  const depthMktByTs = new Map<string, number[]>();
  const spreadMktByTs = new Map<string, number[]>();

  for (const arr of bySymSession.values()) {
    arr.sort((a, b) => a.bar_ts_ms - b.bar_ts_ms);
    for (let i = 1; i < arr.length; i++) {
      const prev = arr[i - 1];
      const cur = arr[i];
      if (cur.bar_ts_ms - prev.bar_ts_ms > 180_000) continue; // skip lunch break jump
      const d1 = prev.depth_bid_vnd;
      const d2 = cur.depth_bid_vnd;
      const dLogDepth =
        d1 !== null && d2 !== null && Number.isFinite(d1) && Number.isFinite(d2) && d1 > 0 && d2 > 0
          ? Math.log(d2) - Math.log(d1)
          : null;
      const sp1 = prev.spread_bps;
      const sp2 = cur.spread_bps;
      const dSpread =
        sp1 !== null && sp2 !== null && Number.isFinite(sp1) && Number.isFinite(sp2)
          ? sp2 - sp1
          : null;
      const tsKey = `${cur.session_date}|${cur.bar_ts}`;
      const grp: 'large' | 'thin' = largeSet.has(cur.symbol) ? 'large' : 'thin';
      diffs.push({ symbol: cur.symbol, group: grp, tsKey, dLogDepth, dSpread });
      if (dLogDepth !== null) {
        const list = depthMktByTs.get(tsKey) || [];
        list.push(dLogDepth);
        depthMktByTs.set(tsKey, list);
      }
      if (dSpread !== null) {
        const list = spreadMktByTs.get(tsKey) || [];
        list.push(dSpread);
        spreadMktByTs.set(tsKey, list);
      }
    }
  }

  const mktDepthMed = new Map<string, number>();
  for (const [k, vals] of depthMktByTs.entries()) {
    if (vals.length >= 4) {
      const m = sampleMedian(vals);
      if (m !== null) mktDepthMed.set(k, m);
    }
  }
  const mktSpreadMed = new Map<string, number>();
  for (const [k, vals] of spreadMktByTs.entries()) {
    if (vals.length >= 4) {
      const m = sampleMedian(vals);
      if (m !== null) mktSpreadMed.set(k, m);
    }
  }

  const bySym = new Map<
    string,
    { group: 'large' | 'thin'; xd: number[]; yd: number[]; xs: number[]; ys: number[] }
  >();
  for (const d of diffs) {
    let acc = bySym.get(d.symbol);
    if (!acc) {
      acc = { group: d.group, xd: [], yd: [], xs: [], ys: [] };
      bySym.set(d.symbol, acc);
    }
    const md = mktDepthMed.get(d.tsKey);
    if (d.dLogDepth !== null && md !== undefined) {
      acc.xd.push(md);
      acc.yd.push(d.dLogDepth);
    }
    const ms = mktSpreadMed.get(d.tsKey);
    if (d.dSpread !== null && ms !== undefined) {
      acc.xs.push(ms);
      acc.ys.push(d.dSpread);
    }
  }

  return Array.from(bySym.entries())
    .map(([symbol, acc]) => {
      const dRes = olsSlopeAndR2(acc.xd, acc.yd);
      const sRes = olsSlopeAndR2(acc.xs, acc.ys);
      const b = dRes.beta;
      const regimeNote =
        b === null
          ? 'Chưa đủ bar để ước lượng'
          : b >= 1.15
            ? 'Nhạy thanh khoản hệ thống cao'
            : b >= 0.75
              ? 'Đồng biến vừa theo thị trường'
              : 'Ít nhạy hệ thống / phòng thủ';
      return {
        symbol,
        group: acc.group,
        depthBeta: dRes.beta,
        depthR2: dRes.r2,
        spreadBeta: sRes.beta,
        spreadR2: sRes.r2,
        nObs: Math.max(acc.xd.length, acc.xs.length),
        regimeNote,
      };
    })
    .sort((a, b) => (b.depthBeta ?? -99) - (a.depthBeta ?? -99));
}

export interface CalibrationPoint {
  nominalPct: number;
  zValue: number;
  n: number;
  covered: number;
  empiricalPct: number;
  wilsonLoPct: number;
  wilsonHiPct: number;
  calibrationGapPct: number;
  meanWidthBps: number;
}

function wilsonBounds(k: number, n: number, z = 1.96): [number, number] {
  if (n <= 0) return [0, 0];
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

const CALIBRATION_LEVELS: { nominalPct: number; zValue: number }[] = [
  { nominalPct: 50, zValue: 0.6745 },
  { nominalPct: 80, zValue: 1.2816 },
  { nominalPct: 90, zValue: 1.6449 },
  { nominalPct: 95, zValue: 1.96 },
];

export function computeCalibrationCurve(
  predictions: Record<string, any>[],
  regime: 'beyond_book' | 'all' = 'beyond_book',
): CalibrationPoint[] {
  const rows = predictions.filter((p) => {
    if (p.model !== 'full') return false;
    if (!Number.isFinite(Number(p.e_is_bps)) || !Number.isFinite(Number(p.realized_is_bps))) {
      return false;
    }
    if (regime === 'beyond_book' && Number(p.coverage ?? 1) >= 1.0) return false;
    return true;
  });
  if (!rows.length) return [];

  return CALIBRATION_LEVELS.map(({ nominalPct, zValue }) => {
    let covered = 0;
    let widthSum = 0;
    for (const r of rows) {
      const e = Number(r.e_is_bps);
      const realized = Number(r.realized_is_bps);
      let sig = Number(r.sigma_is_bps);
      if (!Number.isFinite(sig) || sig < 0) {
        const lo = Number(r.lo_bps ?? e);
        const hi = Number(r.hi_bps ?? e);
        sig = Math.max((hi - lo) / (2 * 1.6449), 0);
      }
      const loBound = e - zValue * sig;
      const hiBound = e + zValue * sig;
      if (realized >= loBound && realized <= hiBound) covered += 1;
      widthSum += 2 * zValue * sig;
    }
    const [wLo, wHi] = wilsonBounds(covered, rows.length);
    const empiricalPct = (covered / rows.length) * 100;
    return {
      nominalPct,
      zValue,
      n: rows.length,
      covered,
      empiricalPct,
      wilsonLoPct: wLo * 100,
      wilsonHiPct: wHi * 100,
      calibrationGapPct: empiricalPct - nominalPct,
      meanWidthBps: widthSum / rows.length,
    };
  });
}

// =========================================================================
// Alert Threshold Lab (Exact port of src/neoscope/analytics/alerts.py + validation.py)
// =========================================================================

type AlertTransform = 'raw' | 'log' | 'abs';
type AlertGate = 'z+pct' | 'pct' | 'tail';

interface AlertMetricSpec {
  type: string;
  col: keyof SnapRow;
  dir: 'high' | 'low';
  tf: AlertTransform;
  gate: AlertGate;
  persist: number | null;
  poolSymbol: boolean;
}

const ALERT_SPECS: AlertMetricSpec[] = [
  { type: 'SPREAD_WIDEN', col: 'spread_bps', dir: 'high', tf: 'raw', gate: 'z+pct', persist: null, poolSymbol: false },
  { type: 'DEPTH_EVAPORATION', col: 'depth_bid_vnd', dir: 'low', tf: 'log', gate: 'z+pct', persist: null, poolSymbol: false },
  { type: 'OBI_EXTREME', col: 'obi', dir: 'high', tf: 'abs', gate: 'pct', persist: null, poolSymbol: false },
  { type: 'TRADE_BURST', col: 'd_vol', dir: 'high', tf: 'raw', gate: 'z+pct', persist: null, poolSymbol: false },
  { type: 'FOREIGN_BURST', col: 'd_f_net_val', dir: 'high', tf: 'abs', gate: 'tail', persist: 1, poolSymbol: true },
];

const ALERT_EVENT_MAP: Record<string, Set<string>> = {
  SPREAD_WIDEN: new Set(['DEPTH_EVAPORATION', 'FLASH_MOVE']),
  DEPTH_EVAPORATION: new Set(['DEPTH_EVAPORATION']),
  OBI_EXTREME: new Set(['OBI_SHOCK']),
  TRADE_BURST: new Set(['TRADE_BURST', 'FLASH_MOVE']),
  FOREIGN_BURST: new Set(['FOREIGN_BURST']),
};

export interface AlertLabParams {
  zThreshold: number;
  pctThreshold: number;
  persistenceN: number;
  cooldownS: number;
  foreignTailMult?: number;
  warmupSessions?: number;
  toleranceS?: number;
}

export interface TruthEventInput {
  session_date: string;
  type: string;
  symbol: string;
  start_ts: string;
  end_ts: string;
}

export interface AlertLabTypeSummary {
  alertType: string;
  nAlerts: number;
  tp: number;
  precision: number | null;
  nEventsMapped: number;
  eventsDetected: number;
  recall: number | null;
  f1: number | null;
}

export interface AlertLabResult {
  params: Required<AlertLabParams>;
  totalAlerts: number;
  p1Count: number;
  p2Count: number;
  p3Count: number;
  overallPrecision: number | null;
  overallRecall: number | null;
  overallF1: number | null;
  byType: AlertLabTypeSummary[];
  sweep: {
    zThreshold: number;
    totalAlerts: number;
    precision: number | null;
    recall: number | null;
    f1: number | null;
  }[];
  protocolSpec: Record<string, unknown>;
}

function transformAlertVal(raw: number, tf: AlertTransform): number {
  if (tf === 'abs') return Math.abs(raw);
  if (tf === 'log') return Math.log1p(Math.max(0, raw));
  return raw;
}

function quantileSorted(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

function searchSortedRight(sorted: number[], val: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] <= val) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function summarizeSortedBaseline(sorted: number[]) {
  const n = sorted.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += sorted[i];
  const mu = sum / n;
  let sq = 0;
  for (let i = 0; i < n; i++) {
    const d = sorted[i] - mu;
    sq += d * d;
  }
  const sd = n > 1 ? Math.sqrt(sq / (n - 1)) : 0;
  const spreadIqr = quantileSorted(sorted, 0.95) - quantileSorted(sorted, 0.05);
  const sigma = Math.max(sd, 0.05 * spreadIqr, 1e-9);
  const nz = sorted.filter((v) => v > 0);
  const p99 = nz.length >= 30 ? quantileSorted(nz, 0.99) : quantileSorted(sorted, 0.99);
  return { sorted, mu, sigma, p99, n };
}

interface ScoredSeries {
  session_date: string;
  symbol: string;
  spec: AlertMetricSpec;
  rows: (
    | null
    | {
        ts_ms: number;
        z: number;
        pct: number;
        nonDegenerate: boolean;
        tailHit: boolean;
        tailPct: number;
      }
  )[];
}

function buildScoredAlertSeries(
  snapsBySession: { session: string; snaps: SnapRow[] }[],
  params: Required<AlertLabParams>,
  typesFilter?: Set<string>,
): ScoredSeries[] {
  const { foreignTailMult, warmupSessions } = params;
  const specs = typesFilter ? ALERT_SPECS.filter((s) => typesFilter.has(s.type)) : ALERT_SPECS;

  const hist = new Map<string, Map<string, number[]>>();
  for (const sp of specs) hist.set(sp.type, new Map());

  const seriesList: ScoredSeries[] = [];

  for (let dayIdx = 0; dayIdx < snapsBySession.length; dayIdx++) {
    const { session, snaps } = snapsBySession[dayIdx];
    const snapsBySym = new Map<string, SnapRow[]>();
    for (const s of snaps) {
      let arr = snapsBySym.get(s.symbol);
      if (!arr) {
        arr = [];
        snapsBySym.set(s.symbol, arr);
      }
      arr.push(s);
    }

    if (dayIdx >= warmupSessions) {
      for (const spec of specs) {
        const typeHist = hist.get(spec.type)!;
        const baseline = new Map<string, ReturnType<typeof summarizeSortedBaseline>>();
        for (const [key, vals] of typeHist.entries()) {
          if (vals.length < 30) continue;
          baseline.set(key, summarizeSortedBaseline([...vals].sort((a, b) => a - b)));
        }
        if (!baseline.size) continue;

        for (const [sym, rows] of snapsBySym.entries()) {
          const scoredRows: ScoredSeries['rows'] = new Array(rows.length);
          for (let j = 0; j < rows.length; j++) {
            const r = rows[j];
            const bKey = spec.poolSymbol ? `${sym}|ALL` : `${sym}|${r.bucket}`;
            const b = baseline.get(bKey);
            const rawVal = r[spec.col];
            if (!b || typeof rawVal !== 'number' || !Number.isFinite(rawVal)) {
              scoredRows[j] = null;
              continue;
            }
            const v = transformAlertVal(rawVal, spec.tf);
            const z = (v - b.mu) / b.sigma;
            const pct = searchSortedRight(b.sorted, v) / b.n;
            const nonDegenerate = b.sorted[b.n - 1] > b.sorted[0];
            const tailHit =
              b.p99 > 0 &&
              (spec.dir === 'high' ? v > 0 && v >= foreignTailMult * b.p99 : v < 0 && v <= -foreignTailMult * b.p99);
            const tailPct = spec.dir === 'high' ? pct : 1 - pct;
            scoredRows[j] = { ts_ms: r.ts_ms, z, pct, nonDegenerate, tailHit, tailPct };
          }
          seriesList.push({ session_date: session, symbol: sym, spec, rows: scoredRows });
        }
      }
    }

    // Add current day after evaluation (strictly expanding, no look-ahead)
    for (const spec of specs) {
      const typeHist = hist.get(spec.type)!;
      for (const s of snaps) {
        const rawVal = s[spec.col];
        if (typeof rawVal !== 'number' || !Number.isFinite(rawVal)) continue;
        const bKey = spec.poolSymbol ? `${s.symbol}|ALL` : `${s.symbol}|${s.bucket}`;
        let arr = typeHist.get(bKey);
        if (!arr) {
          arr = [];
          typeHist.set(bKey, arr);
        }
        arr.push(transformAlertVal(rawVal, spec.tf));
      }
    }
  }

  return seriesList;
}

function evalScoredSeries(
  seriesList: ScoredSeries[],
  truthParsed: { idx: number; session_date: string; symbol: string; type: string; startMs: number; endMs: number }[],
  params: Required<AlertLabParams>,
  specs: AlertMetricSpec[],
) {
  const { zThreshold, pctThreshold, persistenceN, cooldownS } = params;
  const cooldownMs = cooldownS * 1000;

  interface FiredAlert {
    session_date: string;
    symbol: string;
    ts_ms: number;
    type: string;
    priority: 'P1' | 'P2' | 'P3';
  }
  const fired: FiredAlert[] = [];

  for (const s of seriesList) {
    const { spec, rows, session_date, symbol } = s;
    const persistReq = spec.persist !== null ? spec.persist : persistenceN;
    let streak = 0;
    let lastFireMs = -Infinity;

    for (let j = 0; j < rows.length; j++) {
      const pt = rows[j];
      if (!pt) {
        streak = 0;
        continue;
      }
      let ok = false;
      if (spec.gate === 'pct') {
        ok =
          pt.nonDegenerate &&
          (spec.dir === 'high' ? pt.pct >= pctThreshold : pt.pct <= 1 - pctThreshold);
      } else if (spec.gate === 'tail') {
        ok = pt.tailHit;
      } else {
        ok =
          spec.dir === 'high'
            ? pt.z >= zThreshold && pt.pct >= pctThreshold
            : pt.z <= -zThreshold && pt.pct <= 1 - pctThreshold;
      }
      if (!ok) {
        streak = 0;
        continue;
      }
      streak += 1;
      if (streak < persistReq) continue;
      if (pt.ts_ms - lastFireMs < cooldownMs) continue;

      lastFireMs = pt.ts_ms;
      streak = 0;
      const priority: 'P1' | 'P2' | 'P3' = pt.tailPct >= 0.999 ? 'P1' : pt.tailPct >= 0.995 ? 'P2' : 'P3';
      fired.push({ session_date, symbol, ts_ms: pt.ts_ms, type: spec.type, priority });
    }
  }

  const matchedEvents = new Set<number>();
  const tpByType = new Map<string, number>();
  const countByType = new Map<string, number>();
  let totalTp = 0;

  for (const a of fired) {
    countByType.set(a.type, (countByType.get(a.type) || 0) + 1);
    const evTypes = ALERT_EVENT_MAP[a.type];
    let hit = false;
    if (evTypes && truthParsed.length > 0) {
      for (const ev of truthParsed) {
        if (
          ev.symbol === a.symbol &&
          ev.session_date === a.session_date &&
          evTypes.has(ev.type) &&
          a.ts_ms >= ev.startMs &&
          a.ts_ms <= ev.endMs
        ) {
          hit = true;
          matchedEvents.add(ev.idx);
        }
      }
    }
    if (hit) {
      totalTp += 1;
      tpByType.set(a.type, (tpByType.get(a.type) || 0) + 1);
    }
  }

  const byType: AlertLabTypeSummary[] = specs.map((sp) => {
    const nAlerts = countByType.get(sp.type) || 0;
    const tp = tpByType.get(sp.type) || 0;
    const evTypes = ALERT_EVENT_MAP[sp.type] || new Set<string>();
    const pool = truthParsed.filter((e) => evTypes.has(e.type));
    const detected = pool.filter((e) => matchedEvents.has(e.idx)).length;
    const precision = nAlerts > 0 && truthParsed.length > 0 ? tp / nAlerts : null;
    const recall = pool.length > 0 ? detected / pool.length : null;
    const f1 =
      precision !== null && recall !== null && precision + recall > 0
        ? (2 * precision * recall) / (precision + recall)
        : null;
    return {
      alertType: sp.type,
      nAlerts,
      tp,
      precision,
      nEventsMapped: pool.length,
      eventsDetected: detected,
      recall,
      f1,
    };
  });

  const overallPrecision = fired.length > 0 && truthParsed.length > 0 ? totalTp / fired.length : null;
  const overallRecall = truthParsed.length > 0 ? matchedEvents.size / truthParsed.length : null;
  const overallF1 =
    overallPrecision !== null && overallRecall !== null && overallPrecision + overallRecall > 0
      ? (2 * overallPrecision * overallRecall) / (overallPrecision + overallRecall)
      : null;

  return {
    totalAlerts: fired.length,
    p1Count: fired.filter((a) => a.priority === 'P1').length,
    p2Count: fired.filter((a) => a.priority === 'P2').length,
    p3Count: fired.filter((a) => a.priority === 'P3').length,
    overallPrecision,
    overallRecall,
    overallF1,
    byType,
  };
}

export function evaluateAlertThresholdLab(
  snapsBySession: { session: string; snaps: SnapRow[] }[],
  truthEvents: TruthEventInput[],
  rawParams: Partial<AlertLabParams> = {},
): AlertLabResult {
  const params: Required<AlertLabParams> = {
    zThreshold: Math.min(5, Math.max(1.5, Number(rawParams.zThreshold ?? 3.0))),
    pctThreshold: Math.min(0.999, Math.max(0.9, Number(rawParams.pctThreshold ?? 0.99))),
    persistenceN: Math.min(10, Math.max(1, Math.round(Number(rawParams.persistenceN ?? 3)))),
    cooldownS: Math.min(300, Math.max(10, Math.round(Number(rawParams.cooldownS ?? 60)))),
    foreignTailMult: Number(rawParams.foreignTailMult ?? 2.0),
    warmupSessions: Math.max(1, Math.round(Number(rawParams.warmupSessions ?? 1))),
    toleranceS: Number(rawParams.toleranceS ?? 30),
  };

  const truthParsed = truthEvents.map((ev, idx) => ({
    idx,
    session_date: ev.session_date,
    symbol: ev.symbol,
    type: ev.type,
    startMs: new Date(ev.start_ts).getTime() - params.toleranceS * 1000,
    endMs: new Date(ev.end_ts).getTime() + params.toleranceS * 1000,
  }));

  const scoredSeries = buildScoredAlertSeries(snapsBySession, params);
  const mainRes = evalScoredSeries(scoredSeries, truthParsed, params, ALERT_SPECS);
  const zGrid = [2.0, 2.5, 3.0, 3.5, 4.0];
  const sweep = zGrid.map((zVal) => {
    const r =
      Math.abs(zVal - params.zThreshold) < 1e-6
        ? mainRes
        : evalScoredSeries(scoredSeries, truthParsed, { ...params, zThreshold: zVal }, ALERT_SPECS);
    return {
      zThreshold: zVal,
      totalAlerts: r.totalAlerts,
      precision: r.overallPrecision,
      recall: r.overallRecall,
      f1: r.overallF1,
    };
  });

  return {
    params,
    ...mainRes,
    sweep,
    protocolSpec: {
      schema_version: 'neoscope.alert_protocol.v1',
      generated_at_vn: new Date(Date.now() + 7 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' (UTC+7)',
      alerts: {
        bucket_min: 15,
        z_threshold: params.zThreshold,
        pct_threshold: params.pctThreshold,
        persistence_n: params.persistenceN,
        cooldown_s: params.cooldownS,
        foreign_tail_mult: params.foreignTailMult,
        warmup_sessions: params.warmupSessions,
      },
      observed_metrics: {
        total_alerts: mainRes.totalAlerts,
        p1: mainRes.p1Count,
        p2: mainRes.p2Count,
        p3: mainRes.p3Count,
        precision: mainRes.overallPrecision,
        recall: mainRes.overallRecall,
        f1: mainRes.overallF1,
      },
    },
  };
}
