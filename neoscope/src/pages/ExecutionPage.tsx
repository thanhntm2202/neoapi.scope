import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { PlotlyChart } from '../components/PlotlyChart';
import { C_ACCENT, C_BAD, C_GOOD, fmtNum, fmtVnd, fmtVnHms } from '../lib/format';

interface ExecutionPageProps {
  dataset: string;
  session: string;
  symbols: string[];
  settings: any;
  preferredSym?: string | null;
  onConsumePreferredSym?: () => void;
}

const NOTIONAL_OPTIONS = [50e6, 100e6, 200e6, 500e6, 1e9, 2e9, 3e9, 5e9];

export const ExecutionPage: React.FC<ExecutionPageProps> = ({
  dataset,
  session,
  symbols,
  settings,
  preferredSym,
  onConsumePreferredSym,
}) => {
  const [sym, setSym] = useState<string>(symbols[0] || '');
  const [side, setSide] = useState<1 | -1>(-1);
  const [notionalIdx, setNotionalIdx] = useState<number>(3); // 500M
  const [timestamps, setTimestamps] = useState<{ ts: string; ts_ms: number }[]>([]);
  const [foldNote, setFoldNote] = useState<string>('');
  const [tsIdx, setTsIdx] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  const [selectedDomLevel, setSelectedDomLevel] = useState<{
    bookSide: 'ask' | 'bid';
    level: number;
  } | null>(null);

  const [estimate, setEstimate] = useState<any>(null);
  const [estimateLoading, setEstimateLoading] = useState<boolean>(false);
  const [estimateErr, setEstimateErr] = useState<string>('');
  const [simResult, setSimResult] = useState<any>(null);
  const [simLoading, setSimLoading] = useState<boolean>(false);

  useEffect(() => {
    if (preferredSym && symbols.includes(preferredSym)) {
      setSym(preferredSym);
      onConsumePreferredSym?.();
    }
  }, [preferredSym, symbols, onConsumePreferredSym]);

  useEffect(() => {
    if (symbols.length && (!sym || !symbols.includes(sym))) {
      setSym(symbols[0]);
    }
  }, [symbols, sym]);

  useEffect(() => {
    setIsPlaying(false);
    setSelectedDomLevel(null);
    if (!session || !sym) return;
    let cancelled = false;
    setSimResult(null);
    const params = new URLSearchParams({ session, symbol: sym });
    if (dataset) params.set('dataset', dataset);
    fetch(`/api/execution/timestamps?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const tsList = d.timestamps || [];
        setTimestamps(tsList);
        setFoldNote(d.foldNote || '');
        setTsIdx(Math.floor(tsList.length / 2));
      })
      .catch(() => {
        if (!cancelled) setTimestamps([]);
      });
    return () => {
      cancelled = true;
    };
  }, [dataset, session, sym]);

  // TradingView bar-replay timer
  useEffect(() => {
    if (!isPlaying || timestamps.length <= 1) return;
    const id = window.setInterval(() => {
      setTsIdx((prev) => {
        if (prev >= timestamps.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 950);
    return () => window.clearInterval(id);
  }, [isPlaying, timestamps.length]);

  const selectedTs = timestamps[Math.min(tsIdx, Math.max(timestamps.length - 1, 0))];
  const notional = NOTIONAL_OPTIONS[notionalIdx];

  useEffect(() => {
    if (!session || !sym || !selectedTs) return;
    let cancelled = false;
    setSimResult(null);
    setEstimateErr('');
    setEstimateLoading(true);
    fetch('/api/execution/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataset,
        session,
        symbol: sym,
        side,
        notional,
        ts_ms: selectedTs.ts_ms,
      }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Lỗi ước tính chi phí');
        return d;
      })
      .then((d) => {
        if (!cancelled) {
          setEstimate(d);
          setEstimateErr('');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setEstimate(null);
          setEstimateErr(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) setEstimateLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dataset, session, sym, side, notional, selectedTs?.ts_ms]);

  const runSimulator = async () => {
    if (!estimate || !selectedTs) return;
    setSimLoading(true);
    try {
      const r = await fetch('/api/execution/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset,
          session,
          symbol: sym,
          side,
          qty: estimate.qty,
          ts_ms: selectedTs.ts_ms,
        }),
      });
      const d = await r.json();
      setSimResult(d);
    } finally {
      setSimLoading(false);
    }
  };

  // Book ladder chart
  const ladderChart = useMemo(() => {
    if (!estimate) return { data: [], title: '' };
    const prices: (number | null)[] = estimate.ladder?.prices || [];
    const vols: (number | null)[] = estimate.ladder?.vols || [];
    let remaining = estimate.qty;
    const xs: number[] = [];
    const ys: string[] = [];
    const taken: number[] = [];
    for (let i = 0; i < Math.min(prices.length, vols.length); i++) {
      const p = prices[i];
      const v = vols[i];
      if (p === null || v === null || !Number.isFinite(p) || !Number.isFinite(v)) continue;
      const t = Math.min(remaining, v);
      remaining -= t;
      xs.push(v);
      ys.push(`Mức ${i + 1} · ${Math.round(p).toLocaleString('en-US')}đ`);
      taken.push(t);
    }
    const ttlBase = side === 1 ? 'Lệnh MUA quét phía BÁN (ask)' : 'Lệnh BÁN quét phía MUA (bid)';
    const title =
      remaining <= 0
        ? ttlBase
        : `${ttlBase} — còn ${Math.round(remaining).toLocaleString('en-US')} cp vượt sổ hiển thị`;
    return {
      title,
      data: [
        {
          type: 'bar',
          orientation: 'h',
          x: xs,
          y: ys,
          name: 'KL hiển thị',
          marker: { color: '#363a45' },
          hovertemplate: '%{y}: %{x:,.0f} cp<extra></extra>',
        },
        {
          type: 'bar',
          orientation: 'h',
          x: taken,
          y: ys,
          name: 'Lệnh của bạn ăn vào',
          marker: { color: side === 1 ? C_BAD : C_GOOD },
          hovertemplate: '%{y}: lệnh ăn %{x:,.0f} cp<extra></extra>',
        },
      ],
    };
  }, [estimate, side]);

  // Waterfall chart
  const waterfallData = useMemo(() => {
    if (!estimate?.waterfallParts || !estimate?.full) return [];
    const labels = [...Object.keys(estimate.waterfallParts), 'Tổng IS kỳ vọng'];
    const vals = Object.values(estimate.waterfallParts) as number[];
    const total = estimate.full.e_is_bps;
    return [
      {
        type: 'waterfall',
        x: labels,
        y: [...vals, 0],
        measure: [...vals.map(() => 'relative'), 'total'],
        connector: { line: { color: '#787b86' } },
        increasing: { marker: { color: C_BAD } },
        decreasing: { marker: { color: C_GOOD } },
        totals: { marker: { color: C_ACCENT } },
        text: [...vals.map((v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`), `${total.toFixed(1)} bps`],
        textposition: 'outside',
      },
    ];
  }, [estimate]);

  // Order Size Cost Curve (50tr -> 5B VND)
  const costCurveData = useMemo(() => {
    const curve: any[] = estimate?.costCurve || [];
    if (!curve.length) return [];
    const xLabels = curve.map((p) =>
      p.notional >= 1e9 ? `${p.notional / 1e9} tỷ` : `${p.notional / 1e6} triệu`,
    );
    const idxs = curve.map((_, i) => i);
    const traces: any[] = [];
    const fullMode =
      estimate?.hasFoldModel !== false && curve.some((p) => p.e_is_bps !== null && Number.isFinite(p.e_is_bps));

    if (fullMode) {
      traces.push(
        {
          x: xLabels,
          y: curve.map((p) => p.hi_bps),
          type: 'scatter',
          mode: 'lines',
          line: { width: 0 },
          showlegend: false,
          hoverinfo: 'skip',
        },
        {
          x: xLabels,
          y: curve.map((p) => p.lo_bps),
          type: 'scatter',
          mode: 'lines',
          fill: 'tonexty',
          fillcolor: 'rgba(41, 98, 255, 0.14)',
          line: { width: 0 },
          name: 'Khoảng dự báo 90%',
          hoverinfo: 'skip',
        },
      );
    }

    if (fullMode) {
      traces.push({
        x: xLabels,
        y: curve.map((p) => p.e_is_bps),
        customdata: idxs,
        type: 'scatter',
        mode: 'lines+markers',
        name: 'IS kỳ vọng full (bps)',
        line: { color: C_ACCENT, width: 2.3 },
        marker: { size: 7, color: C_ACCENT },
        hovertemplate: 'Quy mô %{x}<br>E[IS]: %{y:.2f} bps<extra></extra>',
      });
    }

    traces.push({
      x: xLabels,
      y: curve.map((p) => p.cost_vis_bps),
      customdata: idxs,
      type: 'scatter',
      mode: 'lines+markers',
      name: 'Quét sổ tất định (bps)',
      line: { color: '#f59e0b', width: 2, dash: 'dot' },
      marker: { size: 6, color: '#f59e0b', symbol: 'circle-open' },
      hovertemplate: 'Quy mô %{x}<br>Quét sổ: %{y:.2f} bps<extra></extra>',
    });

    const activePt = curve[notionalIdx];
    const activeY = fullMode ? activePt?.e_is_bps : activePt?.cost_vis_bps;
    if (activePt && activeY !== null && activeY !== undefined && Number.isFinite(activeY)) {
      traces.push({
        x: [xLabels[notionalIdx]],
        y: [activeY],
        customdata: [notionalIdx],
        type: 'scatter',
        mode: 'markers',
        name: 'Quy mô đang chọn',
        marker: {
          size: 12,
          symbol: 'diamond',
          color: '#29b6f6',
          line: { color: '#f0f3fa', width: 1.5 },
        },
        hovertemplate: `Đang chọn %{x}: %{y:.2f} bps · đáp ứng ${(activePt.coverage * 100).toFixed(0)}% sổ<extra></extra>`,
      });
    }

    return traces;
  }, [estimate, notionalIdx]);

  const ob = estimate?.orderBook;
  const domSummary = useMemo(() => {
    if (!ob || !selectedDomLevel) return null;
    const rows = selectedDomLevel.bookSide === 'ask' ? ob.asks : ob.bids;
    let cumQty = 0;
    let cumVal = 0;
    let targetPrice: number | null = null;
    for (const r of rows) {
      if (r.level <= selectedDomLevel.level) {
        if (r.vol != null) cumQty += Number(r.vol);
        if (r.notional != null) cumVal += Number(r.notional);
        if (r.level === selectedDomLevel.level) targetPrice = r.price;
      }
    }
    return {
      sideLabel: selectedDomLevel.bookSide === 'ask' ? 'Bán' : 'Mua',
      level: selectedDomLevel.level,
      price: targetPrice,
      cumQty,
      cumVal,
    };
  }, [ob, selectedDomLevel]);

  if (!symbols.length) {
    return (
      <div className="callout info">Chọn ít nhất một mã trong bộ lọc watchlist để mô phỏng.</div>
    );
  }

  const hasFold = estimate?.hasFoldModel !== false && Boolean(estimate?.full);

  return (
    <div>
      <h2 className="page-subheader">Mô phỏng chi phí · Lệnh giả định sẽ tác động sổ ra sao?</h2>
      <p className="page-caption">
        Mô hình Implementation Shortfall (Perold 1988): quét sổ 3 mức (chi phí tất định) + phần dư
        thực thi dần với trôi giá κ·OBI và rủi ro thời điểm √τ (Almgren et al. 2005). Tham số lấy
        từ fold walk-forward — không fit trên phiên đang xem.
      </p>
      {foldNote && <div className="small-caption">{foldNote}</div>}

      <div className="card-panel">
        <div className="grid-3">
          <div>
            <label className="field-label" htmlFor="exec-sym-select">
              Mã cổ phiếu
            </label>
            <select
              id="exec-sym-select"
              className="select-input"
              value={sym}
              onChange={(e) => setSym(e.target.value)}
            >
              {symbols.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="field-label">Hướng lệnh</span>
            <div className="radio-group">
              <button
                type="button"
                className={`radio-pill sell ${side === -1 ? 'active' : ''}`}
                onClick={() => setSide(-1)}
              >
                BÁN (quét bid)
              </button>
              <button
                type="button"
                className={`radio-pill buy ${side === 1 ? 'active' : ''}`}
                onClick={() => setSide(1)}
              >
                MUA (quét ask)
              </button>
            </div>
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <label className="field-label" htmlFor="exec-notional-range" style={{ margin: 0 }}>
                Quy mô lệnh (VND)
              </label>
              <span className="mono" style={{ fontSize: 13, color: '#5b8cff', fontWeight: 700 }}>
                {fmtVnd(notional)}
              </span>
            </div>
            <input
              id="exec-notional-range"
              type="range"
              className="range-slider"
              min={0}
              max={NOTIONAL_OPTIONS.length - 1}
              value={notionalIdx}
              onChange={(e) => setNotionalIdx(Number(e.target.value))}
            />
          </div>
        </div>

        {timestamps.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 8,
                marginBottom: 6,
              }}
            >
              <label className="field-label" htmlFor="exec-ts-range" style={{ margin: 0 }}>
                Thời điểm đặt lệnh (UTC+7)
              </label>
              <div className="tv-replay-bar">
                <button
                  type="button"
                  className="tv-replay-btn"
                  aria-label="Lùi một nhịp"
                  disabled={tsIdx <= 0}
                  onClick={() => {
                    setIsPlaying(false);
                    setTsIdx((i) => Math.max(0, i - 1));
                  }}
                >
                  <ChevronLeft size={13} /> -1
                </button>
                <button
                  type="button"
                  className={`tv-replay-btn ${isPlaying ? 'playing' : ''}`}
                  aria-label={isPlaying ? 'Tạm dừng phát sổ lệnh' : 'Phát qua các nhịp trong phiên'}
                  onClick={() => {
                    if (!isPlaying && tsIdx >= timestamps.length - 1) setTsIdx(0);
                    setIsPlaying((p) => !p);
                  }}
                >
                  {isPlaying ? <Pause size={12} /> : <Play size={12} />}
                  {isPlaying ? 'Tạm dừng' : 'Phát'}
                </button>
                <button
                  type="button"
                  className="tv-replay-btn"
                  aria-label="Tiến một nhịp"
                  disabled={tsIdx >= timestamps.length - 1}
                  onClick={() => {
                    setIsPlaying(false);
                    setTsIdx((i) => Math.min(timestamps.length - 1, i + 1));
                  }}
                >
                  +1 <ChevronRight size={13} />
                </button>
                <span className="mono" style={{ fontSize: 12.5, color: '#29b6f6', fontWeight: 700, marginLeft: 4 }}>
                  {selectedTs ? fmtVnHms(selectedTs.ts) : '—'} ({tsIdx + 1}/{timestamps.length})
                </span>
              </div>
            </div>
            <input
              id="exec-ts-range"
              type="range"
              className="range-slider"
              min={0}
              max={Math.max(timestamps.length - 1, 0)}
              value={Math.min(tsIdx, Math.max(timestamps.length - 1, 0))}
              onChange={(e) => {
                setIsPlaying(false);
                setTsIdx(Number(e.target.value));
              }}
            />
          </div>
        )}
      </div>

      {estimateLoading && <div className="skeleton-bar" aria-label="Đang tính chi phí thực thi" />}
      {estimateErr && <div className="callout error">{estimateErr}</div>}

      {estimate && (
        <div className={estimateLoading && !isPlaying ? 'is-loading-panel' : undefined}>
          {!hasFold && (
            <div className="callout info">
              <span>
                <strong>Chế độ quét sổ tất định:</strong> tập dữ liệu hiện tại chưa có tham số
                walk-forward (<code>fold_params</code>) nên chưa tính phần dư &amp; IS kỳ vọng
                ngoài mẫu. Sổ lệnh 3 mức, khớp tức thời và phí/thuế vẫn được tính chính xác.
              </span>
            </div>
          )}

          <div className="metric-grid" style={{ marginTop: 12 }}>
            <div className="metric-card">
              <div className="m-label">{hasFold ? 'IS kỳ vọng' : 'Chi phí quét sổ (tất định)'}</div>
              <div className="m-val">
                {hasFold
                  ? `${estimate.full.e_is_bps.toFixed(1)} bps`
                  : `${fmtNum(estimate.ladder?.cost_vis_bps, 1)} bps`}
              </div>
            </div>
            <div className="metric-card">
              <div className="m-label">Khoảng dự báo 90%</div>
              <div className="m-val">
                {hasFold
                  ? `[${estimate.full.lo_bps.toFixed(1)}, ${estimate.full.hi_bps.toFixed(1)}]`
                  : '—'}
              </div>
            </div>
            <div className="metric-card">
              <div className="m-label">Đáp ứng trong sổ</div>
              <div className="m-val">{(estimate.ladder.coverage * 100).toFixed(0)}%</div>
            </div>
            <div className="metric-card">
              <div className="m-label">Thời gian mô phỏng</div>
              <div className="m-val">
                {hasFold && Number.isFinite(estimate.full.tau_s)
                  ? `${Math.round(estimate.full.tau_s)} giây`
                  : 'Tức thời'}
              </div>
            </div>
            <div className="metric-card">
              <div className="m-label">Phí + thuế ước tính</div>
              <div className="m-val">
                {((estimate.costs.fee_vnd + estimate.costs.tax_vnd) / 1e6).toFixed(2)} triệu đ
              </div>
              <div className="m-delta">
                phí {(settings.execution.fee_rate * 100).toFixed(2)}%, thuế bán{' '}
                {(settings.execution.sell_tax_rate * 100).toFixed(1)}%
              </div>
            </div>
          </div>

          <div className="small-caption">
            Lệnh {estimate.qty.toLocaleString('en-US')} cp × mid{' '}
            {Math.round(estimate.mid).toLocaleString('en-US')} đ ≈{' '}
            {fmtVnd(estimate.qty * estimate.mid)} đ
            {hasFold && (
              <>
                {' '}
                · chi phí tác động ước tính ≈{' '}
                {fmtVnd((estimate.qty * estimate.mid * estimate.full.e_is_bps) / 1e4)} đ (chưa gồm
                phí/thuế) · cờ mô hình:{' '}
                {estimate.full.flags?.length ? estimate.full.flags.join(', ') : 'không'}
              </>
            )}
          </div>

          <div className="grid-2" style={{ marginTop: 12, alignItems: 'start' }}>
            {ob && (
              <div className="orderbook-panel" aria-label="Sổ lệnh 3 mức tại thời điểm đến">
                <div className="ob-header">
                  <span className="ob-title">Sổ lệnh 3 mức (DOM) · {sym}</span>
                  <span className="mono" style={{ fontSize: 11.5, color: '#787b86' }}>
                    {fmtVnHms(ob.ts)} UTC+7
                  </span>
                </div>
                <div className="ob-col-heads">
                  <span>Mức</span>
                  <span className="num">Giá (đ)</span>
                  <span className="num">KL (cp)</span>
                  <span className="num">Giá trị</span>
                </div>
                {[...ob.asks].reverse().map((lvl: any) => {
                  const pct = lvl.vol ? Math.min((lvl.vol / ob.maxVol) * 100, 100) : 0;
                  const isSel =
                    selectedDomLevel?.bookSide === 'ask' && selectedDomLevel.level === lvl.level;
                  return (
                    <button
                      type="button"
                      key={`ask-${lvl.level}`}
                      className={`ob-row ${side === 1 ? 'active-side' : ''} ${isSel ? 'selected-level' : ''}`}
                      onClick={() =>
                        setSelectedDomLevel((cur) =>
                          cur?.bookSide === 'ask' && cur.level === lvl.level
                            ? null
                            : { bookSide: 'ask', level: lvl.level },
                        )
                      }
                    >
                      <div className="ob-depth-fill ask" style={{ width: `${pct}%` }} />
                      <span className="ob-cell" style={{ color: '#ff7b78', fontSize: 11.5 }}>
                        Bán {lvl.level}
                      </span>
                      <span className="ob-cell num ob-price-ask">
                        {lvl.price !== null ? Math.round(lvl.price).toLocaleString('en-US') : '—'}
                      </span>
                      <span className="ob-cell num">
                        {lvl.vol !== null ? Math.round(lvl.vol).toLocaleString('en-US') : '—'}
                      </span>
                      <span className="ob-cell num">{fmtVnd(lvl.notional)}</span>
                    </button>
                  );
                })}

                <div className="ob-spread-bar">
                  <span>
                    Mid: <strong className="mono">{Math.round(ob.mid).toLocaleString('en-US')} đ</strong>
                  </span>
                  <span>
                    Spread: <strong className="mono">{fmtNum(ob.spread_bps, 2)} bps</strong>
                  </span>
                  <span>
                    OBI: <strong className="mono">{fmtNum(ob.obi, 2)}</strong>
                  </span>
                </div>

                {ob.bids.map((lvl: any) => {
                  const pct = lvl.vol ? Math.min((lvl.vol / ob.maxVol) * 100, 100) : 0;
                  const isSel =
                    selectedDomLevel?.bookSide === 'bid' && selectedDomLevel.level === lvl.level;
                  return (
                    <button
                      type="button"
                      key={`bid-${lvl.level}`}
                      className={`ob-row ${side === -1 ? 'active-side' : ''} ${isSel ? 'selected-level' : ''}`}
                      onClick={() =>
                        setSelectedDomLevel((cur) =>
                          cur?.bookSide === 'bid' && cur.level === lvl.level
                            ? null
                            : { bookSide: 'bid', level: lvl.level },
                        )
                      }
                    >
                      <div className="ob-depth-fill bid" style={{ width: `${pct}%` }} />
                      <span className="ob-cell" style={{ color: '#4dd0c1', fontSize: 11.5 }}>
                        Mua {lvl.level}
                      </span>
                      <span className="ob-cell num ob-price-bid">
                        {lvl.price !== null ? Math.round(lvl.price).toLocaleString('en-US') : '—'}
                      </span>
                      <span className="ob-cell num">
                        {lvl.vol !== null ? Math.round(lvl.vol).toLocaleString('en-US') : '—'}
                      </span>
                      <span className="ob-cell num">{fmtVnd(lvl.notional)}</span>
                    </button>
                  );
                })}

                {domSummary && (
                  <div className="ob-cum-summary">
                    Tích lũy tới <strong>{domSummary.sideLabel} {domSummary.level}</strong> (
                    <span className="mono">
                      {domSummary.price !== null
                        ? `${Math.round(domSummary.price).toLocaleString('en-US')} đ`
                        : '—'}
                    </span>
                    ): <strong className="mono">{Math.round(domSummary.cumQty).toLocaleString('en-US')} cp</strong>{' '}
                    ≈ <strong className="mono">{fmtVnd(domSummary.cumVal)} đ</strong>
                  </div>
                )}

                <div className="ob-meta-row">
                  <span>
                    Khớp gần nhất:{' '}
                    <strong className="mono">
                      {ob.last_price !== null ? `${Math.round(ob.last_price).toLocaleString('en-US')} đ` : '—'}
                    </strong>
                  </span>
                  {ob.ref !== null && (
                    <span>
                      TC / Trần / Sàn:{' '}
                      <strong className="mono">
                        {Math.round(ob.ref).toLocaleString('en-US')} /{' '}
                        {ob.ceiling !== null ? Math.round(ob.ceiling).toLocaleString('en-US') : '—'} /{' '}
                        {ob.floor !== null ? Math.round(ob.floor).toLocaleString('en-US') : '—'}
                      </strong>
                    </span>
                  )}
                </div>
              </div>
            )}

            <div>
              <PlotlyChart
                data={ladderChart.data}
                height={300}
                title={ladderChart.title}
                layout={{
                  barmode: 'overlay',
                  xaxis: { title: 'Khối lượng (cổ phiếu)' },
                  margin: { l: 120, r: 22, t: 70, b: 44 },
                }}
                alt="Khối lượng hiển thị ở ba mức giá và phần lệnh mô phỏng khớp tại từng mức."
              />
              {estimate.ladder.fills?.length > 0 && (
                <div className="table-wrap" style={{ marginTop: 10 }}>
                  <table className="neo-table">
                    <thead>
                      <tr>
                        <th className="num">Giá khớp (đ)</th>
                        <th className="num">KL ăn (cp)</th>
                        <th className="num">Chi phí (bps)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {estimate.ladder.fills.map((f: any, idx: number) => (
                        <tr key={idx}>
                          <td className="num">{Math.round(f.price).toLocaleString('en-US')}</td>
                          <td className="num">{Math.round(f.qty).toLocaleString('en-US')}</td>
                          <td className="num">{fmtNum(f.cost_bps, 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {costCurveData.length > 0 && (
            <div className="card-panel" style={{ marginTop: 14 }}>
              <PlotlyChart
                data={costCurveData}
                height={340}
                crosshair
                title="Đường cong tác động theo quy mô lệnh (50 triệu → 5 tỷ đ)"
                onClickPoint={(pt) => {
                  const idx =
                    typeof pt.customdata === 'number'
                      ? pt.customdata
                      : typeof pt.pointIndex === 'number'
                        ? pt.pointIndex
                        : -1;
                  if (idx >= 0 && idx < NOTIONAL_OPTIONS.length) {
                    setNotionalIdx(idx);
                  }
                }}
                layout={{
                  xaxis: { type: 'category', title: 'Quy mô lệnh (VND)' },
                  yaxis: { side: 'right', title: 'Chi phí thực thi (bps)', rangemode: 'tozero' },
                  margin: { l: 30, r: 64, t: 74, b: 44 },
                }}
                alt="Đường cong chi phí thực thi kỳ vọng và quét sổ tất định theo quy mô lệnh từ 50 triệu đến 5 tỷ đồng."
              />
              <div className="small-caption" style={{ marginBottom: 0 }}>
                Nhấp vào bất kỳ điểm nào trên đường cong để đổi nhanh quy mô lệnh mô phỏng. Độ dốc
                tăng mạnh khi lệnh vượt thanh khoản 3 mức hiển thị.
              </div>
            </div>
          )}

          {hasFold && (
            <>
              <div style={{ marginTop: 14 }}>
                <PlotlyChart
                  data={waterfallData}
                  height={330}
                  title="Phân rã chi phí thực thi kỳ vọng (Implementation Shortfall)"
                  layout={{
                    yaxis: { title: 'bps so với mid lúc đến' },
                  }}
                  alt="Phân rã các thành phần chi phí thành implementation shortfall kỳ vọng."
                />
              </div>

              <div style={{ marginTop: 16 }}>
                <h4 style={{ margin: '8px 0', color: '#f0f3fa' }}>
                  So sánh với benchmark (cùng thông tin tại thời điểm đặt)
                </h4>
                <div className="table-wrap">
                  <table className="neo-table">
                    <thead>
                      <tr>
                        <th>Mô hình</th>
                        <th className="num">E[IS] bps</th>
                      </tr>
                    </thead>
                    <tbody>
                      {estimate.benchmarks.map((b: any, i: number) => (
                        <tr key={i}>
                          <td>{b.model}</td>
                          <td className="num">{Number(b.e_is_bps).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          <details className="expander" style={{ marginTop: 14 }}>
            <summary>Minh bạch tham số &amp; giả định tại thời điểm đặt</summary>
            <div className="expander-body">
              <pre className="json-box">{JSON.stringify(estimate.transparency, null, 2)}</pre>
              <div className="small-caption">
                Giả định công bố: tiếp cận toàn bộ KL hiển thị (không mô phỏng hàng đợi); sổ tương
                lai không phản hồi lệnh của ta (không own-impact) → với lệnh rất lớn, ước tính là
                cận dưới. Xem docs/limitations.md.
              </div>
            </div>
          </details>

          <div style={{ marginTop: 16 }}>
            <h4 style={{ margin: '8px 0 10px 0', color: '#f0f3fa' }}>
              Buồng thử: tự kiểm chứng ước tính bằng khớp lệnh mô phỏng
            </h4>
            <button
              type="button"
              className="btn btn-primary"
              onClick={runSimulator}
              disabled={simLoading}
            >
              <Play size={15} />
              {simLoading ? 'Đang mô phỏng…' : 'Khớp lệnh này trong buồng thử (paper simulator)'}
            </button>

            {simResult && !simResult.ok && (
              <div className="callout error" style={{ marginTop: 12 }}>
                Mô phỏng không khả thi: {JSON.stringify(simResult.flags)}
              </div>
            )}

            {simResult && simResult.ok && (
              <div style={{ marginTop: 12 }}>
                <div className="metric-grid">
                  <div className="metric-card">
                    <div className="m-label">IS thực hiện (mô phỏng)</div>
                    <div className="m-val">{simResult.realized_is_bps.toFixed(1)} bps</div>
                  </div>
                  {hasFold && (
                    <div className="metric-card">
                      <div className="m-label">Dự báo full</div>
                      <div className="m-val">{estimate.full.e_is_bps.toFixed(1)} bps</div>
                      <div className="m-delta">
                        sai số{' '}
                        {(estimate.full.e_is_bps - simResult.realized_is_bps) >= 0 ? '+' : ''}
                        {(estimate.full.e_is_bps - simResult.realized_is_bps).toFixed(1)} bps
                      </div>
                    </div>
                  )}
                  <div className="metric-card">
                    <div className="m-label">Khớp thực tế</div>
                    <div className="m-val">{(simResult.filled_frac * 100).toFixed(0)}%</div>
                    <div className="m-delta">
                      {simResult.n_steps} nhịp tham gia, {Math.round(simResult.exec_time_s)}s
                    </div>
                  </div>
                  <div className="metric-card">
                    <div className="m-label">VWAP thực hiện</div>
                    <div className="m-val">
                      {Math.round(simResult.vwap_exec).toLocaleString('en-US')} đ
                    </div>
                  </div>
                </div>
                {hasFold && (() => {
                  const inside =
                    estimate.full.lo_bps <= simResult.realized_is_bps &&
                    simResult.realized_is_bps <= estimate.full.hi_bps;
                  return (
                    <div className={`callout ${inside ? 'success' : 'warning'}`}>
                      {inside
                        ? `Thực hiện nằm TRONG khoảng dự báo 90% [${estimate.full.lo_bps.toFixed(1)}, ${estimate.full.hi_bps.toFixed(1)}] bps.`
                        : `Thực hiện nằm NGOÀI khoảng dự báo 90% — đuôi rủi ro là có thật; độ phủ tổng thể xem tab Kiểm chứng (không phải lúc nào cũng phủ).`}
                    </div>
                  );
                })()}
                <div className="small-caption">
                  Một lệnh đơn lẻ không chứng minh được mô hình — bằng chứng đầy đủ là{' '}
                  {(estimate.nOos ?? 0).toLocaleString('en-US')} lệnh test ngoài mẫu ở tab Kiểm
                  chứng. Mô phỏng không phát sinh lệnh thật.
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
