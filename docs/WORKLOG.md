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

## 09:00 UTC · T+527 min

- Windows: the start through `vorfuehrung.cmd` without a switch is now part of the workflow and
  passed (nodes up, console answering); two further runs on later commits passed as well.
- Bill of materials (`pnpm sbom`): 143 packages across all platforms with version, checksum and
  licence, three models, typeface, map data; CycloneDX 1.5 and a readable paper. No GPL or AGPL.
  Compared with known vulnerabilities: none in shipped packages, one in a build tool. Two tests
  hold the list to the lock file.
- Accessibility: an automatic check with axe-core (WCAG 2.1 A and AA rules) over 15 console
  states and 3 website states found six violated rules on 364 elements, mostly secondary text at
  2.7:1. Fixed: text greys now meet 4.5:1, picture buttons and the severity glyph carry names,
  rows and incidents react to Tab, Enter and Space, new alerts are announced in a live region,
  the map moves and zooms from the keyboard. Keyboard-only walk: 24 of 24 steps. Not done: a
  screen reader test, a BITV test.
- Found while checking screen sizes (1280x720 to 1920x1080): the side column of the situation
  view was wider than its track, so its right edge was cut off at every size, also in the
  published pictures. Fixed; pictures taken again.
- Two more papers in the document folder: bill of materials, accessibility.

## 09:30 UTC · T+557 min

- Pictures taken again in real time on the corrected build; website, both decks and
  `docs/screens` carry them. Captions checked against the pictures; the measurement picture
  stays because it shows the documented run.
- Map: reachable with Tab, arrow keys move it, plus and minus zoom. Keyboard-only walk now 24 of
  24 steps; the rule check still finds nothing in 15 console states.
- Alert list names sources in the chosen language.
- Product film and long film cut again from a new take (136.6 s and 66.76 s). Cut ends are now
  anchored to the mark after them; three cuts begin after their page has changed; one caption
  was changed because the new take shows the first alert with three frames at first sight.
- Windows run on the final code state passed every step, including the start through
  `vorfuehrung.cmd`; the browser was opened by the script.
- Clean clone on Linux: install, build, type check and 83 tests pass; fetch, prepare, check,
  evaluation and both ledger verifiers follow in the same run (result below in the final
  report of the session).

## 10:00 UTC · T+587 min

- Clean clone on Linux ran the whole path: install, build, 83 tests, fetch (316 MB), prepare
  (271 s), preflight, evaluation (13 of 13, one false alert), both ledger verifiers, the check of
  the bill of materials.
- Upgrade from the first version: the node was started on a data folder written by it (44
  recordings indexed with the earlier encoders). It re-indexes them in the background; "Beach",
  "Man with a cup" and "Black car" return hits, "Green bus" reports that no scene is above the
  threshold. The same holds for a fresh upload of the folder through the console (198 s).
- The first version listened on the same port. The start command and the node now say so when
  something that is not a node of Sicht holds the port; the Windows workflow tests it with a
  listener.
- Two more points from the review: free space is checked before an upload
  (`SICHT_MIN_FREE_MB`), and the operator can name the hosts live streams may come from
  (`SICHT_STREAM_HOSTS`). 88 tests.
- Website: bill of materials and keyboard use under operation, accessibility among the limits.

## 10:35 UTC · T+622 min

- Windows: the runs with the taken-port test and with the two new settings passed every step;
  the final code state is the one of commit 02b7adc.
- Endurance: three nodes for 19 minutes, the exercise six times at 8x and once in real time, a
  browser on the situation view, a search every four to ten seconds. Each run 15 alerts and 11
  incidents; memory 3.0 GB at start, then 1,725 to 1,734 MB; 38 open files throughout; search
  5 to 8 ms at the median; no page error; ledger intact.
- Backup and restore: the copies of two data folders were started elsewhere; the independent
  verifier and the node report an intact chain, sign-in and search work on the copy.
- Operations paper (`docs/BETRIEB.md`) with what a node needs, set-up, backup, update,
  monitoring, faults and what is missing for real operation.
- Presenter card on one page, German and English, built with a check that it fits.
- English console walked from sign-in to the last tab: interface in English throughout; ledger
  entries, event titles and source names in search hits stay German.
- Final check on the final build: types, 88 tests, bill of materials, preflight, keyboard walk
  24 of 24, no rule violated in 18 states, full walk at 8x, rehearsal at 4x with the inbound
  request in the ledgers of both neighbours, operator and auditor walks, four-eyes release,
  both ledger verifiers.

## 10:50 UTC · T+637 min

- No program code has changed since the last Windows run that passed (commit 02b7adc); what
  followed are papers, the website and films.
- Rehearsal at the speed the run-of-show names (4x): false alert dismissed, true alert
  confirmed, watch retrained, federated search with the inbound request in the ledgers of Trier
  and Mainz, case secured and sealed, four-eyes release with its ledger entry, operator and
  auditor walks.
- English console walked from sign-in to the last tab; English hard questions
  (`docs/vertrieb/FAQ-EN.md`); English cue card; product film with English cards and captions.
- Website shows brand film and product film in the language of the page; the rule check still
  finds nothing in its three states.
- An interrupted model download heals at the next start (the library writes under a temporary
  name and renames when complete); the operations paper says so.

## 11:12 UTC · T+660 min

- Last Windows run on the final state of the program (commit 7fed00c, run 44289584709): every
  step passed. Fresh machine prepared and checked in 7 min 26 s, prepared machine ready in 22 s,
  start in 30 s, a port held by another program is named; exercise 13 of 13, 15 alerts, one
  false alert, median 3.1 s at 8x; both ledger verifiers report an intact chain of 17 entries
  with the same head. After that commit only papers and the print tool changed.
- Fresh clone of the pushed branch on Linux: install, build, types, 88 tests, bill of materials.
- Guide for the first ten conversations with authorities
  (`docs/vertrieb/GESPRAECHSLEITFADEN.md`, printable as
  `deliverables/Sicht-Gespraechsleitfaden.pdf`): questions per assumption, a ladder of
  commitments, an evaluation against the stop criteria of the strategy paper. The thresholds are
  a proposal.
- Hand-over sheet: fresh clone into a new folder as the second way in, a proposed running order
  for the appointment in 35 and in 20 minutes, browser and screen notes.
- Console read for functions only Chromium knows: none found; it has still never been run in
  Firefox or Safari.
- Narrow windows (1097, 1152, 1280 and 1366 px wide, as a laptop with display scaling gives
  them): no overflow and no page error on any tab; below 1280 px mandate and role in the header
  are no longer readable.
- The three artifacts are private and at their final versions.

## 11:18 UTC · T+665 min

- Without any network: in a namespace that has loopback and nothing else (neither the package
  registry nor the model host reachable) the steps of the start command ran on a prepared
  machine: install, build, reset, preflight ("Ergebnis: bereit"), start of the three nodes, then
  in the browser the exercise at 8x and a search with four hits. No error in the browser or in
  the output of the nodes. Recorded in the measurement paper, section 7. Linux only; the Windows
  run always had a network.
- Index sheet for the hand-over archive (`deliverables/MAPPE.md`), so that the archive reads
  without the repository.
- Disturbances during the exercise at 8x: signed in at Koblenz and Trier in one browser profile
  (two cookies, both sessions hold); node process frozen for 20 s (the clock catches up, the
  alerts follow); page reloaded, tab closed and reopened (session holds, exercise runs on); node
  process killed hard in the middle (ledger intact with 27 entries, reset restores the prepared
  state, preflight "bereit"). No page error. Measurement paper, section 7.
- The original use case once more on the final build, in the browser: a folder of 44 own
  recordings handed to one node; all searchable after 9.9 s, completely analysed after 184 s.
  "Beach" 0.77, "Man with a cup" 0.96 and 0.91, "Black Car" 0.69, "Hund" 0.77; "Green Bus" no
  scene above the threshold (there is no green bus in the footage). No page error.

## 11:30 UTC · T+677 min · closing entry

- English summary of the README (`README.en.md`).
- The time until uploaded footage is searchable is now named with both measurements, 7.6 s
  through the interface and 9.9 s through the browser, in the measurement paper, both cue cards,
  the hand-over sheet, the README and the brand paper. Website and decks show the interface
  figure together with its condition.
- The repository is public on GitHub. That is recorded as an open decision in the hand-over
  sheet and in the strategy paper: source, strategy, financial assumptions and the security
  review with its open points can be read by anyone. Tracked files, the text and metadata of
  every PDF, the workbook and the commit authors were searched for personal data: none found.
- Checked at the last commit before this entry: types of both packages, 88 tests, bill of
  materials against the lock file, preflight "bereit".
- This commit asks for one more Windows run, so that the last commit of the branch is itself one
  that ran there. Its result is in the final report of the session, not in this file.

