import type { BarRow, NeoScopeSettings, SnapRow } from './types.js';
import { groupOf } from './store.js';

const BPS = 10_000.0;

export interface LadderFill {
  price: number;
  qty: number;
}

export interface LadderResult {
  filled_vis: number;
  qty_res: number;
  vwap_vis: number | null;
  cost_vis_bps: number | null;
  coverage: number;
  fills: LadderFill[];
  ok: boolean;
}

export interface CostEstimate {
  e_is_bps: number;
  sigma_is_bps: number;
  lo_bps: number;
  hi_bps: number;
  tau_s: number;
  w_vis: number;
  w_res: number;
  w_unf: number;
  cost_vis_bps: number;
  coverage: number;
  flags: string[];
  detail: {
    mu_bps_per_s: number;
    hs_bps: number;
    tau_eff: number;
    v_rate: number | null;
    sigma_bps_per_s: number;
  };
}

export function searchTsRight(arr: SnapRow[], tsMs: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid].ts_ms <= tsMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function sampleStd(values: number[]): number | null {
  const finite = values.filter((x) => Number.isFinite(x));
  if (finite.length < 2) return null;
  const mean = finite.reduce((a, b) => a + b, 0) / finite.length;
  let sumSq = 0;
  for (const v of finite) sumSq += (v - mean) ** 2;
  return Math.sqrt(sumSq / (finite.length - 1));
}

export function ladderWalk(
  side: 1 | -1,
  qty: number,
  prices: (number | null)[],
  vols: (number | null)[],
  mid: number | null,
): LadderResult {
  if (qty <= 0 || mid === null || !Number.isFinite(mid) || mid <= 0) {
    return { filled_vis: 0, qty_res: qty, vwap_vis: null, cost_vis_bps: null, coverage: 0, fills: [], ok: false };
  }
  let remaining = qty;
  let notional = 0;
  let filled = 0;
  const fills: LadderFill[] = [];
  for (let i = 0; i < Math.min(prices.length, vols.length); i++) {
    if (remaining <= 0) break;
    const p = prices[i];
    const v = vols[i];
    if (p === null || v === null || !Number.isFinite(p) || !Number.isFinite(v) || v <= 0) {
      continue;
    }
    const take = Math.min(remaining, v);
    notional += take * p;
    filled += take;
    remaining -= take;
    fills.push({ price: p, qty: take });
  }
  if (filled <= 0) {
    return { filled_vis: 0, qty_res: qty, vwap_vis: null, cost_vis_bps: null, coverage: 0, fills: [], ok: false };
  }
  const vwap = notional / filled;
  const cost_bps = (side * (vwap - mid) / mid) * BPS;
  return {
    filled_vis: filled,
    qty_res: remaining,
    vwap_vis: vwap,
    cost_vis_bps: cost_bps,
    coverage: filled / qty,
    fills,
    ok: true,
  };
}

export function expectedIsBps(params: {
  side: 1 | -1;
  qty: number;
  ladder: LadderResult;
  hs_bps: number;
  obi_now: number;
  kappa_bps_per_s: number;
  v_rate_shares_per_s: number | null;
  sigma_bps_per_s: number | null;
  rho: number;
  horizon_s: number;
  y_risk: number;
  pi_z: number;
}): CostEstimate {
  const {
    side, qty, ladder, hs_bps, obi_now, kappa_bps_per_s,
    v_rate_shares_per_s, sigma_bps_per_s, rho, horizon_s, y_risk, pi_z,
  } = params;

  const flags: string[] = [];
  if (!ladder.ok || ladder.cost_vis_bps === null) {
    return {
      e_is_bps: NaN,
      sigma_is_bps: NaN,
      lo_bps: NaN,
      hi_bps: NaN,
      tau_s: NaN,
      w_vis: 0,
      w_res: 0,
      w_unf: 1,
      cost_vis_bps: NaN,
      coverage: 0,
      flags: ['NO_BOOK'],
      detail: { mu_bps_per_s: 0, hs_bps: 0, tau_eff: 0, v_rate: null, sigma_bps_per_s: 0 },
    };
  }

  const w_vis = ladder.filled_vis / qty;
  const q_res = ladder.qty_res;
  const mu = kappa_bps_per_s * (Number.isFinite(obi_now) ? obi_now : 0);

  if (q_res <= 0) {
    const e = ladder.cost_vis_bps;
    return {
      e_is_bps: e,
      sigma_is_bps: 0,
      lo_bps: e,
      hi_bps: e,
      tau_s: 0,
      w_vis: 1,
      w_res: 0,
      w_unf: 0,
      cost_vis_bps: ladder.cost_vis_bps,
      coverage: 1,
      flags: [],
      detail: {
        mu_bps_per_s: mu,
        hs_bps,
        tau_eff: 0,
        v_rate: v_rate_shares_per_s,
        sigma_bps_per_s: sigma_bps_per_s && Number.isFinite(sigma_bps_per_s) ? sigma_bps_per_s : 0,
      },
    };
  }

  let tau: number;
  let w_res: number;
  let w_unf: number;
  if (v_rate_shares_per_s === null || !Number.isFinite(v_rate_shares_per_s) || v_rate_shares_per_s <= 0 || rho <= 0) {
    tau = horizon_s;
    w_res = 0;
    w_unf = 1;
    flags.push('NO_LIQUIDITY_PROFILE');
  } else {
    const tau_full = q_res / (rho * v_rate_shares_per_s);
    if (tau_full <= horizon_s) {
      tau = tau_full;
      w_res = q_res / qty;
      w_unf = 0;
    } else {
      const filled_res = rho * v_rate_shares_per_s * horizon_s;
      tau = horizon_s;
      w_res = filled_res / qty;
      w_unf = q_res / qty - w_res;
      flags.push('HORIZON_CAPPED');
    }
  }

  const hs = Number.isFinite(hs_bps) ? hs_bps : 0;
  const e_res = hs + side * mu * tau / 2.0;
  const e_unf = side * mu * horizon_s;
  const e = w_vis * ladder.cost_vis_bps + w_res * e_res + w_unf * e_unf;

  let sigOk = sigma_bps_per_s !== null && Number.isFinite(sigma_bps_per_s) && sigma_bps_per_s > 0;
  const sig = sigOk ? Number(sigma_bps_per_s) : 0;
  const tau_eff = (w_res ** 2) * tau / 3.0 + (w_unf ** 2) * horizon_s;
  let sigma = y_risk * sig * Math.sqrt(Math.max(tau_eff, 0));
  if (!Number.isFinite(sigma)) {
    sigma = 0;
    sigOk = false;
  }
  if (!sigOk && tau_eff > 0) {
    flags.push('NO_VOL_ESTIMATE');
  }

  return {
    e_is_bps: e,
    sigma_is_bps: sigma,
    lo_bps: e - pi_z * sigma,
    hi_bps: e + pi_z * sigma,
    tau_s: tau,
    w_vis,
    w_res,
    w_unf,
    cost_vis_bps: ladder.cost_vis_bps,
    coverage: ladder.coverage,
    flags,
    detail: {
      mu_bps_per_s: mu,
      hs_bps: hs,
      tau_eff,
      v_rate: v_rate_shares_per_s,
      sigma_bps_per_s: sig,
    },
  };
}

export function tradingCostsBps(notionalVnd: number, side: 1 | -1, feeRate: number, sellTaxRate: number) {
  const fee_bps = feeRate * BPS;
  const tax_bps = side === -1 ? sellTaxRate * BPS : 0;
  return {
    fee_bps,
    tax_bps,
    fee_vnd: notionalVnd * feeRate,
    tax_vnd: side === -1 ? notionalVnd * sellTaxRate : 0,
  };
}

export function buildVolumeProfile(barsTrain: BarRow[]) {
  const bySymBucket = new Map<string, { sum: number; count: number }>();
  const byGrpBucket = new Map<string, { sum: number; count: number }>();
  const bySym = new Map<string, { sum: number; count: number }>();

  for (const b of barsTrain) {
    if (b.d_vol === null || !Number.isFinite(b.d_vol)) continue;
    const k1 = `${b.symbol}|${b.bucket}`;
    const c1 = bySymBucket.get(k1) || { sum: 0, count: 0 };
    c1.sum += b.d_vol;
    c1.count += 1;
    bySymBucket.set(k1, c1);

    const k2 = `${b.group}|${b.bucket}`;
    const c2 = byGrpBucket.get(k2) || { sum: 0, count: 0 };
    c2.sum += b.d_vol;
    c2.count += 1;
    byGrpBucket.set(k2, c2);

    const c3 = bySym.get(b.symbol) || { sum: 0, count: 0 };
    c3.sum += b.d_vol;
    c3.count += 1;
    bySym.set(b.symbol, c3);
  }

  return {
    lookup(symbol: string, group: string, bucket: number): number | null {
      const a = bySymBucket.get(`${symbol}|${bucket}`);
      if (a && a.count > 0) return a.sum / a.count / 60.0;
      const b = byGrpBucket.get(`${group}|${bucket}`);
      if (b && b.count > 0) return b.sum / b.count / 60.0;
      const c = bySym.get(symbol);
      if (c && c.count > 0) return c.sum / c.count / 60.0;
      return null;
    },
  };
}

export function buildSigmaFallback(barsTrain: BarRow[]) {
  const buckets = new Map<string, number[]>();
  for (const b of barsTrain) {
    if (b.ret_bps === null || !Number.isFinite(b.ret_bps)) continue;
    const k = `${b.group}|${b.bucket}`;
    const arr = buckets.get(k) || [];
    arr.push(b.ret_bps);
    buckets.set(k, arr);
  }
  const map = new Map<string, number>();
  for (const [k, vals] of buckets.entries()) {
    const sd = sampleStd(vals);
    if (sd !== null && Number.isFinite(sd)) {
      map.set(k, sd / Math.sqrt(60.0));
    }
  }
  return map;
}

export function foldParamsFor(
  foldParams: Record<string, any>[],
  sessionDate: string,
  testDates: string[],
): { rows: Record<string, any>[]; note: string } {
  if (!foldParams.length) {
    return { rows: [], note: 'Chưa có tham số hiệu chỉnh — chạy `neoscope validate`.' };
  }
  const folds = Array.from(new Set(foldParams.map((r) => Number(r.fold)))).sort((a, b) => a - b);
  let k: number;
  let note: string;
  const idx = testDates.indexOf(sessionDate);
  if (idx >= 0 && idx < folds.length) {
    k = folds[idx];
    note = `Tham số fold ${k}: huấn luyện trên các phiên TRƯỚC ${sessionDate} (ngoài mẫu đúng nghĩa).`;
  } else if (foldParams.some((r) => r.test_date === sessionDate)) {
    k = Number(foldParams.find((r) => r.test_date === sessionDate)!.fold);
    note = `Tham số fold ${k} (phiên này là ngày test của fold đó).`;
  } else {
    k = folds[0];
    note = `⚠️ Phiên ${sessionDate} nằm trong tập huấn luyện của mọi fold — dùng tham số fold ${k} sớm nhất chỉ để MINH HỌA, không phải kết quả ngoài mẫu.`;
  }
  return {
    rows: foldParams.filter((r) => Number(r.fold) === k),
    note,
  };
}

export function computeStaticFeatures(
  ts0Ms: number,
  side: 1 | -1,
  qtyShares: number,
  snapsSym: SnapRow[],
  barsSym: BarRow[],
  settings: NeoScopeSettings,
) {
  const idx = searchTsRight(snapsSym, ts0Ms) - 1;
  if (idx < 0) return null;
  const arr = snapsSym[idx];
  if (arr.mid === null || !Number.isFinite(arr.mid) || arr.mid <= 0) return null;
  const mid = arr.mid;

  const prices = side === -1 ? [arr.bid1, arr.bid2, arr.bid3] : [arr.ask1, arr.ask2, arr.ask3];
  const vols = side === -1 ? [arr.bidvol1, arr.bidvol2, arr.bidvol3] : [arr.askvol1, arr.askvol2, arr.askvol3];
  const lad = ladderWalk(side, qtyShares, prices, vols, mid);
  if (!lad.ok) return null;

  const hs_bps = arr.spread_bps !== null && Number.isFinite(arr.spread_bps) ? arr.spread_bps / 2.0 : NaN;
  const obi_now = arr.obi !== null && Number.isFinite(arr.obi) ? arr.obi : 0.0;
  const bucket = Number(arr.bucket);

  const freqMs = settings.bars.freq_s * 1000;
  const completed = barsSym.filter((b) => b.bar_ts_ms + freqMs <= ts0Ms);
  let sigma_trail: number | null = null;
  if (completed.length >= 5) {
    const tail15 = completed.slice(-15).map((b) => b.ret_bps).filter((v): v is number => v !== null && Number.isFinite(v));
    const sd = sampleStd(tail15);
    if (sd !== null && Number.isFinite(sd)) {
      sigma_trail = sd / Math.sqrt(60.0);
    }
  }

  return {
    ladder: lad,
    hs_bps,
    obi_now,
    bucket,
    sigma_trail,
    mid_arr: mid,
    prices,
    vols,
    snap: arr,
  };
}

export function predictAllModels(params: {
  feat: NonNullable<ReturnType<typeof computeStaticFeatures>>;
  side: 1 | -1;
  qty: number;
  v_rate: number | null;
  sigma: number | null;
  kappa: number;
  y_risk: number;
  settings: NeoScopeSettings;
}) {
  const { feat, side, qty, v_rate, sigma, kappa, y_risk, settings } = params;
  const ex = settings.execution;
  const full = expectedIsBps({
    side,
    qty,
    ladder: feat.ladder,
    hs_bps: feat.hs_bps,
    obi_now: feat.obi_now,
    kappa_bps_per_s: kappa,
    v_rate_shares_per_s: v_rate,
    sigma_bps_per_s: sigma,
    rho: ex.participation_rate,
    horizon_s: ex.horizon_s,
    y_risk,
    pi_z: ex.pi_z,
  });

  const lad = feat.ladder;
  const hs = Number.isFinite(feat.hs_bps) ? feat.hs_bps : 0;
  const w_vis = lad.filled_vis / qty;
  const w_res = lad.qty_res / qty;
  const ladder_only_e = w_vis * (lad.cost_vis_bps ?? 0) + w_res * hs;

  return {
    naive_mid: { e: 0.0, sigma: 0.0, lo: 0.0, hi: 0.0 },
    ladder_only: { e: ladder_only_e, sigma: 0.0, lo: ladder_only_e, hi: ladder_only_e },
    full: { e: full.e_is_bps, sigma: full.sigma_is_bps, lo: full.lo_bps, hi: full.hi_bps },
    _full_obj: full,
  };
}

export const COST_CURVE_NOTIONALS = [50e6, 100e6, 200e6, 500e6, 1e9, 2e9, 3e9, 5e9] as const;

export interface CostCurvePoint {
  notional: number;
  qty: number;
  coverage: number;
  cost_vis_bps: number | null;
  e_is_bps: number | null;
  lo_bps: number | null;
  hi_bps: number | null;
}

export function buildCostCurve(params: {
  mid: number;
  side: 1 | -1;
  prices: (number | null)[];
  vols: (number | null)[];
  hs_bps: number;
  obi_now: number;
  v_rate: number | null;
  sigma: number | null;
  kappa: number;
  y_risk: number;
  settings: NeoScopeSettings;
  hasFoldModel: boolean;
  notionals?: readonly number[];
}): CostCurvePoint[] {
  const {
    mid,
    side,
    prices,
    vols,
    hs_bps,
    obi_now,
    v_rate,
    sigma,
    kappa,
    y_risk,
    settings,
    hasFoldModel,
    notionals = COST_CURVE_NOTIONALS,
  } = params;
  const ex = settings.execution;
  const hs = Number.isFinite(hs_bps) ? hs_bps : 0;

  return notionals.map((notional) => {
    const qty = Math.max(Math.round(notional / mid / 100) * 100, 100);
    const lad = ladderWalk(side, qty, prices, vols, mid);
    const w_vis = lad.filled_vis / qty;
    const w_res = lad.qty_res / qty;
    const detCostBps = lad.ok
      ? w_vis * (lad.cost_vis_bps ?? 0) + w_res * hs
      : null;

    if (!hasFoldModel || !lad.ok) {
      return {
        notional,
        qty,
        coverage: lad.coverage,
        cost_vis_bps: detCostBps,
        e_is_bps: null,
        lo_bps: null,
        hi_bps: null,
      };
    }

    const est = expectedIsBps({
      side,
      qty,
      ladder: lad,
      hs_bps,
      obi_now,
      kappa_bps_per_s: kappa,
      v_rate_shares_per_s: v_rate,
      sigma_bps_per_s: sigma,
      rho: ex.participation_rate,
      horizon_s: ex.horizon_s,
      y_risk,
      pi_z: ex.pi_z,
    });

    return {
      notional,
      qty,
      coverage: lad.coverage,
      cost_vis_bps: detCostBps,
      e_is_bps: Number.isFinite(est.e_is_bps) ? est.e_is_bps : null,
      lo_bps: Number.isFinite(est.lo_bps) ? est.lo_bps : null,
      hi_bps: Number.isFinite(est.hi_bps) ? est.hi_bps : null,
    };
  });
}

export function simulateOrder(params: {
  snapsSym: SnapRow[];
  ts0Ms: number;
  side: 1 | -1;
  qty: number;
  rho: number;
  horizon_s: number;
  fee_rate: number;
  sell_tax_rate: number;
}) {
  const { snapsSym, ts0Ms, side, qty, rho, horizon_s, fee_rate, sell_tax_rate } = params;
  const idx = searchTsRight(snapsSym, ts0Ms) - 1;
  if (idx < 0) {
    return { ok: false, flags: ['NO_ARRIVAL_SNAP'] };
  }
  const arr = snapsSym[idx];
  const mid_arr = arr.mid;
  if (mid_arr === null || !Number.isFinite(mid_arr) || mid_arr <= 0) {
    return { ok: false, flags: ['NO_BOOK'] };
  }

  const prices = side === -1 ? [arr.bid1, arr.bid2, arr.bid3] : [arr.ask1, arr.ask2, arr.ask3];
  const vols = side === -1 ? [arr.bidvol1, arr.bidvol2, arr.bidvol3] : [arr.askvol1, arr.askvol2, arr.askvol3];
  const lad = ladderWalk(side, qty, prices, vols, mid_arr);

  let filled = lad.filled_vis;
  let notional = (lad.vwap_vis ?? 0) * filled;
  let remaining = qty - filled;
  const flags: string[] = [];
  if (!lad.ok) flags.push('EMPTY_VISIBLE_BOOK');

  const tEndMs = ts0Ms + horizon_s * 1000;
  const post = snapsSym.filter((r) => r.ts_ms > ts0Ms && r.ts_ms <= tEndMs);

  let n_steps = 0;
  let exec_time_s = 0;
  for (const row of post) {
    if (remaining <= 0) break;
    const cap = row.d_vol !== null && Number.isFinite(row.d_vol) ? rho * row.d_vol : 0;
    const px = side === -1 ? row.bid1 : row.ask1;
    if (cap <= 0 || px === null || !Number.isFinite(px)) continue;
    const take = Math.min(remaining, cap);
    notional += take * px;
    remaining -= take;
    filled += take;
    n_steps += 1;
    exec_time_s = (row.ts_ms - ts0Ms) / 1000.0;
  }

  let mark_px = 0;
  if (remaining > 0) {
    const mids = post.map((r) => r.mid).filter((v): v is number => v !== null && Number.isFinite(v));
    mark_px = mids.length > 0 ? mids[mids.length - 1] : mid_arr;
    notional += remaining * mark_px;
    flags.push('UNFILLED_PARTIAL');
  }

  const vwap_exec = notional / qty;
  const realized_is_bps = (side * (vwap_exec - mid_arr) / mid_arr) * BPS;
  const executed_notional = notional - (remaining > 0 ? remaining * mark_px : 0);
  const costs = tradingCostsBps(executed_notional, side, fee_rate, sell_tax_rate);

  return {
    ok: true,
    realized_is_bps,
    vwap_exec,
    mid_arr,
    filled_frac: filled / qty,
    unfilled_frac: remaining / qty,
    exec_time_s,
    n_steps,
    fee_vnd: costs.fee_vnd,
    tax_vnd: costs.tax_vnd,
    flags,
  };
}

export function median(values: number[]): number | null {
  const arr = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 === 0 ? (arr[mid - 1] + arr[mid]) / 2 : arr[mid];
}

export function lastValidBySymbol(snaps: SnapRow[], field: keyof SnapRow): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of snaps) {
    const val = r[field];
    if (typeof val === 'number' && Number.isFinite(val)) {
      out.set(r.symbol, val);
    }
  }
  return out;
}

export interface OrderBookLevel {
  level: 1 | 2 | 3;
  price: number | null;
  vol: number | null;
  notional: number | null;
}

export interface OrderBookSnapshot {
  ts: string;
  mid: number;
  spread_bps: number | null;
  obi: number | null;
  ref: number | null;
  ceiling: number | null;
  floor: number | null;
  last_price: number | null;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  maxVol: number;
}

export function buildOrderBookFromSnap(arr: SnapRow): OrderBookSnapshot | null {
  if (!arr || arr.mid === null || !Number.isFinite(arr.mid) || arr.mid <= 0) return null;
  const mkLevel = (level: 1 | 2 | 3, p: number | null, v: number | null): OrderBookLevel => {
    const validP = p !== null && Number.isFinite(p) ? p : null;
    const validV = v !== null && Number.isFinite(v) ? v : null;
    return {
      level,
      price: validP,
      vol: validV,
      notional: validP !== null && validV !== null ? validP * validV : null,
    };
  };

  const bids: OrderBookLevel[] = [
    mkLevel(1, arr.bid1, arr.bidvol1),
    mkLevel(2, arr.bid2, arr.bidvol2),
    mkLevel(3, arr.bid3, arr.bidvol3),
  ];
  const asks: OrderBookLevel[] = [
    mkLevel(1, arr.ask1, arr.askvol1),
    mkLevel(2, arr.ask2, arr.askvol2),
    mkLevel(3, arr.ask3, arr.askvol3),
  ];

  const allVols = [...bids, ...asks]
    .map((l) => l.vol)
    .filter((v): v is number => v !== null && Number.isFinite(v) && v > 0);
  const maxVol = allVols.length ? Math.max(...allVols) : 1;

  return {
    ts: arr.ts,
    mid: arr.mid,
    spread_bps: arr.spread_bps !== null && Number.isFinite(arr.spread_bps) ? arr.spread_bps : null,
    obi: arr.obi !== null && Number.isFinite(arr.obi) ? arr.obi : null,
    ref: arr.ref !== null && Number.isFinite(arr.ref) ? arr.ref : null,
    ceiling: arr.ceiling !== null && Number.isFinite(arr.ceiling) ? arr.ceiling : null,
    floor: arr.floor !== null && Number.isFinite(arr.floor) ? arr.floor : null,
    last_price: arr.last_price !== null && Number.isFinite(arr.last_price) ? arr.last_price : null,
    bids,
    asks,
    maxVol,
  };
}

export { groupOf };
