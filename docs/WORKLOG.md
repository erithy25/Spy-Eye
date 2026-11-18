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
- T+0:45 Name changed: ERDA dropped (too close to Hexagon's ERDAS imagery software, same field and buyers). New name: SICHT.
  Tagline "Keine Sicht ohne Aufsicht" / "No sight without oversight". Module family: Übersicht (map), Einsicht (search),
  Vorsicht (watches), Durchsicht (cases), Rücksicht (privacy), Aufsicht (ledger), Weitsicht (federation).
  Web-search budget of the session is used up, so the new name could NOT be checked for collisions; flag to user.
- Research done (docs/research/{landscape,evidence,legal}.md). Design consequences applied: no silent self-learning
  (explicit versioned retraining), retention 60 d (§ 60 LBKG RLP), audit sampling, identifying-feature rule (AI Act rec. 16),
  CAP/GeoJSON export ("visual layer that plugs into existing Lagebild systems").
- Backend committed locally (not pushed until the console matches the new API).

## 02:12 UTC · T+120 min

- Console rewritten against the platform API (Lage, Suche, Wachen, Vorgänge, Verbund, Protokoll,
  Quellen, Wirkung; DE/EN; self-rendered offline map).
- Exercise scenario RHEIN-MOSEL: 31 stock clips, 11 sources, 13 scripted events, footage fetched by
  `pnpm exercise:fetch`. Demonstration peers Trier and Mainz with seed archives.
- Default encoder changed to SigLIP 2 base patch32-256 (Apache-2.0): MobileCLIP weights turned out
  to be research-only. Measured here: 34 ms per image against 62 ms; German queries work.
  Own calibration family, hazard head retrained (99.1 % on AIDERv2 test, zero-shot 85.1 %).
- Hazard model no longer raises alerts: on the exercise footage it calls a calm river a flood.
  It is shown as a second opinion on alerts from aerial sources.
- Prompt guard closed for licence plates, faces, re-identification, tracking; clothing
  descriptions of persons depend on the mandate.
- Exercise result (8x clock): 13 of 13 events, median delay 2.4 s, one false alert; after one
  dismissal and explicit retraining the false alert does not recur.
