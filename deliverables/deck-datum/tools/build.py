#!/usr/bin/env python3
"""Writes the files of the DATUM deck and its speaker notes.

    python3 deliverables/deck-datum/tools/build.py

Output:
    deliverables/deck-datum/project/deck.json          index of the Slides artifact
    deliverables/deck-datum/project/deck.css           shared rules (the design of the Sicht deck)
    deliverables/deck-datum/project/slides/<id>.html   one slide each
    deliverables/DATUM-Praesentation-Sprechzettel.md

Every figure comes from docs/DATUM.md and docs/measurements/datum-geolocation.json. The pictures
are screenshots of the console (tools/blobs.json maps their artifact addresses to local files for
the PDF: node deliverables/deck-datum/tools/render.cjs --pdf deliverables/DATUM-Praesentation.pdf).
"""
import json
import pathlib
import runpy

DECK = pathlib.Path(__file__).resolve().parent.parent
ROOT = DECK / "project"
NOTES_FILE = DECK.parent / "DATUM-Praesentation-Sprechzettel.md"
MEASURE = DECK.parent.parent / "docs" / "measurements" / "datum-geolocation.json"

# Design: the same type scale, hairlines and corner marks as the Sicht deck.
_sicht = runpy.run_path(str(DECK.parent / "deck" / "tools" / "build.py"))
CSS = _sicht["CSS"] + """
/* DATUM additions */
.g-step { grid-template-columns: 72px 360px 1fr; }
.g-acc { grid-template-columns: 1fr 176px 176px 176px 176px 176px; gap: 20px; }
.acc-h { font-size: 24px; letter-spacing: 2px; text-transform: uppercase; color: #8a8a8a; text-align: right; }
.acc-h-l { font-size: 24px; letter-spacing: 2px; text-transform: uppercase; color: #8a8a8a; }
"""

NB = " "

# Picture key -> address of the picture uploaded to the Slides artifact. tools/blobs.json maps the
# same addresses to the files in deliverables/deck-datum/assets for the PDF.
_BLOBS = json.loads((pathlib.Path(__file__).parent / "blobs.json").read_text(encoding="utf-8"))
IMG = {pathlib.Path(file).stem: f"/_blob/{blob}" for blob, file in _BLOBS.items()}


def img(key):
    if key not in IMG:
        raise KeyError(f"picture '{key}' is not uploaded (tools/blobs.json)")
    return IMG[key]


def secs(v):
    return f"{v:.1f}".replace(".", ",") + f"{NB}s"


def pct(v):
    return f"{round(v * 100)}{NB}%"


def km(v):
    if v < 10:
        return f"{v:.1f}".replace(".", ",") + f"{NB}km"
    return f"{round(v):,}".replace(",", NB) + f"{NB}km"


M = json.loads(MEASURE.read_text(encoding="utf-8"))["summary"]
# Figures of the running node shown in the screenshots (written by the screenshot script).
LIVE = json.loads((pathlib.Path(__file__).parent / "live.json").read_text(encoding="utf-8"))
OPEN_T = M["open"]["test"]
UNK_T = M["unknown"]["test"]
OPEN_A = M["open"]["all"]
UNK_A = M["unknown"]["all"]
BASE_T = json.loads(MEASURE.read_text(encoding="utf-8")).get("baselineZeroShotCentroidTestUnknown")

SLIDES, NOTES, ORDER = {}, {}, []


def foot(section):
    return (
        '<div class="foot"><p class="foot-mark">DATUM</p>'
        f'<div class="foot-right"><p class="foot-sec">{section}</p><div class="pg"></div></div></div>'
    )


def head(title):
    return f'<h2 class="title">{title}</h2>'


def pt(label, text):
    return f'<div class="pt"><p class="pt-k">{label}</p><p class="pt-v">{text}</p></div>'


def corners(key, alt):
    return (
        f'<div class="shot"><img class="shot-img" src="{img(key)}" alt="{alt}">'
        '<div class="c c-tl"></div><div class="c c-tr"></div><div class="c c-bl"></div><div class="c c-br"></div></div>'
    )


def add(sid, heading, html, notes):
    assert sid not in SLIDES, sid
    assert "<" not in notes, sid
    SLIDES[sid] = html.strip() + "\n"
    NOTES[sid] = (heading, notes)
    ORDER.append(sid)


def product(sid, title, key, alt, points, caption, notes, section="Produkt"):
    side = "\n".join(pt(k, v) for k, v in points)
    add(sid, title, f"""
<section id="{sid}" data-transition="fade">
{head(title)}
<div class="split">
<div class="figure">
{corners(key, alt)}
<p class="cap">{caption}</p>
</div>
<div class="side-spread">
{side}
</div>
</div>
{foot(section)}
<aside>{notes}</aside>
</section>
""", notes)


# 1 Titel
_n = "DATUM ist ein Wort aus der Vermessung: der Bezugspunkt, von dem aus alles andere gemessen wird. Ich zeige ein laufendes System im Erprobungsstand. Es nimmt ein Video und sagt, wo und wann es aufgenommen wurde, mit Unsicherheit und Belegen, und es baut aus einem einzelnen Bild einen Raum, in den man hineingehen kann. Alles läuft auf einem Rechner, ohne Dienst im Netz."
add("titel", "Titel", f"""
<section id="titel" class="cover" data-transition="fade">
<div class="bk bk-tl"></div><div class="bk bk-tr"></div><div class="bk bk-bl"></div><div class="bk bk-br"></div>
<div class="cover-top">
<p class="mark">DATUM</p>
<p class="label">Erprobungsstand · November 2026</p>
</div>
<div class="grow"></div>
<div class="cover-main">
<h1 class="claim">Jedes Bild hat<br>einen Ort und<br>eine Uhrzeit.</h1>
<p class="lede dim">Ort, Zeit und Raum aus einem einzigen Video. Auf eigenem Rechner.</p>
</div>
<aside>{_n}</aside>
</section>
""", _n)

# 2 Problem
_n = "Jedes Ereignis erzeugt heute Videos, die zuerst in sozialen Netzen auftauchen. Wo und wann sie entstanden, steht fast nie dabei. In unserem eigenen Referenzbestand trägt kein einziges der 60 Videos noch GPS oder eine brauchbare Aufnahmezeit. Heute ordnet ein Mensch sie von Hand zu: Gelände vergleichen, Gebäude suchen, Schatten deuten. Das ist gute Arbeit und sie skaliert nicht."
add("problem", "Videos ohne Ort und Zeit", f"""
<section id="problem" data-transition="fade">
{head("Videos ohne Ort und Zeit")}
<div class="split">
<div class="col-fixed w-1052">
<p class="lede">Jedes Ereignis erzeugt Videos, lange bevor ein Bericht entsteht. Wo und wann sie aufgenommen wurden, steht fast nie dabei.</p>
<p class="lede">Heute ordnet ein Mensch sie von Hand zu: Gelände vergleichen, Gebäude suchen, Schatten deuten, Sonnenstand rechnen.</p>
</div>
<div class="side">
{pt("Im eigenen Referenzbestand", f"0 von 60 Videos tragen noch GPS oder eine brauchbare Aufnahmezeit.")}
{pt("Was fehlt", "Eine Maschine, die in Sekunden einen begründeten Vorschlag macht, den ein Mensch prüft.")}
</div>
</div>
<div class="grow"></div>
<p class="src">Referenzbestand: 60 Videos aus Wikimedia Commons mit bekanntem Aufnahmeort (Wikidata), ausgewertet am 18.11.2026.</p>
{foot("Problem")}
<aside>{_n}</aside>
</section>
""", _n)

# 3 Ortung
product(
    "ortung", "Ortung: jedes Video auf der Karte", "ortung", "Weltkarte mit georteten Videos",
    [
        ("Ort", "Koordinaten, MGRS und ein Unsicherheitskreis, der sagt, wie weit man ihm trauen kann."),
        ("Zeit", "Uhrzeitfenster in Ortszeit aus dem Sonnenstand; exakt, wenn die Datei die Zeit trägt."),
        ("Sonne", "Richtung der Sonne und der Schatten auf der Karte, für Ort und Zeit gerechnet."),
    ],
    f"Reiter ORTUNG: der Fernsehturm-Clip, {km(LIVE['towerKm'])} neben der Wahrheit",
    "Die Karte ist selbst gezeichnet aus OpenStreetMap-Daten, ohne Kartendienst. Jede Aufnahme bekommt einen Ort mit Kreis, eine Uhrzeit und den Sonnenstand. "
    f"Hier der Berliner Fernsehturm, gefilmt von der Spree aus: DATUM erkennt die Umgebung und landet {km(LIVE['towerKm'])} neben der Koordinate des Turms.",
)

# 4 Befund
product(
    "befund", "Befund: jede Aussage mit Beleg", "befund", "Befund mit Belegen, Uhr und Ablauf",
    [
        ("Belege", "Referenzbilder, die gepasst haben, Länderschätzung, Metadaten, Licht und Jahreszeit, je mit Gewicht."),
        ("Uhr", "24-Stunden-Zifferblatt mit Zeitfenstern, Sonnenauf- und -untergang."),
        ("Ablauf", "Jeder Schritt der Auswertung mit seiner Rechenzeit, live während der Ortung."),
    ],
    f"Reiter BEFUND: Belege, Uhrzeit und Ablauf in {secs(LIVE['towerSeconds'])}",
    "Nichts wird ohne Begründung behauptet. Jede Ortung zeigt, welche Referenzbilder gepasst haben, wie sicher das Land ist und woraus die Uhrzeit folgt. "
    f"Der Ablauf zeigt jeden Schritt mit seiner Zeit; diese Ortung hat {secs(LIVE['towerSeconds'])} gedauert, mit Raum und Gelände.",
)

# 5 Raum
product(
    "raum", "Raum: in das Video hineingehen", "raum", "Begehbarer Raum aus einem Videobild",
    [
        ("Aus einem Bild", "Tiefenschätzung je Bildpunkt, Himmel, Boden und Neigung der Kamera."),
        ("Begehbar", "W A S D, Maus, hoch und runter; der erste Blick ist genau das Videobild."),
        ("Selbst geschrieben", "WebGL ohne fremde 3D-Bibliothek; läuft im Browser der Behörde."),
    ],
    "Reiter RAUM: ein Bild des Clips als begehbarer Raum",
    "Aus einem einzigen Bild wird ein Raum: Wie weit ist jede Fläche entfernt, wo ist der Boden, wie war die Kamera geneigt. Man kann hineingehen und das Gebäude von der Seite sehen. Was im Bild verdeckt war, fehlt natürlich; der Raum ist geschätzt, nicht vermessen.",
)

# 6 Gelände
product(
    "gelaende", "Gelände: Sonne und Horizont am Fundort", "gelaende", "Gelände in 3D mit Sonnenbahn",
    [
        ("Höhenmodell", "Gelände um den Fundort aus Höhendaten, mit Höhenlinien und Schatten der Sonne."),
        ("Sonnenbahn", "Der Lauf der Sonne an diesem Tag über dem Standpunkt."),
        ("Horizont", "Der berechnete Horizont gegen die Himmelslinie des Videos; passt er, folgt die Blickrichtung, wenn der Ort stimmt."),
    ],
    "Reiter RAUM, Gelände: Glenfinnan mit Sonnenbahn",
    "Für den Fundort zeigt DATUM das Gelände aus Höhendaten, die Sonnenbahn des Tages und den Horizont. Hier Glenfinnan im schottischen Hochland. "
    "Wo das Gelände markant ist, wird der berechnete Horizont mit der Himmelslinie im Video verglichen; passt er, folgt die Blickrichtung der Kamera, vorausgesetzt der Ort stimmt. "
    "In Städten und im Flachland greift das nicht; die Prüfung verlangt deshalb ein Relief von mindestens einem Grad im Bildausschnitt.",
)

# 7 Verfahren
steps = [
    ("1", "Metadaten", "GPS und Aufnahmezeit aus der Datei, wenn vorhanden: exakt."),
    ("2", "Wiedererkennung", "12 Bilder mit je drei Ausschnitten gegen 6 393 Referenzbilder."),
    ("3", "Länderschätzung", "Das Bild-Text-Modell schätzt das Land ohne eigenes Training."),
    ("4", "Licht und Jahreszeit", "Tag, Dämmerung, Nacht, Sonnenhöhe; Vegetation und Schnee."),
    ("5", "Sonnenstand", "Sonnenbahn für Ort und Datum, Zeitfenster in Ortszeit."),
    ("6", "Raum", "Tiefe je Bildpunkt aus drei Schlüsselbildern, Himmelslinie."),
    ("7", "Horizont", "Himmelslinie gegen Höhendaten: Blickrichtung und Bildwinkel."),
]
rows = "\n".join(
    f'<div class="row g-step{" row-end" if i == len(steps) - 1 else ""}"><p class="cell-k">{n}</p><p class="cell strong">{a}</p><p class="cell">{b}</p></div>'
    for i, (n, a, b) in enumerate(steps)
)
_n = "Sieben Schritte, alle auf dem eigenen Rechner. Am stärksten sind die Metadaten, wenn es sie gibt, danach die Wiedererkennung gegen Referenzbilder mit Koordinaten. Die Länderschätzung trägt, wenn nichts Bekanntes im Bild ist. Sonne, Raum und Horizont kommen aus Rechnung und Geometrie. Zur Laufzeit wird kein Dienst im Netz gefragt."
add("verfahren", "Sieben Schritte, alle auf dem eigenen Rechner", f"""
<section id="verfahren" data-transition="fade">
{head("Sieben Schritte, alle auf dem eigenen Rechner")}
<div class="rows">
{rows}
</div>
<div class="grow"></div>
<p class="src">Modelle: SigLIP 2 (Apache-2.0), Depth Anything V2 Small (Apache-2.0). Sonnenstand nach NOAA. Karten- und Höhendaten: OpenStreetMap, Mapzen Terrain. Rund 5 s je Video auf vier Prozessorkernen ohne Grafikkarte.</p>
{foot("Verfahren")}
<aside>{_n}</aside>
</section>
""", _n)

# 8 Gemessen
def acc_row(label, s, last=False):
    cls = "row g-acc row-end" if last else "row g-acc"
    return (
        f'<div class="{cls}"><p class="cell">{label}</p><p class="num">{km(s["medianKm"])}</p><p class="num">{pct(s["acc1km"])}</p>'
        f'<p class="num">{pct(s["acc25km"])}</p><p class="num">{pct(s["acc2500km"])}</p><p class="num">{pct(s["withinRadius"])}</p></div>'
    )


_n = (
    f"Gemessen an 60 Videos mit bekanntem Ort, die Schwellen nur an der einen Hälfte eingestellt, berichtet an der anderen. "
    f"Liegt ein Referenzbild desselben Bauwerks in der Galerie, landen {pct(OPEN_T['acc1km'])} der Prüfhälfte innerhalb eines Kilometers und {pct(OPEN_T['acc2500km'])} innerhalb von 2 500 Kilometern. "
    f"Ist der Ort unbekannt, bleibt eine Schätzung auf Land- und Kontinentebene: {pct(UNK_T['acc25km'])} innerhalb 25 Kilometern, {pct(UNK_T['acc2500km'])} innerhalb 2 500. "
    f"Die letzte Spalte ist der Fortschritt dieser Runde: Der Unsicherheitskreis sagt jetzt ehrlich, wie weit man der Ortung trauen kann; die Wahrheit lag in {pct(OPEN_T['withinRadius'])} und {pct(UNK_T['withinRadius'])} der Fälle darin, vorher in 43 und 17 %. "
    "Der Abstand zwischen den ersten beiden Zeilen ist der Hebel: Liegen die Orte des Zielgebiets in der Galerie, gilt die obere. Wahllos mehr Bilder helfen nicht; 11 552 zusätzliche, weltweit gestreute Referenzbilder haben die Abstimmungshälfte verschlechtert, weil Doppelgänger das richtige Bauwerk verdrängen. Die dritte Zeile zeigt, was die Länderschätzung allein leistet."
)
add("gemessen", "Gemessen gegen die Grundwahrheit", f"""
<section id="gemessen" data-transition="fade">
{head("Gemessen gegen die Grundwahrheit")}
<div class="rows">
<div class="row g-acc"><p class="acc-h-l">Prüfhälfte, 30 Videos</p><p class="acc-h">Median</p><p class="acc-h">≤ 1 km</p><p class="acc-h">≤ 25 km</p><p class="acc-h">≤ 2 500 km</p><p class="acc-h">im Kreis</p></div>
{acc_row("Referenzbild des Ortes in der Galerie", OPEN_T)}
{acc_row("Ort ohne Referenzbild (unbekannt)", UNK_T, last=BASE_T is None)}
{acc_row("Nur Länderschätzung, ohne Galerie", BASE_T, last=True) if BASE_T else ""}
</div>
<div class="grow"></div>
<div class="duo">
{pt("Protokoll", "Schwellen nur an der Abstimmungshälfte eingestellt; die Prüfhälfte wurde nur gemessen. Grundwahrheit: Koordinate des Wikidata-Objekts.")}
{pt("Im Kreis", "Anteil, bei dem die Wahrheit im angegebenen Unsicherheitskreis liegt; vorher 43 und 17 %. 30 Videos je Hälfte: Anteile schwanken um rund neun Punkte.")}
</div>
<p class="src above-m">pnpm datum:evaluate · docs/measurements/datum-geolocation.json · 18.11.2026</p>
{foot("Belege")}
<aside>{_n}</aside>
</section>
""", _n)

# 9 Grenzen und Grauzone
_n = "DATUM ortet Aufnahmen, nicht Personen. Aber derselbe Dienst kann verraten, wo jemand gefilmt hat. Deshalb sind die Leitplanken eingebaut, nicht versprochen: Mandat mit Zweck, Protokoll, das sich prüfen lässt, maskierte Gesichter, keine Gesichtserkennung. Und vertraglich: kein Einsatz gegen Journalisten und Opposition, keine Lieferung an Staaten ohne Rechtsstaat. Die Ausfuhr aus der EU ist vor jeder Lieferung zu prüfen."
add("grenzen", "Grauzone mit Leitplanken", f"""
<section id="grenzen" data-transition="fade">
{head("Grauzone mit Leitplanken")}
<div class="split">
<div class="col-fixed w-1052">
<p class="lede">DATUM ortet Aufnahmen, nicht Personen. Derselbe Dienst kann aber verraten, wo jemand gefilmt hat.</p>
<p class="lede dim">Deshalb sind die Grenzen gebaut, nicht nur versprochen.</p>
</div>
<div class="side">
{pt("Im Produkt", "Mandat mit Zweck, verkettetes Protokoll, maskierte Gesichter, keine Gesichtserkennung.")}
{pt("Im Vertrag", "Kein Einsatz gegen Journalisten, Opposition oder Filmende ohne Rechtsgrundlage; keine Lieferung an Staaten ohne Rechtsstaat.")}
{pt("Vor jeder Lieferung", "Ausfuhrkontrolle prüfen: Überwachungstechnik kann nach der EU-Dual-Use-Verordnung genehmigungspflichtig sein.")}
</div>
</div>
{foot("Grenzen")}
<aside>{_n}</aside>
</section>
""", _n)

# 10 Abgrenzung
_n = "Palantir führt vorhandene Daten zusammen. DATUM erzeugt neue Daten aus Pixeln, nämlich Ort und Zeit, und liefert sie in solche Systeme. Wir treten nicht gegen die großen Plattformen an, wir liefern ihnen zu. Ob jemand anderes das schon so anbietet, habe ich nur begrenzt recherchiert; die Teile gibt es, offene Recherche macht das heute von Hand."
add("abgrenzung", "Zulieferer, nicht Konkurrent", f"""
<section id="abgrenzung" data-transition="fade">
{head("Zulieferer, nicht Konkurrent")}
<div class="duo">
<div class="col">
<p class="label">Plattformen wie Palantir</p>
<p class="lede">Führen vorhandene Daten zusammen: Register, Meldungen, Bewegungen.</p>
</div>
<div class="col">
<p class="label">DATUM</p>
<p class="lede">Erzeugt neue Daten aus Pixeln: Ort, Zeit, Blickrichtung, Raum. Liefert sie als Datensatz mit Belegen zu.</p>
</div>
</div>
<div class="grow"></div>
<div class="duo">
{pt("Heute", "Offene Recherche ortet Videos von Hand; Forschung zeigt Teile davon.")}
{pt("Offen", "Ob ein Anbieter dasselbe als Produkt für Behörden liefert: nur begrenzt recherchiert.")}
</div>
{foot("Markt")}
<aside>{_n}</aside>
</section>
""", _n)

# 11 Weg
_n = "Der nächste Hebel ist die Galerie, aber gezielt: Referenzbilder des Zielgebiets und eine Zweitprüfung der besten Treffer, damit Doppelgänger nicht gewinnen. Wahllos mehr Bilder haben es in unserer Messung schlechter gemacht. Danach eine Erprobung mit Material einer Behörde, gemessen wie hier. Vor einem Vertrag in den USA stehen eine eigene Gesellschaft dort und eine anwaltliche Prüfung von Ausfuhr und Eigentümerkontrolle."
add("weg", "Die nächsten Schritte", f"""
<section id="weg" data-transition="fade">
{head("Die nächsten Schritte")}
<div class="tri">
{pt("1 · Galerie", "Referenzbilder des Zielgebiets und eine Zweitprüfung der besten Treffer gegen Doppelgänger.")}
{pt("2 · Erprobung", "Material einer Behörde, gemessen nach demselben Protokoll wie hier.")}
{pt("3 · Zulieferung", "Fixe als Datensatz mit Belegen in bestehende Lagesysteme.")}
{pt("4 · Gesellschaft", "Eigene Gesellschaft im Zielland; Eigentümerkontrolle und Ausfuhr anwaltlich prüfen.")}
{pt("5 · Zeit", "Uhrzeit mit Videos bekannter Aufnahmezeit nachmessen.")}
{pt("6 · Prüfung", "Sicherheitsprüfung von außen vor jedem Einsatz mit echten Daten.")}
</div>
{foot("Weg")}
<aside>{_n}</aside>
</section>
""", _n)

# 12 Schluss
_n = "DATUM. Jedes Bild hat einen Ort und eine Uhrzeit. Ich zeige es Ihnen gern am System."
add("schluss", "Schluss", f"""
<section id="schluss" class="cover" data-transition="fade">
<div class="bk bk-tl"></div><div class="bk bk-tr"></div><div class="bk bk-bl"></div><div class="bk bk-br"></div>
<div class="cover-top"><p class="mark">DATUM</p><p class="label">Erprobungsstand</p></div>
<div class="grow"></div>
<div class="cover-main">
<h1 class="claim">Jedes Bild hat<br>einen Ort und<br>eine Uhrzeit.</h1>
<p class="lede dim">Vorführung am System auf Anfrage.</p>
</div>
<aside>{_n}</aside>
</section>
""", _n)

INDEX = {
    "v": 5,
    "createdOnFiles": {"v": 1, "at": "2026-11-18T15:00:00Z"},
    "lists": "css",
    "format": {"v": 1, "shared": ["project/deck.css"]},
    "title": "DATUM – Präsentation",
    "cover": "titel",
    "order": ORDER,
    "sections": {
        "s1": {"description": "Das Problem: Videos ohne Ort und Zeit.", "start": "titel"},
        "s2": {"description": "Was DATUM zeigt, an der laufenden Konsole: Ortung, Befund, Raum, Gelände.", "start": "ortung"},
        "s3": {"description": "Wie es arbeitet und was gemessen ist, mit seinen Grenzen.", "start": "verfahren"},
        "s4": {"description": "Grauzone, Abgrenzung und die nächsten Schritte.", "start": "grenzen"},
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
    (ROOT / "slides").mkdir(parents=True, exist_ok=True)
    for old in (ROOT / "slides").glob("*.html"):
        if old.stem not in SLIDES:
            old.unlink()
    (ROOT / "deck.css").write_text(CSS, encoding="utf-8")
    (ROOT / "deck.json").write_text(json.dumps(INDEX, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    for sid, html in SLIDES.items():
        (ROOT / "slides" / f"{sid}.html").write_text(html, encoding="utf-8")
    lines = ["# DATUM – Sprechzettel zur Präsentation", "", "Zwei bis vier Sätze je Folie. Dieselben Texte stehen als Notizen in der Präsentation.", ""]
    for i, sid in enumerate(ORDER, start=1):
        heading, text = NOTES[sid]
        lines += [f"## {i:02d} · {heading}", "", text, ""]
    NOTES_FILE.write_text("\n".join(lines), encoding="utf-8")
    print(len(SLIDES), "slides,", NOTES_FILE.name)


if __name__ == "__main__":
    main()
