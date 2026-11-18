"""
Erzeugt deliverables/Sicht-Finanzmodell.xlsx.

    python3 docs/finanzmodell/build.py

Alle Rechenwege stehen als Formeln in der Arbeitsmappe; dieses Skript schreibt nur Eingabewerte,
Beschriftungen und Formeln. Wer Annahmen in Excel ändert, arbeitet danach mit der Arbeitsmappe
weiter: ein erneuter Lauf dieses Skripts überschreibt sie mit den hier hinterlegten Werten.
"""
from pathlib import Path

from openpyxl import Workbook
from openpyxl.chart import LineChart, Reference, Series
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "deliverables" / "Sicht-Finanzmodell.xlsx"

FONT = "Arial"
BLUE, BLACK, GREEN, GREY = "0000FF", "000000", "008000", "595959"
YELLOW = PatternFill("solid", start_color="FFFF00")
BAND = PatternFill("solid", start_color="EDEDED")
THIN = Side(style="thin", color="000000")
HAIR = Side(style="hair", color="8A8A8A")

EUR = '#,##0;(#,##0);"-"'
PCT = '0.0%;(0.0%);"-"'
N0 = '#,##0;(#,##0);"-"'
N1 = '#,##0.0;(#,##0.0);"-"'
FAC = "0.00"
IDX = "0.000"

YEARS = ["2027", "2028", "2029", "2030", "2031"]
YC = ["D", "E", "F", "G", "H"]  # Spalten der Planjahre; C = Startwert bzw. Einzelwert
PREV = {"D": "C", "E": "D", "F": "E", "G": "F", "H": "G"}

wb = Workbook()
wb.remove(wb.active)
wb.properties.title = "Sicht - Finanzmodell"
wb.properties.creator = "Sicht"


def font(color=BLACK, bold=False, size=10, italic=False):
    return Font(name=FONT, size=size, bold=bold, italic=italic, color=color)


def put(ws, ref, value, color=BLACK, fmt=None, bold=False, fill=None, wrap=False, align=None, italic=False, size=10):
    cell = ws[ref]
    cell.value = value
    cell.font = font(color, bold, size, italic)
    if fmt:
        cell.number_format = fmt
    if fill:
        cell.fill = fill
    if wrap or align:
        cell.alignment = Alignment(wrap_text=wrap, vertical="top", horizontal=align)
    return cell


def title(ws, text, sub):
    put(ws, "A1", text, bold=True, size=14)
    put(ws, "A2", sub, color=GREY)


def section(ws, row, text, last="I"):
    for col in "ABCDEFGHI":
        cell = ws[f"{col}{row}"]
        cell.fill = BAND
        cell.border = Border(bottom=THIN)
        cell.font = font(bold=True)
        if col == last:
            break
    ws[f"A{row}"].value = text


def header(ws, row, labels):
    last = list(labels)[-1]
    for col, text in labels.items():
        cell = put(ws, f"{col}{row}", text, bold=True, align="right" if col in "CDEFGH" and col != last else None)
        if col == last:
            cell.alignment = Alignment(indent=1)
        cell.border = Border(bottom=THIN)


def note(ws, ref, text):
    cell = put(ws, ref, text, color=GREY)
    cell.alignment = Alignment(wrap_text=True, vertical="top", indent=1)


def widths(ws, spec):
    for col, width in spec.items():
        ws.column_dimensions[col].width = width


def page(ws):
    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_view.showGridLines = False


# =========================================================================== Szenarien
sz = wb.create_sheet("Szenarien")
SZ = {}
title(sz, "Szenarien", "Eine Zelle schaltet das ganze Modell um. Die drei Wertespalten sind Annahmen und frei änderbar.")
put(sz, "A3", "Aktives Szenario (1 = vorsichtig, 2 = Basis, 3 = ambitioniert)", bold=True)
put(sz, "B3", 2, color=BLUE, fill=YELLOW, bold=True, fmt="0")
put(sz, "A4", "Bezeichnung des aktiven Szenarios")
put(sz, "B4", "=INDEX(C6:E6,1,B3)", bold=True)
header(sz, 6, {"A": "Stellgröße", "B": "Einheit", "C": "vorsichtig", "D": "Basis", "E": "ambitioniert", "F": "aktiv", "G": "Begründung / Quelle"})

REF_GOVTECH = "GovTech Startup Monitor 2026, S. 3 (startupverband.de/media/file/rs-govtechstartupmonitor2026)"
levers = [
    ("erp_2027", "Begonnene Erprobungen 2027", "Anzahl", (1, 2, 3), N0,
     "Annahme. Ein Gründer ohne Referenzkunden; Vertriebszyklus öffentlicher Auftraggeber 9 bis 18 Monate. Vergleichswert: 42 % der befragten GovTech-Gründungen haben sich um Aufträge beworben, 24 % haben welche erhalten (" + REF_GOVTECH + ")."),
    ("erp_2028", "Begonnene Erprobungen 2028", "Anzahl", (3, 5, 8), N0, "Annahme."),
    ("erp_2029", "Begonnene Erprobungen 2029", "Anzahl", (5, 8, 14), N0, "Annahme."),
    ("erp_2030", "Begonnene Erprobungen 2030", "Anzahl", (7, 12, 20), N0, "Annahme."),
    ("erp_2031", "Begonnene Erprobungen 2031", "Anzahl", (9, 16, 26), N0, "Annahme."),
    ("umwandlung", "Umwandlung Erprobung in Knotenlizenz (im Folgejahr)", "Quote", (0.25, 0.40, 0.55), PCT,
     "Annahme. Die Verzögerung um ein Jahr bildet Haushaltsaufstellung und Vergabe ab."),
    ("folge", "Folgeknoten je Bestandsknoten und Jahr", "Knoten", (0.10, 0.25, 0.40), FAC,
     "Annahme. Nachbarkreise, die ohne eigene Erprobung nachziehen, sobald ein Knoten im Land arbeitet."),
    ("kuendigung", "Kündigungen je Jahr, Anteil am Anfangsbestand der Einzelknoten", "Quote", (0.08, 0.05, 0.03), PCT,
     "Annahme. Rahmenverträge laufen höchstens vier Jahre (§ 21 Abs. 6 VgV); Kündigungen im Rahmenvertrag sind nicht modelliert."),
    ("preisfaktor", "Preisfaktor auf alle Listenpreise", "Faktor", (0.80, 1.00, 1.15), FAC,
     "Annahme. Bildet Nachlässe in Verhandlungen (vorsichtig) oder höhere Zahlungsbereitschaft (ambitioniert) ab."),
    ("land_2027", "Länder mit Rahmenvertrag, kumuliert 2027", "Anzahl", (0, 0, 0), N0,
     "Annahme. Länder entscheiden landesweit (Beispiele: Baden-Württemberg ELD-BS, Niedersachsen CommandX; Quellen in docs/research/landscape.md). Voraussetzung: Erprobung im Land und Haushaltsbeschluss."),
    ("land_2028", "Länder mit Rahmenvertrag, kumuliert 2028", "Anzahl", (0, 0, 0), N0, "Annahme."),
    ("land_2029", "Länder mit Rahmenvertrag, kumuliert 2029", "Anzahl", (0, 0, 1), N0, "Annahme."),
    ("land_2030", "Länder mit Rahmenvertrag, kumuliert 2030", "Anzahl", (0, 1, 2), N0, "Annahme."),
    ("land_2031", "Länder mit Rahmenvertrag, kumuliert 2031", "Anzahl", (0, 1, 3), N0, "Annahme."),
    ("bund_2027", "Bundesknoten, kumuliert 2027", "Anzahl", (0, 0, 0), N0,
     "Annahme. Über den gemeinsamen Wirkbetrieb des digitalen Lagebilds von Bund und Ländern wird 2027 entschieden (BT-Drs. 21/7120, Antwort auf Frage 56); vorher ist kein Bundesknoten realistisch."),
    ("bund_2028", "Bundesknoten, kumuliert 2028", "Anzahl", (0, 0, 0), N0, "Annahme."),
    ("bund_2029", "Bundesknoten, kumuliert 2029", "Anzahl", (0, 0, 1), N0, "Annahme."),
    ("bund_2030", "Bundesknoten, kumuliert 2030", "Anzahl", (0, 1, 1), N0, "Annahme."),
    ("bund_2031", "Bundesknoten, kumuliert 2031", "Anzahl", (0, 1, 2), N0, "Annahme."),
    ("teamfaktor", "Teamfaktor auf den Stellenplan (ohne Geschäftsführung)", "Faktor", (0.50, 1.00, 1.25), FAC,
     "Annahme. Im vorsichtigen Fall wird nur halb so schnell eingestellt, im ambitionierten schneller."),
]
row = 7
for key, label, unit, values, fmt, why in levers:
    SZ[key] = row
    put(sz, f"A{row}", label)
    put(sz, f"B{row}", unit, color=GREY)
    for col, value in zip("CDE", values):
        put(sz, f"{col}{row}", value, color=BLUE, fmt=fmt)
    put(sz, f"F{row}", f"=INDEX(C{row}:E{row},1,$B$3)", fmt=fmt, bold=True)
    note(sz, f"G{row}", why)
    row += 1
put(sz, f"A{row + 1}", "Lesehilfe: Blau = Eingabe. Spalte F zeigt den Wert des aktiven Szenarios; Blatt Annahmen übernimmt ihn von dort.", color=GREY)
put(sz, f"A{row + 2}", "Ein Vergleich der drei Szenarien steht in docs/STRATEGY.md (abgelesen am 18.11.2026); in der Mappe gilt immer nur das aktive.", color=GREY)
widths(sz, {"A": 60, "B": 10, "C": 13, "D": 13, "E": 13, "F": 13, "G": 110})
sz.freeze_panes = "A7"
page(sz)


def S(key):
    return f"Szenarien!$F${SZ[key]}"


# =========================================================================== Annahmen
an = wb.create_sheet("Annahmen", 0)
AN = {}
title(an, "Annahmen", "Alle Eingaben des Modells an einer Stelle. Geldbeträge in Euro, netto, Preisstand 2027.")
put(an, "A3", "Blaue Schrift = Eingabewert (Annahme oder belegte Zahl). Schwarz = Formel. Grün = Verweis auf ein anderes Blatt. Gelb hinterlegt = Stellgrößen mit dem größten Einfluss.", color=GREY)
put(an, "A4", "Das Szenario wird auf Blatt Szenarien, Zelle B3, umgeschaltet. Jede Zahl ohne Quellenangabe ist eine Annahme und kein Messwert.", color=GREY)
HEAD = {"A": "Größe", "B": "Einheit", "C": "Wert", "D": "2027", "E": "2028", "F": "2029", "G": "2030", "H": "2031", "I": "Begründung / Quelle"}
header(an, 6, HEAD)
r = [7]


def a_section(text):
    section(an, r[0], text)
    r[0] += 1


def a_single(key, label, unit, value, fmt, why, key_input=False, color=BLUE):
    AN[key] = r[0]
    put(an, f"A{r[0]}", label)
    put(an, f"B{r[0]}", unit, color=GREY)
    put(an, f"C{r[0]}", value, color=color, fmt=fmt, fill=YELLOW if key_input else None)
    note(an, f"I{r[0]}", why)
    r[0] += 1


def a_years(key, label, unit, values, fmt, why, color=BLUE):
    AN[key] = r[0]
    put(an, f"A{r[0]}", label)
    put(an, f"B{r[0]}", unit, color=GREY)
    for col, value in zip(YC, values):
        put(an, f"{col}{r[0]}", value, color=color, fmt=fmt)
    note(an, f"I{r[0]}", why)
    r[0] += 1


SRC_EU = "EU-Kommission, GD GROW, Schwellenwerte 2026-2027 (Delegierte Verordnung (EU) 2025/2152)"
a_section("Zeit und Preise")
a_single("start", "Erstes Planjahr", "Jahr", "2027", None, "Gründung und Vorarbeiten im Dezember 2026; erstes volles Geschäftsjahr 2027.")
a_single("preisindex", "Preisanpassung je Jahr", "Quote", 0.02, PCT, "Annahme. Übliche Preisgleitung in mehrjährigen Softwareverträgen.")
a_single("p_erprobung", "Erprobung: Festpreis für drei Monate an einem Knoten, mit Schulung und Messbericht", "€", 25000, EUR,
         "Annahme. So niedrig, dass ein vereinfachtes Vergabeverfahren in Betracht kommt; die Wertgrenzen der Länder sind zu prüfen.")
a_single("p_knoten", "Knotenlizenz Kreis oder Leitstelle, je Jahr, mit Pflege", "€", 48000, EUR,
         "Annahme. Vierjahreswert 192.000 € liegt unter dem EU-Schwellenwert von 216.000 € für subzentrale Auftraggeber (" + SRC_EU + "). Schätzregeln nach § 3 VgV zu prüfen.", key_input=True)
a_single("rabatt", "Nachlass auf die Knotenlizenz im Landesrahmenvertrag", "Quote", 0.25, PCT, "Annahme. Mengennachlass für ein Land, das seine Kreise gemeinsam ausstattet.")
a_single("p_landesknoten", "Landesknoten (Lagezentrum eines Landes), je Jahr", "€", 120000, EUR, "Annahme.")
a_single("p_verbund", "Verbundlizenz eines Landes, je Jahr", "€", 180000, EUR, "Annahme. Abfrage über die Knoten des Landes hinweg samt Aufsichtsfunktionen.", key_input=True)
a_single("p_bund", "Bundesknoten, je Jahr", "€", 150000, EUR,
         "Annahme. Für Bundesbehörden gilt ein EU-Schwellenwert von 140.000 € (zentrale Regierungsbehörden; " + SRC_EU + "); Zuordnung von BBK und THW zu prüfen.")
a_single("p_einfuehrung", "Einführung und Schulung je neuem Knoten, einmalig", "€", 15000, EUR, "Annahme. Rund zehn Personentage vor Ort und aus der Ferne.")

a_section("Landesrahmenvertrag")
a_single("knoten_je_land", "Kreisknoten je Land im Rahmenvertrag nach Hochlauf", "Anzahl", 20, N0,
         "Annahme. Deutschland hat 400 Kreise und kreisfreie Städte in 16 Ländern, im Mittel 25 (Statistisches Bundesamt über Deutscher Städtetag, Stand 31.12.2023). Angesetzt sind 20.", key_input=True)
a_single("hochlauf", "Anteil der Knoten, der im ersten Vertragsjahr in Betrieb geht", "Quote", 0.5, PCT, "Annahme.")

a_section("Aktive Stellgrößen des Szenarios (Werte auf Blatt Szenarien ändern)")
AN["sz_name"] = r[0]
put(an, f"A{r[0]}", "Aktives Szenario")
put(an, f"C{r[0]}", "=Szenarien!B4", color=GREEN, bold=True)
note(an, f"I{r[0]}", "Umschalten auf Blatt Szenarien, Zelle B3.")
r[0] += 1
a_years("erprobungen", "Begonnene Erprobungen", "Anzahl", [f"={S('erp_' + y)}" for y in YEARS], N0, "Verweis auf Blatt Szenarien.", color=GREEN)
a_single("umwandlung", "Umwandlung Erprobung in Knotenlizenz (im Folgejahr)", "Quote", f"={S('umwandlung')}", PCT, "Verweis auf Blatt Szenarien.", color=GREEN)
a_single("folge", "Folgeknoten je Bestandsknoten und Jahr", "Knoten", f"={S('folge')}", FAC, "Verweis auf Blatt Szenarien.", color=GREEN)
a_single("kuendigung", "Kündigungen je Jahr, Anteil am Anfangsbestand der Einzelknoten", "Quote", f"={S('kuendigung')}", PCT, "Verweis auf Blatt Szenarien.", color=GREEN)
a_single("preisfaktor", "Preisfaktor auf alle Listenpreise", "Faktor", f"={S('preisfaktor')}", FAC, "Verweis auf Blatt Szenarien.", color=GREEN)
a_years("laender", "Länder mit Rahmenvertrag, kumuliert", "Anzahl", [f"={S('land_' + y)}" for y in YEARS], N0, "Verweis auf Blatt Szenarien.", color=GREEN)
a_years("bund", "Bundesknoten, kumuliert", "Anzahl", [f"={S('bund_' + y)}" for y in YEARS], N0, "Verweis auf Blatt Szenarien.", color=GREEN)
a_single("teamfaktor", "Teamfaktor auf den Stellenplan (ohne Geschäftsführung)", "Faktor", f"={S('teamfaktor')}", FAC, "Verweis auf Blatt Szenarien.", color=GREEN)

a_section("Personal: Vollkosten je Stelle und Jahr (Gehalt samt Arbeitgeberanteilen und Arbeitsplatz)")
a_single("vk_gf", "Geschäftsführung", "€", 120000, EUR, "Annahme.")
a_single("vk_dev", "Entwicklung (Bildauswertung, Server, Konsole)", "€", 105000, EUR, "Annahme.")
a_single("vk_einf", "Einführung und Betreuung", "€", 85000, EUR, "Annahme.")
a_single("vk_vertrieb", "Vertrieb öffentlicher Sektor", "€", 115000, EUR, "Annahme.")
a_single("vk_recht", "Datenschutz und Regulierung", "€", 100000, EUR, "Annahme.")
a_single("gehalt", "Gehaltssteigerung je Jahr", "Quote", 0.03, PCT, "Annahme.")

a_section("Stellenplan im Basisfall (Stellen im Jahresmittel; der Teamfaktor des Szenarios wirkt auf alle Zeilen außer der ersten)")
a_years("st_gf", "Geschäftsführung", "Stellen", [1, 1, 1, 1, 1], N1, "Annahme. Der Gründer; im ersten Jahr auch Vertrieb.")
a_years("st_dev", "Entwicklung", "Stellen", [2, 3, 4, 5, 6], N1, "Annahme. Erste Aufgaben: Direktbilder mit echten Kameras erproben, Kopplung an Bestandssysteme, Härtung.")
a_years("st_einf", "Einführung und Betreuung", "Stellen", [0, 1, 2, 3, 4], N1, "Annahme. Wächst mit der Zahl der Knoten.")
a_years("st_vertrieb", "Vertrieb öffentlicher Sektor", "Stellen", [0, 1, 1, 2, 2], N1, "Annahme.")
a_years("st_recht", "Datenschutz und Regulierung", "Stellen", [0, 0.5, 1, 1, 1], N1, "Annahme. Bis dahin extern (Zeile Rechtsberatung).")

a_section("Sachkosten")
a_single("dev_fix", "Entwicklungsumgebung, Sockel je Jahr", "€", 10000, EUR,
         "Annahme. Kein Betrieb beim Anbieter: Jeder Knoten läuft auf Rechnern der Behörde. Es fallen nur Entwicklungsrechner und Werkzeuge an.")
a_single("dev_je_stelle", "Entwicklungsumgebung je Entwicklungsstelle und Jahr", "€", 8000, EUR, "Annahme. Arbeitsplatzrechner, Grafikkarten für das Nachtrainieren, Lizenzen.")
a_years("recht", "Rechtsberatung extern (Datenschutz-Folgenabschätzung, KI-Verordnung, Verträge, Marke)", "€", [80000, 70000, 70000, 80000, 80000], EUR, "Annahme.")
a_years("pruefung", "Sicherheitsprüfung und Vorbereitung von Nachweisen", "€", [0, 60000, 120000, 80000, 80000], EUR,
        "Annahme. Eindringtest, Grundschutz-Profil, Unterlagen für eine Konformitätsbewertung nach KI-Verordnung, falls ein Einsatz als hochriskant gilt.")
a_years("messen", "Messen, Reisen, Vorführtechnik", "€", [30000, 50000, 70000, 90000, 110000], EUR, "Annahme.")
a_single("verw_quote", "Verwaltung, Miete, Versicherung: Anteil an den Personalkosten", "Quote", 0.10, PCT, "Annahme.")
a_single("reise_je_knoten", "Reise- und Sachkosten der Einführung je neuem Knoten", "€", 2000, EUR, "Annahme.")
a_single("puffer", "Liquiditätspuffer in Monatskosten", "Monate", 3, N0, "Annahme. Öffentliche Auftraggeber zahlen nach Abnahme; Zahlungsziele sind nicht modelliert.")

a_section("Marktzahlen")
a_single("kreise", "Kreise und kreisfreie Städte (untere Katastrophenschutzbehörden)", "Anzahl", 400, N0,
         "Belegt: 294 Landkreise und 106 kreisfreie Städte, Stand 31.12.2023 (Statistisches Bundesamt über Deutscher Städtetag, Gemeindegliederung 2024).")
a_single("leitstellen", "Integrierte Leitstellen (nur nachrichtlich)", "Anzahl", 240, N0,
         "Annahme. Eine amtliche Zahl gibt es nicht (BT-Drs. 19/27556, S. 3). Belegt sind 34 in Baden-Württemberg (Visionspapier der Träger, April 2026). Leitstellen werden von Kreisen getragen und nicht zusätzlich gezählt.")
a_single("anz_laender", "Länder", "Anzahl", 16, N0, "Belegt.")
a_single("bundesstellen", "Bundesstellen mit möglichem Knoten", "Anzahl", 10, N0,
         "Annahme: BBK mit dem Gemeinsamen Melde- und Lagezentrum, THW-Leitung und die 8 THW-Landesverbände (Zahl der Landesverbände: thw.de).")
a_single("kritis_min", "Betreiber kritischer Anlagen, untere Angabe (nur nachrichtlich)", "Anzahl", 1300, N0,
         "OpenKRITIS: Der Gesetzgeber geht von 1.300 Betreibern mit Nachholbedarf aus. Kein amtliches Register.")
a_single("kritis_max", "Betreiber kritischer Anlagen, obere Angabe (nur nachrichtlich)", "Anzahl", 2000, N0,
         "PwC Deutschland, 21.10.2026: rund 2.000 Betreiber unter dem KRITIS-Dachgesetz. Angabe eines Beratungshauses.")
a_single("sam_kreise", "Erreichbarer Anteil der Kreise in fünf Jahren", "Quote", 0.35, PCT,
         "Annahme. Kreise mit eigenen Bildquellen (Drohneneinheit, Kameras) in Ländern, deren Recht Aufzeichnung und Auswertung trägt. Nicht erhoben.", key_input=True)
a_single("sam_laender", "Erreichbarer Anteil der Länder in fünf Jahren", "Quote", 0.50, PCT, "Annahme.")
a_single("sam_bund", "Erreichbarer Anteil der Bundesstellen in fünf Jahren", "Quote", 0.30, PCT, "Annahme.")
widths(an, {"A": 74, "B": 9, "C": 12, "D": 11, "E": 11, "F": 11, "G": 11, "H": 11, "I": 120})
an.freeze_panes = "C7"
page(an)


def A(key):
    return f"Annahmen!$C${AN[key]}"


def AY(key, col):
    return f"Annahmen!{col}{AN[key]}"


def series_sheet(name, heading, sub):
    ws = wb.create_sheet(name)
    title(ws, heading, sub)
    put(ws, "A3", '="Aktives Szenario: "&' + A("sz_name"), color=GREEN, bold=True)
    header(ws, 4, {"A": "", "B": "Einheit", "C": "2026 (Start)", "D": "2027", "E": "2028", "F": "2029", "G": "2030", "H": "2031", "I": "Rechenweg / Anmerkung"})
    widths(ws, {"A": 62, "B": 9, "C": 13, "D": 13, "E": 13, "F": 13, "G": 13, "H": 13, "I": 96})
    ws.freeze_panes = "C5"
    page(ws)
    return ws


def line(ws, book, key, row, label, unit, formula, fmt, why="", start=None, color=BLACK, bold=False, top=False):
    """Eine Zeile über die fünf Planjahre. `formula` erhält die Spalte und die Vorjahresspalte."""
    book[key] = row
    put(ws, f"A{row}", label, bold=bold)
    put(ws, f"B{row}", unit, color=GREY)
    if start is not None:
        put(ws, f"C{row}", start, color=BLUE, fmt=fmt)
    for col in YC:
        cell = put(ws, f"{col}{row}", formula(col, PREV[col]), color=color, fmt=fmt, bold=bold)
        if top:
            cell.border = Border(top=THIN)
    if top:
        for col in "ABC":
            ws[f"{col}{row}"].border = Border(top=THIN)
    if why:
        note(ws, f"I{row}", why)


# =========================================================================== Umsatz
um = series_sheet("Umsatz", "Umsatz", "Von Erprobungen über Knoten zu Verbundlizenzen. Bestände sind Erwartungswerte und daher nicht ganzzahlig.")
U = {}
line(um, U, "nr", 5, "Planjahr (laufende Nummer)", "Nr.", lambda c, p: f"={p}5+1", "0", "Hilfszeile für die Indizes.", start=0)
line(um, U, "index", 6, "Preisindex", "Faktor", lambda c, p: f"=(1+{A('preisindex')})^({c}5-1)", IDX, "Preisanpassung je Jahr, 2027 = 1.")
line(um, U, "pf", 7, "Preisfaktor des Szenarios", "Faktor", lambda c, p: f"={A('preisfaktor')}", FAC, "", color=GREEN)

section(um, 9, "Erprobungen")
line(um, U, "erp", 10, "Begonnene Erprobungen", "Anzahl", lambda c, p: f"={AY('erprobungen', c)}", N1, "Aus dem aktiven Szenario.", start=0, color=GREEN)
line(um, U, "erp_umsatz", 11, "Umsatz Erprobungen", "€", lambda c, p: f"={c}10*{A('p_erprobung')}*{c}$7*{c}$6", EUR, "Anzahl x Festpreis x Preisfaktor x Preisindex.")

section(um, 13, "Einzelknoten (Kreise und Leitstellen außerhalb eines Landesrahmenvertrags)")
line(um, U, "ek_anfang", 14, "Bestand am Jahresanfang", "Knoten", lambda c, p: f"={p}18", N1, "Endbestand des Vorjahrs.")
line(um, U, "ek_neu", 15, "Zugang aus Erprobungen des Vorjahrs", "Knoten", lambda c, p: f"={p}10*{A('umwandlung')}", N1, "Erprobungen des Vorjahrs x Umwandlungsquote.")
line(um, U, "ek_folge", 16, "Zugang Folgeknoten", "Knoten", lambda c, p: f"={c}14*{A('folge')}", N1, "Anfangsbestand x Folgeknoten je Bestandsknoten.")
line(um, U, "ek_ab", 17, "Abgang durch Kündigung", "Knoten", lambda c, p: f"=-{c}14*{A('kuendigung')}", N1, "Anfangsbestand x Kündigungsquote.")
line(um, U, "ek_ende", 18, "Bestand am Jahresende", "Knoten", lambda c, p: f"=SUM({c}14:{c}17)", N1, "", start=0, bold=True, top=True)
line(um, U, "ek_umsatz", 19, "Umsatz Einzelknoten", "€", lambda c, p: f"=({c}14+{c}18)/2*{A('p_knoten')}*{c}$7*{c}$6", EUR, "Mittlerer Bestand x Knotenlizenz x Preisfaktor x Preisindex.")

section(um, 21, "Landesrahmenverträge")
line(um, U, "land", 22, "Länder mit Rahmenvertrag, kumuliert", "Anzahl", lambda c, p: f"={AY('laender', c)}", N0, "Aus dem aktiven Szenario.", start=0, color=GREEN)
line(um, U, "land_neu", 23, "davon neu im Jahr", "Anzahl", lambda c, p: f"={c}22-{p}22", N0, "")
line(um, U, "rk_anfang", 24, "Kreisknoten im Rahmenvertrag, Jahresanfang", "Knoten", lambda c, p: f"={p}25", N1, "Endbestand des Vorjahrs.")
line(um, U, "rk_ende", 25, "Kreisknoten im Rahmenvertrag, Jahresende", "Knoten",
     lambda c, p: f"={A('knoten_je_land')}*({p}22+{A('hochlauf')}*{c}23)", N1,
     "Länder aus Vorjahren voll, neue Länder mit dem Hochlaufanteil. Einzelknoten in Rahmenländern werden nicht umgebucht (leichte Überzeichnung).", start=0, bold=True)
line(um, U, "rk_umsatz", 26, "Umsatz Kreisknoten im Rahmenvertrag", "€",
     lambda c, p: f"=({c}24+{c}25)/2*{A('p_knoten')}*(1-{A('rabatt')})*{c}$7*{c}$6", EUR, "Mittlerer Bestand x Knotenlizenz x (1 - Nachlass) x Preisfaktor x Preisindex.")
line(um, U, "lv_umsatz", 27, "Umsatz Landesknoten und Verbundlizenzen", "€",
     lambda c, p: f"=({p}22+{c}22)/2*({A('p_landesknoten')}+{A('p_verbund')})*{c}$7*{c}$6", EUR, "Mittlere Zahl der Länder x (Landesknoten + Verbundlizenz).")

section(um, 29, "Bund")
line(um, U, "bund", 30, "Bundesknoten, kumuliert", "Anzahl", lambda c, p: f"={AY('bund', c)}", N0, "Aus dem aktiven Szenario.", start=0, color=GREEN)
line(um, U, "bund_umsatz", 31, "Umsatz Bundesknoten", "€", lambda c, p: f"=({p}30+{c}30)/2*{A('p_bund')}*{c}$7*{c}$6", EUR, "Mittlerer Bestand x Preis.")

section(um, 33, "Einführung")
line(um, U, "neu", 34, "Neue Knoten im Jahr", "Knoten",
     lambda c, p: f"={c}15+{c}16+MAX(0,{c}25-{c}24)+MAX(0,{c}22-{p}22)+MAX(0,{c}30-{p}30)", N1,
     "Einzelknoten, Kreisknoten im Rahmenvertrag, Landesknoten, Bundesknoten.")
line(um, U, "einf_umsatz", 35, "Umsatz Einführung und Schulung", "€", lambda c, p: f"={c}34*{A('p_einfuehrung')}*{c}$7*{c}$6", EUR, "Neue Knoten x Einführungspreis.")

section(um, 37, "Summen und Kennzahlen")
line(um, U, "gesamt", 38, "Umsatz gesamt", "€", lambda c, p: f"={c}11+{c}19+{c}26+{c}27+{c}31+{c}35", EUR, "", bold=True, top=True)
line(um, U, "wieder", 39, "davon wiederkehrend (Lizenzen)", "€", lambda c, p: f"={c}19+{c}26+{c}27+{c}31", EUR, "Ohne Erprobungen und Einführung.")
line(um, U, "wieder_anteil", 40, "Anteil wiederkehrend", "Quote", lambda c, p: f"=IF({c}38=0,0,{c}39/{c}38)", PCT, "")
line(um, U, "arr", 41, "Jahreswert der Lizenzen am Jahresende", "€",
     lambda c, p: f"=({c}18*{A('p_knoten')}+{c}25*{A('p_knoten')}*(1-{A('rabatt')})+{c}22*({A('p_landesknoten')}+{A('p_verbund')})+{c}30*{A('p_bund')})*{c}$7*{c}$6", EUR,
     "Bestände am Jahresende x Jahrespreise.")
line(um, U, "kreisknoten", 42, "Kreisknoten am Jahresende (einzeln und im Rahmenvertrag)", "Knoten", lambda c, p: f"={c}18+{c}25", N1, "")
line(um, U, "knoten", 43, "Knoten gesamt am Jahresende", "Knoten", lambda c, p: f"={c}18+{c}25+{c}22+{c}30", N1, "Kreisknoten, Landesknoten, Bundesknoten.")

# =========================================================================== Kosten
ko = series_sheet("Kosten", "Kosten", "Team nach Rollen und Sachkosten. Rechenleistung für den Betrieb stellt die Behörde; beim Anbieter fällt nur Entwicklung an.")
K = {}
put(ko, "C4", "", bold=True)
line(ko, K, "nr", 5, "Planjahr (laufende Nummer)", "Nr.", lambda c, p: f"=Umsatz!{c}5", "0", "", color=GREEN)
line(ko, K, "gindex", 6, "Gehaltsindex", "Faktor", lambda c, p: f"=(1+{A('gehalt')})^({c}5-1)", IDX, "Gehaltssteigerung je Jahr, 2027 = 1.")

section(ko, 8, "Stellen im Jahresmittel (aktives Szenario)")
line(ko, K, "s_gf", 9, "Geschäftsführung", "Stellen", lambda c, p: f"={AY('st_gf', c)}", N1, "Unabhängig vom Teamfaktor.", color=GREEN)
for i, (key, label) in enumerate([("dev", "Entwicklung"), ("einf", "Einführung und Betreuung"), ("vertrieb", "Vertrieb öffentlicher Sektor"), ("recht", "Datenschutz und Regulierung")]):
    line(ko, K, f"s_{key}", 10 + i, label, "Stellen",
         (lambda k: lambda c, p: f"=ROUND({AY('st_' + k, c)}*{A('teamfaktor')}*2,0)/2")(key), N1,
         "Stellenplan x Teamfaktor, auf halbe Stellen gerundet." if i == 0 else "")
line(ko, K, "s_gesamt", 14, "Stellen gesamt", "Stellen", lambda c, p: f"=SUM({c}9:{c}13)", N1, "", bold=True, top=True)

section(ko, 16, "Personalkosten")
for i, (key, label) in enumerate([("gf", "Geschäftsführung"), ("dev", "Entwicklung"), ("einf", "Einführung und Betreuung"), ("vertrieb", "Vertrieb öffentlicher Sektor"), ("recht", "Datenschutz und Regulierung")]):
    line(ko, K, f"p_{key}", 17 + i, label, "€",
         (lambda k, n: lambda c, p: f"={c}{9 + n}*{A('vk_' + k)}*{c}$6")(key, i), EUR,
         "Stellen x Vollkosten x Gehaltsindex." if i == 0 else "")
line(ko, K, "p_gesamt", 22, "Personalkosten gesamt", "€", lambda c, p: f"=SUM({c}17:{c}21)", EUR, "", bold=True, top=True)

section(ko, 24, "Sachkosten")
line(ko, K, "k_dev", 25, "Entwicklungsumgebung (Rechner, Grafikkarten für das Nachtrainieren, Werkzeuge)", "€",
     lambda c, p: f"={A('dev_fix')}+{c}10*{A('dev_je_stelle')}", EUR, "Sockel + Entwicklungsstellen x Satz. Kein Betrieb: Knoten laufen bei der Behörde.")
line(ko, K, "k_recht", 26, "Rechtsberatung extern", "€", lambda c, p: f"={AY('recht', c)}", EUR, "", color=GREEN)
line(ko, K, "k_pruef", 27, "Sicherheitsprüfung und Nachweise", "€", lambda c, p: f"={AY('pruefung', c)}", EUR, "", color=GREEN)
line(ko, K, "k_messen", 28, "Messen, Reisen, Vorführtechnik", "€", lambda c, p: f"={AY('messen', c)}", EUR, "", color=GREEN)
line(ko, K, "k_verw", 29, "Verwaltung, Miete, Versicherung", "€", lambda c, p: f"={c}22*{A('verw_quote')}", EUR, "Personalkosten x Anteil.")
line(ko, K, "k_einf", 30, "Reise- und Sachkosten der Einführung", "€", lambda c, p: f"=Umsatz!{c}34*{A('reise_je_knoten')}", EUR, "Neue Knoten x Satz.")
line(ko, K, "k_gesamt", 31, "Sachkosten gesamt", "€", lambda c, p: f"=SUM({c}25:{c}30)", EUR, "", bold=True, top=True)

line(ko, K, "gesamt", 33, "Kosten gesamt", "€", lambda c, p: f"={c}22+{c}31", EUR, "", bold=True, top=True)

# =========================================================================== Ergebnis
er = series_sheet("Ergebnis", "Ergebnis", "Betriebsergebnis vor Abschreibungen, Zinsen und Steuern; Mittelbedarf und Jahr der Gewinnschwelle.")
E = {}
line(er, E, "umsatz", 5, "Umsatz gesamt", "€", lambda c, p: f"=Umsatz!{c}38", EUR, "", color=GREEN, bold=True)
line(er, E, "wieder", 6, "davon wiederkehrend", "€", lambda c, p: f"=Umsatz!{c}39", EUR, "", color=GREEN)
line(er, E, "personal", 7, "Personalkosten", "€", lambda c, p: f"=Kosten!{c}22", EUR, "", color=GREEN)
line(er, E, "sach", 8, "Sachkosten", "€", lambda c, p: f"=Kosten!{c}31", EUR, "", color=GREEN)
line(er, E, "kosten", 9, "Kosten gesamt", "€", lambda c, p: f"={c}7+{c}8", EUR, "", bold=True, top=True)
line(er, E, "ebitda", 10, "Betriebsergebnis", "€", lambda c, p: f"={c}5-{c}9", EUR, "Umsatz - Kosten. Ohne Abschreibungen, Zinsen, Steuern.", bold=True)
line(er, E, "marge", 11, "Betriebsergebnis in Prozent vom Umsatz", "Quote", lambda c, p: f"=IF({c}5=0,0,{c}10/{c}5)", PCT, "")
line(er, E, "kum", 13, "Kumuliertes Betriebsergebnis", "€", lambda c, p: f"={p}13+{c}10", EUR, "Vorjahr + Betriebsergebnis. Entspricht dem Mittelabfluss ohne Zahlungsziele.", start=0, bold=True)
line(er, E, "flag", 14, "Betriebsergebnis positiv (1 = ja)", "0/1", lambda c, p: f"=IF({c}10>0,1,0)", "0", "Hilfszeile für das Jahr der Gewinnschwelle.")

section(er, 16, "Mittelbedarf und Gewinnschwelle")
rows = [
    ("tief", 17, "Tiefster kumulierter Stand 2027 bis 2031", "€", "=MIN(0,MIN(D13:H13))", EUR, ""),
    ("tief_jahr", 18, "Jahr des tiefsten Stands", "Jahr", "=INDEX(D4:H4,1,MATCH(MIN(D13:H13),D13:H13,0))", None, ""),
    ("puffer", 19, "Liquiditätspuffer", "€", f"={A('puffer')}/12*AVERAGE(D9:H9)", EUR, "Monate x durchschnittliche Monatskosten."),
    ("bedarf", 20, "Mittelbedarf bis 2031", "€", "=-C17+C19", EUR, "Tiefster Stand + Puffer. Ohne Steuern, ohne Zahlungsziele, ohne Fördermittel."),
    ("be", 21, "Erstes Jahr mit positivem Betriebsergebnis", "Jahr", '=IFERROR(INDEX(D4:H4,1,MATCH(1,D14:H14,0)),"nach 2031")', None, ""),
]
for key, row_no, label, unit, formula, fmt, why in rows:
    E[key] = row_no
    put(er, f"A{row_no}", label, bold=key in ("bedarf", "be"))
    put(er, f"B{row_no}", unit, color=GREY)
    put(er, f"C{row_no}", formula, fmt=fmt, bold=key in ("bedarf", "be"), align="right")
    if why:
        note(er, f"I{row_no}", why)

section(er, 23, "Kennzahlen")
line(er, E, "stellen", 24, "Stellen gesamt", "Stellen", lambda c, p: f"=Kosten!{c}14", N1, "", color=GREEN)
line(er, E, "umsatz_je", 25, "Umsatz je Stelle", "€", lambda c, p: f"=IF({c}24=0,0,{c}5/{c}24)", EUR, "")
line(er, E, "knoten", 26, "Knoten gesamt am Jahresende", "Knoten", lambda c, p: f"=Umsatz!{c}43", N1, "", color=GREEN)
line(er, E, "arr", 27, "Jahreswert der Lizenzen am Jahresende", "€", lambda c, p: f"=Umsatz!{c}41", EUR, "", color=GREEN)
line(er, E, "wa", 28, "Anteil wiederkehrender Umsatz", "Quote", lambda c, p: f"=Umsatz!{c}40", PCT, "", color=GREEN)
put(er, "A30", "Nicht modelliert: Steuern, Abschreibungen, Zahlungsziele öffentlicher Auftraggeber, Fördermittel, Finanzierungskosten. Die Rechner eines Knotens beschafft die Behörde.", color=GREY)

chart = LineChart()
chart.title = "Umsatz, Kosten und kumuliertes Betriebsergebnis (€)"
chart.height, chart.width = 8.5, 22
chart.roundedCorners = False
for row_no, name, colour, dash in ((5, "Umsatz gesamt", "000000", None), (9, "Kosten gesamt", "8A8A8A", None), (13, "Kumuliertes Betriebsergebnis", "000000", "dash")):
    s = Series(Reference(er, min_col=4, max_col=8, min_row=row_no), title=name)
    s.graphicalProperties.line.solidFill = colour
    s.graphicalProperties.line.width = 19050
    if dash:
        s.graphicalProperties.line.dashStyle = dash
    s.smooth = False
    chart.series.append(s)
chart.set_categories(Reference(er, min_col=4, max_col=8, min_row=4))
chart.legend.position = "b"
chart.legend.overlay = False
chart.title.overlay = False
chart.x_axis.delete = False
chart.y_axis.delete = False
chart.x_axis.tickLblPos = "low"
chart.y_axis.number_format = "#,##0"
er.add_chart(chart, "A32")

# =========================================================================== Markt
ma = wb.create_sheet("Markt", 1)
title(ma, "Markt", "Von unten gerechnet: Stellen, die einen Knoten betreiben könnten, mal Listenpreis. Deutschland, je Jahr.")
put(ma, "A3", "Zählwerte mit Quelle sind belegt; alles andere ist als Annahme gekennzeichnet. Marktstudien wurden nicht verwendet: Ihre Angaben weichen um den Faktor 50 voneinander ab (docs/research/evidence.md, Abschnitt 5).", color=GREY)
header(ma, 5, {"A": "Segment", "B": "Anzahl", "C": "Preis je Jahr (€)", "D": "Volumen je Jahr (€)", "E": "Quelle / Annahme"})
for col in "BCD":
    ma[f"{col}5"].alignment = Alignment(horizontal="right")
M = {}


def m_row(key, row_no, label, count, price, why, bold=False, green=True):
    """`green` gilt für die Anzahl: reiner Verweis (grün) oder Rechnung (schwarz). Der Preis ist immer ein Verweis."""
    M[key] = row_no
    put(ma, f"A{row_no}", label, bold=bold)
    if count is not None:
        put(ma, f"B{row_no}", count, color=GREEN if green else BLACK, fmt=N0)
    if price is not None:
        put(ma, f"C{row_no}", price, color=GREEN, fmt=EUR)
    if count is not None and price is not None:
        put(ma, f"D{row_no}", f"=B{row_no}*C{row_no}", fmt=EUR, bold=bold)
    note(ma, f"E{row_no}", why)


section(ma, 6, "Gesamtmarkt bei vollständiger Abdeckung (TAM)", last="E")
m_row("tam_kreise", 7, "Kreise und kreisfreie Städte", f"={A('kreise')}", f"={A('p_knoten')}", "Anzahl belegt (Statistisches Bundesamt über Deutscher Städtetag, Stand 31.12.2023). Preis: Annahme.")
m_row("tam_laender", 8, "Länder: Landesknoten und Verbundlizenz", f"={A('anz_laender')}", f"={A('p_landesknoten')}+{A('p_verbund')}", "Preis: Annahme.")
m_row("tam_bund", 9, "Bundesstellen", f"={A('bundesstellen')}", f"={A('p_bund')}", "Anzahl und Preis: Annahme.")
M["tam"] = 10
put(ma, "A10", "TAM Kernmarkt Deutschland", bold=True)
put(ma, "D10", "=SUM(D7:D9)", fmt=EUR, bold=True)
for col in "ABCD":
    ma[f"{col}10"].border = Border(top=THIN)
note(ma, "E10", "Obergrenze zu Listenpreisen. Kein Nachlass, keine Mehrfachlizenzen, keine Nachbarmärkte.")

section(ma, 12, "Erreichbarer Markt in fünf Jahren (SAM)", last="E")
m_row("sam_kreise", 13, "Kreise mit eigenen Bildquellen und tragfähiger Rechtslage", f"={A('kreise')}*{A('sam_kreise')}", f"={A('p_knoten')}", "Anteil: Annahme, nicht erhoben.", green=False)
m_row("sam_laender", 14, "Länder", f"={A('anz_laender')}*{A('sam_laender')}", f"={A('p_landesknoten')}+{A('p_verbund')}", "Anteil: Annahme.", green=False)
m_row("sam_bund", 15, "Bundesstellen", f"={A('bundesstellen')}*{A('sam_bund')}", f"={A('p_bund')}", "Anteil: Annahme.", green=False)
M["sam"] = 16
put(ma, "A16", "SAM", bold=True)
put(ma, "D16", "=SUM(D13:D15)", fmt=EUR, bold=True)
for col in "ABCD":
    ma[f"{col}16"].border = Border(top=THIN)
put(ma, "A17", "SAM in Prozent des TAM")
put(ma, "D17", "=IF(D10=0,0,D16/D10)", fmt=PCT)

section(ma, 19, "Erreichter Markt laut Modell im Jahr 2031 (SOM, aktives Szenario)", last="E")
put(ma, "A20", "Umsatz gesamt 2031")
put(ma, "D20", "=Ergebnis!H5", color=GREEN, fmt=EUR)
put(ma, "A21", "Jahreswert der Lizenzen Ende 2031")
put(ma, "D21", "=Umsatz!H41", color=GREEN, fmt=EUR, bold=True)
put(ma, "A22", "Jahreswert der Lizenzen in Prozent des TAM")
put(ma, "D22", "=IF(D10=0,0,D21/D10)", fmt=PCT)
put(ma, "A23", "Kreisknoten Ende 2031")
put(ma, "B23", "=Umsatz!H42", color=GREEN, fmt=N1)
put(ma, "A24", "Kreisknoten in Prozent aller Kreise")
put(ma, "D24", f"=IF({A('kreise')}=0,0,B23/{A('kreise')})", fmt=PCT)
put(ma, "A25", "Kreisknoten in Prozent der erreichbaren Kreise (Plausibilität: unter 100 %)")
put(ma, "D25", "=IF(B13=0,0,B23/B13)", fmt=PCT)
note(ma, "E20", "Das aktive Szenario steht auf Blatt Szenarien.")

section(ma, 27, "Nachbarmärkte, nicht im Modell (nur nachrichtlich)", last="E")
m_row("kritis_min", 28, "Betreiber kritischer Anlagen, untere Angabe", f"={A('kritis_min')}", f"={A('p_knoten')}",
      "Rechnerisch. Anderes Recht (DSGVO Art. 6 Abs. 1 Buchst. f), anderer Vertrieb, Bedarf nicht geprüft.")
m_row("kritis_max", 29, "Betreiber kritischer Anlagen, obere Angabe", f"={A('kritis_max')}", f"={A('p_knoten')}", "Wie oben.")
put(ma, "A30", "Integrierte Leitstellen")
put(ma, "B30", f"={A('leitstellen')}", color=GREEN, fmt=N0)
note(ma, "E30", "Nicht addiert: Leitstellen werden von Kreisen getragen. Keine amtliche Zahl (BT-Drs. 19/27556).")
put(ma, "A31", "Österreich, Schweiz, übrige EU")
note(ma, "E31", "Nicht beziffert: Zählwerte und Rechtslage wurden nicht recherchiert.")

section(ma, 33, "Größenordnung staatlicher Verträge und Haushalte (belegt, zum Einordnen; nicht vergleichbar)", last="E")
anchors = [
    ("Baden-Württemberg, Polizei: Palantir Gotham, fünf Jahre", 25000000, "Rund 25 Mio. € über fünf Jahre (heise online, November 2025, heise.de/-11075477)."),
    ("Nordrhein-Westfalen, Polizei: DAR, Projektkosten", 39000000, "39 Mio. € samt Schulung und Hardware (ZDFheute, 23.07.2025)."),
    ("Schweiz: Lageverbundsystem, veranschlagte Kosten (CHF)", 31700000, "31,7 Mio. Franken (Bundesamt für Bevölkerungsschutz, Faktenblatt vom 31.03.2026)."),
    ("THW: Haushaltsmittel Digitale Transformation je Jahr 2026 bis 2029", 37222000, "BMI, Statusbericht vom 02.04.2026, Abschnitt 3.3 i (Anlage zu BT-Drs. 21/7126)."),
    ("BBK: Haushalt 2025", 332761000, "BMI, Statusbericht vom 02.04.2026, Tabelle Finanzielle Entwicklung (Anlage zu BT-Drs. 21/7126)."),
    ("BBK: Haushalt 2029 (Planwert)", 816381000, "Wie oben."),
]
for i, (label, value, why) in enumerate(anchors):
    put(ma, f"A{34 + i}", label)
    put(ma, f"D{34 + i}", value, color=BLUE, fmt=EUR)
    note(ma, f"E{34 + i}", why)
widths(ma, {"A": 70, "B": 12, "C": 18, "D": 20, "E": 120})
ma.freeze_panes = "A6"
page(ma)

wb._sheets = [wb[name] for name in ("Annahmen", "Markt", "Umsatz", "Kosten", "Ergebnis", "Szenarien")]
wb.active = 0
OUT.parent.mkdir(parents=True, exist_ok=True)
wb.save(OUT)
print(f"geschrieben: {OUT}")
