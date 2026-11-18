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

## 04:40 UTC · T+268 min

- Website finished and published as a private page; pitch deck (20 slides) as a private Slides
  document with an offline PDF. Both reviewed slide by slide and section by section.
- Container image: both build stages verified in a test build up to the last layer; the runtime
  layout verified outside a container. Stated as such in the Dockerfile and README.
- `pnpm demo:check`: asks the three nodes what a presenter will ask them and prints OK / FEHLT per
  line. `pnpm demo:reset`: restores the state left by `demo:prepare` after a rehearsal.
- Windows: `.github/workflows/windows.yml` plays the whole demonstration path on a Windows runner
  with Windows PowerShell 5.1 (install, build, ffmpeg, selftest, fetch, prepare, check, reset,
  exercise). First run found a borderline search result on one peer; second run passed and showed
  three false alerts instead of one (newer ffmpeg decodes minimally differently, the watch
  "a car crash" crossed its cut-off on two ground-level sources). That watch now looks at aerial
  sources only.
- Search on general footage was the user's original failure ("Beach" showed nothing). Measured
  with 91 labelled queries on the 44-clip dataset, then fixed: whole picture and tiles are judged
  against separate cut-offs, and half of the mean text embedding is subtracted from the query.
  First pass 37 -> 53 of 66 queries answered, complete analysis 50 -> 54, first result fitting
  61 -> 64 of 66. Repeatable with `pnpm search:evaluate`. Watches keep their own cut-off; the
  exercise still gives 13 of 13 with one false alert.
- First pass reads the duration of MP4 files from the header instead of starting ffmpeg:
  44 clips searchable after 7.6 s (was 11 to 14 s).
- Peers greet each other once they listen; a peer that makes contact is greeted back at once.
  One flood clip moved from the Trier archive to the Mainz archive so that both answer the
  demonstration query clearly.
- Measurement report per exercise as a printable document (WIRKUNG, MESSBERICHT), numbers in the
  console's language (decimal comma in German), model download reports progress and stalls,
  an occupied port is explained.

## 07:30 UTC · T+438 min

- Final screenshots at real-time speed in docs, website and both decks; captions checked against
  what the pictures show. The ledger sample is shown in the oversight role.
- English edition of the deck (own build file, notes, PDF) and of the one-pager. Document folder
  as print-ready PDFs with a tool that builds and checks them; two more papers joined it:
  `docs/ARCHITEKTUR.md` (path of a frame, storage formats, ledger format, roles, federation
  protocol, every route with its permission) and `docs/SICHERHEIT.md`.
- Ledger can be verified without Sicht: `tools/pruefen/` holds one verifier in Node and one in
  Python, without dependencies; tests hold both to what the ledger writes. `pnpm ledger:verify`.
- Independent review of `apps/server/src` by a second reader: 21 findings, 5 of them high. Fixed
  with tests or a recorded run:
  frames were servable before they were masked (ffmpeg now writes under a name that is never
  served; a frame is released only after the face check; without the detector nothing is
  released); a recording was handed out while its face count was still zero; the query check read
  text differently from the model (full-width letters, invisible characters, hyphens, inner
  capitals, other scripts); two query paths wrote no ledger entry; a line separator in a text
  made the ledger unreadable under Node 24.
  Also: federation signature covers sender, recipient, path and a nonce and is accepted once;
  peer answers are checked field by field; peers get no person descriptions and a budget;
  requests started by another site and queries opened as a page or picture are refused; sealing
  and sharing a source are the supervisor's; evidence keeps its recording; the approver's
  password is guarded like a sign-in; stream addresses are redacted in ffmpeg's messages.
  Found before the review while checking roles: the case report gave oversight pictures.
- Check run with 44 recordings while they were analysed: 332 requests for frames not yet
  released and 2,813 requests for recordings not yet checked, all refused; afterwards 21
  recordings without faces free, 23 with masked faces only with approval.
- After the hardening: fresh analysis of all footage (241 s), exercise 13 of 13 with one false
  alert, preflight green, browser walks in all three roles without errors.
- Films: German card 3 is now the documented quotation; English cut; product film from a new
  console take; vertical teasers in German and English (5 generations, 31.25 credits).
- Short pitch in three lengths (German and English), brand files (wordmark as outlines, share
  card), sales templates.

## 08:15 UTC · T+482 min

- One command for the demonstration on Windows: `vorfuehrung.cmd` checks the requirements,
  installs, builds, fetches and analyses on the first run, restores the prepared state on every
  later run, checks the three nodes, starts them and opens the browser. The Windows workflow
  runs it on a fresh and on a prepared machine and, since this stretch, also starts the nodes
  through it and waits for the console to answer.
- `demo:prepare` restores the prepared state first, so a rehearsal can no longer become the
  baseline by accident.
- Federation between machines: a node file may name a peer by address; both sides derive the key
  of their pair. `nodes.beispiel.json` is the template. Checked with two nodes started and
  configured separately on one machine, not across a network.
- A node speaks HTTPS when the operator supplies a certificate (`SICHT_TLS_CERT`,
  `SICHT_TLS_KEY`); its session cookie is then marked Secure. Checked with a self-issued
  certificate for one node and for two nodes asking each other. Not the default.
- Three more review points closed: unhandled rejections are logged instead of ending the node,
  slow event-stream clients are dropped, an alert is written to the ledger before it is shown.
- Papers, website and hand-over notes brought to this state; document folder rebuilt and handed
  over as one archive.

