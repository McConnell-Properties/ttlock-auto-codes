"""
Dashboard generator — reads the SQLite data via metrics.build_summary() and writes
a single self-contained dashboard.html (data embedded, Chart.js from CDN).

Run:  python build_dashboard.py
Output: ./dashboard.html
"""

import argparse
import json
import os

from metrics import build_summary

HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(HERE, "data", "beds24.db")
OUT_PATH = os.path.join(HERE, "dashboard.html")
VENDOR_JS = os.path.join(HERE, "vendor", "chart.umd.js")

TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Beds24 Channel Dashboard</title>
<script src="vendor/chart.umd.js"></script>
<style>
  :root{
    --bg:#0f1419; --panel:#1a2029; --panel2:#222b36; --line:#2c3744;
    --text:#e6edf3; --muted:#8b98a5; --accent:#4f9cf9; --green:#3fb950;
    --red:#f85149; --amber:#d29922; --chip:#2d3742;
  }
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
       background:var(--bg);color:var(--text);font-size:14px}
  header{padding:18px 24px;border-bottom:1px solid var(--line);display:flex;
         align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:8px}
  header h1{font-size:18px;margin:0;font-weight:600}
  header .meta{color:var(--muted);font-size:12px}
  .tabs{display:flex;gap:4px;padding:12px 24px 0;flex-wrap:wrap}
  .tab{padding:8px 16px;border-radius:8px 8px 0 0;cursor:pointer;color:var(--muted);
       border:1px solid transparent;border-bottom:none;user-select:none}
  .tab.active{background:var(--panel);color:var(--text);border-color:var(--line)}
  main{padding:20px 24px 60px}
  .view{display:none}
  .view.active{display:block}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:22px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px}
  .card .label{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em}
  .card .value{font-size:26px;font-weight:600;margin-top:6px}
  .card .sub{color:var(--muted);font-size:12px;margin-top:4px}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:20px}
  .panel h2{font-size:14px;margin:0 0 14px;font-weight:600;color:var(--text)}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line)}
  th{color:var(--muted);font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.03em}
  tr:hover td{background:var(--panel2)}
  .chip{display:inline-block;padding:2px 9px;border-radius:999px;background:var(--chip);font-size:11px}
  .pos{color:var(--green)} .neg{color:var(--red)} .num{text-align:right;font-variant-numeric:tabular-nums}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:20px}
  @media(max-width:820px){.grid2{grid-template-columns:1fr}}
  canvas{max-height:320px}
  .muted{color:var(--muted)}
  .pill{font-size:11px;padding:1px 7px;border-radius:6px}
  .pill.confirmed{background:rgba(63,185,80,.15);color:var(--green)}
  .pill.new{background:rgba(79,156,249,.15);color:var(--accent)}
  .pill.request{background:rgba(210,153,34,.15);color:var(--amber)}
  .pill.cancelled,.pill.black{background:rgba(248,81,73,.12);color:var(--red)}
</style>
</head>
<body>
<header>
  <h1>Beds24 Channel Dashboard</h1>
  <div class="meta">
    Data fetched: <span id="lastFetch"></span> · Built: <span id="builtAt"></span> · <span id="propCount"></span>
  </div>
</header>
<div class="tabs">
  <div class="tab active" data-view="occupancy">Occupancy &amp; Calendar</div>
  <div class="tab" data-view="revenue">Revenue &amp; RevPAR</div>
  <div class="tab" data-view="feed">Bookings Feed</div>
  <div class="tab" data-view="pace">Pace &amp; Pickup</div>
</div>
<main>
  <!-- OCCUPANCY -->
  <section class="view active" id="view-occupancy">
    <div class="cards" id="occCards"></div>
    <div class="panel"><h2>Monthly occupancy</h2><canvas id="occChart"></canvas></div>
  </section>
  <!-- REVENUE -->
  <section class="view" id="view-revenue">
    <div class="cards" id="revCards"></div>
    <div class="grid2">
      <div class="panel"><h2>Monthly revenue &amp; RevPAR</h2><canvas id="revChart"></canvas></div>
      <div class="panel"><h2>Channel mix (revenue, YTD)</h2><canvas id="chanChart"></canvas></div>
    </div>
    <div class="panel"><h2>Channel breakdown (YTD)</h2>
      <table id="chanTable"><thead><tr><th>Channel</th><th class="num">Bookings</th>
      <th class="num">Nights</th><th class="num">Revenue</th><th class="num">Share</th></tr></thead>
      <tbody></tbody></table>
    </div>
  </section>
  <!-- FEED -->
  <section class="view" id="view-feed">
    <div class="panel"><h2>Upcoming &amp; recent bookings</h2>
      <table id="feedTable"><thead><tr><th>Arrival</th><th>Guest</th><th>Property</th>
      <th>Nights</th><th>Channel</th><th class="num">Value</th><th>Status</th></tr></thead>
      <tbody></tbody></table>
    </div>
  </section>
  <!-- PACE -->
  <section class="view" id="view-pace">
    <div class="cards" id="paceCards"></div>
    <div class="grid2">
      <div class="panel"><h2>On-the-books: next 90 days vs last year</h2><canvas id="paceChart"></canvas></div>
      <div class="panel"><h2>Booking lead time</h2><canvas id="leadChart"></canvas></div>
    </div>
  </section>
</main>
<script>
const DATA = __DATA__;
const CUR = DATA.currency || "";
const money = v => CUR + (v==null?0:v).toLocaleString(undefined,{maximumFractionDigits:0});
const pct = v => (v*100).toFixed(1) + "%";

document.getElementById("lastFetch").textContent = DATA.last_fetch || "—";
document.getElementById("builtAt").textContent = DATA.generated_at || "—";
document.getElementById("propCount").textContent =
  DATA.counts.properties + " properties · " + DATA.counts.bookings + " bookings";

// tabs
document.querySelectorAll(".tab").forEach(t=>t.onclick=()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));
  t.classList.add("active");
  document.getElementById("view-"+t.dataset.view).classList.add("active");
});

function card(label,value,sub){
  return `<div class="card"><div class="label">${label}</div>
          <div class="value">${value}</div><div class="sub">${sub||""}</div></div>`;
}

// ---- Occupancy ----
const tm = DATA.kpi_this_month, n30 = DATA.kpi_next_30, n90 = DATA.kpi_next_90;
document.getElementById("occCards").innerHTML =
  card("Occupancy (this month)", pct(tm.occupancy), `${tm.sold_room_nights}/${tm.available_room_nights} room-nights`)
+ card("Occupancy (next 30d)", pct(n30.occupancy), `${n30.sold_room_nights} nights sold`)
+ card("Occupancy (next 90d)", pct(n90.occupancy), `${n90.sold_room_nights} nights sold`)
+ card("Room capacity", DATA.room_capacity, "sellable units");

new Chart(document.getElementById("occChart"),{
  type:"bar",
  data:{labels:DATA.monthly.map(m=>m.label),
    datasets:[{label:"Occupancy %",data:DATA.monthly.map(m=>+(m.occupancy*100).toFixed(1)),
      backgroundColor:DATA.monthly.map(m=> m.month>=new Date().toISOString().slice(0,7)+"-01" ? "#4f9cf9":"#3a5573")}]},
  options:{plugins:{legend:{display:false}},scales:{y:{ticks:{color:"#8b98a5",callback:v=>v+"%"},grid:{color:"#2c3744"},max:100},
    x:{ticks:{color:"#8b98a5"},grid:{display:false}}}}
});

// ---- Revenue ----
document.getElementById("revCards").innerHTML =
  card("Revenue (this month)", money(tm.revenue), "active bookings")
+ card("ADR (this month)", money(tm.adr), "avg daily rate")
+ card("RevPAR (this month)", money(tm.revpar), "rev / available night")
+ card("Revenue (next 90d)", money(n90.revenue), "on the books");

new Chart(document.getElementById("revChart"),{
  data:{labels:DATA.monthly.map(m=>m.label),
    datasets:[
      {type:"bar",label:"Revenue",data:DATA.monthly.map(m=>m.revenue),backgroundColor:"#3a5573",yAxisID:"y"},
      {type:"line",label:"RevPAR",data:DATA.monthly.map(m=>m.revpar),borderColor:"#4f9cf9",backgroundColor:"#4f9cf9",yAxisID:"y1",tension:.3}
    ]},
  options:{plugins:{legend:{labels:{color:"#8b98a5"}}},
    scales:{y:{position:"left",ticks:{color:"#8b98a5"},grid:{color:"#2c3744"}},
      y1:{position:"right",ticks:{color:"#8b98a5"},grid:{display:false}},
      x:{ticks:{color:"#8b98a5"},grid:{display:false}}}}
});

const chan = DATA.channel_mix;
const chanTotal = chan.reduce((s,c)=>s+c.revenue,0)||1;
new Chart(document.getElementById("chanChart"),{
  type:"doughnut",
  data:{labels:chan.map(c=>c.channel),
    datasets:[{data:chan.map(c=>c.revenue),
      backgroundColor:["#4f9cf9","#3fb950","#d29922","#f85149","#a371f7","#39c5cf","#db61a2","#6e7681"]}]},
  options:{plugins:{legend:{position:"right",labels:{color:"#8b98a5",boxWidth:12}}}}
});
document.querySelector("#chanTable tbody").innerHTML = chan.map(c=>
  `<tr><td>${c.channel}</td><td class="num">${c.bookings}</td><td class="num">${c.nights}</td>
   <td class="num">${money(c.revenue)}</td><td class="num">${(c.revenue/chanTotal*100).toFixed(1)}%</td></tr>`).join("")
  || `<tr><td colspan="5" class="muted">No channel data yet</td></tr>`;

// ---- Feed ----
document.querySelector("#feedTable tbody").innerHTML = DATA.feed.map(b=>{
  const st=(b.status||"").toLowerCase();
  const when = b.days_until===0?"today":(b.days_until>0?`in ${b.days_until}d`:`${-b.days_until}d ago`);
  return `<tr><td>${b.arrival||"—"}<div class="muted" style="font-size:11px">${when}</div></td>
    <td>${b.guest}</td><td>${b.property??"—"}</td><td>${b.nights??"—"}</td>
    <td><span class="chip">${b.channel}</span></td><td class="num">${money(b.price)}</td>
    <td><span class="pill ${st}">${b.status||"—"}</span></td></tr>`;
}).join("") || `<tr><td colspan="7" class="muted">No bookings in range</td></tr>`;

// ---- Pace ----
const p=DATA.pace, ty=p.this_year, ly=p.last_year;
const deltaCls = (p.revenue_delta>=0)?"pos":"neg";
const deltaSign = (p.revenue_delta>=0)?"+":"";
document.getElementById("paceCards").innerHTML =
  card("Revenue next 90d", money(ty.revenue), "on the books now")
+ card("Same window last yr", money(ly.revenue), "for comparison")
+ card("Pace vs last year", `<span class="${deltaCls}">${deltaSign}${money(p.revenue_delta)}</span>`,
       p.revenue_delta_pct==null?"":`${deltaSign}${p.revenue_delta_pct}%`)
+ card("Bookings next 90d", ty.bookings, `vs ${ly.bookings} last year`);

new Chart(document.getElementById("paceChart"),{
  type:"bar",
  data:{labels:["Revenue","Nights sold","Bookings"],
    datasets:[
      {label:"This year",data:[ty.revenue,ty.sold_room_nights,ty.bookings],backgroundColor:"#4f9cf9"},
      {label:"Last year",data:[ly.revenue,ly.sold_room_nights,ly.bookings],backgroundColor:"#6e7681"}
    ]},
  options:{plugins:{legend:{labels:{color:"#8b98a5"}}},
    scales:{y:{ticks:{color:"#8b98a5"},grid:{color:"#2c3744"}},x:{ticks:{color:"#8b98a5"},grid:{display:false}}}}
});

const lt=DATA.lead_time;
new Chart(document.getElementById("leadChart"),{
  type:"bar",
  data:{labels:Object.keys(lt),datasets:[{label:"Bookings",data:Object.values(lt),
    backgroundColor:"#3fb950"}]},
  options:{plugins:{legend:{display:false}},
    scales:{y:{ticks:{color:"#8b98a5"},grid:{color:"#2c3744"}},x:{ticks:{color:"#8b98a5"},grid:{display:false}}}}
});
</script>
</body>
</html>
"""


def build(db_path=DB_PATH, out_path=OUT_PATH, inline=False):
    """Render the dashboard.

    inline=False -> references vendor/chart.umd.js (default; two files).
    inline=True  -> embeds Chart.js into the HTML so the file is fully
                    self-contained with ZERO external dependencies. Ideal for
                    dropping into / iframing from a CMS.
    """
    summary = build_summary(db_path)
    html = TEMPLATE.replace("__DATA__", json.dumps(summary))
    if inline:
        with open(VENDOR_JS) as f:
            chart_src = f.read()
        html = html.replace(
            '<script src="vendor/chart.umd.js"></script>',
            "<script>\n" + chart_src + "\n</script>",
        )
    with open(out_path, "w") as f:
        f.write(html)
    return out_path, summary


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--inline", action="store_true",
                    help="Inline Chart.js for a single, dependency-free file (for CMS embedding)")
    ap.add_argument("--out", default=None, help="Output path (default dashboard.html)")
    args = ap.parse_args()
    out = args.out or OUT_PATH
    path, summary = build(out_path=out, inline=args.inline)
    print(f"Dashboard written to {path}{' (inlined, self-contained)' if args.inline else ''}")
    print(f"  properties={summary['counts']['properties']} "
          f"bookings={summary['counts']['bookings']} "
          f"this-month occ={summary['kpi_this_month']['occupancy']:.1%}")
