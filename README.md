# OpenLine Mesh Adapter
Tiny, legible health card for Bluetooth/Wi-Fi mesh messaging (BitChat-class). Emits one OpenLine receipt:
**Point → Because → But → So** with 3 metrics: Delivery, Latency, Reach.

- Green when: delivery ≥ 0.95, p95 latency ≤ 2s
- Amber when improving but not yet green
- Red when dead/no real delivery

**How to try (no code changes):**
1) Run the GitHub Action: **Actions → Emit mesh receipt → Run workflow**
2) Open **https://<you>.github.io/openline-mesh-adapter** (reads `docs/receipt.latest.json`)

**How to feed real data later:** append JSON lines to `logs/events.jsonl` from your app (event types below) and re-run the Action.

## Event types (one per line in `logs/events.jsonl`)
```json
{"type":"message_sent","id":"abc","ts":1737162000}
{"type":"message_delivered","id":"abc","latency_ms":1200,"hops":3,"ts":1737162001}
{"type":"peer_seen","peer":"P:7f2a","rssi":-68,"ts":1737162000}
{"type":"radio","tx_dbm":4,"adv_interval_ms":400,"ttl":3,"wifi_direct":false,"ts":1737162000}
{"type":"battery","level":0.76,"plugged":false,"ts":1737162000}
