import React, { useMemo, useState } from 'react';
import { AlertTriangle, Flame, Grid, LayoutGrid } from 'lucide-react';
import { PlotlyChart } from './PlotlyChart';
import { C_BAD, C_GOOD, C_LARGE, C_THIN, fmtNum } from '../lib/format';
import {
  buildOverviewHeatmapMatrix,
  buildWatchlistHeatmapCells,
  type HeatmapBarInput,
  type HeatmapWatchlistInput,
  type OverviewHeatmapMetric,
  type WatchlistHeatmapCell,
} from '../lib/overviewHeatmap';

interface WatchlistHeatmapProps {
  symbols: string[];
  watchlist: HeatmapWatchlistInput[];
  barsLhs: HeatmapBarInput[];
  loading?: boolean;
  activeSymbol?: string;
  onSelectSymbol?: (symbol: string) => void;
}

type HeatmapViewMode = 'tiles' | 'matrix';

const METRIC_OPTIONS: { id: OverviewHeatmapMetric; label: string }[] = [
  { id: 'flow', label: 'Mật độ dòng tiền' },
  { id: 'intensity', label: 'Cường độ giao dịch' },
  { id: 'anomaly', label: 'Bất thường thanh khoản' },
];

function getTileVisualStyle(
  cell: WatchlistHeatmapCell,
  metric: OverviewHeatmapMetric,
): { bg: string; border: string; barColor: string; barPct: number; tone: 'up' | 'down' | 'warn' | 'neutral' } {
  if (metric === 'flow') {
    const ratio = Math.max(-100, Math.min(100, cell.flowRatioPct));
    const strength = Math.min(1, Math.abs(ratio) / 55);
    if (ratio >= 6) {
      const alpha = (0.11 + strength * 0.2).toFixed(2);
      return {
        bg: `rgba(38, 166, 154, ${alpha})`,
        border: cell.isAnomalous ? 'rgba(245, 158, 11, 0.72)' : 'rgba(38, 166, 154, 0.45)',
        barColor: C_GOOD,
        barPct: Math.min(100, Math.max(8, cell.turnoverSharePct * 2.4)),
        tone: 'up',
      };
    }
    if (ratio <= -6) {
      const alpha = (0.11 + strength * 0.2).toFixed(2);
      return {
        bg: `rgba(239, 83, 80, ${alpha})`,
        border: cell.isAnomalous ? 'rgba(245, 158, 11, 0.72)' : 'rgba(239, 83, 80, 0.48)',
        barColor: C_BAD,
        barPct: Math.min(100, Math.max(8, cell.turnoverSharePct * 2.4)),
        tone: 'down',
      };
    }
    return {
      bg: 'rgba(30, 34, 45, 0.72)',
      border: cell.isAnomalous ? 'rgba(245, 158, 11, 0.65)' : '#2a2e39',
      barColor: C_LARGE,
      barPct: Math.min(100, Math.max(8, cell.turnoverSharePct * 2.4)),
      tone: 'neutral',
    };
  }

  if (metric === 'intensity') {
    const r = cell.intensityRatio;
    const barPct = Math.min(100, Math.max(10, (r / 3.2) * 100));
    if (r >= 2.4) {
      return {
        bg: 'rgba(239, 83, 80, 0.24)',
        border: 'rgba(239, 83, 80, 0.68)',
        barColor: C_BAD,
        barPct,
        tone: 'down',
      };
    }
    if (r >= 1.8) {
      return {
        bg: 'rgba(245, 158, 11, 0.20)',
        border: 'rgba(245, 158, 11, 0.62)',
        barColor: C_THIN,
        barPct,
        tone: 'warn',
      };
    }
    if (r >= 1.3) {
      return {
        bg: 'rgba(41, 182, 246, 0.16)',
        border: 'rgba(41, 182, 246, 0.48)',
        barColor: C_LARGE,
        barPct,
        tone: 'neutral',
      };
    }
    return {
      bg: 'rgba(30, 34, 45, 0.72)',
      border: '#2a2e39',
      barColor: '#64748b',
      barPct,
      tone: 'neutral',
    };
  }

  // anomaly metric
  const sc = cell.anomalyScore;
  const barPct = Math.min(100, Math.max(8, sc));
  if (sc >= 65 || cell.rareAlertCount >= 2) {
    return {
      bg: 'rgba(239, 83, 80, 0.25)',
      border: 'rgba(239, 83, 80, 0.72)',
      barColor: C_BAD,
      barPct,
      tone: 'down',
    };
  }
  if (sc >= 40 || cell.isAnomalous) {
    return {
      bg: 'rgba(245, 158, 11, 0.20)',
      border: 'rgba(245, 158, 11, 0.65)',
      barColor: C_THIN,
      barPct,
      tone: 'warn',
    };
  }
  if (sc >= 20) {
    return {
      bg: 'rgba(41, 98, 255, 0.14)',
      border: 'rgba(41, 98, 255, 0.42)',
      barColor: '#5b8cff',
      barPct,
      tone: 'neutral',
    };
  }
  return {
    bg: 'rgba(38, 166, 154, 0.10)',
    border: 'rgba(38, 166, 154, 0.30)',
    barColor: C_GOOD,
    barPct,
    tone: 'up',
  };
}

export const WatchlistHeatmap: React.FC<WatchlistHeatmapProps> = ({
  symbols,
  watchlist,
  barsLhs,
  loading = false,
  activeSymbol,
  onSelectSymbol,
}) => {
  const [metric, setMetric] = useState<OverviewHeatmapMetric>('flow');
  const [viewMode, setViewMode] = useState<HeatmapViewMode>('tiles');

  const cells = useMemo(
    () =>
      buildWatchlistHeatmapCells({
        symbols,
        watchlist,
        barsLhs,
        sortBy: metric,
      }),
    [symbols, watchlist, barsLhs, metric],
  );

  const anomalousCells = useMemo(
    () => cells.filter((c) => c.isAnomalous).sort((a, b) => b.anomalyScore - a.anomalyScore),
    [cells],
  );

  const matrix = useMemo(
    () =>
      buildOverviewHeatmapMatrix({
        symbols: cells.map((c) => c.symbol),
        barsLhs,
        metric,
        watchlist,
      }),
    [cells, barsLhs, metric, watchlist],
  );

  const matrixTraceData = useMemo(() => {
    if (!matrix.xLabels.length || !matrix.ySymbols.length) return [];
    const colorscale =
      metric === 'flow'
        ? [
            [0, '#131b2e'],
            [0.35, '#1d4ed8'],
            [0.7, '#26a69a'],
            [1, '#f59e0b'],
          ]
        : metric === 'intensity'
          ? [
              [0, '#172033'],
              [0.38, '#29b6f6'],
              [0.72, '#f59e0b'],
              [1, '#ef5350'],
            ]
          : [
              [0, '#17332e'],
              [0.4, '#2962ff'],
              [0.72, '#f59e0b'],
              [1, '#ef5350'],
            ];

    return [
      {
        type: 'heatmap',
        x: matrix.xLabels,
        y: matrix.ySymbols,
        z: matrix.z,
        text: matrix.customText,
        hoverinfo: 'text',
        colorscale,
        zmin: metric === 'intensity' || metric === 'anomaly' ? 0.5 : undefined,
        xgap: 2,
        ygap: 2,
        hoverongaps: false,
        colorbar: {
          title: { text: matrix.unit, font: { size: 11, color: '#94a3b8' } },
          tickfont: { size: 10, color: '#94a3b8' },
          thickness: 12,
        },
      },
    ];
  }, [matrix, metric]);

  const hasSessionPayload = watchlist.length > 0 || barsLhs.length > 0;

  if (!symbols.length && !hasSessionPayload) return null;

  if (loading && !hasSessionPayload) {
    return (
      <section
        id="overview-liquidity-heatmap"
        className="card-panel heatmap-section"
        aria-label="Đang nạp Heatmap dòng tiền"
        style={{ marginTop: 14 }}
      >
        <div className="heatmap-header-row">
          <div>
            <h3 className="sec-title" style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <Flame size={15} color="#f59e0b" />
              Heatmap · Mật độ dòng tiền &amp; Cường độ giao dịch
            </h3>
            <div className="sec-note" style={{ margin: '2px 0 0 0' }}>
              Đang tổng hợp mật độ dòng tiền và bất thường thanh khoản từ dữ liệu phiên…
            </div>
          </div>
        </div>
        <div className="skeleton-bar" style={{ height: 140 }} />
      </section>
    );
  }

  if (!hasSessionPayload || !cells.length) return null;

  return (
    <section
      id="overview-liquidity-heatmap"
      className="card-panel heatmap-section"
      aria-label="Heatmap mật độ dòng tiền và cường độ giao dịch"
      style={{ marginTop: 14 }}
    >
      <div className="heatmap-header-row">
        <div>
          <h3 className="sec-title" style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <Flame size={15} color="#f59e0b" />
            Heatmap · Mật độ dòng tiền &amp; Cường độ giao dịch ({cells.length} mã)
          </h3>
          <div className="sec-note" style={{ margin: '2px 0 0 0' }}>
            Hiển thị tỷ trọng giá trị giao dịch, dòng tiền định hướng và đột biến thanh khoản nội ngày — nhấp một mã để soi thẳng trên băng giao dịch.
          </div>
        </div>

        <div className="heatmap-controls-wrap">
          <div className="tv-seg-group" role="group" aria-label="Chỉ số heatmap">
            {METRIC_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`tv-seg-btn ${metric === opt.id ? 'active' : ''}`}
                aria-pressed={metric === opt.id}
                onClick={() => setMetric(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="tv-seg-group" role="group" aria-label="Chế độ xem heatmap">
            <button
              type="button"
              className={`tv-seg-btn ${viewMode === 'tiles' ? 'active' : ''}`}
              aria-pressed={viewMode === 'tiles'}
              onClick={() => setViewMode('tiles')}
            >
              <LayoutGrid size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              Thẻ nhiệt
            </button>
            <button
              type="button"
              className={`tv-seg-btn ${viewMode === 'matrix' ? 'active' : ''}`}
              aria-pressed={viewMode === 'matrix'}
              onClick={() => setViewMode('matrix')}
            >
              <Grid size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              Ma trận 15′
            </button>
          </div>
        </div>
      </div>

      {anomalousCells.length > 0 && (
        <div className="heatmap-anomaly-strip" role="region" aria-label="Các mã có biến động thanh khoản bất thường">
          <span className="heatmap-anomaly-label">
            <AlertTriangle size={13} color="#fbbf24" />
            Biến động bất thường ({anomalousCells.length}):
          </span>
          <div className="heatmap-anomaly-chips">
            {anomalousCells.map((c) => (
              <button
                key={c.symbol}
                type="button"
                className={`heatmap-anomaly-chip ${activeSymbol === c.symbol ? 'active' : ''}`}
                onClick={() => onSelectSymbol?.(c.symbol)}
                title={c.anomalyReasons.join(' · ') || 'Biến động thanh khoản bất thường'}
              >
                <strong>{c.symbol}</strong>
                <span>{c.anomalyBadge || `Điểm ${c.anomalyScore}`}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {viewMode === 'tiles' ? (
        <>
          <div className="heatmap-tile-grid">
            {cells.map((c) => {
              const vis = getTileVisualStyle(c, metric);
              const isSelected = activeSymbol === c.symbol;
              const signedStr =
                c.signedFlowB >= 0
                  ? `+${c.signedFlowB.toFixed(1)}`
                  : c.signedFlowB.toFixed(1);

              return (
                <button
                  key={c.symbol}
                  type="button"
                  className={`heatmap-tile ${isSelected ? 'selected' : ''} ${c.isAnomalous ? 'anomalous' : ''}`}
                  style={{
                    background: vis.bg,
                    borderColor: isSelected ? '#2962ff' : vis.border,
                  }}
                  onClick={() => onSelectSymbol?.(c.symbol)}
                  aria-label={`Mã ${c.symbol}, GTGD ${c.turnoverB.toFixed(1)} tỷ đồng${c.anomalyBadge ? `, bất thường ${c.anomalyBadge}` : ''}`}
                >
                  <div className="heatmap-tile-top">
                    <div className="heatmap-tile-sym-wrap">
                      <span className="heatmap-tile-sym">{c.symbol}</span>
                      <span className={`heatmap-group-tag ${c.group}`}>
                        {c.group === 'large' ? 'VN30' : 'Midcap'}
                      </span>
                    </div>
                    {c.anomalyBadge ? (
                      <span className="heatmap-anom-pill">{c.anomalyBadge}</span>
                    ) : (
                      <span className="heatmap-share-pill">
                        {c.turnoverSharePct.toFixed(1)}% GT
                      </span>
                    )}
                  </div>

                  {metric === 'flow' && (
                    <div className="heatmap-tile-body">
                      <div className="heatmap-main-val">
                        {c.turnoverB.toFixed(1)} <span className="heatmap-unit">tỷ đ</span>
                      </div>
                      <div className="heatmap-sub-grid">
                        <span>
                          Dòng tiền:{' '}
                          <strong
                            style={{
                              color:
                                c.signedFlowB > 0.05
                                  ? '#4dd0c1'
                                  : c.signedFlowB < -0.05
                                    ? '#ff7b78'
                                    : '#d1d4dc',
                            }}
                          >
                            {signedStr} tỷ
                          </strong>
                        </span>
                        <span>
                          OBI:{' '}
                          <strong>{c.obi !== null ? fmtNum(c.obi, 2) : '—'}</strong>
                        </span>
                      </div>
                    </div>
                  )}

                  {metric === 'intensity' && (
                    <div className="heatmap-tile-body">
                      <div className="heatmap-main-val">
                        ×{c.intensityRatio.toFixed(2)}{' '}
                        <span className="heatmap-unit">
                          trung vị{c.peakSlot ? ` (${c.peakSlot})` : ''}
                        </span>
                      </div>
                      <div className="heatmap-sub-grid">
                        <span>
                          GTGD: <strong>{c.turnoverB.toFixed(1)} tỷ</strong>
                        </span>
                        <span>
                          KL: <strong>{c.cumVolM !== null ? `${c.cumVolM.toFixed(2)}M` : '—'}</strong>
                        </span>
                      </div>
                    </div>
                  )}

                  {metric === 'anomaly' && (
                    <div className="heatmap-tile-body">
                      <div className="heatmap-main-val">
                        {c.anomalyScore} <span className="heatmap-unit">/ 100 rủi ro</span>
                      </div>
                      <div className="heatmap-sub-grid">
                        <span>
                          Spread: <strong>{c.spreadBps !== null ? `${c.spreadBps.toFixed(1)} bps` : '—'}</strong>
                        </span>
                        <span>
                          LHS: <strong>{c.lhsLatest !== null ? c.lhsLatest.toFixed(1) : '—'}</strong>
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="heatmap-tile-foot">
                    <div className="heatmap-intensity-track">
                      <div
                        className="heatmap-intensity-fill"
                        style={{ width: `${vis.barPct.toFixed(1)}%`, background: vis.barColor }}
                      />
                    </div>
                    <div className="heatmap-foot-meta">
                      {metric === 'flow' ? (
                        <span>
                          {Math.abs(c.foreignNetB) >= 0.05
                            ? `NN ròng: ${c.foreignNetB >= 0 ? '+' : ''}${c.foreignNetB.toFixed(2)} tỷ`
                            : `Cường độ đỉnh: ×${c.intensityRatio.toFixed(1)}`}
                        </span>
                      ) : metric === 'intensity' ? (
                        <span>
                          Nhịp cuối: ×{c.latestIntensityRatio.toFixed(2)} · σ={c.volatilityBps !== null ? `${c.volatilityBps.toFixed(1)}` : '—'} bps
                        </span>
                      ) : (
                        <span>
                          {c.anomalyReasons[0] || `Giãn spread ×${c.spreadWideningRatio.toFixed(1)}`}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="heatmap-legend-bar">
            {metric === 'flow' ? (
              <div className="heatmap-legend-scale">
                <span className="legend-dot" style={{ background: C_GOOD }} /> Dòng tiền mua/vào mạnh
                <span className="legend-dot" style={{ background: '#475569', marginLeft: 10 }} /> Cân bằng
                <span className="legend-dot" style={{ background: C_BAD, marginLeft: 10 }} /> Áp lực bán/rút
              </div>
            ) : metric === 'intensity' ? (
              <div className="heatmap-legend-scale">
                <span className="legend-dot" style={{ background: '#64748b' }} /> Bình thường (&lt;1.3×)
                <span className="legend-dot" style={{ background: C_LARGE, marginLeft: 10 }} /> Sôi động (1.3–1.8×)
                <span className="legend-dot" style={{ background: C_THIN, marginLeft: 10 }} /> Cao (1.8–2.4×)
                <span className="legend-dot" style={{ background: C_BAD, marginLeft: 10 }} /> Đột biến (≥2.4×)
              </div>
            ) : (
              <div className="heatmap-legend-scale">
                <span className="legend-dot" style={{ background: C_GOOD }} /> Ổn định (&lt;20)
                <span className="legend-dot" style={{ background: '#5b8cff', marginLeft: 10 }} /> Lưu ý (20–39)
                <span className="legend-dot" style={{ background: C_THIN, marginLeft: 10 }} /> Bất thường (40–64)
                <span className="legend-dot" style={{ background: C_BAD, marginLeft: 10 }} /> Cảnh báo cao (≥65)
              </div>
            )}
            <span className="heatmap-legend-hint">Nhấp ô cổ phiếu để mở băng giao dịch chi tiết</span>
          </div>
        </>
      ) : matrixTraceData.length > 0 ? (
        <div style={{ marginTop: 8 }}>
          <PlotlyChart
            data={matrixTraceData}
            height={Math.max(250, matrix.ySymbols.length * 34 + 92)}
            onClickPoint={(pt) => {
              if (pt.y && onSelectSymbol) {
                onSelectSymbol(String(pt.y));
              }
            }}
            layout={{
              xaxis: { type: 'category', title: 'Khung 15 phút (UTC+7)' },
              yaxis: { type: 'category', automargin: true },
              margin: { l: 58, r: 74, t: 18, b: 44 },
            }}
            alt="Ma trận bản đồ nhiệt mật độ dòng tiền và cường độ giao dịch 15 phút theo từng mã."
          />
        </div>
      ) : (
        <div className="callout info" style={{ marginTop: 10 }}>
          Chưa đủ dữ liệu bar 1 phút để dựng ma trận 15 phút cho phiên này.
        </div>
      )}
    </section>
  );
};

export const Heatmap = WatchlistHeatmap;
