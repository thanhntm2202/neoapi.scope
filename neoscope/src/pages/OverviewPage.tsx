import React, { useEffect, useMemo, useState } from 'react';
import { Download, Maximize2, Minimize2 } from 'lucide-react';
import { PlotlyChart } from '../components/PlotlyChart';
import { AlertFeed, KpiGrid, SectionHeading, Sparkline } from '../components/ThemeParts';
import {
  C_ACCENT,
  C_BAD,
  C_GOOD,
  C_LARGE,
  C_THIN,
  downloadCsv,
  fmtAlertType,
  fmtAlertTypeDesc,
  fmtNum,
  fmtVnd,
  fmtVnHm,
  fmtVnHms,
  toVnIsoLocal,
} from '../lib/format';
import {
  filterTapeWindow,
  SortDir,
  sortWatchlist,
  TapeWindowId,
  WatchlistSortKey,
} from '../lib/tradingview';

interface OverviewPageProps {
  dataset: string;
  session: string;
  sessionData: any;
  sessionLoading?: boolean;
  symbols: string[];
  summary: any;
  provider: string;
  preferredTapeSym?: string | null;
  onConsumePreferredTapeSym?: () => void;
  onInspectAlert?: (alertRow: { session_date: string; symbol: string; ts_ms: number; type?: string }) => void;
  onJumpToPage?: (page: 'liquidity' | 'execution-cost', symbol: string) => void;
}

const TAPE_WINDOWS: { id: TapeWindowId; label: string }[] = [
  { id: 'ALL', label: 'Toàn phiên' },
  { id: 'AM', label: 'Sáng' },
  { id: 'PM', label: 'Chiều' },
  { id: '1H', label: '1H cuối' },
  { id: '30M', label: '30m cuối' },
];

function calcDelta(
  now: number | null,
  prev: number | null,
  digits: number,
  suffix: string,
  invert = false,
): { text: string; dir: 'up' | 'down' | 'flat' } {
  if (now === null || prev === null || !Number.isFinite(now) || !Number.isFinite(prev)) {
    return { text: '', dir: 'flat' };
  }
  const d = now - prev;
  if (Math.abs(d) <= 1e-12) return { text: '=', dir: 'flat' };
  const sign = d >= 0 ? '+' : '';
  const good = invert ? d < 0 : d > 0;
  return {
    text: `${sign}${d.toFixed(digits)}${suffix}`,
    dir: good ? 'up' : 'down',
  };
}

export const OverviewPage: React.FC<OverviewPageProps> = ({
  dataset,
  session,
  sessionData,
  sessionLoading = false,
  symbols,
  summary,
  provider,
  preferredTapeSym,
  onConsumePreferredTapeSym,
  onInspectAlert,
  onJumpToPage,
}) => {
  const availableSyms: string[] = sessionData?.availableTapeSymbols || [];
  const [tapeSym, setTapeSym] = useState<string>('');
  const [tapeRows, setTapeRows] = useState<any[]>([]);
  const [tapeLoading, setTapeLoading] = useState(false);
  const [trends, setTrends] = useState<any[]>([]);

  // TradingView chart micro-interactions
  const [tapeWindow, setTapeWindow] = useState<TapeWindowId>('ALL');
  const [showTrades, setShowTrades] = useState<boolean>(true);
  const [showAlertMarkers, setShowAlertMarkers] = useState<boolean>(true);
  const [showSpreadPane, setShowSpreadPane] = useState<boolean>(false);
  const [tapeExpanded, setTapeExpanded] = useState<boolean>(false);
  const [hoveredVnIso, setHoveredVnIso] = useState<string | null>(null);

  // Sortable watchlist state
  const [sortKey, setSortKey] = useState<WatchlistSortKey>('symbol');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [csvSaved, setCsvSaved] = useState(false);

  useEffect(() => {
    if (preferredTapeSym && availableSyms.includes(preferredTapeSym)) {
      setTapeSym(preferredTapeSym);
      onConsumePreferredTapeSym?.();
      const el = document.getElementById('intraday-tape-section');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [preferredTapeSym, availableSyms, onConsumePreferredTapeSym]);

  useEffect(() => {
    if (availableSyms.length && (!tapeSym || !availableSyms.includes(tapeSym))) {
      setTapeSym(availableSyms[0]);
    }
  }, [availableSyms, tapeSym]);

  useEffect(() => {
    if (!tapeExpanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTapeExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tapeExpanded]);

  useEffect(() => {
    if (!session || !tapeSym) {
      setTapeRows([]);
      return;
    }
    let cancelled = false;
    setTapeLoading(true);
    setHoveredVnIso(null);
    const qs = dataset ? `?dataset=${encodeURIComponent(dataset)}` : '';
    fetch(`/api/tape/${encodeURIComponent(session)}/${encodeURIComponent(tapeSym)}${qs}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setTapeRows(d.rows || []);
      })
      .catch(() => {
        if (!cancelled) setTapeRows([]);
      })
      .finally(() => {
        if (!cancelled) setTapeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, tapeSym, dataset]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (dataset) params.set('dataset', dataset);
    params.set('symbols', symbols.join(','));
    fetch(`/api/trends?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setTrends(d.rows || []);
      })
      .catch(() => {
        if (!cancelled) setTrends([]);
      });
    return () => {
      cancelled = true;
    };
  }, [dataset, symbols]);

  const kpis = sessionData?.kpis || {};
  const dSpread = calcDelta(kpis.spreadNow, kpis.spreadPrev, 2, ' bps', true);
  const dDepth = calcDelta(kpis.depthNow, kpis.depthPrev, 2, ' tỷ', false);
  const dLhs = calcDelta(kpis.lhsNow, kpis.lhsPrev, 1, ' điểm', false);

  const alertItems = useMemo(() => {
    return (sessionData?.alertPulse || []).map((r: any) => ({
      priority: r.priority || 'P3',
      title: `${r.symbol} · ${fmtAlertType(r.type)}`,
      sub: `${fmtAlertTypeDesc(r.type)} · z = ${Number(r.z).toFixed(2)} · phân vị ${Number(r.pct).toFixed(3)}`,
      time: fmtVnHms(r.ts),
      raw: r,
    }));
  }, [sessionData]);

  // Breadth chart
  const breadthData = useMemo(() => {
    const idxRows = sessionData?.indices || [];
    if (!idxRows.length) return [];
    const xs = idxRows.map((r: any) => toVnIsoLocal(r.ts));
    return [
      {
        x: xs,
        y: idxRows.map((r: any) => r.advances),
        name: 'Số mã tăng',
        stackgroup: 'one',
        type: 'scatter',
        mode: 'lines',
        line: { width: 0.7, color: C_GOOD },
        fillcolor: 'rgba(38,166,154,0.28)',
        yaxis: 'y',
      },
      {
        x: xs,
        y: idxRows.map((r: any) => -(r.declines || 0)),
        name: 'Số mã giảm (âm)',
        stackgroup: 'two',
        type: 'scatter',
        mode: 'lines',
        line: { width: 0.7, color: C_BAD },
        fillcolor: 'rgba(239,83,80,0.28)',
        yaxis: 'y',
      },
      {
        x: xs,
        y: idxRows.map((r: any) => r.index_value),
        name: 'VNINDEX',
        type: 'scatter',
        mode: 'lines',
        line: { color: C_ACCENT, width: 2 },
        yaxis: 'y2',
      },
    ];
  }, [sessionData]);

  // LHS ranking at latest bar
  const { rankData, latestBarTime } = useMemo(() => {
    const bars = (sessionData?.barsLhs || []).filter(
      (b: any) => b.lhs !== null && Number.isFinite(b.lhs),
    );
    const wlSet = new Set((sessionData?.watchlist || []).map((w: any) => w.symbol));
    const filtered = bars.filter((b: any) => wlSet.has(b.symbol));
    if (!filtered.length) return { rankData: [], latestBarTime: '' };
    let maxMs = -Infinity;
    let maxIso = '';
    for (const b of filtered) {
      if (b.bar_ts_ms > maxMs) {
        maxMs = b.bar_ts_ms;
        maxIso = b.bar_ts;
      }
    }
    const atLatest = filtered
      .filter((b: any) => b.bar_ts_ms === maxMs)
      .sort((a: any, b: any) => a.lhs - b.lhs);

    return {
      latestBarTime: fmtVnHm(maxIso),
      rankData: [
        {
          type: 'bar',
          orientation: 'h',
          x: atLatest.map((d: any) => d.lhs),
          y: atLatest.map((d: any) => d.symbol),
          marker: {
            color: atLatest.map((d: any) => (d.group === 'thin' ? C_THIN : C_LARGE)),
          },
          text: atLatest.map((d: any) => Number(d.lhs).toFixed(1)),
          textposition: 'outside',
          hovertemplate: '%{y}: LHS %{x:.1f}/100<extra></extra>',
        },
      ],
    };
  }, [sessionData]);

  // Filtered Intraday Liquidity Tape
  const filteredTapeRows = useMemo(
    () => filterTapeWindow(tapeRows, tapeWindow),
    [tapeRows, tapeWindow],
  );

  // Map local VN ISO strings -> row for instant O(1) TradingView HUD lookup on crosshair hover
  const tapeByVnIso = useMemo(() => {
    const map = new Map<string, any>();
    for (const r of filteredTapeRows) {
      map.set(toVnIsoLocal(r.ts), r);
    }
    return map;
  }, [filteredTapeRows]);

  const activeHudRow = useMemo(() => {
    if (hoveredVnIso) {
      const exact = tapeByVnIso.get(hoveredVnIso);
      if (exact) return exact;
      const prefix = hoveredVnIso.slice(0, 19);
      const found = tapeByVnIso.get(prefix);
      if (found) return found;
    }
    for (let i = filteredTapeRows.length - 1; i >= 0; i--) {
      const r = filteredTapeRows[i];
      if (r.mid != null && r.depth_bid_vnd != null && r.depth_ask_vnd != null) {
        return r;
      }
    }
    return filteredTapeRows.length ? filteredTapeRows[filteredTapeRows.length - 1] : null;
  }, [hoveredVnIso, tapeByVnIso, filteredTapeRows]);

  // Match session alerts for the active symbol & visible tape window onto the Mid price line
  const alertMarkers = useMemo(() => {
    const dayAlerts: any[] = sessionData?.dayAlerts || sessionData?.alertPulse || [];
    if (!tapeSym || !dayAlerts.length || !filteredTapeRows.length) return [];

    const validMidRows = filteredTapeRows.filter(
      (r) => r.mid !== null && Number.isFinite(r.mid),
    );
    if (!validMidRows.length) return [];

    const firstMs = filteredTapeRows[0].ts_ms ?? Date.parse(filteredTapeRows[0].ts);
    const lastMs =
      filteredTapeRows[filteredTapeRows.length - 1].ts_ms ??
      Date.parse(filteredTapeRows[filteredTapeRows.length - 1].ts);

    const priorityColor = (p: string | undefined) => {
      if (p === 'P1') return C_BAD;
      if (p === 'P2') return C_THIN;
      return C_LARGE;
    };

    const symAlerts = dayAlerts
      .filter(
        (a) =>
          a.symbol === tapeSym &&
          Number.isFinite(a.ts_ms) &&
          a.ts_ms >= firstMs - 60_000 &&
          a.ts_ms <= lastMs + 60_000,
      )
      .sort((a, b) => a.ts_ms - b.ts_ms);

    return symAlerts.map((a) => {
      let bestRow = validMidRows[0];
      let bestDiff = Math.abs((bestRow.ts_ms ?? Date.parse(bestRow.ts)) - a.ts_ms);
      for (let i = 1; i < validMidRows.length; i++) {
        const r = validMidRows[i];
        const diff = Math.abs((r.ts_ms ?? Date.parse(r.ts)) - a.ts_ms);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestRow = r;
        }
      }
      return {
        x: toVnIsoLocal(bestRow.ts),
        y: bestRow.mid,
        color: priorityColor(a.priority),
        alert: a,
      };
    });
  }, [sessionData, tapeSym, filteredTapeRows]);

  // Intraday Liquidity Tape traces (split area traces at lunch break >10m so fills never bridge across 11:30–13:00)
  const tapeData = useMemo(() => {
    if (!filteredTapeRows.length) return [];
    const xs: (string | null)[] = [];
    const mids: (number | null)[] = [];
    const segments: any[][] = [[]];
    for (let i = 0; i < filteredTapeRows.length; i++) {
      const r = filteredTapeRows[i];
      if (i > 0) {
        const prevMs = filteredTapeRows[i - 1].ts_ms ?? Date.parse(filteredTapeRows[i - 1].ts);
        const curMs = r.ts_ms ?? Date.parse(r.ts);
        if (Number.isFinite(prevMs) && Number.isFinite(curMs) && curMs - prevMs > 600_000) {
          xs.push(toVnIsoLocal(new Date(prevMs + 1000).toISOString()));
          mids.push(null);
          segments.push([]);
        }
      }
      xs.push(toVnIsoLocal(r.ts));
      mids.push(r.mid ?? null);
      segments[segments.length - 1].push(r);
    }
    const depthYAxis = showSpreadPane ? 'y3' : 'y2';
    const traces: any[] = [
      {
        x: xs,
        y: mids,
        name: 'Mid',
        type: 'scatter',
        mode: 'lines',
        connectgaps: false,
        line: { color: C_ACCENT, width: 1.8 },
        xaxis: 'x',
        yaxis: 'y',
      },
    ];
    if (showTrades) {
      const lpRows = filteredTapeRows.filter(
        (r) => r.last_price !== null && Number.isFinite(r.last_price),
      );
      traces.push({
        x: lpRows.map((r) => toVnIsoLocal(r.ts)),
        y: lpRows.map((r) => r.last_price),
        name: 'Giá khớp',
        type: 'scatter',
        mode: 'markers',
        marker: { size: 3.5, color: '#d1d4dc', opacity: 0.72 },
        xaxis: 'x',
        yaxis: 'y',
      });
    }
    if (showAlertMarkers && alertMarkers.length > 0) {
      traces.push({
        x: alertMarkers.map((m) => m.x),
        y: alertMarkers.map((m) => m.y),
        customdata: alertMarkers.map((m) => m.alert),
        text: alertMarkers.map(
          (m) =>
            `${m.alert.priority || 'P3'} · ${fmtAlertType(m.alert.type)} (z=${Number(m.alert.z).toFixed(2)})`,
        ),
        name: `Cảnh báo (${alertMarkers.length})`,
        type: 'scatter',
        mode: 'markers',
        marker: {
          size: 10,
          symbol: 'diamond',
          color: alertMarkers.map((m) => m.color),
          line: { color: '#131722', width: 1.4 },
        },
        hovertemplate: '%{text}<br>%{x}<br><i>Nhấp để xem ở tab Cảnh báo</i><extra></extra>',
        xaxis: 'x',
        yaxis: 'y',
      });
    }
    if (showSpreadPane) {
      segments.forEach((seg, segIdx) => {
        if (!seg.length) return;
        traces.push({
          x: seg.map((r) => toVnIsoLocal(r.ts)),
          y: seg.map((r) => r.spread_bps ?? null),
          name: 'Spread (bps)',
          legendgroup: 'spread',
          showlegend: segIdx === 0,
          type: 'scatter',
          mode: 'lines',
          connectgaps: false,
          line: { color: C_THIN, width: 1.4 },
          fillcolor: 'rgba(245, 158, 11, 0.14)',
          fill: 'tozeroy',
          xaxis: 'x',
          yaxis: 'y2',
        });
      });
    }
    segments.forEach((seg, segIdx) => {
      if (!seg.length) return;
      const segX = seg.map((r) => toVnIsoLocal(r.ts));
      traces.push(
        {
          x: segX,
          y: seg.map((r) => r.depth_bid_vnd ?? null),
          name: 'Depth bid',
          legendgroup: 'depth-bid',
          showlegend: segIdx === 0,
          type: 'scatter',
          mode: 'lines',
          connectgaps: false,
          line: { color: C_GOOD, width: 1.3 },
          fillcolor: 'rgba(38,166,154,0.18)',
          fill: 'tozeroy',
          xaxis: 'x',
          yaxis: depthYAxis,
        },
        {
          x: segX,
          y: seg.map((r) => r.depth_ask_vnd ?? null),
          name: 'Depth ask',
          legendgroup: 'depth-ask',
          showlegend: segIdx === 0,
          type: 'scatter',
          mode: 'lines',
          connectgaps: false,
          line: { color: C_BAD, width: 1.3 },
          fillcolor: 'rgba(239,83,80,0.15)',
          fill: 'tozeroy',
          xaxis: 'x',
          yaxis: depthYAxis,
        },
      );
    });
    return traces;
  }, [filteredTapeRows, showTrades, showAlertMarkers, showSpreadPane, alertMarkers]);

  // Multi-session trends chart
  const trendData = useMemo(() => {
    if (trends.length < 2) return [];
    const xs = trends.map((r) => r.session.slice(5));
    return [
      {
        x: xs,
        y: trends.map((r) => r.spreadMed),
        name: 'Spread trung vị (bps)',
        type: 'scatter',
        mode: 'lines+markers',
        line: { color: C_ACCENT, width: 2 },
        marker: { size: 6 },
        yaxis: 'y',
      },
      {
        x: xs,
        y: trends.map((r) => r.depthMed),
        name: 'Độ sâu TB (tỷ đ)',
        type: 'scatter',
        mode: 'lines+markers',
        line: { color: C_LARGE, width: 2 },
        marker: { size: 6 },
        yaxis: 'y2',
      },
      {
        x: xs,
        y: trends.map((r) => r.lhsMed),
        name: 'LHS trung vị',
        type: 'scatter',
        mode: 'lines+markers',
        line: { color: C_GOOD, width: 2, dash: 'dot' },
        marker: { size: 6 },
        yaxis: 'y3',
      },
    ];
  }, [trends]);

  const rawWatchlist = sessionData?.watchlist || [];
  const sortedWatchlist = useMemo(
    () => sortWatchlist(rawWatchlist, sortKey, sortDir),
    [rawWatchlist, sortKey, sortDir],
  );

  const toggleSort = (key: WatchlistSortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'symbol' || key === 'groupLabel' ? 'asc' : 'desc');
    }
  };

  const renderSortIcon = (key: WatchlistSortKey) => {
    if (sortKey !== key) return null;
    return <span className="sort-arrow">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const handleWatchlistKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!sortedWatchlist.length) return;
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    e.preventDefault();
    const curIdx = sortedWatchlist.findIndex((r: any) => r.symbol === tapeSym);
    const nextIdx =
      e.key === 'ArrowDown'
        ? (curIdx + 1) % sortedWatchlist.length
        : (curIdx - 1 + sortedWatchlist.length) % sortedWatchlist.length;
    setTapeSym(sortedWatchlist[nextIdx].symbol);
  };

  const ds = summary?.dataset || {};
  const q = summary?.quality || {};

  const sourceLabel =
    provider === 'NEO'
      ? 'NEO marketInfo'
      : provider === 'SSI'
        ? 'SSI indexsummary'
        : 'bộ sinh dữ liệu mô phỏng';

  const selectTapeSymbol = (sym: string, scroll = true) => {
    setTapeSym(sym);
    if (scroll) {
      const el = document.getElementById('intraday-tape-section');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  if (!session) {
    return (
      <div>
        <h2 className="page-subheader">Tổng quan thị trường</h2>
        <div className="callout info">
          Chưa có phiên curated nào trong chế độ dữ liệu <strong>{dataset}</strong>. Sau khi
          chạy pipeline <code>neoscope ingest</code> và <code>neoscope analyze</code>, nhấn
          &ldquo;Làm mới dữ liệu&rdquo; ở thanh bên trái.
        </div>
      </div>
    );
  }

  return (
    <div className={sessionLoading ? 'is-loading-panel' : undefined}>
      <h2 className="page-subheader">Tổng quan thị trường</h2>
      <p className="page-caption">
        Bảng điều khiển nghiên cứu cho nhà đầu tư, môi giới và chuyên viên phân tích. Bắt đầu bằng
        trạng thái thanh khoản của phiên, sau đó mở chi tiết hoặc thử một lệnh giả định.
      </p>

      <KpiGrid
        cards={[
          {
            label: 'Mã trong lát cắt',
            value: `${(kpis.symbolCount ?? 0).toLocaleString('en-US')}`,
            sub: 'có snapshot trong phiên',
            color: C_LARGE,
          },
          {
            label: 'Spread trung vị',
            value:
              kpis.spreadNow !== null && Number.isFinite(kpis.spreadNow)
                ? `${Number(kpis.spreadNow).toFixed(2)} bps`
                : '—',
            sub: 'chi phí tức thời · thấp hơn = tốt hơn',
            color: C_ACCENT,
            delta: dSpread.text,
            delta_dir: dSpread.dir,
          },
          {
            label: 'Độ sâu hiển thị',
            value:
              kpis.depthNow !== null && Number.isFinite(kpis.depthNow)
                ? `${Number(kpis.depthNow).toFixed(2)} tỷ đ`
                : '—',
            sub: 'depth bid/ask 3 mức · giá trị hợp lệ cuối phiên',
            color: C_LARGE,
            delta: dDepth.text,
            delta_dir: dDepth.dir,
          },
          {
            label: 'LHS trung vị',
            value:
              kpis.lhsNow !== null && Number.isFinite(kpis.lhsNow)
                ? `${Number(kpis.lhsNow).toFixed(1)}/100`
                : '—',
            sub: 'sức khỏe thanh khoản tổng hợp',
            color: C_GOOD,
            delta: dLhs.text,
            delta_dir: dLhs.dir,
          },
          {
            label: 'Cảnh báo · P1/P2',
            value: `${kpis.rareCount ?? 0} / ${kpis.alertCount ?? 0}`,
            sub: 'hiếm / tổng số cảnh báo phiên',
            color: kpis.rareCount ? C_THIN : '#787b86',
          },
        ]}
      />

      {sessionData?.narrative && (
        <section className="narrative-card" aria-label="Tóm tắt vi cấu trúc phiên">
          <div className="narrative-head">
            <span className="narrative-badge">Nhận định phiên tất định</span>
            <h3 className="narrative-title">{sessionData.narrative.headline}</h3>
          </div>
          <ul className="narrative-list">
            {(sessionData.narrative.bullets || []).map((b: string, i: number) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
          <div className="narrative-caveat">{sessionData.narrative.caveat}</div>
        </section>
      )}

      {alertItems.length > 0 && (
        <>
          <SectionHeading
            title="Alert Pulse · cảnh báo mới nhất trong phiên"
            note="Nhấp vào một cảnh báo để nhảy thẳng tới trang Cảnh báo với bằng chứng đã chọn sẵn."
          />
          <AlertFeed
            items={alertItems}
            onItemClick={
              onInspectAlert
                ? (item) => {
                    if (item.raw) onInspectAlert(item.raw);
                  }
                : undefined
            }
          />
        </>
      )}

      <div className="grid-2-weighted" style={{ marginTop: 14 }}>
        <div className="card-panel" style={{ margin: 0 }}>
          <SectionHeading title="Độ rộng thị trường" />
          {breadthData.length > 0 ? (
            <>
              <PlotlyChart
                data={breadthData}
                height={330}
                crosshair
                layout={{
                  xaxis: { title: 'Giờ (UTC+7)' },
                  yaxis: { title: 'Số mã (watchlist quy mô hóa)' },
                  yaxis2: {
                    title: 'Điểm chỉ số',
                    overlaying: 'y',
                    side: 'right',
                    gridcolor: 'rgba(0,0,0,0)',
                  },
                }}
                alt="Độ rộng thị trường: số mã tăng, giảm và đứng giá trong phiên đã chọn."
              />
              <div className="small-caption" style={{ marginBottom: 0 }}>
                Nguồn: {sourceLabel} · trạng thái chỉ số của phiên đang xem.
              </div>
            </>
          ) : (
            <div className="callout info">Nguồn hiện tại không có dữ liệu độ rộng cho phiên này.</div>
          )}
        </div>

        <div className="card-panel" style={{ margin: 0 }}>
          <SectionHeading title="Xếp hạng thanh khoản" />
          {rankData.length > 0 ? (
            <>
              <PlotlyChart
                data={rankData}
                height={330}
                layout={{
                  xaxis: { range: [0, 108], title: 'Liquidity Health Score (0–100)' },
                  margin: { l: 54, r: 24, t: 24, b: 42 },
                }}
                alt="Xếp hạng LHS của các mã được chọn tại thời điểm có dữ liệu mới nhất."
              />
              <div className="small-caption" style={{ marginBottom: 0 }}>
                Cắt ngang lúc {latestBarTime} UTC+7 · điểm tương đối.
              </div>
            </>
          ) : (
            <div className="callout info">
              Chưa đủ dữ liệu liên tục để tính LHS; cần ít nhất năm bar.
            </div>
          )}
        </div>
      </div>

      {availableSyms.length > 0 && (
        <div
          id="intraday-tape-section"
          className={`tv-chart-frame ${tapeExpanded ? 'expanded' : ''}`}
          aria-label={`Biểu đồ TradingView băng thanh khoản ${tapeSym}`}
        >
          <div className="tv-toolbar">
            <div className="tv-symbol-badge">
              <label htmlFor="tape-sym-select" className="field-label" style={{ margin: 0 }}>
                Băng nội phiên
              </label>
              <select
                id="tape-sym-select"
                className="tv-select-compact"
                value={tapeSym}
                onChange={(e) => setTapeSym(e.target.value)}
              >
                {availableSyms.map((sym) => (
                  <option key={sym} value={sym}>
                    {sym}
                  </option>
                ))}
              </select>
            </div>

            <div className="tv-seg-group" role="group" aria-label="Khung thời gian trong phiên">
              {TAPE_WINDOWS.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  className={`tv-seg-btn ${tapeWindow === w.id ? 'active' : ''}`}
                  aria-pressed={tapeWindow === w.id}
                  onClick={() => setTapeWindow(w.id)}
                >
                  {w.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              className={`tv-tool-btn ${showTrades ? 'active' : ''}`}
              onClick={() => setShowTrades((v) => !v)}
              aria-pressed={showTrades}
            >
              Khớp lệnh
            </button>

            <button
              type="button"
              className={`tv-tool-btn ${showAlertMarkers ? 'active' : ''}`}
              onClick={() => setShowAlertMarkers((v) => !v)}
              aria-pressed={showAlertMarkers}
            >
              Cảnh báo{alertMarkers.length > 0 ? ` (${alertMarkers.length})` : ''}
            </button>

            <button
              type="button"
              className={`tv-tool-btn ${showSpreadPane ? 'active' : ''}`}
              onClick={() => setShowSpreadPane((v) => !v)}
              aria-pressed={showSpreadPane}
            >
              Spread (bps)
            </button>

            {(tapeWindow !== 'ALL' || !showTrades || !showAlertMarkers || showSpreadPane) && (
              <button
                type="button"
                className="tv-tool-btn"
                onClick={() => {
                  setTapeWindow('ALL');
                  setShowTrades(true);
                  setShowAlertMarkers(true);
                  setShowSpreadPane(false);
                }}
                title="Đặt lại khung giờ và lớp hiển thị mặc định"
              >
                Đặt lại
              </button>
            )}

            <div className="tv-toolbar-right">
              {onJumpToPage && tapeSym && (
                <>
                  <button
                    type="button"
                    className="tv-tool-btn"
                    onClick={() => onJumpToPage('liquidity', tapeSym)}
                  >
                    LHS {tapeSym} →
                  </button>
                  <button
                    type="button"
                    className="tv-tool-btn"
                    onClick={() => onJumpToPage('execution-cost', tapeSym)}
                  >
                    Chi phí {tapeSym} →
                  </button>
                </>
              )}
              <button
                type="button"
                className="tv-tool-btn"
                onClick={() => setTapeExpanded((v) => !v)}
                aria-label={tapeExpanded ? 'Thu gọn biểu đồ' : 'Phóng to biểu đồ'}
                title={tapeExpanded ? 'Thu gọn (Esc)' : 'Phóng to'}
              >
                {tapeExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </button>
            </div>
          </div>

          <div className="tv-hud-overlay" aria-live="polite">
            <span className="tv-hud-sym">{tapeSym}</span>
            <span className="tv-hud-time">
              {activeHudRow ? `${fmtVnHms(activeHudRow.ts)} UTC+7` : '—'}
            </span>
            <span className="tv-hud-kv">
              Mid:{' '}
              <strong>
                {activeHudRow?.mid != null ? `${Math.round(activeHudRow.mid).toLocaleString('en-US')} đ` : '—'}
              </strong>
            </span>
            <span className="tv-hud-kv">
              Khớp:{' '}
              <strong>
                {activeHudRow?.last_price != null
                  ? `${Math.round(activeHudRow.last_price).toLocaleString('en-US')} đ`
                  : '—'}
              </strong>
            </span>
            <span className="tv-hud-kv">
              Depth Bid:{' '}
              <strong style={{ color: '#4dd0c1' }}>
                {activeHudRow?.depth_bid_vnd != null ? fmtVnd(activeHudRow.depth_bid_vnd) : '—'}
              </strong>
            </span>
            <span className="tv-hud-kv">
              Depth Ask:{' '}
              <strong style={{ color: '#ff7b78' }}>
                {activeHudRow?.depth_ask_vnd != null ? fmtVnd(activeHudRow.depth_ask_vnd) : '—'}
              </strong>
            </span>
            <span className="tv-hud-kv">
              Spread:{' '}
              <strong>
                {activeHudRow?.spread_bps != null ? `${fmtNum(activeHudRow.spread_bps, 2)} bps` : '—'}
              </strong>
            </span>
            <span className="tv-hud-kv">
              OBI:{' '}
              <strong
                style={{
                  color:
                    activeHudRow?.obi == null
                      ? '#d1d4dc'
                      : activeHudRow.obi >= 0
                        ? '#4dd0c1'
                        : '#ff7b78',
                }}
              >
                {activeHudRow?.obi != null ? fmtNum(activeHudRow.obi, 2) : '—'}
              </strong>
            </span>
          </div>

          <div className="tv-chart-canvas">
            {tapeLoading ? (
              <div className="small-caption" style={{ padding: 12 }}>
                Đang tải băng giao dịch nội phiên của {tapeSym}…
              </div>
            ) : tapeData.length > 0 ? (
              <PlotlyChart
                data={tapeData}
                height={tapeExpanded ? Math.max(480, window.innerHeight - 170) : showSpreadPane ? 480 : 420}
                crosshair
                onHoverX={setHoveredVnIso}
                onClickPoint={(pt) => {
                  if (pt.customdata?.session_date && pt.customdata?.symbol && onInspectAlert) {
                    onInspectAlert(pt.customdata);
                  }
                }}
                layout={
                  showSpreadPane
                    ? {
                        xaxis: { title: 'Giờ (UTC+7)', anchor: 'y3' },
                        yaxis: { side: 'right', domain: [0.56, 1.0], title: 'Mid & giá khớp (đ)' },
                        yaxis2: { side: 'right', domain: [0.29, 0.49], title: 'Spread (bps)' },
                        yaxis3: { side: 'right', domain: [0.0, 0.22], title: 'Độ sâu (VND)' },
                        legend: { orientation: 'h', yanchor: 'top', y: 1.04, x: 0 },
                        margin: { l: 24, r: 72, t: 32, b: 42 },
                      }
                    : {
                        xaxis: { title: 'Giờ (UTC+7)', anchor: 'y2' },
                        yaxis: { side: 'right', domain: [0.42, 1.0], title: 'Mid & giá khớp (đ)' },
                        yaxis2: { side: 'right', domain: [0.0, 0.34], title: 'Độ sâu (VND)' },
                        legend: { orientation: 'h', yanchor: 'top', y: 1.04, x: 0 },
                        margin: { l: 24, r: 72, t: 32, b: 42 },
                      }
                }
                alt={`Băng giao dịch nội phiên của ${tapeSym}: mid, giá khớp, cảnh báo và độ sâu hai phía.`}
              />
            ) : (
              <div className="callout info" style={{ margin: 12 }}>
                Không có tick khớp khung giờ đã chọn ({tapeWindow}). Thử chọn &ldquo;Toàn phiên&rdquo;.
              </div>
            )}
          </div>
        </div>
      )}

      <SectionHeading
        title="Watchlist · snapshot gần nhất theo mã"
        note="Nhấp tiêu đề cột để sắp xếp, nhấp dòng hoặc dùng phím ↑ / ↓ để chuyển mã trên biểu đồ."
      />
      {sortedWatchlist.length === 0 ? (
        <div className="callout info">
          Không có snapshot phù hợp bộ lọc. Chọn mã khác hoặc kiểm tra lại nguồn dữ liệu.
        </div>
      ) : (
        <div className="card-panel" tabIndex={0} onKeyDown={handleWatchlistKeyDown}>
          <div className="table-wrap">
            <table className="neo-table">
              <thead>
                <tr>
                  <th>
                    <button
                      type="button"
                      className={`sort-th-btn ${sortKey === 'symbol' ? 'active' : ''}`}
                      onClick={() => toggleSort('symbol')}
                    >
                      Mã {renderSortIcon('symbol')}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className={`sort-th-btn ${sortKey === 'groupLabel' ? 'active' : ''}`}
                      onClick={() => toggleSort('groupLabel')}
                    >
                      Nhóm {renderSortIcon('groupLabel')}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className={`sort-th-btn ${sortKey === 'lhs' ? 'active' : ''}`}
                      onClick={() => toggleSort('lhs')}
                    >
                      LHS trong phiên {renderSortIcon('lhs')}
                    </button>
                  </th>
                  <th className="num">
                    <button
                      type="button"
                      className={`sort-th-btn num-align ${sortKey === 'midLast' ? 'active' : ''}`}
                      onClick={() => toggleSort('midLast')}
                    >
                      {renderSortIcon('midLast')} Mid cuối (đ)
                    </button>
                  </th>
                  <th className="num">
                    <button
                      type="button"
                      className={`sort-th-btn num-align ${sortKey === 'spreadBps' ? 'active' : ''}`}
                      onClick={() => toggleSort('spreadBps')}
                    >
                      {renderSortIcon('spreadBps')} Spread (bps)
                    </button>
                  </th>
                  <th className="num">
                    <button
                      type="button"
                      className={`sort-th-btn num-align ${sortKey === 'volatilityBps' ? 'active' : ''}`}
                      onClick={() => toggleSort('volatilityBps')}
                    >
                      {renderSortIcon('volatilityBps')} σ 1m (bps)
                    </button>
                  </th>
                  <th className="num">
                    <button
                      type="button"
                      className={`sort-th-btn num-align ${sortKey === 'depthBidB' ? 'active' : ''}`}
                      onClick={() => toggleSort('depthBidB')}
                    >
                      {renderSortIcon('depthBidB')} Depth bid (tỷ đ)
                    </button>
                  </th>
                  <th className="num">
                    <button
                      type="button"
                      className={`sort-th-btn num-align ${sortKey === 'obi' ? 'active' : ''}`}
                      onClick={() => toggleSort('obi')}
                    >
                      {renderSortIcon('obi')} OBI
                    </button>
                  </th>
                  <th className="num">
                    <button
                      type="button"
                      className={`sort-th-btn num-align ${sortKey === 'cumVolM' ? 'active' : ''}`}
                      onClick={() => toggleSort('cumVolM')}
                    >
                      {renderSortIcon('cumVolM')} KL phiên (triệu cp)
                    </button>
                  </th>
                  <th>Thao tác nhanh</th>
                </tr>
              </thead>
              <tbody>
                {sortedWatchlist.map((row: any) => {
                  const isActiveTape = row.symbol === tapeSym;
                  const alertTotal = Number(row.alertCount ?? 0);
                  const rareTotal = Number(row.rareAlertCount ?? 0);
                  return (
                    <tr
                      key={row.symbol}
                      className={`clickable-row ${isActiveTape ? 'active-tape-row' : ''}`}
                      onClick={() => selectTapeSymbol(row.symbol, false)}
                    >
                      <td className="mono" style={{ fontWeight: 700, color: '#f0f3fa' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {row.symbol}
                          {alertTotal > 0 && (
                            <span
                              className={`wl-alert-badge ${rareTotal > 0 ? 'rare' : ''}`}
                              title={`${alertTotal} cảnh báo trong phiên (${rareTotal} P1/P2)`}
                            >
                              {rareTotal > 0 ? `${rareTotal} P1/P2` : `${alertTotal} CB`}
                            </span>
                          )}
                        </span>
                      </td>
                      <td>{row.groupLabel}</td>
                      <td>
                        <Sparkline
                          values={row.lhsSeries}
                          color={row.group === 'thin' ? C_THIN : C_LARGE}
                        />
                      </td>
                      <td className="num">
                        {row.midLast !== null ? Math.round(row.midLast).toLocaleString('en-US') : '—'}
                      </td>
                      <td className="num">{fmtNum(row.spreadBps, 1)}</td>
                      <td className="num">{fmtNum(row.volatilityBps, 1)}</td>
                      <td className="num">{fmtNum(row.depthBidB, 2)}</td>
                      <td className="num">{fmtNum(row.obi, 2)}</td>
                      <td className="num">{fmtNum(row.cumVolM, 2)}</td>
                      <td>
                        <div className="quick-actions-cell">
                          <button
                            type="button"
                            className="quick-action-btn"
                            aria-label={`Soi băng nội phiên ${row.symbol}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              selectTapeSymbol(row.symbol, true);
                            }}
                          >
                            Băng
                          </button>
                          {onJumpToPage && (
                            <>
                              <button
                                type="button"
                                className="quick-action-btn"
                                aria-label={`Xem LHS của ${row.symbol}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onJumpToPage('liquidity', row.symbol);
                                }}
                              >
                                LHS
                              </button>
                              <button
                                type="button"
                                className="quick-action-btn"
                                aria-label={`Mô phỏng chi phí ${row.symbol}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onJumpToPage('execution-cost', row.symbol);
                                }}
                              >
                                Chi phí
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            <button
              type="button"
              className="btn"
              onClick={() => {
                downloadCsv(
                  `neoscope_watchlist_${session}.csv`,
                  [
                    'Mã',
                    'Nhóm',
                    'Mid cuối (đ)',
                    'Spread (bps)',
                    'σ 1m (bps)',
                    'Depth bid (tỷ đ)',
                    'OBI',
                    'KL phiên (triệu cp)',
                    'Cảnh báo',
                  ],
                  sortedWatchlist.map((r: any) => [
                    r.symbol,
                    r.groupLabel,
                    r.midLast !== null ? Math.round(r.midLast) : '',
                    r.spreadBps !== null ? r.spreadBps.toFixed(1) : '',
                    r.volatilityBps != null ? Number(r.volatilityBps).toFixed(1) : '',
                    r.depthBidB !== null ? r.depthBidB.toFixed(2) : '',
                    r.obi !== null ? r.obi.toFixed(2) : '',
                    r.cumVolM !== null ? r.cumVolM.toFixed(2) : '',
                    r.alertCount ?? 0,
                  ]),
                );
                setCsvSaved(true);
                window.setTimeout(() => setCsvSaved(false), 1800);
              }}
            >
              <Download size={14} /> Tải watchlist (CSV)
            </button>
            {csvSaved && (
              <span className="inline-feedback-text" role="status">
                Đã xuất neoscope_watchlist_{session}.csv
              </span>
            )}
          </div>
        </div>
      )}

      {trendData.length > 0 && (
        <details className="expander" open style={{ marginTop: 14 }}>
          <summary>Diễn biến thanh khoản liên phiên ({trends.length} phiên)</summary>
          <div className="expander-body">
            <PlotlyChart
              data={trendData}
              height={360}
              crosshair
              title="Xu hướng Spread, Độ sâu và LHS trung vị qua các phiên"
              layout={{
                xaxis: { type: 'category', title: 'Phiên (MM-DD)', anchor: 'y3' },
                yaxis: { domain: [0.68, 1.0], title: 'Spread (bps)' },
                yaxis2: { domain: [0.34, 0.62], title: 'Độ sâu (tỷ đ)' },
                yaxis3: { domain: [0.0, 0.28], title: 'LHS (0–100)', range: [0, 100] },
                legend: { orientation: 'h', yanchor: 'top', y: -0.18, x: 0 },
                margin: { l: 64, r: 22, t: 48, b: 60 },
              }}
              alt="Diễn biến Spread trung vị, Độ sâu và LHS qua các phiên."
            />
          </div>
        </details>
      )}

      <details className="expander" style={{ marginTop: 14 }}>
        <summary>Phạm vi sử dụng &amp; độ bao phủ nghiên cứu</summary>
        <div className="expander-body">
          <div className="callout info">
            <span>
              NeoScope là <strong>công cụ phân tích học thuật</strong> — không phải khuyến nghị
              mua/bán, không đặt lệnh thật, không dự báo giá dài hạn.
            </span>
          </div>
          <div className="metric-grid">
            <div className="metric-card">
              <div className="m-label">Phiên trong tập</div>
              <div className="m-val">{ds.n_sessions ?? '—'}</div>
            </div>
            <div className="metric-card">
              <div className="m-label">Mã trong tập</div>
              <div className="m-val">{ds.n_symbols ?? '—'}</div>
            </div>
            <div className="metric-card">
              <div className="m-label">Snapshot curated</div>
              <div className="m-val">{(ds.n_snapshots ?? 0).toLocaleString('en-US')}</div>
            </div>
            <div className="metric-card">
              <div className="m-label">Lệnh test OOS</div>
              <div className="m-val">{(summary?.orders?.n ?? 0).toLocaleString('en-US')}</div>
            </div>
            {q && q.n_raw_total ? (
              <>
                <div className="metric-card">
                  <div className="m-label">RAW được chuẩn hóa</div>
                  <div className="m-val">
                    {((q.n_curated_total / Math.max(q.n_raw_total, 1)) * 100).toFixed(1)}%
                  </div>
                </div>
                <div className="metric-card">
                  <div className="m-label">Bản ghi lặp đã loại</div>
                  <div className="m-val">{(q.n_duplicates_dropped ?? 0).toLocaleString('en-US')}</div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </details>
    </div>
  );
};
