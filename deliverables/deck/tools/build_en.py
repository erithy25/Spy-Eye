#!/usr/bin/env python3
"""Writes the English edition of the Sicht deck and its speaker notes.

    python3 deliverables/deck/tools/build_en.py

Output:
    deliverables/deck/project-en/deck.json            index of the English Slides artifact
    deliverables/deck/project-en/deck.css             shared rules, the same as the German ones
    deliverables/deck/project-en/slides/<id>.html     one slide each, ids as in the German edition
    deliverables/Sicht-Presentation-EN-notes.md

The German edition in tools/build.py is the original. This file follows it slide by slide: the
same twenty slides in the same order, the same layout and the same figures, with English number
format. It takes the CSS, the Edition class and the row helpers from build.py, so a change of
layout there reaches both editions; a change of content has to be made in both files.

Wording follows site/i18n.js where the same statement exists. Module names stay German as proper
names and get an English gloss in the slide title. Quotations from German sources are translated
and marked as our translation; quotations from English sources are given in the original.
"""
import json
import pathlib
import re
import sys

sys.dont_write_bytecode = True  # importing the German module must not leave a cache folder behind

import build as de  # noqa: E402
from build import MINUS, NB, Edition, buy, comp, foot, head, kv, no, plan_row, price, pt, risk  # noqa: E402

TOOLS = pathlib.Path(__file__).resolve().parent
DECK = TOOLS.parent
ROOT = DECK / "project-en"
NOTES_FILE = DECK.parent / "Sicht-Presentation-EN-notes.md"

# The pictures of the product slides, as files of this repository. The console is bilingual; only
# the LAGE screenshot was taken in English. Where each one was uploaded in the English Slides
# document is written in one place, tools/blobs-en.json (address -> file), which the local render
# reads as well: after a new upload only that file changes.
PICTURES = {
    "lage": "docs/screens/lage-en.png",
    "wachen": "deliverables/deck/assets/en/wachen-ausschnitt.png",
    "suche": "docs/screens/suche.png",
    "verbund": "deliverables/deck/assets/en/verbund-karte.png",
    "aufsicht": "docs/screens/stichprobe.png",
    "ruecksicht": "docs/screens/maskiert.png",
}


def uploaded(pictures):
    """Slide key -> address of its picture in the English document, from tools/blobs-en.json."""
    blobs = json.loads((TOOLS / "blobs-en.json").read_text(encoding="utf-8"))
    table = {}
    for key, file in pictures.items():
        ids = [blob for blob, path in blobs.items() if path == file]
        if len(ids) != 1:
            raise SystemExit(f"tools/blobs-en.json must name exactly one upload of {file}, found {len(ids)}")
        if not re.fullmatch(r"[A-Za-z0-9_-]+", ids[0]):
            raise SystemExit(f"tools/blobs-en.json: {ids[0]!r} is not the id of an upload (the part after /_blob/)")
        table[key] = f"/_blob/{ids[0]}"
    return table


IMG = uploaded(PICTURES)

EN = Edition(IMG, "Product")
add, product = EN.add, EN.product

# ---------------------------------------------------------------------------------------------
# 1 Title

_n = "Sicht is German for sight, and a word every responder there knows: “Wir haben Sicht”, we have sight, means the situation has been grasped. Today I am showing you a running system at trial stage, with exercise material and without government customers. The tagline is the product promise: every analysis has a purpose, a responsible person and a ledger entry. In German it reads “Keine Sicht ohne Aufsicht”."
add("titel", "Title", f"""
<section id="titel" class="cover" data-transition="fade">
<div class="bk bk-tl"></div><div class="bk bk-tr"></div><div class="bk bk-bl"></div><div class="bk bk-br"></div>
<div class="cover-top">
<p class="mark">SICHT</p>
<p class="label">Trial build · November 2026</p>
</div>
<div class="grow"></div>
<div class="cover-main">
<h1 class="claim">No sight<br>without oversight.</h1>
<p class="lede dim">The image layer for the civil operating picture.</p>
</div>
<aside>{_n}</aside>
</section>
""", _n)

# 2 Ahr valley

_n = "I pin the problem to this case, the flood in the Ahr valley in Germany in July 2021. It is documented that the helicopter filmed and that the videos were not properly filed; the parliamentary inquiry and the prosecutors knew nothing of them until September 2022. No source shows whether the footage reached the incident command, so I do not claim it. The footage existed; an operating picture made from it did not. The quotation on the slide is our translation from German."
add("ahrtal", "Ahr valley, 14 July 2021, 22:14", f"""
<section id="ahrtal" data-transition="fade">
<p class="label below-s">Ahr valley, Germany · 14 July 2021</p>
<h2 class="claim below-l">22:14</h2>
<div class="split">
<div class="col-fixed w-1052">
<p class="lede">Until 22:43 a police helicopter filmed the villages from Mayschoß to Schuld: houses flooded up to the attic, and people signalling with lamps.</p>
<p class="lede">The videos were “not properly filed”. Until September 2022 the parliamentary inquiry and the public prosecutors assumed that no such footage existed.</p>
</div>
<div class="side">
{pt("Toll", "At least 135 dead in the Ahr valley.")}
{pt("Not documented", "Whether the footage reached the incident command.")}
</div>
</div>
<div class="grow"></div>
<p class="src">Sources: dpa via Volksstimme, 5{NB}Oct{NB}2022 · epd via evangelisch.de, 4{NB}Oct{NB}2022 · dpa via Deutsches Ärzteblatt, 2{NB}Aug{NB}2024. Quotation: our translation.</p>
{foot("Problem")}
<aside>{_n}</aside>
</section>
""", _n)

# 3 Pattern

_n = "Two more officially documented cases. In Los Angeles the county’s report records that real-time information could not be shared consistently; on Maui about 850 gigabytes of material were released afterwards. I explicitly do not say that software would have changed the course of either. I say: the path from image to awareness is the weak point."
add("muster", "Pattern: two more documented cases", f"""
<section id="muster" data-transition="fade">
{head("Pattern: two more documented cases")}
<div class="split-even">
<div class="col">
<p class="label">Los Angeles · January 2025</p>
<p class="lede">First responders and incident commanders were “unable to consistently share real-time information”, among other things because of “various unconnected platforms”.</p>
<p class="src">County of Los Angeles, McChrystal After-Action Report, highlights, 25 Sep 2025</p>
</div>
<div class="col">
<p class="label">Maui · 8 August 2023</p>
<p class="lede">At least 102 dead. Released afterwards: “approximately 850 gigabytes of video files, audio files, photographs and documents”, among them police body camera footage.</p>
<p class="src">Hawaii Department of the Attorney General, News Release 2024-40, 13 Sep 2024 · Maui Now, 13 Sep 2024</p>
</div>
</div>
<div class="grow"></div>
<div class="duo">
{pt("What the records support", "Footage is produced during operations and often does not reach those who decide, or reaches them too late.")}
{pt("What they do not support", "That searchable video would have changed the course of any of these events. Software does not fix organisational failure.")}
</div>
{foot("Problem")}
<aside>{_n}</aside>
</section>
""", _n)

# 4 Timing

_n = "The German federal government is building a digital operating picture together with the states, and in 2027 the decision on live operation is due. Whoever is not known as a supplier by then will not get into the first stage. The ten billion euros are funds already budgeted, not a pot one applies to. And frankly: no authority has so far asked for image search in the operating picture. BMI is the Federal Ministry of the Interior, BBK the Federal Office of Civil Protection and Disaster Assistance, THW the Federal Agency for Technical Relief. The quotations are our translation from German."
add("jetzt", "Timing: Germany’s digital operating picture", f"""
<section id="jetzt" data-transition="fade">
{head("Timing: Germany’s digital operating picture")}
<div class="rows">
<div class="row g-why">
<p class="cell-k">Picture</p>
<p class="cell">“The federal government is developing with the states a joint digital domestic operating picture for civil protection, so that everyone responsible has a uniform basis of information for their operations, digitally and in real time.”</p>
<p class="src">BMI, Eckpunkte paper,<br>20 May 2026, p. 5</p>
</div>
<div class="row g-why">
<p class="cell-k">Window</p>
<p class="cell">In 2026 “a first pilot application was successfully developed”. In 2027 the decision on joint live operation by the federal government and the states is due.</p>
<p class="src">Bundestag printed paper<br>21/7120, answer 56</p>
</div>
<div class="row g-why row-end">
<p class="cell-k">Budget</p>
<p class="cell">Ten billion euros for civil protection by 2029: funds already budgeted, “not a grant programme”. The buyers are the federal agencies BBK and THW.</p>
<p class="src">BMI, Eckpunkte, p. 3<br>Bundestag paper 21/7126</p>
</div>
</div>
<div class="grow"></div>
<p class="lede strong">The call for the operating picture is in a government paper. A call for image search within it is nowhere.</p>
<p class="src above-s">Quotations: our translation. BMI: Federal Ministry of the Interior.</p>
{foot("Problem")}
<aside>{_n}</aside>
</section>
""", _n)

# 5 What Sicht is

_n = "Sicht is the image layer for the civil operating picture, not another command and control system. The purpose is measurable: the time from the first image of an event to the alert on the situation map, and the system reports it itself in every exercise. On the status: recordings are the tested path; live streams run with a delay of about half a minute and have been tested only in the lab."
add("sicht", "What Sicht is", f"""
<section id="sicht" data-transition="fade">
<p class="label below-m">What Sicht is</p>
<h2 class="statement below-m">Sicht makes the video that authorities record during operations anyway searchable within seconds and watches it for hazards on its own.</h2>
<p class="lede dim">Without identifying people, without pooling data, and with a ledger that accounts for every query.</p>
<div class="grow"></div>
<p class="lede strong below-m">The measurable purpose: time from recording to awareness.</p>
<div class="tri">
{pt("Detection delay", "Seconds from the first image of an event to the alert on the situation map.")}
{pt("Coverage", "Share of the recordings received that have been analysed in full.")}
{pt("Recorded queries", "An answer is delivered only after the ledger entry has been written.")}
</div>
{foot("Product")}
<aside>{_n}</aside>
</section>
""", _n)

# 6 to 11 Product

product(
    "lage",
    "Übersicht – overview: the situation on one map",
    "Console in English, SITUATION tab: map of Koblenz with eleven sources, incoming alerts, incidents and the strip of frames from the sources",
    [
        ("Sources", "Eleven in the exercise: drones, fixed cameras, scout teams, a citizen reporting portal."),
        ("Map", "Drawn in-house from OpenStreetMap data, with an MGRS grid, without a map service."),
        ("Incidents", "Alerts of the same kind at the same place are merged; several sources count as corroboration."),
    ],
    "SITUATION tab (console is bilingual). Exercise with stock footage.",
    "This is the main screen during the exercise RHEIN-MOSEL: eleven sources, each with its location. The exercise replays recordings analysed in advance on a clock, as if they were arriving right now. On the right the alerts come in and are merged into incidents; two sources for the same event count as corroboration. The module is called Übersicht, German for overview. The console is bilingual: this screenshot shows it in English, the following ones in German.",
)

product(
    "wachen",
    "Vorsicht – watches: they alert on their own",
    "Console in German, WACHEN tab (watches): the watch “Umgestürzter Lastkraftwagen” (overturned lorry) in version 2 with one confirmed and one dismissed verdict",
    [
        ("1 · False alert", "The collapsed road is reported as an overturned lorry."),
        ("2 · Dismissed", "The verdict is in the ledger and does not change the watch yet."),
        ("3 · Retrained", "Explicitly, as version 2, with a ledger entry."),
        ("4 · Next run", "No false alert. The real accident is still reported."),
    ],
    "WACHEN tab (shown in German): watch “overturned lorry”, version 2.",
    "A watch is a standing query in words, not a trained model. In the exercise one watch makes a mistake, and I show it instead of hiding it. The analyst dismisses the alert, confirms the correct one and explicitly retrains the watch; the step is in the ledger and can be taken back. In the next run the false alert does not return, and the real accident is still reported. The module is called Vorsicht, German for caution.",
)

product(
    "suche",
    "Einsicht – search: in your own words",
    "Console in German, SUCHE tab (search): four hits for the query “überflutete Wiese” (flooded meadow), a map of where they were found and the answer of a peer node",
    [
        ("Free text", "German or English, in whole phrases. No keyword catalogue."),
        ("Refused", "“face of Mr Müller”<br>“licence plate KO AB 123”<br>“foreign-looking man”"),
        ("Ledger", "Every query and every refusal is in the ledger, with mandate and person."),
    ],
    "SUCHE tab (shown in German): “flooded meadow”, one peer answer.",
    "Searches are made in whole phrases, in German or English; the image model runs offline on the authority’s machine. Names, faces, licence plates, origin and bodily features are refused, and the refusal is recorded. The check is a traceable check of words and can be circumvented by paraphrase; that is what the ledger and the sample are for. The module is called Einsicht, German for insight. The query on the screen, “überflutete Wiese”, means flooded meadow.",
)

product(
    "verbund",
    "Weitsicht – federation: only questions travel",
    "Console in German, VERBUND tab (federation): map with the nodes Koblenz, Trier and Mainz and the links between them",
    [
        ("What travels", "The question in words, with mandate, the person asking and a signature."),
        ("What stays", "Recordings, index and ledger stay with the recording authority."),
        ("What comes back", "At most twelve masked previews and a receipt number."),
    ],
    "VERBUND tab (shown in German): three demo nodes on one machine.",
    "Every authority runs its own node. In the federation only the question travels; the peer checks it against its own rules, records it and returns masked previews with a receipt number. In my research I found this principle at no vendor; that is a hypothesis from a limited search. In the demonstration the three nodes run on one machine; a federation across a real network has not been measured. The module is called Weitsicht, German for far sight.",
    tall=False,
    line="The image stays where it was recorded.",
)

product(
    "aufsicht",
    "Aufsicht – ledger: a log that can be verified",
    "Console in German, signed in as oversight, PROTOKOLL tab (ledger): chain intact, below it a sample of four queries with three refusals",
    [
        ("Chained", "Every entry contains the checksum of its predecessor. A change breaks the chain."),
        ("Sample", "Oversight draws random queries and sees no footage while doing so."),
        ("Witnessed", "Peer nodes record the latest state of each other’s ledgers."),
    ],
    "Oversight’s view (shown in German): chain verified, sample drawn.",
    "Every sign-in, query, refusal and approval is in a chained ledger. Whoever changes an entry breaks the chain, and the verification shows where. That can be recomputed without our software: two short verifiers come with the export. Oversight has a role of its own: it sees the ledger and the measurements, but no footage. One limitation belongs here: sign-in and rights are built for the demonstration, with three fixed accounts. The module is called Aufsicht, German for oversight.",
)

product(
    "ruecksicht",
    "Rücksicht – protection: masking and four eyes",
    "Console in German: a single frame from a source; the face of the person shown is pixelated, beside it the button to request the original",
    [
        ("Masked", "Faces are pixelated at ingest. The original stays under lock."),
        ("Four eyes", "The original is available only with a reason and the approval of a second person, for 15 minutes."),
        ("Mandate", "Without purpose and legal basis: no search, no new watch, no case."),
    ],
    "Frame with a masked face (shown in German). Stock footage.",
    "Faces are pixelated at ingest. Whoever needs the original states the reason and obtains the approval of a second person in a supervising role; it is valid for 15 minutes and recorded in the ledger. No one can approve their own request. How many faces the detector misses has not been measured. The module is called Rücksicht, German for consideration.",
)

# 12 Measurements

_n = "Measured on a machine with four cores and no graphics card, and repeatable with one command. 13 of the 13 events of the script were reported, at a median of 1.1 seconds after the arrival of the analysed frame, with one false alert; with a live stream a delay of about half a minute is added. Two caveats belong to every one of these figures: the watches were worded on this footage, and the hazard model errs on it despite 99 per cent on its benchmark. The figures say nothing about quality on real operational footage. [With an accelerated exercise clock the WIRKUNG tab reports higher values, two to three seconds at 8×; the 1.1 s come from the measurement run in real time.]"
add("gemessen", "Measurements: one exercise, two caveats", f"""
<section id="gemessen" data-transition="fade">
{head("Measurements: one exercise, two caveats")}
<div class="split">
<div class="rows w-892">
{kv("Events of the exercise detected", "13 of 13")}
{kv("Detection delay, median", f"1.1{NB}s")}
{kv("False alerts", "1 of 15")}
{kv("Analysis relative to real time", "3.3×")}
{kv("44 recordings searchable after", f"8{NB}s")}
{kv("New search query, median", f"0.1{NB}s")}
{kv("Hazard model on AIDERv2", "99.1%")}
{kv("Live stream: connection to alert", f"29{NB}s", last=True)}
</div>
<div class="side">
<div class="pt"><p class="pt-k">Caveat 1</p><h3 class="pt-h">The watches were worded on the exercise footage.</h3><p class="pt-v">The figures show how the system behaves in operation, not its quality on unseen footage.</p></div>
<div class="pt"><p class="pt-k">Caveat 2</p><h3 class="pt-h">The hazard model errs on the exercise footage.</h3><p class="pt-v">Despite 99.1% on its benchmark. It raises no alerts and stands beside them as a second opinion.</p></div>
</div>
</div>
<div class="grow"></div>
<p class="src">Measurement report of 18 November 2026: four processor cores, no graphics card, stock footage. Delay counted from the arrival of the analysed frame, without computing time. Live stream: simulated camera, segments of 10{NB}s.</p>
{foot("Evidence")}
<aside>{_n}</aside>
</section>
""", _n)

# 13 Limits

_n = "These limits are a selling point, not a concession: no faces, no licence plates, no search by origin or bodily features, no central data pool. I am precise about it: some of it is architecture, for instance that there is no model for faces and that recordings do not leave the node. The rest is a rule with a ledger, for instance the query check, and that is what I call it."
add("grenzen", "Limits: what Sicht is not meant to do", f"""
<section id="grenzen" data-transition="fade">
{head("Limits: what Sicht is not meant to do")}
<div class="tri">
{no("01", "No face recognition.", "No matching against images of persons. Faces are masked in every frame.")}
{no("02", "No licence plates.", "They are neither read nor searched.")}
{no("03", "No finding again, no tracking.", "Queries for particular persons are refused. Sex, age and clothing only under a mandate that permits them.")}
{no("04", "No protected attributes.", "No search by origin, religion, health, hair colour or tattoos.")}
{no("05", "No central data pool.", "Footage stays with the authority that recorded it.")}
{no("06", "No silent learning.", "Retraining is a separate, recorded step.")}
</div>
<div class="grow"></div>
<p class="text">Partly architecture, partly rule with a ledger. The query check is a check of words and can be circumvented by paraphrase; that is what the ledger and the sample are for.</p>
{foot("Evidence")}
<aside>{_n}</aside>
</section>
""", _n)

# 14 Competition

_n = "I do not say that nobody can do this: more than ten vendors ship free-text search over video, and the German state of Baden-Württemberg runs an operating picture by Fraunhofer. Palantir does not solve the task as a product, but could build it from its own building blocks. What I found at no vendor is the principle that in a federation only the question travels; that is the result of a limited search, not proof. Sicht therefore positions itself as an image layer that connects to existing systems."
add("wettbewerb", "Competition: the open space is narrow", f"""
<section id="wettbewerb" data-transition="fade">
{head("Competition: the open space is narrow")}
<div class="rows">
<div class="row-s g-comp"><p class="cell-k">Vendor</p><p class="cell-k">What they have</p><p class="cell-k">What they lack</p></div>
{comp("Fraunhofer IOSB", "Operating picture ELD-BS, in use in Baden-Württemberg; analysis of drone imagery", "Free-text search; the building blocks are separate projects")}
{comp("Eurocommand on Esri", "Staff software CommandX for fire services and disaster control", "Image search over video not found in the sources")}
{comp("Milestone, Axis, Genetec", "Free-text search over video, shipped or announced; Axis with a filter and a log", "No product for civil protection, no operating picture")}
{comp("Palantir", "Police analysis platforms in several German states; purpose prompt, log", "No documented free-text search over video; no product in civil protection")}
{comp("Linker Vision, NVIDIA", "Vision-language models on the cameras of the city of Kaohsiung, with results", "Data protection and federation do not appear in the sources", last=True)}
</div>
<div class="grow"></div>
<div class="tri">
{pt("What many can do", "More than ten vendors offer free-text search over video.")}
{pt("Only the question travels", "Found at no vendor. A limited search, not proof.")}
{pt("Consequence", "Today Sicht is a feature, not a market.")}
</div>
<p class="src above-s">Sources: vendor statements and press, 2025 to 2026; individual references in the strategy paper, section 4.</p>
{foot("Market")}
<aside>{_n}</aside>
</section>
""", _n)

# 15 Buyers

_n = "There are buyers at three levels of the German state. The realistic path starts from below: a paid trial in an exercise at a county with its own drone unit, with a measurement report as the result. Then a second state, then a framework agreement. I have set myself a stop criterion: if no authority commits to a trial by the end of March 2027, the demand thesis is wrong. BBK is the Federal Office of Civil Protection and Disaster Assistance, THW the Federal Agency for Technical Relief."
add("kaeufer", "Buyers: the path to the first trial", f"""
<section id="kaeufer" data-transition="fade">
{head("Buyers: the path to the first trial")}
<div class="split">
<div class="rows w-872">
{buy("Federal", "BBK with the Joint Information and Situation Centre; THW with 669 local sections.", "Before the 2027 decision no one there holds the requirement.")}
{buy("States", "Interior ministries and state agencies with their situation centres.", "Decide state-wide and are in part already committed.")}
{buy("Local", "400 counties and independent cities as lower disaster control authorities.", "Small budgets, a data protection review per county.", last=True)}
</div>
<div class="side">
{pt("Step 1", "A paid trial at a county with its own drone unit: three months, one exercise, one measurement report.")}
{pt("Step 2", "A second trial in another state.")}
{pt("Step 3", "Then the state: framework and federation.")}
{pt("Stop criterion", "If no authority commits to a trial by the end of March 2027, the demand thesis counts as not confirmed.")}
</div>
</div>
<div class="grow"></div>
<p class="src">Sources: THW · Federal Statistical Office via Deutscher Städtetag · Bundestag printed paper 21/7126, answer 28.</p>
{foot("Market")}
<aside>{_n}</aside>
</section>
""", _n)

# 16 Business model

_n = "What is sold is a licence per node and year; the node runs on the authority’s machines. All prices are assumptions; I found no comparable prices for staff software. Calculating Germany bottom-up gives about 25 million euros a year at full coverage. That is a small core market, and I would rather say so myself."
add("modell", "Business model: licence per node and year", f"""
<section id="modell" data-transition="fade">
{head("Business model: licence per node and year")}
<div class="split">
<div class="col-fixed w-900 gap-16">
<p class="label">Prices · all assumptions</p>
<div class="rows">
{price("Trial over three months", "€25,000 fixed")}
{price("Node licence for a county", "€48,000 per year")}
{price("State node", "€120,000 per year")}
{price("Federation licence, one state", "€180,000 per year")}
{price("Federal node", "€150,000 per year")}
{price("Roll-out and training", "€15,000 per node", last=True)}
</div>
</div>
<div class="side gap-16">
<p class="label">Market · calculated bottom-up</p>
<div class="pt"><p class="fig">€25.5m</p><p class="pt-v">per year in Germany at full coverage and list prices. Assumption.</p></div>
<div class="pt"><p class="fig">€9.6m</p><p class="pt-v">per year, reachable within five years. Assumption.</p></div>
</div>
</div>
<div class="grow"></div>
<p class="text">The core market is small: it supports a profitable specialist company, but not venture financing that aims at a multiple of the stake.</p>
<p class="src above-m">Source: financial model, sheets Annahmen (assumptions) and Markt (market).<br>The node runs on the authority’s machines.</p>
{foot("Market")}
<aside>{_n}</aside>
</section>
""", _n)

# 17 Five-year case

_n = "This is the base case from the workbook; every input is an assumption and can be changed in one cell. Revenue in 2031 about 2.3 million euros, first positive operating result in 2031, funding need until then about 3.2 million. The case hinges on a single state framework agreement in 2030; without it things look considerably worse. In the cautious case the business does not carry itself by 2031."
add("plan", "Five-year case: base case and its assumptions", f"""
<section id="plan" data-transition="fade">
{head("Five-year case: base case and its assumptions")}
<div class="rows">
{plan_row("Assumptions", ["2027", "2028", "2029", "2030", "2031"], header=True)}
{plan_row("Trials started", ["2", "5", "8", "12", "16"])}
{plan_row("Nodes at year end, rounded", ["0", "1", "3", "19", "35"])}
{plan_row("Revenue, €k", ["50", "159", "336", "1,249", "2,283"])}
{plan_row("Operating result, €k", [f"{MINUS}449", f"{MINUS}832", f"{MINUS}1,050", f"{MINUS}561", "+164"])}
{plan_row("Positions (full-time)", ["3", "6.5", "9", "12", "14"], last=True)}
</div>
<div class="grow"></div>
<div class="tri">
<div class="pt"><p class="pt-k">Revenue 2031</p><p class="fig">€2.3m</p></div>
<div class="pt"><p class="pt-k">First positive result</p><p class="fig">2031</p></div>
<div class="pt"><p class="pt-k">Funding need to 2031</p><p class="fig">€3.2m</p></div>
</div>
<p class="text above-m">The case hinges on one state framework agreement in 2030. Without it: revenue 2031 €1.2m, a loss of{NB}€0.9m, funding need €4.6m. In the cautious case the business does not carry itself by 2031.</p>
<p class="src above-s">Source: financial model, scenario Basis (base). All values follow from assumptions. Excluding taxes and grants.</p>
{foot("Market")}
<aside>{_n}</aside>
</section>
""", _n)

# 18 Risks

_n = "The largest risk is legal: there is no explicit legal basis for the AI analysis of video in civil protection. The second are the incumbents, who can add the feature. On top come long sales cycles, evidence only from stock footage and the lab, an unchecked name and a single founder without a background in staff work. For each point, the right-hand column says what I do about it. DPMA is the German Patent and Trade Mark Office, EUIPO the European Union Intellectual Property Office."
add("risiken", "Risks: six points and the countermeasures", f"""
<section id="risiken" data-transition="fade">
{head("Risks: six points and the countermeasures")}
<div class="rows">
<div class="row-m g-risk"><p class="cell-k">No.</p><p class="cell-k">Risk</p><p class="cell-k">Countermeasure</p></div>
{risk("1", "No explicit legal basis for the AI analysis of video.", "Legal opinion per state, early talk with a supervisory authority, start in exercises.")}
{risk("2", "Incumbents add the feature: Fraunhofer IOSB, Esri, Milestone.", "Offer a supplier role; build out federation and oversight as architecture.")}
{risk("3", "Sales cycles of 9 to 18 months; no documented demand so far.", "Trial at a small fixed price; stop criterion at the end of March 2027.")}
{risk("4", "Evidence only from stock footage, one benchmark and a simulated camera.", "Trial with the authority’s footage and cameras; publish error rates.")}
{risk("5", "The name Sicht has not been checked against trademark registers.", "Search at DPMA and EUIPO before any public use.")}
{risk("6", "One founder, no background in staff work, no reference.", "Co-founder from a staff or control centre; advisory board of two practitioners.", last=True)}
</div>
{foot("Market")}
<aside>{_n}</aside>
</section>
""", _n)

# 19 Status

_n = "You have seen what runs. Live streams are built and tested in the lab, with a delay of about half a minute; they have not been tried in the field. My request is concrete: an authority that trials Sicht in an exercise for three months and receives a measurement report for it. [Decide before the meeting whether to ask for financing; the slide deliberately names the need of the base case and no sum asked for.]"
add("stand", "Status: what runs, what is missing, the ask", f"""
<section id="stand" data-transition="fade">
{head("Status: what runs, what is missing, the ask")}
<div class="tri">
{pt("Runs", "Ingest, masking, search, watches, incidents, cases, federation, ledger, measurement.")}
{pt("In the lab", "Live stream with a delay: built, tested in the lab, not tried in the field.")}
{pt("Missing", "Coupling to command systems.<br>User administration.<br>Measurement on real footage.<br>Customers, certification.<br>Trademark check of the name.")}
</div>
<div class="grow"></div>
<div class="duo-ask">
<div class="pt"><p class="pt-k">Sought</p><h3 class="pt-h">An authority that trials Sicht in an exercise for three months: one node, one measurement report.</h3></div>
<div class="pt"><p class="pt-k">Financing: open</p><p class="pt-v">Two paths are open: own funds and research grants until the first measurement report, or a round earlier. The base case needs about €3.2m by 2031 (assumption).</p></div>
</div>
{foot("Status")}
<aside>{_n}</aside>
</section>
""", _n)

# 20 Close

_n = "No sight without oversight: that is the sentence you can measure me by. I would be glad to show you the system in operation now. I answer questions directly, the uncomfortable ones too."
add("schluss", "Close", f"""
<section id="schluss" class="cover">
<div class="bk bk-tl"></div><div class="bk bk-tr"></div><div class="bk bk-bl"></div><div class="bk bk-br"></div>
<div class="cover-top">
<p class="mark">SICHT</p>
<p class="label">Trial build · exercise material · no government customers</p>
</div>
<div class="grow"></div>
<div class="cover-main">
<h2 class="claim">No sight<br>without oversight.</h2>
<p class="lede dim">Keine Sicht ohne Aufsicht.</p>
</div>
<aside>{_n}</aside>
</section>
""", _n)

# ---------------------------------------------------------------------------------------------

assert EN.order == de.ORDER, "the English edition must have the slides of the German one, in its order"

INDEX = {
    **de.INDEX,
    "createdOnFiles": {"v": 1, "at": "2026-11-18T05:30:00Z"},
    "title": "Sicht – Presentation (EN)",
    "order": EN.order,
    "sections": {
        "s1": {"description": "The problem in one documented case, the pattern behind it and why the timing matters.", "start": "titel"},
        "s2": {"description": "What Sicht is and how it works, shown on the running console.", "start": "sicht"},
        "s3": {"description": "What has been measured, with its caveats, and what Sicht deliberately cannot do.", "start": "gemessen"},
        "s4": {"description": "Competition, buyers, business model, five-year case and risks.", "start": "wettbewerb"},
        "s5": {"description": "Status, the request for a trial, and the close.", "start": "stand"},
    },
}


def main():
    EN.write(ROOT, INDEX, NOTES_FILE, [
        "# Sicht – speaker notes for the presentation (English edition)",
        "",
        "Two to four sentences per slide. The same texts are the notes inside the presentation.",
        "Text in square brackets is a reminder for the speaker and is not spoken.",
        "",
    ])
    print(len(EN.slides), "slides,", NOTES_FILE.name)


if __name__ == "__main__":
    main()
