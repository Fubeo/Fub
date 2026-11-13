# 2026-11-03, Linux, il nucleo della lavagna in WebAssembly

Questa pagina conserva la misura del piano N3 (T15): il modulo
`fub-canvas-wasm`, la facciata WebAssembly di `fub-canvas-core`, in Node e
nella WebView di Linux (WebKitGTK), con la CSP dell'app.

> **Per chi:** chi tara le soglie dello scenario L1 del banco WebView e chi
> rifà la misura su un'altra macchina.
> **Risultato:** sapere quanto pesa il modulo, quanto costa averlo pronto, e
> quanto costano un'apertura e un cambio di una lavagna piccola e di una
> grande.

La decisione che porta il modulo nella WebView è la
[0237](../decisions/0237-la-lavagna-in-webassembly-nella-webview.md).

## Chi, cosa, quando

- commit di base `a1329299` con la CSP di T15 (`4c9f215f`), ramo
  `coder/n3-t15`, 2026-11-03;
- il modulo: `dist/assets/fub-canvas-<hash>.wasm`, compilato da
  `apps/client/build/canvas-wasm.mjs` dentro `npm run build`
  (`cargo rustc --release --crate-type cdylib`, `opt-level = "s"`, LTO,
  `panic = "abort"`, un'unità di compilazione, simboli tolti);
- il banco: `apps/client/bench/webview/canvas.mjs`, da solo in Node e come
  scenario L1 di `apps/client/bench/webview/run.mjs` nell'app di release;
- comandi, da `apps/client/`, dopo `npm run build`:
  - Node: `node bench/webview/canvas.mjs --giri=2`;
  - WebKitGTK, dopo
    `cargo build --release --locked -p fub-app --features tauri/custom-protocol`:
    `xvfb-run -a -s "-screen 0 1280x800x24" npm run bench:webview -- --only=L1 --native-driver=/usr/bin/WebKitWebDriver`.

## La macchina

- server-di-fub: AMD Ryzen 7 7730U, 16 nuclei logici, 15 GiB di memoria,
  nessuna scheda grafica leggibile (WebKit disegna in software);
- Debian GNU/Linux 13, kernel 6.12.111, X11 sotto Xvfb;
- Rust 1.95.0; Node.js 22.23.3 (V8 12.4.254.21);
- WebKitGTK 2.54.0 (`libwebkit2gtk-4.1-0` 2.54.0-1~deb13u3), user agent
  `AppleWebKit/605.1.15 … Version/60.5 Safari/605.1.15`.

La macchina era condivisa con altre build e altri banchi: il carico medio a
un minuto (`/proc/loadavg`) è scritto per ogni giro, ed è la prima fonte di
rumore.

## Il modulo

| Misura | Byte |
|---|---|
| grezzo | 460 310 (449,5 KiB) |
| gzip -9 | 164 182 |
| brotli | 131 363 |

Il modulo non importa niente ed esporta la sua memoria; istanziato, ha
11 468 800 byte di memoria lineare.

## Come si misura

Le lavagne sono generate dal banco, uguali in Node e nella WebView: schede di
testo su una griglia di 20 colonne, ognuna legata alla successiva da un arco,
in JSON indentato con le tabulazioni.

| Lavagna | Schede | Archi | Byte |
|---|---|---|---|
| piccola | 50 | 49 | 16 348 |
| grande | 2 000 | 1 999 | 678 692 |

Per ogni giro:

- **istanza**: compilare e istanziare il modulo (`WebAssembly.compile` e
  `WebAssembly.instantiate`), a partire dai byte già scaricati;
- **open**: `canvas_open` sul testo e `canvas_close`; la prima apertura si
  conta a parte, poi 20 aperture;
- **commit**: lo spostamento della scheda di mezzo, poi il suo inverso,
  alternati; il primo a parte, poi 200. Il banco applica ogni modifica al
  testo e alla fine controlla che il testo sia tornato quello di partenza.

Nella WebView, `performance.now()` ha la risoluzione di un millisecondo:
i numeri di WebKitGTK sono interi, e un valore di 0 o 1 ms dice soltanto
«sotto la risoluzione».

## I numeri in Node

Millisecondi. Due processi separati, due giri ciascuno; il secondo giro di
ogni processo trova il motore già caldo.

| Misura | Proc. 1, giro 1 | Proc. 1, giro 2 | Proc. 2, giro 1 | Proc. 2, giro 2 |
|---|---|---|---|---|
| carico all'inizio → alla fine | ~5 | ~5 | 38,3 → 36,5 | 38,3 → 36,5 |
| istanza (compilare + istanziare) | 1,41 (1,31 + 0,11) | 1,22 | 6,14 (5,37 + 0,78) | 1,83 (1,63 + 0,20) |
| 50 schede, prima apertura | 3,00 | 0,49 | 7,02 | 0,90 |
| 50 schede, open p50 / p95 / max | 0,46 / 0,98 / 1,43 | 0,29 / 0,31 / 0,33 | 0,66 / 1,35 / 3,52 | 0,36 / 0,58 / 3,14 |
| 50 schede, primo commit | 4,13 | 0,24 | 7,67 | 0,35 |
| 50 schede, commit p50 / p95 / max | 0,21 / 0,31 / 0,72 | 0,19 / 0,21 / 0,28 | 0,32 / 0,54 / 1,29 | 0,24 / 0,43 / 0,45 |
| 2 000 schede, prima apertura | 18,45 | 17,04 | 35,44 | 26,38 |
| 2 000 schede, open p50 / p95 / max | 12,72 / 15,22 / 15,73 | 13,15 / 15,76 / 17,29 | 35,18 / 75,72 / 88,68 | 19,85 / 27,73 / 32,60 |
| 2 000 schede, primo commit | 6,76 | 6,88 | 25,86 | 15,13 |
| 2 000 schede, commit p50 / p95 / max | 6,63 / 6,99 / 8,64 | 6,70 / 6,93 / 7,07 | 7,58 / 28,05 / 66,40 | 10,70 / 21,94 / 45,44 |

Il rumore: con il carico intorno a 5, i due giri a motore caldo stanno
entro il 10% sulla lavagna grande. Con il carico a 38 la lavagna grande
costa da 1,5 a 5 volte tanto e i massimi si allargano: il secondo processo
dice quanto pesa una macchina occupata, non quanto costa il nucleo.

## I numeri in WebKitGTK

Millisecondi interi, dall'app di release con la CSP
`script-src 'self' 'wasm-unsafe-eval'`. Tre avvii dell'app, un giro
ciascuno; nessuna violazione della CSP in nessuno.

| Misura | Avvio 1 | Avvio 2 | Avvio 3 |
|---|---|---|---|
| carico all'inizio → alla fine | 9,5 → 5,1 | ~5 → 3,7 | non annotato |
| scaricare il modulo (`fetch`) | 9 | 31 | 7 |
| compilare / istanziare | 30 / 1 | 7 / 1 | 8 / 0 |
| 50 schede, prima apertura | 9 | 6 | 4 |
| 50 schede, open p50 / p95 / max | 1 / 2 / 3 | 1 / 1 / 1 | 1 / 1 / 2 |
| 50 schede, primo commit | 2 | 3 | 5 |
| 50 schede, commit p50 / p95 / max | 0 / 1 / 6 | 0 / 1 / 2 | 0 / 1 / 1 |
| 2 000 schede, prima apertura | 29 | 23 | 25 |
| 2 000 schede, open p50 / p95 / max | 13 / 15 / 29 | 15 / 28 / 39 | 12 / 13 / 24 |
| 2 000 schede, primo commit | 6 | 7 | 5 |
| 2 000 schede, commit p50 / p95 / max | 5 / 7 / 8 | 6 / 8 / 11 | 5 / 6 / 6 |

Il rumore: la compilazione va da 7 a 30 ms (il primo avvio, col carico a
9,5); l'apertura della lavagna grande ha il p95 fra 13 e 28 ms. Il commit
della lavagna grande sta fra 5 e 8 ms al p95 in tutti e tre gli avvii.

## La CSP in negativo

Con `script-src 'self'` (senza `'wasm-unsafe-eval'`) nell'app di release,
lo scenario L1 fallisce e lo dice:

```text
✗ L1: il nucleo della lavagna non si carica (misura: Refused to create a
WebAssembly object because 'unsafe-eval' or 'wasm-unsafe-eval' is not an
allowed source of script in the following Content Security Policy
directive: "script-src 'self' 'sha256-…' …" (evaluating
'WebAssembly.compile(bytes)'))
```

Tauri aggiunge a `script-src` le impronte degli script della pagina: la
direttiva che WebKit cita è quella, non quella scritta nella config.

La config entra nel binario dalla macro `tauri::generate_context!`: con
`sccache` come `RUSTC_WRAPPER`, un cambio della sola `tauri.conf.json` può
non ricompilare `fub-app` e lasciare la CSP di prima. Per questa prova la
build è partita senza `sccache` e con `crates/fub-app/src/lib.rs` toccato,
e la CSP dentro il binario è stata controllata.

## Che cosa non è misurato

- WebView2 (Windows) e WKWebView (macOS, iOS) e la WebView di Android: non
  provate qui;
- una macchina con la scheda grafica: il nucleo non disegna, ma la pagina
  intorno sì;
- la tela vera: L1 chiama il modulo dalla pagina, non dai gesti della tela.
