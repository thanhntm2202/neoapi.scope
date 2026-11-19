export interface LhsWeightVector {
  tightness: number;
  depth: number;
  immediacy: number;
  stability: number;
  balance: number;
}

export interface LhsPreset {
  id: string;
  label: string;
  weights: LhsWeightVector;
}

export const LHS_PRESETS: LhsPreset[] = [
  { id: 'equal', label: 'Cân bằng gốc (1:1:1:1:1)', weights: { tightness: 1, depth: 1, immediacy: 1, stability: 1, balance: 1 } },
  { id: 'tightness', label: 'Ưu tiên Spread chặt', weights: { tightness: 3, depth: 1, immediacy: 1, stability: 1.5, balance: 1 } },
  { id: 'depth', label: 'Ưu tiên Độ sâu lệnh lớn', weights: { tightness: 1, depth: 3, immediacy: 2, stability: 1, balance: 1 } },
  { id: 'imbalance', label: 'Nhạy mất cân bằng OBI', weights: { tightness: 1, depth: 1.5, immediacy: 1, stability: 1, balance: 3 } },
];

export interface HypothesisRow {
  symbol: string;
  group: string;
  baselineLhs: number;
  customLhs: number;
  baselineRank: number;
  customRank: number;
  rankDelta: number;
}

export function spearmanCorr(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;

  const toRanks = (arr: number[]): number[] => {
    const indexed = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array<number>(arr.length);
    let i = 0;
    while (i < indexed.length) {
      let j = i;
      while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j += 1;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[indexed[k].i] = avg;
      i = j + 1;
    }
    return ranks;
  };

  const rx = toRanks(xs.slice(0, n));
  const ry = toRanks(ys.slice(0, n));
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = rx[i] - mx;
    const dy = ry[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  return den <= 1e-12 ? 1 : num / den;
}

export function computeHypothesisLhs(
  rowsAtT: Record<string, unknown>[],
  weights: LhsWeightVector,
): { rows: HypothesisRow[]; spearman: number | null } {
  const wTight = Math.max(0, weights.tightness);
  const wDepth = Math.max(0, weights.depth);
  const wImm = Math.max(0, weights.immediacy);
  const wStab = Math.max(0, weights.stability);
  const wBal = Math.max(0, weights.balance);
  const wSum = wTight + wDepth + wImm + wStab + wBal;

  const valid = rowsAtT.filter((r) => typeof r.lhs === 'number' && Number.isFinite(r.lhs));
  if (!valid.length) return { rows: [], spearman: null };

  const raw = valid.map((r) => {
    const baselineLhs = Number(r.lhs);
    const customLhs =
      wSum > 0
        ? (100 *
            (wTight * Number(r.r_tightness ?? 0) +
              wDepth * Number(r.r_depth ?? 0) +
              wImm * Number(r.r_immediacy ?? 0) +
              wStab * Number(r.r_stability ?? 0) +
              wBal * Number(r.r_balance ?? 0))) /
          wSum
        : baselineLhs;
    return {
      symbol: String(r.symbol),
      group: String(r.group || 'large'),
      baselineLhs,
      customLhs,
    };
  });

  const baseSorted = [...raw].sort((a, b) => b.baselineLhs - a.baselineLhs);
  const custSorted = [...raw].sort((a, b) => b.customLhs - a.customLhs);

  const baseRank = new Map<string, number>();
  baseSorted.forEach((x, idx) => baseRank.set(x.symbol, idx + 1));

  const custRank = new Map<string, number>();
  custSorted.forEach((x, idx) => custRank.set(x.symbol, idx + 1));

  const rows: HypothesisRow[] = custSorted.map((x) => {
    const bR = baseRank.get(x.symbol) ?? 1;
    const cR = custRank.get(x.symbol) ?? 1;
    return {
      ...x,
      baselineRank: bR,
      customRank: cR,
      rankDelta: bR - cR,
    };
  });

  return {
    rows,
    spearman: spearmanCorr(
      raw.map((x) => x.baselineLhs),
      raw.map((x) => x.customLhs),
    ),
  };
}
