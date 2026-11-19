import React, { useEffect, useMemo, useState } from 'react';
import { PlotlyChart } from '../components/PlotlyChart';
import { C_ACCENT, C_BAD, C_GOOD, C_LARGE, C_THIN, MODEL_COLORS } from '../lib/format';

interface ValidationPageProps {
  summary: any;
  results: any;
}

export const ValidationPage: React.FC<ValidationPageProps> = ({ summary, results }) => {
  const metrics: any[] = results?.metrics || [];
  const mcov: any[] = results?.metrics_coverage || [];
  const cov: any[] = results?.coverage || [];
  const fp: any[] = results?.fold_params || [];
  const ic: any[] = results?.lhs_ic || [];
  const obi: any[] = results?.obi_direction || [];

  const [extra, setExtra] = useState<{ fullPreds: any[]; resilience: any[] }>({
    fullPreds: [],
    resilience: [],
  });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/validation/extra')
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setExtra({ fullPreds: d.fullPreds || [], resilience: d.resilience || [] });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const metricsBarData = useMemo(() => {
    return metrics
      .filter((m) => m.group === 'ALL')
      .map((r) => ({
        type: 'bar',
        x: [r.model],
        y: [r.mae_bps],
        name: r.model,
        marker: { color: MODEL_COLORS[r.model] || C_ACCENT },
        text: [Number(r.mae_bps).toFixed(2)],
        textposition: 'outside',
        hovertemplate: `${r.model}: MAE %{y:.2f} bps (n=${r.n})<extra></extra>`,
      }));
  }, [metrics]);

  const { scatterData, scatterLim } = useMemo(() => {
    const preds = extra.fullPreds;
    if (!preds.length) return { scatterData: [], scatterLim: 50 };
    const inBook = preds.filter((p) => p.coverage >= 1.0);
    const beyond = preds.filter((p) => p.coverage < 1.0);
    const allAbs = preds
      .flatMap((p) => [Math.abs(p.realized_is_bps), Math.abs(p.e_is_bps)])
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const lim = (allAbs[Math.floor(allAbs.length * 0.995)] || 50) + 5;
    return {
      scatterLim: lim,
      scatterData: [
        {
          type: 'scatter',
          mode: 'markers',
          name: 'trong sổ (tất định)',
          x: inBook.map((p) => p.realized_is_bps),
          y: inBook.map((p) => p.e_is_bps),
          marker: { size: 5, color: '#94a3b8', opacity: 0.6 },
          hovertemplate: 'realized %{x:.1f} bps<br>dự báo %{y:.1f} bps<extra></extra>',
        },
        {
          type: 'scatter',
          mode: 'markers',
          name: 'vượt sổ (rủi ro)',
          x: beyond.map((p) => p.realized_is_bps),
          y: beyond.map((p) => p.e_is_bps),
          marker: { size: 5, color: C_ACCENT, opacity: 0.65 },
          hovertemplate: 'realized %{x:.1f} bps<br>dự báo %{y:.1f} bps<extra></extra>',
        },
        {
          type: 'scatter',
          mode: 'lines',
          name: 'y = x',
          x: [-lim, lim],
          y: [-lim, lim],
          line: { color: C_BAD, dash: 'dash', width: 1 },
        },
      ],
    };
  }, [extra.fullPreds]);

  const makeBootData = (boot: any) => {
    if (!boot) return [];
    const per = boot.per_session || {};
    const xs = Object.keys(per);
    const ys = Object.values(per) as number[];
    const d = boot.delta_mae_bps;
    const lo = boot.ci95_lo;
    const hi = boot.ci95_hi;
    return [
      {
        type: 'scatter',
        mode: 'markers',
        x: xs,
        y: ys,
        name: 'ΔMAE từng phiên test',
        marker: { size: 9, color: C_LARGE },
      },
      {
        type: 'scatter',
        mode: 'markers',
        x: ['GỘP (bootstrap cụm phiên)'],
        y: [d],
        error_y: {
          type: 'data',
          symmetric: false,
          array: [hi - d],
          arrayminus: [d - lo],
          color: C_BAD,
        },
        marker: { size: 12, color: C_BAD },
        name: 'ΔMAE gộp + CI95',
      },
    ];
  };

  const piCovData = useMemo(() => {
    const labels: Record<string, string> = {
      ALL: 'Tất cả lệnh',
      'ALL:in_book': 'Trong sổ (PI suy biến)',
      'ALL:beyond_book': 'Vượt sổ (PI có ý nghĩa)',
    };
    const d = cov.filter((r) => labels[r.group]);
    if (!d.length) return [];
    const colors: Record<string, string> = {
      ALL: C_ACCENT,
      'ALL:in_book': '#94a3b8',
      'ALL:beyond_book': C_LARGE,
    };
    return [
      {
        type: 'bar',
        x: d.map((r) => labels[r.group]),
        y: d.map((r) => r.coverage * 100),
        error_y: {
          type: 'data',
          symmetric: false,
          array: d.map((r) => (r.wilson_hi - r.coverage) * 100),
          arrayminus: d.map((r) => (r.coverage - r.wilson_lo) * 100),
        },
        marker: { color: d.map((r) => colors[r.group]) },
        text: d.map((r) => `${(r.coverage * 100).toFixed(1)}%`),
        textposition: 'outside',
      },
    ];
  }, [cov]);

  const foldParamsData = useMemo(() => {
    if (!fp.length) return [];
    const traces: any[] = [];
    for (const [grp, color] of [
      ['large', C_LARGE],
      ['thin', C_THIN],
    ] as const) {
      const g = fp.filter((r) => r.group === grp).sort((a, b) => a.fold - b.fold);
      traces.push({
        type: 'scatter',
        mode: 'lines+markers',
        name: `κ ${grp}`,
        x: g.map((r) => r.fold),
        y: g.map((r) => r.kappa_bps_per_s),
        error_y: { type: 'data', array: g.map((r) => r.kappa_se), visible: true },
        line: { color, width: 2 },
        xaxis: 'x',
        yaxis: 'y',
      });
      traces.push({
        type: 'scatter',
        mode: 'lines+markers',
        name: `Y ${grp}`,
        x: g.map((r) => r.fold),
        y: g.map((r) => r.y_cov),
        line: { color, width: 2, dash: 'dot' },
        showlegend: false,
        xaxis: 'x2',
        yaxis: 'y2',
      });
    }
    return traces;
  }, [fp]);

  const icData = useMemo(() => {
    if (!ic.length) return [];
    return [
      {
        type: 'scatter',
        mode: 'lines+markers',
        x: ic.map((r) => r.session_date),
        y: ic.map((r) => r.mean_ic),
        error_y: { type: 'data', array: ic.map((r) => r.std_ic), visible: true },
        line: { color: C_ACCENT, width: 2 },
        name: 'Spearman TB trong phiên',
      },
    ];
  }, [ic]);

  const obiData = useMemo(() => {
    if (!obi.length) return [];
    return [
      {
        type: 'bar',
        x: obi.map((r) => r.quintile),
        y: obi.map((r) => r.mean_ret_bps),
        name: 'Lợi nhuận phút kế tiếp (bps)',
        marker: { color: obi.map((r) => (r.mean_ret_bps < 0 ? C_BAD : C_GOOD)) },
        yaxis: 'y',
      },
      {
        type: 'scatter',
        mode: 'lines+markers',
        x: obi.map((r) => r.quintile),
        y: obi.map((r) => r.p_up * 100),
        name: 'P(tăng) %',
        line: { color: C_ACCENT, width: 2 },
        yaxis: 'y2',
      },
    ];
  }, [obi]);

  const resHistData = useMemo(() => {
    if (!extra.resilience.length) return [];
    return (['large', 'thin'] as const).map((grp) => {
      const vals = extra.resilience.filter((r) => r.group === grp).map((r) => r.recover_s);
      return {
        type: 'histogram',
        x: vals,
        name: `${grp} (n=${vals.length})`,
        marker: { color: grp === 'large' ? C_LARGE : C_THIN },
        opacity: 0.65,
        nbinsx: 40,
      };
    });
  }, [extra.resilience]);

  if (!metrics.length) {
    return <div className="callout warning">Chưa có kết quả kiểm chứng — chạy `neoscope validate`.</div>;
  }

  const bootFl = summary?.bootstrap_full_vs_ladder;
  const bootBeyond = summary?.bootstrap_full_vs_ladder_beyond_book;
  const covBeyond = cov.find((r) => r.group === 'ALL:beyond_book');

  return (
    <div>
      <h2 className="page-subheader">Kiểm chứng · Ước tính đáng tin đến đâu?</h2>
      <p className="page-caption">
        Walk-forward 5 folds (train 1..k → test k+1), bootstrap THEO CỤM PHIÊN, độ phủ PI + Wilson
        CI, phân rã theo chế độ phủ sổ. Đưa cả điểm yếu lên giao diện là chủ đích: kết quả không
        được trình bày vượt quá khả năng mô hình.
      </p>

      <div className="grid-2-weighted">
        <div>
          <PlotlyChart
            data={metricsBarData}
            height={320}
            title="Sai số tuyệt đối trung bình — 3 mô hình, toàn bộ lệnh test"
            layout={{
              showlegend: false,
              yaxis: { title: 'MAE ngoài mẫu (bps)' },
            }}
            alt="So sánh MAE ngoài mẫu giữa mô hình đầy đủ và các benchmark."
          />
        </div>
        <div>
          <h4 style={{ margin: '6px 0 8px 0', color: '#e8f0fc' }}>
            Bảng sai số ngoài mẫu (bps)
          </h4>
          <div className="table-wrap">
            <table className="neo-table">
              <thead>
                <tr>
                  <th>Mô hình</th>
                  <th>Nhóm</th>
                  <th className="num">n lệnh</th>
                  <th className="num">MAE</th>
                  <th className="num">RMSE</th>
                  <th className="num">Bias</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((r, i) => (
                  <tr key={i}>
                    <td>{r.model}</td>
                    <td>{r.group}</td>
                    <td className="num">{r.n}</td>
                    <td className="num">{Number(r.mae_bps).toFixed(2)}</td>
                    <td className="num">{Number(r.rmse_bps).toFixed(2)}</td>
                    <td className="num">
                      {r.bias_bps >= 0 ? '+' : ''}
                      {Number(r.bias_bps).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {mcov.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ margin: '6px 0 8px 0', color: '#e8f0fc' }}>
            Phân rã trung thực: trong sổ vs vượt sổ
          </h4>
          <div className="table-wrap">
            <table className="neo-table">
              <thead>
                <tr>
                  <th>Mô hình</th>
                  <th>Chế độ</th>
                  <th className="num">n</th>
                  <th className="num">MAE</th>
                  <th className="num">RMSE</th>
                  <th className="num">Bias</th>
                </tr>
              </thead>
              <tbody>
                {mcov.map((r, i) => (
                  <tr key={i}>
                    <td>{r.model}</td>
                    <td>{r.regime}</td>
                    <td className="num">{r.n}</td>
                    <td className="num">{Number(r.mae_bps).toFixed(2)}</td>
                    <td className="num">{Number(r.rmse_bps).toFixed(2)}</td>
                    <td className="num">
                      {r.bias_bps >= 0 ? '+' : ''}
                      {Number(r.bias_bps).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="small-caption">
            ⚠️ Sai số ≈ 0 của lệnh <strong>trong sổ</strong> là HỆ QUẢ CỦA GIẢ ĐỊNH quét toàn bộ KL
            hiển thị (realized == ladder một cách tất định), KHÔNG phải bằng chứng mô hình giỏi. Giá
            trị gia tăng thật nằm ở chế độ <strong>vượt sổ</strong> — nơi mô hình full phải thắng
            benchmark.
          </div>
        </div>
      )}

      {scatterData.length > 0 && (
        <PlotlyChart
          data={scatterData}
          height={400}
          title="Dự báo vs thực hiện — lệnh vượt sổ mới là nơi mô hình phải chứng minh giá trị"
          layout={{
            xaxis: { title: 'IS thực hiện (bps)', range: [-scatterLim, scatterLim] },
            yaxis: { title: 'IS dự báo (bps)', range: [-scatterLim, scatterLim] },
          }}
          alt="Đối chiếu implementation shortfall dự báo và thực hiện cho từng lệnh test."
        />
      )}

      <div className="grid-2" style={{ marginTop: 12 }}>
        {bootFl && (
          <div>
            <PlotlyChart
              data={makeBootData(bootFl)}
              height={330}
              title="ΔMAE full − ladder_only (mọi lệnh)"
              layout={{
                yaxis: { title: 'ΔMAE (bps) — âm = full tốt hơn' },
                shapes: [
                  {
                    type: 'line',
                    x0: 0,
                    x1: 1,
                    y0: 0,
                    y1: 0,
                    xref: 'paper',
                    yref: 'y',
                    line: { dash: 'dash', color: '#64748b' },
                  },
                ],
              }}
              alt="Khoảng tin cậy bootstrap theo phiên cho chênh lệch MAE trên toàn bộ lệnh."
            />
            <div className="small-caption">
              Δ = {bootFl.delta_mae_bps >= 0 ? '+' : ''}
              {bootFl.delta_mae_bps.toFixed(2)} bps, CI95 [{bootFl.ci95_lo.toFixed(2)},{' '}
              {bootFl.ci95_hi.toFixed(2)}], p = {bootFl.p_two_sided.toFixed(3)} ·{' '}
              {bootFl.n_sessions} cụm phiên
            </div>
          </div>
        )}
        {bootBeyond && bootBeyond.n_sessions > 0 && (
          <div>
            <PlotlyChart
              data={makeBootData(bootBeyond)}
              height={330}
              title="ΔMAE full − ladder_only (CHỈ lệnh vượt sổ)"
              layout={{
                yaxis: { title: 'ΔMAE (bps) — âm = full tốt hơn' },
                shapes: [
                  {
                    type: 'line',
                    x0: 0,
                    x1: 1,
                    y0: 0,
                    y1: 0,
                    xref: 'paper',
                    yref: 'y',
                    line: { dash: 'dash', color: '#64748b' },
                  },
                ],
              }}
              alt="Khoảng tin cậy bootstrap theo phiên cho lệnh vượt sổ hiển thị."
            />
            <div className="small-caption">
              Δ = {bootBeyond.delta_mae_bps >= 0 ? '+' : ''}
              {bootBeyond.delta_mae_bps.toFixed(2)} bps, CI95 [{bootBeyond.ci95_lo.toFixed(2)},{' '}
              {bootBeyond.ci95_hi.toFixed(2)}], p = {bootBeyond.p_two_sided.toFixed(3)} — đây là
              bằng chứng THEN CHỐT.
            </div>
          </div>
        )}
      </div>
      <div className="small-caption">
        Bootstrap theo cụm phiên (không theo lệnh) vì sai số các lệnh cùng phiên tương quan chế độ
        thị trường. Chỉ 5 cụm test → công suất thống kê hạn chế, CI rộng là trung thực.
      </div>

      <div className="grid-2" style={{ marginTop: 12 }}>
        <div>
          {piCovData.length > 0 && (
            <PlotlyChart
              data={piCovData}
              height={330}
              title="Khoảng dự báo 90% có phủ đúng 90% không?"
              layout={{
                yaxis: { range: [0, 112], title: 'Độ phủ thực nghiệm (%) + Wilson CI95' },
                shapes: [
                  {
                    type: 'line',
                    x0: 0,
                    x1: 1,
                    y0: 90,
                    y1: 90,
                    xref: 'paper',
                    yref: 'y',
                    line: { dash: 'dash', color: C_BAD },
                  },
                ],
              }}
              alt="Độ phủ thực tế của khoảng dự báo theo nhóm và chế độ phủ sổ."
            />
          )}
        </div>
        <div>
          {foldParamsData.length > 0 && (
            <PlotlyChart
              data={foldParamsData}
              height={330}
              title="Tham số hiệu chỉnh qua các fold"
              layout={{
                xaxis: { domain: [0, 0.45], title: 'Fold walk-forward · κ', dtick: 1 },
                yaxis: { title: 'κ (bps/s / OBI)' },
                xaxis2: { domain: [0.55, 1.0], title: 'Fold walk-forward · Y', dtick: 1 },
                yaxis2: { anchor: 'x2', title: 'Y (rủi ro)' },
              }}
              alt="Tham số hiệu chỉnh theo từng fold walk-forward."
            />
          )}
        </div>
      </div>

      {covBeyond && (
        <div className="small-caption">
          Độ phủ PI 90% ở chế độ vượt sổ: <strong>{(covBeyond.coverage * 100).toFixed(1)}%</strong>{' '}
          (Wilson [{(covBeyond.wilson_lo * 100).toFixed(1)}%,{' '}
          {(covBeyond.wilson_hi * 100).toFixed(1)}%], n={covBeyond.n}). Độ phủ toàn mẫu cao hơn
          danh nghĩa vì lệnh trong sổ có PI suy biến bề rộng 0 — đã tách bạch để không ‘khoe’ độ phủ
          ảo.
        </div>
      )}

      <h4 style={{ margin: '18px 0 8px 0', color: '#e8f0fc' }}>
        Giá trị xây dựng của LHS &amp; sức dự báo của OBI (ngoài mẫu)
      </h4>
      <div className="grid-2">
        <div>
          {icData.length > 0 && (
            <>
              <PlotlyChart
                data={icData}
                height={320}
                title="Giá trị xây dựng của LHS: điểm cao → ILLIQ tương lai thấp"
                layout={{
                  yaxis: { title: "Spearman(LHS_t, ILLIQ 15' tương lai)" },
                  xaxis: { title: 'Phiên test' },
                  shapes: [
                    {
                      type: 'line',
                      x0: 0,
                      x1: 1,
                      y0: 0,
                      y1: 0,
                      xref: 'paper',
                      yref: 'y',
                      line: { dash: 'dash', color: '#64748b' },
                    },
                  ],
                }}
                alt="Tương quan thứ hạng giữa LHS và illiquidity tương lai trên các phiên test."
              />
              <div className="small-caption">
                Spearman trung bình mọi phiên test:{' '}
                <strong>{Number(summary?.lhs_ic_overall ?? 0).toFixed(3)}</strong> (âm mạnh = LHS
                cao → ILLIQ tương lai thấp, đúng kỳ vọng lý thuyết).
              </div>
            </>
          )}
        </div>
        <div>
          {obiData.length > 0 && (
            <>
              <PlotlyChart
                data={obiData}
                height={320}
                title="OBI có dự báo hướng giá 1 phút ngoài mẫu? (Cont et al. 2014)"
                layout={{
                  xaxis: {
                    title: 'Ngũ phân vị OBI (1 = cung áp đảo, 5 = cầu áp đảo)',
                    dtick: 1,
                  },
                  yaxis: { title: 'bps' },
                  yaxis2: {
                    title: '%',
                    overlaying: 'y',
                    side: 'right',
                    range: [0, 100],
                    gridcolor: 'rgba(0,0,0,0)',
                  },
                }}
                alt="Lợi nhuận một phút tiếp theo theo ngũ phân vị OBI ngoài mẫu."
              />
              <div className="small-caption">
                Đơn điệu tăng theo ngũ phân vị OBI → sức dự báo hướng giá ngắn hạn (Cont, Kukanov
                &amp; Stoikov 2014) tái lập được ngoài mẫu.
              </div>
            </>
          )}
        </div>
      </div>

      {resHistData.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <PlotlyChart
            data={resHistData}
            height={320}
            title="Khả năng phục hồi sau cú sốc khối lượng (resilience)"
            layout={{
              barmode: 'overlay',
              xaxis: { title: 'Thời gian phục hồi độ sâu (giây)', range: [0, 180] },
              yaxis: { title: 'Số episode' },
            }}
            alt="Phân phối thời gian phục hồi độ sâu sau các nhịp khối lượng cao."
          />
          {summary?.resilience && (
            <>
              <pre className="json-box">{JSON.stringify(summary.resilience, null, 2)}</pre>
              <div className="small-caption">
                Median thời gian phục hồi độ sâu sau cú sốc khối lượng theo nhóm — nhóm midcap mỏng
                phục hồi chậm/kém hơn là rủi ro thanh khoản động đo được.
              </div>
            </>
          )}
        </div>
      )}

      <div className="card-panel" style={{ marginTop: 18 }}>
        <h4 style={{ margin: '0 0 8px 0', color: '#e8f0fc' }}>
          Giới hạn trung thực (đọc trước khi tin bất kỳ con số nào ở trên)
        </h4>
        <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.7, color: '#b9c7de' }}>
          <li>
            <strong>Dữ liệu SYNTHETIC</strong> (khi ở chế độ mô phỏng): kết quả kiểm chứng là của
            THẾ GIỚI MÔ PHỎNG, không phải thị trường HOSE thật.
          </li>
          <li>
            <strong>Không mô phỏng hàng đợi (queue position)</strong> và{' '}
            <strong>không có phản hồi own-impact</strong>: lệnh thật lớn sẽ gây trượt giá mạnh hơn
            so với mô phỏng.
          </li>
          <li>
            <strong>Số cụm phiên test còn ít (5 phiên)</strong>: CI bootstrap theo cụm phiên rộng là
            phản ánh trung thực của cỡ mẫu.
          </li>
        </ol>
      </div>
    </div>
  );
};
