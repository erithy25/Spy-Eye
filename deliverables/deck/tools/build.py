#!/usr/bin/env python3
"""Writes the files of the Sicht deck and the speaker notes.

    python3 deliverables/deck/tools/build.py

Output:
    deliverables/deck/project/deck.json            index of the Slides artifact
    deliverables/deck/project/deck.css             shared rules
    deliverables/deck/project/slides/<id>.html     one slide each
    deliverables/Sicht-Praesentation-Sprechzettel.md

Every figure comes from docs/EVALUATION.md, docs/BRAND.md, README.md, docs/STRATEGY.md or
deliverables/Sicht-Finanzmodell.xlsx (scenario Basis). Change wording here, run the script, then
send the changed files to the artifact and run tools/render.cjs for the PDF.

This file is the German edition and the original. tools/build_en.py holds the English edition:
the same slides in the same order, built with the CSS, the Edition class and the row helpers of
this file. A change of content here has to be repeated there.
"""
import json
import pathlib

DECK = pathlib.Path(__file__).resolve().parent.parent
ROOT = DECK / "project"
NOTES_FILE = DECK.parent / "Sicht-Praesentation-Sprechzettel.md"

NB = " "  # no-break space inside figures
MINUS = "−"

# Uploaded pictures of the artifact (the same table is in tools/blobs.json for the local render).
IMG = {
    "lage": "/_blob/aecf6e3bb9b63cb5d0c1a6e531a82a05",
    "wachen": "/_blob/2c270a1d9c95aed479d9ade2e51d18a0",
    "suche": "/_blob/29897d68d63ba9734c6452ad24f0b489",
    "verbund": "/_blob/884584f768773e791253265dbefec92b",
    "aufsicht": "/_blob/81544bfaad1138c803db70e4a3f81012",
    "ruecksicht": "/_blob/9cd1635d5b85e492feb7c057509e0720",
}

CSS = """/* Sicht. One typeface, black ground, hairlines, corner marks. No colour. */
body { font-family: 'JetBrains Mono', 'Courier New', monospace; color: #ededed; }
section { background: #050505; color: #ededed; font-family: 'JetBrains Mono', 'Courier New', monospace; font-size: 28px; line-height: 1.4; padding: 128px 128px 160px; display: flex; flex-direction: column; counter-increment: page; }

/* Type scale: 120 / 56 / 36 / 28 / 24 */
.claim { font-size: 120px; font-weight: 500; line-height: 1.06; letter-spacing: -3px; color: #ededed; }
.title { font-size: 56px; font-weight: 500; line-height: 1.12; letter-spacing: -1px; color: #ededed; padding-bottom: 40px; }
.statement { font-size: 56px; font-weight: 500; line-height: 1.18; letter-spacing: -1px; color: #ededed; }
.lede { font-size: 36px; font-weight: 400; line-height: 1.32; color: #ededed; }
.text { font-size: 28px; font-weight: 400; line-height: 1.4; color: #ededed; }
.label { font-size: 24px; font-weight: 400; line-height: 1.3; letter-spacing: 4px; text-transform: uppercase; color: #8a8a8a; }
.src { font-size: 24px; font-weight: 400; line-height: 1.35; color: #8a8a8a; }
.mark { font-size: 36px; font-weight: 700; line-height: 1; letter-spacing: 28px; color: #ededed; }

/* Structure */
.grow { flex: 1; }
.split { display: flex; gap: 56px; }
.split-even { display: flex; gap: 44px; }
.col { flex: 1; display: flex; flex-direction: column; gap: 14px; }
.col-fixed { flex: none; display: flex; flex-direction: column; gap: 28px; }
.side { flex: 1; display: flex; flex-direction: column; gap: 24px; }
.side-spread { flex: 1; display: flex; flex-direction: column; justify-content: space-between; }
.tri { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 36px 60px; }
.duo { display: grid; grid-template-columns: 1fr 1fr; gap: 56px; }
.duo-ask { display: grid; grid-template-columns: 788px 1fr; gap: 72px; }
.w-1052 { width: 1052px; flex: none; }
.w-900 { width: 900px; flex: none; }
.w-892 { width: 892px; flex: none; }
.w-872 { width: 872px; flex: none; }
.gap-16 { gap: 16px; }

/* A labelled point: hairline, label, one sentence */
.pt { display: flex; flex-direction: column; gap: 8px; border-top: 2px solid #333333; padding-top: 16px; }
.pt-k { font-size: 24px; font-weight: 400; line-height: 1.3; letter-spacing: 4px; text-transform: uppercase; color: #8a8a8a; }
.pt-v { font-size: 28px; font-weight: 400; line-height: 1.4; color: #ededed; }
.pt-h { font-size: 36px; font-weight: 500; line-height: 1.2; color: #ededed; }
.pt-s { font-size: 24px; font-weight: 400; line-height: 1.4; color: #8a8a8a; }
.fig { font-size: 56px; font-weight: 500; line-height: 1.12; letter-spacing: -1px; color: #ededed; }

/* A console picture with the corner marks of the product */
.figure { width: 1008px; flex: none; display: flex; flex-direction: column; gap: 24px; }
.shot { position: relative; width: 1008px; height: 630px; }
.shot-map { position: relative; width: 1008px; height: 534px; }
.shot-img { width: 1008px; height: 630px; object-fit: contain; }
.shot-img-map { width: 1008px; height: 534px; object-fit: contain; }
.c { position: absolute; width: 24px; height: 24px; box-sizing: border-box; }
.c-tl { left: -10px; top: -10px; border-top: 2px solid #ededed; border-left: 2px solid #ededed; }
.c-tr { left: 994px; top: -10px; border-top: 2px solid #ededed; border-right: 2px solid #ededed; }
.c-bl { left: -10px; top: 616px; border-bottom: 2px solid #ededed; border-left: 2px solid #ededed; }
.c-br { left: 994px; top: 616px; border-bottom: 2px solid #ededed; border-right: 2px solid #ededed; }
.c-bl-map { left: -10px; top: 520px; border-bottom: 2px solid #ededed; border-left: 2px solid #ededed; }
.c-br-map { left: 994px; top: 520px; border-bottom: 2px solid #ededed; border-right: 2px solid #ededed; }
.cap { font-size: 24px; font-weight: 400; line-height: 1.3; color: #8a8a8a; }

/* Rows with hairlines; a table draws its own lines, these do not */
.rows { display: flex; flex-direction: column; }
.row { display: grid; gap: 32px; padding: 13px 0; border-top: 2px solid #333333; align-items: baseline; }
.row-s { display: grid; gap: 32px; padding: 8px 0; border-top: 2px solid #333333; align-items: baseline; }
.row-m { display: grid; gap: 32px; padding: 11px 0; border-top: 2px solid #333333; align-items: baseline; }
.row-end { border-bottom: 2px solid #333333; }
.g-kv { grid-template-columns: 1fr 280px; }
.g-price { grid-template-columns: 1fr 330px; }
.g-why { grid-template-columns: 220px 1fr 376px; }
.g-comp { grid-template-columns: 316px 1fr 1fr; }
.g-buy { grid-template-columns: 170px 1fr; }
.g-risk { grid-template-columns: 72px 1fr 1fr; }
.g-plan { grid-template-columns: 520px 1fr 1fr 1fr 1fr 1fr; gap: 24px; }
.cell { font-size: 28px; font-weight: 400; line-height: 1.4; color: #ededed; }
.cell-s { font-size: 24px; font-weight: 400; line-height: 1.35; color: #ededed; }
.cell-k { font-size: 24px; font-weight: 400; line-height: 1.3; letter-spacing: 4px; text-transform: uppercase; color: #8a8a8a; }
.val { font-size: 36px; font-weight: 500; line-height: 1.1; color: #ededed; text-align: right; }
.num { font-size: 28px; font-weight: 400; line-height: 1.4; color: #ededed; text-align: right; }
.num-k { font-size: 24px; font-weight: 400; line-height: 1.3; letter-spacing: 4px; color: #8a8a8a; text-align: right; }

/* Cover and closing: the corner marks frame the margin box */
.cover { padding: 192px; }
.cover-top { display: flex; justify-content: space-between; align-items: center; }
.cover-main { display: flex; flex-direction: column; gap: 36px; }
.bk { position: absolute; width: 48px; height: 48px; box-sizing: border-box; }
.bk-tl { left: 128px; top: 128px; border-top: 2px solid #ededed; border-left: 2px solid #ededed; }
.bk-tr { left: 1744px; top: 128px; border-top: 2px solid #ededed; border-right: 2px solid #ededed; }
.bk-bl { left: 128px; top: 904px; border-bottom: 2px solid #ededed; border-left: 2px solid #ededed; }
.bk-br { left: 1744px; top: 904px; border-bottom: 2px solid #ededed; border-right: 2px solid #ededed; }

/* Footer band: one row, same place on every content slide */
.foot { position: absolute; left: 128px; bottom: 64px; width: 1664px; height: 24px; display: flex; justify-content: space-between; align-items: center; }
.foot-mark { font-size: 24px; font-weight: 700; line-height: 1; letter-spacing: 10px; color: #8a8a8a; }
.foot-right { display: flex; gap: 28px; align-items: center; }
.foot-sec { font-size: 24px; font-weight: 400; line-height: 1; letter-spacing: 4px; text-transform: uppercase; color: #8a8a8a; }
.pg { font-size: 24px; line-height: 1; color: #ededed; }
.pg::after { content: counter(page); }

/* Modifiers last, so they win over the type classes */
.dim { color: #8a8a8a; }
.strong { font-weight: 500; }
.below-s { padding-bottom: 12px; }
.below-m { padding-bottom: 28px; }
.below-l { padding-bottom: 44px; }
.above-s { padding-top: 12px; }
.above-m { padding-top: 28px; }
"""

def foot(section):
    return (
        '<div class="foot"><p class="foot-mark">SICHT</p>'
        f'<div class="foot-right"><p class="foot-sec">{section}</p><div class="pg"></div></div></div>'
    )


def head(title):
    return f'<h2 class="title">{title}</h2>'


def pt(label, text):
    return f'<div class="pt"><p class="pt-k">{label}</p><p class="pt-v">{text}</p></div>'


class Edition:
    """One language edition of the deck: its pictures, its slides in order and its speaker notes."""

    def __init__(self, images, product_section):
        self.images = images                    # key -> address of the uploaded picture
        self.product_section = product_section  # footer label of the product slides
        self.slides = {}                        # id -> html
        self.notes = {}                         # id -> (title for the notes file, text)
        self.order = []

    def add(self, sid, heading, html, notes):
        assert sid not in self.slides, sid
        assert notes.count("<") == 0, f"notes of {sid} must be plain text"
        self.slides[sid] = html.strip() + "\n"
        self.notes[sid] = (heading, notes)
        self.order.append(sid)

    def shot(self, key, alt, tall=True):
        if tall:
            return (
                f'<div class="shot"><img class="shot-img" src="{self.images[key]}" alt="{alt}">'
                '<div class="c c-tl"></div><div class="c c-tr"></div><div class="c c-bl"></div><div class="c c-br"></div></div>'
            )
        return (
            f'<div class="shot-map"><img class="shot-img-map" src="{self.images[key]}" alt="{alt}">'
            '<div class="c c-tl"></div><div class="c c-tr"></div><div class="c c-bl-map"></div><div class="c c-br-map"></div></div>'
        )

    def product(self, sid, title, alt, points, caption, notes, tall=True, line=None):
        extra = f'\n<p class="lede strong">{line}</p>' if line else ""
        side = "\n".join(pt(k, v) for k, v in points)
        self.add(sid, title, f"""
<section id="{sid}" data-transition="fade">
{head(title)}
<div class="split">
<div class="figure">
{self.shot(sid, alt, tall)}
<p class="cap">{caption}</p>{extra}
</div>
<div class="side-spread">
{side}
</div>
</div>
{foot(self.product_section)}
<aside>{notes}</aside>
</section>
""", notes)

    def write(self, root, index, notes_file, notes_intro):
        """Writes index, CSS and slides below `root` and the speaker notes to `notes_file`."""
        (root / "slides").mkdir(parents=True, exist_ok=True)
        for old in (root / "slides").glob("*.html"):
            if old.stem not in self.slides:
                old.unlink()
        (root / "deck.css").write_text(CSS, encoding="utf-8")
        (root / "deck.json").write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        for sid, html in self.slides.items():
            (root / "slides" / f"{sid}.html").write_text(html, encoding="utf-8")
        lines = list(notes_intro)
        for i, sid in enumerate(self.order, start=1):
            heading, text = self.notes[sid]
            lines += [f"## {i:02d} · {heading}", "", text, ""]
        notes_file.write_text("\n".join(lines), encoding="utf-8")


# The German edition. The names below are what the slide definitions of this file use.
DE = Edition(IMG, "Produkt")
SLIDES, NOTES, ORDER = DE.slides, DE.notes, DE.order
add, shot, product = DE.add, DE.shot, DE.product


# ---------------------------------------------------------------------------------------------
# 1 Titel

add("titel", "Titel", f"""
<section id="titel" class="cover" data-transition="fade">
<div class="bk bk-tl"></div><div class="bk bk-tr"></div><div class="bk bk-bl"></div><div class="bk bk-br"></div>
<div class="cover-top">
<p class="mark">SICHT</p>
<p class="label">Erprobungsstand · November 2026</p>
</div>
<div class="grow"></div>
<div class="cover-main">
<h1 class="claim">Keine Sicht<br>ohne Aufsicht.</h1>
<p class="lede dim">Die Bildschicht für das zivile Lagebild.</p>
</div>
<aside>Sicht ist ein Wort, das jede Einsatzkraft kennt: „Wir haben Sicht“ heißt, die Lage ist erfasst. Ich zeige Ihnen heute ein laufendes System im Erprobungsstand, mit Übungsmaterial und ohne Behördenkunden. Der Leitsatz ist das Produktversprechen: Jede Auswertung hat einen Zweck, eine verantwortliche Person und einen Protokolleintrag.</aside>
</section>
""", "Sicht ist ein Wort, das jede Einsatzkraft kennt: „Wir haben Sicht“ heißt, die Lage ist erfasst. Ich zeige Ihnen heute ein laufendes System im Erprobungsstand, mit Übungsmaterial und ohne Behördenkunden. Der Leitsatz ist das Produktversprechen: Jede Auswertung hat einen Zweck, eine verantwortliche Person und einen Protokolleintrag.")

# 2 Ahrtal

_n = "An diesem Fall mache ich das Problem fest. Belegt ist, dass der Hubschrauber gefilmt hat und dass die Videos nicht ordnungsgemäß verbucht wurden; Ausschuss und Staatsanwaltschaft wussten bis September 2022 nichts von ihnen. Ob die Aufnahmen die Einsatzleitung erreicht haben, belegt keine Quelle, deshalb behaupte ich es nicht. Die Bilder gab es, ein Lagebild daraus gab es nicht."
add("ahrtal", "Ahrtal, 14. Juli 2021, 22:14 Uhr", f"""
<section id="ahrtal" data-transition="fade">
<p class="label below-s">Ahrtal · 14. Juli 2021</p>
<h2 class="claim below-l">22:14 Uhr</h2>
<div class="split">
<div class="col-fixed w-1052">
<p class="lede">Ein Polizeihubschrauber filmte bis 22:43 Uhr die Orte von Mayschoß bis Schuld: bis zum Dachgeschoss überflutete Häuser und Menschen, die mit Lampen auf sich aufmerksam machten.</p>
<p class="lede">Die Videos wurden „nicht ordnungsgemäß verbucht“. Bis September 2022 gingen Untersuchungsausschuss und Staatsanwaltschaft davon aus, dass es solche Aufnahmen nicht gibt.</p>
</div>
<div class="side">
{pt("Bilanz", "Mindestens 135 Tote im Ahrtal.")}
{pt("Nicht belegt", "Ob die Aufnahmen die Einsatzleitung erreicht haben.")}
</div>
</div>
<div class="grow"></div>
<p class="src">Quellen: dpa über Volksstimme, 05.10.2022 · epd über evangelisch.de, 04.10.2022 · dpa über Deutsches Ärzteblatt, 02.08.2024</p>
{foot("Problem")}
<aside>{_n}</aside>
</section>
""", _n)

# 3 Muster

_n = "Zwei weitere amtlich dokumentierte Fälle. In Los Angeles hält der Bericht des County fest, dass Echtzeitinformationen nicht verlässlich geteilt werden konnten; auf Maui wurden nachträglich rund 850 Gigabyte Material veröffentlicht. Ich sage ausdrücklich nicht, dass Software einen dieser Verläufe geändert hätte. Ich sage: Die Strecke vom Bild zur Lagekenntnis ist die Schwachstelle."
add("muster", "Muster: zwei weitere dokumentierte Fälle", f"""
<section id="muster" data-transition="fade">
{head("Muster: zwei weitere dokumentierte Fälle")}
<div class="split-even">
<div class="col">
<p class="label">Los Angeles · Januar 2025</p>
<p class="lede">Einsatzkräfte und Einsatzleitungen konnten Echtzeitinformationen nicht verlässlich teilen, unter anderem wegen „various unconnected platforms“.</p>
<p class="src">County of Los Angeles, McChrystal-Bericht, Kernaussagen, 25.09.2025</p>
</div>
<div class="col">
<p class="label">Maui · 8. August 2023</p>
<p class="lede">Mindestens 102 Tote. Nachträglich veröffentlicht: rund 850 Gigabyte Video, Ton, Bilder und Dokumente, darunter Aufnahmen der Körperkameras der Polizei.</p>
<p class="src">Generalstaatsanwaltschaft Hawaii, Mitteilung 2024-40, 13.09.2024 · Maui Now, 13.09.2024</p>
</div>
</div>
<div class="grow"></div>
<div class="duo">
{pt("Was die Belege tragen", "Bildmaterial entsteht im Einsatz und erreicht die Stelle, die entscheidet, oft nicht oder zu spät.")}
{pt("Was sie nicht tragen", "Dass durchsuchbares Video einen dieser Verläufe geändert hätte. Software behebt kein Organisationsversagen.")}
</div>
{foot("Problem")}
<aside>{_n}</aside>
</section>
""", _n)

# 4 Zeitpunkt

_n = "Der Bund baut mit den Ländern ein digitales Lagebild, und 2027 fällt die Entscheidung über den Wirkbetrieb. Wer bis dahin nicht als Zulieferer bekannt ist, kommt in die erste Ausbaustufe nicht hinein. Die zehn Milliarden sind eingeplante Haushaltsmittel, kein Topf, aus dem man Mittel beantragt. Und offen gesagt: Bildsuche im Lagebild hat bisher keine Behörde verlangt."
add("jetzt", "Zeitpunkt: das digitale Lagebild Inland", f"""
<section id="jetzt" data-transition="fade">
{head("Zeitpunkt: das digitale Lagebild Inland")}
<div class="rows">
<div class="row g-why">
<p class="cell-k">Lagebild</p>
<p class="cell">„Der Bund entwickelt mit den Ländern ein gemeinsames digitales Lagebild Inland für den Bevölkerungsschutz, damit alle Verantwortlichen eine einheitliche Informationsgrundlage für ihre Einsätze haben, digital und in Echtzeit.“</p>
<p class="src">BMI, Eckpunkte,<br>20.05.2026, S. 5</p>
</div>
<div class="row g-why">
<p class="cell-k">Zeitfenster</p>
<p class="cell">2026 wurde „eine erste Pilotanwendung erfolgreich entwickelt“. 2027 wird über den gemeinsamen Wirkbetrieb von Bund und Ländern entschieden.</p>
<p class="src">BT-Drs. 21/7120,<br>Antwort 56</p>
</div>
<div class="row g-why row-end">
<p class="cell-k">Haushalt</p>
<p class="cell">Zehn Milliarden Euro bis 2029 für den Bevölkerungsschutz: bereits eingeplante Haushaltsmittel, „kein Förderprogramm“. Käufer sind BBK und THW.</p>
<p class="src">BMI, Eckpunkte, S. 3<br>BT-Drs. 21/7126</p>
</div>
</div>
<div class="grow"></div>
<p class="lede strong">Die Forderung nach dem Lagebild steht in einem Regierungspapier. Die Forderung nach Bildsuche darin steht nirgends.</p>
{foot("Problem")}
<aside>{_n}</aside>
</section>
""", _n)

# 5 Was Sicht ist

_n = "Sicht ist die Bildschicht für das zivile Lagebild, kein weiteres Führungssystem. Der Zweck ist messbar: die Zeit vom ersten Bild eines Ereignisses bis zur Meldung auf der Lagekarte, und das System weist sie in jeder Übung selbst aus. Zum Stand: Aufzeichnungen sind der erprobte Weg; Direktbilder laufen mit etwa einer halben Minute Nachlauf und sind nur im Labor geprüft."
add("sicht", "Was Sicht ist", f"""
<section id="sicht" data-transition="fade">
<p class="label below-m">Was Sicht ist</p>
<h2 class="statement below-m">Sicht macht das Videomaterial, das Behörden im Einsatz ohnehin erzeugen, in Sekunden durchsuchbar und beobachtet es selbständig auf Gefahrenlagen.</h2>
<p class="lede dim">Ohne Personen zu identifizieren, ohne Daten zusammenzuführen und mit einem Protokoll, das jede Abfrage nachweist.</p>
<div class="grow"></div>
<p class="lede strong below-m">Der messbare Zweck: Zeit von der Aufnahme bis zur Lagekenntnis.</p>
<div class="tri">
{pt("Erkennungsverzug", "Sekunden vom ersten Bild eines Ereignisses bis zur Meldung auf der Lagekarte.")}
{pt("Sichtungsquote", "Anteil der eingegangenen Aufzeichnungen, die vollständig ausgewertet sind.")}
{pt("Protokollierte Abfragen", "Eine Antwort wird erst nach dem Protokolleintrag ausgeliefert.")}
</div>
{foot("Produkt")}
<aside>{_n}</aside>
</section>
""", _n)

# 6 bis 11 Produkt

product(
    "lage",
    "Übersicht: die Lage auf einer Karte",
    "Konsole, Reiter Lage: Karte von Koblenz mit elf Quellen, eingehenden Meldungen, Lagen und der Bildleiste der Quellen",
    [
        ("Quellen", "Elf in der Übung: Drohnen, Festkameras, Erkundungstrupps, ein Hinweisportal."),
        ("Karte", "Selbst gezeichnet aus OpenStreetMap-Daten, mit UTMREF-Gitter, ohne Kartendienst."),
        ("Lagen", "Meldungen gleicher Art am selben Ort werden zusammengefasst; mehrere Quellen gelten als Bestätigung."),
    ],
    "Reiter LAGE, Übung RHEIN-MOSEL. Archivmaterial, keine Echtlage.",
    "Das ist der Hauptbildschirm während der Übung RHEIN-MOSEL: elf Quellen, jede mit Standort. Die Übung spielt vorab ausgewertete Aufzeichnungen auf einer Uhr ab, als träfen sie gerade ein. Rechts laufen die Meldungen ein und werden zu Lagen zusammengefasst; zwei Quellen für dasselbe Ereignis gelten als Bestätigung.",
)

product(
    "wachen",
    "Vorsicht: Wachen, die selbständig melden",
    "Konsole, Reiter Wachen: die Wache Umgestürzter Lastkraftwagen in Version 2 mit einem bestätigten und einem verworfenen Urteil",
    [
        ("1 · Fehlmeldung", "Die abgerutschte Fahrbahn wird als umgestürzter Lastwagen gemeldet."),
        ("2 · Verworfen", "Das Urteil steht im Protokoll und ändert die Wache noch nicht."),
        ("3 · Nachgeschärft", "Ausdrücklich, als Version 2, mit Protokolleintrag."),
        ("4 · Folgelauf", "Keine Fehlmeldung. Der echte Unfall wird weiter gemeldet."),
    ],
    "Reiter WACHEN: die Wache „Umgestürzter Lastkraftwagen“ in Version 2.",
    "Eine Wache ist ein stehender Suchauftrag in Worten, kein trainiertes Modell. In der Übung macht eine Wache einen Fehler, und ich zeige ihn, statt ihn zu verstecken. Die Auswerterin verwirft die Meldung, bestätigt die richtige und schärft die Wache ausdrücklich nach; der Schritt steht im Protokoll und lässt sich zurücknehmen. Im nächsten Lauf kommt die Fehlmeldung nicht wieder, der echte Unfall wird weiter gemeldet.",
)

product(
    "suche",
    "Einsicht: Suche in eigenen Worten",
    "Konsole, Reiter Suche: vier Treffer zur Anfrage überflutete Wiese, Karte der Fundorte und die Antwort eines Nachbarknotens",
    [
        ("Freitext", "Deutsch oder englisch, in ganzen Wendungen. Kein Schlagwortkatalog."),
        ("Abgelehnt wird", "„Gesicht von Herrn Müller“<br>„Kennzeichen KO AB 123“<br>„südländischer Mann“"),
        ("Protokoll", "Jede Anfrage und jede Ablehnung steht mit Mandat und Person im Protokoll."),
    ],
    "Reiter SUCHE: „überflutete Wiese“, mit einer Antwort aus dem Verbund.",
    "Gesucht wird in ganzen Wendungen, auf Deutsch oder Englisch; das Bildmodell läuft ohne Netz auf dem Rechner der Behörde. Namen, Gesichter, Kennzeichen, Herkunft und körperliche Merkmale werden abgelehnt, und die Ablehnung wird protokolliert. Die Prüfung ist eine nachvollziehbare Wortprüfung und lässt sich umschreiben; deshalb gibt es Protokoll und Stichprobe.",
)

product(
    "verbund",
    "Weitsicht: nur die Frage reist",
    "Konsole, Reiter Verbund: Karte mit den Knoten Koblenz, Trier und Mainz und den Verbindungen zwischen ihnen",
    [
        ("Es reist", "Die Frage in Worten, mit Mandat, anfragender Person und Signatur."),
        ("Es bleibt", "Aufnahmen, Verzeichnis und Protokoll bleiben bei der Behörde, die aufgenommen hat."),
        ("Es kommt zurück", "Höchstens zwölf maskierte Vorschaubilder und eine Belegnummer."),
    ],
    "Reiter VERBUND: drei Knoten der Vorführung, alle auf einem Rechner.",
    "Jede Behörde betreibt ihren eigenen Knoten. Im Verbund reist nur die Frage; der Nachbar prüft sie nach seinen Regeln, protokolliert sie und gibt maskierte Vorschaubilder mit einer Belegnummer zurück. Diesen Grundsatz habe ich in der Recherche bei keinem Anbieter gefunden, das ist eine Hypothese aus einer begrenzten Suche. In der Vorführung laufen die drei Knoten auf einem Rechner; ein Verbund über ein echtes Netz ist nicht gemessen.",
    tall=False,
    line="Das Bild bleibt, wo es aufgenommen wurde.",
)

product(
    "aufsicht",
    "Aufsicht: ein Protokoll, das sich prüfen lässt",
    "Konsole, Reiter Protokoll: Kette unversehrt, darunter eine Stichprobe aus vier Abfragen mit drei Ablehnungen",
    [
        ("Verkettet", "Jeder Eintrag enthält die Prüfsumme seines Vorgängers. Eine Änderung bricht die Kette."),
        ("Stichprobe", "Die Aufsicht zieht zufällige Abfragen und sieht dabei kein Bildmaterial."),
        ("Bezeugt", "Nachbarknoten halten gegenseitig den letzten Protokollstand fest."),
    ],
    "Reiter PROTOKOLL: Kette geprüft, Stichprobe mit drei Ablehnungen.",
    "Jede Anmeldung, Abfrage, Ablehnung und Freigabe steht in einem verketteten Protokoll. Wer einen Eintrag ändert, bricht die Kette, und die Prüfung zeigt, wo. Die Aufsicht hat eine eigene Rolle: Sie sieht Protokoll und Messwerte, aber kein Bildmaterial. Eine Einschränkung gehört dazu: Anmeldung und Rechte sind für die Vorführung gebaut, mit drei festen Zugängen.",
)

product(
    "ruecksicht",
    "Rücksicht: Maskierung und vier Augen",
    "Konsole: Einzelbild einer Quelle, das Gesicht der abgebildeten Person ist verpixelt, daneben die Schaltfläche Original anfordern",
    [
        ("Maskiert", "Gesichter werden beim Einspielen verpixelt. Das Original bleibt verschlossen."),
        ("Vier Augen", "Das Original gibt es nur mit Grund und Freigabe einer zweiten Person, für 15 Minuten."),
        ("Mandat", "Ohne Zweck und Rechtsgrundlage keine Suche, keine neue Wache, kein Vorgang."),
    ],
    "Einzelbild mit maskiertem Gesicht. Frei lizenziertes Archivmaterial.",
    "Gesichter werden beim Einspielen verpixelt. Wer das Original braucht, gibt den Grund an und holt die Freigabe einer zweiten, leitenden Person ein; sie gilt für 15 Minuten und steht im Protokoll. Niemand kann sich selbst freigeben. Wie viele Gesichter der Erkenner übersieht, ist nicht gemessen.",
)

# 12 Messwerte


def kv(label, value, last=False):
    cls = "row g-kv row-end" if last else "row g-kv"
    return f'<div class="{cls}"><p class="cell">{label}</p><p class="val">{value}</p></div>'


_n = "Gemessen auf einem Rechner mit vier Kernen ohne Grafikkarte, nachmessbar mit einem Befehl. 13 von 13 Ereignissen des Drehbuchs wurden gemeldet, im Median 1,1 Sekunden nach Eintreffen des ausgewerteten Bildes, bei einer Fehlmeldung; mit einem Direktbild kommt etwa eine halbe Minute Nachlauf hinzu. Zwei Einschränkungen gehören zu jeder dieser Zahlen: Die Wachen wurden an diesem Material formuliert, und das Gefahrenmodell irrt darauf trotz 99 Prozent auf seinem Benchmark. Über die Güte auf echtem Einsatzmaterial sagen die Zahlen nichts. [Bei beschleunigter Übungsuhr weist der Reiter WIRKUNG höhere Werte aus, bei 8× zwei bis drei Sekunden; die 1,1 s stammen aus dem Messlauf in Echtzeit.]"
add("gemessen", "Messwerte: eine Übung, zwei Einschränkungen", f"""
<section id="gemessen" data-transition="fade">
{head("Messwerte: eine Übung, zwei Einschränkungen")}
<div class="split">
<div class="rows w-892">
{kv("Erkannte Ereignisse der Übung", "13 von 13")}
{kv("Erkennungsverzug, Median", f"1,1{NB}s")}
{kv("Fehlmeldungen", "1 von 15")}
{kv("Auswertung gegenüber Echtzeit", "3,3-fach")}
{kv("44 Aufnahmen durchsuchbar nach", f"8{NB}s")}
{kv("Neue Suchanfrage, Median", f"0,1{NB}s")}
{kv("Gefahrenmodell auf AIDERv2", f"99,1{NB}%")}
{kv("Direktbild: Anschluss bis Meldung", f"29{NB}s", last=True)}
</div>
<div class="side">
<div class="pt"><p class="pt-k">Einschränkung 1</p><h3 class="pt-h">Die Wachen wurden am Übungsmaterial formuliert.</h3><p class="pt-v">Die Werte zeigen das Betriebsverhalten, nicht die Güte auf fremdem Material.</p></div>
<div class="pt"><p class="pt-k">Einschränkung 2</p><h3 class="pt-h">Das Gefahrenmodell irrt auf dem Übungsmaterial.</h3><p class="pt-v">Trotz 99,1{NB}% auf seinem Benchmark. Es löst keine Meldungen aus und steht als Zweitmeinung daneben.</p></div>
</div>
</div>
<div class="grow"></div>
<p class="src">Messbericht vom 18.11.2026: vier Prozessorkerne, keine Grafikkarte, Archivmaterial. Verzug ab Eintreffen des ausgewerteten Bildes, ohne Rechenzeit. Direktbild gegen eine simulierte Kamera mit Abschnitten von 10{NB}s.</p>
{foot("Belege")}
<aside>{_n}</aside>
</section>
""", _n)

# 13 Grenzen


def no(n, heading, sub):
    return f'<div class="pt"><p class="pt-k">{n}</p><h3 class="pt-h">{heading}</h3><p class="pt-s">{sub}</p></div>'


_n = "Diese Grenzen sind ein Verkaufsargument, kein Zugeständnis: keine Gesichter, keine Kennzeichen, keine Suche nach Herkunft oder körperlichen Merkmalen, kein zentraler Datenbestand. Ich bin dabei genau: Manches ist Bauart, etwa dass es kein Modell für Gesichter gibt und Aufnahmen den Knoten nicht verlassen. Anderes ist eine Regel mit Protokoll, etwa die Anfrageprüfung, und so nenne ich es auch."
add("grenzen", "Grenzen: was Sicht nicht können soll", f"""
<section id="grenzen" data-transition="fade">
{head("Grenzen: was Sicht nicht können soll")}
<div class="tri">
{no("01", "Keine Gesichtserkennung.", "Kein Abgleich mit Personenbildern. Gesichter sind in allen Bildern maskiert.")}
{no("02", "Keine Kennzeichen.", "Sie werden weder gelesen noch gesucht.")}
{no("03", "Kein Wiederfinden, kein Verfolgen.", "Anfragen nach bestimmten Personen werden abgelehnt. Geschlecht, Alter und Kleidung nur unter einem Mandat, das sie zulässt.")}
{no("04", "Keine geschützten Merkmale.", "Keine Suche nach Herkunft, Religion, Gesundheit, Haarfarbe oder Tätowierungen.")}
{no("05", "Kein zentraler Datenbestand.", "Bilder bleiben bei der Behörde, die sie aufgenommen hat.")}
{no("06", "Kein stilles Weiterlernen.", "Nachschärfen ist ein eigener, protokollierter Schritt.")}
</div>
<div class="grow"></div>
<p class="text">Teils Bauart, teils Regel mit Protokoll. Die Anfrageprüfung ist eine Wortprüfung und lässt sich umschreiben; dafür gibt es Protokoll und Stichprobe.</p>
{foot("Belege")}
<aside>{_n}</aside>
</section>
""", _n)

# 14 Wettbewerb


def comp(name, has, lacks, last=False):
    cls = "row-s g-comp row-end" if last else "row-s g-comp"
    return f'<div class="{cls}"><p class="cell-s strong">{name}</p><p class="cell-s">{has}</p><p class="cell-s dim">{lacks}</p></div>'


_n = "Ich sage nicht, dass das niemand kann: Freitextsuche über Video liefern mehr als zehn Anbieter, und Baden-Württemberg betreibt ein Lagebild von Fraunhofer. Palantir löst die Aufgabe nicht als Produkt, könnte sie aber aus eigenen Bausteinen bauen. Was ich bei keinem Anbieter gefunden habe, ist der Grundsatz, dass im Verbund nur die Frage reist; das ist das Ergebnis einer begrenzten Suche, kein Beweis. Sicht tritt deshalb als Bildschicht an, die sich an vorhandene Systeme anschließt."
add("wettbewerb", "Wettbewerb: der freie Raum ist schmal", f"""
<section id="wettbewerb" data-transition="fade">
{head("Wettbewerb: der freie Raum ist schmal")}
<div class="rows">
<div class="row-s g-comp"><p class="cell-k">Anbieter</p><p class="cell-k">Was sie haben</p><p class="cell-k">Was ihnen fehlt</p></div>
{comp("Fraunhofer IOSB", "Lagebild ELD-BS, in Baden-Württemberg im Einsatz; Auswertung von Drohnenbildern", "Freitextsuche; die Bausteine sind getrennte Projekte")}
{comp("Eurocommand auf Esri", "Stabssoftware CommandX für Feuerwehr und Katastrophenschutz", "Bildsuche über Video in den Quellen nicht gefunden")}
{comp("Milestone, Axis, Genetec", "Freitextsuche über Video, geliefert oder angekündigt; Axis mit Filter und Protokoll", "Kein Produkt für den Bevölkerungsschutz, kein Lagebild")}
{comp("Palantir", "Analyseplattformen der Polizei in mehreren Ländern; Zweckabfrage, Protokoll", "Keine dokumentierte Freitextsuche über Video; kein Produkt im Bevölkerungsschutz")}
{comp("Linker Vision, NVIDIA", "Bild-Sprach-Modelle auf den Kameras der Stadt Kaohsiung, mit Ergebnissen", "Datenschutz und Verbund kommen in den Quellen nicht vor", last=True)}
</div>
<div class="grow"></div>
<div class="tri">
{pt("Was viele können", "Freitextsuche über Video bieten mehr als zehn Anbieter.")}
{pt("Nur die Frage reist", "Bei keinem Anbieter gefunden. Begrenzte Suche, kein Beweis.")}
{pt("Folge", "Sicht ist heute eine Funktion, kein Markt.")}
</div>
<p class="src above-s">Quellen: Herstellerangaben und Presse 2025 bis 2026; Einzelnachweise im Strategiepapier, Abschnitt 4.</p>
{foot("Markt")}
<aside>{_n}</aside>
</section>
""", _n)

# 15 Käufer


def buy(level, who, hurdle, last=False):
    cls = "row g-buy row-end" if last else "row g-buy"
    return f'<div class="{cls}"><p class="cell-k">{level}</p><div><p class="cell">{who}</p><p class="cell dim">{hurdle}</p></div></div>'


_n = "Käufer gibt es auf drei Ebenen. Realistisch ist der Weg von unten: eine bezahlte Erprobung in einer Übung bei einem Kreis mit eigener Drohneneinheit, mit einem Messbericht als Ergebnis. Danach ein zweites Land, dann ein Rahmenvertrag. Ich habe mir ein Abbruchkriterium gesetzt: Sagt bis Ende März 2027 keine Behörde eine Erprobung zu, stimmt die Nachfragethese nicht."
add("kaeufer", "Käufer: der Weg zur ersten Erprobung", f"""
<section id="kaeufer" data-transition="fade">
{head("Käufer: der Weg zur ersten Erprobung")}
<div class="split">
<div class="rows w-872">
{buy("Bund", "BBK mit dem Gemeinsamen Melde- und Lagezentrum; THW mit 669 Ortsverbänden.", "Vor der Entscheidung 2027 kein Bedarfsträger.")}
{buy("Länder", "Innenministerien und Landesämter mit ihren Lagezentren.", "Entscheiden landesweit und sind zum Teil festgelegt.")}
{buy("Kommunen", "400 Kreise und kreisfreie Städte als untere Katastrophenschutzbehörden.", "Kleine Haushalte, Datenschutzprüfung je Kreis.", last=True)}
</div>
<div class="side">
{pt("Schritt 1", "Bezahlte Erprobung bei einem Kreis mit eigener Drohneneinheit: drei Monate, eine Übung, ein Messbericht.")}
{pt("Schritt 2", "Zweite Erprobung in einem anderen Land.")}
{pt("Schritt 3", "Danach das Land: Rahmenvertrag und Verbund.")}
{pt("Abbruchkriterium", "Sagt bis Ende März 2027 keine Behörde eine Erprobung zu, gilt die Nachfragethese als nicht bestätigt.")}
</div>
</div>
<div class="grow"></div>
<p class="src">Quellen: THW · Statistisches Bundesamt über Deutscher Städtetag · BT-Drs. 21/7126, Antwort 28.</p>
{foot("Markt")}
<aside>{_n}</aside>
</section>
""", _n)

# 16 Geschäftsmodell


def price(label, value, last=False):
    cls = "row g-price row-end" if last else "row g-price"
    return f'<div class="{cls}"><p class="cell">{label}</p><p class="num">{value}</p></div>'


_n = "Verkauft wird eine Lizenz je Knoten und Jahr; der Knoten läuft auf Rechnern der Behörde. Alle Preise sind Annahmen, Vergleichspreise für Stabssoftware habe ich nicht gefunden. Rechnet man Deutschland von unten, kommt man bei voller Abdeckung auf rund 25 Millionen Euro im Jahr. Das ist ein kleiner Kernmarkt, und das sage ich lieber selbst."
add("modell", "Geschäftsmodell: Lizenz je Knoten und Jahr", f"""
<section id="modell" data-transition="fade">
{head("Geschäftsmodell: Lizenz je Knoten und Jahr")}
<div class="split">
<div class="col-fixed w-900 gap-16">
<p class="label">Preise · sämtlich Annahmen</p>
<div class="rows">
{price("Erprobung über drei Monate", f"25{NB}000{NB}€ fest")}
{price("Knotenlizenz für einen Kreis", f"48{NB}000{NB}€ je Jahr")}
{price("Landesknoten", f"120{NB}000{NB}€ je Jahr")}
{price("Verbundlizenz eines Landes", f"180{NB}000{NB}€ je Jahr")}
{price("Bundesknoten", f"150{NB}000{NB}€ je Jahr")}
{price("Einführung und Schulung", f"15{NB}000{NB}€ je Knoten", last=True)}
</div>
</div>
<div class="side gap-16">
<p class="label">Markt · von unten gerechnet</p>
<div class="pt"><p class="fig">25,5{NB}Mio.{NB}€</p><p class="pt-v">je Jahr in Deutschland bei vollständiger Abdeckung zu Listenpreisen. Annahme.</p></div>
<div class="pt"><p class="fig">9,6{NB}Mio.{NB}€</p><p class="pt-v">je Jahr erreichbar in fünf Jahren. Annahme.</p></div>
</div>
</div>
<div class="grow"></div>
<p class="text">Der Kernmarkt ist klein: Er trägt ein profitables Fachunternehmen, aber keine Wagnisfinanzierung, die auf ein Vielfaches des Einsatzes zielt.</p>
<p class="src above-m">Quelle: Finanzmodell, Blätter Annahmen und Markt. Der Knoten läuft auf Rechnern der Behörde.</p>
{foot("Markt")}
<aside>{_n}</aside>
</section>
""", _n)

# 17 Fünfjahresfall


def plan_row(label, values, last=False, header=False):
    cls = "row-m g-plan row-end" if last else "row-m g-plan"
    if header:
        cells = "".join(f'<p class="num-k">{v}</p>' for v in values)
        return f'<div class="{cls}"><p class="cell-k">{label}</p>{cells}</div>'
    cells = "".join(f'<p class="num">{v}</p>' for v in values)
    return f'<div class="{cls}"><p class="cell">{label}</p>{cells}</div>'


_n = "Das ist der Basisfall aus der Arbeitsmappe; jede Eingabe ist eine Annahme und in einer Zelle änderbar. Umsatz 2031 rund 2,3 Millionen Euro, erstes positives Betriebsergebnis 2031, Mittelbedarf bis dahin rund 3,2 Millionen. Der Fall hängt an einem einzigen Landesrahmenvertrag im Jahr 2030; ohne ihn sieht es deutlich schlechter aus. Im vorsichtigen Fall trägt sich das Geschäft bis 2031 nicht."
add("plan", "Fünfjahresfall: der Basisfall und seine Annahmen", f"""
<section id="plan" data-transition="fade">
{head("Fünfjahresfall: der Basisfall und seine Annahmen")}
<div class="rows">
{plan_row("Annahmen", ["2027", "2028", "2029", "2030", "2031"], header=True)}
{plan_row("Begonnene Erprobungen", ["2", "5", "8", "12", "16"])}
{plan_row("Knoten am Jahresende, gerundet", ["0", "1", "3", "19", "35"])}
{plan_row(f"Umsatz, Tsd.{NB}€", ["50", "159", "336", f"1{NB}249", f"2{NB}283"])}
{plan_row(f"Betriebsergebnis, Tsd.{NB}€", [f"{MINUS}449", f"{MINUS}832", f"{MINUS}1{NB}050", f"{MINUS}561", "+164"])}
{plan_row("Stellen", ["3", "6,5", "9", "12", "14"], last=True)}
</div>
<div class="grow"></div>
<div class="tri">
<div class="pt"><p class="pt-k">Umsatz 2031</p><p class="fig">2,3{NB}Mio.{NB}€</p></div>
<div class="pt"><p class="pt-k">Erstes positives Ergebnis</p><p class="fig">2031</p></div>
<div class="pt"><p class="pt-k">Mittelbedarf bis 2031</p><p class="fig">3,2{NB}Mio.{NB}€</p></div>
</div>
<p class="text above-m">Der Fall hängt an einem Landesrahmenvertrag 2030. Ohne ihn: Umsatz 2031 1,2{NB}Mio.{NB}€, Ergebnis {MINUS}0,9{NB}Mio.{NB}€, Mittelbedarf 4,6{NB}Mio.{NB}€. Im vorsichtigen Fall trägt sich das Geschäft bis 2031 nicht.</p>
<p class="src above-s">Quelle: Finanzmodell, Szenario Basis. Alle Werte folgen aus Annahmen. Ohne Steuern und Fördermittel.</p>
{foot("Markt")}
<aside>{_n}</aside>
</section>
""", _n)

# 18 Risiken


def risk(n, text, measure, last=False):
    cls = "row-m g-risk row-end" if last else "row-m g-risk"
    return f'<div class="{cls}"><p class="cell dim">{n}</p><p class="cell">{text}</p><p class="cell dim">{measure}</p></div>'


_n = "Das größte Risiko ist rechtlich: Für die KI-Auswertung von Video im Bevölkerungsschutz gibt es keine ausdrückliche Rechtsgrundlage. Das zweite sind die Bestandsanbieter, die die Funktion ergänzen können. Dazu kommen lange Vertriebszyklen, Belege nur aus Archivmaterial und dem Labor, ein ungeprüfter Name und ein einzelner Gründer ohne Herkunft aus der Stabsarbeit. Zu jedem Punkt steht rechts, was ich dagegen tue."
add("risiken", "Risiken: sechs Punkte und die Gegenmaßnahmen", f"""
<section id="risiken" data-transition="fade">
{head("Risiken: sechs Punkte und die Gegenmaßnahmen")}
<div class="rows">
<div class="row-m g-risk"><p class="cell-k">Nr.</p><p class="cell-k">Risiko</p><p class="cell-k">Gegenmaßnahme</p></div>
{risk("1", "Keine ausdrückliche Rechtsgrundlage für die KI-Auswertung von Video.", "Gutachten je Land, frühes Gespräch mit einer Aufsicht, Beginn in Übungen.")}
{risk("2", "Bestandsanbieter ergänzen die Funktion: Fraunhofer IOSB, Esri, Milestone.", "Zulieferrolle anbieten; Verbund und Aufsicht als Bauweise ausbauen.")}
{risk("3", "Vertriebszyklen von 9 bis 18 Monaten; bisher keine belegte Nachfrage.", "Erprobung zum kleinen Festpreis; Abbruchkriterium Ende März 2027.")}
{risk("4", "Belege nur aus Archivmaterial, einem Benchmark und einer simulierten Kamera.", "Erprobung mit Material und Kameras der Behörde; Fehlerraten veröffentlichen.")}
{risk("5", "Der Name Sicht ist nicht markenrechtlich geprüft.", "Recherche bei DPMA und EUIPO vor jeder öffentlichen Verwendung.")}
{risk("6", "Ein Gründer, keine Herkunft aus der Stabsarbeit, keine Referenz.", "Mitgründung aus Stab oder Leitstelle; Beirat aus zwei Praktikern.", last=True)}
</div>
{foot("Markt")}
<aside>{_n}</aside>
</section>
""", _n)

# 19 Stand

_n = "Was läuft, haben Sie gesehen. Direktbilder sind gebaut und im Labor geprüft, mit etwa einer halben Minute Nachlauf; im Feld erprobt sind sie nicht. Meine Bitte ist konkret: eine Behörde, die Sicht drei Monate in einer Übung erprobt und dafür einen Messbericht bekommt. [Vor dem Termin entscheiden, ob um Finanzierung gebeten wird; die Folie nennt den Mittelbedarf des Basisfalls, aber keine Bitte um eine Summe.]"
add("stand", "Stand: was läuft, was fehlt, was gesucht wird", f"""
<section id="stand" data-transition="fade">
{head("Stand: was läuft, was fehlt, was gesucht wird")}
<div class="tri">
{pt("Läuft", "Einspielen, Maskieren, Suchen, Wachen, Lagen, Vorgänge, Verbund, Protokoll, Messung.")}
{pt("Im Labor", "Direktbild mit Nachlauf: gebaut, im Labor geprüft, nicht im Feld erprobt.")}
{pt("Fehlt", "Kopplung an Führungssysteme.<br>Benutzerverwaltung.<br>Messung an Einsatzmaterial.<br>Kunden, Zulassung.<br>Markenprüfung des Namens.")}
</div>
<div class="grow"></div>
<div class="duo-ask">
<div class="pt"><p class="pt-k">Gesucht</p><h3 class="pt-h">Eine Behörde, die Sicht drei Monate in einer Übung erprobt: ein Knoten, ein Messbericht.</h3></div>
<div class="pt"><p class="pt-k">Finanzierung: offen</p><p class="pt-v">Zwei Wege stehen zur Wahl: bis zum ersten Messbericht aus eigenen Mitteln und Forschungsförderung, oder früher eine Runde. Der Basisfall braucht bis 2031 rund 3,2{NB}Mio.{NB}€ (Annahme).</p></div>
</div>
{foot("Stand")}
<aside>{_n}</aside>
</section>
""", _n)

# 20 Schluss

_n = "Keine Sicht ohne Aufsicht: Das ist der Satz, an dem Sie mich messen können. Gern zeige ich Ihnen das System jetzt in Betrieb. Fragen beantworte ich direkt, auch die unbequemen."
add("schluss", "Schluss", f"""
<section id="schluss" class="cover">
<div class="bk bk-tl"></div><div class="bk bk-tr"></div><div class="bk bk-bl"></div><div class="bk bk-br"></div>
<div class="cover-top">
<p class="mark">SICHT</p>
<p class="label">Erprobungsstand · Übungsmaterial · keine Behördenkunden</p>
</div>
<div class="grow"></div>
<div class="cover-main">
<h2 class="claim">Keine Sicht<br>ohne Aufsicht.</h2>
<p class="lede dim">No sight without oversight.</p>
</div>
<aside>{_n}</aside>
</section>
""", _n)

# ---------------------------------------------------------------------------------------------

INDEX = {
    "v": 5,
    "createdOnFiles": {"v": 1, "at": "2026-11-18T03:00:00Z"},
    "lists": "css",
    "format": {"v": 1, "shared": ["project/deck.css"]},
    "title": "Sicht – Präsentation",
    "cover": "titel",
    "order": ORDER,
    "sections": {
        "s1": {"description": "Das Problem an einem belegten Fall, das Muster dahinter und warum der Zeitpunkt zählt.", "start": "titel"},
        "s2": {"description": "Was Sicht ist und wie es arbeitet, gezeigt an der laufenden Konsole.", "start": "sicht"},
        "s3": {"description": "Was gemessen ist, mit seinen Einschränkungen, und was Sicht bewusst nicht kann.", "start": "gemessen"},
        "s4": {"description": "Wettbewerb, Käufer, Geschäftsmodell, Fünfjahresfall und Risiken.", "start": "wettbewerb"},
        "s5": {"description": "Stand, Bitte um eine Erprobung und Schluss.", "start": "stand"},
    },
    "faces": {
        "jetbrains-mono": {
            "family": "JetBrains Mono",
            "href": "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap",
        }
    },
    "designSystems": [],
}


def main():
    DE.write(ROOT, INDEX, NOTES_FILE, [
        "# Sicht – Sprechzettel zur Präsentation",
        "",
        "Zwei bis vier Sätze je Folie. Dieselben Texte stehen als Notizen in der Präsentation.",
        "Text in eckigen Klammern ist eine Erinnerung an den Vortragenden und wird nicht gesprochen.",
        "",
    ])
    print(len(SLIDES), "slides,", NOTES_FILE.name)


if __name__ == "__main__":
    main()
