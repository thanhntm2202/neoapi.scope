import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  BellRing,
  BookOpen,
  CandlestickChart,
  CheckSquare,
  Database,
  LayoutDashboard,
  Menu,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import {
  HeroBanner,
  NeoFooter,
  PillItem,
  PillRow,
  StatusStrip,
} from './components/ThemeParts';
import { fmtNum } from './lib/format';
import { filterSymbolsByQuery } from './lib/tradingview';
import { AlertsPage } from './pages/AlertsPage';
import { DataQualityPage } from './pages/DataQualityPage';
import { ExecutionPage } from './pages/ExecutionPage';
import { LiquidityPage } from './pages/LiquidityPage';
import { MethodologyPage } from './pages/MethodologyPage';
import { OverviewPage } from './pages/OverviewPage';
import { ValidationPage } from './pages/ValidationPage';

type PageId =
  | 'overview'
  | 'liquidity'
  | 'execution-cost'
  | 'alerts'
  | 'validation'
  | 'data-quality'
  | 'methodology';

const PAGE_ORDER: PageId[] = [
  'overview',
  'liquidity',
  'execution-cost',
  'alerts',
  'validation',
  'data-quality',
  'methodology',
];

const PAGE_TITLES: Record<PageId, string> = {
  overview: 'Tổng quan thị trường',
  liquidity: 'Thanh khoản · so sánh cấu phần LHS',
  'execution-cost': 'Mô phỏng chi phí thực thi',
  alerts: 'Cảnh báo bất thường',
  validation: 'Kiểm chứng ngoài mẫu',
  'data-quality': 'Dữ liệu & chất lượng',
  methodology: 'Phương pháp & giới hạn',
};

const NAV_ANALYSIS: { id: PageId; label: string; icon: React.ReactNode; kbd: string }[] = [
  { id: 'overview', label: 'Tổng quan', icon: <LayoutDashboard size={15} />, kbd: '1' },
  { id: 'liquidity', label: 'Thanh khoản', icon: <BarChart3 size={15} />, kbd: '2' },
  { id: 'execution-cost', label: 'Mô phỏng chi phí', icon: <CandlestickChart size={15} />, kbd: '3' },
  { id: 'alerts', label: 'Cảnh báo', icon: <BellRing size={15} />, kbd: '4' },
  { id: 'validation', label: 'Kiểm chứng', icon: <CheckSquare size={15} />, kbd: '5' },
];

const NAV_ADMIN: { id: PageId; label: string; icon: React.ReactNode; kbd: string }[] = [
  { id: 'data-quality', label: 'Dữ liệu & chất lượng', icon: <Database size={15} />, kbd: '6' },
  { id: 'methodology', label: 'Phương pháp & giới hạn', icon: <BookOpen size={15} />, kbd: '7' },
];

export function App() {
  const [page, setPage] = useState<PageId>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [dataset, setDataset] = useState<string>('');
  const [boot, setBoot] = useState<any>(null);
  const [bootErr, setBootErr] = useState<string>('');
  const [session, setSession] = useState<string>('');
  const [symbols, setSymbols] = useState<string[]>([]);
  const [sessionData, setSessionData] = useState<any>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [liveStatus, setLiveStatus] = useState<any>(null);

  const [focusedAlert, setFocusedAlert] = useState<{
    session_date: string;
    symbol: string;
    ts_ms: number;
    type?: string;
  } | null>(null);
  const [preferredSym, setPreferredSym] = useState<string | null>(null);
  const [preferredTapeSym, setPreferredTapeSym] = useState<string | null>(null);

  // TradingView Quick Symbol Palette (/ or Cmd/Ctrl+K)
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const paletteInputRef = useRef<HTMLInputElement | null>(null);

  const loadBootstrap = useCallback(async (dsOverride?: string) => {
    try {
      const targetDs = dsOverride !== undefined ? dsOverride : dataset;
      const qs = targetDs ? `?dataset=${encodeURIComponent(targetDs)}` : '';
      const r = await fetch(`/api/bootstrap${qs}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Không thể nạp dữ liệu NeoScope');
      setBoot(d);
      setBootErr('');
      setLiveStatus(d.liveStatus || null);
      const resolvedDs = d.settings?.dataset_mode || 'SYNTHETIC';
      if (!targetDs) setDataset(resolvedDs);
      const sessList: string[] = d.sessions || [];
      setSession((prev) =>
        sessList.length ? (prev && sessList.includes(prev) ? prev : sessList[sessList.length - 1]) : '',
      );
      const allSyms: string[] = d.allSymbols || [];
      const defaultWl: string[] = [
        ...(d.settings?.watchlist?.large || []),
        ...(d.settings?.watchlist?.thin || []),
      ].filter((x) => allSyms.includes(x));
      setSymbols((prev) =>
        prev.length ? prev.filter((x) => allSyms.includes(x)) : defaultWl.length ? defaultWl : allSyms,
      );
    } catch (e: any) {
      setBootErr(e.message || 'Lỗi kết nối máy chủ');
    }
  }, [dataset]);

  useEffect(() => {
    loadBootstrap();
  }, [loadBootstrap]);

  useEffect(() => {
    if (!session || !boot) {
      if (boot && !session) setSessionData(null);
      return;
    }
    let cancelled = false;
    setSessionLoading(true);
    const params = new URLSearchParams();
    if (dataset) params.set('dataset', dataset);
    if (symbols.length) params.set('symbols', symbols.join(','));
    const qs = params.toString() ? `?${params.toString()}` : '';
    fetch(`/api/session/${encodeURIComponent(session)}${qs}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setSessionData(d);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSessionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, symbols, boot, dataset]);

  // Global TradingView keyboard shortcuts: / or Cmd/Ctrl+K opens symbol jump; 1..7 switches tab
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (paletteOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setPaletteOpen(false);
        }
        return;
      }
      if (inInput) return;

      if (e.key === '/') {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      const num = Number(e.key);
      if (num >= 1 && num <= PAGE_ORDER.length && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setPage(PAGE_ORDER[num - 1]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [paletteOpen]);

  useEffect(() => {
    if (paletteOpen) {
      setPaletteQuery('');
      window.setTimeout(() => paletteInputRef.current?.focus(), 20);
    }
  }, [paletteOpen]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetch('/api/refresh', { method: 'POST' });
      await loadBootstrap(dataset);
    } finally {
      setRefreshing(false);
    }
  }, [dataset, loadBootstrap]);

  // Optional 5s auto-refresh for LIVE mode
  useEffect(() => {
    if (!autoRefresh || boot?.settings?.mode !== 'LIVE') return;
    const timer = window.setInterval(async () => {
      try {
        const qs = dataset ? `?dataset=${encodeURIComponent(dataset)}` : '';
        const res = await fetch(`/api/live-status${qs}`);
        if (res.ok) {
          const data = await res.json();
          setLiveStatus(data.liveStatus || null);
        }
      } catch {
        // ignore transient polling error
      }
      await handleRefresh();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, boot?.settings?.mode, dataset, handleRefresh]);

  const handleDatasetChange = async (newDs: string) => {
    setDataset(newDs);
    setSession('');
    setSessionData(null);
    await loadBootstrap(newDs);
  };

  const toggleSymbol = (sym: string) => {
    setSymbols((prev) =>
      prev.includes(sym) ? prev.filter((x) => x !== sym) : [...prev, sym],
    );
  };

  const ensureSymbolActive = (sym: string) => {
    setSymbols((prev) => (prev.includes(sym) ? prev : [...prev, sym]));
  };

  const settings = boot?.settings;
  const mode = settings?.mode || 'SYNTHETIC';
  const provider = settings?.provider || 'SYNTHETIC';
  const datasetMode = settings?.dataset_mode || dataset || 'SYNTHETIC';
  const chash = settings?.config_hash || '';
  const largeList: string[] = useMemo(() => settings?.watchlist?.large || [], [settings]);
  const thinList: string[] = useMemo(() => settings?.watchlist?.thin || [], [settings]);
  const largeSet = useMemo(() => new Set<string>(largeList), [largeList]);
  const allSymsList: string[] = useMemo(() => boot?.allSymbols || [], [boot]);

  const activePreset = useMemo(() => {
    if (!allSymsList.length) return 'custom';
    const selSet = new Set(symbols);
    if (allSymsList.every((s) => selSet.has(s))) return 'all';
    const lg = largeList.filter((s) => allSymsList.includes(s));
    const th = thinList.filter((s) => allSymsList.includes(s));
    if (lg.length && symbols.length === lg.length && lg.every((s) => selSet.has(s))) return 'large';
    if (th.length && symbols.length === th.length && th.every((s) => selSet.has(s))) return 'thin';
    return 'custom';
  }, [symbols, allSymsList, largeList, thinList]);

  const applyPreset = (preset: 'all' | 'large' | 'thin') => {
    if (preset === 'all') {
      setSymbols(allSymsList);
    } else if (preset === 'large') {
      setSymbols(largeList.filter((s) => allSymsList.includes(s)));
    } else {
      setSymbols(thinList.filter((s) => allSymsList.includes(s)));
    }
  };

  const paletteItems = useMemo(
    () => filterSymbolsByQuery(allSymsList, sessionData?.watchlist || [], paletteQuery),
    [allSymsList, sessionData?.watchlist, paletteQuery],
  );

  const pills: PillItem[] = useMemo(() => {
    const items: PillItem[] = [];
    if (mode === 'SYNTHETIC') {
      items.push({
        label: 'DỮ LIỆU MÔ PHỎNG · SYNTHETIC',
        color: 'amber',
        tip: 'Bộ sinh dữ liệu có seed; không phải thị trường thật',
        isLiveStream: false,
      });
    } else {
      const wsState = liveStatus?.state || 'offline';
      const msgCount = liveStatus?.messages;
      const wsColor: PillItem['color'] =
        wsState === 'connected' ? 'green' : wsState === 'reconnecting' ? 'amber' : 'gray';
      const msgSuffix = typeof msgCount === 'number' ? ` · ${msgCount.toLocaleString('en-US')} msg` : '';
      items.push({
        label: `WebSocket · ${wsState}${msgSuffix}`,
        color: wsColor,
        tip: 'Trạng thái luồng dữ liệu thời gian thực của recorder',
        isLiveStream: true,
      });
    }
    items.push({
      label: `Nguồn · ${provider}`,
      color: 'blue',
      tip: 'SSI FastConnect API v3 là nguồn cốt lõi; NEO là dự phòng',
    });
    items.push({
      label: `Phiên · ${session || '—'}`,
      color: 'gray',
      tip: 'Phiên giao dịch đang phân tích',
    });
    items.push({
      label: `Cập nhật · ${boot?.freshness || '—'}`,
      color: 'gray',
      tip: 'Thời điểm sự kiện gần nhất trong dữ liệu (UTC+7)',
    });
    return items;
  }, [mode, provider, session, boot?.freshness, liveStatus]);

  if (bootErr) {
    return (
      <div style={{ padding: 32, maxWidth: 720, margin: '40px auto' }}>
        <div className="callout error">Không đọc được dữ liệu curated: {bootErr}</div>
      </div>
    );
  }

  if (!boot) {
    return (
      <div
        style={{
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#787b86',
          gap: 10,
        }}
      >
        <Activity size={20} color="#2962ff" />
        <span>Đang nạp dữ liệu curated NeoScope…</span>
      </div>
    );
  }

  const availableDatasets: { id: string; label: string; sessions: number }[] =
    boot.availableDatasets || [];

  return (
    <div className="app-shell">
      <div className="mobile-topbar">
        <div className="sidebar-brand">
          <span className="brand-mark">N</span>
          NEOSCOPE
        </div>
        <button
          type="button"
          className="btn"
          aria-label="Mở hoặc đóng thanh điều hướng"
          onClick={() => setMobileMenuOpen((v) => !v)}
        >
          <Menu size={16} />
        </button>
      </div>

      <aside className={`sidebar ${mobileMenuOpen ? '' : 'collapsed-mobile'}`}>
        <div className="sidebar-brand-row">
          <div className="sidebar-brand">
            <span className="brand-mark">N</span>
            NEOSCOPE
          </div>
          <span className="tv-kbd" title="Phím tắt đổi trang 1–7">
            1-7
          </span>
        </div>

        <button
          type="button"
          className="tv-search-trigger"
          onClick={() => setPaletteOpen(true)}
          aria-label="Tìm nhanh mã cổ phiếu hoặc nhảy trang"
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <Search size={13} />
            Tìm mã nhanh…
          </span>
          <span className="tv-kbd">/</span>
        </button>

        <div>
          <div className="nav-group-label">Phân tích</div>
          <div className="nav-list">
            {NAV_ANALYSIS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${page === item.id ? 'active' : ''}`}
                onClick={() => {
                  setPage(item.id);
                  setMobileMenuOpen(false);
                }}
              >
                {item.icon}
                <span>{item.label}</span>
                <span className="nav-kbd">{item.kbd}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="nav-group-label">Quản trị nghiên cứu</div>
          <div className="nav-list">
            {NAV_ADMIN.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${page === item.id ? 'active' : ''}`}
                onClick={() => {
                  setPage(item.id);
                  setMobileMenuOpen(false);
                }}
              >
                {item.icon}
                <span>{item.label}</span>
                <span className="nav-kbd">{item.kbd}</span>
              </button>
            ))}
          </div>
        </div>

        <hr className="sidebar-divider" />

        <div className="sidebar-section">
          <div className="nav-group-label" style={{ margin: '0 0 2px 0' }}>
            Bộ lọc dữ liệu
          </div>

          {availableDatasets.length > 0 && (
            <div>
              <label className="field-label" htmlFor="dataset-select">
                Chế độ dữ liệu
              </label>
              <select
                id="dataset-select"
                className="select-input"
                value={datasetMode}
                onChange={(e) => handleDatasetChange(e.target.value)}
              >
                {availableDatasets.map((ds) => (
                  <option
                    key={ds.id}
                    value={ds.id}
                    disabled={ds.sessions === 0 && ds.id !== datasetMode}
                  >
                    {ds.label} ({ds.sessions} phiên)
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="field-label" htmlFor="session-select">
              Phiên giao dịch
            </label>
            <select
              id="session-select"
              className="select-input"
              value={session}
              onChange={(e) => setSession(e.target.value)}
              disabled={!(boot.sessions || []).length}
            >
              {(boot.sessions || []).length ? (
                (boot.sessions || []).map((s: string) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))
              ) : (
                <option value="">Chưa có phiên curated</option>
              )}
            </select>
          </div>

          <div>
            <label className="field-label">Mã theo dõi</label>
            <div className="preset-btn-row" role="group" aria-label="Bộ chọn nhanh nhóm mã">
              <button
                type="button"
                className={`preset-btn ${activePreset === 'all' ? 'active' : ''}`}
                onClick={() => applyPreset('all')}
              >
                Tất cả
              </button>
              <button
                type="button"
                className={`preset-btn ${activePreset === 'large' ? 'active' : ''}`}
                onClick={() => applyPreset('large')}
              >
                VN30 lớn
              </button>
              <button
                type="button"
                className={`preset-btn ${activePreset === 'thin' ? 'active' : ''}`}
                onClick={() => applyPreset('thin')}
              >
                Midcap mỏng
              </button>
            </div>
            <div className="symbol-chips">
              {allSymsList.map((sym: string) => {
                const isSelected = symbols.includes(sym);
                const grpClass = largeSet.has(sym) ? 'large' : 'thin';
                return (
                  <button
                    key={sym}
                    type="button"
                    className={`sym-chip ${isSelected ? `selected ${grpClass}` : ''}`}
                    onClick={() => toggleSymbol(sym)}
                  >
                    {sym}
                  </button>
                );
              })}
            </div>
          </div>

          <details className="expander">
            <summary>Trạng thái kết nối &amp; tái lập</summary>
            <div className="expander-body">
              <div className="small-caption" style={{ margin: '6px 0 0 0' }}>
                Múi giờ: Asia/Ho_Chi_Minh · config_hash: <code>{chash}</code>
              </div>
              {liveStatus && (
                <div className="live-status-card">
                  <div>
                    <strong>{liveStatus.provider || provider}</strong> · trạng thái:{' '}
                    <code>{liveStatus.state || '—'}</code>
                  </div>
                  <div>
                    Messages: <strong>{(liveStatus.messages ?? 0).toLocaleString('en-US')}</strong> ·
                    Queue: {liveStatus.queue_depth ?? 0} · Lỗi: {liveStatus.callback_errors ?? 0}
                  </div>
                </div>
              )}
              {mode === 'LIVE' && (
                <label className="auto-refresh-label">
                  <input
                    type="checkbox"
                    checked={autoRefresh}
                    onChange={(e) => setAutoRefresh(e.target.checked)}
                  />
                  <span>Tự làm mới mỗi 5s (LIVE)</span>
                </label>
              )}
            </div>
          </details>

          <button
            type="button"
            className="btn btn-full"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw size={14} />
            {refreshing ? 'Đang làm mới…' : 'Làm mới dữ liệu'}
          </button>
        </div>
      </aside>

      <main className="main-content">
        {page === 'overview' ? (
          <>
            <HeroBanner
              brand={`NEOSCOPE · NGUỒN ${provider} FASTCONNECT API v3`}
              title="Phòng phân tích thanh khoản & vi cấu trúc thị trường Việt Nam"
              subtitle="Công cụ nghiên cứu cho nhà đầu tư, môi giới và chuyên viên phân tích: đo sức khỏe thanh khoản (LHS), ước tính chi phí thực thi lệnh giả định theo Implementation Shortfall, và truy nguyên cảnh báo bất thường bằng ngưỡng thống kê. Dữ liệu SSI FastConnect API v3 — chỉ đọc, không đặt lệnh thật, không phải khuyến nghị đầu tư."
            />
            <PillRow items={pills} />
            {mode === 'SYNTHETIC' && (
              <div className="callout warning">
                <span>
                  <strong>DỮ LIỆU MÔ PHỎNG</strong> · Kết quả chỉ kiểm chứng cơ chế trên bộ sinh
                  synthetic, không đại diện cho thị trường thật. Seed và phiên bản generator có
                  trong manifest.
                </span>
              </div>
            )}
          </>
        ) : (
          <StatusStrip brand="NEOSCOPE" title={PAGE_TITLES[page]} pills={pills} />
        )}

        {sessionLoading && <div className="skeleton-bar" aria-label="Đang tải dữ liệu phiên" />}

        <div key={page} className="page-transition">
          {page === 'overview' && (
            <OverviewPage
              dataset={datasetMode}
              session={session}
              sessionData={sessionData}
              sessionLoading={sessionLoading}
              symbols={symbols}
              summary={boot.summary}
              provider={provider}
              preferredTapeSym={preferredTapeSym}
              onConsumePreferredTapeSym={() => setPreferredTapeSym(null)}
              onInspectAlert={(a) => {
                setFocusedAlert({
                  session_date: a.session_date,
                  symbol: a.symbol,
                  ts_ms: a.ts_ms,
                  type: a.type,
                });
                setPage('alerts');
              }}
              onJumpToPage={(targetPage, sym) => {
                ensureSymbolActive(sym);
                setPreferredSym(sym);
                setPage(targetPage);
              }}
            />
          )}
          {page === 'liquidity' && (
            <LiquidityPage
              sessionData={sessionData}
              symbols={symbols}
              results={boot.results}
              preferredSym={preferredSym}
              onConsumePreferredSym={() => setPreferredSym(null)}
            />
          )}
          {page === 'execution-cost' && (
            <ExecutionPage
              dataset={datasetMode}
              session={session}
              symbols={symbols}
              settings={settings}
              preferredSym={preferredSym}
              onConsumePreferredSym={() => setPreferredSym(null)}
            />
          )}
          {page === 'alerts' && (
            <AlertsPage
              dataset={datasetMode}
              session={session}
              symbols={symbols}
              results={boot.results}
              mode={mode}
              focusedAlert={focusedAlert}
              onConsumeFocusedAlert={() => setFocusedAlert(null)}
            />
          )}
          {page === 'validation' && (
            <ValidationPage summary={boot.summary} results={boot.results} />
          )}
          {page === 'data-quality' && (
            <DataQualityPage
              quality={boot.quality || []}
              qualityMeta={boot.quality_meta || []}
              flagDescriptions={boot.flag_descriptions || {}}
              manifests={boot.manifests || []}
              sessions={boot.sessions || []}
              provider={provider}
            />
          )}
          {page === 'methodology' && <MethodologyPage />}
        </div>

        <NeoFooter provider={provider} mode={mode} configHash={chash} />
      </main>

      {paletteOpen && (
        <div
          className="tv-palette-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Tìm mã và nhảy nhanh trong NeoScope"
          onClick={() => setPaletteOpen(false)}
        >
          <div className="tv-palette-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tv-palette-search-row">
              <Search size={16} color="#787b86" />
              <input
                ref={paletteInputRef}
                type="text"
                className="tv-palette-input"
                placeholder="Nhập mã (VD: FPT, SSI, DIG) hoặc tên nhóm…"
                value={paletteQuery}
                onChange={(e) => setPaletteQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && paletteItems.length) {
                    const top = paletteItems[0];
                    ensureSymbolActive(top.symbol);
                    setPreferredTapeSym(top.symbol);
                    setPage('overview');
                    setPaletteOpen(false);
                  }
                }}
              />
              <button
                type="button"
                className="tv-tool-btn"
                aria-label="Đóng hộp tìm mã"
                onClick={() => setPaletteOpen(false)}
              >
                <X size={13} /> Esc
              </button>
            </div>
            <div className="tv-palette-list">
              {paletteItems.length === 0 ? (
                <div className="small-caption" style={{ padding: 12 }}>
                  Không khớp mã nào với &ldquo;{paletteQuery}&rdquo;.
                </div>
              ) : (
                paletteItems.map((item) => (
                  <div key={item.symbol} className="tv-palette-row">
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="mono" style={{ fontWeight: 700, color: '#f0f3fa' }}>
                          {item.symbol}
                        </span>
                        <span style={{ fontSize: 11.5, color: '#787b86' }}>{item.groupLabel}</span>
                      </div>
                      <div className="mono" style={{ fontSize: 11.5, color: '#787b86', marginTop: 2 }}>
                        Mid:{' '}
                        {item.midLast !== null
                          ? `${Math.round(item.midLast).toLocaleString('en-US')} đ`
                          : '—'}{' '}
                        · Spread: {fmtNum(item.spreadBps, 1)} bps · LHS:{' '}
                        {item.lhsLast !== null ? item.lhsLast.toFixed(1) : '—'}
                      </div>
                    </div>
                    <div className="quick-actions-cell">
                      <button
                        type="button"
                        className="quick-action-btn"
                        onClick={() => {
                          ensureSymbolActive(item.symbol);
                          setPreferredTapeSym(item.symbol);
                          setPage('overview');
                          setPaletteOpen(false);
                        }}
                      >
                        Băng
                      </button>
                      <button
                        type="button"
                        className="quick-action-btn"
                        onClick={() => {
                          ensureSymbolActive(item.symbol);
                          setPreferredSym(item.symbol);
                          setPage('liquidity');
                          setPaletteOpen(false);
                        }}
                      >
                        LHS
                      </button>
                      <button
                        type="button"
                        className="quick-action-btn"
                        onClick={() => {
                          ensureSymbolActive(item.symbol);
                          setPreferredSym(item.symbol);
                          setPage('execution-cost');
                          setPaletteOpen(false);
                        }}
                      >
                        Chi phí
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
