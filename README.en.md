# Sicht

**No sight without oversight.**

English summary. The German [`README.md`](README.md) is the full reference and counts where the
two differ; no native speaker has reviewed the English texts.

Sicht makes the video that authorities record during operations anyway (drones, helicopters,
gauge and traffic cameras, vehicles, scouts) searchable within seconds and watches it for hazards
on its own. It identifies nobody, pools no data and keeps every query in a chained ledger. It is
the image layer for a civil situation picture, not a command system.

Status: trial stage with exercise footage. There are no customers, no certification and no live
operation, and the name has not been cleared as a trade mark.

## What it does

- **Search in plain words**, German or English, over recordings from drones, cameras and scouts.
- **Watches**: standing queries that report hazards on a map by themselves. A person confirms or
  dismisses every alert; a watch changes only when someone retrains it explicitly.
- **Federation**: when one authority asks another, only the question travels. Masked previews
  with a receipt number come back; recordings and index stay where they were taken.
- **Purpose and oversight**: every query needs a mandate with a purpose and is written to a
  hash-chained ledger. An oversight role verifies the chain and draws samples without seeing
  pictures. Two short verifiers, in Node and in Python, recalculate the chain without Sicht.
- **No identification**: faces are masked on ingest and released only with a reason and a second
  person. Queries for names, faces, licence plates or for finding a person again are refused.
  That is a rule with a ledger, not a technical impossibility.
- **On the authority's own machine**: four cores, no graphics card, no cloud, no database. Once
  the models are loaded, no network.

## Start the demonstration

Needs Node 20.11 or later, pnpm, ffmpeg and 8 GB of memory. The first run loads about 950 MB of
models and about 300 MB of exercise footage and takes five to ten minutes.

On Windows, one command checks the prerequisites, installs, builds, prepares, checks the three
nodes, starts them and opens the browser:

```bash
.\vorfuehrung.cmd
```

On any system, step by step:

```bash
pnpm install
```

```bash
pnpm build
```

```bash
pnpm exercise:fetch
```

```bash
pnpm demo:prepare
```

```bash
pnpm demo:check
```

```bash
pnpm demo
```

Then open <http://127.0.0.1:8787>, sign in as `leitung` with the password `lagebild` and choose
the mandate “Übung RHEIN-MOSEL”. The console has an English interface (EN in the header); ledger
entries, event titles and source names stay German. The run of the demonstration is on one page
in [`deliverables/Sicht-Cue-Card-EN.pdf`](deliverables/Sicht-Cue-Card-EN.pdf).

For footage of your own instead of the exercise: `pnpm start`, sign in, choose the mandate
“Erprobung”, drop files or a folder in the tab QUELLEN and ask in the tab SUCHE.

## Measured

All figures come from an exercise of our own with freely licensed archive footage; the watches
were worded on that footage. Conditions and limits are in
[`docs/EVALUATION.md`](docs/EVALUATION.md) (German).

| What | Result |
| --- | --- |
| Exercise in real time | 13 of 13 events reported, 15 alerts, one false alert, delay 1.1 s at the median |
| Search on general footage | 54 of 66 queries answered; the first hit fits for 64 of 66 |
| Until 44 uploaded recordings are searchable | 7.6 s through the interface, about 10 s through the browser |
| Analysis | about 3.3 times real time on four cores without a graphics card |
| Automatic checks | 88, among them two independent ledger verifiers; the whole demonstration path also runs on a Windows machine in every check run |
| Source review by a second reviewer | 21 findings, the severe ones fixed; no penetration test |
| Accessibility | no rule of WCAG 2.1 A and AA violated in an automatic check of 18 states; usable without a mouse; no test by a test body |

## Not there yet

- No trial with an authority and no measurement on real operational footage.
- Live streams are built and tested against a simulated camera only.
- The federation has run between nodes on one machine, not over a real network.
- Three demonstration accounts instead of user management; no second factor; nothing on the disk
  is encrypted.
- No legal opinion on the basis for analysing video in civil protection.

## Papers in English

- Presentation: [`deliverables/Sicht-Presentation-EN.pdf`](deliverables/Sicht-Presentation-EN.pdf)
  with notes beside it
- One-pager: [`deliverables/Sicht-One-Pager-EN.pdf`](deliverables/Sicht-One-Pager-EN.pdf)
- Cue card for the demonstration: [`deliverables/Sicht-Cue-Card-EN.pdf`](deliverables/Sicht-Cue-Card-EN.pdf)
- Hard questions, short answers: [`docs/vertrieb/FAQ-EN.md`](docs/vertrieb/FAQ-EN.md)
- Pitch in one sentence, 30 seconds and two minutes: [`docs/vertrieb/KURZVORSTELLUNG.md`](docs/vertrieb/KURZVORSTELLUNG.md)
  (German and English)

Strategy, legal assessment, architecture, security review, bill of materials, accessibility and
operations papers are in German under [`docs/`](docs).
