# Křížkometr

Průzkumník přeskakování v komunálních volbách. Institut H21. Data: otevřená data ČSÚ, volby do zastupitelstev obcí 2006–2022.

## Co je kde

| Soubor | K čemu |
|---|---|
| `index.html` | celý nástroj na jedné stránce |
| `pruzkumnik.html`, `grafy.html`, `kandidatka.html` | tři embedy pro web institutu, viz `VLOZENI-NA-WEB.md` |
| `ukazka.html` | test: tři embedy pod sebou se zástupným textem |
| `assets/` | skript, styly, písmo Apercu Pro, loga |
| `data/vysledky.bin` | výsledky a přepočet všech kandidátek |
| `data/jmena.bin` | jména kandidátů (stahuje se až po vykreslení stránky) |
| `data/kandidatky.bin` | plné názvy kandidátek z registru ČSÚ a krátké štítky do tlačítek |
| `data/anekdoty.json` | ručně vybrané příběhy, dají se upravovat |
| `nastroje/` | pomocné skripty v Pythonu, kterými se data připravují |

## Před nahráním na GitHub

Do `assets/` zkopírujte ze složky s logem na Disku tyto soubory: `krizkometr-logo-claim.svg`, `krizkometr-logo.svg`, `favicon.svg`, `favicon.ico`, `apple-touch-icon.png`, `og-image.png`. Dokud tam nejsou, ukazuje se místo loga nápis Křížkometr.

## GitHub Pages

Repo musí být veřejné. V Settings → Pages zvolte Deploy from a branch, větev `main`, složka `/ (root)`. Po pár minutách je web na `https://instituth21.github.io/pruzkumnik-komunalek/`.

## Úpravy

- **Texty anekdot** jsou v `data/anekdoty.json`. Prázdný řádek odděluje odstavce, `**takhle**` se píše tučně. V průzkumníku se vybrané příběhy ukazují jako první, ale jen když spadají do nastaveného výběru.
- **Po výměně dat** změňte `VERZE` na začátku `assets/krizkometr.js` a stejné datum v `?v=…` v HTML souborech, jinak můžou prohlížeče chvíli ukazovat stará data.

## Písmo

Apercu Pro je komerční písmo a ve veřejném repu leží jako soubor, který si může kdokoli stáhnout. Pokud licence institutu nepokrývá použití mimo ih21.org, smažte `assets/apercu-*.woff2`; stránky pak použijí systémové písmo a jinak fungují stejně.

## Test na vlastním počítači

Otevřené dvojklikem z disku stránky data nenačtou (prohlížeč to nedovolí). Ve složce spusťte `python3 -m http.server` a otevřete `http://localhost:8000/ukazka.html`.
