export type SignalFilterMode = 'none' | 'high_vol' | 'high_lhs' | 'low_lhs';

export interface SignalBarLike {
  symbol: string;
  bar_ts_ms?: number;
  bar_ts?: string;
  ret_bps?: number | null;
  lhs?: number | null;
  spread_bps?: number | null;
}

export interface SignalAlertLike {
  symbol: string;
  priority?: string;
}

export interface SymbolSignal {
  symbol: string;
  group: 'large' | 'thin';
  volatilityBps: number | null;
  lhsLast: number | null;
  spreadBps: number | null;
  alertCount: number;
  rareAlertCount: number;
}

export interface SignalRange {
  min: number;
  max: number;
  median: number;
  mean: number;
}

export interface SliderBounds {
  min: number;
  max: number;
  step: number;
}

function sampleStd(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((acc, v) => acc + v, 0) / values.length;
  let sumSq = 0;
  for (const v of values) {
    sumSq += (v - mean) ** 2;
  }
  return Math.sqrt(sumSq / (values.length - 1));
}

function medianOf(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeSymbolSignals(
  bars: SignalBarLike[],
  alerts: SignalAlertLike[],
  allSymbols: string[],
  groupMap: Record<string, 'large' | 'thin'>,
): SymbolSignal[] {
  const sortedBars = [...bars].sort((a, b) => {
    const ams =
      typeof a.bar_ts_ms === 'number' && Number.isFinite(a.bar_ts_ms)
        ? a.bar_ts_ms
        : a.bar_ts
          ? Date.parse(a.bar_ts)
          : 0;
    const bms =
      typeof b.bar_ts_ms === 'number' && Number.isFinite(b.bar_ts_ms)
        ? b.bar_ts_ms
        : b.bar_ts
          ? Date.parse(b.bar_ts)
          : 0;
    return ams - bms;
  });

  const retsBySym = new Map<string, number[]>();
  const lhsBySym = new Map<string, number>();
  const spreadBySym = new Map<string, number>();

  for (const b of sortedBars) {
    if (b.ret_bps !== null && b.ret_bps !== undefined && Number.isFinite(Number(b.ret_bps))) {
      const list = retsBySym.get(b.symbol) || [];
      list.push(Number(b.ret_bps));
      retsBySym.set(b.symbol, list);
    }
    if (b.lhs !== null && b.lhs !== undefined && Number.isFinite(Number(b.lhs))) {
      lhsBySym.set(b.symbol, Number(b.lhs));
    }
    if (b.spread_bps !== null && b.spread_bps !== undefined && Number.isFinite(Number(b.spread_bps))) {
      spreadBySym.set(b.symbol, Number(b.spread_bps));
    }
  }

  const alertCounts = new Map<string, { total: number; rare: number }>();
  for (const a of alerts) {
    const prev = alertCounts.get(a.symbol) || { total: 0, rare: 0 };
    prev.total += 1;
    if (a.priority === 'P1' || a.priority === 'P2') {
      prev.rare += 1;
    }
    alertCounts.set(a.symbol, prev);
  }

  return allSymbols.map((sym) => {
    const vol = sampleStd(retsBySym.get(sym) || []);
    const lhs = lhsBySym.get(sym) ?? null;
    const spread = spreadBySym.get(sym) ?? null;
    const ac = alertCounts.get(sym) || { total: 0, rare: 0 };
    return {
      symbol: sym,
      group: groupMap[sym] || 'thin',
      volatilityBps: vol !== null ? Math.round(vol * 100) / 100 : null,
      lhsLast: lhs !== null ? Math.round(lhs * 10) / 10 : null,
      spreadBps: spread !== null ? Math.round(spread * 100) / 100 : null,
      alertCount: ac.total,
      rareAlertCount: ac.rare,
    };
  });
}

export function getSignalRange(
  signals: SymbolSignal[],
  metric: 'volatilityBps' | 'lhsLast',
): SignalRange | null {
  const vals = signals
    .map((s) => s[metric])
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!vals.length) return null;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const med = medianOf(vals) ?? min;
  const mean = vals.reduce((acc, v) => acc + v, 0) / vals.length;
  return {
    min,
    max,
    median: Math.round(med * 100) / 100,
    mean: Math.round(mean * 100) / 100,
  };
}

export function getSliderBounds(
  mode: SignalFilterMode,
  range: SignalRange | null,
): SliderBounds {
  if (mode === 'high_vol') {
    return {
      min: Math.max(0, Math.floor(range?.min ?? 5) - 1),
      max: Math.ceil(range?.max ?? 40) + 2,
      step: 1,
    };
  }
  return {
    min: 0,
    max: 100,
    step: 2.5,
  };
}

export function computeMarkerPercent(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return 50;
  }
  const pct = ((value - min) / (max - min)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct * 100) / 100));
}

export function snapThresholdToStep(value: number, bounds: SliderBounds): number {
  const clamped = Math.max(bounds.min, Math.min(bounds.max, value));
  const steps = Math.round((clamped - bounds.min) / bounds.step);
  const snapped = bounds.min + steps * bounds.step;
  return Math.max(bounds.min, Math.min(bounds.max, Math.round(snapped * 100) / 100));
}

export function defaultThresholdForMode(
  mode: SignalFilterMode,
  signals: SymbolSignal[],
): number {
  if (mode === 'high_vol') {
    const range = getSignalRange(signals, 'volatilityBps');
    if (!range) return 20;
    const raw = Math.ceil(range.median);
    return Math.min(Math.max(raw, Math.floor(range.min)), Math.ceil(range.max));
  }
  if (mode === 'high_lhs') {
    const range = getSignalRange(signals, 'lhsLast');
    if (!range) return 70;
    const target = 70;
    if (target >= range.min && target <= range.max) return target;
    return Math.round(range.median / 5) * 5;
  }
  if (mode === 'low_lhs') {
    const range = getSignalRange(signals, 'lhsLast');
    if (!range) return 45;
    const target = 45;
    if (target >= range.min && target <= range.max) return target;
    return Math.round(range.median / 5) * 5;
  }
  return 0;
}

export function filterSymbolsBySignal(
  allSymbols: string[],
  signals: SymbolSignal[],
  mode: SignalFilterMode,
  threshold: number,
): string[] {
  if (mode === 'none') return allSymbols;
  const sigMap = new Map<string, SymbolSignal>();
  for (const s of signals) sigMap.set(s.symbol, s);

  return allSymbols.filter((sym) => {
    const sig = sigMap.get(sym);
    if (!sig) return false;
    if (mode === 'high_vol') {
      return sig.volatilityBps !== null && sig.volatilityBps >= threshold;
    }
    if (mode === 'high_lhs') {
      return sig.lhsLast !== null && sig.lhsLast >= threshold;
    }
    if (mode === 'low_lhs') {
      return sig.lhsLast !== null && sig.lhsLast <= threshold;
    }
    return true;
  });
}
