export type PageId =
  | 'overview'
  | 'liquidity'
  | 'execution-cost'
  | 'alerts'
  | 'validation'
  | 'data-quality'
  | 'methodology';

export interface BootstrapData {
  mode: 'SYNTHETIC' | 'LIVE';
  provider: 'SYNTHETIC' | 'SSI' | 'NEO';
  datasetMode: string;
  configHash: string;
  sessions: string[];
  allSymbols: string[];
  defaultWatchlist: string[];
  freshness: string;
  summary: Record<string, unknown>;
  allSnapsCount: number;
  liveStatus: Record<string, unknown> | null;
}

export interface DeltaChip {
  text: string;
  dir: 'up' | 'down' | 'flat';
}

export interface OverviewData {
  kpis: {
    latestCount: number;
    spreadNow: number | null;
    spreadDelta: DeltaChip;
    depthNow: number | null;
    depthDelta: DeltaChip;
    lhsNow: number | null;
    lhsDelta: DeltaChip;
    rareCount: number;
    alertCount: number;
  };
  alertPulse: {
    priority: string;
    title: string;
    sub: string;
    time: string;
  }[];
  indicesDay: Record<string, unknown>[];
  lhsRanking: Record<string, unknown>[];
  lhsRankingTime: string;
  tapeSyms: string[];
  tapeSymbol: string;
  tapeRows: {
    ts_vn: string;
    mid: number | null;
    last_price: number | null;
    depth_bid_vnd: number | null;
    depth_ask_vnd: number | null;
  }[];
  watchlistRows: {
    symbol: string;
    groupLabel: string;
    lhsSeries: number[];
    mid: number | null;
    spreadBps: number | null;
    depthBidB: number | null;
    obi: number | null;
    cumVolM: number | null;
  }[];
  narrative?: {
    headline: string;
    bullets: string[];
    caveat: string;
  };
}

export interface FrontierPoint {
  notionalVnd: number;
  notionalLabel: string;
  qty: number;
  coveragePct: number;
  fullBps: number;
  loBps: number;
  hiBps: number;
  ladderBps: number;
  naiveBps: number;
}

export interface ProviderStatusData {
  provider: 'SSI' | 'NEO' | 'SYNTHETIC';
  mode: 'SYNTHETIC' | 'LIVE';
  apiUrl: string;
  streamingUrl: string;
  rateLimitRps: number;
  hasClientId: boolean;
  hasApiKey: boolean;
  hasApiSecret: boolean;
  readyForLiveRest: boolean;
  neoBackupReady: boolean;
}

export interface SsiConnectionTestData {
  ok: boolean;
  checkedAtVn: string;
  statusCode: number | null;
  latencyMs: number;
  stage: 'CREDENTIALS' | 'RATE_LIMIT' | 'AUTH_TOKEN' | 'SECURITIES';
  message: string;
}

