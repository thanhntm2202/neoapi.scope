import React, { useMemo } from 'react';
import { Activity, ShieldCheck } from 'lucide-react';
import { PlotlyChart } from '../components/PlotlyChart';

interface DataQualityPageProps {
  quality: any[];
  qualityMeta: any[];
  flagDescriptions: Record<string, string>;
  manifests: any[];
  sessions: string[];
  provider: string;
  providerStatus?: any;
  providerProbe?: any;
  probeLoading?: boolean;
  onRunProviderProbe?: () => void;
}

export const DataQualityPage: React.FC<DataQualityPageProps> = ({
  quality,
  qualityMeta,
  flagDescriptions,
  manifests,
  sessions,
  provider,
  providerStatus,
  providerProbe,
  probeLoading,
  onRunProviderProbe,
}) => {
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
            <button
              type="button"
              id="run-provider-probe-btn"
              className="btn btn-primary"
              onClick={onRunProviderProbe}
              disabled={probeLoading}
            >
              <Activity size={14} />
              {probeLoading ? 'Đang chạy kiểm tra…' : 'Chạy kiểm tra kết nối (API Probe)'}
            </button>
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
                  : `Chẩn đoán an toàn · bước ${providerProbe.stage}`}
              </strong>
              <span className="mono" style={{ fontSize: 12 }}>
                HTTP {providerProbe.statusCode ?? 'N/A'} · {providerProbe.latencyMs} ms ·{' '}
                {providerProbe.checkedAtVn}
              </span>
            </div>
            <div style={{ fontSize: 12.5 }}>{providerProbe.message}</div>
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
    </div>
  );
};
