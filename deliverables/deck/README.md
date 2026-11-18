# Präsentation: Arbeitsdateien

Die Präsentation liegt als privates Slides-Dokument in zwei Ausgaben vor: deutsch unter
<https://claude.ai/artifact/NhPkBXmqP2jQbv2GZaDKyQ>, englisch unter
<https://claude.ai/artifact/KjH984UGPDCVaVUAiDBTR2>. Dort wird sie vorgeführt, bearbeitet und
exportiert. Dieser Ordner enthält ihre Quelle und die Werkzeuge für die Fassung ohne Netz.

| Datei | Zweck |
| --- | --- |
| `tools/build.py` | Quelle aller 20 Folien der deutschen Ausgabe: Texte, Zahlen, Sprechnotizen, Gestaltung |
| `tools/build_en.py` | Quelle der englischen Ausgabe; Gestaltung und Bausteine kommen aus `build.py` |
| `project/`, `project-en/` | daraus erzeugt: `deck.json`, `deck.css`, `slides/<id>.html`; genau diese Dateien stehen im jeweiligen Dokument |
| `tools/render.cjs` | zeichnet die Folien einer Ausgabe ohne Netz und schreibt die PDF-Fassung |
| `tools/blobs.json`, `tools/blobs-en.json` | ordnen die im jeweiligen Dokument hochgeladenen Bilder den Dateien im Repository zu |
| `tools/crops.mjs` | schneidet die zwei Ausschnitte der englischen Ausgabe aus `docs/screens` |
| `assets/` | zwei Ausschnitte und ein Bildschirmfoto der Konsole, die nur die deutsche Ausgabe braucht |
| `assets/en/` | die zwei Ausschnitte der englischen Ausgabe |
| `../Sicht-Praesentation.pdf`, `../Sicht-Presentation-EN.pdf` | je 20 Seiten, Schrift eingebettet; die Fassungen ohne Netz |
| `../Sicht-Praesentation-Sprechzettel.md`, `../Sicht-Presentation-EN-notes.md` | die Sprechnotizen aller Folien |

## Ändern

Deutsche Ausgabe:

```bash
python3 deliverables/deck/tools/build.py
```

```bash
NODE_PATH= NODE_OPTIONS= NODE_DISABLE_COMPILE_CACHE=1 node deliverables/deck/tools/render.cjs --pdf deliverables/Sicht-Praesentation.pdf
```

Englische Ausgabe:

```bash
python3 deliverables/deck/tools/build_en.py
```

```bash
NODE_PATH= NODE_OPTIONS= NODE_DISABLE_COMPILE_CACHE=1 node deliverables/deck/tools/render.cjs --project project-en --pdf deliverables/Sicht-Presentation-EN.pdf
```

Der jeweils zweite Befehl meldet je Folie, wo der Inhalt endet und wie viel Höhe frei ist.
`--tight` nennt Zeilen, die ihren Kasten fast füllen; `--shots <Ordner>` schreibt ein Bild je
Folie; `--stress 0.25` zeichnet jeden Buchstaben um diesen Betrag in Pixeln breiter und zeigt
so, ob eine Folie auch dann noch passt, wenn das Dokument den Text etwas breiter misst (nur zur
Prüfung, nicht zusammen mit `--pdf`). Geänderte Dateien aus `project/` oder `project-en/`
müssen danach in das jeweilige Dokument übertragen werden; wer im Dokument selbst Text ändert,
ändert diese Quelle nicht mit.

## Englische Ausgabe

- Dieselben 20 Folien mit denselben Kennungen in derselben Reihenfolge; `build_en.py` bricht
  ab, wenn die Reihenfolge von der deutschen abweicht. `deck.css` ist in beiden Ausgaben dieselbe
  Datei. Eine Änderung der Gestaltung in `build.py` erreicht beide Ausgaben, eine Änderung am
  Inhalt muss in beiden Dateien gemacht werden.
- Zahlen wie in der deutschen Ausgabe, in englischer Schreibweise. Wortwahl nach `site/i18n.js`.
- Die Modulnamen bleiben deutsch und werden im Folientitel englisch erläutert; die
  Sprechnotizen nennen die wörtliche Bedeutung.
- Zitate aus deutschen Quellen sind übersetzt und auf der Folie als eigene Übersetzung
  gekennzeichnet; die Zitate aus Los Angeles und Maui stehen im englischen Original.
- Die Folie zur Lage zeigt die Konsole englisch, die übrigen fünf Bilder zeigen sie deutsch;
  die Bildunterschrift sagt das jeweils.

Bilder der englischen Ausgabe und ihre Adressen im englischen Dokument (`tools/blobs-en.json`):

| Folie | Datei im Repository | Adresse im Dokument |
| --- | --- | --- |
| 6 `lage` | `docs/screens/lage-en.png` | `/_blob/c81927d5dd4d1925535f38012e36beb1` |
| 7 `wachen` | `deliverables/deck/assets/en/wachen-ausschnitt.png` | `/_blob/6f2e3dbb499eef32e179d5afbaea6ed2` |
| 8 `suche` | `docs/screens/suche.png` | `/_blob/367ed61fbe59cd893529971d2310a52c` |
| 9 `verbund` | `deliverables/deck/assets/en/verbund-karte.png` | `/_blob/3d03a8d4e814c12664fc992d63430b7b` |
| 10 `aufsicht` | `docs/screens/stichprobe.png` | `/_blob/483deb5e0d7e5ab5452f11422b1f7bbd` |
| 11 `ruecksicht` | `docs/screens/maskiert.png` | `/_blob/0f4bab7d66e54a18e913d53e51dadd26` |

Neue Bildschirmfotos übernehmen:

1. Die zwei Ausschnitte neu schneiden (aus `docs/screens/wachen.png` und `verbund.png`, je
   2880 × 1800):

   ```bash
   node deliverables/deck/tools/crops.mjs
   ```

2. Die geänderten Dateien im englischen Dokument hochladen. Jede bekommt dort eine neue
   Adresse `/_blob/<Kennung>`.
3. In `tools/blobs-en.json` die Kennung der Datei durch die neue ersetzen. Die Tabelle ist die
   einzige Stelle: `build_en.py` liest die Adressen daraus, `render.cjs` die Dateien.
4. `build_en.py` ausführen, die geänderten Dateien aus `project-en/slides/` in das Dokument
   übertragen und die PDF-Fassung neu schreiben. Ändert sich, was ein Bild zeigt, gehören
   Bildunterschrift und Bildbeschreibung der Folie in `build_en.py` dazu.

## Wovon die Folien abhängen

- Messwerte und ihre beiden Einschränkungen: `docs/EVALUATION.md`, `docs/BRAND.md`.
- Stand und Grenzen, auch zum Direktbild: `README.md`, Abschnitt „Grenzen dieses Stands“.
- Belege, Wettbewerb, Käufer, Risiken: `docs/STRATEGY.md` und `docs/research/`.
- Preise, Markt, Fünfjahresfall: `deliverables/Sicht-Finanzmodell.xlsx`, Szenario Basis.

Ändert sich eine dieser Unterlagen, ändern sich die Folien nicht von selbst.

## Bekannte Grenzen

- Geprüft ist die Darstellung mit dem Vorschauverfahren des Slides-Typs in einem Browser, nicht
  im Dokument selbst. Zeilenumbrüche können dort geringfügig abweichen.
- Die PDF-Fassung stammt aus diesem Vorschauverfahren, nicht aus dem Export des Dokuments.
  PowerPoint und PDF aus dem Dokument selbst: dort unter „Teilen“, „Exportieren“.
- Die Folie „Stand“ nennt den Mittelbedarf des Basisfalls (rund 3,2 Mio. €, Annahme), aber keine
  Bitte um eine Summe. Ob und worum gebeten wird, ist vor dem Termin zu entscheiden.
- Die englische Ausgabe verweist auf Unterlagen, die es nur deutsch gibt: das Strategiepapier
  (Folie 14) und die Blätter des Finanzmodells (Folien 16 und 17).
