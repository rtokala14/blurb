export const fmtScore = (v: number) => (v * 100).toFixed(0);
export const fmtScore1 = (v: number) => (v * 100).toFixed(1);
export const fmtWeight = (w: number) => (Number.isInteger(w) ? String(w) : w.toFixed(1));
export const fmtPts = (v: number) => (v >= 10 ? v.toFixed(0) : v.toFixed(1));
