import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { load as loadYaml } from 'js-yaml';

export interface SettingsData {
  mode: 'SYNTHETIC' | 'LIVE';
  provider: 'SYNTHETIC' | 'SSI' | 'NEO';
  timezone: string;
  paths: {
    data_dir: string;
    results_dir: string;
    sample_dir?: string;
  };
  watchlist: {
    large: string[];
    thin: string[];
  };
  indices: string[];
  bars: {
    freq_s: number;
  };
  execution: {
    participation_rate: number;
    horizon_s: number;
    pi_z: number;
    fee_rate: number;
    sell_tax_rate: number;
    order_sizes_vnd: [number, number];
    orders_per_symbol_session: number;
  };
  [key: string]: unknown;
}

export interface NeoScopeSettings {
  repoRoot: string;
  data: SettingsData;
  mode: 'SYNTHETIC' | 'LIVE';
  provider: 'SYNTHETIC' | 'SSI' | 'NEO';
  datasetMode: string;
  configHash: string;
  watchlist: string[];
  groupOf: (symbol: string) => 'large' | 'thin';
  dataPath: (...parts: string[]) => string;
  resultsPath: (...parts: string[]) => string;
  docsPath: (...parts: string[]) => string;
}

export function resolveRepoRoot(): string {
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, 'config', 'settings.yaml')) && fs.existsSync(path.join(cwd, 'data'))) {
    return cwd;
  }
  if (fs.existsSync(path.join(cwd, 'neoscope', 'config', 'settings.yaml'))) {
    return path.join(cwd, 'neoscope');
  }
  return cwd;
}

export function loadSettings(datasetOverride?: string): NeoScopeSettings {
  const cwd = process.cwd();
  dotenv.config({ path: path.join(cwd, '.env'), override: false });
  const repoRoot = resolveRepoRoot();
  dotenv.config({ path: path.join(repoRoot, '.env'), override: false });

  const settingsPath = path.join(repoRoot, 'config', 'settings.yaml');
  const rawYaml = fs.readFileSync(settingsPath, 'utf-8');
  const parsed = (loadYaml(rawYaml) || {}) as SettingsData;

  let envMode = (process.env.NEOSCOPE_MODE || parsed.mode || 'SYNTHETIC').toUpperCase();
  let envProvider = (process.env.NEOSCOPE_PROVIDER || parsed.provider || 'SSI').toUpperCase();
  if (datasetOverride) {
    const ov = datasetOverride.toUpperCase();
    if (ov === 'SYNTHETIC') {
      envMode = 'SYNTHETIC';
    } else if (ov === 'LIVE_SSI' || ov === 'SSI') {
      envMode = 'LIVE';
      envProvider = 'SSI';
    } else if (ov === 'LIVE_NEO' || ov === 'NEO') {
      envMode = 'LIVE';
      envProvider = 'NEO';
    }
  }

  const mode: 'SYNTHETIC' | 'LIVE' = envMode === 'LIVE' ? 'LIVE' : 'SYNTHETIC';
  const activeProvider: 'SSI' | 'NEO' = envProvider === 'NEO' ? 'NEO' : 'SSI';

  const provider: 'SYNTHETIC' | 'SSI' | 'NEO' = mode === 'LIVE' ? activeProvider : 'SYNTHETIC';
  parsed.mode = mode;
  parsed.provider = provider;

  const canonical = JSON.stringify(sortKeys(parsed));
  const configHash = crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);

  const largeSet = new Set(parsed.watchlist?.large || []);
  const watchlist = [...(parsed.watchlist?.large || []), ...(parsed.watchlist?.thin || [])];

  return {
    repoRoot,
    data: parsed,
    mode,
    provider,
    datasetMode: mode === 'SYNTHETIC' ? 'SYNTHETIC' : `LIVE_${provider}`,
    configHash,
    watchlist,
    groupOf: (symbol: string) => (largeSet.has(symbol) ? 'large' : 'thin'),
    dataPath: (...parts: string[]) => path.join(repoRoot, parsed.paths?.data_dir || 'data', ...parts),
    resultsPath: (...parts: string[]) => {
      const base = path.join(repoRoot, parsed.paths?.results_dir || 'data/results');
      return mode === 'LIVE' ? path.join(base, provider, ...parts) : path.join(base, ...parts);
    },
    docsPath: (...parts: string[]) => path.join(repoRoot, 'docs', ...parts),
  };
}

function sortKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(sortKeys);
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj as Record<string, unknown>).sort()) {
      out[k] = sortKeys((obj as Record<string, unknown>)[k]);
    }
    return out;
  }
  return obj;
}
