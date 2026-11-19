export type ThemeMode = 'light' | 'dark';

export const C_LARGE = '#0284C7';
export const C_THIN = '#D97706';
export const C_ACCENT = '#0D9488';
export const C_BAD = '#DC2626';
export const C_GOOD = '#16A34A';

export const GROUP_COLORS: Record<string, string> = {
  large: '#0284C7',
  thin: '#D97706',
};

export const MODEL_COLORS: Record<string, string> = {
  naive_mid: '#64748B',
  ladder_only: '#D97706',
  full: '#0D9488',
};

export function chartTheme(theme: ThemeMode = 'light') {
  if (theme === 'dark') {
    return {
      large: '#38BDF8',
      thin: '#FBBF24',
      accent: '#14B8A6',
      bad: '#F87171',
      good: '#34D399',
      grid: '#1E293B',
      text: '#CBD5E1',
      muted: '#94A3B8',
      title: '#F1F5F9',
      hoverBg: '#0F172A',
      hoverBorder: '#334155',
      legendBg: 'rgba(17, 25, 44, 0.85)',
      template: 'plotly_dark',
    };
  }
  return {
    large: '#0284C7',
    thin: '#D97706',
    accent: '#0D9488',
    bad: '#DC2626',
    good: '#16A34A',
    grid: '#E2E8F0',
    text: '#475569',
    muted: '#64748B',
    title: '#0F172A',
    hoverBg: '#FFFFFF',
    hoverBorder: '#CBD5E1',
    legendBg: 'rgba(255, 255, 255, 0.9)',
    template: 'plotly_white',
  };
}

export function fmtVnd(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  if (Math.abs(x) >= 1e9) return `${(x / 1e9).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} tỷ`;
  if (Math.abs(x) >= 1e6) return `${(x / 1e6).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} triệu`;
  return Math.round(x).toLocaleString('en-US');
}

export function fmtNum(x: number | null | undefined, decimals = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  return x.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function baseLayout(
  height = 360,
  title?: string,
  extra: Record<string, unknown> = {},
  theme: ThemeMode = 'light',
): Record<string, unknown> {
  const ct = chartTheme(theme);
  const existingX = (extra.xaxis as Record<string, unknown>) || {};
  const existingY = (extra.yaxis as Record<string, unknown>) || {};

  return {
    template: ct.template,
    height,
    margin: { l: 54, r: 22, t: title ? 74 : 24, b: 46 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'DM Sans, system-ui, sans-serif', size: 12.5, color: ct.text },
    ...(title
      ? {
          title: {
            text: title,
            font: { family: 'Plus Jakarta Sans, sans-serif', size: 14, color: ct.title },
            x: 0.01,
            y: 0.96,
            yanchor: 'top',
          },
        }
      : {}),
    legend: {
      orientation: 'h',
      yanchor: 'bottom',
      y: 1.02,
      x: 0,
      font: { size: 11.5, color: ct.text },
      bgcolor: ct.legendBg,
    },
    hoverlabel: {
      font: { size: 12, color: ct.title, family: 'JetBrains Mono, monospace' },
      bgcolor: ct.hoverBg,
      bordercolor: ct.hoverBorder,
    },
    ...extra,
    xaxis: { gridcolor: ct.grid, zerolinecolor: ct.grid, linecolor: ct.grid, ...existingX },
    yaxis: { gridcolor: ct.grid, zerolinecolor: ct.grid, linecolor: ct.grid, ...existingY },
  };
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]): void {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))];
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
