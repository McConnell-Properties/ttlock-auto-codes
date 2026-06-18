"""
Inbox dashboard generator — renders a self-contained messages-dashboard.html
(no external dependencies) from the messages in data/beds24.db.

Unanswered guest threads are surfaced first, with channel filters and a wait-time
badge. Click a thread to expand the full conversation.

Run:  python build_messages_dashboard.py [--out messages-dashboard.html]
"""

import argparse
import json
import os

from messages_inbox import build_inbox

HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(HERE, "data", "beds24.db")
OUT_PATH = os.path.join(HERE, "messages-dashboard.html")

TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Beds24 Guest Inbox</title>
<style>
  :root{--bg:#0f1419;--panel:#1a2029;--panel2:#222b36;--line:#2c3744;--text:#e6edf3;
    --muted:#8b98a5;--accent:#4f9cf9;--green:#3fb950;--red:#f85149;--amber:#d29922;--chip:#2d3742}
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
       background:var(--bg);color:var(--text);font-size:14px}
  header{padding:18px 24px;border-bottom:1px solid var(--line);display:flex;
         align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:8px}
  header h1{font-size:18px;margin:0;font-weight:600}
  header .meta{color:var(--muted);font-size:12px}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;padding:18px 24px 0}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
  .card .label{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em}
  .card .value{font-size:24px;font-weight:600;margin-top:4px}
  .card.alert .value{color:var(--amber)}
  .filters{display:flex;gap:8px;padding:18px 24px 4px;flex-wrap:wrap}
  .filter{padding:6px 14px;border-radius:999px;background:var(--panel);border:1px solid var(--line);
          cursor:pointer;color:var(--muted);user-select:none;font-size:13px}
  .filter.active{background:var(--accent);color:#fff;border-color:var(--accent)}
  .filter .count{opacity:.7;margin-left:5px}
  main{padding:8px 24px 60px}
  .thread{background:var(--panel);border:1px solid var(--line);border-radius:12px;margin:10px 0;overflow:hidden}
  .thread.unanswered{border-left:3px solid var(--amber)}
  .thead{display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer}
  .thead:hover{background:var(--panel2)}
  .who{font-weight:600}
  .chip{display:inline-block;padding:2px 9px;border-radius:999px;background:var(--chip);font-size:11px}
  .badge{font-size:11px;padding:2px 8px;border-radius:999px;font-weight:600}
  .badge.wait{background:rgba(210,153,34,.16);color:var(--amber)}
  .badge.ok{background:rgba(63,185,80,.14);color:var(--green)}
  .preview{color:var(--muted);font-size:13px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60ch}
  .spacer{flex:1}
  .convo{display:none;padding:6px 16px 16px;border-top:1px solid var(--line)}
  .convo.open{display:block}
  .msg{margin:10px 0;max-width:80%;padding:9px 12px;border-radius:12px;font-size:13px;line-height:1.45;white-space:pre-wrap}
  .msg.inbound{background:var(--panel2);border:1px solid var(--line)}
  .msg.outbound{background:rgba(79,156,249,.13);border:1px solid rgba(79,156,249,.3);margin-left:auto}
  .msg.note{background:rgba(210,153,34,.10);border:1px dashed var(--amber);color:var(--amber)}
  .msg .m-meta{font-size:11px;color:var(--muted);margin-bottom:3px}
  .empty{color:var(--muted);text-align:center;padding:40px}
  .right{text-align:right}
</style>
</head>
<body>
<header>
  <h1>Beds24 Guest Inbox</h1>
  <div class="meta">Messages fetched: <span id="lastFetch"></span> · Built: <span id="builtAt"></span></div>
</header>
<div class="cards" id="cards"></div>
<div class="filters" id="filters"></div>
<main id="list"></main>
<script>
const DATA = __DATA__;
document.getElementById("lastFetch").textContent = DATA.last_messages_fetch || "—";
document.getElementById("builtAt").textContent = DATA.generated_at || "—";

const S = DATA.summary;
function card(label,value,alert){return `<div class="card ${alert?'alert':''}"><div class="label">${label}</div><div class="value">${value}</div></div>`;}
const channels = Object.keys(S.by_channel).sort((a,b)=>S.by_channel[b].threads-S.by_channel[a].threads);
document.getElementById("cards").innerHTML =
  card("Unanswered", S.unanswered, S.unanswered>0)
+ card("Open threads", S.total_threads)
+ channels.slice(0,3).map(c=>card(c, S.by_channel[c].unanswered+" / "+S.by_channel[c].threads)).join("");

let filter = "all";
function renderFilters(){
  const fl = [["all","All",DATA.threads.length],["unanswered","Unanswered",S.unanswered]]
    .concat(channels.map(c=>[c,c,S.by_channel[c].threads]));
  document.getElementById("filters").innerHTML = fl.map(([k,label,n])=>
    `<div class="filter ${k===filter?'active':''}" data-k="${k}">${label}<span class="count">${n}</span></div>`).join("");
  document.querySelectorAll(".filter").forEach(f=>f.onclick=()=>{filter=f.dataset.k;renderFilters();renderList();});
}
function esc(s){return (s||"").replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));}
function fmtTime(s){return s? String(s).replace("T"," ").slice(0,16):"";}

function renderList(){
  let ts = DATA.threads;
  if(filter==="unanswered") ts = ts.filter(t=>t.unanswered);
  else if(filter!=="all") ts = ts.filter(t=>t.channel===filter);
  if(!ts.length){document.getElementById("list").innerHTML=`<div class="empty">No messages in this view.</div>`;return;}
  document.getElementById("list").innerHTML = ts.map((t,i)=>{
    const wait = t.unanswered
      ? `<span class="badge wait">waiting ${t.wait_hours==null?"":t.wait_hours+"h"}</span>`
      : `<span class="badge ok">replied</span>`;
    const convo = t.messages.map(m=>{
      const dir = m.direction==="inbound"?"inbound":(m.direction==="outbound"?"outbound":"note");
      return `<div class="msg ${dir}"><div class="m-meta">${dir==="inbound"?"Guest":(dir==="outbound"?"You":m.type)} · ${fmtTime(m.time)}</div>${esc(m.body)}</div>`;
    }).join("");
    return `<div class="thread ${t.unanswered?'unanswered':''}">
      <div class="thead" onclick="this.nextElementSibling.classList.toggle('open')">
        <div>
          <div class="who">${esc(String(t.property??"Property "+t.property_id))} <span class="chip">${esc(t.channel)}</span></div>
          <div class="preview">${esc(t.preview)||"<no text>"}</div>
        </div>
        <div class="spacer"></div>
        <div class="right">${wait}<div class="preview" style="margin-top:4px">${t.message_count} msgs · ${fmtTime(t.last_time)}</div></div>
      </div>
      <div class="convo">${convo}</div>
    </div>`;
  }).join("");
}
renderFilters();renderList();
</script>
</body>
</html>
"""


def build(db_path=DB_PATH, out_path=OUT_PATH):
    inbox = build_inbox(db_path)
    html = TEMPLATE.replace("__DATA__", json.dumps(inbox))
    with open(out_path, "w") as f:
        f.write(html)
    return out_path, inbox


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=OUT_PATH)
    args = ap.parse_args()
    path, inbox = build(out_path=args.out)
    s = inbox["summary"]
    print(f"Inbox written to {path}")
    print(f"  threads={s['total_threads']} unanswered={s['unanswered']} channels={list(s['by_channel'])}")
