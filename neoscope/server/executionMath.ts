import type { BarRow, SnapRow } from './parquetStore.ts';
import type { NeoScopeSettings } from './config.ts';

export const BPS = 1e4;

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
  e_is_bps: number | null;
  sigma_is_bps: number | null;
  lo_bps: number | null;
  hi_bps: number | null;
  tau_s: number | null;
  w_vis: number;
  w_res: number;
  w_unf: number;
  cost_vis_bps: number | null;
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

export interface SimResult {
  realized_is_bps: number | null;
  vwap_exec: number | null;
  mid_arr: number | null;
  filled_frac: number;
  unfilled_frac: number;
  exec_time_s: number;
  n_steps: number;
  fee_vnd: number;
  tax_vnd: number;
  flags: string[];
  ok: boolean;
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function searchTsRight(arr: { ts: number }[], targetMs: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid].ts <= targetMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function ladderWalk(
  side: number,
  qty: number,
  prices: (number | null)[],
  vols: (number | null)[],
  mid: number | null,
): LadderResult {
  if (qty <= 0 || !isFiniteNum(mid) || mid <= 0) {
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
    if (!isFiniteNum(p) || !isFiniteNum(v) || v <= 0) continue;
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
  const costBps = (side * (vwap - mid) / mid) * BPS;
  return {
    filled_vis: filled,
    qty_res: remaining,
    vwap_vis: vwap,
    cost_vis_bps: costBps,
    coverage: filled / qty,
    fills,
    ok: true,
  };
}

export function tradingCostsBps(
  notionalVnd: number,
  side: number,
  feeRate: number,
  sellTaxRate: number,
): { fee_bps: number; tax_bps: number; fee_vnd: number; tax_vnd: number } {
  return {
    fee_bps: feeRate * BPS,
    tax_bps: side === -1 ? sellTaxRate * BPS : 0,
    fee_vnd: notionalVnd * feeRate,
    tax_vnd: side === -1 ? notionalVnd * sellTaxRate : 0,
  };
}

export function expectedIsBps(
  side: number,
  qty: number,
  ladder: LadderResult,
  hsBps: number | null,
  obiNow: number | null,
  kappaBpsPerS: number,
  vRateSharesPerS: number | null,
  sigmaBpsPerS: number | null,
  rho: number,
  horizonS: number,
  yRisk: number,
  piZ = 1.6449,
): CostEstimate {
  const flags: string[] = [];
  if (!ladder.ok || ladder.cost_vis_bps === null) {
    return {
      e_is_bps: null,
      sigma_is_bps: null,
      lo_bps: null,
      hi_bps: null,
      tau_s: null,
      w_vis: 0,
      w_res: 0,
      w_unf: 1,
      cost_vis_bps: null,
      coverage: 0,
      flags: ['NO_BOOK'],
      detail: { mu_bps_per_s: 0, hs_bps: 0, tau_eff: 0, v_rate: null, sigma_bps_per_s: 0 },
    };
  }

  const wVis = ladder.filled_vis / qty;
  const qRes = ladder.qty_res;
  const mu = kappaBpsPerS * (isFiniteNum(obiNow) ? obiNow : 0);
  const hs = isFiniteNum(hsBps) ? hsBps : 0;

  if (qRes <= 0) {
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
        hs_bps: hs,
        tau_eff: 0,
        v_rate: vRateSharesPerS,
        sigma_bps_per_s: isFiniteNum(sigmaBpsPerS) ? sigmaBpsPerS : 0,
      },
    };
  }

  let tau: number;
  let wRes: number;
  let wUnf: number;

  if (!isFiniteNum(vRateSharesPerS) || vRateSharesPerS <= 0 || rho <= 0) {
    tau = horizonS;
    wRes = 0;
    wUnf = 1;
    flags.push('NO_LIQUIDITY_PROFILE');
  } else {
    const tauFull = qRes / (rho * vRateSharesPerS);
    if (tauFull <= horizonS) {
      tau = tauFull;
      wRes = qRes / qty;
      wUnf = 0;
    } else {
      const filledRes = rho * vRateSharesPerS * horizonS;
      tau = horizonS;
      wRes = filledRes / qty;
      wUnf = qRes / qty - wRes;
      flags.push('HORIZON_CAPPED');
    }
  }

  const eRes = hs + side * mu * tau / 2;
  const eUnf = side * mu * horizonS;
  const e = wVis * ladder.cost_vis_bps + wRes * eRes + wUnf * eUnf;

  let sigOk = isFiniteNum(sigmaBpsPerS) && sigmaBpsPerS > 0;
  const sig = sigOk && sigmaBpsPerS !== null ? sigmaBpsPerS : 0;
  const tauEff = (wRes * wRes * tau) / 3 + wUnf * wUnf * horizonS;
  let sigma = yRisk * sig * Math.sqrt(Math.max(tauEff, 0));
  if (!Number.isFinite(sigma)) {
    sigma = 0;
    sigOk = false;
  }
  if (!sigOk && tauEff > 0) {
    flags.push('NO_VOL_ESTIMATE');
  }

  return {
    e_is_bps: e,
    sigma_is_bps: sigma,
    lo_bps: e - piZ * sigma,
    hi_bps: e + piZ * sigma,
    tau_s: tau,
    w_vis: wVis,
    w_res: wRes,
    w_unf: wUnf,
    cost_vis_bps: ladder.cost_vis_bps,
    coverage: ladder.coverage,
    flags,
    detail: {
      mu_bps_per_s: mu,
      hs_bps: hs,
      tau_eff: tauEff,
      v_rate: vRateSharesPerS,
      sigma_bps_per_s: sig,
    },
  };
}

function sampleStd(values: number[]): number | null {
  if (values.length < 2) return null;
  let sum = 0;
  for (const x of values) sum += x;
  const mean = sum / values.length;
  let sq = 0;
  for (const x of values) {
    const d = x - mean;
    sq += d * d;
  }
  return Math.sqrt(sq / (values.length - 1));
}

export function buildVolumeProfile(barsTrain: BarRow[]): Map<string, number> {
  const out = new Map<string, number>();
  const symBkt = new Map<string, { sum: number; n: number }>();
  const grpBkt = new Map<string, { sum: number; n: number }>();
  const symAll = new Map<string, { sum: number; n: number }>();

  for (const b of barsTrain) {
    if (!isFiniteNum(b.d_vol)) continue;
    const k1 = `SB:${b.symbol}:${b.bucket}`;
    const c1 = symBkt.get(k1) || { sum: 0, n: 0 };
    c1.sum += b.d_vol;
    c1.n += 1;
    symBkt.set(k1, c1);

    const k2 = `GB:${b.group}:${b.bucket}`;
    const c2 = grpBkt.get(k2) || { sum: 0, n: 0 };
    c2.sum += b.d_vol;
    c2.n += 1;
    grpBkt.set(k2, c2);

    const k3 = `S:${b.symbol}`;
    const c3 = symAll.get(k3) || { sum: 0, n: 0 };
    c3.sum += b.d_vol;
    c3.n += 1;
    symAll.set(k3, c3);
  }

  for (const [k, v] of symBkt) out.set(k, v.sum / v.n / 60);
  for (const [k, v] of grpBkt) out.set(k, v.sum / v.n / 60);
  for (const [k, v] of symAll) out.set(k, v.sum / v.n / 60);
  return out;
}

export function lookupVRate(
  profile: Map<string, number>,
  symbol: string,
  group: string,
  bucket: number,
): number | null {
  return (
    profile.get(`SB:${symbol}:${bucket}`) ??
    profile.get(`GB:${group}:${bucket}`) ??
    profile.get(`S:${symbol}`) ??
    null
  );
}

export function buildSigmaFallback(barsTrain: BarRow[]): Map<string, number> {
  const buckets = new Map<string, number[]>();
  for (const b of barsTrain) {
    if (!isFiniteNum(b.ret_bps)) continue;
    const k = `${b.group}:${b.bucket}`;
    const list = buckets.get(k) || [];
    list.push(b.ret_bps);
    buckets.set(k, list);
  }
  const out = new Map<string, number>();
  for (const [k, vals] of buckets) {
    const sd = sampleStd(vals);
    if (sd !== null && Number.isFinite(sd)) {
      out.set(k, sd / Math.sqrt(60));
    }
  }
  return out;
}

export function foldParamsFor(
  foldParams: Record<string, unknown>[],
  sessionDate: string,
  testDates: string[],
): { rows: Record<string, unknown>[]; note: string } {
  if (!foldParams.length) {
    return { rows: [], note: 'Chưa có tham số hiệu chỉnh — kiểm tra dữ liệu validate.' };
  }
  const folds = Array.from(new Set(foldParams.map((r) => Number(r.fold)))).sort((a, b) => a - b);
  const idx = testDates.indexOf(sessionDate);
  let k: number;
  let note: string;
  if (idx >= 0 && idx < folds.length) {
    k = folds[idx];
    note = `Tham số fold ${k}: huấn luyện trên các phiên TRƯỚC ${sessionDate} (ngoài mẫu đúng nghĩa).`;
  } else {
    const match = foldParams.find((r) => String(r.test_date) === sessionDate);
    if (match) {
      k = Number(match.fold);
      note = `Tham số fold ${k} (phiên này là ngày test của fold đó).`;
    } else {
      k = folds[0];
      note = `⚠️ Phiên ${sessionDate} nằm trong tập huấn luyện của mọi fold — dùng tham số fold ${k} sớm nhất chỉ để MINH HỌA, không phải kết quả ngoài mẫu.`;
    }
  }
  return {
    rows: foldParams.filter((r) => Number(r.fold) === k),
    note,
  };
}

export function staticFeatures(
  ts0Ms: number,
  side: number,
  qtyShares: number,
  snapsSym: SnapRow[],
  barsSym: BarRow[],
  freqS: number,
): {
  arr: SnapRow;
  ladder: LadderResult;
  hs_bps: number | null;
  obi_now: number;
  bucket: number;
  sigma_trail: number | null;
  mid_arr: number;
} | null {
  const idx = searchTsRight(snapsSym, ts0Ms) - 1;
  if (idx < 0) return null;
  const arr = snapsSym[idx];
  const mid = arr.mid;
  if (!isFiniteNum(mid) || mid <= 0) return null;

  const prices = side === -1 ? [arr.bid1, arr.bid2, arr.bid3] : [arr.ask1, arr.ask2, arr.ask3];
  const vols = side === -1 ? [arr.bidvol1, arr.bidvol2, arr.bidvol3] : [arr.askvol1, arr.askvol2, arr.askvol3];
  const ladder = ladderWalk(side, qtyShares, prices, vols, mid);
  if (!ladder.ok) return null;

  const hsBps = isFiniteNum(arr.spread_bps) ? arr.spread_bps / 2 : null;
  const obiNow = isFiniteNum(arr.obi) ? arr.obi : 0;
  const bucket = Number(arr.bucket);

  const completed = barsSym.filter((b) => b.bar_ts + freqS * 1000 <= ts0Ms);
  let sigmaTrail: number | null = null;
  if (completed.length >= 5) {
    const tail = completed.slice(-15).map((b) => b.ret_bps).filter(isFiniteNum);
    const sd = sampleStd(tail);
    if (sd !== null && Number.isFinite(sd)) {
      sigmaTrail = sd / Math.sqrt(60);
    }
  }

  return { arr, ladder, hs_bps: hsBps, obi_now: obiNow, bucket, sigma_trail: sigmaTrail, mid_arr: mid };
}

export function predictAllModels(
  feat: NonNullable<ReturnType<typeof staticFeatures>>,
  side: number,
  qtyShares: number,
  vRate: number | null,
  sigma: number | null,
  kappa: number,
  yRisk: number,
  settings: NeoScopeSettings,
) {
  const ex = settings.data.execution;
  const full = expectedIsBps(
    side,
    qtyShares,
    feat.ladder,
    feat.hs_bps,
    feat.obi_now,
    kappa,
    vRate,
    sigma,
    Number(ex.participation_rate),
    Number(ex.horizon_s),
    yRisk,
    Number(ex.pi_z),
  );
  const wVis = feat.ladder.filled_vis / qtyShares;
  const wRes = feat.ladder.qty_res / qtyShares;
  const hs = isFiniteNum(feat.hs_bps) ? feat.hs_bps : 0;
  const ladderOnlyE = wVis * (feat.ladder.cost_vis_bps ?? 0) + wRes * hs;

  return {
    naive_mid: { e: 0, sigma: 0, lo: 0, hi: 0 },
    ladder_only: { e: ladderOnlyE, sigma: 0, lo: ladderOnlyE, hi: ladderOnlyE },
    full: { e: full.e_is_bps, sigma: full.sigma_is_bps, lo: full.lo_bps, hi: full.hi_bps },
    fullObj: full,
  };
}

export function simulateOrder(
  snapsSym: SnapRow[],
  ts0Ms: number,
  side: number,
  qty: number,
  rho: number,
  horizonS: number,
  feeRate: number,
  sellTaxRate: number,
): SimResult {
  const idx = searchTsRight(snapsSym, ts0Ms) - 1;
  if (idx < 0) {
    return {
      realized_is_bps: null, vwap_exec: null, mid_arr: null,
      filled_frac: 0, unfilled_frac: 1, exec_time_s: 0, n_steps: 0,
      fee_vnd: 0, tax_vnd: 0, flags: ['NO_ARRIVAL_SNAP'], ok: false,
    };
  }
  const arr = snapsSym[idx];
  const midArr = arr.mid;
  if (!isFiniteNum(midArr) || midArr <= 0) {
    return {
      realized_is_bps: null, vwap_exec: null, mid_arr: null,
      filled_frac: 0, unfilled_frac: 1, exec_time_s: 0, n_steps: 0,
      fee_vnd: 0, tax_vnd: 0, flags: ['NO_BOOK'], ok: false,
    };
  }

  const prices = side === -1 ? [arr.bid1, arr.bid2, arr.bid3] : [arr.ask1, arr.ask2, arr.ask3];
  const vols = side === -1 ? [arr.bidvol1, arr.bidvol2, arr.bidvol3] : [arr.askvol1, arr.askvol2, arr.askvol3];

  const lad = ladderWalk(side, qty, prices, vols, midArr);
  let filled = lad.filled_vis;
  let notional = (lad.vwap_vis ?? 0) * filled;
  let remaining = qty - filled;
  const flags: string[] = [];
  if (!lad.ok) flags.push('EMPTY_VISIBLE_BOOK');

  const tEnd = ts0Ms + horizonS * 1000;
  const post = snapsSym.filter((r) => r.ts > ts0Ms && r.ts <= tEnd);
  let nSteps = 0;
  let execTime = 0;

  for (const row of post) {
    if (remaining <= 0) break;
    const cap = isFiniteNum(row.d_vol) ? rho * row.d_vol : 0;
    const px = side === -1 ? row.bid1 : row.ask1;
    if (cap <= 0 || !isFiniteNum(px)) continue;
    const take = Math.min(remaining, cap);
    notional += take * px;
    remaining -= take;
    filled += take;
    nSteps += 1;
    execTime = (row.ts - ts0Ms) / 1000;
  }

  let markPx = 0;
  if (remaining > 0) {
    const mids = post.map((r) => r.mid).filter(isFiniteNum);
    markPx = mids.length ? mids[mids.length - 1] : midArr;
    notional += remaining * markPx;
    flags.push('UNFILLED_PARTIAL');
  }

  const vwap = notional / qty;
  const realized = (side * (vwap - midArr) / midArr) * BPS;
  const executedNotional = notional - (remaining > 0 ? remaining * markPx : 0);
  const costs = tradingCostsBps(executedNotional, side, feeRate, sellTaxRate);

  return {
    realized_is_bps: realized,
    vwap_exec: vwap,
    mid_arr: midArr,
    filled_frac: filled / qty,
    unfilled_frac: remaining / qty,
    exec_time_s: execTime,
    n_steps: nSteps,
    fee_vnd: costs.fee_vnd,
    tax_vnd: costs.tax_vnd,
    flags,
    ok: true,
  };
}
