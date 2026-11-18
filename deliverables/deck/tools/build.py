#!/usr/bin/env python3
"""Writes the deck's files (project/deck.json, project/deck.css, project/slides/*.html).

The deck is the content of a Slides artifact; this script is its source so that wording and
numbers can be changed in one place and re-sent. Figures come from docs/EVALUATION.md,
docs/BRAND.md, docs/STRATEGY.md and deliverables/Sicht-Finanzmodell.xlsx (scenario Basis).
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent / "project"
NB = " "  # no-break space inside figures

IMG = {
    "lage": "/_blob/4695bf63a4aa94f997c762478b6d778e",
    "wachen": "/_blob/38a5f55858f24bb77a9db4c76d9fb041",
    "suche": "/_blob/71d0c0b7d262958db35bdf73ad700e7a",
    "verbund": "/_blob/b8c2874d369bda9e06485a269570f69c",
    "protokoll": "/_blob/9932eb7218a29bb103199dd9a8949c9c",
    "maskiert": "/_blob/cf407bc079cfbaece77e35d8a56e92d1",
}

CSS = """/* Sicht: one typeface, black ground, hairlines, corner marks. No colour. */
body { font-family: 'JetBrains Mono', 'Courier New', monospace; color: #ededed; }
section { background: #050505; color: #ededed; padding: 128px 128px 160px; display: flex; flex-direction: column; counter-increment: page; font-family: 'JetBrains Mono', 'Courier New', monospace; font-size: 28px; line-height: 1.4; }

/* type scale: 120 / 56 / 36 / 28 / 24 */
.claim { font-size: 120px; font-weight: 500; line-height: 1.06; letter-spacing: -3px; color: #ededed; }
.title { font-size: 56px; font-weight: 500; line-height: 1.12; letter-spacing: -1px; color: #ededed; }
.statement { font-size: 56px; font-weight: 500; line-height: 1.16; letter-spacing: -1px; color: #ededed; }
.lede { font-size: 36px; font-weight: 400; line-height: 1.32; color: #ededed; }
.text { font-size: 28px; font-weight: 400; line-height: 1.4; color: #ededed; }
.label { font-size: 24px; font-weight: 400; line-height: 1.3; letter-spacing: 5px; text-transform: uppercase; color: #8a8a8a; }
.src { font-size: 24px; font-weight: 400; line-height: 1.35; color: #8a8a8a; }
.mark { font-size: 36px; font-weight: 700; line-height: 1; letter-spacing: 28px; color: #ededed; }
.dim { color: #8a8a8a; }
.strong { font-weight: 500; }

/* structure */
.head { display: flex; flex-direction: column; gap: 20px; }
.rule { border-top: 1px solid #333333; }
.gap-s { height: 16px; flex: none; }
.gap-m { height: 32px; flex: none; }
.gap-l { height: 48px; flex: none; }
.grow { flex: 1; }
.split { display: flex; gap: 56px; }
.wide { width: 1040px; flex: none; display: flex; flex-direction: column; gap: 28px; }
.half { flex: 1; display: flex; flex-direction: column; gap: 18px; }
.side { flex: 1; display: flex; flex-direction: column; gap: 22px; }
.tri { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 48px; }
.duo { display: grid; grid-template-columns: 1fr 1fr; gap: 56px; }

/* a labelled point: hairline, label, one sentence */
.pt { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid #333333; padding-top: 18px; }
.pt-k { font-size: 24px; font-weight: 400; line-height: 1.3; letter-spacing: 5px; text-transform: uppercase; color: #8a8a8a; }
.pt-v { font-size: 28px; font-weight: 400; line-height: 1.4; color: #ededed; }
.pt-h { font-size: 36px; font-weight: 500; line-height: 1.2; color: #ededed; }
.pt-s { font-size: 24px; font-weight: 400; line-height: 1.4; color: #8a8a8a; }
.fig { font-size: 56px; font-weight: 500; line-height: 1.1; letter-spacing: -1px; color: #ededed; }

/* screenshot with the corner marks of the console */
.shot { position: relative; width: 1088px; height: 680px; flex: none; background: #0b0b0b; }
.shot-img { width: 1088px; height: 680px; object-fit: contain; }
.c { position: absolute; width: 26px; height: 26px; }
.c-tl { left: -12px; top: -12px; border-top: 2px solid #ededed; border-left: 2px solid #ededed; }
.c-tr { right: -12px; top: -12px; border-top: 2px solid #ededed; border-right: 2px solid #ededed; }
.c-bl { left: -12px; bottom: -12px; border-bottom: 2px solid #ededed; border-left: 2px solid #ededed; }
.c-br { right: -12px; bottom: -12px; border-bottom: 2px solid #ededed; border-right: 2px solid #ededed; }
.cap { font-size: 24px; font-weight: 400; line-height: 1.35; color: #8a8a8a; }

/* rows with hairlines instead of table borders */
.rows { display: flex; flex-direction: column; }
.row { display: grid; gap: 32px; padding: 14px 0; border-top: 1px solid #333333; align-items: baseline; }
.row-last { border-bottom: 1px solid #333333; }
.row-tight { padding: 10px 0; }
.g-kv { grid-template-columns: 1fr 340px; }
.g-why { grid-template-columns: 250px 1fr 400px; }
.g-comp { grid-template-columns: 300px 1fr 1fr; }
.g-buy { grid-template-columns: 200px 1fr; }
.g-risk { grid-template-columns: 56px 1fr 1fr; }
.g-plan { grid-template-columns: 420px 1fr 1fr 1fr 1fr 1fr; gap: 24px; }
.cell { font-size: 28px; font-weight: 400; line-height: 1.4; color: #ededed; }
.cell-s { font-size: 24px; font-weight: 400; line-height: 1.3; color: #ededed; }
.cell-k { font-size: 24px; font-weight: 400; line-height: 1.3; letter-spacing: 5px; text-transform: uppercase; color: #8a8a8a; }
.val { font-size: 36px; font-weight: 500; line-height: 1.1; color: #ededed; text-align: right; }
.num { font-size: 28px; font-weight: 400; line-height: 1.4; color: #ededed; text-align: right; }
.num-k { font-size: 24px; font-weight: 400; line-height: 1.3; letter-spacing: 5px; color: #8a8a8a; text-align: right; }

/* cover and closing */
.cover { padding: 128px; }
.cover-mid { display: flex; flex-direction: column; gap: 44px; }
.bk { position: absolute; width: 56px; height: 56px; }
.bk-tl { left: 56px; top: 56px; border-top: 2px solid #ededed; border-left: 2px solid #ededed; }
.bk-tr { right: 56px; top: 56px; border-top: 2px solid #ededed; border-right: 2px solid #ededed; }
.bk-bl { left: 56px; bottom: 56px; border-bottom: 2px solid #ededed; border-left: 2px solid #ededed; }
.bk-br { right: 56px; bottom: 56px; border-bottom: 2px solid #ededed; border-right: 2px solid #ededed; }

/* footer band: one row, same place on every content slide */
.foot { position: absolute; left: 128px; bottom: 64px; width: 1664px; display: flex; justify-content: space-between; align-items: baseline; }
.foot-mark { font-size: 24px; font-weight: 700; line-height: 1; letter-spacing: 10px; color: #8a8a8a; }
.foot-sec { font-size: 24px; font-weight: 400; line-height: 1; letter-spacing: 5px; text-transform: uppercase; color: #8a8a8a; }
.foot-src { font-size: 24px; font-weight: 400; line-height: 1; color: #8a8a8a; }
.pg { font-size: 24px; line-height: 1; color: #8a8a8a; }
.pg::after { content: counter(page); }
"""


def foot(middle, source=False):
    cls = "foot-src" if source else "foot-sec"
    return f'<div class="foot"><p class="foot-mark">SICHT</p><p class="{cls}">{middle}</p><div class="pg"></div></div>'


def head(title):
    return f'<div class="head"><h2 class="title">{title}</h2><hr class="rule"></div>\n<div class="gap-m"></div>'


def pt(label, text):
    return f'<div class="pt"><p class="pt-k">{label}</p><p class="pt-v">{text}</p></div>'


def shot_slide(sid, title, image, alt, points, caption, section, notes):
    side = "\n".join(pt(k, v) for k, v in points)
    return f"""<section id="{sid}" data-transition="fade">
{head(title)}
<div class="split">
<div class="shot">
<img class="shot-img" src="{IMG[image]}" alt="{alt}">
<div class="c c-tl"></div><div class="c c-tr"></div><div class="c c-bl"></div><div class="c c-br"></div>
</div>
<div class="side">
{side}
<div class="grow"></div>
<p class="cap">{caption}</p>
</div>
</div>
{foot(section)}
<aside>{notes}</aside>
</section>
"""


SLIDES = {}

SLIDES["titel"] = f"""<section id="titel" class="cover" data-transition="fade">
<div class="bk bk-tl"></div><div class="bk bk-tr"></div><div class="bk bk-bl"></div><div class="bk bk-br"></div>
<p class="label">Erprobungsstand · November 2026</p>
<div class="grow"></div>
<div class="cover-mid">
<p class="mark">SICHT</p>
<h1 class="claim">Keine Sicht<br>ohne Aufsicht.</h1>
<p class="lede dim">Die Bildschicht für das zivile Lagebild.</p>
</div>
<div class="grow"></div>
<p class="label">Vorführung mit Übungsmaterial · keine Echtdaten</p>
<aside>Sicht ist ein Wort, das jede Einsatzkraft kennt: „Wir haben Sicht“ heißt, die Lage ist erfasst. Ich zeige Ihnen heute ein laufendes System im Erprobungsstand, keine Folienidee. Der Leitsatz ist das Produktversprechen: Jede Auswertung hat einen Zweck, eine verantwortliche Person und einen Protokolleintrag.</aside>
</section>
"""

SLIDES["ahrtal"] = f"""<section id="ahrtal" data-transition="fade">
<p class="label">Ahrtal · 14. Juli 2021</p>
<div class="gap-s"></div>
<h2 class="claim">22:14 Uhr</h2>
<div class="gap-l"></div>
<div class="split">
<div class="wide">
<p class="lede">Ein Polizeihubschrauber filmt zwischen 22:14 und 22:43 Uhr die Orte von Mayschoß bis Schuld: bis zum Dachgeschoss überflutete Häuser und Menschen, die mit Lampen auf sich aufmerksam machen.</p>
<p class="lede">Die Videos werden „nicht ordnungsgemäß verbucht“. Bis September 2022 gehen Untersuchungsausschuss und Staatsanwaltschaft davon aus, dass es solche Aufnahmen nicht gibt.</p>
</div>
<div class="side">
{pt("Bilanz", "Mindestens 135 Tote im Ahrtal.")}
{pt("Nicht belegt", "Ob die Aufnahmen die Einsatzleitung des Kreises erreicht haben.")}
</div>
</div>
<div class="grow"></div>
<p class="src">Quellen: dpa über Volksstimme, 05.10.2022 · epd über evangelisch.de, 04.10.2022 · dpa über Deutsches Ärzteblatt, 02.08.2024</p>
{foot("Problem")}
<aside>Das ist der Fall, an dem ich das Problem festmache. Belegt ist, dass der Hubschrauber gefilmt hat und dass die Videos nicht ordnungsgemäß verbucht wurden; Ausschuss und Staatsanwaltschaft wussten bis September 2022 nichts von ihnen. Ob die Aufnahmen die Einsatzleitung erreicht haben, belegt keine Quelle, deshalb behaupte ich es nicht. Die Bilder gab es. Ein Lagebild daraus gab es nicht.</aside>
</section>
"""

SLIDES["muster"] = f"""<section id="muster" data-transition="fade">
{head("Das Muster über den Einzelfall hinaus")}
<div class="split">
<div class="half">
<p class="label">Los Angeles · Januar 2025</p>
<p class="lede">Einsatzkräfte und Einsatzleitungen konnten Echtzeitinformationen nicht verlässlich teilen: unzuverlässiger Mobilfunk, uneinheitliche Meldewege, „various unconnected platforms“.</p>
<p class="src">County of Los Angeles, Auswertungsbericht, Kernaussagen, 25.09.2025</p>
</div>
<div class="half">
<p class="label">Maui · 8. August 2023</p>
<p class="lede">Mindestens 102 Tote. Nachträglich werden rund 850 Gigabyte Video-, Ton-, Bild- und Schriftmaterial veröffentlicht, darunter Aufnahmen von Körperkameras der Polizei.</p>
<p class="src">Generalstaatsanwaltschaft Hawaii, Mitteilung 2024-40, 13.09.2024</p>
</div>
</div>
<div class="grow"></div>
<div class="duo">
{pt("Was die Belege tragen", "Bildmaterial entsteht im Einsatz und erreicht die Stelle, die entscheidet, oft nicht oder zu spät.")}
{pt("Was sie nicht tragen", "Dass durchsuchbares Video einen dieser Verläufe geändert hätte. Software behebt kein Organisationsversagen.")}
</div>
{foot("Problem")}
<aside>Zwei weitere amtlich dokumentierte Fälle. In Los Angeles hält der Bericht des County fest, dass Echtzeitinformationen nicht verlässlich geteilt werden konnten. Auf Maui wurden nachträglich 850 Gigabyte Material veröffentlicht; das Material war also da. Ich sage ausdrücklich nicht, dass Software einen dieser Verläufe geändert hätte. Ich sage: Die Strecke vom Bild zur Lagekenntnis ist die Schwachstelle.</aside>
</section>
"""

SLIDES["jetzt"] = f"""<section id="jetzt" data-transition="fade">
{head("Warum jetzt")}
<div class="rows">
<div class="row g-why">
<p class="cell-k">Lagebild</p>
<p class="cell">„Der Bund entwickelt mit den Ländern ein gemeinsames digitales Lagebild Inland für den Bevölkerungsschutz, damit alle Verantwortlichen eine einheitliche Informationsgrundlage für ihre Einsätze haben, digital und in Echtzeit.“</p>
<p class="src">BMI, Eckpunkte, 20.05.2026, S. 5</p>
</div>
<div class="row g-why">
<p class="cell-k">Zeitfenster</p>
<p class="cell">2026 wurde „eine erste Pilotanwendung erfolgreich entwickelt“. 2027 wird über den gemeinsamen Wirkbetrieb von Bund und Ländern entschieden.</p>
<p class="src">BT-Drs. 21/7120, Antwort 56</p>
</div>
<div class="row g-why row-last">
<p class="cell-k">Haushalt</p>
<p class="cell">Zehn Milliarden Euro bis 2029 für den Bevölkerungsschutz. Es sind bereits eingeplante Haushaltsmittel, „kein Förderprogramm“. Käufer sind BBK und THW.</p>
<p class="src">BMI, Eckpunkte, S. 3 · BT-Drs. 21/7126</p>
</div>
</div>
<div class="grow"></div>
<p class="lede">Die Forderung nach dem Lagebild steht in einem Regierungspapier. Die Forderung nach Bildsuche darin steht nirgends.</p>
{foot("Problem")}
<aside>Der Bund baut mit den Ländern ein digitales Lagebild; 2027 fällt die Entscheidung über den Wirkbetrieb. Wer bis dahin nicht als Zulieferer bekannt ist, kommt in die erste Ausbaustufe nicht hinein. Die zehn Milliarden sind eingeplante Haushaltsmittel, kein Topf, aus dem man Mittel beantragt. Und offen gesagt: Bildsuche im Lagebild hat bisher keine Behörde verlangt.</aside>
</section>
"""

SLIDES["sicht"] = f"""<section id="sicht" data-transition="fade">
<p class="label">Was Sicht ist</p>
<div class="gap-m"></div>
<h2 class="statement">Sicht macht das Videomaterial, das Behörden im Einsatz ohnehin erzeugen, in Sekunden durchsuchbar und beobachtet es selbständig auf Gefahrenlagen.</h2>
<div class="gap-m"></div>
<p class="lede dim">Ohne Personen zu identifizieren, ohne Daten zusammenzuführen und mit einem Protokoll, das jede Abfrage nachweist.</p>
<div class="grow"></div>
<p class="label">Der messbare Zweck: Zeit von der Aufnahme bis zur Lagekenntnis</p>
<div class="gap-s"></div>
<div class="tri">
{pt("Erkennungsverzug", "Sekunden vom ersten Bild eines Ereignisses bis zur Meldung auf der Lagekarte.")}
{pt("Sichtungsquote", "Anteil der eingegangenen Aufzeichnungen, die vollständig ausgewertet sind.")}
{pt("Protokollierte Abfragen", "Eine Antwort wird erst nach dem Protokolleintrag ausgeliefert.")}
</div>
{foot("Produkt")}
<aside>Sicht ist die Bildschicht für das zivile Lagebild, kein weiteres Führungssystem. Der Zweck ist messbar: die Zeit vom ersten Bild eines Ereignisses bis zur Meldung auf der Lagekarte. Das System weist diese Zahl in jeder Übung selbst aus. Heute verarbeitet es eingespielte Aufzeichnungen; laufende Bildströme sind noch nicht angebunden.</aside>
</section>
"""

SLIDES["lage"] = shot_slide(
    "lage",
    "Übersicht: die Lage auf einer Karte",
    "lage",
    "Konsole, Reiter Lage: Karte von Koblenz mit elf Quellen, Meldungen und Lagen während der Übung",
    [
        ("Elf Quellen", "Drohnen, Festkameras, Erkundungstrupps und ein Hinweisportal."),
        ("Eigene Karte", "Aus OpenStreetMap-Daten selbst gezeichnet, mit UTMREF-Gitter."),
        ("Lagen", "Meldungen gleicher Art am selben Ort; mehrere Quellen gelten als Bestätigung."),
    ],
    "Reiter LAGE · Übung RHEIN-MOSEL · Archivmaterial, keine Echtlage",
    "Produkt",
    "Das ist der Hauptbildschirm während der Übung RHEIN-MOSEL. Elf Quellen, jede mit Standort und Eigentümer. Die Karte ist selbst gezeichnet und läuft ohne Netz; unten links steht die UTMREF-Koordinate wie auf jeder Einsatzkarte. Rechts laufen die Meldungen ein und werden zu Lagen zusammengefasst.",
)

SLIDES["wachen"] = shot_slide(
    "wachen",
    "Vorsicht: Wachen melden, Menschen urteilen",
    "wachen",
    "Konsole, Reiter Wachen: die Wache Umgestürzter Lastkraftwagen in Version 2 mit einer bestätigten und einer verworfenen Meldung",
    [
        ("In Worten", "Eine Wache ist ein Satz, kein trainiertes Modell. Sie sieht jedes eintreffende Bild."),
        ("Eine Fehlmeldung", "Die abgerutschte Fahrbahn wird als umgestürzter Lastwagen gemeldet."),
        ("Nachgeschärft", "Verworfen, den echten Unfall bestätigt, Version 2. Im Folgelauf keine Fehlmeldung."),
    ],
    "Reiter WACHEN · Wache in Version 2 · Übungsmaterial",
    "Produkt",
    "Eine Wache ist ein stehender Suchauftrag in Worten. In der Übung macht eine Wache einen Fehler, und ich zeige ihn, statt ihn zu verstecken. Die Auswerterin verwirft die Meldung, bestätigt die richtige und schärft die Wache ausdrücklich nach; der Schritt steht im Protokoll und lässt sich zurücknehmen. Im nächsten Lauf kommt die Fehlmeldung nicht wieder, der echte Unfall wird weiter gemeldet.",
)

SLIDES["suche"] = shot_slide(
    "suche",
    "Einsicht: suchen in eigenen Worten",
    "suche",
    "Konsole, Reiter Suche: Treffer zur Anfrage überflutete Wiese und Antworten der Nachbarknoten",
    [
        ("Freitext, auf Deutsch", "Kein Schlagwortkatalog. Verglichen wird mit dem Inhalt jedes Bildes."),
        ("Wird abgelehnt", "„Gesicht von Herrn Müller“<br>„Kennzeichen KO AB 123“<br>„südländischer Mann“"),
        ("Im Protokoll", "Jede Anfrage und jede Ablehnung, mit Mandat und Person."),
    ],
    "Reiter SUCHE · Anfrage „überflutete Wiese“ · rechts Antworten aus dem Verbund",
    "Produkt",
    "Gesucht wird in ganzen Wendungen, auf Deutsch oder Englisch. Das Bildmodell ist SigLIP 2 unter Apache-2.0-Lizenz und läuft ohne Netz auf dem Rechner der Behörde. Namen, Gesichter, Kennzeichen, Herkunft und körperliche Merkmale werden abgelehnt, die Ablehnung wird protokolliert. Die Prüfung ist eine nachvollziehbare Wortprüfung; sie lässt sich umschreiben, deshalb gibt es Protokoll und Stichprobe.",
)

SLIDES["verbund"] = shot_slide(
    "verbund",
    "Weitsicht: nur die Frage reist",
    "verbund",
    "Konsole, Reiter Verbund: Karte mit den Knoten Koblenz, Trier und Mainz und ihren Verbindungen",
    [
        ("Es reist", "Die Frage in Worten, mit Mandat, anfragender Person und Signatur."),
        ("Es bleibt", "Aufnahmen, Verzeichnis und Protokoll bei der Behörde, die aufgenommen hat."),
        ("Es kommt zurück", "Höchstens zwölf maskierte Vorschaubilder und eine Belegnummer."),
    ],
    "Reiter VERBUND · drei Knoten auf einem Rechner (Vorführung)",
    "Produkt",
    "Jede Behörde betreibt ihren eigenen Knoten. Im Verbund reist nur die Frage; der Nachbar prüft sie nach seinen Regeln, protokolliert sie und gibt maskierte Vorschaubilder mit einer Belegnummer zurück. Diesen Grundsatz habe ich in der Recherche bei keinem Anbieter gefunden. In der Vorführung laufen die drei Knoten auf einem Rechner; ein Verbund über ein echtes Netz ist nicht gemessen.",
)

SLIDES["aufsicht"] = shot_slide(
    "aufsicht",
    "Aufsicht: ein Protokoll, das sich prüfen lässt",
    "protokoll",
    "Konsole, Reiter Protokoll: Zahl der Einträge, letzter Stand und das Ergebnis der Kettenprüfung",
    [
        ("Verkettet", "Jeder Eintrag enthält die Prüfsumme seines Vorgängers."),
        ("Stichprobe", "Die Aufsicht prüft zufällig gezogene Abfragen, ohne Bilder zu sehen."),
        ("Bezeugt", "Nachbarknoten halten den Protokollstand des anderen fest."),
    ],
    "Reiter PROTOKOLL · Kette geprüft · Übungsbetrieb",
    "Produkt",
    "Jede Anmeldung, Abfrage, Ablehnung und Freigabe steht in einem verketteten Protokoll. Wer einen Eintrag ändert, bricht die Kette; die Prüfung zeigt, wo. Die Aufsicht hat eine eigene Rolle: Sie sieht Protokoll und Messwerte, aber kein Bildmaterial. Eine Einschränkung gehört dazu: Anmeldung und Rechte sind für die Vorführung gebaut, mit drei festen Zugängen.",
)

SLIDES["ruecksicht"] = shot_slide(
    "ruecksicht",
    "Rücksicht: Gesichter sind maskiert",
    "maskiert",
    "Konsole: Einzelbild einer Quelle, das Gesicht der abgebildeten Person ist verpixelt",
    [
        ("Immer", "Verpixelt beim Einspielen. Das Original bleibt verschlossen."),
        ("Vier Augen", "Original nur mit Grund und zweiter Person, für 15 Minuten."),
        ("Mandat", "Ohne Zweck und Rechtsgrundlage keine Suche, keine Wache, kein Vorgang."),
    ],
    "Einzelbild einer Quelle · frei lizenziertes Archivmaterial",
    "Produkt",
    "Gesichter werden beim Einspielen verpixelt. Wer das Original braucht, gibt den Grund an und holt die Freigabe einer zweiten, leitenden Person ein; sie gilt für 15 Minuten und steht im Protokoll. Niemand kann sich selbst freigeben. Wie viele Gesichter der Erkenner übersieht, ist nicht gemessen.",
)


def kv(label, value, last=False):
    cls = "row g-kv row-last" if last else "row g-kv"
    return f'<div class="{cls}"><p class="cell">{label}</p><p class="val">{value}</p></div>'


SLIDES["gemessen"] = f"""<section id="gemessen" data-transition="fade">
{head("Gemessen, mit zwei Einschränkungen")}
<div class="split">
<div class="rows" style="width:940px; flex:none">
{kv("Erkannte Ereignisse der Übung", "13 von 13")}
{kv("Erkennungsverzug, Median", f"1,1{NB}s")}
{kv("Fehlmeldungen", "1 von 15")}
{kv("Auswertung von Aufzeichnungen", f"3,3{NB}× Echtzeit")}
{kv("Erste Durchsuchbarkeit, 44 Aufnahmen", f"14{NB}s")}
{kv("Suche im Knoten, Median", f"6{NB}ms")}
{kv("Gefahrenmodell auf seinem Benchmark", f"99,1{NB}%", last=True)}
</div>
<div class="side">
{pt("Einschränkung 1", "Die Wachen der Übung wurden am Übungsmaterial formuliert. Die Werte zeigen das Betriebsverhalten, nicht die Güte auf fremdem Einsatzmaterial.")}
{pt("Einschränkung 2", "Das Gefahrenmodell irrt auf dem Übungsmaterial trotz seines Benchmarkwerts. Es löst keine Meldungen aus, sondern steht als Zweitmeinung daneben.")}
</div>
</div>
<div class="grow"></div>
<p class="src">Vier Prozessorkerne, keine Grafikkarte · Verzug ab Eintreffen des ausgewerteten Bildes, ohne die Rechenzeit der Auswertung · Archivmaterial</p>
{foot("Belege")}
<aside>Das sind Messwerte von einem Rechner mit vier Kernen ohne Grafikkarte, nachmessbar mit einem Befehl. 13 von 13 Ereignissen im Drehbuch wurden gemeldet, im Median nach 1,1 Sekunden, mit einer Fehlmeldung. Zwei Einschränkungen gehören zu jeder dieser Zahlen: Die Wachen wurden an diesem Material formuliert, und das trainierte Gefahrenmodell irrt auf dem Übungsmaterial trotz 99 Prozent auf seinem Benchmark. Über die Güte auf echtem Einsatzmaterial sagen die Zahlen nichts.</aside>
</section>
"""


def no(n, heading, sub):
    return f'<div class="pt"><p class="pt-k">{n}</p><h3 class="pt-h">{heading}</h3><p class="pt-s">{sub}</p></div>'


SLIDES["grenzen"] = f"""<section id="grenzen" data-transition="fade">
{head("Was Sicht nicht kann und nicht können soll")}
<div class="tri">
{no("01", "Keine Gesichtserkennung.", "Kein Abgleich mit Personenbildern. Gesichter sind in allen Bildern maskiert.")}
{no("02", "Keine Kennzeichen.", "Sie werden weder gelesen noch gesucht.")}
{no("03", "Kein Wiederfinden, kein Verfolgen.", "Anfragen nach bestimmten Personen werden abgelehnt. Geschlecht, Alter, Kleidung nur unter ausdrücklichem Mandat.")}
{no("04", "Keine geschützten Merkmale.", "Keine Suche nach Herkunft, Religion, Gesundheit, Haarfarbe oder Tätowierungen.")}
{no("05", "Kein zentraler Datenbestand.", "Bilder bleiben bei der Behörde, die sie aufgenommen hat.")}
{no("06", "Kein stilles Weiterlernen.", "Nachschärfen ist ein eigener, protokollierter Schritt.")}
</div>
<div class="grow"></div>
<p class="text">Teils Bauart, teils Regel mit Protokoll. Die Anfrageprüfung ist eine Wortprüfung und lässt sich umschreiben; dafür gibt es Protokoll und Stichprobe.</p>
{foot("Belege")}
<aside>Diese Grenzen sind ein Verkaufsargument, kein Zugeständnis. Keine Gesichter, keine Kennzeichen, keine Suche nach Herkunft oder körperlichen Merkmalen, kein zentraler Datenbestand. Ich bin dabei genau: Manches ist Bauart, etwa dass es kein Modell für Gesichter gibt und Aufnahmen den Knoten nicht verlassen. Anderes ist eine Regel mit Protokoll, etwa die Anfrageprüfung, und so nenne ich es auch.</aside>
</section>
"""


def comp(name, has, lacks, last=False):
    cls = "row row-tight g-comp row-last" if last else "row row-tight g-comp"
    return f'<div class="{cls}"><p class="cell-s strong">{name}</p><p class="cell-s">{has}</p><p class="cell-s dim">{lacks}</p></div>'


SLIDES["wettbewerb"] = f"""<section id="wettbewerb" data-transition="fade">
{head("Abgrenzung: der freie Raum ist schmal")}
<div class="rows">
<div class="row row-tight g-comp"><p class="cell-k">Anbieter</p><p class="cell-k">Was sie haben</p><p class="cell-k">Was ihnen fehlt</p></div>
{comp("Fraunhofer IOSB", "Lagedarstellung ELD-BS, in Baden-Württemberg im Einsatz; Drohnenbildauswertung", "Freitextsuche; die Bausteine sind getrennte Projekte")}
{comp("Eurocommand auf Esri", "Stabssoftware CommandX für Feuerwehr und Katastrophenschutz", "Bildsuche über Video in den Quellen nicht gefunden")}
{comp("Milestone, Axis, Genetec", "Freitextsuche im Videomanagement, teils vor Ort, mit Anfragefilter und Protokoll", "Kein Produkt für den Bevölkerungsschutz, kein Lagebild")}
{comp("Palantir", "Analyseplattformen der Polizei in mehreren Ländern; Zweckabfrage, Protokoll", "Keine dokumentierte Freitextsuche über Video; kein Produkt im Bevölkerungsschutz")}
{comp("Linker Vision, NVIDIA", "Bild-Sprach-Modelle auf den Kameras der Stadt Kaohsiung, mit Ergebnissen", "Datenschutz und Verbund kommen in den Quellen nicht vor", last=True)}
</div>
<div class="grow"></div>
<div class="tri">
{pt("Eng", "Freitextsuche über Video liefern mehr als zehn Anbieter.")}
{pt("Bei keinem gefunden", "Im Verbund reist nur die Frage. Ergebnis einer begrenzten Suche, kein Beweis.")}
{pt("Folge", "Sicht ist heute eine Funktion, kein Markt, und tritt als Bildschicht an.")}
</div>
{foot("Einzelnachweise im Strategiepapier, Abschnitt 4 · Stand November 2026", source=True)}
<aside>Ich sage nicht, dass das niemand kann. Freitextsuche über Video liefern mehr als zehn Anbieter, und Baden-Württemberg betreibt ein Lagebild von Fraunhofer. Palantir löst die Aufgabe nicht als Produkt, könnte sie aber aus eigenen Bausteinen bauen. Was ich bei keinem Anbieter gefunden habe, ist der Grundsatz, dass im Verbund nur die Frage reist; das ist das Ergebnis einer begrenzten Suche, kein Beweis. Sicht tritt deshalb als Bildschicht an, die sich an vorhandene Systeme anschließt.</aside>
</section>
"""


def buy(level, who, hurdle, last=False):
    cls = "row g-buy row-last" if last else "row g-buy"
    return f'<div class="{cls}"><p class="cell-k">{level}</p><div><p class="cell">{who}</p><p class="cell dim">{hurdle}</p></div></div>'


SLIDES["kaeufer"] = f"""<section id="kaeufer" data-transition="fade">
{head("Käufer und der Weg zur ersten Erprobung")}
<div class="split" style="gap:64px">
<div class="rows" style="width:880px; flex:none">
{buy("Bund", "BBK mit dem Gemeinsamen Melde- und Lagezentrum; THW mit 669 Ortsverbänden.", "Vor der Entscheidung 2027 kein Bedarfsträger.")}
{buy("Länder", "Innenministerien und Landesämter mit ihren Lagezentren.", "Entscheiden landesweit und sind zum Teil festgelegt.")}
{buy("Kommunen", "400 Kreise und kreisfreie Städte als untere Katastrophenschutzbehörden.", "Kleine Haushalte, Datenschutzprüfung je Kreis.", last=True)}
</div>
<div class="side" style="gap:20px">
{pt("Schritt 1", "Bezahlte Erprobung bei einem Kreis mit eigener Drohneneinheit: drei Monate, eine Übung, ein Messbericht.")}
{pt("Schritt 2", "Zweite Erprobung in einem anderen Land.")}
{pt("Schritt 3", "Dann das Land: Rahmenvertrag und Verbund.")}
{pt("Abbruchkriterium", "Sagt bis Ende März 2027 keine Behörde eine Erprobung zu, ist die Nachfragethese nicht bestätigt.")}
</div>
</div>
{foot("Quellen: THW · Statistisches Bundesamt über Deutscher Städtetag · BT-Drs. 21/7126", source=True)}
<aside>Käufer gibt es auf drei Ebenen. Realistisch ist der Weg von unten: eine bezahlte Erprobung in einer Übung bei einem Kreis mit eigener Drohneneinheit, mit einem Messbericht als Ergebnis. Danach ein zweites Land, dann ein Rahmenvertrag. Ich habe mir ein Abbruchkriterium gesetzt: Wenn bis Ende März 2027 keine Behörde eine Erprobung zusagt, stimmt die Nachfragethese nicht.</aside>
</section>
"""


def price(label, value, last=False):
    cls = "row g-kv row-last" if last else "row g-kv"
    return f'<div class="{cls}"><p class="cell">{label}</p><p class="num">{value}</p></div>'


SLIDES["modell"] = f"""<section id="modell" data-transition="fade">
{head("Geschäftsmodell: Lizenz je Knoten und Jahr")}
<div class="split" style="gap:64px">
<div style="width:960px; flex:none; display:flex; flex-direction:column; gap:14px">
<p class="label">Preise · sämtlich Annahmen</p>
<div class="rows">
{price("Erprobung: drei Monate, ein Knoten, Messbericht", f"25{NB}000{NB}€ fest")}
{price("Knotenlizenz, Kreis oder Leitstelle", f"48{NB}000{NB}€ je Jahr")}
{price("Landesknoten", f"120{NB}000{NB}€ je Jahr")}
{price("Verbundlizenz eines Landes", f"180{NB}000{NB}€ je Jahr")}
{price("Bundesknoten", f"150{NB}000{NB}€ je Jahr")}
{price("Einführung und Schulung je Knoten", f"15{NB}000{NB}€ einmalig", last=True)}
</div>
</div>
<div class="side" style="gap:26px">
<p class="label">Markt · von unten gerechnet</p>
<div class="pt"><p class="fig">25,5{NB}Mio.{NB}€</p><p class="pt-v">je Jahr in Deutschland bei vollständiger Abdeckung zu Listenpreisen (Annahme).</p></div>
<div class="pt"><p class="fig">9,6{NB}Mio.{NB}€</p><p class="pt-v">je Jahr erreichbar in fünf Jahren (Annahme).</p></div>
</div>
</div>
<div class="grow"></div>
<p class="text">Der Knoten läuft auf Rechnern der Behörde. Der Kernmarkt ist klein: Er trägt ein profitables Fachunternehmen, aber keine Wagnisfinanzierung, die auf ein Vielfaches des Einsatzes zielt.</p>
{foot("Quelle: Finanzmodell, Blätter Annahmen und Markt · alle Werte Annahmen", source=True)}
<aside>Verkauft wird eine Lizenz je Knoten und Jahr; der Knoten läuft auf Rechnern der Behörde. Alle Preise sind Annahmen, Vergleichspreise für Stabssoftware habe ich nicht gefunden. Rechnet man Deutschland von unten, kommt man bei voller Abdeckung auf rund 25 Millionen Euro im Jahr. Das ist ein kleiner Kernmarkt, und das sage ich lieber selbst.</aside>
</section>
"""


def plan_row(label, values, last=False, header=False):
    cls = "row g-plan row-last" if last else "row g-plan"
    if header:
        cells = "".join(f'<p class="num-k">{v}</p>' for v in values)
        return f'<div class="{cls}"><p class="cell-k">{label}</p>{cells}</div>'
    cells = "".join(f'<p class="num">{v}</p>' for v in values)
    return f'<div class="{cls}"><p class="cell">{label}</p>{cells}</div>'


M = "−"
SLIDES["plan"] = f"""<section id="plan" data-transition="fade">
{head("Fünf Jahre im Basisfall")}
<div class="rows">
{plan_row("Annahmen", ["2027", "2028", "2029", "2030", "2031"], header=True)}
{plan_row("Begonnene Erprobungen", ["2", "5", "8", "12", "16"])}
{plan_row("Knoten am Jahresende", ["0", "1", "3", "19", "35"])}
{plan_row("Umsatz, Tsd. €", ["50", "159", "336", f"1{NB}249", f"2{NB}283"])}
{plan_row("Betriebsergebnis, Tsd. €", [f"{M}449", f"{M}832", f"{M}1{NB}050", f"{M}561", "+164"])}
{plan_row("Stellen", ["3", "6,5", "9", "12", "14"], last=True)}
</div>
<div class="grow"></div>
<div class="tri">
<div class="pt"><p class="pt-k">Mittelbedarf bis 2031</p><p class="fig">3,2{NB}Mio.{NB}€</p></div>
<div class="pt"><p class="pt-k">Erstes positives Betriebsergebnis</p><p class="fig">2031</p></div>
{pt("Empfindlichkeit", f"Ohne den einen Landesrahmenvertrag 2030: Umsatz 2031 1,2{NB}Mio.{NB}€, Ergebnis {M}0,9{NB}Mio.{NB}€. Im vorsichtigen Fall trägt sich das Geschäft bis 2031 nicht.")}
</div>
{foot("Quelle: Finanzmodell, Szenario Basis · Erwartungswerte gerundet · ohne Steuern und Fördermittel", source=True)}
<aside>Das ist der Basisfall aus der Arbeitsmappe; jede Eingabe ist eine Annahme und in einer Zelle änderbar. Umsatz 2031 rund 2,3 Millionen Euro, erstes positives Betriebsergebnis 2031, Mittelbedarf bis dahin rund 3,2 Millionen. Der Fall hängt an einem einzigen Landesrahmenvertrag im Jahr 2030; ohne ihn sieht es deutlich schlechter aus. Im vorsichtigen Fall trägt sich das Geschäft bis 2031 nicht.</aside>
</section>
"""


def risk(n, text, measure, last=False):
    cls = "row row-tight g-risk row-last" if last else "row row-tight g-risk"
    return f'<div class="{cls}"><p class="cell dim">{n}</p><p class="cell">{text}</p><p class="cell dim">{measure}</p></div>'


SLIDES["risiken"] = f"""<section id="risiken" data-transition="fade">
{head("Risiken und was dagegen getan wird")}
<div class="rows">
<div class="row row-tight g-risk"><p class="cell-k">Nr.</p><p class="cell-k">Risiko</p><p class="cell-k">Gegenmaßnahme</p></div>
{risk("1", "Keine ausdrückliche Rechtsgrundlage für die KI-Auswertung von Video.", "Gutachten je Land, frühes Gespräch mit einer Aufsicht, Beginn in Übungen.")}
{risk("2", "Bestandsanbieter ergänzen die Funktion: Fraunhofer IOSB, Esri, Milestone.", "Zulieferrolle anbieten; Verbund und Aufsicht als Bauweise ausbauen.")}
{risk("3", "Vertriebszyklen von 9 bis 18 Monaten; bisher keine belegte Nachfrage.", "Erprobung zum kleinen Festpreis; Abbruchkriterium Ende März 2027.")}
{risk("4", "Belege nur aus Archivmaterial und einem Benchmark mit ähnlichen Bildern.", "Erprobung mit Material der Behörde; Fehlerraten veröffentlichen.")}
{risk("5", "Der Name Sicht ist nicht markenrechtlich geprüft.", "Recherche bei DPMA und EUIPO vor jeder öffentlichen Verwendung.")}
{risk("6", "Ein Gründer, keine Herkunft aus der Stabsarbeit, keine Referenz.", "Mitgründung aus Stab oder Leitstelle; Beirat aus zwei Praktikern.", last=True)}
</div>
{foot("Markt")}
<aside>Das größte Risiko ist rechtlich: Für die KI-Auswertung von Video im Bevölkerungsschutz gibt es keine ausdrückliche Rechtsgrundlage. Das zweite sind die Bestandsanbieter, die die Funktion ergänzen können. Dazu kommen lange Vertriebszyklen, Belege nur aus Archivmaterial, ein ungeprüfter Name und ein einzelner Gründer ohne Herkunft aus der Stabsarbeit. Zu jedem Punkt steht rechts, was ich dagegen tue.</aside>
</section>
"""

SLIDES["stand"] = f"""<section id="stand" data-transition="fade">
{head("Stand und Bitte")}
<div class="tri">
{pt("Läuft", "Einspielen, Maskieren, Suchen, Wachen, Lagen, Vorgänge, Verbund, Protokoll, Messung. 15 automatische Prüfungen; Abläufe in drei Rollen im Browser geprüft.")}
{pt("Fehlt", "Direktbilder. Kopplung an ein vorhandenes Führungssystem. Benutzerverwaltung. Messung an Einsatzmaterial. Kunden, Zulassung, Markenprüfung.")}
{pt("Gesucht", "Eine Behörde für eine Erprobung in einer Übung: drei Monate, ein Knoten, ein Messbericht mit Erkennungsverzug, Fehlmeldungen und übersehenen Ereignissen.")}
</div>
<div class="grow"></div>
{pt("Finanzierung: offen", "Zur Entscheidung steht, ob bis zum ersten Messbericht aus eigenen Mitteln und Forschungsförderung gearbeitet wird oder früher eine Finanzierungsrunde folgt.")}
{foot("Stand")}
<aside>Was läuft, haben Sie gesehen. Was fehlt, steht in der Mitte: Direktbilder, die Kopplung an ein vorhandenes Führungssystem, Benutzerverwaltung, Messung an echtem Material. Meine Bitte ist konkret: eine Behörde, die Sicht drei Monate in einer Übung erprobt und dafür einen Messbericht bekommt. [Vor der Vorstellung festlegen, ob und was zur Finanzierung gesagt wird; auf der Folie steht bewusst keine Summe.]</aside>
</section>
"""

SLIDES["schluss"] = f"""<section id="schluss" class="cover">
<div class="bk bk-tl"></div><div class="bk bk-tr"></div><div class="bk bk-bl"></div><div class="bk bk-br"></div>
<p class="label">Erprobungsstand · Übungsmaterial · keine Behördenkunden</p>
<div class="grow"></div>
<div class="cover-mid">
<p class="mark">SICHT</p>
<h2 class="claim">Keine Sicht<br>ohne Aufsicht.</h2>
<p class="lede dim">Die Vorführung am laufenden System folgt im Anschluss.</p>
</div>
<div class="grow"></div>
<p class="label">Fragen, auch die unbequemen</p>
<aside>Keine Sicht ohne Aufsicht: Das ist der Satz, an dem Sie mich messen können. Ich zeige Ihnen das System jetzt in Betrieb. Fragen beantworte ich direkt, auch die unbequemen.</aside>
</section>
"""

ORDER = [
    "titel", "ahrtal", "muster", "jetzt", "sicht", "lage", "wachen", "suche", "verbund", "aufsicht",
    "ruecksicht", "gemessen", "grenzen", "wettbewerb", "kaeufer", "modell", "plan", "risiken", "stand", "schluss",
]

INDEX = {
    "v": 5,
    "createdOnFiles": {"v": 1, "at": "2026-11-18T02:40:00Z"},
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
    (ROOT / "slides").mkdir(parents=True, exist_ok=True)
    (ROOT / "deck.css").write_text(CSS, encoding="utf-8")
    (ROOT / "deck.json").write_text(json.dumps(INDEX, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    assert set(ORDER) == set(SLIDES), set(ORDER) ^ set(SLIDES)
    for sid, html in SLIDES.items():
        (ROOT / "slides" / f"{sid}.html").write_text(html, encoding="utf-8")
    print(len(SLIDES), "slides written")


if __name__ == "__main__":
    main()
