import React, { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, Scale, ShieldAlert } from 'lucide-react';
import { PlotlyChart } from './PlotlyChart';
import {
  analyzeOrderBookImbalance,
  type BookSnapLike,
  type ObiPressureRegime,
} from '../lib/orderBookImbalance';
import { C_ACCENT, C_BAD, C_GOOD, C_LARGE, fmtNum, fmtVnd, fmtVnHms, toVnIsoLocal } from '../lib/format';

interface OrderBookImbalanceProps {
  symbol: string;
  rows: BookSnapLike[];
  focusRow?: BookSnapLike | null;
  loading?: boolean;
  windowLabel?: string;
}

const REGIME_BADGE: Record<
  ObiPressureRegime,
  { label: string; cls: string; calloutCls: string }
> = {
  BUY_PRESSURE_EXTREME: {
    label: 'Áp lực MUA mạnh',
    cls: 'buy-extreme',
    calloutCls: 'good',
  },
  BUY_BIAS: {
    label: 'Nghiêng MUA',
    cls: 'buy-bias',
    calloutCls: 'info',
  },
  BALANCED: {
    label: 'Sổ lệnh cân bằng',
    cls: 'balanced',
    calloutCls: 'info',
  },
  SELL_BIAS: {
    label: 'Nghiêng BÁN',
    cls: 'sell-bias',
    calloutCls: 'warn',
  },
  SELL_PRESSURE_EXTREME: {
    label: 'Áp lực BÁN mạnh',
    cls: 'sell-extreme',
    calloutCls: 'error',
  },
};

function fmtBookPrice(price: number | null): string {
  if (price === null || !Number.isFinite(price)) return '—';
  return Math.round(price).toLocaleString('en-US');
}

function fmtBookVol(vol: number): string {
  if (!Number.isFinite(vol) || vol <= 0) return '0';
  if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(2)}M`;
  if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)}k`;
  return Math.round(vol).toLocaleString('en-US');
}

export const OrderBookImbalance: React.FC<OrderBookImbalanceProps> = ({
  symbol,
  rows,
  focusRow = null,
  loading = false,
  windowLabel,
}) => {
  const analysis = useMemo(
    () => analyzeOrderBookImbalance(rows, symbol, focusRow),
    [rows, symbol, focusRow],
  );

  // Split OBI traces cleanly across lunch break (>10m gap) so fills never span 11:30–13:00
  const chartTraces = useMemo(() => {
    const series = analysis.series;
    if (!series.length) return [];

    const segments: typeof series[] = [[]];
    for (let i = 0; i < series.length; i++) {
      const cur = series[i];
      if (i > 0) {
        const prev = series[i - 1];
        if (cur.ts_ms - prev.ts_ms > 600_000) {
          segments.push([]);
        }
      }
      segments[segments.length - 1].push(cur);
    }

    const traces: any[] = [];
    segments.forEach((seg, segIdx) => {
      if (!seg.length) return;
      const xs = seg.map((p) => toVnIsoLocal(p.ts));
      traces.push(
        {
          x: xs,
          y: seg.map((p) => p.obi3L),
          name: 'OBI 3 mức',
          legendgroup: 'obi-3l',
          showlegend: segIdx === 0,
          type: 'scatter',
          mode: 'lines',
          line: { color: 'rgba(41, 98, 255, 0.52)', width: 1.3 },
          fill: 'tozeroy',
          fillcolor: 'rgba(41, 98, 255, 0.12)',
          hovertemplate: 'OBI 3 mức: %{y:+.3f}<br>%{x}<extra></extra>',
        },
        {
          x: xs,
          y: seg.map((p) => p.obiWeighted),
          name: 'OBI trọng số',
          legendgroup: 'obi-w',
          showlegend: segIdx === 0,
          type: 'scatter',
          mode: 'lines',
          line: { color: C_LARGE, width: 1.6 },
          hovertemplate: 'OBI trọng số: %{y:+.3f}<br>%{x}<extra></extra>',
        },
      );
    });

    const extremeBuyPts = series.filter((p) => p.isExtremeBuy);
    if (extremeBuyPts.length > 0) {
      traces.push({
        x: extremeBuyPts.map((p) => toVnIsoLocal(p.ts)),
        y: extremeBuyPts.map((p) => p.obiWeighted),
        name: `Mua ≥ +0.42 (${extremeBuyPts.length})`,
        type: 'scatter',
        mode: 'markers',
        marker: {
          symbol: 'triangle-up',
          size: 6,
          color: C_GOOD,
          opacity: 0.88,
          line: { color: '#0f172a', width: 0.8 },
        },
        hovertemplate: 'Đỉnh dư mua: %{y:+.3f}<br>%{x}<extra></extra>',
      });
    }

    const extremeSellPts = series.filter((p) => p.isExtremeSell);
    if (extremeSellPts.length > 0) {
      traces.push({
        x: extremeSellPts.map((p) => toVnIsoLocal(p.ts)),
        y: extremeSellPts.map((p) => p.obiWeighted),
        name: `Bán ≤ -0.42 (${extremeSellPts.length})`,
        type: 'scatter',
        mode: 'markers',
        marker: {
          symbol: 'triangle-down',
          size: 6,
          color: C_BAD,
          opacity: 0.88,
          line: { color: '#0f172a', width: 0.8 },
        },
        hovertemplate: 'Đỉnh dư bán: %{y:+.3f}<br>%{x}<extra></extra>',
      });
    }

    return traces;
  }, [analysis.series]);

  if (!symbol) return null;

  if (loading && !rows.length) {
    return (
      <section
        id="order-book-imbalance-card"
        className="card-panel obi-card"
        aria-label={`Đang nạp OrderBookImbalance cho ${symbol}`}
        style={{ marginTop: 14 }}
      >
        <div className="obi-header-row">
          <div>
            <h3 className="sec-title" style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <Scale size={15} color="#26a69a" />
              OrderBookImbalance · Áp lực sổ lệnh 3 mức ({symbol})
            </h3>
            <div className="sec-note" style={{ margin: '2px 0 0 0' }}>
              Đang tải dữ liệu 3 bước giá Bid/Ask từ NEO API snapshots…
            </div>
          </div>
        </div>
        <div className="skeleton-bar" style={{ height: 150 }} />
      </section>
    );
  }

  const badge = REGIME_BADGE[analysis.regime];
  const latest = analysis.latestPoint;

  const isSevere =
    analysis.regime === 'BUY_PRESSURE_EXTREME' || analysis.regime === 'SELL_PRESSURE_EXTREME';

  return (
    <section
      id="order-book-imbalance-card"
      className="card-panel obi-card"
      aria-label={`Phân tích mất cân bằng sổ lệnh 3 mức cho ${symbol}`}
      style={{ marginTop: 14 }}
    >
      <div className="obi-header-row">
        <div>
          <h3 className="sec-title" style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <Scale size={15} color="#26a69a" />
            OrderBookImbalance · Mất cân bằng sổ lệnh 3 mức ({symbol})
          </h3>
          <div className="sec-note" style={{ margin: '2px 0 0 0' }}>
            Tính từ 3 mức giá chờ mua/bán (<code>bid1..3</code>, <code>ask1..3</code>) và độ lệch microprice để cảnh báo sớm áp lực mua/bán ngắn hạn
            {windowLabel ? ` · Khung: ${windowLabel}` : ''}.
          </div>
        </div>

        <div className="obi-status-badges">
          {latest && (
            <span className="obi-time-pill mono">
              Tick {fmtVnHms(latest.ts)} UTC+7
            </span>
          )}
          <span className={`obi-regime-pill ${badge.cls}`}>
            {isSevere ? (
              <ShieldAlert size={13} />
            ) : analysis.regime === 'BALANCED' ? (
              <CheckCircle2 size={13} />
            ) : (
              <AlertTriangle size={13} />
            )}
            {badge.label}
          </span>
        </div>
      </div>

      {/* Alert Banner */}
      <div className={`callout ${badge.calloutCls} obi-alert-banner`} role="status">
        <div>
          <strong>{analysis.alertTitle}:</strong> {analysis.alertMessage}
        </div>
        <div className="obi-alert-counts mono">
          <span>
            Nhịp mua ≥ +0.42: <strong style={{ color: '#4dd0c1' }}>{analysis.buySpikeCount}</strong>
          </span>
          <span>
            Nhịp bán ≤ -0.42: <strong style={{ color: '#ff8a80' }}>{analysis.sellSpikeCount}</strong>
          </span>
          <span>
            TB 10 tick gần nhất:{' '}
            <strong>
              {analysis.recentMeanWeightedObi !== null
                ? `${analysis.recentMeanWeightedObi >= 0 ? '+' : ''}${analysis.recentMeanWeightedObi.toFixed(3)}`
                : '—'}
            </strong>
          </span>
        </div>
      </div>

      {analysis.series.length > 0 ? (
        <div className="obi-grid">
          {/* Left: Intraday 3-Level OBI Pressure Chart */}
          <div className="obi-chart-panel">
            <PlotlyChart
              data={chartTraces}
              height={340}
              crosshair
              layout={{
                xaxis: { title: 'Giờ (UTC+7)' },
                yaxis: {
                  title: 'OBI (−1 Bán → +1 Mua)',
                  range: [-1.05, 1.05],
                },
                legend: { orientation: 'h', yanchor: 'top', y: -0.22, x: 0 },
                shapes: [
                  {
                    type: 'line',
                    xref: 'paper',
                    x0: 0,
                    x1: 1,
                    y0: 0.42,
                    y1: 0.42,
                    line: { color: 'rgba(38, 166, 154, 0.65)', width: 1.2, dash: 'dash' },
                  },
                  {
                    type: 'line',
                    xref: 'paper',
                    x0: 0,
                    x1: 1,
                    y0: -0.42,
                    y1: -0.42,
                    line: { color: 'rgba(239, 83, 80, 0.65)', width: 1.2, dash: 'dash' },
                  },
                  {
                    type: 'line',
                    xref: 'paper',
                    x0: 0,
                    x1: 1,
                    y0: 0,
                    y1: 0,
                    line: { color: 'rgba(148, 163, 184, 0.35)', width: 1 },
                  },
                ],
                margin: { l: 54, r: 14, t: 18, b: 84 },
              }}
              alt={`Biểu đồ OrderBookImbalance 3 mức giá nội phiên của ${symbol} với ngưỡng cảnh báo ±0.42.`}
            />
          </div>

          {/* Right: 3-Level Order Book Ladder + Compact KPIs */}
          <div className="obi-ladder-panel">
            <div className="obi-kpi-strip">
              <div className="obi-kpi-tile">
                <span className="obi-kpi-label">OBI 3 mức</span>
                <strong
                  className="obi-kpi-val mono"
                  style={{
                    color:
                      latest && latest.obi3L >= 0.18
                        ? '#4dd0c1'
                        : latest && latest.obi3L <= -0.18
                          ? '#ff8a80'
                          : '#f0f3fa',
                  }}
                >
                  {latest ? `${latest.obi3L >= 0 ? '+' : ''}${latest.obi3L.toFixed(3)}` : '—'}
                </strong>
              </div>
              <div className="obi-kpi-tile">
                <span className="obi-kpi-label">OBI trọng số</span>
                <strong
                  className="obi-kpi-val mono"
                  style={{
                    color:
                      latest && latest.obiWeighted >= 0.18
                        ? '#4dd0c1'
                        : latest && latest.obiWeighted <= -0.18
                          ? '#ff8a80'
                          : '#f0f3fa',
                  }}
                >
                  {latest
                    ? `${latest.obiWeighted >= 0 ? '+' : ''}${latest.obiWeighted.toFixed(3)}`
                    : '—'}
                </strong>
              </div>
              <div className="obi-kpi-tile">
                <span className="obi-kpi-label">Bid / Ask 3 mức</span>
                <strong className="obi-kpi-val mono">
                  {analysis.bidSharePct.toFixed(0)}% / {analysis.askSharePct.toFixed(0)}%
                </strong>
              </div>
              <div className="obi-kpi-tile">
                <span className="obi-kpi-label">Microprice skew</span>
                <strong
                  className="obi-kpi-val mono"
                  style={{
                    color:
                      latest?.microSkewBps != null && latest.microSkewBps > 0.5
                        ? '#4dd0c1'
                        : latest?.microSkewBps != null && latest.microSkewBps < -0.5
                          ? '#ff8a80'
                          : '#f0f3fa',
                  }}
                >
                  {latest?.microSkewBps != null
                    ? `${latest.microSkewBps >= 0 ? '+' : ''}${fmtNum(latest.microSkewBps, 2)} bps`
                    : '—'}
                </strong>
              </div>
            </div>

            <div className="obi-split-meter" aria-label="Tỷ trọng giá trị chờ mua và chờ bán 3 mức">
              <div className="obi-split-labels mono">
                <span style={{ color: '#4dd0c1' }}>
                  Bid 3 mức: {latest ? fmtVnd(latest.bidValB * 1e9) : '—'} ({analysis.bidSharePct.toFixed(0)}%)
                </span>
                <span style={{ color: '#ff8a80' }}>
                  Ask 3 mức: {latest ? fmtVnd(latest.askValB * 1e9) : '—'} ({analysis.askSharePct.toFixed(0)}%)
                </span>
              </div>
              <div className="obi-split-track">
                <div className="obi-split-bid" style={{ width: `${analysis.bidSharePct.toFixed(1)}%` }} />
                <div className="obi-split-ask" style={{ width: `${analysis.askSharePct.toFixed(1)}%` }} />
              </div>
            </div>

            <div className="obi-ladder-box">
              <div className="obi-ladder-head">
                <span>Mức</span>
                <span>Chờ Mua (Bid)</span>
                <span>Cân bằng 2 phía</span>
                <span style={{ textAlign: 'right' }}>Chờ Bán (Ask)</span>
              </div>

              {analysis.levels.length > 0 ? (
                analysis.levels.map((lvl) => {
                  const totalVol = lvl.bidVol + lvl.askVol;
                  const bidPct = totalVol > 0 ? (lvl.bidVol / totalVol) * 100 : 50;
                  const askPct = 100 - bidPct;
                  return (
                    <div key={lvl.level} className="obi-ladder-row">
                      <span className="obi-lvl-badge mono">L{lvl.level}</span>

                      <div className="obi-side-cell bid">
                        <strong className="mono">{fmtBookPrice(lvl.bidPrice)}</strong>
                        <span className="mono">{fmtBookVol(lvl.bidVol)} cp</span>
                      </div>

                      <div className="obi-lvl-bar-wrap" title={`OBI L${lvl.level}: ${lvl.levelObi >= 0 ? '+' : ''}${lvl.levelObi.toFixed(2)}`}>
                        <div className="obi-lvl-bar">
                          <div className="obi-lvl-fill-bid" style={{ width: `${bidPct.toFixed(1)}%` }} />
                          <div className="obi-lvl-fill-ask" style={{ width: `${askPct.toFixed(1)}%` }} />
                        </div>
                        <span
                          className="obi-lvl-obi mono"
                          style={{
                            color:
                              lvl.levelObi > 0.15
                                ? '#4dd0c1'
                                : lvl.levelObi < -0.15
                                  ? '#ff8a80'
                                  : '#94a3b8',
                          }}
                        >
                          {lvl.levelObi >= 0 ? '+' : ''}
                          {lvl.levelObi.toFixed(2)}
                        </span>
                      </div>

                      <div className="obi-side-cell ask">
                        <strong className="mono">{fmtBookPrice(lvl.askPrice)}</strong>
                        <span className="mono">{fmtBookVol(lvl.askVol)} cp</span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="small-caption" style={{ padding: '10px 4px', margin: 0 }}>
                  Phiên/mã này chỉ có tổng hợp <code>obi</code> — chưa có chi tiết 3 bước giá <code>bid1..3 / ask1..3</code>.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="callout info">
          Không có dữ liệu snapshot OBI cho {symbol} trong khung thời gian đang chọn.
        </div>
      )}
    </section>
  );
};
