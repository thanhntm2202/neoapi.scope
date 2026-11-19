import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import type { NeoScopeSettings } from './config.ts';

export const SNAP_COLS = [
  'ts', 'seq', 'symbol', 'session_date', 'session', 'group', 'bucket',
  'mid', 'spread_bps', 'depth_bid_vnd', 'depth_ask_vnd', 'obi',
  'microprice', 'hhi_bid', 'hhi_ask', 'd_vol', 'd_val', 'd_f_net_val',
  'bid1', 'bid2', 'bid3', 'ask1', 'ask2', 'ask3',
  'bidvol1', 'bidvol2', 'bidvol3', 'askvol1', 'askvol2', 'askvol3',
  'last_price', 'cum_vol', 'cum_val', 'f_remain', 'f_room',
  'flags', 'n_flags', 'ref', 'ceiling', 'floor',
];

const VN_OFFSET_MS = 7 * 3600 * 1000;

export function toVnIso(dateOrMs: Date | number | string): string {
  const ms =
    dateOrMs instanceof Date
      ? dateOrMs.getTime()
      : typeof dateOrMs === 'number'
        ? dateOrMs
        : Date.parse(dateOrMs);
  if (!Number.isFinite(ms)) return '';
  const vn = new Date(ms + VN_OFFSET_MS);
  const yyyy = vn.getUTCFullYear();
  const mm = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(vn.getUTCDate()).padStart(2, '0');
  const hh = String(vn.getUTCHours()).padStart(2, '0');
  const mi = String(vn.getUTCMinutes()).padStart(2, '0');
  const ss = String(vn.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
}

export function formatVnTime(ms: number): string {
  const vn = new Date(ms + VN_OFFSET_MS);
  const hh = String(vn.getUTCHours()).padStart(2, '0');
  const mi = String(vn.getUTCMinutes()).padStart(2, '0');
  const ss = String(vn.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mi}:${ss}`;
}

export function formatVnHm(ms: number): string {
  const vn = new Date(ms + VN_OFFSET_MS);
  const hh = String(vn.getUTCHours()).padStart(2, '0');
  const mi = String(vn.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mi}`;
}

export function formatVnFreshness(ms: number): string {
  const vn = new Date(ms + VN_OFFSET_MS);
  const hh = String(vn.getUTCHours()).padStart(2, '0');
  const mi = String(vn.getUTCMinutes()).padStart(2, '0');
  const ss = String(vn.getUTCSeconds()).padStart(2, '0');
  const dd = String(vn.getUTCDate()).padStart(2, '0');
  const mm = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = vn.getUTCFullYear();
  return `${hh}:${mi}:${ss} ${dd}/${mm}/${yyyy} (UTC+7)`;
}

function normalizeValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return v.getTime();
  if (Array.isArray(v)) return v.map(normalizeValue);
  return v;
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(row)) {
    if (val instanceof Date) {
      const ms = val.getTime();
      out[k] = ms;
      out[`${k}_vn`] = toVnIso(ms);
    } else {
      out[k] = normalizeValue(val);
    }
  }
  return out;
}

export async function readParquetFile(
  filePath: string,
  columns?: string[],
): Promise<Record<string, unknown>[]> {
  if (!fs.existsSync(filePath)) return [];
  const buf = await fsp.readFile(filePath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const rows = await parquetReadObjects({
    file: ab,
    compressors,
    ...(columns ? { columns } : {}),
  });
  return rows.map((r) => normalizeRow(r as Record<string, unknown>));
}

export function listSessionDirs(dataRoot: string, datasetMode: string): string[] {
  const curatedDir = path.join(dataRoot, 'curated');
  if (!fs.existsSync(curatedDir)) return [];
  const prefix = datasetMode === 'SYNTHETIC' ? 'SYNTH_' : `${datasetMode}_`;
  return fs
    .readdirSync(curatedDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith(prefix))
    .map((d) => d.name)
    .sort();
}

export function sessionDateOf(dirName: string): string {
  const idx = dirName.lastIndexOf('_');
  return idx >= 0 ? dirName.slice(idx + 1) : dirName;
}

export interface SnapRow {
  ts: number;
  ts_vn: string;
  seq: number;
  symbol: string;
  session_date: string;
  session: string;
  group: 'large' | 'thin';
  bucket: number;
  mid: number | null;
  spread_bps: number | null;
  depth_bid_vnd: number | null;
  depth_ask_vnd: number | null;
  obi: number | null;
  microprice: number | null;
  hhi_bid: number | null;
  hhi_ask: number | null;
  d_vol: number | null;
  d_val: number | null;
  d_f_net_val: number | null;
  bid1: number | null;
  bid2: number | null;
  bid3: number | null;
  ask1: number | null;
  ask2: number | null;
  ask3: number | null;
  bidvol1: number | null;
  bidvol2: number | null;
  bidvol3: number | null;
  askvol1: number | null;
  askvol2: number | null;
  askvol3: number | null;
  last_price: number | null;
  cum_vol: number | null;
  cum_val: number | null;
  f_remain: number | null;
  f_room: number | null;
  flags: string[];
  n_flags: number;
  ref: number | null;
  ceiling: number | null;
  floor: number | null;
}

export interface BarRow {
  symbol: string;
  bar_ts: number;
  bar_ts_vn: string;
  mid_open: number | null;
  mid_close: number | null;
  mid_high: number | null;
  mid_low: number | null;
  spread_bps: number | null;
  depth_bid_vnd: number | null;
  depth_ask_vnd: number | null;
  obi_mean: number | null;
  obi_last: number | null;
  d_vol: number | null;
  d_val: number | null;
  session_date: string;
  group: 'large' | 'thin';
  ret_bps: number | null;
  illiq: number | null;
  bucket: number;
  lhs?: number | null;
  r_tightness?: number | null;
  r_depth?: number | null;
  r_immediacy?: number | null;
  r_stability?: number | null;
  r_balance?: number | null;
}

export interface CachedDataset {
  sessions: string[];
  sessionDirs: string[];
  snapsBySession: Map<string, SnapRow[]>;
  allSnapsCount: number;
  maxTs: number;
  allSymbols: string[];
  bars: BarRow[];
  indices: Record<string, unknown>[];
  quality: Record<string, unknown>[];
  qualityMeta: Record<string, unknown>[];
  manifests: Record<string, unknown>[];
  summary: Record<string, unknown>;
  results: Record<string, Record<string, unknown>[]>;
}

let cachedDataset: CachedDataset | null = null;
let loadingPromise: Promise<CachedDataset> | null = null;

export function clearDatasetCache(): void {
  cachedDataset = null;
  loadingPromise = null;
}

export async function getDataset(settings: NeoScopeSettings): Promise<CachedDataset> {
  if (cachedDataset) return cachedDataset;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const dataRoot = settings.dataPath();
    const sessionDirs = listSessionDirs(dataRoot, settings.datasetMode);
    const snapsBySession = new Map<string, SnapRow[]>();
    const symbolSet = new Set<string>();
    let maxTs = 0;
    let allSnapsCount = 0;

    const bars: BarRow[] = [];
    const indices: Record<string, unknown>[] = [];
    const quality: Record<string, unknown>[] = [];
    const qualityMeta: Record<string, unknown>[] = [];
    const manifests: Record<string, unknown>[] = [];

    for (const dirName of sessionDirs) {
      const sDate = sessionDateOf(dirName);
      const curatedDir = path.join(dataRoot, 'curated', dirName);
      const rawDir = path.join(dataRoot, 'raw', dirName);

      const [snapRows, barRows, idxRows, qRows, qmRows] = await Promise.all([
        readParquetFile(path.join(curatedDir, 'snapshots.parquet'), SNAP_COLS),
        readParquetFile(path.join(curatedDir, 'bars.parquet')),
        readParquetFile(path.join(curatedDir, 'indices.parquet')),
        readParquetFile(path.join(curatedDir, 'quality.parquet')),
        readParquetFile(path.join(curatedDir, 'quality_meta.parquet')),
      ]);

      const typedSnaps = (snapRows as unknown as SnapRow[]).sort((a, b) => {
        if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);
        return a.ts - b.ts;
      });
      for (const r of typedSnaps) {
        symbolSet.add(r.symbol);
        if (r.ts > maxTs) maxTs = r.ts;
      }
      allSnapsCount += typedSnaps.length;
      snapsBySession.set(sDate, typedSnaps);

      bars.push(...(barRows as unknown as BarRow[]));
      indices.push(...idxRows);
      quality.push(...qRows);
      qualityMeta.push(...qmRows);

      const manPath = path.join(rawDir, 'manifest.json');
      if (fs.existsSync(manPath)) {
        try {
          const man = JSON.parse(fs.readFileSync(manPath, 'utf-8')) as Record<string, unknown>;
          manifests.push({ session_dir: dirName, date: sDate, ...man });
        } catch {
          manifests.push({ session_dir: dirName, date: sDate });
        }
      }
    }

    const RESULT_FILES = [
      'bars_lhs', 'metrics', 'metrics_coverage', 'predictions', 'orders',
      'fold_params', 'coverage', 'alerts', 'alert_pr',
      'lhs_ic', 'lhs_sensitivity', 'obi_direction', 'resilience',
    ];
    const results: Record<string, Record<string, unknown>[]> = {};
    await Promise.all(
      RESULT_FILES.map(async (name) => {
        results[name] = await readParquetFile(settings.resultsPath(`${name}.parquet`));
      }),
    );

    let summary: Record<string, unknown> = {};
    const sumPath = settings.resultsPath('summary.json');
    if (fs.existsSync(sumPath)) {
      try {
        summary = JSON.parse(fs.readFileSync(sumPath, 'utf-8')) as Record<string, unknown>;
      } catch {
        summary = {};
      }
    }

    const sessions = Array.from(snapsBySession.keys()).sort();
    const allSymbols = Array.from(symbolSet).sort();

    cachedDataset = {
      sessions,
      sessionDirs,
      snapsBySession,
      allSnapsCount,
      maxTs,
      allSymbols,
      bars,
      indices,
      quality,
      qualityMeta,
      manifests,
      summary,
      results,
    };
    return cachedDataset;
  })();

  try {
    return await loadingPromise;
  } catch (err) {
    loadingPromise = null;
    throw err;
  }
}
