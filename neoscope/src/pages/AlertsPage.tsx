import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CandlestickChart, Download } from 'lucide-react';
import { PlotlyChart } from '../components/PlotlyChart';
import { KpiGrid } from '../components/ThemeParts';
import {
  C_ACCENT,
  C_BAD,
  C_LARGE,
  downloadCsv,
  fmtAlertDirection,
  fmtAlertScale,
  fmtAlertType,
  fmtAlertTypeDesc,
  fmtNum,
  fmtVnd,
  fmtVnHms,
  toVnIsoLocal,
} from '../lib/format';

function fmtAlertStat(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  if (Math.abs(val) >= 1e6) return fmtVnd(val);
  return fmtNum(val, 3);
}

interface AlertsPageProps {
  dataset: string;
  session: string;
  symbols: string[];
  results: any;
  mode: string;
  focusedAlert?: { session_date: string; symbol: string; ts_ms: number; type?: string } | null;
  onConsumeFocusedAlert?: () => void;
  onSimulateAtAlert?: (symbol: string, tsMs: number) => void;
}

const PRIO_LABEL: Record<string, string> = {
  P1: 'P1 · Rất hiếm',
  P2: 'P2 · Hiếm',
  P3: 'P3 · Bất thường',
};

const PRIO_RANK: Record<string, number> = { P1: 0, P2: 1, P3: 2 };

export const AlertsPage: React.FC<AlertsPageProps> = ({
  dataset,
  session,
  symbols,
  results,
  mode,
  focusedAlert,
  onConsumeFocusedAlert,
  onSimulateAtAlert,
}) => {
  const alerts: any[] = useMemo(() => results?.alerts || [], [results]);
  const alertPr: any[] = useMemo(() => results?.alert_pr || [], [results]);

  const allSessions = useMemo(
    () => Array.from(new Set(alerts.map((a) => a.session_date))).sort(),
    [alerts],
  );
  const allTypes = useMemo(
    () => Array.from(new Set(alerts.map((a) => a.type))).sort(),
    [alerts],
  );
  const allAlertSymbols = useMemo(
    () => Array.from(new Set(alerts.map((a) => a.symbol))).sort(),
    [alerts],
  );
  const allPriorities = useMemo(
    () => ['P1', 'P2', 'P3'].filter((p) => alerts.some((a) => (a.priority || 'P3') === p)),
    [alerts],
  );

  const [selSessions, setSelSessions] = useState<string[]>([session]);
  const [selTypes, setSelTypes] = useState<string[]>(allTypes);
  const [selSyms, setSelSyms] = useState<string[]>(symbols);
  const [selPriorities, setSelPriorities] = useState<string[]>(allPriorities);

  useEffect(() => {
    setSelSessions(allSessions.includes(session) ? [session] : allSessions);
  }, [session, allSessions]);

  useEffect(() => {
    setSelTypes(allTypes);
  }, [allTypes]);

  useEffect(() => {
    const def = symbols.filter((s) => allAlertSymbols.includes(s));
    setSelSyms(def.length ? def : allAlertSymbols);
  }, [symbols, allAlertSymbols]);

  useEffect(() => {
    setSelPriorities(allPriorities);
  }, [allPriorities]);

  const filtered = useMemo(() => {
    const ss = new Set(selSessions);
    const st = new Set(selTypes);
    const sy = new Set(selSyms);
    const sp = new Set(selPriorities);
    return alerts.filter(
      (a) =>
        ss.has(a.session_date) &&
        st.has(a.type) &&
        sy.has(a.symbol) &&
        sp.has(a.priority || 'P3'),
    );
  }, [alerts, selSessions, selTypes, selSyms, selPriorities]);

  const sortedForTable = useMemo(() => {
    return [...filtered].sort(
      (a, b) =>
        (PRIO_RANK[a.priority || 'P3'] ?? 2) - (PRIO_RANK[b.priority || 'P3'] ?? 2) ||
        b.ts_ms - a.ts_ms,
    );
  }, [filtered]);

  const sortedForPick = useMemo(() => {
    return [...filtered].sort((a, b) => a.ts_ms - b.ts_ms);
  }, [filtered]);

  const [pickIdx, setPickIdx] = useState<number>(0);
  const skipNextResetRef = useRef<boolean>(false);

  useEffect(() => {
    if (!focusedAlert) return;
    setSelSessions((prev) =>
      prev.includes(focusedAlert.session_date) ? prev : [...prev, focusedAlert.session_date],
    );
    setSelSyms((prev) =>
      prev.includes(focusedAlert.symbol) ? prev : [...prev, focusedAlert.symbol],
    );
    const matchIdx = sortedForPick.findIndex(
      (a) =>
        a.session_date === focusedAlert.session_date &&
        a.symbol === focusedAlert.symbol &&
        a.ts_ms === focusedAlert.ts_ms &&
        (!focusedAlert.type || a.type === focusedAlert.type),
    );
    if (matchIdx >= 0) {
      skipNextResetRef.current = true;
      setPickIdx(matchIdx);
      onConsumeFocusedAlert?.();
      window.setTimeout(() => {
        document
          .getElementById('alert-evidence-panel')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    }
  }, [focusedAlert, sortedForPick, onConsumeFocusedAlert]);

  useEffect(() => {
    if (skipNextResetRef.current) {
      skipNextResetRef.current = false;
      return;
    }
    setPickIdx(0);
  }, [sortedForPick.length]);

  const pickedAlert = sortedForPick[Math.min(pickIdx, Math.max(sortedForPick.length - 1, 0))];

  const [contextRows, setContextRows] = useState<any[]>([]);
  const [truthEvents, setTruthEvents] = useState<any[]>([]);

  useEffect(() => {
    if (!pickedAlert) {
      setContextRows([]);
      setTruthEvents([]);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({
      session: pickedAlert.session_date,
      symbol: pickedAlert.symbol,
      ts_ms: String(pickedAlert.ts_ms),
    });
    if (dataset) params.set('dataset', dataset);
    fetch(`/api/alerts/context?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) {
          setContextRows(d.rows || []);
          setTruthEvents(d.truthEvents || []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setContextRows([]);
          setTruthEvents([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [dataset, pickedAlert]);

  const timelineData = useMemo(() => {
    const prioColor: Record<string, string> = { P1: C_BAD, P2: '#fbbf24', P3: C_LARGE };
    const prioSize: Record<string, number> = { P1: 13, P2: 10, P3: 8 };
    const bySym = new Map<string, any[]>();
    for (const a of filtered) {
      const arr = bySym.get(a.symbol) || [];
      arr.push(a);
      bySym.set(a.symbol, arr);
    }
    return Array.from(bySym.entries()).map(([sym, rows]) => ({
      type: 'scatter',
      mode: 'markers',
      name: sym,
      x: rows.map((r) => toVnIsoLocal(r.ts)),
      y: rows.map((r) => fmtAlertType(r.type)),
      customdata: rows.map((r) => r.z),
      marker: {
        size: rows.map((r) => prioSize[r.priority || 'P3'] ?? 8),
        color: rows.map((r) => prioColor[r.priority || 'P3'] ?? C_LARGE),
        opacity: 0.85,
        line: { width: 1, color: '#131722' },
      },
      hovertemplate: `${sym} · %{y}<br>%{x|%H:%M:%S} · z=%{customdata:.2f}<extra></extra>`,
    }));
  }, [filtered]);

  const { contextData, contextShapes, contextAnnotations } = useMemo(() => {
    if (!pickedAlert || !contextRows.length) {
      return { contextData: [], contextShapes: [], contextAnnotations: [] };
    }
    const xs = contextRows.map((r) => toVnIsoLocal(r.ts));
    const lp = contextRows.filter((r) => r.last_price !== null && Number.isFinite(r.last_price));
    const alertX = toVnIsoLocal(pickedAlert.ts);
    const t0 = contextRows[0].ts_ms;
    const t1 = contextRows[contextRows.length - 1].ts_ms;

    const shapes: any[] = [
      {
        type: 'line',
        x0: alertX,
        x1: alertX,
        y0: 0,
        y1: 1,
        xref: 'x',
        yref: 'paper',
        line: { color: C_BAD, dash: 'dash', width: 1.5 },
      },
    ];

    for (const e of truthEvents) {
      const sMs = new Date(e.start_ts).getTime();
      const eMs = new Date(e.end_ts).getTime();
      if (eMs >= t0 && sMs <= t1) {
        shapes.push({
          type: 'rect',
          x0: toVnIsoLocal(new Date(Math.max(sMs, t0)).toISOString()),
          x1: toVnIsoLocal(new Date(Math.min(eMs, t1)).toISOString()),
          y0: 0,
          y1: 1,
          xref: 'x',
          yref: 'paper',
          fillcolor: '#f59e0b',
          opacity: 0.14,
          line: { width: 0 },
        });
      }
    }

    const annotations = [
      {
        x: alertX,
        y: 1.0,
        xref: 'x',
        yref: 'paper',
        text: 'cảnh báo',
        showarrow: false,
        font: { color: C_BAD, size: 11 },
        yanchor: 'bottom',
      },
    ];

    const data = [
      {
        x: xs,
        y: contextRows.map((r) => r.mid),
        name: 'Mid',
        type: 'scatter',
        mode: 'lines',
        line: { color: C_ACCENT, width: 1.5 },
        xaxis: 'x',
        yaxis: 'y',
      },
      {
        x: lp.map((r) => toVnIsoLocal(r.ts)),
        y: lp.map((r) => r.last_price),
        name: 'Giá khớp',
        type: 'scatter',
        mode: 'markers',
        marker: { size: 3.5, color: '#94a3b8' },
        xaxis: 'x',
        yaxis: 'y',
      },
      {
        x: xs,
        y: contextRows.map((r) => r.depth_bid_vnd),
        name: 'Depth bid',
        type: 'scatter',
        mode: 'lines',
        line: { color: C_LARGE, width: 1.3 },
        xaxis: 'x',
        yaxis: 'y2',
      },
      {
        x: xs,
        y: contextRows.map((r) => r.d_vol),
        name: 'd_vol',
        type: 'bar',
        marker: { color: '#64748b' },
        xaxis: 'x',
        yaxis: 'y3',
      },
    ];

    return { contextData: data, contextShapes: shapes, contextAnnotations: annotations };
  }, [pickedAlert, contextRows, truthEvents]);

  const prBarData = useMemo(() => {
    if (!alertPr.length) return [];
    const labels = alertPr.map((r) => fmtAlertType(r.alert_type));
    return [
      {
        type: 'bar',
        x: labels,
        y: alertPr.map((r) => Number(r.precision) * 100),
        name: 'Precision',
        marker: { color: C_ACCENT },
        text: alertPr.map((r) => `${(Number(r.precision) * 100).toFixed(0)}%`),
        textposition: 'outside',
      },
      {
        type: 'bar',
        x: labels,
        y: alertPr.map((r) => Number(r.recall) * 100),
        name: 'Recall (theo sự kiện)',
        marker: { color: C_LARGE },
        text: alertPr.map((r) => `${(Number(r.recall) * 100).toFixed(0)}%`),
        textposition: 'outside',
      },
    ];
  }, [alertPr]);

  const toggleItem = (list: string[], setList: (v: string[]) => void, val: string) => {
    if (list.includes(val)) setList(list.filter((x) => x !== val));
    else setList([...list, val]);
  };

  if (!alerts.length) {
    return <div className="callout warning">Chưa có cảnh báo — chạy `neoscope analyze`.</div>;
  }

  const p1Count = filtered.filter((a) => (a.priority || 'P3') === 'P1').length;
  const p2Count = filtered.filter((a) => (a.priority || 'P3') === 'P2').length;
  const uniqueSyms = new Set(filtered.map((a) => a.symbol)).size;

  return (
    <div>
      <h2 className="page-subheader">Cảnh báo · Điều gì bất thường, xảy ra khi nào và vì sao?</h2>
      <p className="page-caption">
        Ngưỡng suy từ thống kê: baseline expanding theo mã × bucket 15&apos; (tôn trọng hình chữ U
        nội ngày), cổng z + phân vị 99% + dai dẳng ≥ 3 tick + cooldown 60s. Mỗi cảnh báo mang bằng
        chứng đầy đủ.
      </p>

      <div className="card-panel">
        <div className="grid-4">
          <div>
            <span className="field-label">Phiên</span>
            <div className="symbol-chips">
              {allSessions.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`sym-chip ${selSessions.includes(s) ? 'selected large' : ''}`}
                  onClick={() => toggleItem(selSessions, setSelSessions, s)}
                >
                  {s.slice(5)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="field-label">Loại cảnh báo</span>
            <div className="symbol-chips">
              {allTypes.map((t) => (
                <button
                  key={t}
                  type="button"
                  title={fmtAlertTypeDesc(t)}
                  className={`sym-chip ${selTypes.includes(t) ? 'selected large' : ''}`}
                  onClick={() => toggleItem(selTypes, setSelTypes, t)}
                >
                  {fmtAlertType(t)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="field-label">Mã</span>
            <div className="symbol-chips">
              {allAlertSymbols.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`sym-chip ${selSyms.includes(s) ? 'selected large' : ''}`}
                  onClick={() => toggleItem(selSyms, setSelSyms, s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="field-label">Mức ưu tiên</span>
            <div className="symbol-chips">
              {allPriorities.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`sym-chip ${selPriorities.includes(p) ? 'selected thin' : ''}`}
                  onClick={() => toggleItem(selPriorities, setSelPriorities, p)}
                >
                  {PRIO_LABEL[p] || p}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <KpiGrid
        cards={[
          {
            label: 'Cảnh báo khớp bộ lọc',
            value: filtered.length.toLocaleString('en-US'),
            sub: 'tất cả mức ưu tiên',
            color: '#38bdf8',
          },
          {
            label: 'P1 · Rất hiếm',
            value: p1Count.toLocaleString('en-US'),
            sub: 'đuôi phân vị ≥ 99,9%',
            color: '#f87171',
          },
          {
            label: 'P2 · Hiếm',
            value: p2Count.toLocaleString('en-US'),
            sub: 'đuôi phân vị ≥ 99,5%',
            color: '#fbbf24',
          },
          {
            label: 'Mã có cảnh báo',
            value: uniqueSyms.toLocaleString('en-US'),
            sub: 'khác nhau trong lát cắt',
            color: '#a78bfa',
          },
        ]}
      />

      {filtered.length === 0 ? (
        <div className="callout info" style={{ marginTop: 12 }}>
          Không có cảnh báo khớp bộ lọc — nới bộ lọc hoặc chọn phiên khác.
        </div>
      ) : (
        <>
          <PlotlyChart
            data={timelineData}
            height={340}
            title="Timeline cảnh báo trong các phiên đã chọn — cụm sự kiện nhìn một lần thấy ngay"
            layout={{
              xaxis: { title: 'Giờ (UTC+7)' },
              yaxis: { automargin: true },
              legend: { orientation: 'h', yanchor: 'top', y: -0.24, x: 0 },
              margin: { l: 150, r: 22, t: 52, b: 84 },
            }}
            alt="Timeline cảnh báo: thời điểm × loại, kích thước và màu theo mức ưu tiên."
          />

          <details className="expander">
            <summary>⬇ Xuất danh sách cảnh báo (CSV)</summary>
            <div className="expander-body">
              <button
                className="btn"
                onClick={() =>
                  downloadCsv(
                    'neoscope_alerts.csv',
                    [
                      'priority',
                      'session_date',
                      'ts',
                      'symbol',
                      'loai_canh_bao',
                      'ma_loai',
                      'signed_value',
                      'z',
                      'pct',
                      'n_train',
                    ],
                    filtered.map((r) => [
                      r.priority,
                      r.session_date,
                      r.ts,
                      r.symbol,
                      fmtAlertType(r.type),
                      r.type,
                      r.signed_value,
                      r.z,
                      r.pct,
                      r.n_train,
                    ]),
                  )
                }
              >
                <Download size={14} /> Tải CSV
              </button>
            </div>
          </details>

          <div className="table-wrap table-scroll" style={{ marginTop: 10 }}>
            <table className="neo-table">
              <thead>
                <tr>
                  <th>Mức ưu tiên</th>
                  <th>Phiên</th>
                  <th>Giờ</th>
                  <th>Mã</th>
                  <th>Loại</th>
                  <th className="num">Giá trị (thang gốc)</th>
                  <th className="num">z</th>
                  <th className="num">Phân vị</th>
                  <th className="num">n baseline</th>
                </tr>
              </thead>
              <tbody>
                {sortedForTable.map((r, i) => {
                  const isPicked =
                    pickedAlert &&
                    r.session_date === pickedAlert.session_date &&
                    r.symbol === pickedAlert.symbol &&
                    r.ts_ms === pickedAlert.ts_ms &&
                    r.type === pickedAlert.type;
                  return (
                    <tr
                      key={i}
                      className={`clickable-row ${isPicked ? 'active-tape-row' : ''}`}
                      onClick={() => {
                        const idx = sortedForPick.findIndex(
                          (x) =>
                            x.session_date === r.session_date &&
                            x.symbol === r.symbol &&
                            x.ts_ms === r.ts_ms &&
                            x.type === r.type,
                        );
                        if (idx >= 0) {
                          setPickIdx(idx);
                          document
                            .getElementById('alert-evidence-panel')
                            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                      }}
                    >
                      <td>{PRIO_LABEL[r.priority || 'P3'] || r.priority}</td>
                      <td>{r.session_date}</td>
                      <td className="mono">{fmtVnHms(r.ts)}</td>
                      <td style={{ fontWeight: 700 }}>{r.symbol}</td>
                      <td title={fmtAlertTypeDesc(r.type)}>{fmtAlertType(r.type)}</td>
                      <td className="num">{fmtAlertStat(r.signed_value)}</td>
                      <td className="num">{fmtNum(r.z, 2)}</td>
                      <td className="num">{fmtNum(r.pct, 3)}</td>
                      <td className="num">{r.n_train}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 10,
              margin: '18px 0 8px 0',
            }}
          >
            <h4 id="alert-evidence-panel" style={{ margin: 0, color: '#f0f3fa' }}>
              Truy nguyên một cảnh báo
            </h4>
            {pickedAlert && onSimulateAtAlert && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onSimulateAtAlert(pickedAlert.symbol, pickedAlert.ts_ms)}
              >
                <CandlestickChart size={14} />
                Mô phỏng chi phí lệnh lúc xảy ra cảnh báo →
              </button>
            )}
          </div>
          <div style={{ marginBottom: 12 }}>
            <label className="field-label" htmlFor="alert-pick-select">
              Chọn cảnh báo để soi bằng chứng
            </label>
            <select
              id="alert-pick-select"
              className="select-input"
              value={Math.min(pickIdx, Math.max(sortedForPick.length - 1, 0))}
              onChange={(e) => setPickIdx(Number(e.target.value))}
            >
              {sortedForPick.map((r, i) => (
                <option key={i} value={i}>
                  {`${i + 1} · ${r.session_date} ${fmtVnHms(r.ts)} · ${r.symbol} · ${fmtAlertType(r.type)}`}
                </option>
              ))}
            </select>
          </div>

          {pickedAlert && (
            <>
              <div className="metric-grid">
                <div className="metric-card">
                  <div className="m-label">Mức ưu tiên</div>
                  <div className="m-val">
                    {PRIO_LABEL[pickedAlert.priority || 'P3'] || 'P3'}
                  </div>
                </div>
                <div className="metric-card">
                  <div className="m-label">Giá trị quan sát</div>
                  <div className="m-val">{fmtAlertStat(pickedAlert.signed_value)}</div>
                </div>
                <div className="metric-card">
                  <div className="m-label">μ baseline ({fmtAlertScale(pickedAlert.scale)})</div>
                  <div className="m-val">{fmtAlertStat(pickedAlert.mu)}</div>
                </div>
                <div className="metric-card">
                  <div className="m-label">z-score</div>
                  <div className="m-val">{fmtNum(pickedAlert.z, 2)}</div>
                  <div className="m-delta">
                    σ = {fmtAlertStat(pickedAlert.sigma)} · mẫu nền = {pickedAlert.n_train}
                  </div>
                </div>
                <div className="metric-card">
                  <div className="m-label">Phân vị thực nghiệm</div>
                  <div className="m-val">{fmtNum(pickedAlert.pct, 3)}</div>
                </div>
              </div>

              <div className="small-caption">
                Cơ chế kích hoạt <strong>{fmtAlertType(pickedAlert.type)}</strong> (
                {fmtAlertTypeDesc(pickedAlert.type)}): thang đo{' '}
                <strong>{fmtAlertScale(pickedAlert.scale)}</strong>, chiều{' '}
                <strong>{fmtAlertDirection(pickedAlert.direction)}</strong>, khung giờ{' '}
                {pickedAlert.bucket} (15 phút), đối chiếu từ {pickedAlert.n_train} bản ghi của CÁC
                PHIÊN TRƯỚC. Giá trị này hiếm gặp so với chính mã này trong cùng khung giờ — không
                phải so với mã khác.
              </div>

              {contextData.length > 0 && (
                <PlotlyChart
                  data={contextData}
                  height={520}
                  title="Truy nguyên cảnh báo: chuyện gì đã xảy ra quanh thời điểm kích hoạt"
                  layout={{
                    xaxis: { title: 'Giờ (UTC+7)', anchor: 'y3' },
                    yaxis: { domain: [0.62, 1.0], title: 'Mid & giá khớp' },
                    yaxis2: { domain: [0.30, 0.56], title: 'Depth bid (VND)' },
                    yaxis3: { domain: [0.0, 0.24], title: 'KL khớp 5s' },
                    shapes: contextShapes,
                    annotations: contextAnnotations,
                    legend: { orientation: 'h', yanchor: 'top', y: -0.14, x: 0 },
                    margin: { l: 64, r: 22, t: 54, b: 64 },
                  }}
                  alt="Diễn biến giá, độ sâu và khối lượng quanh thời điểm cảnh báo."
                />
              )}
              {truthEvents.length > 0 && (
                <div className="small-caption">
                  Vùng nền cam = cửa sổ sự kiện ground-truth của bộ mô phỏng (chỉ có ở SYNTHETIC).
                </div>
              )}
            </>
          )}
        </>
      )}

      {alertPr.length > 0 && mode === 'SYNTHETIC' && (
        <div style={{ marginTop: 22 }}>
          <h4 style={{ margin: '8px 0', color: '#e8f0fc' }}>
            Cảnh báo có bắt đúng sự kiện thật (ground-truth) không?
          </h4>
          <PlotlyChart
            data={prBarData}
            height={350}
            title="Đối chiếu cảnh báo với sự kiện ground-truth (chỉ có ở chế độ SYNTHETIC)"
            layout={{
              barmode: 'group',
              xaxis: { automargin: true },
              yaxis: { range: [0, 115], title: '%' },
            }}
            alt="Precision và recall của cảnh báo so với sự kiện ground-truth synthetic."
          />
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="neo-table">
              <thead>
                <tr>
                  <th>Loại cảnh báo</th>
                  <th className="num">Số cảnh báo</th>
                  <th className="num">TP</th>
                  <th className="num">Precision</th>
                  <th className="num">Số sự kiện</th>
                  <th className="num">Bắt được</th>
                  <th className="num">Recall</th>
                </tr>
              </thead>
              <tbody>
                {alertPr.map((r, i) => (
                  <tr key={i}>
                    <td title={fmtAlertTypeDesc(r.alert_type)}>{fmtAlertType(r.alert_type)}</td>
                    <td className="num">{r.n_alerts}</td>
                    <td className="num">{r.tp}</td>
                    <td className="num">{Number(r.precision).toFixed(2)}</td>
                    <td className="num">{r.n_events_mapped}</td>
                    <td className="num">{r.events_detected}</td>
                    <td className="num">{Number(r.recall).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="small-caption">
            Precision/recall đo trên sự kiện MÔ PHỎNG có chủ đích — kiểm chứng CƠ CHẾ, không phải
            bằng chứng hiệu quả ngoài đời thật. Dung sai khớp ±30s công bố trong docs.
          </div>
        </div>
      )}
    </div>
  );
};
