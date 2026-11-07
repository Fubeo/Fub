# Rifare le catture del simulatore

Il simulatore non legge le catture al volo. Le catture del client (DOM e CSS
di ogni stato, nelle due luci) stanno compresse in `sim-dati-1.js`, accanto
a `simulatore.html`. **Quella è la fonte del DOM catturato.** Le foto e i JSON
grezzi (`catture/`, circa 560 MB) restano sulla macchina che li ha presi.

## Cambiare il simulatore senza catture

Quasi tutto si cambia senza catturare di nuovo:

| Cosa cambia | Dove |
|---|---|
| il DOM nuovo dei pezzi composti | `toppe/*.html` (`<template data-toppa>`) |
| il CSS nuovo | `blocchi/*.css` |
| uno stato composto sopra una cattura | `script/stati-composte-sim.mjs`, `script/stati-nuove-sim.mjs` |
| gli scenari e i passi | `script/scenari-sim.mjs` |
| i pezzi, i menu, le eccezioni ai clic | `script/pezzi-sim.mjs`, `script/eccezioni-sim.mjs` |
| le interazioni finte | `script/solo-simulatore.js` |

Poi, dalla radice del repository:

```bash
DATI=PLAN-ui/fub-pre-alpha node PLAN-ui/fub-pre-alpha/script/costruisci-sim.mjs PLAN-ui/fub-pre-alpha
```

Con `DATI` lo script riusa le catture impacchettate. Senza altri cambi
riscrive gli stessi byte.

## Catturare di nuovo uno stato

Serve il client delle catture: il client vero col banco e l'host finto, nello
stesso punto della storia in cui sono state prese le catture, più le toppe del
finto di questa cartella.

| Toppa | Base | Per |
|---|---|---|
| `cattura.patch` | `0c2a7e91` (`anteprima/tutto` del 2026-11-04) | tutte le catture tranne l'avvio |
| `avvio.patch` | `5006937c` (`anteprima/tutto` del 2026-11-05, con #308) | le quattro catture dell'avvio |
| `verde.patch` | il client di `cattura.patch` | il verde di serie (D25), sopra `cattura.patch` |
| `verde-avvio.patch` | il client di `avvio.patch` | il verde di serie (D25), sopra `avvio.patch` |

`anteprima/tutto` è il ramo locale che unisce `main` e i piani approvati
(N4, N6, N7, K2, K3, K5, A1, griglia-celle, Scrittoio 2, caricamento). I suoi
23 commit d'unione non sono su `origin`, quindi stanno in
`anteprima-tutto.bundle` (115 KB). Gli altri 21 commit che servono sono già
su `origin`.

`cattura.patch` cambia nove file: il corpus e l'host finto del banco
(`bench/corpus.ts`, `bench/fake-ipc.ts`, `src/host/fake.ts`), le scene del
secondo giro (`bench/scene.mjs`), le sonde di Scrittoio 2 (le icone nuove in
`src/ui/icons.ts`, il gruppo Carattere in `src/editors/rich/`, la striscia
degli spazi in `src/panels/explorer.ts`: DOM che i task di Scrittoio 2
scriveranno davvero) e l'errore dell'inchiostro nella facciata
WebAssembly (`crates/fub-canvas-wasm/src/api.rs`, lo stesso di `b92cf9f5`).
`avvio.patch` cambia solo `bench/fake-ipc.ts` e `bench/scene.mjs`.

### Il verde di serie (D25)

Dal 2026-11-07 le catture sono verdi: la tinta di serie è 160 «Smeraldo»
(D25 C, PA T48) e non più il blu 265. Le due toppe verdi portano il verde
nel client delle catture, come lo porterà PA T48 nel codice: la ricetta e i
quattro fogli di `src/theme/scrittoio/`, l'accento di serie in
`preferences/accent-control.ts` e `panels/settings.ts`, le parole in
`src/i18n/catalog.ts`, il colore di avvio in `index.html` (e per l'avvio
anche `document.html`, `mobile.html` e `public/avvio/avvio.css`) e l'host
finto (`bench/fake-ipc.ts`). `verde.patch` cambia dieci file,
`verde-avvio.patch` dodici. Si applicano dopo l'altra toppa:

```bash
git -C ../fub-cattura apply "$PWD/PLAN-ui/fub-pre-alpha/script/finto/cattura.patch"
git -C ../fub-cattura apply "$PWD/PLAN-ui/fub-pre-alpha/script/finto/verde.patch"
```

Tre pezzi del verde non passano dal client:

| Pezzo | Cosa fa |
|---|---|
| `verde-mappa.mjs` → `finto/verde-mappa.json` | confronta la stessa cattura blu e verde (`s2/nota`) e scrive, colore per colore, il blu di prima e il verde di serie. Generata, non si modifica a mano. |
| `cattura-piani.mjs` con `VERDE=finto/verde-mappa.json` | le pagine dei piani (`p-*`) non hanno un client: prima di fotografarle ricolora il blu nel verde con la mappa. |
| `verde-lavagna.mjs` | `s2/lavagna` e `s2/lavagna-700` non si rifanno (vedi sotto): il loro foglio di serie diventa quello di una cattura verde della stessa luce. **La foto PNG resta blu**: è l'unica eccezione ai pixel, e il controllo delle foto la conosce. |

Le catture blu di prima stanno in `catture-blu/`, accanto a `catture/`,
solo sulla macchina che le ha prese.

```bash
# 1. il client, accanto al repository
git fetch origin
git bundle verify PLAN-ui/fub-pre-alpha/script/finto/anteprima-tutto.bundle
git fetch PLAN-ui/fub-pre-alpha/script/finto/anteprima-tutto.bundle anteprima/tutto:anteprima/tutto
git worktree add ../fub-cattura 0c2a7e91
git -C ../fub-cattura apply "$PWD/PLAN-ui/fub-pre-alpha/script/finto/cattura.patch"
(cd ../fub-cattura/apps/client && npm ci)
# per l'avvio: un secondo worktree su 5006937c con avvio.patch

# 2. gli stati (ricattura sceglie da sé la cartella e la definizione)
cd PLAN-ui/fub-pre-alpha/script
DATI=.. FUB_CLIENT=../../../../fub-cattura/apps/client \
  node ricattura.mjs ../../../../fub-cattura/apps/client cartelle=tel solo=t-cestino
# le pagine dei piani (p-*): cartelle=piani, senza client, da file://,
#   col verde: VERDE=finto/verde-mappa.json node ricattura.mjs … cartelle=piani
# tutte insieme, come il 2026-11-06 (circa un'ora; DATI va esportato):
#   DATI=.. bash ricattura-tutto.sh <client 0c2a7e91 + cattura.patch + verde.patch> <client 5006937c + avvio.patch + verde-avvio.patch>

# 3. dentro il simulatore
DATI=.. RIFATTE=../catture-r/tel node costruisci-sim.mjs ..
```

`ricattura.mjs` legge le definizioni da `stati-*.json` e `piani-giro2.json`,
esegue `cattura.mjs` (o `cattura-piani.mjs`) e scrive in
`catture-r/<cartella>/`. `cattura.mjs` monta `blocchi/*.css` (tranne i temi
d'esempio `93-tema-*`) e i `mods.mjs` prima di fotografare, poi aspetta
che i menu, i dialoghi e le finestrelle di CodeMirror restino fermi per due
fotogrammi (al più venti): il menu «/» si sistema dopo il primo disegno, e
una foto presa prima non coincide col DOM copiato. La porta del suo
Vite è la 1468. `FUB_CLIENT` dice agli altri script dove prendere
Playwright, pngjs, pixelmatch e happy-dom (`client.mjs`). Chromium vuole le
sue librerie di sistema: su server-di-fub le dà `env.sh` (vedi
`CLAUDE_DEVICE.md`).

`s2/lavagna` e `s2/lavagna-700` non hanno definizione: sono le catture
della lavagna di prima del piano N6 e restano quelle impacchettate.

Le pagine dei piani si fotografano dalle copie di `piani/` accanto a
`simulatore.html`, già avvolte (`ricette.html` grezza si aprirebbe in
«quirks mode»), con gli argomenti di Chromium del banco. Una foto presa con
altri argomenti va a capo in altri punti.

Senza `DATI`, cioè costruendo da una cartella `catture/` completa, la
costruzione vuole anche i temi del client: `node temi-sim.mjs <client>
<temi.json> <cache>` li calcola da `recipe.ts` e `series.ts`, e `TEMI=<temi.json>`
dice alla costruzione dove sono. Con `DATI` restano quelli impacchettati.

## Dopo la Fase A

Quando i piani sono in `main` (Fase A della pre-alpha), la base diventa
`main`. Le toppe si riportano a mano: `bench/` e `src/host/fake.ts` restano
toppe del finto; le sonde di Scrittoio 2 restano finché i loro task non le
hanno scritte nel codice.
