# DATUM-Präsentation: Arbeitsdateien

Die Präsentation liegt als privates Slides-Dokument unter
<https://claude.ai/artifact/Co1LMwmb6jBPNSHWqnVbDU>. Dort wird sie vorgeführt, bearbeitet und
exportiert. Dieser Ordner enthält ihre Quelle und die Werkzeuge für die Fassung ohne Netz.

| Datei | Zweck |
| --- | --- |
| `tools/build.py` | Quelle aller 12 Folien: Texte, Sprechnotizen, Gestaltung (Schrift, Linien und Eckmarken der Sicht-Präsentation) |
| `tools/live.json` | Werte des laufenden Knotens, die in den Bildunterschriften stehen (Abweichung und Rechenzeit des Fernsehturm-Clips) |
| `tools/blobs.json` | ordnet die im Dokument hochgeladenen Bilder den Dateien in `assets/` zu |
| `tools/render.cjs` | zeichnet die Folien ohne Netz und schreibt die PDF-Fassung |
| `assets/` | Bildschirmfotos der Konsole, 3200 × 2000 Pixel |
| `project/` | daraus erzeugt: `deck.json`, `deck.css`, `slides/<id>.html`; genau diese Dateien stehen im Dokument |
| `../DATUM-Praesentation.pdf` | 12 Seiten, Schrift eingebettet |
| `../DATUM-Praesentation-Sprechzettel.md` | die Sprechnotizen aller Folien |

Die Messwerte auf Folie 8 liest `build.py` aus `docs/measurements/datum-geolocation.json`; nach
einer neuen Messung (`pnpm datum:evaluate`) genügt es, die Folien neu zu erzeugen und
hochzuladen.

## Ändern

```bash
python3 deliverables/deck-datum/tools/build.py
```

```bash
NODE_PATH= NODE_OPTIONS= NODE_DISABLE_COMPILE_CACHE=1 node deliverables/deck-datum/tools/render.cjs --pdf deliverables/DATUM-Praesentation.pdf
```

Danach die geänderten Dateien aus `project/` in das Dokument laden. Neue Bildschirmfotos werden
zuerst in das Dokument hochgeladen; die Adresse, die dabei zurückkommt, gehört mit dem Dateipfad
in `tools/blobs.json`.
