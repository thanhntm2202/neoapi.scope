import React, { useEffect, useState } from 'react';

const DOCS = [
  { file: 'methodology.md', label: 'Khung lý thuyết & công thức' },
  { file: 'thresholds.md', label: 'Biện giải từng ngưỡng cảnh báo' },
  { file: 'validation_protocol.md', label: 'Giao thức kiểm chứng ngoài mẫu' },
  { file: 'limitations.md', label: 'Giới hạn & sử dụng có trách nhiệm' },
  { file: 'architecture.md', label: 'Kiến trúc hệ thống' },
  { file: 'references.md', label: 'Tài liệu tham khảo học thuật' },
];

const PIPELINE_STAGES = [
  {
    step: '01',
    title: 'Thu thập & Giới hạn tốc độ',
    detail: 'SSI FastConnect API v3 (REST + WS) / NEO dự phòng · TokenBucket 5 req/s',
  },
  {
    step: '02',
    title: 'RAW Append-Only & Manifest',
    detail: 'JSONL.gz nguyên bản + SHA-256 checksum + config_hash + seed tái lập',
  },
  {
    step: '03',
    title: 'Chuẩn hóa & Cờ chất lượng',
    detail: 'Gắn cờ ATO/ATC, crossed book, clock skew UTC+7, loại trùng lặp',
  },
  {
    step: '04',
    title: 'Curated & Vi cấu trúc',
    detail: 'Resample 5s snapshots & 1m bars · tính Spread, OBI, ILLIQ, độ sâu 3 mức',
  },
  {
    step: '05',
    title: 'Chỉ số LHS & Cảnh báo MAD',
    detail: '5 cấu phần LHS (0–100) · Robust Z-score MAD (1.4826) P1/P2/P3',
  },
  {
    step: '06',
    title: 'Implementation Shortfall',
    detail: 'Quét sổ 3 mức + phần dư √τ · chia nhỏ 1/2/4/8 đợt + phí/thuế VN',
  },
  {
    step: '07',
    title: 'Kiểm chứng ngoài mẫu',
    detail: 'Walk-forward 5 folds · Bootstrap cụm phiên · Wilson CI95 (không rò rỉ)',
  },
];

export const MethodologyPage: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<string>(DOCS[0].file);
  const [html, setHtml] = useState<string>('');
  const [err, setErr] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    setErr('');
    fetch(`/api/docs/${encodeURIComponent(selectedFile)}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Không tải được tài liệu');
        return d;
      })
      .then((d) => {
        if (!cancelled) setHtml(d.html || '');
      })
      .catch((e) => {
        if (!cancelled) setErr(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedFile]);

  return (
    <div>
      <h2 className="page-subheader">
        Phương pháp &amp; giới hạn — toàn bộ công thức, ngưỡng và lý do
      </h2>
      <p className="page-caption">
        Tài liệu được viết thành các mục ngắn để tra cứu khi cần; các kết quả chính vẫn nằm ở từng
        màn hình phân tích.
      </p>

      <div className="card-panel" id="architecture-pipeline-card" style={{ marginBottom: 14 }}>
        <div className="narrative-head" style={{ marginBottom: 10 }}>
          <span className="narrative-badge">Kiến trúc hệ thống</span>
          <h4 className="narrative-title">
            Chuỗi xử lý 7 lớp từ API thị trường đến bằng chứng ngoài mẫu (Data-to-Value Pipeline)
          </h4>
        </div>
        <div className="arch-pipeline-grid">
          {PIPELINE_STAGES.map((st) => (
            <div key={st.step} className="arch-stage-card">
              <div className="arch-stage-num mono">{st.step}</div>
              <div className="arch-stage-title">{st.title}</div>
              <div className="arch-stage-desc">{st.detail}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 420, marginBottom: 14 }}>
        <label className="field-label">Chọn mục tài liệu</label>
        <select
          className="select-input"
          value={selectedFile}
          onChange={(e) => setSelectedFile(e.target.value)}
        >
          {DOCS.map((d) => (
            <option key={d.file} value={d.file}>
              {d.label}
            </option>
          ))}
        </select>
      </div>

      <div className="card-panel">
        {err ? (
          <div className="callout warning">{err}</div>
        ) : (
          <div className="doc-markdown" dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>
    </div>
  );
};
