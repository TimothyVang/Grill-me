// candle-lab-247 — shared engine
// Fetch real candles from Coinbase + backtest the confluence strategy. Paper only.
// Runs on Val Town (Deno). No API key, no real trading.

export type Candle = { t: number; o: number; h: number; l: number; c: number };

export const STRATEGY = {
  name: "Confluence long: EMA9>21 + Fib golden zone + rejection candle → 2R / 0.5% stop",
  direction: "long" as const,
  entry: {
    trend: { on: true, fast: 9, slow: 21 },
    fib: { on: true, lookback: 20 },
    candle: { on: true, type: "rejection" },
    rsi: { on: false, len: 14, op: "lt", val: 40 },
  },
  exit: { target: 2, targetUnit: "R", stop: 0.5, stopUnit: "pct", maxHold: 40 },
};

// ---- live data (Coinbase public API, keyless) ----
export async function fetchCandles(product: string, granularity: number): Promise<Candle[]> {
  const url = `https://api.exchange.coinbase.com/products/${product}/candles?granularity=${granularity}`;
  const r = await fetch(url, { headers: { "User-Agent": "candle-lab-247" } });
  if (!r.ok) throw new Error(`coinbase ${product} HTTP ${r.status}`);
  // [ time, low, high, open, close, volume ], newest first
  const raw = (await r.json()) as number[][];
  return raw
    .map((k) => ({ t: k[0], o: k[3], h: k[2], l: k[1], c: k[4] }))
    .sort((a, b) => a.t - b.t);
}

// ---- indicators ----
function ema(a: number[], len: number): number[] {
  const k = 2 / (len + 1); const o: number[] = []; let p = a[0];
  for (let i = 0; i < a.length; i++) { p = i ? a[i] * k + p * (1 - k) : a[0]; o.push(p); }
  return o;
}
function candleOK(C: Candle[], i: number, type: string, dir: number): boolean {
  const o = C[i].o, h = C[i].h, l = C[i].l, c = C[i].c;
  const body = Math.abs(c - o) || 1e-9, upW = h - Math.max(o, c), loW = Math.min(o, c) - l;
  if (type === "rejection") return dir > 0 ? loW >= body * 1.2 : upW >= body * 1.2;
  if (type === "hammer") return dir > 0 ? (loW >= body * 2 && upW <= body * 0.6) : (upW >= body * 2 && loW <= body * 0.6);
  if (type === "engulf") { if (i < 1) return false; const po = C[i - 1].o, pc = C[i - 1].c;
    return dir > 0 ? (c > o && pc < po && c >= po && o <= pc) : (c < o && pc > po && c <= po && o >= pc); }
  return true;
}
function fibOK(C: Candle[], i: number, lb: number, dir: number): boolean {
  if (i < lb) return false;
  let H = -Infinity, L = Infinity;
  for (let k = i - lb; k < i; k++) { if (C[k].h > H) H = C[k].h; if (C[k].l < L) L = C[k].l; }
  const rng = H - L; if (rng <= 0) return false;
  if (dir > 0) { const pLow = H - 0.72 * rng, pHigh = H - 0.5 * rng; return C[i].l <= pHigh && C[i].c >= pLow; }
  const b50 = L + 0.5 * rng, b72 = L + 0.72 * rng; return C[i].h >= b50 && C[i].c <= b72;
}

export type Stats = { n: number; winrate: number; expectancy: number; net: number; pf: number };

// ---- backtest (paper) ----
export function runBacktest(C: Candle[], cfg = STRATEGY): Stats {
  const dir = cfg.direction === "long" ? 1 : -1;
  const closes = C.map((x) => x.c);
  const ef = ema(closes, cfg.entry.trend.fast), es = ema(closes, cfg.entry.trend.slow);
  const warm = Math.max(cfg.entry.trend.slow, cfg.entry.fib.lookback) + 1;
  const R: number[] = [];
  let i = warm;
  while (i < C.length) {
    let ok = true;
    if (cfg.entry.trend.on) ok = ok && (dir > 0 ? ef[i] > es[i] : ef[i] < es[i]);
    if (ok && cfg.entry.fib.on) ok = ok && fibOK(C, i, cfg.entry.fib.lookback, dir);
    if (ok && cfg.entry.candle.on) ok = ok && candleOK(C, i, cfg.entry.candle.type, dir);
    if (!ok) { i++; continue; }
    const entry = C[i].c;
    const stopDist = cfg.exit.stopUnit === "pct" ? entry * cfg.exit.stop / 100 : cfg.exit.stop;
    if (stopDist <= 0) { i++; continue; }
    const tgtDist = cfg.exit.targetUnit === "R" ? cfg.exit.target * stopDist : entry * cfg.exit.target / 100;
    const stopP = dir > 0 ? entry - stopDist : entry + stopDist;
    const tgtP = dir > 0 ? entry + tgtDist : entry - tgtDist;
    let exitP: number | null = null, exitBar = -1;
    for (let j = i + 1; j < C.length && j <= i + cfg.exit.maxHold; j++) {
      const hi = C[j].h, lo = C[j].l;
      if (dir > 0) { if (lo <= stopP) { exitP = stopP; exitBar = j; break; } if (hi >= tgtP) { exitP = tgtP; exitBar = j; break; } }
      else { if (hi >= stopP) { exitP = stopP; exitBar = j; break; } if (lo <= tgtP) { exitP = tgtP; exitBar = j; break; } }
    }
    if (exitP == null) { exitBar = Math.min(i + cfg.exit.maxHold, C.length - 1); exitP = C[exitBar].c; }
    R.push(dir > 0 ? (exitP - entry) / stopDist : (entry - exitP) / stopDist);
    i = exitBar + 1;
  }
  const n = R.length;
  if (!n) return { n: 0, winrate: 0, expectancy: 0, net: 0, pf: 0 };
  let wins = 0, gW = 0, gL = 0, sum = 0;
  for (const r of R) { sum += r; if (r > 0) { wins++; gW += r; } else if (r < 0) gL += -r; }
  return { n, winrate: wins / n * 100, expectancy: sum / n, net: sum, pf: gL > 0 ? gW / gL : (gW > 0 ? Infinity : 0) };
}
