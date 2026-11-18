# Worklog

Start: 2026-11-18 00:12:33 UTC (T0). Budget: 12 h, ends 12:12:33 UTC.
Elapsed time is computed from `.goal-start` (epoch seconds, not committed).

## Decisions
- Working name: ERDA (Old High German for "earth"; Tolkien derived "Arda" from it). Fallbacks: Vigiles, Lynkeus.
- Mission: the civil operating picture ("Ziviles Lagebild") for civil protection / civil defence; open-vocabulary search over
  the state's own video, standing queries, map, federation; no biometric identification, faces masked, every query mandate-bound
  and written to a hash-chained ledger.
- Demo: scripted exercise scenario (clearly labelled ÜBUNG) around Koblenz (Rhine/Moselle), stock footage, ground-truth events.
- Default model MobileCLIP-S2 (CPU). GPU provider only accepted if it reproduces the CPU probe.

## Log
- T+0:05 P0 fix pushed: provider self-test with CPU reference, degenerate-vector guards, `pnpm selftest`.
- T+0:10 Research agents running (landscape, evidence, legal) -> docs/research/. AIDERv2 download running -> .cache/aider.
- T+27 min: Hazard head trained on AIDERv2 (13,399 train images, linear probe on MobileCLIP-S2):
  test accuracy 0.9909, macro-F1 0.9900 (n=1,654); zero-shot baseline 0.9220 / 0.9199. Weights in apps/server/assets/hazard-head.json.
- Backend modules written: core/{json,ledger,auth,mandates,geo}, intel/{sources,guard,scoring,scenario,watches,incidents,cases,federation,metrics,report},
  ml/{faces,head,calibration}. Next: node.ts + routes, then map + frontend.
