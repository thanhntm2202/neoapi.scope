import React, { useMemo, useState } from 'react';
import { Activity, Layers } from 'lucide-react';
import {
  buildLiquidityHeatmap2D,
  type BivariateCell,
  type FlowColorMode,
  type LiquidityHeatmapBarInput,
  type LiquidityHeatmapWatchlistInput,
} from '../lib/liquidityHeatmapMath';
import { fmtNum } from '../lib/format';

interface LiquidityHeatmapProps {
  symbols: string[];
  watchlist: LiquidityHeatmapWatchlistInput[];
  barsLhs: LiquidityHeatmapBarInput[];
  loading?: boolean;
  activeSymbol?: string;
  onSelectSymbol?: (symbol: string) => void;
}

const COLOR_MODES: { id: FlowColorMode; label: string }[] = [
  { id: 'directional', label: 'Chiều dòng tiền (+/−)' },
  { id: 'magnitude', label: 'Cường độ GTGD/phút' },
];

export const LiquidityHeatmap: React.FC<LiquidityHeatmapProps> = ({
  symbols,
  watchlist,
  barsLhs,
  loading = false,
  activeSymbol,
  onSelectSymbol,
}) => {
  const [colorMode, setColorMode] = useState<FlowColorMode>('directional');
  const [hoveredCell, setHoveredCell] = useState<BivariateCell | null>(null);
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);

  const matrix = useMemo(
    () =>
      buildLiquidityHeatmap2D({
        symbols,
        barsLhs,
        watchlist,
        colorMode,
      }),
    [symbols, barsLhs, watchlist, colorMode],
  );

  // Pick a sensible default inspected cell (pinned -> activeSymbol peak -> global peak)
  const inspectedCell = useMemo<BivariateCell | null>(() => {
    if (hoveredCell) return hoveredCell;
    if (pinnedKey) {
      for (const row of matrix.yRows) {
        for (const c of row.cells) {
          if (c && `${c.symbol}|${c.slot}` === pinnedKey) return c;
        }
      }
    }
    let fallback: BivariateCell | null = null;
    for (const row of matrix.yRows) {
      for (const c of row.cells) {
        if (!c) continue;
        if (activeSymbol && c.symbol === activeSymbol) {
          if (!fallback || fallback.symbol !== activeSymbol || c.valuePerMinB > fallback.valuePerMinB) {
            fallback = c;
          }
        } else if (!fallback || (!activeSymbol && c.valuePerMinB > fallback.valuePerMinB)) {
          fallback = c;
        }
      }
    }
    if (!fallback) {
      for (const row of matrix.yRows) {
        for (const c of row.cells) {
          if (c && (!fallback || c.valuePerMinB > fallback.valuePerMinB)) {
            fallback = c;
          }
        }
      }
    }
    return fallback;
  }, [hoveredCell, pinnedKey, matrix, activeSymbol]);

  const highVolCount = useMemo(() => {
    let count = 0;
    for (const row of matrix.yRows) {
      for (const c of row.cells) {
        if (c?.isHighVol) count += 1;
      }
    }
    return count;
  }, [matrix]);

  const hasData = matrix.xSlots.length > 0 && matrix.yRows.length > 0;
  if (!symbols.length && !barsLhs.length) return null;

  if (loading && !hasData) {
    return (
      <section
        id="liquidity-heatmap-2d"
        className="card-panel bivariate-heatmap-card"
        aria-label="Đang nạp LiquidityHeatmap 2D"
        style={{ marginTop: 14 }}
      >
        <div className="bivariate-head-row">
          <div>
            <h3 className="sec-title" style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <Layers size={15} color="#29b6f6" />
              LiquidityHeatmap 2D · Dòng tiền (Value/Time) × Biến động vi mô
            </h3>
            <div className="sec-note" style={{ margin: '2px 0 0 0' }}>
              Đang dựng ma trận 2D cường độ dòng tiền và độ bão hòa biến động vi mô 15 phút…
            </div>
          </div>
        </div>
        <div className="skeleton-bar" style={{ height: 150 }} />
      </section>
    );
  }

  if (!hasData) return null;

  const gridTemplateCols = `138px repeat(${matrix.xSlots.length}, minmax(44px, 1fr))`;

  return (
    <section
      id="liquidity-heatmap-2d"
      className="card-panel bivariate-heatmap-card"
      aria-label="LiquidityHeatmap ma trận 2D dòng tiền và biến động vi mô"
      style={{ marginTop: 14 }}
    >
      <div className="bivariate-head-row">
        <div>
          <h3 className="sec-title" style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <Layers size={15} color="#29b6f6" />
            LiquidityHeatmap 2D · Dòng tiền (Value/Time) × Biến động vi mô ({matrix.yRows.length} mã)
          </h3>
          <div className="sec-note" style={{ margin: '2px 0 0 0' }}>
            Ma trận hai chiều <strong>Mã × Khung 15′ (UTC+7)</strong>: <strong>Màu &amp; độ sáng</strong> biểu thị cường độ dòng tiền (tỷ đ/phút),{' '}
            <strong>độ bão hòa màu (Saturation)</strong> biểu thị độ biến động vi mô σ 1m (bps). Nhấp ô hoặc mã để nạp vào băng &amp; sổ lệnh.
          </div>
        </div>

        <div className="bivariate-controls">
          {highVolCount > 0 && (
            <span className="bivariate-vol-pill" title="Các ô có biến động vi mô đạt ≥ 65% đỉnh phiên và ≥ 18 bps">
              <Activity size={12} /> {highVolCount} ô biến động vi mô cao
            </span>
          )}
          <div className="tv-seg-group" role="group" aria-label="Chế độ tô màu LiquidityHeatmap">
            {COLOR_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`tv-seg-btn ${colorMode === m.id ? 'active' : ''}`}
                aria-pressed={colorMode === m.id}
                onClick={() => setColorMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bivariate-scroll-wrap">
        <div
          className="bivariate-matrix-grid"
          role="grid"
          aria-label="Ma trận 2D cường độ dòng tiền và biến động vi mô theo khung 15 phút"
          style={{ gridTemplateColumns: gridTemplateCols }}
        >
          {/* Header row */}
          <div className="bivariate-corner-cell" role="columnheader">
            <span>Mã · TB/phút</span>
          </div>
          {matrix.xSlots.map((slot) => (
            <div key={slot} className="bivariate-col-head" role="columnheader">
              {slot}
            </div>
          ))}

          {/* Matrix Rows */}
          {matrix.yRows.map((row) => {
            const isSelected = activeSymbol === row.symbol;
            return (
              <React.Fragment key={row.symbol}>
                <button
                  type="button"
                  role="rowheader"
                  className={`bivariate-row-head ${isSelected ? 'selected' : ''}`}
                  onClick={() => onSelectSymbol?.(row.symbol)}
                  title={`${row.symbol} (${row.group === 'large' ? 'VN30' : 'Midcap'}) · TB ${row.avgValuePerMinB.toFixed(2)} tỷ đ/phút · σ=${row.avgMicroVolBps.toFixed(1)} bps`}
                >
                  <span className="bivariate-row-sym-wrap">
                    <span className="bivariate-row-sym">{row.symbol}</span>
                    <span className={`bivariate-row-grp ${row.group}`}>
                      {row.group === 'large' ? 'VN30' : 'Mid'}
                    </span>
                  </span>
                  <span className="bivariate-row-rate mono">
                    {row.avgValuePerMinB.toFixed(2)}t/p
                  </span>
                </button>

                {row.cells.map((cell, colIdx) => {
                  const slot = matrix.xSlots[colIdx];
                  if (!cell) {
                    return (
                      <div
                        key={`${row.symbol}|${slot}`}
                        className="bivariate-cell empty"
                        role="gridcell"
                        aria-label={`${row.symbol} ${slot}: không có giao dịch`}
                      >
                        —
                      </div>
                    );
                  }
                  const cellKey = `${cell.symbol}|${cell.slot}`;
                  const isActiveCell =
                    inspectedCell?.symbol === cell.symbol && inspectedCell?.slot === cell.slot;

                  return (
                    <button
                      key={cellKey}
                      type="button"
                      role="gridcell"
                      className={`bivariate-cell ${cell.isHighVol ? 'high-vol' : ''} ${isActiveCell ? 'inspected' : ''}`}
                      style={{ backgroundColor: cell.hslCss }}
                      onMouseEnter={() => setHoveredCell(cell)}
                      onMouseLeave={() => setHoveredCell(null)}
                      onFocus={() => setHoveredCell(cell)}
                      onBlur={() => setHoveredCell(null)}
                      onClick={() => {
                        setPinnedKey(cellKey);
                        onSelectSymbol?.(cell.symbol);
                      }}
                      aria-label={`${cell.symbol} ${cell.slot}: Value/Time ${cell.valuePerMinB.toFixed(2)} tỷ đồng/phút, biến động vi mô ${cell.microVolBps.toFixed(1)} bps, bão hòa ${cell.saturationPct}%`}
                      title={`${cell.symbol} · ${cell.slot} UTC+7 | Value/Time: ${cell.valuePerMinB.toFixed(2)} tỷ/p | Dòng ròng: ${cell.signedFlowPerMinB >= 0 ? '+' : ''}${cell.signedFlowPerMinB.toFixed(2)} tỷ/p | σ: ${cell.microVolBps.toFixed(1)} bps`}
                    >
                      <span className="bivariate-cell-val mono">
                        {cell.valuePerMinB >= 1
                          ? cell.valuePerMinB.toFixed(1)
                          : cell.valuePerMinB.toFixed(2)}
                      </span>
                      {cell.isHighVol && <span className="bivariate-cell-vol-dot" aria-hidden="true" />}
                    </button>
                  );
                })}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Cell Inspector + Bivariate Legend */}
      <div className="bivariate-footer">
        {inspectedCell ? (
          <div className="bivariate-inspector" aria-live="polite">
            <span
              className="bivariate-inspector-swatch"
              style={{ backgroundColor: inspectedCell.hslCss }}
              aria-hidden="true"
            />
            <span className="bivariate-inspector-id mono">
              {inspectedCell.symbol} · {inspectedCell.slot} UTC+7
            </span>
            <span className="bivariate-inspector-kv">
              Value/Time:{' '}
              <strong className="mono">{inspectedCell.valuePerMinB.toFixed(2)} tỷ đ/phút</strong>
            </span>
            <span className="bivariate-inspector-kv">
              Dòng ròng:{' '}
              <strong
                className="mono"
                style={{
                  color:
                    inspectedCell.signedFlowPerMinB > 0.01
                      ? '#4dd0c1'
                      : inspectedCell.signedFlowPerMinB < -0.01
                        ? '#ff8a80'
                        : '#d1d4dc',
                }}
              >
                {inspectedCell.signedFlowPerMinB >= 0 ? '+' : ''}
                {inspectedCell.signedFlowPerMinB.toFixed(2)} tỷ/p
              </strong>
            </span>
            <span className="bivariate-inspector-kv">
              Biến động vi mô σ:{' '}
              <strong
                className="mono"
                style={{ color: inspectedCell.isHighVol ? '#fbbf24' : '#f0f3fa' }}
              >
                {fmtNum(inspectedCell.microVolBps, 1)} bps
              </strong>{' '}
              <span className="bivariate-sat-tag">
                (Bão hòa {inspectedCell.saturationPct}%)
              </span>
            </span>
            <span className="bivariate-inspector-kv">
              Spread TB:{' '}
              <strong className="mono">
                {inspectedCell.meanSpreadBps !== null
                  ? `${fmtNum(inspectedCell.meanSpreadBps, 1)} bps`
                  : '—'}
              </strong>
            </span>
          </div>
        ) : null}

        <div className="bivariate-legend-row">
          <div className="bivariate-legend-group">
            <span className="bivariate-legend-title">Màu &amp; Độ sáng (Value/Time):</span>
            {colorMode === 'directional' ? (
              <span className="bivariate-legend-swatches">
                <span className="bivariate-swatch-chip">
                  <i style={{ background: 'hsl(168 78% 42%)' }} /> Dòng vào mạnh
                </span>
                <span className="bivariate-swatch-chip">
                  <i style={{ background: 'hsl(216 45% 30%)' }} /> Cân bằng
                </span>
                <span className="bivariate-swatch-chip">
                  <i style={{ background: 'hsl(4 78% 42%)' }} /> Áp lực rút ròng
                </span>
              </span>
            ) : (
              <span className="bivariate-legend-swatches">
                <span className="bivariate-swatch-chip">
                  <i style={{ background: 'hsl(222 68% 24%)' }} /> Thấp
                </span>
                <span className="bivariate-swatch-chip">
                  <i style={{ background: 'hsl(190 76% 34%)' }} /> Trung bình
                </span>
                <span className="bivariate-swatch-chip">
                  <i style={{ background: 'hsl(158 82% 40%)' }} /> Cao
                </span>
                <span className="bivariate-swatch-chip">
                  <i style={{ background: 'hsl(38 88% 46%)' }} /> Đột biến
                </span>
              </span>
            )}
          </div>

          <div className="bivariate-legend-group">
            <span className="bivariate-legend-title">Độ bão hòa (Biến động vi mô σ):</span>
            <span className="bivariate-legend-swatches">
              <span className="bivariate-swatch-chip">
                <i style={{ background: 'hsl(168 18% 36%)' }} /> Êm (18%)
              </span>
              <span className="bivariate-swatch-chip">
                <i style={{ background: 'hsl(168 55% 38%)' }} /> Vừa (55%)
              </span>
              <span className="bivariate-swatch-chip">
                <i style={{ background: 'hsl(168 94% 40%)' }} /> Rung lắc mạnh (94%)
              </span>
              <span className="bivariate-swatch-chip">
                <span className="bivariate-legend-dot-demo" /> Điểm vàng = biến động vi mô cao
              </span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};
