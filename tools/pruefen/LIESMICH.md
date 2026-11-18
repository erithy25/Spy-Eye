# Protokoll unabhängig prüfen

Zwei kleine Programme, die ein exportiertes Protokoll von Sicht nachrechnen, ohne Sicht zu
brauchen. Sie benutzen nichts aus diesem Repository: das eine nur Node, das andere nur Python mit
seiner Standardbibliothek. Eine Aufsicht kann sie lesen (je rund hundert Zeilen), auf einem
eigenen Rechner einsetzen und gegeneinander laufen lassen.

## Ablauf

1. In der Konsole, Reiter PROTOKOLL: EXPORT. Die Datei heißt `sicht-ledger-<knoten>.jsonl` und
   enthält einen Eintrag je Zeile. Auch der Export selbst steht danach im Protokoll.
2. Prüfen:

```bash
node tools/pruefen/ledger-verify.mjs sicht-ledger-koblenz.jsonl
```

```bash
python3 tools/pruefen/ledger_verify.py sicht-ledger-koblenz.jsonl
```

Beide nennen die Zahl der Einträge und den letzten Stand, oder den ersten Eintrag, an dem die
Kette bricht, mit dem Grund.

3. Mit einem bezeugten Stand abgleichen, etwa dem, den ein Nachbarknoten im Reiter VERBUND zeigt,
   oder dem, der auf einem gedruckten Bericht steht:

```bash
node tools/pruefen/ledger-verify.mjs sicht-ledger-koblenz.jsonl --head 7fafc8bf5409
```

Es genügt der Anfang der Prüfsumme, mindestens acht Zeichen. Die Antwort sagt, ob der Stand der
letzte oder ein früherer Stand dieser Kette ist oder in ihr nicht vorkommt.

## Was die Prüfung beweist und was nicht

- Jeder Eintrag nennt die Prüfsumme seines Vorgängers und die eigene:
  `hash = SHA-256(prev + "\n" + kanonisch(Eintrag ohne prev und hash))`. Kanonisch heißt: JSON ohne
  Leerraum, die Schlüssel jedes Objekts sortiert. Der erste Eintrag verweist auf 64 Nullen.
- Eine unversehrte Kette beweist, dass kein Eintrag geändert, entfernt oder umgestellt wurde,
  ohne dass alle späteren Prüfsummen neu berechnet wurden.
- Sie beweist nicht, dass die Datei die ursprüngliche ist: Wer die ganze Datei besitzt, kann sie
  neu schreiben und neu verketten, und eine am Ende abgeschnittene Datei ist in sich stimmig.
  Dagegen hilft nur der Abgleich mit einem Stand, der außerhalb des Knotens festgehalten wurde.
  Dafür bezeugen Nachbarknoten gegenseitig ihren letzten Stand, und jeder Bericht nennt ihn.
- Die Prüfsummen sind nicht mit einem Schlüssel gesichert. Das ist Absicht: Jede Stelle soll
  nachrechnen können, ohne ein Geheimnis zu kennen.

## Rückgabewerte

| Wert | Bedeutung |
| --- | --- |
| 0 | Kette unversehrt, ein mit `--head` genannter Stand kommt vor |
| 1 | Kette gebrochen, oder der genannte Stand kommt nicht vor |
| 2 | falscher Aufruf oder Datei nicht lesbar |

Die Tests in `apps/server/test/ledger-verify.test.ts` halten beide Programme an das, was der
Knoten schreibt: Umlaute, Anführungszeichen, Steuerzeichen, sehr kleine und sehr große Zahlen,
und sie prüfen, dass ein geänderter, ein entfernter und ein umgestellter Eintrag benannt werden.
