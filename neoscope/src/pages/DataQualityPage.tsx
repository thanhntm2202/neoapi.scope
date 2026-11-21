import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Database, RefreshCw, ShieldCheck, Zap } from 'lucide-react';
import { PlotlyChart } from '../components/PlotlyChart';

interface DataQualityPageProps {
  dataset?: string;
  allSymbols?: string[];
  quality: any[];
  qualityMeta: any[];
  flagDescriptions: Record<string, string>;
  manifests: any[];
  sessions: string[];
  provider: string;
  providerStatus?: any;
  providerProbe?: any;
  neoProbe?: any;
  probeLoading?: boolean;
  onRunProviderProbe?: (target?: 'SSI' | 'NEO' | 'BOTH') => void;
  onChaosBanner?: (msg: string | null, severity?: 'warning' | 'info' | 'error') => void;
}

export const DataQualityPage: React.FC<DataQualityPageProps> = ({
  dataset = '',
  allSymbols = [],
  quality,
  qualityMeta,
  flagDescriptions,
  manifests,
  sessions,
  provider,
  providerStatus,
  providerProbe,
  neoProbe,
  probeLoading,
  onRunProviderProbe,
  onChaosBanner,
}) => {
  const symOptions = allSymbols.length ? allSymbols : ['FPT', 'VCB', 'HPG', 'SSI', 'DIG'];
  const [restSym, setRestSym] = useState<string>(symOptions[0] || 'FPT');
  const [restMarket, setRestMarket] = useState<'HOSE' | 'HNX' | 'UPCOM'>('HOSE');
  const [restResult, setRestResult] = useState<any>(null);
  const [restLoading, setRestLoading] = useState<boolean>(false);
  const [restErr, setRestErr] = useState<string>('');

  const [chaosResult, setChaosResult] = useState<any>(null);
  const [chaosLoading, setChaosLoading] = useState<boolean>(false);

  const [selfCheck, setSelfCheck] = useState<any>(null);
  const [selfCheckLoading, setSelfCheckLoading] = useState<boolean>(false);

  const fetchSelfCheck = useCallback(async () => {
    setSelfCheckLoading(true);
    try {
      const qs = dataset ? `?dataset=${encodeURIComponent(dataset)}` : '';
      const r = await fetch(`/api/system/self-check${qs}`);
      if (r.ok) setSelfCheck(await r.json());
    } finally {
      setSelfCheckLoading(false);
    }
  }, [dataset]);

  useEffect(() => {
    fetchSelfCheck();
  }, [fetchSelfCheck]);

  const runRestContext = async () => {
    setRestLoading(true);
    setRestErr('');
    try {
      const p = new URLSearchParams({ symbol: restSym, market: restMarket });
      if (dataset) p.set('dataset', dataset);
      const r = await fetch(`/api/provider/rest-context?${p.toString()}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Lỗi truy vấn SSI REST');
      setRestResult(d);
    } catch (err: any) {
      setRestErr(err?.message || 'Lỗi kết nối REST');
    } finally {
      setRestLoading(false);
    }
  };

  const runChaosScenario = async (
    scenarioId: 'RATE_LIMIT_429' | 'STALE_GAP_30S' | 'DIRTY_DATA_TRAPS' | 'MISSING_FOLD_PARAMS',
  ) => {
    setChaosLoading(true);
    try {
      const r = await fetch('/api/system/chaos-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId }),
      });
      const d = await r.json();
      if (r.ok) {
        setChaosResult(d);
        if (d.bannerText) {
          onChaosBanner?.(d.bannerText, d.severity || 'warning');
        }
      }
    } finally {
      setChaosLoading(false);
    }
  };
  const { heatmapData, totals } = useMemo(() => {
    if (!quality.length) return { heatmapData: [], totals: [] };
    const flagSet = new Set<string>();
    const map = new Map<string, number>();
    const totalByFlag = new Map<string, number>();

    for (const r of quality) {
      const f = String(r.flags);
      const sd = String(r.session_date);
      const n = Number(r.n || 0);
      flagSet.add(f);
      map.set(`${f}|${sd}`, (map.get(`${f}|${sd}`) || 0) + n);
      totalByFlag.set(f, (totalByFlag.get(f) || 0) + n);
    }

    const flags = Array.from(flagSet).sort();
    const z = flags.map((f) => sessions.map((s) => map.get(`${f}|${s}`) || 0));
    const sortedTotals = Array.from(totalByFlag.entries())
      .map(([flag, count]) => ({ flag, count }))
      .sort((a, b) => b.count - a.count);

    return {
      totals: sortedTotals,
      heatmapData: [
        {
          type: 'heatmap',
          z,
          x: sessions,
          y: flags,
          colorscale: 'YlOrRd',
          hovertemplate: '%{y} · %{x}: %{z} bản ghi<extra></extra>',
        },
      ],
    };
  }, [quality, sessions]);

  const channels =
    provider === 'SSI'
      ? 'ssi_quote, ssi_trade, ssi_room, ssi_market, ssi_indexsummary'
      : provider === 'NEO'
        ? 'stockInfo, marketInfo, marketVolume, marketSession'
        : 'stockInfo, marketInfo';

  return (
    <div>
      <h2 className="page-subheader">
        Dữ liệu &amp; chất lượng — mọi &apos;bẫy&apos; đều được đếm và truy vết
      </h2>
      <p className="page-caption">
        RAW append-only khi capture (JSONL.gz + SHA-256 manifest lúc đóng phiên) → chuẩn hóa (cờ
        chất lượng) → CURATED Parquet. Người chấm replay toàn bộ pipeline từ RAW:{' '}
        <code>neoscope process --force</code>.
      </p>

      <div className="card-panel" id="provider-probe-panel" style={{ marginBottom: 16 }}>
        <div className="probe-header-row">
          <div>
            <div className="narrative-head" style={{ marginBottom: 4 }}>
              <span className="narrative-badge">
                <ShieldCheck size={12} style={{ marginRight: 4, verticalAlign: '-1px' }} />
                Bảo mật &amp; Kiểm tra kết nối API
              </span>
              <h4 className="narrative-title">
                Kiểm tra kết nối &amp; Tuân thủ giới hạn tần suất API (Live Probe)
              </h4>
            </div>
            <p className="small-caption" style={{ margin: 0 }}>
              Không lưu hay trả về token/secret trên trình duyệt; mọi lệnh probe thực thi qua
              server-side với TokenBucket giới hạn tốc độ có trách nhiệm.
            </p>
          </div>
          {onRunProviderProbe && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                type="button"
                id="run-provider-probe-btn"
                className="btn btn-primary"
                onClick={() => onRunProviderProbe('BOTH')}
                disabled={probeLoading}
              >
                <Activity size={14} />
                {probeLoading ? 'Đang kiểm tra…' : 'Kiểm tra cả 2 nguồn (SSI + NEO)'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => onRunProviderProbe('SSI')}
                disabled={probeLoading}
              >
                Thử SSI
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => onRunProviderProbe('NEO')}
                disabled={probeLoading}
              >
                Thử NEO dự phòng
              </button>
            </div>
          )}
        </div>

        {providerStatus && (
          <div className="probe-status-grid">
            <div className="probe-stat-box">
              <div className="probe-stat-label">Nguồn chính / Dự phòng</div>
              <div className="probe-stat-val mono">
                {providerStatus.provider === 'NEO'
                  ? 'VPBankS NEO API → SSI (dự phòng)'
                  : 'SSI FastConnect v3 → NEO (dự phòng)'}
              </div>
              <div className="probe-stat-sub">
                Chế độ: <code>{providerStatus.mode}</code> · Giới hạn:{' '}
                <code>{providerStatus.rateLimitRps} req/s</code>
              </div>
            </div>
            <div className="probe-stat-box">
              <div className="probe-stat-label">SSI FastConnect Endpoints</div>
              <div className="probe-stat-sub mono" style={{ marginTop: 2 }}>
                REST: {providerStatus.apiUrl || 'https://api.ssi.com.vn'}
              </div>
              <div className="probe-stat-sub mono">
                WS: {providerStatus.streamingUrl || 'wss://stream.ssi.com.vn/ws/v3'}
              </div>
            </div>
            <div className="probe-stat-box">
              <div className="probe-stat-label">Biến môi trường xác thực (Server-side only)</div>
              <div className="probe-cred-row">
                <span className={`probe-cred-pill ${providerStatus.hasClientId ? 'ok' : 'miss'}`}>
                  SSI_CLIENT_ID: {providerStatus.hasClientId ? 'Đã nạp' : 'Thiếu'}
                </span>
                <span className={`probe-cred-pill ${providerStatus.hasApiKey ? 'ok' : 'miss'}`}>
                  SSI_API_KEY: {providerStatus.hasApiKey ? 'Đã nạp' : 'Thiếu'}
                </span>
                <span className={`probe-cred-pill ${providerStatus.hasApiSecret ? 'ok' : 'miss'}`}>
                  SSI_API_SECRET: {providerStatus.hasApiSecret ? 'Đã nạp' : 'Thiếu'}
                </span>
                <span className={`probe-cred-pill ${providerStatus.neoBackupReady ? 'ok' : 'miss'}`}>
                  NEO Backup: {providerStatus.neoBackupReady ? 'Sẵn sàng' : 'Chưa cấu hình'}
                </span>
              </div>
            </div>
          </div>
        )}

        {providerProbe && (
          <div
            id="provider-probe-result"
            className={`callout ${providerProbe.ok ? 'success' : 'warning'}`}
            style={{ marginTop: 12, marginBottom: 0, flexDirection: 'column', gap: 4 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <strong>
                {providerProbe.ok
                  ? `Kết nối thành công · ${providerProbe.provider}`
                  : `SSI Chẩn đoán an toàn · bước ${providerProbe.stage}`}
              </strong>
              <span className="mono" style={{ fontSize: 12 }}>
                HTTP {providerProbe.statusCode ?? 'N/A'} · {providerProbe.latencyMs} ms ·{' '}
                {providerProbe.checkedAtVn}
              </span>
            </div>
            <div style={{ fontSize: 12.5 }}>{providerProbe.message}</div>
          </div>
        )}

        {neoProbe && (
          <div
            id="neo-probe-result"
            className={`callout ${neoProbe.ok ? 'success' : 'info'}`}
            style={{ marginTop: 8, marginBottom: 0, flexDirection: 'column', gap: 4 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <strong>
                {neoProbe.ok
                  ? `Kênh dự phòng VPBankS NEO · Sẵn sàng`
                  : `VPBankS NEO Dự phòng · bước ${neoProbe.stage}`}
              </strong>
              <span className="mono" style={{ fontSize: 12 }}>
                HTTP {neoProbe.statusCode ?? 'N/A'} · {neoProbe.latencyMs} ms ·{' '}
                {neoProbe.checkedAtVn}
              </span>
            </div>
            <div style={{ fontSize: 12.5 }}>{neoProbe.message}</div>
          </div>
        )}
      </div>

      <div className="card-panel" id="ssi-rest-context-card" style={{ marginBottom: 16 }}>
        <div className="h2h-header-row" style={{ marginBottom: 10 }}>
          <div>
            <div className="narrative-head" style={{ marginBottom: 4 }}>
              <span className="narrative-badge">
                <Database size={12} style={{ marginRight: 4, verticalAlign: '-1px' }} />
                SSI REST Securities &amp; DailyOHLCHistory
              </span>
              <h4 className="narrative-title">
                Truy vấn Ngữ cảnh Niêm yết &amp; Lịch sử Phiên (Rate-limited REST)
              </h4>
            </div>
            <p className="small-caption" style={{ margin: 0 }}>
              Kiểm chứng danh mục cổ phiếu trên bảng niêm yết SSI và lấy dữ liệu OHLC gần nhất qua <code>TokenBucketLimiter</code>. Nếu chưa nạp khóa trên server, trả fallback an toàn.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <label className="field-label" htmlFor="rest-sym-select">
                Mã
              </label>
              <select
                id="rest-sym-select"
                className="select-input"
                value={restSym}
                onChange={(e) => setRestSym(e.target.value)}
                style={{ minWidth: 96 }}
              >
                {symOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="rest-market-select">
                Sàn
              </label>
              <select
                id="rest-market-select"
                className="select-input"
                value={restMarket}
                onChange={(e) => setRestMarket(e.target.value as 'HOSE' | 'HNX' | 'UPCOM')}
                style={{ minWidth: 96 }}
              >
                <option value="HOSE">HOSE</option>
                <option value="HNX">HNX</option>
                <option value="UPCOM">UPCOM</option>
              </select>
            </div>
            <button
              type="button"
              id="fetch-rest-context-btn"
              className="btn btn-primary"
              disabled={restLoading}
              onClick={runRestContext}
            >
              {restLoading ? 'Đang truy vấn…' : 'Lấy ngữ cảnh REST SSI'}
            </button>
          </div>
        </div>

        {restErr && <div className="callout error">{restErr}</div>}

        {restResult && (
          <div style={{ marginTop: 10 }}>
            <div className={`callout ${restResult.ok ? 'success' : 'info'}`} style={{ marginBottom: 10 }}>
              <div>
                <strong>
                  {restResult.source === 'LIVE_SSI_REST' ? 'Dữ liệu SSI REST Live' : 'Fallback An toàn'}
                </strong>{' '}
                · Mã <strong className="mono">{restResult.symbol}</strong> ({restResult.market}) · Watchlist:{' '}
                <code>{restResult.watchlistCheck?.group}</code> · Độ trễ: {restResult.latencyMs} ms.
                <div style={{ marginTop: 4 }}>{restResult.message}</div>
              </div>
            </div>
            {Array.isArray(restResult.ohlcRows) && restResult.ohlcRows.length > 0 && (
              <div className="table-wrap">
                <table className="neo-table compact">
                  <thead>
                    <tr>
                      <th>Ngày giao dịch</th>
                      <th className="num">Mở cửa</th>
                      <th className="num">Cao nhất</th>
                      <th className="num">Thấp nhất</th>
                      <th className="num">Đóng cửa</th>
                      <th className="num">Khối lượng</th>
                    </tr>
                  </thead>
                  <tbody>
                    {restResult.ohlcRows.map((row: any, i: number) => (
                      <tr key={i}>
                        <td className="mono">{row.tradingDate}</td>
                        <td className="num">{row.open?.toLocaleString('en-US') ?? '—'}</td>
                        <td className="num">{row.high?.toLocaleString('en-US') ?? '—'}</td>
                        <td className="num">{row.low?.toLocaleString('en-US') ?? '—'}</td>
                        <td className="num">{row.close?.toLocaleString('en-US') ?? '—'}</td>
                        <td className="num">{row.volume?.toLocaleString('en-US') ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card-panel" id="chaos-demo-card" style={{ marginBottom: 16 }}>
        <div className="narrative-head" style={{ marginBottom: 6 }}>
          <span className="narrative-badge">
            <Zap size={12} style={{ marginRight: 4, verticalAlign: '-1px' }} />
            Kiểm thử chịu lỗi (Chaos Lab)
          </span>
          <h4 className="narrative-title">
            Mô phỏng lỗi mạng, gián đoạn WebSocket &amp; 6 bẫy dữ liệu thị trường Việt Nam
          </h4>
        </div>
        <p className="small-caption" style={{ marginTop: 0 }}>
          Bấm từng kịch bản để quan sát cơ chế phòng vệ thực tế của NeoScope (TokenBucket, Watchdog Stale Gap, chuẩn hóa Null-preserving, và hạ cấp tất định).
        </p>
        <div className="chaos-btn-grid">
          <button
            type="button"
            id="chaos-btn-429"
            className="btn"
            disabled={chaosLoading}
            onClick={() => runChaosScenario('RATE_LIMIT_429')}
          >
            <AlertTriangle size={14} /> HTTP 429 &amp; TokenBucket
          </button>
          <button
            type="button"
            id="chaos-btn-stale"
            className="btn"
            disabled={chaosLoading}
            onClick={() => runChaosScenario('STALE_GAP_30S')}
          >
            <AlertTriangle size={14} /> Stale Gap &gt;30s WS
          </button>
          <button
            type="button"
            id="chaos-btn-dirty"
            className="btn"
            disabled={chaosLoading}
            onClick={() => runChaosScenario('DIRTY_DATA_TRAPS')}
          >
            <AlertTriangle size={14} /> 6 Bẫy dữ liệu thô
          </button>
          <button
            type="button"
            id="chaos-btn-fold"
            className="btn"
            disabled={chaosLoading}
            onClick={() => runChaosScenario('MISSING_FOLD_PARAMS')}
          >
            <AlertTriangle size={14} /> Thiếu fold_params
          </button>
        </div>

        {chaosResult && (
          <div style={{ marginTop: 12 }}>
            <div className={`callout ${chaosResult.severity || 'info'}`} style={{ marginBottom: 10 }}>
              <div>
                <strong>{chaosResult.title}</strong> · Cơ chế: <code>{chaosResult.mechanism}</code>
                <div style={{ marginTop: 4 }}>{chaosResult.summary}</div>
                <div style={{ marginTop: 4, fontSize: 12 }}>
                  <strong>Hành động phục hồi:</strong> {chaosResult.recoveryAction}
                </div>
              </div>
            </div>
            <div className="table-wrap">
              <table className="neo-table compact">
                <thead>
                  <tr>
                    <th>Bước</th>
                    <th>Payload / Tình huống gốc</th>
                    <th>Xử lý chuẩn hóa</th>
                    <th>Cờ chất lượng</th>
                  </tr>
                </thead>
                <tbody>
                  {(chaosResult.sampleRows || []).map((row: any, idx: number) => (
                    <tr key={idx}>
                      <td style={{ whiteSpace: 'nowrap', fontWeight: 700 }}>{row.step}</td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{row.rawPayload}</td>
                      <td>{row.normalizedAction}</td>
                      <td>
                        <div className="failure-reason-list">
                          {(row.flags || []).length ? (
                            row.flags.map((f: string) => (
                              <span key={f} className="failure-reason-tag">
                                {f}
                              </span>
                            ))
                          ) : (
                            <span style={{ color: '#4dd0c1', fontSize: 11.5 }}>CLEAN</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {heatmapData.length > 0 && (
        <>
          <PlotlyChart
            data={heatmapData}
            height={380}
            title="Bản đồ cờ chất lượng theo phiên — mọi 'bẫy' dữ liệu đều được đếm"
            layout={{
              yaxis: { autorange: 'reversed', automargin: true },
              margin: { l: 130, r: 24, t: 52, b: 48 },
            }}
            alt="Bản đồ nhiệt các cờ chất lượng dữ liệu theo phiên."
          />

          <div className="grid-2-weighted" style={{ marginTop: 14 }}>
            <div className="table-wrap">
              <table className="neo-table">
                <thead>
                  <tr>
                    <th>Cờ</th>
                    <th className="num">Số bản ghi</th>
                  </tr>
                </thead>
                <tbody>
                  {totals.map((r) => (
                    <tr key={r.flag}>
                      <td className="mono">{r.flag}</td>
                      <td className="num">{r.count.toLocaleString('en-US')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8, color: '#e8f0fc' }}>
                Ý nghĩa từng cờ (xem docs/provider_contracts.md và docs/ssi_fastconnect.md)
              </div>
              <div className="table-wrap table-scroll">
                <table className="neo-table">
                  <thead>
                    <tr>
                      <th>Cờ</th>
                      <th>Xử lý</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(flagDescriptions).map(([flag, desc]) => (
                      <tr key={flag}>
                        <td className="mono" style={{ whiteSpace: 'nowrap', color: '#7dd3fc' }}>
                          {flag}
                        </td>
                        <td>{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      {qualityMeta.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <h4 style={{ margin: '8px 0', color: '#e8f0fc' }}>Sổ cái pipeline theo phiên</h4>
          <div className="table-wrap">
            <table className="neo-table">
              <thead>
                <tr>
                  <th>Phiên</th>
                  <th className="num">RAW</th>
                  <th className="num">Curated</th>
                  <th className="num">Lặp bị loại</th>
                </tr>
              </thead>
              <tbody>
                {qualityMeta.map((m, i) => (
                  <tr key={i}>
                    <td>{m.session_date}</td>
                    <td className="num">{Number(m.n_raw).toLocaleString('en-US')}</td>
                    <td className="num">{Number(m.n_curated).toLocaleString('en-US')}</td>
                    <td className="num">
                      {Number(m.n_duplicates_dropped).toLocaleString('en-US')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {manifests.length > 0 && (
        <details className="expander" style={{ marginTop: 14 }}>
          <summary>🔐 Manifest truy vết (sha256 từng tệp RAW + config_hash + seed)</summary>
          <div className="expander-body">
            <div className="table-wrap">
              <table className="neo-table">
                <thead>
                  <tr>
                    <th>Phiên</th>
                    <th>Capture</th>
                    <th className="num">Thông điệp</th>
                    <th>synthetic</th>
                    <th className="num">seed</th>
                    <th>config_hash</th>
                    <th>sha256(stockInfo)</th>
                  </tr>
                </thead>
                <tbody>
                  {manifests.map((man, i) => (
                    <tr key={i}>
                      <td>{man.date}</td>
                      <td className="mono">{man.session_dir}</td>
                      <td className="num">
                        {Number(man.total_messages ?? 0).toLocaleString('en-US')}
                      </td>
                      <td>{String(Boolean(man.synthetic))}</td>
                      <td className="num">{man.seed ?? '—'}</td>
                      <td className="mono">{man.config_hash ?? '—'}</td>
                      <td className="mono">
                        {(man.sha256?.['stockInfo.jsonl.gz'] || '').slice(0, 16)}…
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </details>
      )}

      <div style={{ marginTop: 18 }}>
        <h4 style={{ margin: '8px 0', color: '#e8f0fc' }}>
          Từ điển dữ liệu rút gọn — {provider}
        </h4>
        {provider === 'SSI' ? (
          <div className="table-wrap">
            <table className="neo-table">
              <thead>
                <tr>
                  <th>Trường nguồn</th>
                  <th>Kiểu/đơn vị</th>
                  <th>Chuẩn hóa</th>
                  <th>Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>bid_prices / ask_prices</code></td>
                  <td>danh sách, nghìn VND</td>
                  <td>VND; ba mức đầu</td>
                  <td>Giữ payload SSI trong RAW</td>
                </tr>
                <tr>
                  <td><code>price, avg</code></td>
                  <td>VND</td>
                  <td>giữ VND</td>
                  <td>Giá giao dịch/giá bình quân</td>
                </tr>
                <tr>
                  <td><code>total_volume</code></td>
                  <td>lũy kế phiên</td>
                  <td>delta</td>
                  <td>Giá trị giao dịch xấp xỉ từ avg × volume</td>
                </tr>
                <tr>
                  <td>ngoại mua/bán</td>
                  <td>semantics chưa xác nhận</td>
                  <td>không đưa vào flow analytics</td>
                  <td>RAW giữ nguyên</td>
                </tr>
                <tr>
                  <td><code>indexsummary.data</code></td>
                  <td>payload SSI</td>
                  <td>marketInfo</td>
                  <td>Thời gian sự kiện/arrival hiển thị theo UTC+7</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : provider === 'NEO' ? (
          <div className="table-wrap">
            <table className="neo-table">
              <thead>
                <tr>
                  <th>Trường NEO</th>
                  <th>Kiểu gốc</th>
                  <th>Chuẩn hóa</th>
                  <th>Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>bidPrice1/askPrice1</code></td>
                  <td>chuỗi, có thể ATO/ATC</td>
                  <td>float hoặc null + cờ</td>
                  <td>Không ép số bừa</td>
                </tr>
                <tr>
                  <td><code>totalBidQTTY/totalAskQTTY</code></td>
                  <td>có thể null</td>
                  <td>null + cờ</td>
                  <td>Không điền 0</td>
                </tr>
                <tr>
                  <td><code>totalTradingVolume/Value</code></td>
                  <td>lũy kế phiên</td>
                  <td>delta đơn điệu</td>
                  <td>Muộn/reset được gắn cờ</td>
                </tr>
                <tr>
                  <td>foreign flow</td>
                  <td>phụ thuộc payload NEO</td>
                  <td>cờ chất lượng</td>
                  <td>Theo hợp đồng NEO được cấu hình</td>
                </tr>
                <tr>
                  <td><code>indexValue</code></td>
                  <td>có thể là chuỗi</td>
                  <td>float</td>
                  <td>marketInfo</td>
                </tr>
                <tr>
                  <td>timestamp</td>
                  <td>có thể thiếu múi giờ</td>
                  <td><code>Asia/Ho_Chi_Minh</code></td>
                  <td>Nguồn thời gian giữ trong RAW</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="page-caption">
            Dữ liệu mô phỏng theo schema canonical; xem manifest để biết seed và phiên bản bộ sinh.
          </p>
        )}
      </div>

      <div className="callout info" style={{ marginTop: 12 }}>
        <span>📡</span>
        <span>
          Channel RAW của nguồn đang chọn: <code>{channels}</code>.
        </span>
      </div>

      {selfCheck && (
        <div className="card-panel" id="system-self-check-card" style={{ marginTop: 16 }}>
          <div className="h2h-header-row" style={{ marginBottom: 10 }}>
            <div>
              <div className="narrative-head" style={{ marginBottom: 4 }}>
                <span className="narrative-badge">
                  <CheckCircle2 size={12} style={{ marginRight: 4, verticalAlign: '-1px' }} />
                  Kiểm toán Hệ thống &amp; Bảo mật ({selfCheck.passCount}/{selfCheck.totalCount} PASS)
                </span>
                <h4 className="narrative-title">
                  Tự kiểm tra an toàn vận hành, khóa truy cập &amp; tái lập nghiên cứu
                </h4>
              </div>
              <div className="small-caption" style={{ margin: 0 }}>
                Kiểm tra lúc <span className="mono">{selfCheck.checkedAtVn}</span> ·{' '}
                <code>config_hash={selfCheck.configHash}</code>
              </div>
            </div>
            <button
              type="button"
              id="refresh-self-check-btn"
              className="btn"
              disabled={selfCheckLoading}
              onClick={fetchSelfCheck}
            >
              <RefreshCw size={13} className={selfCheckLoading ? 'spin-icon' : ''} /> Kiểm tra lại
            </button>
          </div>
          <div className="self-check-grid">
            {(selfCheck.checks || []).map((c: any) => (
              <div key={c.id} className="self-check-item">
                <div className="self-check-top">
                  <span className="self-check-cat">{c.category}</span>
                  <span className={`probe-cred-pill ${c.status === 'PASS' ? 'ok' : 'miss'}`}>
                    {c.status}
                  </span>
                </div>
                <div className="self-check-title">{c.title}</div>
                <div className="self-check-detail">{c.detail}</div>
                <div className="mono self-check-evidence">{c.evidence}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
