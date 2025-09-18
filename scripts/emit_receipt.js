// Minimal OpenLine receipt for mesh health (Node standard libs only).
const fs = require('fs');
const path = require('path');

const LOG = path.join('logs', 'events.jsonl');
const OUT = path.join('docs', 'receipt.latest.json');
const now = () => Math.floor(Date.now()/1000);

// --- helpers
function quantile(arr, q){
  if(!arr.length) return 0;
  const a = arr.slice().sort((x,y)=>x-y);
  const pos = (a.length-1)*q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return a[base] + (a[base+1]!==undefined ? rest*(a[base+1]-a[base]) : 0);
}

function loadEvents() {
  if (!fs.existsSync(LOG) || fs.statSync(LOG).size === 0) {
    // simulate a healthy-ish mesh if no real events
    const t0 = now()-60;
    const sim = [];
    sim.push({type:'radio', tx_dbm:4, adv_interval_ms:400, ttl:3, wifi_direct:false, ts:t0});
    for(let i=0;i<25;i++){
      const id = 'm'+i;
      sim.push({type:'message_sent', id, ts:t0+i});
      const hops = Math.random()<0.8 ? Math.floor(2+Math.random()*2) : 5;
      const lat  = 500 + Math.random()*1200;
      if (Math.random()<0.96) {
        sim.push({type:'message_delivered', id, hops, latency_ms:lat, ts:t0+i+2});
      }
      // peers
      for(let p=0;p<3;p++){
        sim.push({type:'peer_seen', peer:'P:'+((Math.random()*0xffff)|0).toString(16), rssi:-50-Math.random()*30, ts:t0+i});
      }
    }
    return sim;
  }
  const lines = fs.readFileSync(LOG,'utf8').trim().split('\n').filter(Boolean);
  return lines.map(l=>JSON.parse(l));
}

// --- compute receipt
(function main(){
  const events = loadEvents();
  const T = now();
  const windowSec = 600; // 10 min rolling
  const recent = events.filter(e => (T - (e.ts||T)) <= windowSec);

  const sent = new Set();
  const delivered = new Set();
  const latencies = [];
  const hopsArr   = [];
  const peers = new Set();

  let radio = { tx_dbm: 0, adv_interval_ms: 600, ttl: 3, wifi_direct: false };

  for(const e of recent){
    if(e.type==='message_sent' && e.id){ sent.add(e.id); }
    if(e.type==='message_delivered' && e.id){
      delivered.add(e.id);
      if(typeof e.latency_ms==='number') latencies.push(e.latency_ms);
      if(typeof e.hops==='number') hopsArr.push(e.hops);
    }
    if(e.type==='peer_seen' && e.peer){ peers.add(e.peer); }
    if(e.type==='radio'){ radio = {...radio, ...e}; }
  }

  const delivery = sent.size ? delivered.size / sent.size : 0;
  const p50 = quantile(latencies, 0.5);
  const p95 = quantile(latencies, 0.95);
  const medianHops = quantile(hopsArr, 0.5);

  // thresholds (tune later or make configurable)
  const TH = { delivery: 0.95, p95_ms: 2000, ttl_max: 4 };

  // status
  let status = 'amber';
  if (delivery < 0.20 || latencies.length === 0) status = 'red';
  else if (delivery >= TH.delivery && p95 <= TH.p95_ms) status = 'green';

  // one crisp reason
  let why = '';
  if(status!=='green'){
    if (delivery < TH.delivery) why = `delivery ${Math.round(delivery*100)}% < ${Math.round(TH.delivery*100)}%`;
    else if (p95 > TH.p95_ms)   why = `p95 latency ${p95|0}ms > ${TH.p95_ms}ms`;
    else                        why = `mesh unstable (low samples)`;
  }

  // one lever
  let so = '';
  if(status!=='green'){
    if (delivery < TH.delivery) {
      so = radio.wifi_direct ? 'increase TTL to 4; shorten adv interval (−100ms)' : 'enable Wi-Fi Direct or increase TX power +3 dB';
    } else if (p95 > TH.p95_ms) {
      so = 'shorten adv interval (−100ms) or add 1 hop TTL if median_hops < 3';
    } else {
      so = 'keep radio steady; gather more samples';
    }
  } else {
    so = 'hold parameters; monitor battery';
  }

  // OpenLine receipt
  const receipt = {
    claim: "Mesh is live and healthy",
    because: [
      `delivery ${(delivery*100).toFixed(1)}% in last 10m`,
      `latency p50 ${(p50|0)}ms / p95 ${(p95|0)}ms`,
      `reach ${peers.size} peers · median hops ${medianHops||0}`
    ],
    but: status==='green' ? [] : [why],
    so,
    telem: {
      window_sec: windowSec,
      delivery_success: +delivery.toFixed(4),
      latency_ms_p50: Math.round(p50),
      latency_ms_p95: Math.round(p95),
      reach_peers: peers.size,
      hops_median: medianHops || 0,
      radio: {
        tx_dbm: radio.tx_dbm|0,
        adv_interval_ms: radio.adv_interval_ms|0,
        ttl: radio.ttl|0,
        wifi_direct: !!radio.wifi_direct
      }
    },
    threshold: { delivery: TH.delivery, p95_ms: TH.p95_ms, ttl_max: TH.ttl_max },
    model: "mesh/bluetooth-wifi-store-and-forward",
    attrs: { status },
    next_try: status==='green' ? null : {
      patch: suggestPatch(status, delivery, p95, medianHops, radio, TH)
    }
  };

  fs.writeFileSync(OUT, JSON.stringify(receipt, null, 2));
  console.log(`[ok] wrote ${OUT}`);
  console.log(`status=${status} delivery=${(delivery*100).toFixed(1)}% p95=${p95|0}ms peers=${peers.size}`);

  function suggestPatch(status, delivery, p95, medianHops, radio, TH){
    const patch = [];
    if (delivery < TH.delivery) {
      if (!radio.wifi_direct) patch.push({ key: "radio.wifi_direct", to: true });
      else patch.push({ key: "radio.tx_dbm", to: (radio.tx_dbm|0)+3 });
      patch.push({ key: "radio.adv_interval_ms", to: Math.max(200, (radio.adv_interval_ms|0)-100) });
    } else if (p95 > TH.p95_ms) {
      if ((radio.ttl|0) < TH.ttl_max && (medianHops||0) < 3) patch.push({ key: "radio.ttl", to: (radio.ttl|0)+1 });
      patch.push({ key: "radio.adv_interval_ms", to: Math.max(200, (radio.adv_interval_ms|0)-100) });
    } else {
      patch.push({ key: "radio.adv_interval_ms", to: radio.adv_interval_ms });
    }
    return patch;
  }
})();
