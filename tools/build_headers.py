#!/usr/bin/env python3
"""Generoi ESP32:n index.h / styles.h / script.h tiedostot web/-kansiosta.

web/ on käyttöliittymän ainoa lähde. Aja tämä aina kun muokkaat web/-tiedostoja
ja haluat ne ESP32:lle:

    python3 tools/build_headers.py

Tarkistus ilman kirjoitusta (esim. CI):

    python3 tools/build_headers.py --check
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
FW = ROOT / "firmware" / "vexa_robot_ino"

# (web-tiedosto, header-tiedosto, muuttujan nimi)
FILES = [
    ("index.html", "index.h", "PAGE_HTML"),
    ("styles.css", "styles.h", "PAGE_CSS"),
    ("script.js", "script.h", "PAGE_JS"),
]

DELIM = "rawliteral"


def render(web_name: str, var: str) -> str:
    body = (WEB / web_name).read_text(encoding="utf-8")
    if f"){DELIM}\"" in body:
        sys.exit(f"{web_name}: sisältää merkkijonon ){DELIM}\" — rikkoisi raw string -literaalin")
    return f'const char* {var} PROGMEM = R"{DELIM}(\n{body}){DELIM}";\n'


def main() -> int:
    check = "--check" in sys.argv
    stale = []
    for web_name, h_name, var in FILES:
        out = FW / h_name
        new = render(web_name, var)
        old = out.read_text(encoding="utf-8") if out.exists() else None
        if old != new:
            stale.append(h_name)
            if not check:
                out.write_text(new, encoding="utf-8", newline="\n")
                print(f"päivitetty  {out.relative_to(ROOT)}")
        else:
            print(f"ajan tasalla {out.relative_to(ROOT)}")
    if check and stale:
        print("VANHENTUNUT:", ", ".join(stale), "— aja: python3 tools/build_headers.py")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
