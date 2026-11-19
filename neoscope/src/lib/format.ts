export const C_LARGE = '#29b6f6';
export const C_THIN = '#f59e0b';
export const C_ACCENT = '#2962ff';
export const C_BAD = '#ef5350';
export const C_GOOD = '#26a69a';
export const C_GRID = '#242938';
export const C_TEXT = '#d1d4dc';
export const C_MUTED = '#787b86';

export const GROUP_COLORS: Record<string, string> = {
  large: C_LARGE,
  thin: C_THIN,
};

export const MODEL_COLORS: Record<string, string> = {
  naive_mid: '#787b86',
  ladder_only: '#f59e0b',
  full: '#2962ff',
};

export function fmtVnd(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  if (Math.abs(x) >= 1e9) return `${(x / 1e9).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} tỷ`;
  if (Math.abs(x) >= 1e6) return `${(x / 1e6).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} triệu`;
  return Math.round(x).toLocaleString('en-US');
}

export function fmtNum(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  return x.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Convert UTC ISO timestamp into naive Asia/Ho_Chi_Minh ISO string (YYYY-MM-DDTHH:mm:ss) for Plotly UTC+7 display. */
export function toVnIsoLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat('en-CA', {
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
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}`;
}

export function fmtVnHm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

export function fmtVnHms(iso: string): string {
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

export function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const escape = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const csv = '\uFEFF' + [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const ALERT_TYPE_META: Record<string, { label: string; desc: string }> = {
  SPREAD_WIDEN: {
    label: 'Spread Widen',
    desc: 'Chênh lệch giá mua–bán (spread) giãn rộng bất thường so với nền giờ giao dịch',
  },
  DEPTH_EVAPORATION: {
    label: 'Depth Evaporation',
    desc: 'Tổng khối lượng chờ mua/bán 3 mức giá suy giảm đột ngột (bốc hơi độ sâu)',
  },
  OBI_EXTREME: {
    label: 'OBI Extreme',
    desc: 'Mất cân bằng sổ lệnh (OBI) nghiêng hẳn về một phía mua hoặc bán',
  },
  TRADE_BURST: {
    label: 'Trade Burst',
    desc: 'Khối lượng khớp lệnh trong cửa sổ 5 giây tăng vọt bất thường',
  },
  FOREIGN_BURST: {
    label: 'Foreign Burst',
    desc: 'Cường độ mua/bán của nhà đầu tư nước ngoài tăng mạnh đột ngột',
  },
};

export function fmtAlertType(code: string | null | undefined): string {
  if (!code) return '—';
  if (ALERT_TYPE_META[code]?.label) return ALERT_TYPE_META[code].label;
  return code
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function fmtAlertTypeDesc(code: string | null | undefined): string {
  if (!code) return '';
  return ALERT_TYPE_META[code]?.desc || code;
}

export function fmtAlertScale(scale: string | null | undefined): string {
  if (scale === 'log') return 'logarit (log)';
  if (scale === 'abs') return 'giá trị tuyệt đối';
  if (scale === 'raw') return 'thang gốc';
  return scale || '—';
}

export function fmtAlertDirection(dir: string | null | undefined): string {
  if (dir === 'high') return 'tăng vọt (đuôi trên)';
  if (dir === 'low') return 'sụt giảm (đuôi dưới)';
  return dir || '—';
}

