import type { OverviewData } from '../src/types';

export interface LhsWeights {
  tightness: number;
  depth: number;
  immediacy: number;
  stability: number;
  balance: number;
}

export interface WeightedLhsItem {
  symbol: string;
  group: string;
  baselineLhs: number;
  customLhs: number;
  baselineRank: number;
  customRank: number;
  rankDelta: number;
}

export function spearmanRankCorrelation(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;

  const rankArray = (arr: number[]): number[] => {
    const indexed = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array<number>(arr.length);
    let i = 0;
    while (i < indexed.length) {
      let j = i;
      while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) {
        j += 1;
      }
      const avgRank = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) {
        ranks[indexed[k].i] = avgRank;
      }
      i = j + 1;
    }
    return ranks;
  };

  const rx = rankArray(xs.slice(0, n));
  const ry = rankArray(ys.slice(0, n));

  const meanX = rx.reduce((a, b) => a + b, 0) / n;
  const meanY = ry.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = rx[i] - meanX;
    const dy = ry[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  if (den <= 1e-12) return 1;
  return num / den;
}

export function computeWeightedLhs(
  rowsAtT: Record<string, unknown>[],
  weights: LhsWeights,
): { items: WeightedLhsItem[]; spearmanVsBaseline: number | null } {
  const wTight = Math.max(0, weights.tightness);
  const wDepth = Math.max(0, weights.depth);
  const wImm = Math.max(0, weights.immediacy);
  const wStab = Math.max(0, weights.stability);
  const wBal = Math.max(0, weights.balance);
  const wSum = wTight + wDepth + wImm + wStab + wBal;

  const valid = rowsAtT.filter(
    (r) => typeof r.lhs === 'number' && Number.isFinite(r.lhs),
  );
  if (!valid.length) {
    return { items: [], spearmanVsBaseline: null };
  }

  const rawItems = valid.map((r) => {
    const rt = Number(r.r_tightness ?? 0);
    const rd = Number(r.r_depth ?? 0);
    const ri = Number(r.r_immediacy ?? 0);
    const rs = Number(r.r_stability ?? 0);
    const rb = Number(r.r_balance ?? 0);
    const baselineLhs = Number(r.lhs);
    const customLhs =
      wSum > 0
        ? (100 * (wTight * rt + wDepth * rd + wImm * ri + wStab * rs + wBal * rb)) / wSum
        : baselineLhs;
    return {
      symbol: String(r.symbol),
      group: String(r.group || 'large'),
      baselineLhs,
      customLhs,
    };
  });

  const byBase = [...rawItems].sort((a, b) => b.baselineLhs - a.baselineLhs);
  const byCustom = [...rawItems].sort((a, b) => b.customLhs - a.customLhs);

  const baseRankMap = new Map<string, number>();
  byBase.forEach((item, idx) => baseRankMap.set(item.symbol, idx + 1));

  const customRankMap = new Map<string, number>();
  byCustom.forEach((item, idx) => customRankMap.set(item.symbol, idx + 1));

  const items: WeightedLhsItem[] = byCustom.map((item) => {
    const bRank = baseRankMap.get(item.symbol) ?? 1;
    const cRank = customRankMap.get(item.symbol) ?? 1;
    return {
      ...item,
      baselineRank: bRank,
      customRank: cRank,
      rankDelta: bRank - cRank,
    };
  });

  const spearmanVsBaseline = spearmanRankCorrelation(
    rawItems.map((x) => x.baselineLhs),
    rawItems.map((x) => x.customLhs),
  );

  return { items, spearmanVsBaseline };
}

function medianNum(vals: number[]): number | null {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface SessionNarrative {
  headline: string;
  bullets: string[];
  caveat: string;
}

export function buildSessionNarrative(params: {
  session: string;
  mode: 'SYNTHETIC' | 'LIVE';
  watchlistRows: OverviewData['watchlistRows'];
  lhsRanking: Record<string, unknown>[];
  alertCount: number;
  rareCount: number;
  alertTypes: Record<string, number>;
}): SessionNarrative {
  const { session, mode, watchlistRows, lhsRanking, alertCount, rareCount, alertTypes } = params;

  const largeRows = watchlistRows.filter((r) => r.groupLabel === 'VN30 lớn');
  const thinRows = watchlistRows.filter((r) => r.groupLabel !== 'VN30 lớn');

  const medSpreadLarge = medianNum(
    largeRows.map((r) => r.spreadBps).filter((v): v is number => v !== null && Number.isFinite(v)),
  );
  const medSpreadThin = medianNum(
    thinRows.map((r) => r.spreadBps).filter((v): v is number => v !== null && Number.isFinite(v)),
  );
  const medDepthLarge = medianNum(
    largeRows.map((r) => r.depthBidB).filter((v): v is number => v !== null && Number.isFinite(v)),
  );
  const medDepthThin = medianNum(
    thinRows.map((r) => r.depthBidB).filter((v): v is number => v !== null && Number.isFinite(v)),
  );

  const sortedLhs = [...lhsRanking]
    .filter((r) => typeof r.lhs === 'number' && Number.isFinite(r.lhs))
    .sort((a, b) => Number(b.lhs) - Number(a.lhs));
  const topLhs = sortedLhs[0];
  const botLhs = sortedLhs[sortedLhs.length - 1];

  const topAlertEntry = Object.entries(alertTypes).sort((a, b) => b[1] - a[1])[0];

  const bullets: string[] = [];
  if (medSpreadLarge !== null && medSpreadThin !== null) {
    const ratio = medSpreadLarge > 0 ? (medSpreadThin / medSpreadLarge).toFixed(1) : '—';
    bullets.push(
      `Phân hóa chi phí tức thời: spread trung vị nhóm VN30 lớn đạt ${medSpreadLarge.toFixed(1)} bps, trong khi nhóm Midcap mỏng ở mức ${medSpreadThin.toFixed(1)} bps (rộng gấp ${ratio} lần).`,
    );
  }
  if (medDepthLarge !== null && medDepthThin !== null) {
    bullets.push(
      `Độ sâu bid 3 mức cuối phiên: VN30 lớn đạt trung vị ${medDepthLarge.toFixed(2)} tỷ đ/mã so với ${medDepthThin.toFixed(2)} tỷ đ/mã ở nhóm Midcap mỏng — cho thấy giới hạn hấp thụ lệnh kích thước lớn trên nhóm vốn hóa vừa.`,
    );
  }
  if (topLhs && botLhs) {
    bullets.push(
      `Phân hạng LHS tại lát cắt cuối phiên: dẫn đầu là ${String(topLhs.symbol)} (${Number(topLhs.lhs).toFixed(1)}/100) và thấp nhất là ${String(botLhs.symbol)} (${Number(botLhs.lhs).toFixed(1)}/100).`,
    );
  }
  if (alertCount > 0 && topAlertEntry) {
    bullets.push(
      `Giám sát bất thường ghi nhận ${alertCount} cảnh báo (trong đó ${rareCount} cảnh báo P1/P2 thuộc đuôi phân vị ≥ 99.5%); loại xuất hiện nhiều nhất là ${topAlertEntry[0]} (${topAlertEntry[1]} lần).`,
    );
  } else {
    bullets.push('Phiên không ghi nhận cảnh báo bất thường vượt ngưỡng thống kê đa biến theo bucket.');
  }

  return {
    headline: `Tổng hợp vi cấu trúc phiên ${session}`,
    bullets,
    caveat:
      mode === 'SYNTHETIC'
        ? 'Số liệu tóm tắt từ tập dữ liệu mô phỏng (Synthetic) nhằm kiểm chứng cơ chế định lượng, không phải nhận định thị trường thật.'
        : 'Số liệu tóm tắt dựa trên dữ liệu quan sát đã chuẩn hóa của nguồn live; không cấu thành khuyến nghị mua/bán.',
  };
}
