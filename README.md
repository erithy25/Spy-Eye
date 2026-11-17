# spy-eye

Lokale semantische Videosuche. Videos hochladen, sie werden in Szenen zerlegt und mit einem
Vision-Language-Modell indexiert; danach findet eine Freitext-Suche (`man with a cup`, `black car`,
`green bus`) pro passender Szene den besten Frame.

Alles läuft im eigenen Prozess: Modell-Inferenz (ONNX Runtime), Vektorindex, Szenenerkennung und Suche.
Keine API-Keys, keine Datenbank, keine Cloud.

## Start

Voraussetzungen: Node ≥ 20.11, pnpm, `ffmpeg` im PATH (`brew install ffmpeg` / `apt install ffmpeg`).

```bash
pnpm install
```

```bash
pnpm build
```

```bash
pnpm start
```

Dann <http://127.0.0.1:8787> öffnen. Für die Entwicklung startet `pnpm dev` Server (8787) und Vite (5173)
mit Hot Reload.

Beim ersten Start werden die Modellgewichte (~800 MB) einmalig von Hugging Face in `.models/` geladen.
Danach ist kein Netzwerk mehr nötig; mit `SPY_EYE_OFFLINE=1` wird jeder Zugriff unterbunden.
`pnpm models:download` lädt die Gewichte vorab.

## Wie es funktioniert

| Schritt | Umsetzung |
| --- | --- |
| Frames | `ffmpeg` tastet das Video mit 0.5–4 fps ab (640 px breit). Die Analyse startet, während die Extraktion noch läuft. |
| Statische Bilder | Ein 32×32-Signaturvergleich überspringt Frames, in denen sich nichts bewegt hat (spart bei Überwachungsmaterial den Großteil der Rechenzeit). |
| Embeddings | Pro Frame das Gesamtbild plus überlappende quadratische Ausschnitte (`standard`: 4, `detail`: 12), damit auch kleine Objekte auffindbar sind. Modell: SigLIP ViT-B/16. |
| Szenen | Neuer Abschnitt bei Sprung im Embedding (Schnitt), bei Drift vom Szenenzentrum, nach einer Aktivitätspause oder nach 30 s. |
| Tags | Zero-Shot gegen ein eingebautes Vokabular (332 Begriffe). Nur Anzeige; die Suche ist davon unabhängig. |
| Suche | Text-Embedding (Prompt-Ensemble) gegen alle Vektoren, Maximum pro Frame, bester Frame pro Szene. Brute Force, da das bis in den Millionenbereich im Millisekundenbereich bleibt. |
| Relevanz | Cut-off pro Query aus der Score-Verteilung des Datasets (Median + 2.5 σ robust), begrenzt auf ein festes Band. Der Regler verschiebt ihn. |
| Fokus | Für einen Treffer werden dichte Bildfenster eingebettet und gegen die Query gemessen; das ergibt die Lokalisierung im Frame. |

Daten liegen in `data/videos/<id>/`: Quelldatei, `frames/*.jpg`, `embeddings.f32`, `meta.json`.

## Gemessen

4 CPU-Kerne, ohne GPU, SigLIP fp32:

| | Wert |
| --- | --- |
| Inferenz | ~120 ms pro Bildausschnitt, also ~0.5 s pro Frame (`standard`) bzw. ~1.4 s (`detail`) |
| Query | 100–300 ms, davon fast alles Text-Encoder |
| Szenenerkennung | 135 von 135 Schnitten in drei synthetischen Testvideos, keine falschen |
| Retrieval | Average Precision 0.90–1.00 für 13 von 16 Test-Queries auf 135 COCO-Bildern |

Schwächen: zusammengesetzte Queries mit kleinen Objekten (`man with a cup` in einer Totalen) ranken
plausibel, aber nicht zuverlässig; hier hilft `detail`. Das Modell versteht Englisch. Sehr generische
Wörter (`person`) liefern niedrige Scores, konkretere (`a man walking`) funktionieren besser.

## Konfiguration

Siehe `.env.example`. Die Variablen werden aus der Umgebung gelesen, z. B.:

```bash
MODEL_ID=Xenova/clip-vit-base-patch32 pnpm start
```

Ein Modellwechsel indexiert vorhandene Videos beim nächsten Start neu.

## Hinweise

- Der Server bindet an `127.0.0.1` und hat keine Authentifizierung. Nicht ungeschützt ins Netz stellen.
- Abspielen im Browser hängt vom Codec ab (H.264/VP9/AV1 in mp4/webm/mov). Bei anderen Formaten bleibt
  die Frame-Ansicht der Szene.
