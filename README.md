# VEXA — 6-DOF robottikäsi

Kotiprojekti: ESP32-ohjattu robottikäsi, jota ohjataan selaimesta WebSocketin kautta.
Tavoite: saada VEXA siirtämään esine ("tuotantolinja"-prototyyppi, ~5 g palikat) ennen osien uudelleensuunnittelua.

## Tila lyhyesti (2026-10)

| Osa | Tila |
|---|---|
| J1–J3 askelmoottorit (FastAccelStepper) | ✅ toimii, kulmat nollapositioon suhteutettuna |
| Web-UI v0.4.0 (ESP32 jakaa itse) | ✅ toimii — `http://vexa.local` |
| J4–J5 askelmoottorit | ⏳ rauta olemassa, ei vielä koodissa |
| J6 tarttuja (SG90) | ⏳ testattu erikseen: auki 100°, kiinni 172° |
| Kotiinajo (homing) | ⏳ suunniteltu (Omron NC -rajakytkimet, kaksivaiheinen) |
| Käänteiskinematiikka | 💡 idea: FABRIK selaimessa → kulmat ESP32:lle |

## Rauta

- **Ohjain:** ESP32
- **Moottorit:** NEMA17 59 Ncm + TMC2209, 1/32 mikroaskel (MS1 HIGH, MS2 LOW)
- **Vaihteet:** StepperOnline MGL17 -planeettavaihteet (omistuksessa 5:1, 10:1, 25:1, 50:1, 100:1)
- **Tarttuja:** SG90-servo, rinnakkaisleuat, TPU-sormet
- **Sähköt:** MeanWell LRS-200-24, Wieland WT 2.5 -riviliittimet, Schneider RCD + MCB DIN-kiskolla, buck-muuntimet 5 V / 6 V

### Nivelet ja pinnit

| Nivel | Nimi | Välitys (koodissa) | STEP | DIR | EN |
|---|---|---|---|---|---|
| J1 | Base | 10:1 | 25 | 26 | 27 |
| J2 | Shoulder | 50:1 | 32 | 33 | 23 |
| J3 | Elbow | 10:1 | 19 | 18 | 17 |
| J4 | Wrist-1 | 5:1 | — | — | — |
| J5 | Wrist-2 | 5:1 | — | — | — |
| J6 | Tool (SG90) | — | — | — | — |

> Huom: J2:n välitys on koodissa 50:1. Jos olkapäässä on 25:1-vaihde, vaihda `ratio` → `25.0f`.

Liikerajat: nopeus 7000 askelta/s, kiihtyvyys 2000 askelta/s².
Käynnistyksessä nykyinen asento = 0° → aseta käsi nolla-asentoon ennen virran kytkemistä.

## Ohjelmisto

```
firmware/vexa_robot_ino/
├── vexa_robot_ino.ino     ESP32-firmware (WiFi, mDNS, WebSocket :81, HTTP :80)
├── index.h                UI: HTML  (PROGMEM)
├── styles.h               UI: CSS   (PROGMEM)
├── script.h               UI: JS    (PROGMEM)
└── secrets.example.h      mallitiedosto WiFi-tunnuksille
```

### Käyttöönotto

1. Kopioi `secrets.example.h` → `secrets.h` ja täytä WiFi-tunnukset (`secrets.h` ei mene GitHubiin).
2. Kirjastot: **FastAccelStepper**, **WebSockets** (Links2004), **ArduinoJson** (v6).
3. Lataa ESP32:lle, avaa `http://vexa.local` (tai sarjamonitorin IP).
4. TERMINAL-välilehdeltä: Mode = WebSocket → CONNECT.

### UI-ominaisuudet

- **Dashboard:** nivelkortit, sliderit + min/max-rajat, JOG ± (oletus 1°), tallennetut asennot (LOAD/UPD/REN/DEL), nollapositio (aseta / aja nollaan)
- **Programs:** sekvenssit asennoista + viive, LOOP, ajon aikana käsiohjaus lukittu, odottaa ESP32:n `moving:false`-tietoa
- **Terminal:** yhteys, PING, komentorivi
- **Globaali PAUSE** lähettää `stop`-komennon
- Teema dark/light (localStorage)

### WebSocket-protokolla

Selain → ESP32 (JSON):

| `type` | Kentät | Toiminto |
|---|---|---|
| `joint_update` | `joint`, `angle` | yksi nivel kulmaan |
| `preset_load` / `reset` | `allAngles` | kaikki nivelet kulmiin |
| `custom_cmd` | `cmd`: `stop` `status` `ping` `home` `zero` `reboot` | komento |

ESP32 → selain: `{"type":"pos","J1":..,"J2":..,"J3":..,"moving":bool}` 10 Hz liikkeen aikana; `hello` yhdistettäessä, `heartbeat` statukseen.

## Seuraavat askeleet

Katso [TODO.md](TODO.md).
