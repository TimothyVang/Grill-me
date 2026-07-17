# candle-lab-247 — 24/7 recorder + playtester (Val Town)

The browser tools in this toolkit only run while a tab is open. For a system that
records candles and re-runs the backtest **around the clock**, you need a server
that runs on a schedule in the cloud. This folder is that server, built for
[Val Town](https://val.town) (free tier works). It runs on its own — **no tokens,
no browser, no real trading. Paper only.**

## What it does

- **`recorder.ts`** (a Val Town *interval*/cron file) — every 15 minutes it fetches
  real candles (BTC/ETH/SOL, 5-minute) from Coinbase's keyless public API, stores
  them in SQLite, re-runs the confluence backtest over everything collected so far,
  and logs the stats. That's the continuous "playtest."
- **`dashboard.ts`** (a Val Town *HTTP* file) — a live web page showing each
  market's recorded candle count, paper-trade win rate, expectancy, net R, an
  expectancy-over-time trend, and a candle chart. Auto-refreshes every 60s.
- **`engine.ts`** — shared: `fetchCandles`, the indicators, and `runBacktest`.

The strategy is fixed (`STRATEGY` in `engine.ts`): a long confluence setup —
EMA 9 > 21 + Fibonacci golden zone + a rejection candle, exiting at 2R or a
0.5% stop. Edit that object to test a different rule set.

## Deploy it (about 2 minutes)

1. Go to [val.town](https://val.town) and sign in.
2. Create a new **project** (e.g. `candle-lab-247`).
3. Add three files, pasting the contents from this folder:
   - `engine.ts` — type **Script**
   - `recorder.ts` — type **Interval** (cron)
   - `dashboard.ts` — type **HTTP**
4. Set the **recorder** interval schedule to **every 15 minutes** (free-tier
   minimum). Run it once manually to seed data.
5. Open the **dashboard**'s HTTP URL — bookmark it. It updates itself 24/7.

That's it. It will keep recording and playtesting whether or not you're watching,
and it costs nothing on the free tier.

## Export to the other tools

The recorded candles live in the project's SQLite. To backtest them in the
`strategy-lab.html` or `auto-optimizer.html` tools, add a tiny HTTP endpoint that
`SELECT`s the `candles` table and returns CSV — or copy rows from the Val Town
SQLite viewer. (Ask and this can be added as `export-csv.ts`.)

## Honest note

This backtests **one fixed strategy** on the data collected so far. Expectancy
will drift as candles accumulate — that drift is information. A real edge stays
positive across many runs **and** out-of-sample (see `auto-optimizer.html`).
Recording and replaying candles predicts nothing; it just lets you watch a
strategy behave on real data, continuously, without risking a cent.
