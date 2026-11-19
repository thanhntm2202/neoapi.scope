export interface NeoScopeSettings {
  mode: 'SYNTHETIC' | 'LIVE';
  provider: 'SYNTHETIC' | 'SSI' | 'NEO';
  dataset_mode: string;
  timezone: string;
  config_hash: string;
  watchlist: {
    large: string[];
    thin: string[];
  };
  allSymbols: string[];
  execution: {
    participation_rate: number;
    horizon_s: number;
    pi_z: number;
    fee_rate: number;
    sell_tax_rate: number;
    order_sizes_vnd: [number, number];
  };
  bars: {
    freq_s: number;
  };
}

export interface SnapRow {
  ts: string;
  ts_ms: number;
  seq: number;
  symbol: string;
  session_date: string;
  session: string;
  group: string;
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
  flags: string | null;
  n_flags: number;
  ref: number | null;
  ceiling: number | null;
  floor: number | null;
}

export interface BarRow {
  symbol: string;
  bar_ts: string;
  bar_ts_ms: number;
  session_date: string;
  group: string;
  bucket: number;
  d_vol: number | null;
  ret_bps: number | null;
  spread_bps: number | null;
  depth_bid_vnd: number | null;
  depth_ask_vnd: number | null;
  obi_last: number | null;
  illiq: number | null;
  lhs?: number | null;
  r_tightness?: number | null;
  r_depth?: number | null;
  r_immediacy?: number | null;
  r_stability?: number | null;
  r_balance?: number | null;
}

export interface AlertRow {
  session_date: string;
  symbol: string;
  group: string;
  ts: string;
  ts_ms: number;
  type: string;
  direction: string;
  priority: string;
  scale: string;
  value: number;
  signed_value: number;
  mu: number;
  sigma: number;
  z: number;
  pct: number;
  bucket: number;
  n_train: number;
}
