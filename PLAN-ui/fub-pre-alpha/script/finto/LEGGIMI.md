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
# le pagine dei piani (p-*): cartelle=piani, senza client, da file://
# tutte insieme, come il 2026-11-06 (circa un'ora; DATI va esportato):
#   DATI=.. bash ricattura-tutto.sh <client 0c2a7e91 + cattura.patch> <client 5006937c + avvio.patch>

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
