# 0237 — La lavagna gira in WebAssembly nella WebView

- **Stato:** accolta
- **Data:** 2026-11-03
- **Ambito:** sicurezza
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

La logica della lavagna (`.canvas`) vive nel nucleo Rust `fub-canvas-core`:
lo usano i comandi dell'host, la CLI e il server MCP. La tela della shell
deve usare lo stesso nucleo, altrimenti le regole di lettura e di
riscrittura di Rust e di TypeScript si separano, e un agente e la shell
vedono due lavagne diverse dallo stesso file.

La tela cambia la lavagna a ogni gesto. Una chiamata all'host per gesto
passerebbe dalla IPC; il nucleo dentro la WebView non ne ha bisogno, ma la
WebView deve poter compilare WebAssembly. La CSP dell'app,
`script-src 'self'`, lo vieta: compilare un modulo è una forma di
esecuzione di codice, e senza un permesso esplicito WebKitGTK, WebView2 e
WKWebView rifiutano `WebAssembly.compile`.

Il codice non dice perché la CSP si apre proprio così e non di più, né
perché il ponte fra JavaScript e il modulo è scritto a mano.

## Decisione

1. **Il nucleo della lavagna gira nella WebView come WebAssembly.** Il crate
   `fub-canvas-wasm` è la sua facciata per `wasm32-unknown-unknown`; il
   modulo si compila una volta, resta in memoria, e ogni lavagna aperta è un
   handle della stessa istanza.
2. **Il ponte è un'interfaccia C scritta a mano** (D-1 (a) del piano N3):
   testo e JSON UTF-8 dentro e fuori, memoria chiesta e liberata dal
   chiamante, nessuna libreria di collegamento (niente `wasm-bindgen`) e
   nessun import nel modulo. Il patto sta in
   [Le operazioni della lavagna](../reference/canvas-operations.md#webassembly);
   non è un contratto pubblico: lo usano soltanto il caricatore della shell
   e il modulo della stessa build.
3. **Il modulo lo compila Vite dai sorgenti a ogni build** (D-2 (a)):
   niente `.wasm` committato e niente ripiego su un modulo di prima. Chi
   costruisce il client ha bisogno di Rust con il target
   `wasm32-unknown-unknown`, in locale e in ogni job della CI che costruisce
   o prova il client.
4. **La CSP si apre soltanto per compilare WebAssembly** (D-3 (a)):
   `script-src 'self' 'wasm-unsafe-eval'`, e nessun'altra voce cambia.
   `'wasm-unsafe-eval'` permette `WebAssembly.compile` e
   `WebAssembly.instantiate`; non permette `eval`, `new Function`, né un
   timer con una stringa, che restano vietati perché `'unsafe-eval'` non c'è.
   Un modulo si carica soltanto da `'self'`, come gli script.
5. **Un test tiene la promessa.** `crates/fub-app/tests/platform_configs.rs`
   legge la CSP della config fusa di ogni piattaforma (Linux, Windows,
   macOS, Android, iOS), e `devCsp` se c'è, direttiva per direttiva, e
   fallisce se `'unsafe-eval'` compare in una direttiva qualsiasi, se
   `'wasm-unsafe-eval'` compare fuori da `script-src`, se `script-src` manca,
   compare due volte o non è esattamente `'self' 'wasm-unsafe-eval'`, o se
   `script-src-elem` o `script-src-attr` lo scavalcano.

L'inchiostro resta in TypeScript, come vuole la
[decisione 0204](0204-nucleo-inchiostro.md): questa decisione riguarda la
lavagna, che chiama il nucleo a ogni gesto finito e non a ogni evento del
puntatore.

## Conseguenze

### Positive

- la shell, l'host, la CLI e il server MCP leggono e riscrivono una lavagna
  con lo stesso codice: un file che uno apre lo apre anche l'altro, e la
  riscrittura è la stessa byte per byte;
- un gesto sulla tela non attraversa la IPC;
- il modulo non importa niente: dentro la WebView non vede né la rete né il
  DOM, e un difetto del nucleo è una trappola dell'istanza, non della
  pagina;
- l'apertura della CSP è una parola, e un test la tiene ferma.

### Negative

- chi costruisce il client ha bisogno di Rust e del target
  `wasm32-unknown-unknown`, anche se cambia soltanto TypeScript;
- la WebView può compilare WebAssembly da `'self'`: un modulo malevolo
  dovrebbe prima entrare fra gli asset dell'app, come uno script;
- una WebView abbastanza vecchia da non conoscere `'wasm-unsafe-eval'` non
  compila il modulo, e la lavagna non si cambia: Fub non ha un ripiego in
  TypeScript;
- il ponte scritto a mano va tenuto allineato al caricatore a ogni cambio:
  le due parti cambiano insieme, e le provano i vettori comuni.

## Alternative scartate

### `wasm-bindgen`

Più comodo da scrivere, ma è una dipendenza nuova, e `wasm-bindgen-cli`
della stessa versione deve esserci su ogni macchina e in ogni job che
costruisce il client. Il ponte a mano è piccolo e senza import.

### Un `.wasm` committato

Toglierebbe Rust a chi lavora solo sul client, ma metterebbe un binario nel
repository e una guardia che lo confronti con i sorgenti: un modulo vecchio
sarebbe una lavagna con le regole di prima.

### `'unsafe-eval'` in `script-src`

Basterebbe anche per WebAssembly, ma permetterebbe di eseguire testo come
JavaScript: una stringa del vault che arrivasse a un `eval` diventerebbe
codice.

### Il nucleo soltanto nell'host

Ogni gesto della tela sarebbe una chiamata IPC, e la tela aspetterebbe
l'host per mostrare ogni spostamento.

## Verifica

- `cargo test -p fub-app --test platform_configs`: la CSP di ogni
  piattaforma e i casi in negativo del controllo;
- lo scenario L1 del banco WebView (`apps/client/bench/webview/canvas.mjs`):
  l'app di release compila il modulo con la sua CSP, e lo scenario fallisce
  se la compilazione è rifiutata o se la pagina vede una violazione;
- i test sul `.wasm` vero: `crates/fub-canvas-wasm/tests/` e
  `apps/client/src/editors/canvas/wasm/`.
