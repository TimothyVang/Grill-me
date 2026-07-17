// candle-lab-247 — dashboard (Val Town HTTP file)
// Open the deployed URL anytime to see recorded candles + the running paper-trade stats.
// Auto-refreshes every 60s. Reads the same SQLite the recorder writes.

import { sqlite } from "https://esm.town/v/std/sqlite/main.ts";
import { STRATEGY } from "./engine.ts";

const PRODUCTS = ["BTC-USD", "ETH-USD", "SOL-USD"];

export default async function (req: Request): Promise<Response> {
  const url = new URL(req.url);
  const sel = url.searchParams.get("product") || "BTC-USD";

  // ensure tables exist so the dashboard works before the first cron run
  await sqlite.execute(`CREATE TABLE IF NOT EXISTS candles (product TEXT, t INTEGER, o REAL, h REAL, l REAL, c REAL, PRIMARY KEY (product, t))`);
  await sqlite.execute(`CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, product TEXT, candle_count INTEGER, trades INTEGER, winrate REAL, expectancy REAL, net_r REAL, pf REAL)`);

  // latest run per product
  const latest: Record<string, any> = {};
  for (const p of PRODUCTS) {
    const r = await sqlite.execute({ sql: `SELECT * FROM runs WHERE product = ? ORDER BY ts DESC LIMIT 1`, args: [p] });
    if (r.rows.length) latest[p] = r.rows[0];
  }
  // candles + expectancy history for selected product
  const cRes = await sqlite.execute({ sql: `SELECT t,o,h,l,c FROM candles WHERE product = ? ORDER BY t DESC LIMIT 200`, args: [sel] });
  const candles = cRes.rows.map((r: any) => ({ t: Number(r.t), o: +r.o, h: +r.h, l: +r.l, c: +r.c })).reverse();
  const hRes = await sqlite.execute({ sql: `SELECT ts,expectancy FROM runs WHERE product = ? ORDER BY ts DESC LIMIT 80`, args: [sel] });
  const expHist = hRes.rows.map((r: any) => ({ ts: Number(r.ts), e: +r.expectancy })).reverse();

  const data = JSON.stringify({ sel, PRODUCTS, latest, candles, expHist, strategy: STRATEGY.name });

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="60"><title>candle-lab-247 · live paper playtest</title>
<script src="https://esm.town/v/std/catch"></script>
<style>
  :root{--bg:#0e1016;--panel:#161922;--panel2:#1d212b;--ink:#e9e6df;--soft:#a9a6a0;--faint:#726f6a;--hair:#242833;--acc:#cf9f52;--teal:#4fb0ad;--long:#57bd80;--short:#df7d78;--mono:ui-monospace,Menlo,Consolas,monospace;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;}
  *{box-sizing:border-box;} body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);}
  .wrap{max-width:960px;margin:0 auto;padding:22px 20px 60px;}
  h1{font-size:1.7rem;letter-spacing:-.02em;margin:0;}
  .k{font-family:var(--mono);font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;color:var(--faint);display:flex;align-items:center;gap:9px;margin-bottom:12px;}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--long);box-shadow:0 0 0 4px color-mix(in srgb,var(--long) 25%,transparent);}
  .sub{color:var(--soft);margin:.4em 0 0;font-size:.95rem;}
  .mono{font-family:var(--mono);font-variant-numeric:tabular-nums;}
  .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:18px 0;}
  @media(max-width:640px){.cards{grid-template-columns:1fr;}}
  .card{background:var(--panel);border:1px solid var(--hair);border-radius:14px;padding:15px 16px;text-decoration:none;color:inherit;}
  .card.sel{border-color:var(--acc);box-shadow:0 0 0 1px var(--acc);}
  .card h3{margin:0 0 8px;font-family:var(--mono);font-size:1rem;color:var(--acc);}
  .kv{display:flex;justify-content:space-between;font-family:var(--mono);font-size:.85rem;padding:2px 0;}
  .pos{color:var(--long);} .neg{color:var(--short);}
  .chart{background:var(--panel);border:1px solid var(--hair);border-radius:14px;padding:12px;margin-top:8px;}
  canvas{display:block;width:100%;height:auto;}
  .cl{font-size:.75rem;color:var(--faint);margin:2px 2px 8px;}
  .note{border:1px solid var(--hair);border-left:3px solid var(--teal);background:var(--panel);border-radius:12px;padding:13px 15px;margin-top:16px;font-size:.85rem;color:var(--soft);}
  .note b{color:var(--ink);}
</style></head><body><div class="wrap">
  <div class="k"><span class="dot"></span> live · updates every 15 min · paper only</div>
  <h1>candle-lab-247</h1>
  <p class="sub">Recording real candles 24/7 and continuously playtesting: <span class="mono" id="strat"></span></p>
  <div class="cards" id="cards"></div>
  <div class="chart"><div class="cl">Recorded candles — <span class="mono" id="selname"></span> (last 200)</div><canvas id="price" width="900" height="300"></canvas></div>
  <div class="chart"><div class="cl">Expectancy over time (each cron run) — is the edge stable or drifting?</div><canvas id="exp" width="900" height="140"></canvas></div>
  <div class="note"><b>This is paper, not prediction.</b> It backtests one fixed strategy on the candles collected so far. Expectancy will wander as data accumulates; a genuine edge stays positive over many runs and out-of-sample. Nothing here trades real money.</div>
</div>
<script>
const D = ${data};
const cv=(id)=>document.getElementById(id), css=(v)=>getComputedStyle(document.documentElement).getPropertyValue(v).trim();
document.getElementById('strat').textContent = D.strategy;
document.getElementById('selname').textContent = D.sel;
// cards
document.getElementById('cards').innerHTML = D.PRODUCTS.map(p=>{
  const r = D.latest[p];
  const exp = r? (+r.expectancy) : null;
  const ago = r? Math.round((Date.now()/1000 - r.ts)/60) : null;
  const cls = exp==null?'':(exp>0?'pos':(exp<0?'neg':''));
  return '<a class="card '+(p===D.sel?'sel':'')+'" href="?product='+p+'"><h3>'+p+'</h3>'+
    (r? (
      '<div class="kv"><span>Candles</span><b>'+r.candle_count+'</b></div>'+
      '<div class="kv"><span>Paper trades</span><b>'+r.trades+'</b></div>'+
      '<div class="kv"><span>Win rate</span><b>'+Math.round(r.winrate)+'%</b></div>'+
      '<div class="kv"><span>Expectancy</span><b class="'+cls+'">'+(exp>=0?'+':'−')+Math.abs(exp).toFixed(2)+'R</b></div>'+
      '<div class="kv"><span>Net</span><b class="'+(r.net_r>=0?'pos':'neg')+'">'+(r.net_r>=0?'+':'−')+Math.abs(r.net_r).toFixed(1)+'R</b></div>'+
      '<div class="kv"><span>Updated</span><b>'+ago+'m ago</b></div>'
    ) : '<div class="kv"><span>waiting for first cron run…</span></div>') + '</a>';
}).join('');
// price chart
(function(){ const c=cv('price'),x=c.getContext('2d'),DPR=Math.min(2,devicePixelRatio||1),w=c.clientWidth||880,h=300;
  c.width=w*DPR;c.height=h*DPR;x.setTransform(DPR,0,0,DPR,0,0);x.clearRect(0,0,w,h);
  const C=D.candles; if(!C.length){x.fillStyle=css('--faint');x.font='13px sans-serif';x.fillText('No candles yet — the cron will fill this in.',16,30);return;}
  let lo=1e18,hi=-1e18; C.forEach(k=>{lo=Math.min(lo,k.l);hi=Math.max(hi,k.h);}); if(lo===hi){lo*=.999;hi*=1.001;}
  const pad=10,padR=64,iw=w-pad-padR,ih=h-pad*2,N=C.length, X=i=>pad+(i+.5)*(iw/N), Y=p=>pad+(1-(p-lo)/(hi-lo))*ih;
  x.strokeStyle=css('--hair');x.fillStyle=css('--faint');x.font='10px '+css('--mono');
  for(let g=0;g<=4;g++){const p=lo+(hi-lo)*g/4,y=Y(p);x.globalAlpha=.5;x.beginPath();x.moveTo(pad,y);x.lineTo(w-padR,y);x.stroke();x.globalAlpha=1;x.fillText(p.toLocaleString('en-US',{maximumFractionDigits:p>=100?0:3}),w-padR+5,y+3);}
  const cw=Math.max(2,(iw/N)*.6);
  C.forEach((k,i)=>{const up=k.c>=k.o,col=up?css('--long'):css('--short'),xx=X(i);x.strokeStyle=col;x.lineWidth=1;x.beginPath();x.moveTo(xx,Y(k.h));x.lineTo(xx,Y(k.l));x.stroke();const yo=Y(k.o),yc=Y(k.c);x.fillStyle=col;x.fillRect(xx-cw/2,Math.min(yo,yc),cw,Math.max(1.5,Math.abs(yc-yo)));});
})();
// expectancy history
(function(){ const c=cv('exp'),x=c.getContext('2d'),DPR=Math.min(2,devicePixelRatio||1),w=c.clientWidth||880,h=140;
  c.width=w*DPR;c.height=h*DPR;x.setTransform(DPR,0,0,DPR,0,0);x.clearRect(0,0,w,h);
  const H=D.expHist; if(H.length<2){x.fillStyle=css('--faint');x.font='12px sans-serif';x.fillText('Needs a few cron runs to plot the trend.',16,24);return;}
  let lo=Math.min(...H.map(p=>p.e),0),hi=Math.max(...H.map(p=>p.e),0); if(lo===hi){lo-=.5;hi+=.5;}
  const pad=10,iw=w-pad*2,ih=h-pad*2, X=i=>pad+(i/(H.length-1))*iw, Y=e=>pad+(1-(e-lo)/(hi-lo))*ih;
  const zy=Y(0);x.strokeStyle=css('--hair');x.setLineDash([4,4]);x.beginPath();x.moveTo(pad,zy);x.lineTo(w-pad,zy);x.stroke();x.setLineDash([]);
  const last=H[H.length-1].e,col=last>=0?css('--long'):css('--short');
  x.beginPath();H.forEach((p,i)=>{const xx=X(i),yy=Y(p.e);i?x.lineTo(xx,yy):x.moveTo(xx,yy);});x.strokeStyle=col;x.lineWidth=2;x.stroke();
})();
</script></body></html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
