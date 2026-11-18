#!/usr/bin/env python3
"""Prüft ein exportiertes Protokoll von Sicht, ohne Sicht zu brauchen.

    python3 tools/pruefen/ledger_verify.py sicht-ledger-koblenz.jsonl
    python3 tools/pruefen/ledger_verify.py sicht-ledger-koblenz.jsonl --head <64 Hexzeichen>

Dasselbe wie ledger-verify.mjs, in Python und nur mit der Standardbibliothek, damit eine Aufsicht
zwei voneinander unabhängige Fassungen hat. Die Datei kommt aus der Konsole (Reiter PROTOKOLL,
EXPORT): ein Eintrag je Zeile, als JSON. Jeder Eintrag nennt in `prev` die Prüfsumme seines
Vorgängers und in `hash` die eigene:

    hash = SHA-256( prev + "\\n" + kanonisch(Eintrag ohne prev und hash) )

»Kanonisch« heißt: JSON ohne Leerraum, die Schlüssel jedes Objekts sortiert, Zeichenketten und
Zahlen so geschrieben, wie JavaScript sie schreibt. Zahlen werden deshalb nicht neu berechnet,
sondern in der Schreibweise der Datei übernommen.

Ausgang: 0 = unversehrt (und --head gefunden), 1 = gebrochen oder --head nicht gefunden,
2 = falscher Aufruf oder Datei nicht lesbar.
"""
import hashlib
import json
import re
import sys

GENESIS = "0" * 64

_SHORT = {'"': '\\"', "\\": "\\\\", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t"}


class Number(str):
    """Eine Zahl in der Schreibweise der Datei."""


def _string(text):
    out = ['"']
    for ch in text:
        code = ord(ch)
        if ch in _SHORT:
            out.append(_SHORT[ch])
        elif code < 0x20 or 0xD800 <= code <= 0xDFFF:
            out.append("\\u%04x" % code)
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def canonical(value):
    if isinstance(value, Number):
        return str(value)
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return _string(value)
    if isinstance(value, list):
        return "[" + ",".join(canonical(item) for item in value) + "]"
    if isinstance(value, dict):
        # JavaScript sortiert Schlüssel nach UTF-16-Einheiten.
        keys = sorted(value, key=lambda key: key.encode("utf-16-be", "surrogatepass"))
        return "{" + ",".join(_string(key) + ":" + canonical(value[key]) for key in keys) + "}"
    raise TypeError("unerwarteter Wert im Protokoll: %r" % (value,))


def verify(text):
    prev = GENESIS
    count = 0
    heads = []
    for line in text.split("\n"):
        if line.strip() == "":
            continue
        at = count + 1
        try:
            entry = json.loads(line, parse_int=Number, parse_float=Number)
        except ValueError:
            return False, count, prev, at, "Zeile ist kein gültiges JSON", heads
        if not isinstance(entry, dict):
            return False, count, prev, at, "Zeile ist kein Eintrag", heads
        if entry.get("seq") != str(at):
            return False, count, prev, at, "Sequenznummer %s statt %d" % (entry.get("seq"), at), heads
        if entry.get("prev") != prev:
            return False, count, prev, at, "Verweis auf den Vorgänger stimmt nicht", heads
        body = {key: value for key, value in entry.items() if key not in ("prev", "hash")}
        digest = hashlib.sha256()
        digest.update(prev.encode("ascii"))
        digest.update(b"\n")
        digest.update(canonical(body).encode("utf-8", "surrogatepass"))
        if digest.hexdigest() != entry.get("hash"):
            return False, count, prev, at, "Inhalt passt nicht zur Prüfsumme", heads
        prev = entry["hash"]
        heads.append(prev)
        count = at
    return True, count, prev, None, None, heads


def main(argv):
    args = list(argv)
    wanted = None
    if "--head" in args:
        at = args.index("--head")
        wanted = args[at + 1].lower() if at + 1 < len(args) else ""
        del args[at : at + 2]
    if len(args) != 1 or (wanted is not None and not re.fullmatch(r"[0-9a-f]{8,64}", wanted)):
        print("Aufruf: python3 ledger_verify.py <Datei> [--head <Prüfsumme oder ihr Anfang, mindestens 8 Hexzeichen>]", file=sys.stderr)
        return 2
    try:
        with open(args[0], "r", encoding="utf-8-sig", errors="surrogatepass", newline="") as handle:
            text = handle.read()
    except OSError as err:
        print("Datei nicht lesbar: %s" % err, file=sys.stderr)
        return 2

    ok, entries, head, broken_at, reason, heads = verify(text)
    if not ok:
        print("Kette GEBROCHEN bei Eintrag %d: %s." % (broken_at, reason))
        print("Unversehrt bis einschließlich Eintrag %d, Stand %s." % (entries, head))
        return 1
    print("Kette unversehrt: %d %s." % (entries, "Eintrag" if entries == 1 else "Einträge"))
    print("Letzter Stand: %s" % head)
    if wanted is not None:
        found = any(item.startswith(wanted) for item in heads) or (entries == 0 and GENESIS.startswith(wanted))
        if not found:
            print("Der genannte Stand %s kommt in dieser Kette NICHT vor." % wanted)
            return 1
        print("Der genannte Stand ist der letzte Stand dieser Kette." if head.startswith(wanted) else "Der genannte Stand ist ein früherer Stand dieser Kette.")
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv[1:]))
