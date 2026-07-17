// candle-lab-247 — recorder + playtester (Val Town INTERVAL / cron file)
// Runs 24/7 on a schedule: fetch live candles → store → re-run the backtest → log stats.
// Set the schedule to every 15 min (free tier minimum). Paper only, no real trading.

import { sqlite } from "https://esm.town/v/std/sqlite/main.ts";
import { fetchCandles, runBacktest, STRATEGY, type Candle } from "./engine.ts";

const PRODUCTS = ["BTC-USD", "ETH-USD", "SOL-USD"];
const GRANULARITY = 300; // 5-minute candles

export default async function (_interval: Interval) {
  await sqlite.execute(
    `CREATE TABLE IF NOT EXISTS candles (product TEXT, t INTEGER, o REAL, h REAL, l REAL, c REAL, PRIMARY KEY (product, t))`,
  );
  await sqlite.execute(
    `CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, product TEXT, candle_count INTEGER, trades INTEGER, winrate REAL, expectancy REAL, net_r REAL, pf REAL)`,
  );

  const now = Math.floor(Date.now() / 1000);

  for (const product of PRODUCTS) {
    try {
      const fresh = await fetchCandles(product, GRANULARITY);
      if (fresh.length) {
        await sqlite.batch(
          fresh.map((k) => ({
            sql:
              `INSERT INTO candles (product, t, o, h, l, c) VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT (product, t) DO UPDATE SET o = excluded.o, h = excluded.h, l = excluded.l, c = excluded.c`,
            args: [product, k.t, k.o, k.h, k.l, k.c],
          })),
        );
      }

      const res = await sqlite.execute({
        sql: `SELECT t, o, h, l, c FROM candles WHERE product = ? ORDER BY t`,
        args: [product],
      });
      const all: Candle[] = res.rows.map((r: any) => ({
        t: Number(r.t), o: Number(r.o), h: Number(r.h), l: Number(r.l), c: Number(r.c),
      }));

      const s = runBacktest(all, STRATEGY);
      await sqlite.execute({
        sql: `INSERT INTO runs (ts, product, candle_count, trades, winrate, expectancy, net_r, pf)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [now, product, all.length, s.n, s.winrate, s.expectancy, s.net, isFinite(s.pf) ? s.pf : 9999],
      });

      console.log(`${product}: ${all.length} candles, ${s.n} paper trades, expectancy ${s.expectancy.toFixed(3)}R`);
    } catch (e) {
      console.error(`${product} failed:`, String(e));
    }
  }
}
