import React, { useEffect } from 'react';
import { BookOpen, HelpCircle, X } from 'lucide-react';

interface GlossaryModalProps {
  open: boolean;
  onClose: () => void;
  onJumpToPage?: (page: 'overview' | 'liquidity' | 'execution-cost' | 'alerts' | 'validation' | 'data-quality' | 'methodology') => void;
}

const TERMS: { code: string; name: string; formula: string; meaning: string }[] = [
  {
    code: 'Spread (bps)',
    name: 'Chênh lệch giá mua–bán (Quoted vs Effective)',
    formula: 'Quoted = 10⁴ × (ask₁ − bid₁) / mid · Effective = 2×10⁴ × |P_last − mid| / mid',
    meaning: 'Chi phí tức thời phải trả để khớp ngay. 1 bps = 0.01% (= 100đ trên cổ phiếu giá 100,000đ).',
  },
  {
    code: 'Depth 3 mức',
    name: 'Độ sâu sổ lệnh hiển thị (Bid / Ask Depth)',
    formula: 'Σ(pᵢ × volᵢ), i = 1..3 (đơn vị: tỷ VND)',
    meaning: 'Tổng lượng tiền chờ mua/bán ở 3 bước giá tốt nhất. Mức dưới 0.5 tỷ khiến lệnh lớn nhanh chóng "thủng sổ".',
  },
  {
    code: 'OBI',
    name: 'Mất cân bằng sổ lệnh (Order Book Imbalance)',
    formula: '(V_bid − V_ask) / (V_bid + V_ask) ∈ [−1, +1]',
    meaning: 'OBI > 0 nghĩa là khối lượng chờ mua áp đảo chờ bán (dự báo áp lực tăng giá ngắn hạn theo Cont et al. 2014).',
  },
  {
    code: 'LHS (0–100)',
    name: 'Liquidity Health Score (5 cấu phần trượt 15 phút)',
    formula: '100 × Σ wₖ · rank_pct(cấu phần k) / Σ wₖ',
    meaning: 'Điểm sức khỏe tương đối chéo watchlist trên 5 chiều: Độ chặt, Độ sâu, Tức thời (ILLIQ), Ổn định, Cân bằng OBI.',
  },
  {
    code: 'IS (bps)',
    name: 'Implementation Shortfall (Perold 1988)',
    formula: 'side × 10⁴ × (VWAP_thực_thi − mid_lúc_đến) / mid_lúc_đến',
    meaning: 'Tổng trượt giá thực tế so với giá giữa lúc ra quyết định. Gồm quét 3 mức trong sổ + phần dư trôi theo κ·OBI và rủi ro √τ.',
  },
  {
    code: 'Liquidity Beta',
    name: 'Hệ số nhạy thanh khoản hệ thống (Commonality)',
    formula: 'βᵢ = Cov(Δln(Depthᵢ), Δln(Depth_thị_trường)) / Var(Δln(Depth_thị_trường))',
    meaning: 'Đo mức độ đồng biến độ sâu của mã với thị trường (Chordia–Roll–Subrahmanyam 2000). β > 1 dễ cạn thanh khoản cùng lúc khi thị trường sốc.',
  },
];

const WORKFLOW_STEPS: {
  step: string;
  bloom: string;
  title: string;
  desc: string;
  target: 'overview' | 'liquidity' | 'execution-cost' | 'alerts' | 'validation' | 'data-quality';
  cta: string;
}[] = [
  {
    step: 'Bước 1',
    bloom: 'Hiểu & Phân tích',
    title: 'Đọc nhịp thanh khoản phiên & U-Shape nội ngày',
    desc: 'Soi bảng giá, băng giao dịch UTC+7, cấu phần LHS và khung giờ chữ U để tránh đặt lệnh vào lúc spread giãn rộng.',
    target: 'liquidity',
    cta: 'Mở Thanh khoản →',
  },
  {
    step: 'Bước 2',
    bloom: 'Áp dụng & Sáng tạo',
    title: 'Mô phỏng chi phí lệnh, chia đợt & Stress danh mục',
    desc: 'Kiểm tra sổ 3 mức, so sánh 1/2/4/8 đợt chia nhỏ, tải Execution Playbook và đo thiệt hại khi độ sâu giảm 50%.',
    target: 'execution-cost',
    cta: 'Mở Mô phỏng chi phí →',
  },
  {
    step: 'Bước 3',
    bloom: 'Đánh giá & Kiểm chứng',
    title: 'Kiểm chứng OOS, Threshold Lab & Thử lỗi Chaos',
    desc: 'Đối chiếu Calibration Curve, Top ca sai số cực trị, tinh chỉnh ngưỡng cảnh báo và kiểm thử resilience 429 / stale gap.',
    target: 'validation',
    cta: 'Mở Kiểm chứng →',
  },
];

export const GlossaryModal: React.FC<GlossaryModalProps> = ({ open, onClose, onJumpToPage }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="tv-palette-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Từ điển vi cấu trúc và quy trình nghiên cứu NeoScope"
      onClick={onClose}
    >
      <div className="glossary-modal" onClick={(e) => e.stopPropagation()}>
        <div className="glossary-modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <BookOpen size={17} color="#29b6f6" />
            <div>
              <h3 style={{ margin: 0, fontSize: 15.5, color: '#f0f3fa' }}>
                Từ điển Vi cấu trúc &amp; Quy trình Phân tích 3 Bước
              </h3>
              <div style={{ fontSize: 11.5, color: '#8f98ad', marginTop: 2 }}>
                Giải thích công thức chuẩn hóa, quy ước bps (1 bps = 0.01%) và luồng sử dụng theo thang Bloom
              </div>
            </div>
          </div>
          <button type="button" className="tv-tool-btn" onClick={onClose} aria-label="Đóng từ điển">
            <X size={13} /> Esc
          </button>
        </div>

        <div className="glossary-modal-body">
          <div className="glossary-workflow-grid">
            {WORKFLOW_STEPS.map((w) => (
              <div key={w.step} className="glossary-step-card">
                <div className="glossary-step-top">
                  <span className="glossary-step-num">{w.step}</span>
                  <span className="glossary-step-bloom">{w.bloom}</span>
                </div>
                <div className="glossary-step-title">{w.title}</div>
                <div className="glossary-step-desc">{w.desc}</div>
                {onJumpToPage && (
                  <button
                    type="button"
                    className="quick-action-btn"
                    style={{ alignSelf: 'flex-start', marginTop: 'auto' }}
                    onClick={() => {
                      onJumpToPage(w.target);
                      onClose();
                    }}
                  >
                    {w.cta}
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="glossary-terms-grid">
            {TERMS.map((t) => (
              <div key={t.code} className="glossary-term-card">
                <div className="glossary-term-head">
                  <span className="mono glossary-term-code">{t.code}</span>
                  <span className="glossary-term-name">{t.name}</span>
                </div>
                <div className="mono glossary-term-formula">{t.formula}</div>
                <div className="glossary-term-meaning">{t.meaning}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export const TermHelpButton: React.FC<{ onClick: () => void; label?: string }> = ({
  onClick,
  label = 'Từ điển & Quy trình (?)',
}) => (
  <button type="button" className="btn btn-full glossary-trigger-btn" onClick={onClick}>
    <HelpCircle size={14} />
    <span>{label}</span>
  </button>
);
