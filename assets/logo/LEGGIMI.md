# Marcuzzo, il logo di Fub

Il gufo che esce da una cartella. Questi file non sono sotto la licenza del
codice: leggi [`LICENZA.md`](LICENZA.md) e [`TRADEMARKS.md`](../../TRADEMARKS.md).

| File | Che cos'è | Dove va |
|---|---|---|
| `originali/marcuzzo-smeraldo.svg`, `-menta.svg`, `-kraft.svg` | i tre disegni di partenza | Smeraldo è la fonte dell'icona grande dell'app |
| `marcuzzo.svg` | la forma intera, con le classi `logo-*` | le Informazioni (48 px), l'avvio (56 px) |
| `marcuzzo-24.svg` | la forma minima per 24 e 32 px | il marchio della barra, le icone 24 e 32 |
| `marcuzzo-16.svg` | la forma minima per 16 px | l'icona 16 |
| `marcuzzo-simbolico.svg` | un colore solo, pieno con la regola pari-dispari | il livello monocromo di Android |
| `misure.json` | i colori della cartella e i loro contrasti per gli otto campioni della tinta e tre temi d'esempio | i valori attesi da `recipe.test.ts` e `series.test.ts` |

## Le copie nel client

Le pagine (`apps/client/index.html`, `mobile.html`, `document.html`) portano
le forme in linea, e `apps/client/src/ui/marcuzzo.ts` porta `marcuzzo.svg`
per le Informazioni. `src/ui/marcuzzo.test.ts` controlla che le copie siano
uguali a questi file: cambiato un file qui, si cambiano le copie.

## I colori

Il gufo ha colori fissi: sono gli attributi `fill` del disegno. La cartella
e i due fogli hanno le classi `logo-cartella`, `logo-cartella-retro`,
`logo-cartella-ombra`, `logo-foglio-1` e `logo-foglio-2`, e la pelle le
colora con i ruoli facoltativi `--logo-*`. `logoColors()` in
`apps/client/src/theme/scrittoio/recipe.ts` li ricava dall'accento, con la
cartella e il retro alla soglia dei segni (3, o 4,5 col contrasto alto) su
`--bg` e `--bg-elev`. Un tema installato senza ruoli del logo li riceve dal
suo `--accent` (`completeLogoSheet` in `series.ts`).

## Rifare le icone dell'app

Le icone di `crates/fub-app/icons/` nascono da queste forme:

1. rendere con Chromium (Playwright del client), su fondo trasparente:
   `source.png` a 1024 px da `originali/marcuzzo-smeraldo.svg`; `16.png`
   da `marcuzzo-16.svg`; `24.png` e `32.png` da `marcuzzo-24.svg`; per
   Android il primo piano (la forma intera dentro la zona sicura, 66 su
   108), il fondo `#e7efe9` e il monocromo da `marcuzzo-simbolico.svg`;
2. da `crates/fub-app/`, `cargo tauri icon <manifest.json>`, con il
   manifest che nomina `default`, `bg_color`, `android_bg`, `android_fg` e
   `android_monochrome`;
3. tenere i file che la configurazione usa (`32x32.png`, `128x128.png`,
   `128x128@2x.png`, `icon.png`, `icon.icns`, `icon.ico`, `android/`) e
   mettere al posto delle misure 16, 24 e 32 di `icon.ico` e `icon.icns` (e
   di `32x32.png`) quelle rese dalle forme minime, che `cargo tauri icon`
   ricaverebbe rimpicciolendo la grande.
