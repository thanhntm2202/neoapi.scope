import { toVnIsoLocal } from './format';

export interface LiquidityHeatmapBarInput {
  symbol: string;
  bar_ts: string;
  bar_ts_ms?: number;
  group?: string;
  d_val?: number | null;
  d_vol?: number | null;
  ret_bps?: number | null;
  spread_bps?: number | null;
  obi_mean?: number | null;
  obi_last?: number | null;
}

export interface LiquidityHeatmapWatchlistInput {
  symbol: string;
  group?: string;
  midLast?: number | null;
}

export interface BivariateCell {
  symbol: string;
  slot: string;
  barCount: number;
  valuePerMinB: number; // Value / Time in tỷ VND / phút
  signedFlowPerMinB: number; // Signed directional Value / Time in tỷ VND / phút
  microVolBps: number; // Sample std of 1-min ret_bps (or mean |ret_bps|) in bps
  meanSpreadBps: number | null;
  hueDeg: number; // Color hue encoding Money Flow Intensity / Direction
  saturationPct: number; // Color saturation (18..94%) encoding Micro-volatility
  lightnessPct: number; // Lightness (22..48%) encoding Value/Time magnitude
  hslCss: string;
  isHighVol: boolean;
}

export interface LiquidityHeatmapMatrix2D {
  xSlots: string[];
  yRows: {
    symbol: string;
    group: 'large' | 'thin';
    avgValuePerMinB: number;
    avgMicroVolBps: number;
    cells: (BivariateCell | null)[];
  }[];
  maxValuePerMinB: number;
  maxMicroVolBps: number;
}

function sampleStd(arr: number[]): number {
  if (arr.length === 0) return 0;
  if (arr.length === 1) return Math.abs(arr[0]);
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  let sq = 0;
  for (const v of arr) sq += (v - mean) ** 2;
  return Math.sqrt(sq / (arr.length - 1));
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

export type FlowColorMode = 'directional' | 'magnitude';

/**
 * Computes HSL bivariate color:
 * - Hue + Lightness represent Money Flow Intensity (Value/Time in tỷ VND/phút)
 * - Saturation represents Micro-Volatility (bps)
 */
export function computeBivariateHsl(params: {
  valuePerMinB: number;
  signedFlowPerMinB: number;
  microVolBps: number;
  maxValuePerMinB: number;
  maxMicroVolBps: number;
  colorMode: FlowColorMode;
}): { hueDeg: number; saturationPct: number; lightnessPct: number; hslCss: string } {
  const {
    valuePerMinB,
    signedFlowPerMinB,
    microVolBps,
    maxValuePerMinB,
    maxMicroVolBps,
    colorMode,
  } = params;

  const normVal =
    maxValuePerMinB > 0
      ? Math.min(1, Math.max(0, Math.sqrt(valuePerMinB / maxValuePerMinB)))
      : 0;
  const normVol =
    maxMicroVolBps > 0
      ? Math.min(1, Math.max(0, microVolBps / maxMicroVolBps))
      : 0;

  // Saturation directly encodes micro-volatility (calm = 18%, turbulent = 94%)
  const saturationPct = Math.round(18 + normVol * 76);

  let hueDeg = 212;
  if (colorMode === 'directional') {
    const dirStrength =
      valuePerMinB > 1e-9 ? Math.max(-1, Math.min(1, signedFlowPerMinB / valuePerMinB)) : 0;
    if (dirStrength > 0.08) {
      hueDeg = 168; // Emerald inflow
    } else if (dirStrength < -0.08) {
      hueDeg = 4; // Crimson outflow
    } else {
      hueDeg = 216; // Neutral slate/blue
    }
  } else {
    // Continuous intensity ramp from deep cobalt (222°) -> cyan (192°) -> emerald (160°) -> amber (38°)
    if (normVal < 0.45) {
      hueDeg = Math.round(222 - (normVal / 0.45) * 32);
    } else if (normVal < 0.78) {
      hueDeg = Math.round(190 - ((normVal - 0.45) / 0.33) * 32);
    } else {
      hueDeg = Math.round(158 - ((normVal - 0.78) / 0.22) * 118);
    }
  }

  // Lightness encodes Value/Time intensity cleanly on dark background (20%..49%)
  const lightnessPct = Math.round(20 + normVal * 29);

  return {
    hueDeg,
    saturationPct,
    lightnessPct,
    hslCss: `hsl(${hueDeg} ${saturationPct}% ${lightnessPct}%)`,
  };
}

export function buildLiquidityHeatmap2D(params: {
  symbols: string[];
  barsLhs: LiquidityHeatmapBarInput[];
  watchlist?: LiquidityHeatmapWatchlistInput[];
  colorMode?: FlowColorMode;
}): LiquidityHeatmapMatrix2D {
  const { symbols, barsLhs, watchlist = [], colorMode = 'directional' } = params;
  const targetSymbols =
    symbols.length > 0 ? symbols : watchlist.map((w) => w.symbol);
  if (!targetSymbols.length || !barsLhs.length) {
    return { xSlots: [], yRows: [], maxValuePerMinB: 0, maxMicroVolBps: 0 };
  }

  const symSet = new Set(targetSymbols);
  const midMap = new Map<string, number>();
  const grpMap = new Map<string, 'large' | 'thin'>();
  for (const w of watchlist) {
    if (w.midLast !== null && w.midLast !== undefined && Number.isFinite(w.midLast)) {
      midMap.set(w.symbol, w.midLast);
    }
    if (w.group === 'thin' || w.group === 'large') {
      grpMap.set(w.symbol, w.group);
    }
  }

  const slotSet = new Set<string>();
  const bucketMap = new Map<
    string,
    {
      barCount: number;
      totalValVnd: number;
      signedFlowVnd: number;
      rets: number[];
      spreads: number[];
    }
  >();

  for (const b of barsLhs) {
    if (!symSet.has(b.symbol)) continue;
    if (!grpMap.has(b.symbol) && (b.group === 'thin' || b.group === 'large')) {
      grpMap.set(b.symbol, b.group);
    }
    const slot = getVnSlot15m(b.bar_ts);
    if (!slot) continue;
    slotSet.add(slot);

    const key = `${b.symbol}|${slot}`;
    let acc = bucketMap.get(key);
    if (!acc) {
      acc = { barCount: 0, totalValVnd: 0, signedFlowVnd: 0, rets: [], spreads: [] };
      bucketMap.set(key, acc);
    }
    acc.barCount += 1;

    let valVnd = 0;
    if (b.d_val !== null && b.d_val !== undefined && Number.isFinite(Number(b.d_val))) {
      valVnd = Math.max(0, Number(b.d_val));
    } else if (b.d_vol !== null && b.d_vol !== undefined && Number.isFinite(Number(b.d_vol))) {
      const m = midMap.get(b.symbol) ?? 0;
      if (m > 0) valVnd = Math.max(0, Number(b.d_vol)) * m;
    }
    acc.totalValVnd += valVnd;

    const ret = b.ret_bps !== null && b.ret_bps !== undefined && Number.isFinite(Number(b.ret_bps))
      ? Number(b.ret_bps)
      : null;
    if (ret !== null) acc.rets.push(ret);

    const obiBar =
      b.obi_mean !== null && b.obi_mean !== undefined && Number.isFinite(Number(b.obi_mean))
        ? Number(b.obi_mean)
        : b.obi_last !== null && b.obi_last !== undefined && Number.isFinite(Number(b.obi_last))
          ? Number(b.obi_last)
          : null;

    if (valVnd > 0) {
      let sign = 0;
      if (ret !== null && Math.abs(ret) > 1e-6) sign = ret > 0 ? 1 : -1;
      else if (obiBar !== null) sign = Math.max(-1, Math.min(1, obiBar));
      acc.signedFlowVnd += valVnd * sign;
    }

    if (b.spread_bps !== null && b.spread_bps !== undefined && Number.isFinite(Number(b.spread_bps))) {
      acc.spreads.push(Number(b.spread_bps));
    }
  }

  const xSlots = Array.from(slotSet).sort((a, b) => a.localeCompare(b, 'en'));
  if (!xSlots.length) {
    return { xSlots: [], yRows: [], maxValuePerMinB: 0, maxMicroVolBps: 0 };
  }

  let maxValuePerMinB = 0;
  let maxMicroVolBps = 0;

  interface RawCell {
    symbol: string;
    slot: string;
    barCount: number;
    valuePerMinB: number;
    signedFlowPerMinB: number;
    microVolBps: number;
    meanSpreadBps: number | null;
  }

  const rawByKey = new Map<string, RawCell>();
  for (const sym of targetSymbols) {
    for (const slot of xSlots) {
      const acc = bucketMap.get(`${sym}|${slot}`);
      if (!acc || acc.barCount <= 0) continue;
      const mins = Math.max(acc.barCount, 1);
      const valuePerMinB = acc.totalValVnd / mins / 1e9;
      const signedFlowPerMinB = acc.signedFlowVnd / mins / 1e9;
      const microVolBps = sampleStd(acc.rets);
      const meanSpreadBps =
        acc.spreads.length > 0
          ? acc.spreads.reduce((s, v) => s + v, 0) / acc.spreads.length
          : null;

      if (valuePerMinB > maxValuePerMinB) maxValuePerMinB = valuePerMinB;
      if (microVolBps > maxMicroVolBps) maxMicroVolBps = microVolBps;

      rawByKey.set(`${sym}|${slot}`, {
        symbol: sym,
        slot,
        barCount: acc.barCount,
        valuePerMinB,
        signedFlowPerMinB,
        microVolBps,
        meanSpreadBps,
      });
    }
  }

  const volThreshold = Math.max(18, maxMicroVolBps * 0.65);

  const yRows = targetSymbols
    .map((sym) => {
      let sumValRate = 0;
      let sumVol = 0;
      let activeSlots = 0;
      const cells: (BivariateCell | null)[] = xSlots.map((slot) => {
        const raw = rawByKey.get(`${sym}|${slot}`);
        if (!raw) return null;
        sumValRate += raw.valuePerMinB;
        sumVol += raw.microVolBps;
        activeSlots += 1;
        const hsl = computeBivariateHsl({
          valuePerMinB: raw.valuePerMinB,
          signedFlowPerMinB: raw.signedFlowPerMinB,
          microVolBps: raw.microVolBps,
          maxValuePerMinB,
          maxMicroVolBps,
          colorMode,
        });
        return {
          ...raw,
          ...hsl,
          isHighVol: raw.microVolBps >= volThreshold && raw.microVolBps > 0,
        };
      });

      return {
        symbol: sym,
        group: grpMap.get(sym) || 'large',
        avgValuePerMinB: activeSlots > 0 ? sumValRate / activeSlots : 0,
        avgMicroVolBps: activeSlots > 0 ? sumVol / activeSlots : 0,
        cells,
      };
    })
    .sort((a, b) => b.avgValuePerMinB - a.avgValuePerMinB);

  return {
    xSlots,
    yRows,
    maxValuePerMinB,
    maxMicroVolBps,
  };
}
