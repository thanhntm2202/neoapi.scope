import React from 'react';
import { C_ACCENT } from '../lib/format';

export interface PillItem {
  label: string;
  color: 'green' | 'amber' | 'red' | 'blue' | 'gray';
  tip: string;
  isLiveStream?: boolean;
}

export interface KpiCardItem {
  label: string;
  value: string;
  sub: string;
  color?: string;
  delta?: string;
  delta_dir?: 'up' | 'down' | 'flat';
}

export interface AlertFeedItem {
  priority: 'P1' | 'P2' | 'P3' | string;
  title: string;
  sub: string;
  time: string;
  raw?: any;
}

export const HeroBanner: React.FC<{ brand: string; title: string; subtitle: string }> = ({
  brand,
  title,
  subtitle,
}) => (
  <div className="neoscope-hero">
    <div className="hero-brand">{brand}</div>
    <h1 className="hero-title">{title}</h1>
    <div className="hero-sub">{subtitle}</div>
  </div>
);

export const StatusStrip: React.FC<{ brand: string; title: string; pills: PillItem[] }> = ({
  brand,
  title,
  pills,
}) => (
  <div className="status-strip">
    <span className="s-brand">{brand}</span>
    <span className="s-sep" aria-hidden="true">
      /
    </span>
    <span className="s-title">{title}</span>
    <div className="meta-strip">
      {pills.map((p, idx) => (
        <span
          key={idx}
          className={`meta-item ${p.isLiveStream ? `live-${p.color}` : ''}`}
          title={p.tip}
        >
          {p.isLiveStream && <span className={`live-dot ${p.color}`} aria-hidden="true" />}
          {p.label}
        </span>
      ))}
    </div>
  </div>
);

export const PillRow: React.FC<{ items: PillItem[] }> = ({ items }) => (
  <div className="meta-strip meta-strip-bar">
    {items.map((p, idx) => (
      <span
        key={idx}
        className={`meta-item ${p.isLiveStream ? `live-${p.color}` : ''}`}
        title={p.tip}
      >
        {p.isLiveStream && <span className={`live-dot ${p.color}`} aria-hidden="true" />}
        {p.label}
      </span>
    ))}
  </div>
);

export const KpiGrid: React.FC<{ cards: KpiCardItem[] }> = ({ cards }) => (
  <div className="kpi-grid">
    {cards.map((c, idx) => (
      <div
        key={idx}
        className="kpi"
        style={{ '--kpi-c': c.color || C_ACCENT } as React.CSSProperties}
      >
        <div className="k-top">
          <span className="k-label">{c.label}</span>
          {c.delta ? (
            <span className={`k-delta ${c.delta_dir || 'flat'}`}>{c.delta}</span>
          ) : null}
        </div>
        <div className="k-value">{c.value}</div>
        <div className="k-sub">{c.sub}</div>
      </div>
    ))}
  </div>
);

export const SectionHeading: React.FC<{ title: string; note?: string }> = ({ title, note }) => (
  <>
    <div className="sec-title">{title}</div>
    {note ? <div className="sec-note">{note}</div> : null}
  </>
);

export const AlertFeed: React.FC<{
  items: AlertFeedItem[];
  emptyText?: string;
  onItemClick?: (item: AlertFeedItem) => void;
}> = ({
  items,
  emptyText = 'Không có cảnh báo nào khớp bộ lọc.',
  onItemClick,
}) => {
  if (!items.length) {
    return (
      <div className="alert-item">
        <div className="a-sub">{emptyText}</div>
      </div>
    );
  }
  return (
    <div className="alert-feed">
      {items.map((item, idx) =>
        onItemClick ? (
          <button
            key={idx}
            type="button"
            className="alert-item"
            onClick={() => onItemClick(item)}
            aria-label={`Truy nguyên cảnh báo ${item.title} lúc ${item.time}`}
          >
            <span className={`tag ${item.priority.toLowerCase()}`}>{item.priority}</span>
            <div style={{ flex: 1 }}>
              <div className="a-main">{item.title}</div>
              <div className="a-sub">{item.sub}</div>
            </div>
            <span className="a-jump">Truy nguyên →</span>
            <div className="a-time">{item.time}</div>
          </button>
        ) : (
          <div key={idx} className="alert-item">
            <span className={`tag ${item.priority.toLowerCase()}`}>{item.priority}</span>
            <div style={{ flex: 1 }}>
              <div className="a-main">{item.title}</div>
              <div className="a-sub">{item.sub}</div>
            </div>
            <div className="a-time">{item.time}</div>
          </div>
        ),
      )}
    </div>
  );
};

export const Sparkline: React.FC<{ values: number[]; color?: string }> = ({
  values,
  color = C_ACCENT,
}) => {
  if (!values || values.length < 2) {
    return <span style={{ color: '#787b86', fontSize: 12 }}>—</span>;
  }
  const w = 116;
  const h = 24;
  const min = 0;
  const max = 100;
  const coords = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (w - 4) + 2;
    const y = h - 3 - ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * (h - 6);
    return [x, y] as const;
  });
  const pts = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaPts = `${coords[0][0].toFixed(1)},${h - 2} ${pts} ${coords[coords.length - 1][0].toFixed(1)},${h - 2}`;
  const last = values[values.length - 1];
  const lastCoord = coords[coords.length - 1];
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-label="LHS sparkline">
        <polygon fill={color} fillOpacity="0.14" points={areaPts} />
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={pts}
        />
        <circle cx={lastCoord[0]} cy={lastCoord[1]} r="2" fill={color} />
      </svg>
      <span className="mono" style={{ fontSize: 11.5, color: '#d1d4dc', fontWeight: 600 }}>
        {last.toFixed(1)}
      </span>
    </div>
  );
};

export const NeoFooter: React.FC<{ provider: string; mode: string; configHash: string }> = ({
  provider,
  mode,
  configHash,
}) => (
  <div className="neoscope-footer">
    <b>NeoScope</b> — công cụ phân tích thanh khoản &amp; vi cấu trúc thị trường chứng khoán Việt Nam.
    Sản phẩm phục vụ nghiên cứu và hỗ trợ ra quyết định; <b>không phải khuyến nghị đầu tư</b>, không đặt lệnh thật, không dự báo giá dài hạn.
    <div className="f-row">
      <span className="f-item">Nguồn dữ liệu: SSI FastConnect API v3 (NEO API dự phòng)</span>
      <span className="f-item">Múi giờ chuẩn: Asia/Ho_Chi_Minh (UTC+7)</span>
      <span className="f-item">
        Chế độ: {mode} · Nguồn: {provider}
      </span>
      <span className="f-item">
        config_hash: <code>{configHash.slice(0, 12)}…</code>
      </span>
    </div>
  </div>
);
