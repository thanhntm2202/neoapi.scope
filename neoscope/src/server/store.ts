import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import * as yaml from 'js-yaml';
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import type { AlertRow, BarRow, NeoScopeSettings, SnapRow } from './types.js';

export const REPO_ROOT = process.cwd();

export const SNAP_COLS = [
  'ts', 'seq', 'symbol', 'session_date', 'session', 'group', 'bucket',
  'mid', 'spread_bps', 'depth_bid_vnd', 'depth_ask_vnd', 'obi',
  'microprice', 'hhi_bid', 'hhi_ask', 'd_vol', 'd_val', 'd_f_net_val',
  'bid1', 'bid2', 'bid3', 'ask1', 'ask2', 'ask3',
  'bidvol1', 'bidvol2', 'bidvol3', 'askvol1', 'askvol2', 'askvol3',
  'last_price', 'cum_vol', 'cum_val', 'f_remain', 'f_room',
  'flags', 'n_flags', 'ref', 'ceiling', 'floor',
];

export const FLAG_DESCRIPTIONS: Record<string, string> = {
  NULL_FIELD: 'Trường quan trọng null — giữ NaN, không điền bừa',
  PARSE_FAIL: 'Ép kiểu thất bại — giữ NaN và ghi giá trị gốc vào log',
  ATO_ATC: "Giá mức 1 là 'ATO'/'ATC' — hợp lệ trong phiên định kỳ, loại khỏi tính toán sổ lệnh",
  DUPLICATE: 'Payload trùng hash trong cửa sổ khử lặp — loại bản ghi',
  OUT_OF_ORDER: 'Thông điệp đến không đúng thứ tự — giữ, sắp xếp lại theo (ts, seq)',
  LATE_ARRIVAL: 'Bộ đếm lũy kế mang trạng thái CŨ hơn bản ghi đã thấy — thông điệp đến muộn so với thứ tự sự kiện; delta NaN, state không lùi (bảo toàn tổng khối lượng)',
  STALE_GAP: 'Không có cập nhật quá ngưỡng trong phiên LO — đánh dấu khoảng trống',
  COUNTER_RESET: 'Bộ đếm lũy kế về 0 giữa phiên — reset thật (phiên mới/lỗi nguồn); delta NaN, state đặt lại',
  CROSSED_BOOK: 'Sổ lệnh bắt chéo ngoài phiên định kỳ — loại chỉ báo sổ lệnh tại tick',
  BEYOND_BAND: 'Giá ngoài [sàn, trần] — giữ bản ghi, loại giá trị phạm lệ',
  MISSING_LEVEL: 'Thiếu mức 2/3 — tính độ sâu trên các mức còn lại, ghi cờ',
  NO_BOOK: 'Không có mid hợp lệ — tick không dùng cho ước tính thực thi',
};

function normalizeValue(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  return v;
}

function normalizeRow(row: Record<string, unknown>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = normalizeValue(v);
  }
  return out;
}

export async function readParquet(filePath: string, columns?: string[]): Promise<Record<string, any>[]> {
  if (!fs.existsSync(filePath)) return [];
  const file = await asyncBufferFromFile(filePath);
  const rows = await parquetReadObjects({
    file,
    compressors,
    ...(columns ? { columns } : {}),
  });
  return rows.map(normalizeRow);
}

export function loadSettings(datasetOverride?: string): NeoScopeSettings {
  const settingsPath = path.join(REPO_ROOT, 'config', 'settings.yaml');
  const rawYaml = fs.readFileSync(settingsPath, 'utf-8');
  const data = yaml.load(rawYaml) as Record<string, any>;
  let mode = (process.env.NEOSCOPE_MODE || data.mode || 'SYNTHETIC').toUpperCase() as 'SYNTHETIC' | 'LIVE';
  let rawProvider = (process.env.NEOSCOPE_PROVIDER || data.provider || 'SSI').toUpperCase();

  if (datasetOverride) {
    const ov = datasetOverride.toUpperCase();
    if (ov === 'SYNTHETIC') {
      mode = 'SYNTHETIC';
    } else if (ov === 'LIVE_SSI') {
      mode = 'LIVE';
      rawProvider = 'SSI';
    } else if (ov === 'LIVE_NEO') {
      mode = 'LIVE';
      rawProvider = 'NEO';
    }
  }

  const provider = (mode === 'LIVE' ? rawProvider : 'SYNTHETIC') as 'SYNTHETIC' | 'SSI' | 'NEO';
  const dataset_mode = mode === 'SYNTHETIC' ? 'SYNTHETIC' : `LIVE_${provider}`;

  // Prefer summary.json config_hash if available so it matches the curated pipeline hash
  let configHash = crypto.createHash('sha256').update(rawYaml).digest('hex').slice(0, 16);
  const summaryPath = mode === 'LIVE'
    ? path.join(REPO_ROOT, 'data', 'results', provider, 'summary.json')
    : path.join(REPO_ROOT, 'data', 'results', 'summary.json');
  if (fs.existsSync(summaryPath)) {
    try {
      const s = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
      if (s.config_hash) configHash = s.config_hash;
    } catch {
      // ignore
    }
  }

  const large = Array.isArray(data.watchlist?.large) ? data.watchlist.large : [];
  const thin = Array.isArray(data.watchlist?.thin) ? data.watchlist.thin : [];

  return {
    mode,
    provider,
    dataset_mode,
    timezone: data.timezone || 'Asia/Ho_Chi_Minh',
    config_hash: configHash,
    watchlist: { large, thin },
    allSymbols: [...large, ...thin],
    execution: {
      participation_rate: Number(data.execution?.participation_rate ?? 0.15),
      horizon_s: Number(data.execution?.horizon_s ?? 180),
      pi_z: Number(data.execution?.pi_z ?? 1.6449),
      fee_rate: Number(data.execution?.fee_rate ?? 0.0015),
      sell_tax_rate: Number(data.execution?.sell_tax_rate ?? 0.001),
      order_sizes_vnd: [
        Number(data.execution?.order_sizes_vnd?.[0] ?? 50_000_000),
        Number(data.execution?.order_sizes_vnd?.[1] ?? 5_000_000_000),
      ],
    },
    bars: {
      freq_s: Number(data.bars?.freq_s ?? 60),
    },
  };
}

export function groupOf(settings: NeoScopeSettings, symbol: string): 'large' | 'thin' {
  return settings.watchlist.large.includes(symbol) ? 'large' : 'thin';
}

export function sessionDateOf(dirName: string): string {
  const parts = dirName.split('_');
  if (parts.length >= 2 && parts[0] === 'SYNTH') return parts[1];
  if (parts.length >= 3 && parts[0] === 'LIVE' && (parts[1] === 'SSI' || parts[1] === 'NEO')) {
    return parts[2];
  }
  return parts[parts.length - 1];
}

export function listSessionDirs(datasetMode: string): { name: string; date: string; rawDir: string; curatedDir: string }[] {
  const prefix = datasetMode === 'SYNTHETIC' ? 'SYNTH' : datasetMode;
  const curatedBase = path.join(REPO_ROOT, 'data', 'curated');
  const rawBase = path.join(REPO_ROOT, 'data', 'raw');
  if (!fs.existsSync(curatedBase)) return [];

  return fs
    .readdirSync(curatedBase, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith(`${prefix}_`))
    .map((d) => {
      const date = sessionDateOf(d.name);
      return {
        name: d.name,
        date,
        rawDir: path.join(rawBase, d.name),
        curatedDir: path.join(curatedBase, d.name),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

export function listAvailableDatasets(): { id: string; label: string; sessions: number }[] {
  const candidates = [
    { id: 'SYNTHETIC', label: 'SYNTHETIC · Mô phỏng' },
    { id: 'LIVE_SSI', label: 'LIVE · SSI FastConnect v3' },
    { id: 'LIVE_NEO', label: 'LIVE · VPBankS NEO API' },
  ];
  return candidates.map((c) => ({
    ...c,
    sessions: listSessionDirs(c.id).length,
  }));
}

export function readLiveStatus(provider: string): Record<string, any> | null {
  if (provider !== 'SSI' && provider !== 'NEO') return null;
  const p = path.join(REPO_ROOT, 'data', `live_status_${provider.toLowerCase()}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

export function formatVnTimestamp(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return String(isoOrDate);
  // Format in Asia/Ho_Chi_Minh (UTC+7)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return `${map.hour}:${map.minute}:${map.second} ${map.day}/${map.month}/${map.year} (UTC+7)`;
}

export function formatVnTimeOnly(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
}

class DataCache {
  private snapsBySession = new Map<string, SnapRow[]>();
  private barsBySession = new Map<string, BarRow[]>();
  private indicesBySession = new Map<string, Record<string, any>[]>();
  private resultsCache = new Map<string, Record<string, any>[]>();
  private summaryCache = new Map<string, Record<string, any>>();
  private qualityCache = new Map<string, { quality: Record<string, any>[]; quality_meta: Record<string, any>[] }>();
  private manifestsCache = new Map<string, Record<string, any>[]>();

  clear() {
    this.snapsBySession.clear();
    this.barsBySession.clear();
    this.indicesBySession.clear();
    this.resultsCache.clear();
    this.summaryCache.clear();
    this.qualityCache.clear();
    this.manifestsCache.clear();
  }

  getSummary(settings: NeoScopeSettings): Record<string, any> {
    if (this.summaryCache.has(settings.dataset_mode)) {
      return this.summaryCache.get(settings.dataset_mode)!;
    }
    const base = settings.mode === 'LIVE'
      ? path.join(REPO_ROOT, 'data', 'results', settings.provider)
      : path.join(REPO_ROOT, 'data', 'results');
    const p = path.join(base, 'summary.json');
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
      this.summaryCache.set(settings.dataset_mode, parsed);
      return parsed;
    }
    return {};
  }

  async getResult(settings: NeoScopeSettings, name: string): Promise<Record<string, any>[]> {
    const key = `${settings.dataset_mode}:${name}`;
    if (this.resultsCache.has(key)) return this.resultsCache.get(key)!;
    const base = settings.mode === 'LIVE'
      ? path.join(REPO_ROOT, 'data', 'results', settings.provider)
      : path.join(REPO_ROOT, 'data', 'results');
    const p = path.join(base, `${name}.parquet`);
    const rows = await readParquet(p);
    if (name === 'alerts') {
      for (const r of rows) {
        r.ts_ms = r.ts ? new Date(r.ts).getTime() : 0;
      }
    } else if (name === 'bars_lhs') {
      for (const r of rows) {
        r.bar_ts_ms = r.bar_ts ? new Date(r.bar_ts).getTime() : 0;
      }
    }
    this.resultsCache.set(key, rows);
    return rows;
  }

  async getSnaps(settings: NeoScopeSettings, sessionDate: string): Promise<SnapRow[]> {
    const key = `${settings.dataset_mode}:${sessionDate}`;
    if (this.snapsBySession.has(key)) return this.snapsBySession.get(key)!;
    const dir = listSessionDirs(settings.dataset_mode).find((d) => d.date === sessionDate);
    if (!dir) return [];
    const rows = (await readParquet(path.join(dir.curatedDir, 'snapshots.parquet'), SNAP_COLS)) as SnapRow[];
    for (const r of rows) {
      r.ts_ms = r.ts ? new Date(r.ts).getTime() : 0;
    }
    rows.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.ts_ms - b.ts_ms);
    this.snapsBySession.set(key, rows);
    return rows;
  }

  async getBars(settings: NeoScopeSettings, sessionDate: string): Promise<BarRow[]> {
    const key = `${settings.dataset_mode}:${sessionDate}`;
    if (this.barsBySession.has(key)) return this.barsBySession.get(key)!;
    const dir = listSessionDirs(settings.dataset_mode).find((d) => d.date === sessionDate);
    if (!dir) return [];
    const rows = (await readParquet(path.join(dir.curatedDir, 'bars.parquet'))) as BarRow[];
    for (const r of rows) {
      r.bar_ts_ms = r.bar_ts ? new Date(r.bar_ts).getTime() : 0;
    }
    rows.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.bar_ts_ms - b.bar_ts_ms);
    this.barsBySession.set(key, rows);
    return rows;
  }

  async getIndices(settings: NeoScopeSettings, sessionDate: string): Promise<Record<string, any>[]> {
    const key = `${settings.dataset_mode}:${sessionDate}`;
    if (this.indicesBySession.has(key)) return this.indicesBySession.get(key)!;
    const dir = listSessionDirs(settings.dataset_mode).find((d) => d.date === sessionDate);
    if (!dir) return [];
    const rows = await readParquet(path.join(dir.curatedDir, 'indices.parquet'));
    rows.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    this.indicesBySession.set(key, rows);
    return rows;
  }

  async getQuality(settings: NeoScopeSettings): Promise<{ quality: Record<string, any>[]; quality_meta: Record<string, any>[] }> {
    if (this.qualityCache.has(settings.dataset_mode)) {
      return this.qualityCache.get(settings.dataset_mode)!;
    }
    const dirs = listSessionDirs(settings.dataset_mode);
    const quality: Record<string, any>[] = [];
    const quality_meta: Record<string, any>[] = [];
    for (const d of dirs) {
      const q = await readParquet(path.join(d.curatedDir, 'quality.parquet'));
      const m = await readParquet(path.join(d.curatedDir, 'quality_meta.parquet'));
      quality.push(...q);
      quality_meta.push(...m);
    }
    const bundle = { quality, quality_meta };
    this.qualityCache.set(settings.dataset_mode, bundle);
    return bundle;
  }

  getManifests(settings: NeoScopeSettings): Record<string, any>[] {
    if (this.manifestsCache.has(settings.dataset_mode)) {
      return this.manifestsCache.get(settings.dataset_mode)!;
    }
    const dirs = listSessionDirs(settings.dataset_mode);
    const out: Record<string, any>[] = [];
    for (const d of dirs) {
      const mp = path.join(d.rawDir, 'manifest.json');
      if (fs.existsSync(mp)) {
        const man = JSON.parse(fs.readFileSync(mp, 'utf-8'));
        out.push({ session_dir: d.name, date: d.date, ...man });
      }
    }
    this.manifestsCache.set(settings.dataset_mode, out);
    return out;
  }

  getTruthEvents(settings: NeoScopeSettings, sessionDate: string, symbol: string): Record<string, any>[] {
    if (settings.mode !== 'SYNTHETIC') return [];
    const p = path.join(REPO_ROOT, 'data', 'raw', `SYNTH_${sessionDate}`, 'events_truth.json');
    if (!fs.existsSync(p)) return [];
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      const events = Array.isArray(data.events) ? data.events : [];
      return events.filter((e: any) => e.symbol === symbol);
    } catch {
      return [];
    }
  }

  async getAllBarsForDates(settings: NeoScopeSettings, dates: string[]): Promise<BarRow[]> {
    const all: BarRow[] = [];
    for (const d of dates) {
      const b = await this.getBars(settings, d);
      all.push(...b);
    }
    return all;
  }

  async getAlerts(settings: NeoScopeSettings): Promise<AlertRow[]> {
    return (await this.getResult(settings, 'alerts')) as AlertRow[];
  }
}

export const dataCache = new DataCache();
