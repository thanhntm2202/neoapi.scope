import React from 'react';
import type { ThemeMode } from '../utils/format';

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  theme?: ThemeMode;
}

export const Sparkline: React.FC<SparklineProps> = ({
  values,
  width = 120,
  height = 24,
  theme = 'light',
}) => {
  if (!values.length) {
    return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  }
  const n = values.length;
  const pts = values
    .map((v, i) => {
      const x = n === 1 ? width / 2 : (i / (n - 1)) * (width - 4) + 2;
      const clamped = Math.max(0, Math.min(100, v));
      const y = height - 3 - (clamped / 100) * (height - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const last = values[values.length - 1];
  const stroke = theme === 'dark' ? '#14B8A6' : '#0D9488';
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <svg width={width} height={height} style={{ overflow: 'visible' }}>
        <polyline fill="none" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" points={pts} />
      </svg>
      <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 32, textAlign: 'right' }}>
        {last.toFixed(1)}
      </span>
    </div>
  );
};
