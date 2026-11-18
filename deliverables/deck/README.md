# Präsentation: Arbeitsdateien

Die Präsentation liegt als privates Slides-Dokument unter
<https://claude.ai/artifact/NhPkBXmqP2jQbv2GZaDKyQ>. Dort wird sie vorgeführt, bearbeitet und
exportiert. Dieser Ordner enthält ihre Quelle und die Werkzeuge für die Fassung ohne Netz.

| Datei | Zweck |
| --- | --- |
| `tools/build.py` | Quelle aller 20 Folien: Texte, Zahlen, Sprechnotizen, Gestaltung |
| `project/` | daraus erzeugt: `deck.json`, `deck.css`, `slides/<id>.html`; genau diese Dateien stehen im Dokument |
| `tools/render.cjs` | zeichnet die Folien aus `project/` ohne Netz und schreibt die PDF-Fassung |
| `tools/blobs.json` | ordnet die im Dokument hochgeladenen Bilder den Dateien im Repository zu |
| `assets/` | zwei Ausschnitte und ein Bildschirmfoto der Konsole, die nur die Präsentation braucht |
| `../Sicht-Praesentation.pdf` | 20 Seiten, Schrift eingebettet; die Fassung ohne Netz |
| `../Sicht-Praesentation-Sprechzettel.md` | die Sprechnotizen aller Folien |

## Ändern

```bash
python3 deliverables/deck/tools/build.py
```

```bash
NODE_PATH= NODE_OPTIONS= NODE_DISABLE_COMPILE_CACHE=1 node deliverables/deck/tools/render.cjs --pdf deliverables/Sicht-Praesentation.pdf
```

Der zweite Befehl meldet je Folie, wo der Inhalt endet und wie viel Höhe frei ist. `--tight`
nennt Zeilen, die ihren Kasten fast füllen; `--shots <Ordner>` schreibt ein Bild je Folie.
Geänderte Dateien aus `project/` müssen danach in das Dokument übertragen werden; wer im
Dokument selbst Text ändert, ändert diese Quelle nicht mit.

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
- Die Folie „Stand“ nennt zur Finanzierung keine Summe. Ob und worum gebeten wird, ist vor dem
  Termin zu entscheiden.
