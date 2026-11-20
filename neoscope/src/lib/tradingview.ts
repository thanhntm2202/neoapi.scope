import { toVnIsoLocal } from './format';

export type TapeWindowId = 'ALL' | 'AM' | 'PM' | '1H' | '30M';

export type WatchlistSortKey =
  | 'symbol'
  | 'groupLabel'
  | 'lhs'
  | 'midLast'
  | 'spreadBps'
  | 'volatilityBps'
  | 'depthBidB'
  | 'obi'
  | 'cumVolM';

export type SortDir = 'asc' | 'desc';

export interface TapeRowLike {
  ts: string;
  ts_ms?: number;
  mid?: number | null;
  last_price?: number | null;
  depth_bid_vnd?: number | null;
  depth_ask_vnd?: number | null;
  spread_bps?: number | null;
}

export interface WatchlistRowLike {
  symbol: string;
  group?: string;
  groupLabel?: string;
  lhsSeries?: number[];
  midLast?: number | null;
  spreadBps?: number | null;
  volatilityBps?: number | null;
  depthBidB?: number | null;
  obi?: number | null;
  cumVolM?: number | null;
  alertCount?: number;
  rareAlertCount?: number;
}

function getTsMs(row: TapeRowLike): number {
  if (typeof row.ts_ms === 'number' && Number.isFinite(row.ts_ms)) {
    return row.ts_ms;
  }
  const parsed = Date.parse(row.ts);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getVnHhMmNumber(iso: string): number {
  const vnLocal = toVnIsoLocal(iso);
  const timePart = vnLocal.split('T')[1] || '';
  const [hh, mm] = timePart.split(':');
  const h = Number(hh);
  const m = Number(mm);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return -1;
  return h * 100 + m;
}

export function filterTapeWindow<T extends TapeRowLike>(rows: T[], windowId: TapeWindowId): T[] {
  if (!rows.length || windowId === 'ALL') return rows;
  if (windowId === 'AM') {
    return rows.filter((r) => {
      const hhmm = getVnHhMmNumber(r.ts);
      return hhmm >= 0 && hhmm < 1200;
    });
  }
  if (windowId === 'PM') {
    return rows.filter((r) => getVnHhMmNumber(r.ts) >= 1200);
  }
  let maxMs = -Infinity;
  for (const r of rows) {
    const ms = getTsMs(r);
    if (ms > maxMs) maxMs = ms;
  }
  if (!Number.isFinite(maxMs)) return rows;
  const spanMs = windowId === '1H' ? 3600_000 : 1800_000;
  const cutoff = maxMs - spanMs;
  return rows.filter((r) => getTsMs(r) >= cutoff);
}

export function getLatestLhs(row: WatchlistRowLike): number | null {
  const series = row.lhsSeries;
  if (!series || !series.length) return null;
  const last = series[series.length - 1];
  return typeof last === 'number' && Number.isFinite(last) ? last : null;
}

export function sortWatchlist<T extends WatchlistRowLike>(
  rows: T[],
  sortKey: WatchlistSortKey,
  sortDir: SortDir,
): T[] {
  const factor = sortDir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sortKey === 'symbol' || sortKey === 'groupLabel') {
      const av = String(a[sortKey] ?? '');
      const bv = String(b[sortKey] ?? '');
      return av.localeCompare(bv, 'en') * factor;
    }
    const av = sortKey === 'lhs' ? getLatestLhs(a) : (a[sortKey] as number | null | undefined);
    const bv = sortKey === 'lhs' ? getLatestLhs(b) : (b[sortKey] as number | null | undefined);
    const aValid = typeof av === 'number' && Number.isFinite(av);
    const bValid = typeof bv === 'number' && Number.isFinite(bv);
    if (!aValid && !bValid) return a.symbol.localeCompare(b.symbol, 'en');
    if (!aValid) return 1;
    if (!bValid) return -1;
    if (av === bv) return a.symbol.localeCompare(b.symbol, 'en');
    return (av - bv) * factor;
  });
}

export interface PaletteSymbolItem {
  symbol: string;
  groupLabel: string;
  group: string;
  midLast: number | null;
  spreadBps: number | null;
  lhsLast: number | null;
}

export function filterSymbolsByQuery(
  allSymbols: string[],
  watchlist: WatchlistRowLike[],
  query: string,
): PaletteSymbolItem[] {
  const q = query.trim().toLowerCase();
  const wlMap = new Map<string, WatchlistRowLike>();
  for (const w of watchlist) wlMap.set(w.symbol, w);

  return allSymbols
    .filter((sym) => {
      if (!q) return true;
      const meta = wlMap.get(sym);
      const grp = (meta?.groupLabel || '').toLowerCase();
      return sym.toLowerCase().includes(q) || grp.includes(q);
    })
    .map((sym) => {
      const meta = wlMap.get(sym);
      return {
        symbol: sym,
        group: meta?.group || 'large',
        groupLabel: meta?.groupLabel || 'Theo dõi',
        midLast: meta?.midLast ?? null,
        spreadBps: meta?.spreadBps ?? null,
        lhsLast: meta ? getLatestLhs(meta) : null,
      };
    });
}

export type HeatmapMetric = 'lhs' | 'spread_bps' | 'depth_bid_vnd';

export interface HeatmapBarLike {
  symbol: string;
  bar_ts: string;
  bar_ts_ms?: number;
  lhs?: number | null;
  spread_bps?: number | null;
  depth_bid_vnd?: number | null;
}

export interface IntradayHeatmapMatrix {
  xLabels: string[];
  ySymbols: string[];
  z: (number | null)[][];
}

function getVnSlot15Label(iso: string): string | null {
  const vnLocal = toVnIsoLocal(iso);
  const timePart = vnLocal.split('T')[1] || '';
  const [hhStr, mmStr] = timePart.split(':');
  const hh = Number(hhStr);
  const mm = Number(mmStr);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  const floored = Math.floor(mm / 15) * 15;
  return `${String(hh).padStart(2, '0')}:${String(floored).padStart(2, '0')}`;
}

export function buildIntradayHeatmapMatrix(
  bars: HeatmapBarLike[],
  symbols: string[],
  metric: HeatmapMetric,
): IntradayHeatmapMatrix {
  const symSet = new Set(symbols);
  const slotSet = new Set<string>();
  const agg = new Map<string, { sum: number; count: number }>();

  for (const b of bars) {
    if (!symSet.has(b.symbol)) continue;
    const rawVal = b[metric];
    if (rawVal === null || rawVal === undefined || !Number.isFinite(Number(rawVal))) continue;
    const slot = getVnSlot15Label(b.bar_ts);
    if (!slot) continue;
    slotSet.add(slot);
    const val = metric === 'depth_bid_vnd' ? Number(rawVal) / 1e9 : Number(rawVal);
    const key = `${b.symbol}|${slot}`;
    const entry = agg.get(key) || { sum: 0, count: 0 };
    entry.sum += val;
    entry.count += 1;
    agg.set(key, entry);
  }

  const xLabels = Array.from(slotSet).sort((a, b) => a.localeCompare(b, 'en'));
  const ySymbols = [...symbols].reverse();
  const z = ySymbols.map((sym) =>
    xLabels.map((slot) => {
      const entry = agg.get(`${sym}|${slot}`);
      if (!entry || entry.count <= 0) return null;
      return Math.round((entry.sum / entry.count) * 100) / 100;
    }),
  );

  return { xLabels, ySymbols, z };
}
