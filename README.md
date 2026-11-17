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

Beim ersten Start werden die Modellgewichte (~400 MB) einmalig von Hugging Face in `.models/` geladen.
Danach ist kein Netzwerk mehr nötig; mit `SPY_EYE_OFFLINE=1` wird jeder Zugriff unterbunden.
`pnpm models:download` lädt die Gewichte vorab.

## Wie es funktioniert

Die Analyse läuft in zwei Durchläufen, damit ein neues Dataset sofort benutzbar ist:

1. **Grob-Durchlauf** für alle neuen Videos zuerst: ein bis drei Keyframes pro Video, je ein
   Gesamtbild-Embedding, über Videogrenzen hinweg gebatcht. Dekodiert werden nur Keyframes, parallel auf
   allen Kernen. Danach ist jedes Video durchsuchbar (Status `grob`).
2. **Fein-Durchlauf**, ein Video nach dem anderen: dichte Abtastung, Bildausschnitte, Szenen, Tags. Sein
   Ergebnis ersetzt den Grob-Index des Videos. Solange noch Uploads eintreffen, pausiert er zugunsten von
   Durchlauf 1.

Uploads laufen zu viert parallel und blockieren die Analyse nicht.

| Schritt (Fein-Durchlauf) | Umsetzung |
| --- | --- |
| Frames | `ffmpeg` tastet das Video mit 0.5–4 fps ab (640 px breit). Die Analyse startet, während die Extraktion noch läuft. |
| Statische Bilder | Ein 32×32-Signaturvergleich überspringt Frames, in denen sich nichts bewegt hat (spart bei Überwachungsmaterial den Großteil der Rechenzeit). |
| Embeddings | Pro Frame das Gesamtbild plus überlappende quadratische Ausschnitte (`standard`: 4, `detail`: 12), damit auch kleine Objekte auffindbar sind. |
| Szenen | Neuer Abschnitt bei Sprung im Embedding (Schnitt), bei Drift vom Szenenzentrum, nach einer Aktivitätspause oder nach 30 s. |
| Tags | Zero-Shot gegen ein eingebautes Vokabular (332 Begriffe). Nur Anzeige; die Suche ist davon unabhängig. |
| Suche | Text-Embedding (Prompt-Ensemble) gegen alle Vektoren, Maximum pro Frame, bester Frame pro Szene. Brute Force, da das bis in den Millionenbereich im Millisekundenbereich bleibt. |
| Relevanz | Cut-off pro Query aus der Score-Verteilung des Datasets (Median + 2.5 σ robust), begrenzt auf ein festes Band. Der Regler verschiebt ihn. |
| Fokus | Für einen Treffer werden dichte Bildfenster eingebettet und gegen die Query gemessen; das ergibt die Lokalisierung im Frame. |

Daten liegen in `data/videos/<id>/`: Quelldatei, `frames/*.jpg`, `embeddings.f32`, `meta.json`.

## Gemessen

4 CPU-Kerne, ohne GPU. Dataset: 44 Clips, zusammen 9 Minuten, 87 MB, Detailgrad `standard`, 1 fps.

| Modell (`MODEL_ID`) | alle durchsuchbar | Feinanalyse fertig | Download | mittlere AP* |
| --- | --- | --- | --- | --- |
| `Xenova/mobileclip_s2` (Standard) | 5.9 s | 132 s | ~400 MB | 0.87 |
| `Xenova/mobileclip_s0` | 4.2 s | 70 s | ~300 MB | 0.87 |
| `Xenova/siglip-base-patch16-224` | 9.8 s | 307 s | ~800 MB | 0.88 |

\* 16 Test-Queries auf 135 gelabelten COCO-Bildern, als Videos kodiert. Der SigLIP-Wert stammt aus einem
früheren Lauf, in dem eines der drei Testvideos mit `detail` indexiert war; er ist also leicht begünstigt.
Die Szenenerkennung trifft mit allen drei Modellen 135 von 135 Schnitten ohne Fehlalarm.

Die Zeiten skalieren linear mit der Videomenge: Inferenz ist der Engpass und nutzt bereits alle Kerne.
Der Grob-Durchlauf kostet auf dieser Maschine rund 0.1 s pro Video, der Fein-Durchlauf rund 0.25 s pro
analysiertem Frame. Mehr Durchsatz gibt es nur über Hardware:

```bash
ML_DEVICE=auto pnpm start
```

`auto` versucht unter Windows DirectML (jede DirectX-12-GPU) und unter Linux CUDA und fällt bei einem
Fehler auf die CPU zurück. Dieser Pfad ist implementiert, aber mangels GPU nicht gemessen.

Schwächen: zusammengesetzte Queries mit kleinen Objekten (`man with a cup` in einer Totalen) ranken
plausibel, aber nicht zuverlässig; hier hilft `detail`. Treffer aus dem Grob-Index beruhen auf einem
einzigen Keyframe und können danebenliegen, bis die Feinanalyse des Videos durch ist. Die Modelle
verstehen Englisch. Sehr generische Wörter (`person`) liefern niedrige Scores.

## Konfiguration

Siehe `.env.example`. Die Variablen werden aus der Umgebung gelesen, z. B.:

```bash
MODEL_ID=Xenova/siglip-base-patch16-224 pnpm start
```

Ein Modellwechsel indexiert vorhandene Videos beim nächsten Start neu.

## Hinweise

- Der Server bindet an `127.0.0.1` und hat keine Authentifizierung. Nicht ungeschützt ins Netz stellen.
- Abspielen im Browser hängt vom Codec ab (H.264/VP9/AV1 in mp4/webm/mov). Bei anderen Formaten bleibt
  die Frame-Ansicht der Szene.
