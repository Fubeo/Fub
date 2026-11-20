# Misure

Questa cartella conserva le misure dei tempi di Fub nella WebView vera, una
pagina per macchina e commit.

> **Per chi:** chi confronta i tempi fra versioni, sistemi e WebView, e chi
> tara le soglie della CI.
> **Risultato:** sapere quanto ha misurato quale macchina, su quale commit.

Come si prendono le misure lo dice [Misure nella WebView](../development/webview-measurements.md).
Gli obiettivi stanno in `apps/client/bench/webview/budgets.json`.

## Il formato

Un file per misura, chiamato `AAAA-MM-GG-sistema-webview.md`, con:

- commit, data e chi ha misurato;
- macchina: processore, nuclei, memoria, scheda grafica, schermo, fattore di
  scala e frequenza di aggiornamento;
- sistema: nome, versione e, su Linux, sessione Wayland o X11;
- WebView e versione, dallo user agent del referto;
- una tabella con scenario, valore, obiettivo, campioni ed esito;
- gli scenari saltati, col motivo, e quelli non provati.

Un numero si scrive soltanto se è stato misurato. Uno scenario non provato
resta **non provato**.

## Le misure

| Data | Sistema | WebView | Pagina |
|---|---|---|---|
| 2026-10-30 | Linux 7.0 (Azure), X11 sotto Xvfb | WebKitGTK, Safari 605.1.15 | [Runner della CI](2026-10-30-linux-webkitgtk-runner.md) |
| 2026-10-31 | Linux 7.0 (Azure), X11 sotto Xvfb | WebKitGTK, Safari 605.1.15 | [Runner della CI: la memoria e le tessere](2026-10-31-linux-webkitgtk-runner-k0.md) |
| 2026-11-16 | Debian 13, niri su Wayland, schermo a 180 Hz | WebKitGTK 2.54, Safari 605.1.15 | [Le soglie in periodi sullo schermo a 180 Hz](2026-11-16-linux-webkitgtk-frequenza-schermo.md) |
| 2026-11-17 | Debian 13, niri su Wayland, schermo a 180 Hz, RTX 4070 | WebKitGTK 2.54 | [Il tetto dei 60 Hz su NVIDIA](2026-11-17-linux-webkitgtk-tetto-60hz.md) |
| 2026-11-17 | Debian 13, niri su Wayland, schermo a 180 Hz, RTX 4070 | WebKitGTK 2.54 | [Il vblank emulato su NVIDIA](2026-11-17-linux-vblank-emulato.md) |
| 2026-11-19 | Debian 13, niri su Wayland, schermo a 180 Hz, RTX 4070 | WebKitGTK 2.54.0 e 2.54.3 (Flatpak) | [Il ritmo dello schermo su NVIDIA](2026-11-19-linux-ritmo-schermo.md) |
| 2026-11-20 | Debian 13, niri su Wayland, schermo a 180 Hz, RTX 4070 | WebKitGTK 2.54.0 | [La doppia attesa di EGL su NVIDIA](2026-11-20-linux-egl-doppia-attesa.md) |
| 2026-11-17 | Linux 7.0 (Azure), X11 sotto Xvfb | WebKitGTK, Safari 605.1.15 | [Runner della CI: il tasto di S1 e la lavagna piccola](2026-11-17-banco-webview-s1-l1-runner.md) |

## I motori

Le misure di K0 dei motori Craft, collegati a Fub da soli
([`tools/motori-prova`](../../tools/motori-prova/README.md)): una pagina
`AAAA-MM-GG-motori-sistema-macchina.md` per misura, con peso, memoria, tempi
e librerie.

| Data | Sistema | Macchina | Pagina |
|---|---|---|---|
| 2026-10-31 | Debian 13, kernel 6.12 | AMD Ryzen 7 7730U, senza scheda grafica | [I sei motori da soli](2026-10-31-motori-linux-ryzen.md) |

## I cancelli

Le misure prima e dopo di un piano, sulla stessa macchina, con il giudizio
sul suo cancello.

| Data | Piano | Macchina | Pagina |
|---|---|---|---|
| 2026-11-02 | K3, lo strato dei motori | `server-di-fub`, AMD Ryzen 7 7730U, WebKitGTK 2.54 sotto Xvfb | [Il cancello di K3](2026-11-02-k3-motori-server-di-fub.md) |
| 2026-11-12 | K5, il disegno sul motore | `pc-debian-di-fub`, Intel Core i5-13600KF | [Il cancello di K5](2026-11-12-disegno-linux-13600kf.md) |
| 2026-11-16 | C5, il cambio fra schede aperte | `pc-debian-di-fub`, Intel Core i5-13600KF, WebKitGTK 2.54 con la GPU | [Il cambio scheda](2026-11-16-linux-webkitgtk-cambio-scheda.md) |

## Gli inventari

Gli inventari di K0 sul codice dei motori: che cosa vive dove, con righe
contate e revisione.

| Data | Motore | Pagina |
|---|---|---|
| 2026-10-31 | PhotoCraft `b1cfff9` | [Gli strumenti dentro l'interfaccia](2026-10-31-photocraft-strumenti.md) |

## L'inchiostro in WebAssembly

La misura di N3 (T17): il riduttore dell'inchiostro nella copia TypeScript e
in quella Rust compilata in WebAssembly
([`tools/ink-wasm-banco`](../../tools/ink-wasm-banco/Cargo.toml)), con
`npm run bench:ink`.

| Data | Sistema | Macchina | Pagina |
|---|---|---|---|
| 2026-11-02 | Debian 13, kernel 6.12 | AMD Ryzen 7 7730U, scarica | [TypeScript contro WebAssembly](2026-11-02-inchiostro-wasm.md) |

## Il nucleo della lavagna

La misura di N3 (T15): il modulo `fub-canvas-wasm` in Node e nella WebView
di Linux, con la CSP dell'app, e quella del runner da cui vengono le soglie
della CI
([`bench/webview/canvas.mjs`](../../apps/client/bench/webview/canvas.mjs),
scenario L1).

| Data | Sistema | Macchina | Pagina |
|---|---|---|---|
| 2026-11-03 | Debian 13, kernel 6.12, WebKitGTK 2.54 sotto Xvfb | AMD Ryzen 7 7730U, condivisa | [Il nucleo della lavagna in WebAssembly](2026-11-03-lavagna-wasm.md) |
| 2026-11-15 | Linux 7.0 (Azure), X11 sotto Xvfb, WebKitGTK | runner della CI, AMD EPYC 7763, 4 nuclei | [Il nucleo della lavagna sul runner della CI](2026-11-15-lavagna-wasm-runner.md) |
| 2026-11-17 | Linux (Azure), X11 sotto Xvfb, WebKitGTK | runner della CI, 4 nuclei | [L'istanza del nucleo della lavagna sul runner della CI](2026-11-17-lavagna-wasm-istanza-runner.md) |

## L'inchiostro sulla lavagna

Le due misure del cancello di N4 (S8 di
[`bench/webview/run.mjs`](../../apps/client/bench/webview/run.mjs)): la
prima sul caso simile, una tabella di testo sotto la penna; la seconda sul
foglio vero dentro la lavagna: è lei a chiudere la voce, se la meta è raggiunta.
La terza pagina è il profilo della seconda: di chi è il tempo dei
fotogrammi lunghi.

| Data | Sistema | Macchina | Pagina |
|---|---|---|---|
| 2026-11-09 | Debian 13, kernel 6.12, WebKitGTK 2.54 sotto Xvfb | AMD Ryzen 7 7730U, condivisa | [La penna sulla lavagna, la prima misura](lavagna-inchiostro-2026-11-09.md) |
| 2026-11-11 | Debian 13, kernel 6.12, WebKitGTK 2.54 sotto Xvfb e sullo schermo | Intel Core i5-13600KF, GPU RTX 4070 sullo schermo | [Il foglio vivo sulla lavagna, la seconda misura](lavagna-inchiostro-foglio-2026-11-11.md) |
| 2026-11-13 | Debian 13, kernel 6.12, WebKitGTK 2.54 sotto Xvfb | Intel Core i5-13600KF, condivisa e carica | [Dove va il tempo della penna sul foglio vivo, il profilo](lavagna-inchiostro-profilo-2026-11-13.md) |

## I fogli vivi sulla lavagna

La misura del cancello di N6 (S9 di
[`bench/webview/run.mjs`](../../apps/client/bench/webview/run.mjs)): la
lavagna di S3 con venti fogli `.xlsx` vivi, spostata e ingrandita come S3.

| Data | Sistema | Macchina | Pagina |
|---|---|---|---|
| 2026-11-13 | Debian 13, kernel 6.12, WebKitGTK 2.54 sotto Xvfb | Intel Core i5-13600KF, condivisa, senza GPU sotto Xvfb | [La lavagna con venti fogli vivi](2026-11-13-lavagna-fogli-vivi-s9.md) |
| 2026-11-14 | Debian 13, kernel 6.12, WebKitGTK 2.54 sotto Xvfb, con `--x11` | Intel Core i5-13600KF, condivisa, senza GPU sotto Xvfb | [Il tasto in una scheda di nota, dopo le misure della lavagna](2026-11-14-lavagna-fogli-vivi-s9-tasto.md) |

## Le librerie a runtime

La prova del livello 3 del piano dei componenti
([`tools/librerie-runtime`](../../tools/librerie-runtime/README.md)), sui
tre sistemi della CI.

| Data | Sistemi | Pagina |
|---|---|---|
| 2026-10-31 | Linux, macOS, Windows (runner) | [Le librerie a runtime](2026-10-31-librerie-runtime.md) |

## Gli spike

La misura del varco WASM di M5, presa prima del runtime
([`tools/varco-wasm`](../../tools/varco-wasm/)), sui gradini che si potevano
provare senza un host.

| Data | Oggetto | Pagina |
|---|---|---|
| 2026-08-13 | il mondo dei plugin compilato a `wasm32-unknown-unknown` | [Spike WASM — rapporto](2026-08-13-spike-wasm-host.md) |

## Le versioni in comune

Il controllo di K5 sulle librerie che Fub e il motore del disegno hanno in
comune: versioni, librerie doppie e che cosa manca per allinearle.

| Data | Motore | Pagina |
|---|---|---|
| 2026-11-02 | VectorCraft `cfb30d81` | [Le versioni in comune](disegno-versioni-2026-11.md) |
