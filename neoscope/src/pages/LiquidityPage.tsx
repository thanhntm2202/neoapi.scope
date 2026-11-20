import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, SlidersHorizontal } from 'lucide-react';
import { computeWeightedLhs, LhsWeights } from '../../server/liquidityMath';
import { PlotlyChart } from '../components/PlotlyChart';
import { SectionHeading } from '../components/ThemeParts';
import { C_ACCENT, C_GRID, C_LARGE, C_MUTED, C_TEXT, C_THIN, fmtVnHm, toVnIsoLocal } from '../lib/format';
import { buildIntradayHeatmapMatrix, HeatmapMetric } from '../lib/tradingview';

interface LiquidityPageProps {
  sessionData: any;
  symbols: string[];
  results: any;
  preferredSym?: string | null;
  onConsumePreferredSym?: () => void;
}

const COMP_KEYS = ['tightness', 'depth', 'immediacy', 'stability', 'balance'] as const;
const COMP_LABELS = ['Độ chặt<br>spread', 'Độ sâu', 'Tức thời<br>(ILLIQ)', 'Ổn định<br>spread', 'Cân bằng<br>OBI'];
const RADAR_LABELS = ['Độ chặt spread', 'Độ sâu', 'Tức thời (ILLIQ)', 'Ổn định spread', 'Cân bằng OBI'];

const WEIGHT_FIELDS: { key: keyof LhsWeights; label: string; hint: string }[] = [
  { key: 'tightness', label: 'Độ chặt spread', hint: 'Chênh lệch giá mua/bán tốt nhất' },
  { key: 'depth', label: 'Độ sâu 3 mức', hint: 'Khối lượng chào sẵn trên sổ lệnh' },
  { key: 'immediacy', label: 'Tức thời (ILLIQ)', hint: 'Mức trượt giá trên đồng khối lượng' },
  { key: 'stability', label: 'Ổn định spread', hint: 'Ít giãn rộng đột ngột qua thời gian' },
  { key: 'balance', label: 'Cân bằng OBI', hint: 'Cân xứng giữa lực mua và lực bán' },
];

const WEIGHT_PRESETS: { id: string; label: string; weights: LhsWeights }[] = [
  {
    id: 'default',
    label: 'Mặc định (1 : 1)',
    weights: { tightness: 1, depth: 1, immediacy: 1, stability: 1, balance: 1 },
  },
  {
    id: 'scalp',
    label: 'Lướt sóng nhanh',
    weights: { tightness: 3, depth: 1, immediacy: 1, stability: 1, balance: 2.5 },
  },
  {
    id: 'block',
    label: 'Đi lệnh lớn (Block)',
    weights: { tightness: 1, depth: 3, immediacy: 2.5, stability: 1, balance: 0.5 },
  },
  {
    id: 'defensive',
    label: 'Phòng thủ ổn định',
    weights: { tightness: 1, depth: 1.5, immediacy: 1, stability: 3, balance: 1 },
  },
];

export const LiquidityPage: React.FC<LiquidityPageProps> = ({
  sessionData,
  symbols,
  results,
  preferredSym,
  onConsumePreferredSym,
}) => {
  const dayBars = useMemo(() => sessionData?.barsLhs || [], [sessionData]);
  const validBars = useMemo(
    () => dayBars.filter((b: any) => b.lhs !== null && Number.isFinite(b.lhs)),
    [dayBars],
  );

  const times = useMemo(() => {
    const map = new Map<number, string>();
    for (const b of validBars) {
      map.set(b.bar_ts_ms, b.bar_ts);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([ms, iso]) => ({ ms, iso }));
  }, [validBars]);

  const [timeIdx, setTimeIdx] = useState<number>(Math.max(times.length - 1, 0));
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [heatmapMetric, setHeatmapMetric] = useState<HeatmapMetric>('lhs');
  const [weights, setWeights] = useState<LhsWeights>({
    tightness: 1,
    depth: 1,
    immediacy: 1,
    stability: 1,
    balance: 1,
  });

  useEffect(() => {
    setIsPlaying(false);
    setTimeIdx(Math.max(times.length - 1, 0));
  }, [times.length]);

  useEffect(() => {
    if (!isPlaying || times.length <= 1) return;
    const id = window.setInterval(() => {
      setTimeIdx((prev) => {
        if (prev >= times.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 750);
    return () => window.clearInterval(id);
  }, [isPlaying, times.length]);

  const selectedTime = times[Math.min(timeIdx, Math.max(times.length - 1, 0))];
  const atT = useMemo(() => {
    if (!selectedTime) return [];
    return validBars
      .filter((b: any) => b.bar_ts_ms === selectedTime.ms)
      .sort((a: any, b: any) => b.lhs - a.lhs);
  }, [validBars, selectedTime]);

  const symOptions: string[] = useMemo(() => atT.map((r: any) => String(r.symbol)), [atT]);
  const [selectedSym, setSelectedSym] = useState<string>('');
  const [symA, setSymA] = useState<string>('');
  const [symB, setSymB] = useState<string>('');

  useEffect(() => {
    if (preferredSym && symOptions.includes(preferredSym)) {
      setSelectedSym(preferredSym);
      setSymA(preferredSym);
      onConsumePreferredSym?.();
    }
  }, [preferredSym, symOptions, onConsumePreferredSym]);

  useEffect(() => {
    if (symOptions.length) {
      if (!selectedSym || !symOptions.includes(selectedSym)) setSelectedSym(symOptions[0]);
      if (!symA || !symOptions.includes(symA)) setSymA(symOptions[0]);
      if (!symB || !symOptions.includes(symB) || symB === symA) {
        setSymB(symOptions.find((x: string) => x !== (symA || symOptions[0])) || symOptions[0]);
      }
    }
  }, [symOptions, selectedSym, symA, symB]);

  const pickedRow = useMemo(() => {
    return atT.find((r: any) => r.symbol === selectedSym) || atT[0];
  }, [atT, selectedSym]);

  // Charts
  const rankingData = useMemo(() => {
    const sorted = [...atT].sort((a: any, b: any) => a.lhs - b.lhs);
    return [
      {
        type: 'bar',
        orientation: 'h',
        x: sorted.map((d: any) => d.lhs),
        y: sorted.map((d: any) => d.symbol),
        marker: {
          color: sorted.map((d: any) => (d.group === 'thin' ? C_THIN : C_LARGE)),
        },
        text: sorted.map((d: any) => Number(d.lhs).toFixed(1)),
        textposition: 'outside',
        hovertemplate: '%{y}: LHS %{x:.1f}/100<extra></extra>',
      },
    ];
  }, [atT]);

  const gaugeData = useMemo(() => {
    if (!pickedRow) return [];
    const color = pickedRow.group === 'thin' ? C_THIN : C_LARGE;
    return [
      {
        type: 'indicator',
        mode: 'gauge+number',
        value: pickedRow.lhs,
        number: { font: { size: 28, color: '#f1f6ff' }, suffix: '/100' },
        title: { text: `LHS · ${pickedRow.symbol}`, font: { size: 13, color: C_TEXT } },
        gauge: {
          axis: { range: [0, 100], tickfont: { size: 10, color: C_MUTED }, tickcolor: C_GRID },
          bar: { color, thickness: 0.28 },
          bgcolor: 'rgba(17,26,46,0.5)',
          bordercolor: C_GRID,
          borderwidth: 1,
          steps: [
            { range: [0, 33], color: 'rgba(248,113,113,0.10)' },
            { range: [33, 66], color: 'rgba(251,191,36,0.10)' },
            { range: [66, 100], color: 'rgba(52,211,153,0.10)' },
          ],
        },
      },
    ];
  }, [pickedRow]);

  const breakdownData = useMemo(() => {
    if (!pickedRow) return [];
    const vals = COMP_KEYS.map((c) => 100 * Number(pickedRow[`r_${c}`] ?? 0));
    return [
      {
        type: 'bar',
        x: COMP_LABELS,
        y: vals,
        marker: { color: C_ACCENT },
        text: vals.map((v) => v.toFixed(0)),
        textposition: 'outside',
        hovertemplate: '%{x}: hạng percentile %{y:.0f}%<extra></extra>',
      },
    ];
  }, [pickedRow]);

  const radarData = useMemo(() => {
    const rows: any[] = [];
    for (const s of Array.from(new Set([symA, symB]))) {
      const r = atT.find((x: any) => x.symbol === s);
      if (r) rows.push(r);
    }
    if (rows.length < 2) return [];
    return rows.map((row) => {
      const vals = COMP_KEYS.map((c) => 100 * Number(row[`r_${c}`] ?? 0));
      const color = row.group === 'thin' ? C_THIN : C_LARGE;
      return {
        type: 'scatterpolar',
        r: [...vals, vals[0]],
        theta: [...RADAR_LABELS, RADAR_LABELS[0]],
        name: row.symbol,
        line: { color, width: 2.2 },
        fillcolor: color,
        fill: 'toself',
        opacity: 0.2,
        hovertemplate: `${row.symbol} %{theta}: %{r:.0f}%<extra></extra>`,
      };
    });
  }, [atT, symA, symB]);

  const timeseriesData = useMemo(() => {
    return symbols.map((sym) => {
      const g = validBars
        .filter((b: any) => b.symbol === sym)
        .sort((a: any, b: any) => a.bar_ts_ms - b.bar_ts_ms);
      const grp = g[0]?.group || 'large';
      return {
        type: 'scatter',
        mode: 'lines',
        name: sym,
        x: g.map((r: any) => toVnIsoLocal(r.bar_ts)),
        y: g.map((r: any) => r.lhs),
        line: {
          color: grp === 'thin' ? C_THIN : C_LARGE,
          width: 1.6,
          dash: grp === 'thin' ? 'dot' : 'solid',
        },
        hovertemplate: `${sym} %{x|%H:%M} LHS %{y:.1f}<extra></extra>`,
      };
    });
  }, [validBars, symbols]);

  const distData = useMemo(() => {
    return ['large', 'thin']
      .map((grp) => {
        const g = validBars.filter((b: any) => b.group === grp);
        if (!g.length) return null;
        return {
          type: 'histogram',
          x: g.map((r: any) => r.lhs),
          name: `Nhóm ${grp} (n=${g.length.toLocaleString('en-US')} bar)`,
          marker: { color: grp === 'thin' ? C_THIN : C_LARGE },
          opacity: 0.6,
          nbinsx: 30,
          hovertemplate: 'LHS %{x:.0f}: %{y} bar<extra></extra>',
        };
      })
      .filter(Boolean) as any[];
  }, [validBars]);

  const heatmapMatrix = useMemo(
    () => buildIntradayHeatmapMatrix(dayBars, symbols, heatmapMetric),
    [dayBars, symbols, heatmapMetric],
  );

  const heatmapData = useMemo(() => {
    if (!heatmapMatrix.xLabels.length || !heatmapMatrix.ySymbols.length) return [];
    const colorscale =
      heatmapMetric === 'lhs'
        ? [
            [0, '#ef5350'],
            [0.45, '#f59e0b'],
            [0.75, '#29b6f6'],
            [1, '#26a69a'],
          ]
        : heatmapMetric === 'spread_bps'
          ? [
              [0, '#26a69a'],
              [0.5, '#f59e0b'],
              [1, '#ef5350'],
            ]
          : [
              [0, '#1e293b'],
              [0.5, '#29b6f6'],
              [1, '#26a69a'],
            ];

    const unit = heatmapMetric === 'lhs' ? 'điểm' : heatmapMetric === 'spread_bps' ? 'bps' : 'tỷ đ';
    return [
      {
        type: 'heatmap',
        x: heatmapMatrix.xLabels,
        y: heatmapMatrix.ySymbols,
        z: heatmapMatrix.z,
        zmin: heatmapMetric === 'lhs' ? 0 : undefined,
        zmax: heatmapMetric === 'lhs' ? 100 : undefined,
        colorscale,
        xgap: 2,
        ygap: 2,
        hoverongaps: false,
        hovertemplate: `%{y} · %{x}<br>%{z:.2f} ${unit}<extra></extra>`,
        colorbar: {
          title: { text: unit, font: { size: 11, color: C_MUTED } },
          tickfont: { size: 10, color: C_MUTED },
          thickness: 12,
        },
      },
    ];
  }, [heatmapMatrix, heatmapMetric]);

  const sens: any[] = results?.lhs_sensitivity || [];
  const meanRho = sens.length
    ? sens.reduce((a, b) => a + Number(b.mean_spearman), 0) / sens.length
    : null;
  const minRho = sens.length
    ? Math.min(...sens.map((b) => Number(b.min_spearman)))
    : null;

  const weightedSandbox = useMemo(() => computeWeightedLhs(atT, weights), [atT, weights]);
  const activePresetId = useMemo(() => {
    const found = WEIGHT_PRESETS.find((p) =>
      WEIGHT_FIELDS.every((f) => Math.abs(p.weights[f.key] - weights[f.key]) < 1e-6),
    );
    return found ? found.id : 'custom';
  }, [weights]);

  if (!dayBars.length) {
    return <div className="callout warning">Chưa có LHS cho phiên này — chạy `neoscope analyze`.</div>;
  }
  if (!validBars.length) {
    return (
      <div className="callout warning">
        Phiên này chưa có LHS hợp lệ (cần ≥5 bar liên tiếp để dựng cửa sổ trượt 15&apos;).
      </div>
    );
  }

  return (
    <div>
      <h2 className="page-subheader">Thanh khoản · Mã này khỏe đến đâu, so với nhóm?</h2>
      <p className="page-caption">
        LHS = 100 × trung bình có trọng số của <strong>hạng percentile chéo mã</strong> trên 5 cấu
        phần (độ chặt, độ sâu, tức thời, ổn định, cân bằng) — cửa sổ trượt 15 phút. Điểm 80 là điểm
        tổng hợp tương đối, không phải percentile của LHS hay xác suất khỏe hơn 80% mã.
      </p>

      <div className="card-panel" style={{ marginBottom: 14 }}>
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
          <span className="field-label" style={{ margin: 0 }}>
            Thời điểm đánh giá (UTC+7)
          </span>
          <div className="tv-replay-bar">
            <button
              type="button"
              className="tv-replay-btn"
              aria-label="Lùi một bar"
              disabled={timeIdx <= 0}
              onClick={() => {
                setIsPlaying(false);
                setTimeIdx((i) => Math.max(0, i - 1));
              }}
            >
              <ChevronLeft size={13} /> -1
            </button>
            <button
              type="button"
              className={`tv-replay-btn ${isPlaying ? 'playing' : ''}`}
              aria-label={isPlaying ? 'Tạm dừng phát LHS' : 'Phát diễn biến LHS trong phiên'}
              onClick={() => {
                if (!isPlaying && timeIdx >= times.length - 1) setTimeIdx(0);
                setIsPlaying((p) => !p);
              }}
            >
              {isPlaying ? <Pause size={12} /> : <Play size={12} />}
              {isPlaying ? 'Tạm dừng' : 'Phát'}
            </button>
            <button
              type="button"
              className="tv-replay-btn"
              aria-label="Tiến một bar"
              disabled={timeIdx >= times.length - 1}
              onClick={() => {
                setIsPlaying(false);
                setTimeIdx((i) => Math.min(times.length - 1, i + 1));
              }}
            >
              +1 <ChevronRight size={13} />
            </button>
            <span className="mono" style={{ fontSize: 12.5, color: '#29b6f6', fontWeight: 700, marginLeft: 4 }}>
              {selectedTime ? fmtVnHm(selectedTime.iso) : '—'} ({timeIdx + 1}/{times.length})
            </span>
          </div>
        </div>
        <input
          type="range"
          className="range-slider"
          min={0}
          max={Math.max(times.length - 1, 0)}
          value={Math.min(timeIdx, Math.max(times.length - 1, 0))}
          onChange={(e) => {
            setIsPlaying(false);
            setTimeIdx(Number(e.target.value));
          }}
        />
      </div>

      <div className="grid-2-weighted">
        <div>
          <PlotlyChart
            data={rankingData}
            height={360}
            title="Xếp hạng sức khỏe thanh khoản tại thời điểm chọn"
            layout={{
              xaxis: { range: [0, 108], title: 'Liquidity Health Score (0–100)' },
              margin: { l: 58, r: 28, t: 52, b: 44 },
            }}
            alt="Xếp hạng điểm sức khỏe thanh khoản giữa các mã tại thời điểm đã chọn."
          />
        </div>
        <div>
          <div style={{ maxWidth: 260, marginBottom: 8 }}>
            <label className="field-label">Soi cấu phần mã</label>
            <select
              className="select-input"
              value={selectedSym}
              onChange={(e) => setSelectedSym(e.target.value)}
            >
              {symOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="grid-2" style={{ alignItems: 'center' }}>
            <PlotlyChart
              data={gaugeData}
              height={240}
              layout={{ margin: { l: 24, r: 24, t: 42, b: 10 } }}
              alt={`Đồng hồ LHS của ${selectedSym} tại thời điểm đã chọn.`}
            />
            <PlotlyChart
              data={breakdownData}
              height={320}
              title={`Cấu phần LHS của ${pickedRow?.symbol || ''}`}
              layout={{
                yaxis: { range: [0, 112], title: 'Percentile chéo watchlist (%)' },
                margin: { l: 48, r: 14, t: 52, b: 68 },
              }}
              alt="Năm cấu phần percentile giải thích điểm LHS của mã đã chọn."
            />
          </div>
        </div>
      </div>

      <SectionHeading
        title="Liquidity Radar · so 'chân dung' thanh khoản giữa hai mã"
        note="Cùng một điểm LHS có thể đến từ hình dáng rất khác nhau — radar cho thấy mã nào chắc ở đâu, yếu ở đâu (hạng percentile chéo watchlist, càng rộng càng khỏe)."
      />
      <div className="grid-2" style={{ maxWidth: 520, marginBottom: 8 }}>
        <div>
          <label className="field-label">Mã A</label>
          <select className="select-input" value={symA} onChange={(e) => setSymA(e.target.value)}>
            {symOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">Mã B</label>
          <select className="select-input" value={symB} onChange={(e) => setSymB(e.target.value)}>
            {symOptions
              .filter((x) => x !== symA)
              .map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
          </select>
        </div>
      </div>
      {radarData.length >= 2 ? (
        <PlotlyChart
          data={radarData}
          height={440}
          title="Radar 5 cấu phần thanh khoản — hình dáng quan trọng hơn điểm tổng"
          layout={{
            margin: { l: 48, r: 48, t: 82, b: 36 },
            legend: { orientation: 'h', yanchor: 'bottom', y: 1.06, x: 0 },
            polar: {
              bgcolor: 'rgba(0,0,0,0)',
              radialaxis: {
                range: [0, 100],
                gridcolor: C_GRID,
                tickfont: { size: 10, color: C_MUTED },
                tickvals: [25, 50, 75, 100],
              },
              angularaxis: { gridcolor: C_GRID, tickfont: { size: 11.5, color: C_TEXT } },
            },
            showlegend: true,
          }}
          alt="Radar so sánh năm cấu phần LHS của hai mã đã chọn."
        />
      ) : (
        <div className="callout info">Chọn hai mã khác nhau để so radar.</div>
      )}

      <SectionHeading
        title="Diễn biến LHS trong phiên"
        note="Cửa sổ trượt 15 phút; nét liền = nhóm thanh khoản cao, nét chấm = nhóm midcap mỏng."
      />
      <PlotlyChart
        data={timeseriesData}
        height={360}
        crosshair
        title="Diễn biến LHS trong phiên (cửa sổ trượt 15 phút)"
        layout={{
          yaxis: { side: 'right', range: [0, 100], title: 'LHS' },
          xaxis: { title: 'Giờ phiên (UTC+7)' },
        }}
        alt="Diễn biến điểm LHS trong ngày của các mã được chọn."
      />

      {heatmapData.length > 0 && (
        <div className="card-panel" style={{ marginTop: 16 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 10,
              marginBottom: 8,
            }}
          >
            <div>
              <h3 className="sec-title" style={{ margin: 0 }}>
                Bản đồ nhiệt thanh khoản theo khung 15′ (Mã × Giờ trong phiên)
              </h3>
              <div className="sec-note" style={{ margin: '2px 0 0 0' }}>
                Quét nhanh thời điểm thị trường hụt độ sâu hoặc giãn spread giữa các mã trong phiên.
              </div>
            </div>
            <div className="tv-seg-group" role="group" aria-label="Chỉ số bản đồ nhiệt thanh khoản">
              <button
                type="button"
                className={`tv-seg-btn ${heatmapMetric === 'lhs' ? 'active' : ''}`}
                onClick={() => setHeatmapMetric('lhs')}
              >
                LHS (0–100)
              </button>
              <button
                type="button"
                className={`tv-seg-btn ${heatmapMetric === 'spread_bps' ? 'active' : ''}`}
                onClick={() => setHeatmapMetric('spread_bps')}
              >
                Spread (bps)
              </button>
              <button
                type="button"
                className={`tv-seg-btn ${heatmapMetric === 'depth_bid_vnd' ? 'active' : ''}`}
                onClick={() => setHeatmapMetric('depth_bid_vnd')}
              >
                Depth Bid (tỷ đ)
              </button>
            </div>
          </div>
          <PlotlyChart
            data={heatmapData}
            height={Math.max(260, heatmapMatrix.ySymbols.length * 34 + 92)}
            layout={{
              xaxis: { type: 'category', title: 'Khung 15 phút (UTC+7)' },
              yaxis: { type: 'category', automargin: true },
              margin: { l: 58, r: 72, t: 24, b: 46 },
            }}
            alt="Bản đồ nhiệt thanh khoản nội phiên theo mã cổ phiếu và khung giờ 15 phút."
          />
        </div>
      )}

      <SectionHeading
        title="Phân phối LHS trong phiên"
        note="Hai nhóm thanh khoản tách bạch đến đâu trong cùng một phiên — khoảng cách giữa hai phân phối chính là 'phí' rủi ro thanh khoản của nhóm midcap mỏng."
      />
      <PlotlyChart
        data={distData}
        height={300}
        title="Phân phối LHS nội phiên theo nhóm thanh khoản"
        layout={{
          barmode: 'overlay',
          xaxis: { title: 'LHS (0–100)', range: [0, 100] },
          yaxis: { title: 'Số bar 1 phút' },
        }}
        alt="Phân phối điểm LHS của từng nhóm thanh khoản trong phiên."
      />

      {sens.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <SectionHeading title="Độ nhạy trọng số (kiểm tra robustness)" />
          <div className="table-wrap">
            <table className="neo-table">
              <thead>
                <tr>
                  <th>Trọng số bị nhân đôi</th>
                  <th className="num">Spearman TB với LHS gốc</th>
                  <th className="num">Spearman nhỏ nhất</th>
                </tr>
              </thead>
              <tbody>
                {sens.map((r, i) => (
                  <tr key={i}>
                    <td>{r.perturbed_weight}</td>
                    <td className="num">{Number(r.mean_spearman).toFixed(4)}</td>
                    <td className="num">{Number(r.min_spearman).toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {meanRho !== null && minRho !== null && (
            <div className="small-caption">
              Khi nhân đôi từng trọng số, Spearman trung bình theo cấu hình hiện tại là{' '}
              {meanRho.toFixed(3)}; giá trị thấp nhất theo thời điểm là {minRho.toFixed(3)}. Đây
              chỉ là độ nhạy thứ hạng với lựa chọn trọng số, không chứng minh LHS đo đúng thanh
              khoản. Giá trị xây dựng so với ILLIQ tương lai xem tab Kiểm chứng.
            </div>
          )}
        </div>
      )}

      {weightedSandbox.items.length > 0 && (
        <div className="card-panel" style={{ marginTop: 18 }} aria-label="Phòng thí nghiệm trọng số LHS">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 10,
              marginBottom: 8,
            }}
          >
            <div>
              <h3 className="sec-title" style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                <SlidersHorizontal size={15} color="#29b6f6" />
                Phòng thí nghiệm trọng số LHS (What-If Sandbox · lúc{' '}
                {selectedTime ? fmtVnHm(selectedTime.iso) : '—'})
              </h3>
              <div className="sec-note" style={{ margin: '2px 0 0 0' }}>
                Điều chỉnh trọng số 5 cấu phần theo khẩu vị giao dịch (lướt sóng, đi lệnh lớn, phòng thủ) để kiểm tra độ nhạy thứ hạng trực tiếp.
              </div>
            </div>
            <div className="sandbox-rho-badge" aria-live="polite">
              Spearman ρ vs mặc định:{' '}
              <strong>
                {weightedSandbox.spearmanVsBaseline !== null
                  ? weightedSandbox.spearmanVsBaseline.toFixed(3)
                  : '—'}
              </strong>
            </div>
          </div>

          <div className="tv-seg-group" role="group" aria-label="Cấu hình trọng số mẫu" style={{ marginBottom: 12 }}>
            {WEIGHT_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`tv-seg-btn ${activePresetId === p.id ? 'active' : ''}`}
                aria-pressed={activePresetId === p.id}
                onClick={() => setWeights({ ...p.weights })}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="sandbox-layout" style={{ alignItems: 'start' }}>
            <div className="sandbox-sliders-col">
              {WEIGHT_FIELDS.map((f) => (
                <div key={f.key} className="sandbox-slider-row">
                  <div className="sandbox-slider-top">
                    <label htmlFor={`lhs-w-${f.key}`}>{f.label}</label>
                    <span className="mono" style={{ color: '#29b6f6', fontWeight: 700 }}>
                      ×{weights[f.key].toFixed(1)}
                    </span>
                  </div>
                  <input
                    id={`lhs-w-${f.key}`}
                    type="range"
                    className="range-slider"
                    min={0}
                    max={3}
                    step={0.5}
                    value={weights[f.key]}
                    onChange={(e) =>
                      setWeights((prev) => ({ ...prev, [f.key]: Number(e.target.value) }))
                    }
                  />
                  <div className="small-caption" style={{ margin: '1px 0 0 0', fontSize: 11 }}>
                    {f.hint}
                  </div>
                </div>
              ))}
            </div>

            <div className="table-wrap">
              <table className="neo-table compact">
                <thead>
                  <tr>
                    <th className="num">Mới</th>
                    <th className="num">Gốc</th>
                    <th className="num">Δ</th>
                    <th>Mã</th>
                    <th>Nhóm</th>
                    <th className="num">LHS gốc</th>
                    <th className="num">LHS mới</th>
                  </tr>
                </thead>
                <tbody>
                  {weightedSandbox.items.map((item) => (
                    <tr key={item.symbol}>
                      <td className="num" style={{ fontWeight: 700 }}>#{item.customRank}</td>
                      <td className="num">#{item.baselineRank}</td>
                      <td className="num">
                        <span
                          className={`rank-delta-chip ${
                            item.rankDelta > 0 ? 'up' : item.rankDelta < 0 ? 'down' : 'flat'
                          }`}
                        >
                          {item.rankDelta > 0
                            ? `▲ +${item.rankDelta}`
                            : item.rankDelta < 0
                              ? `▼ ${item.rankDelta}`
                              : '—'}
                        </span>
                      </td>
                      <td className="mono" style={{ fontWeight: 700, color: '#f0f3fa' }}>
                        {item.symbol}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {item.group === 'thin' ? 'Midcap mỏng' : 'VN30 lớn'}
                      </td>
                      <td className="num">{item.baselineLhs.toFixed(1)}</td>
                      <td className="num" style={{ fontWeight: 700, color: '#29b6f6' }}>
                        {item.customLhs.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
