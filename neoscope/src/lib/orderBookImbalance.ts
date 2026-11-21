export interface BookSnapLike {
  ts: string;
  ts_ms?: number;
  mid?: number | null;
  microprice?: number | null;
  obi?: number | null;
  bid1?: number | null;
  bid2?: number | null;
  bid3?: number | null;
  ask1?: number | null;
  ask2?: number | null;
  ask3?: number | null;
  bidvol1?: number | null;
  bidvol2?: number | null;
  bidvol3?: number | null;
  askvol1?: number | null;
  askvol2?: number | null;
  askvol3?: number | null;
  depth_bid_vnd?: number | null;
  depth_ask_vnd?: number | null;
}

export interface BookLevelRow {
  level: 1 | 2 | 3;
  bidPrice: number | null;
  bidVol: number;
  bidValVnd: number;
  askPrice: number | null;
  askVol: number;
  askValVnd: number;
  levelObi: number;
}

export interface ObiTickPoint {
  ts: string;
  ts_ms: number;
  obi3L: number;
  obiWeighted: number;
  bidValB: number;
  askValB: number;
  microSkewBps: number | null;
  isExtremeBuy: boolean;
  isExtremeSell: boolean;
}

export type ObiPressureRegime =
  | 'BUY_PRESSURE_EXTREME'
  | 'BUY_BIAS'
  | 'BALANCED'
  | 'SELL_BIAS'
  | 'SELL_PRESSURE_EXTREME';

export interface OrderBookImbalanceAnalysis {
  hasLevelData: boolean;
  series: ObiTickPoint[];
  latestPoint: ObiTickPoint | null;
  levels: BookLevelRow[];
  regime: ObiPressureRegime;
  alertTitle: string;
  alertMessage: string;
  recentMeanWeightedObi: number | null;
  buySpikeCount: number;
  sellSpikeCount: number;
  bidSharePct: number;
  askSharePct: number;
}

const LEVEL_WEIGHTS: readonly [number, number, number] = [0.55, 0.3, 0.15];
const EXTREME_THRESHOLD = 0.42;
const BIAS_THRESHOLD = 0.18;

function cleanNum(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cleanVol(v: number | null | undefined): number {
  const n = cleanNum(v);
  return n !== null && n > 0 ? n : 0;
}

export function computeTick3LevelObi(snap: BookSnapLike): {
  hasLevels: boolean;
  obi3L: number | null;
  obiWeighted: number | null;
  bidValVnd: number;
  askValVnd: number;
  microSkewBps: number | null;
  levels: BookLevelRow[];
} {
  const bPrices = [cleanNum(snap.bid1), cleanNum(snap.bid2), cleanNum(snap.bid3)];
  const aPrices = [cleanNum(snap.ask1), cleanNum(snap.ask2), cleanNum(snap.ask3)];
  const bVols = [cleanVol(snap.bidvol1), cleanVol(snap.bidvol2), cleanVol(snap.bidvol3)];
  const aVols = [cleanVol(snap.askvol1), cleanVol(snap.askvol2), cleanVol(snap.askvol3)];

  const hasLevels =
    bVols.some((v) => v > 0) || aVols.some((v) => v > 0);

  let bidVolSum = 0;
  let askVolSum = 0;
  let bidValVnd = 0;
  let askValVnd = 0;
  let wNum = 0;
  let wDen = 0;

  const levels: BookLevelRow[] = ([0, 1, 2] as const).map((idx) => {
    const bv = bVols[idx];
    const av = aVols[idx];
    const bp = bPrices[idx];
    const ap = aPrices[idx];
    const bVal = bp !== null && bp > 0 ? bp * bv : 0;
    const aVal = ap !== null && ap > 0 ? ap * av : 0;

    bidVolSum += bv;
    askVolSum += av;
    bidValVnd += bVal;
    askValVnd += aVal;

    const w = LEVEL_WEIGHTS[idx];
    wNum += w * (bv - av);
    wDen += w * (bv + av);

    const lvlDen = bv + av;
    return {
      level: (idx + 1) as 1 | 2 | 3,
      bidPrice: bp,
      bidVol: bv,
      bidValVnd: bVal,
      askPrice: ap,
      askVol: av,
      askValVnd: aVal,
      levelObi: lvlDen > 0 ? (bv - av) / lvlDen : 0,
    };
  });

  if (bidValVnd <= 0 && snap.depth_bid_vnd) bidValVnd = Math.max(0, Number(snap.depth_bid_vnd));
  if (askValVnd <= 0 && snap.depth_ask_vnd) askValVnd = Math.max(0, Number(snap.depth_ask_vnd));

  let obi3L: number | null = null;
  if (bidVolSum + askVolSum > 0) {
    obi3L = (bidVolSum - askVolSum) / (bidVolSum + askVolSum);
  } else if (cleanNum(snap.obi) !== null) {
    obi3L = cleanNum(snap.obi);
  }

  let obiWeighted: number | null = null;
  if (wDen > 0) {
    obiWeighted = wNum / wDen;
  } else {
    obiWeighted = obi3L;
  }

  const mid = cleanNum(snap.mid);
  let micro = cleanNum(snap.microprice);
  if (micro === null && bPrices[0] && aPrices[0] && bVols[0] + aVols[0] > 0) {
    // Standard microprice = (Bid1 * AskVol1 + Ask1 * BidVol1) / (BidVol1 + AskVol1)
    micro = (bPrices[0] * aVols[0] + aPrices[0] * bVols[0]) / (bVols[0] + aVols[0]);
  }
  const microSkewBps =
    mid !== null && mid > 0 && micro !== null
      ? ((micro - mid) / mid) * 10_000
      : null;

  return {
    hasLevels,
    obi3L,
    obiWeighted,
    bidValVnd,
    askValVnd,
    microSkewBps,
    levels,
  };
}

export function analyzeOrderBookImbalance(
  snaps: BookSnapLike[],
  symbol: string,
  focusTick?: BookSnapLike | null,
): OrderBookImbalanceAnalysis {
  if (!snaps.length) {
    return {
      hasLevelData: false,
      series: [],
      latestPoint: null,
      levels: [],
      regime: 'BALANCED',
      alertTitle: `Chưa có dữ liệu sổ lệnh 3 mức cho ${symbol}`,
      alertMessage: 'Chọn phiên hoặc mã cổ phiếu có snapshot sổ lệnh để phân tích áp lực mua/bán.',
      recentMeanWeightedObi: null,
      buySpikeCount: 0,
      sellSpikeCount: 0,
      bidSharePct: 50,
      askSharePct: 50,
    };
  }

  let hasLevelData = false;
  const series: ObiTickPoint[] = [];
  let buySpikeCount = 0;
  let sellSpikeCount = 0;
  let latestLevels: BookLevelRow[] = [];

  for (const s of snaps) {
    const tick = computeTick3LevelObi(s);
    if (tick.hasLevels) hasLevelData = true;
    if (tick.obi3L === null || tick.obiWeighted === null) continue;
    const tsMs = typeof s.ts_ms === 'number' && Number.isFinite(s.ts_ms) ? s.ts_ms : Date.parse(s.ts);
    const isExtremeBuy = tick.obiWeighted >= EXTREME_THRESHOLD || tick.obi3L >= EXTREME_THRESHOLD;
    const isExtremeSell = tick.obiWeighted <= -EXTREME_THRESHOLD || tick.obi3L <= -EXTREME_THRESHOLD;
    if (isExtremeBuy) buySpikeCount += 1;
    if (isExtremeSell) sellSpikeCount += 1;

    series.push({
      ts: s.ts,
      ts_ms: Number.isFinite(tsMs) ? tsMs : 0,
      obi3L: tick.obi3L,
      obiWeighted: tick.obiWeighted,
      bidValB: tick.bidValVnd / 1e9,
      askValB: tick.askValVnd / 1e9,
      microSkewBps: tick.microSkewBps,
      isExtremeBuy,
      isExtremeSell,
    });
    if (tick.hasLevels) latestLevels = tick.levels;
  }

  // If user hovers or picks a specific snapshot on the chart, inspect its 3-level ladder
  let activePoint: ObiTickPoint | null = series.length ? series[series.length - 1] : null;
  if (focusTick) {
    const f = computeTick3LevelObi(focusTick);
    if (f.hasLevels) latestLevels = f.levels;
    if (f.obi3L !== null && f.obiWeighted !== null) {
      activePoint = {
        ts: focusTick.ts,
        ts_ms: focusTick.ts_ms ?? Date.parse(focusTick.ts),
        obi3L: f.obi3L,
        obiWeighted: f.obiWeighted,
        bidValB: f.bidValVnd / 1e9,
        askValB: f.askValVnd / 1e9,
        microSkewBps: f.microSkewBps,
        isExtremeBuy: f.obiWeighted >= EXTREME_THRESHOLD,
        isExtremeSell: f.obiWeighted <= -EXTREME_THRESHOLD,
      };
    }
  }

  const tailWindow = series.slice(-10);
  const recentMeanWeightedObi =
    tailWindow.length > 0
      ? tailWindow.reduce((sum, p) => sum + p.obiWeighted, 0) / tailWindow.length
      : null;

  const evalObi = activePoint?.obiWeighted ?? recentMeanWeightedObi ?? 0;
  let regime: ObiPressureRegime = 'BALANCED';
  if (evalObi >= EXTREME_THRESHOLD || (recentMeanWeightedObi !== null && recentMeanWeightedObi >= EXTREME_THRESHOLD)) {
    regime = 'BUY_PRESSURE_EXTREME';
  } else if (evalObi <= -EXTREME_THRESHOLD || (recentMeanWeightedObi !== null && recentMeanWeightedObi <= -EXTREME_THRESHOLD)) {
    regime = 'SELL_PRESSURE_EXTREME';
  } else if (evalObi >= BIAS_THRESHOLD) {
    regime = 'BUY_BIAS';
  } else if (evalObi <= -BIAS_THRESHOLD) {
    regime = 'SELL_BIAS';
  }

  const totalDepth = (activePoint?.bidValB ?? 0) + (activePoint?.askValB ?? 0);
  const bidSharePct = totalDepth > 0 && activePoint ? (activePoint.bidValB / totalDepth) * 100 : 50;
  const askSharePct = 100 - bidSharePct;

  let alertTitle = `Sổ lệnh 3 mức ${symbol} cân bằng`;
  let alertMessage = `Cung – cầu 3 mức giá đang phân bổ tương đối cân bằng (Bid ${bidSharePct.toFixed(0)}% / Ask ${askSharePct.toFixed(0)}%).`;

  if (regime === 'BUY_PRESSURE_EXTREME') {
    alertTitle = `Cảnh báo áp lực MUA ngắn hạn mạnh (${symbol})`;
    alertMessage = `Dư mua 3 mức áp đảo (${bidSharePct.toFixed(0)}% vs ${askSharePct.toFixed(0)}% Ask; OBI trọng số = +${evalObi.toFixed(2)}). Giá khớp có xác suất dịch chuyển lên trong ngắn hạn nếu lực cầu duy trì.`;
  } else if (regime === 'SELL_PRESSURE_EXTREME') {
    alertTitle = `Cảnh báo áp lực BÁN ngắn hạn mạnh (${symbol})`;
    alertMessage = `Dư bán 3 mức áp đảo (${askSharePct.toFixed(0)}% vs ${bidSharePct.toFixed(0)}% Bid; OBI trọng số = ${evalObi.toFixed(2)}). Rủi ro trượt giá chiều bán hoặc giảm giá ngắn hạn gia tăng.`;
  } else if (regime === 'BUY_BIAS') {
    alertTitle = `Nghiêng áp lực MUA nhẹ (${symbol})`;
    alertMessage = `Bên mua 3 mức chiếm ưu thế (${bidSharePct.toFixed(0)}% Bid; OBI trọng số = +${evalObi.toFixed(2)}), chưa chạm ngưỡng cực đoan ±${EXTREME_THRESHOLD.toFixed(2)}.`;
  } else if (regime === 'SELL_BIAS') {
    alertTitle = `Nghiêng áp lực BÁN nhẹ (${symbol})`;
    alertMessage = `Bên bán 3 mức chiếm ưu thế (${askSharePct.toFixed(0)}% Ask; OBI trọng số = ${evalObi.toFixed(2)}), theo dõi thêm nếu OBI phá xuống dưới -${EXTREME_THRESHOLD.toFixed(2)}.`;
  }

  return {
    hasLevelData,
    series,
    latestPoint: activePoint,
    levels: latestLevels,
    regime,
    alertTitle,
    alertMessage,
    recentMeanWeightedObi,
    buySpikeCount,
    sellSpikeCount,
    bidSharePct,
    askSharePct,
  };
}
