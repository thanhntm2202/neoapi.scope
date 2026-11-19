import React, { useEffect, useState } from 'react';

const DOCS = [
  { file: 'methodology.md', label: 'Khung lý thuyết & công thức' },
  { file: 'thresholds.md', label: 'Biện giải từng ngưỡng cảnh báo' },
  { file: 'validation_protocol.md', label: 'Giao thức kiểm chứng ngoài mẫu' },
  { file: 'limitations.md', label: 'Giới hạn & sử dụng có trách nhiệm' },
  { file: 'architecture.md', label: 'Kiến trúc hệ thống' },
  { file: 'references.md', label: 'Tài liệu tham khảo học thuật' },
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
