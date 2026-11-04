# Piano: la schermata di caricamento

Branch: piano/caricamento
Obiettivo: dal primo pixel Fub si apre già vestito: il fondo della luce giusta,
poi il marchio, la fase quando l'attesa si allunga, un guasto che si spiega, e
una consegna morbida all'app. L'HTML nudo, il lampo bianco e i bottoni blu del
browser non si vedono più in nessun modo di avvio.
Perché: oggi `index.html` non ha né `<style>` né `<link>`: luce e colori li monta
`mountTheme` dentro `init()` di `desktop-shell.ts`, cioè dopo che è arrivato
tutto il grafo dei moduli (in produzione 3,2 MB di JS, 35 modulepreload), e la
finestra Tauri non ha un colore di fondo. La persona vede per secondi la pagina
senza stile (misura sotto).
Fuori scope: l'icona dell'app (la «F» viola segnaposto) e la schermata di
lancio nativa del telefono (Android/iOS), che sono due issue a parte; il tema
montato tre volte e il longtask di 564 ms nello sviluppo (da aprire come issue:
non cambiano ciò che si vede, una volta coperto); riordinare l'avvio perché la
cornice dello Scrittoio compaia prima del vault (domanda 1); un contratto nuovo
del host per l'avanzamento (domanda 2).
Assunzioni: le consigliate delle «Domande per l'utente» qui sotto, finché
l'utente non risponde: la schermata resta finché la shell e il vault sono
pronti (domanda 1, A); mostra solo le fasi che la shell conosce già, senza IPC
nuovo (domanda 2, A); il passaggio è «si posa» (prototipo, nota 1, A: il
marchio vola sul bottone del menu e vi si posa con la molla elastica, l'app
sotto prende un respiro); l'attesa è la «scia» (prototipo, nota 2, A). Le tre pagine portano lo stesso
strato in linea: chi ne cambia una cambia le altre due (un test lo pretende).
Ondate: T1 T3 | T2 | T4
Prototipo: PLAN-ui/caricamento.html, da approvare (passaggio all'app rifatto
il 2026-11-04 su richiesta dell'utente: nota 1, A «si posa» e B «cascata» con
le molle vere di `moto`; «Rivedi», nello stato «Passaggio all'app», lo rifà)

## Modifiche

nessuna

## Domande per l'utente

1. **Fino a quando resta la schermata?**
   - **A (consigliata): finché la finestra e il vault sono pronti.** È il solo
     punto in cui l'app è intera: la cornice dello Scrittoio
     (`shells/scrittoio/bootstrap.ts`, `mobile/compose.ts`) si monta dopo
     `startup` della shell comune, che aspetta l'apertura del vault. Dopo 10 s
     la schermata dice «Ci vuole più del solito.»; dopo 30 s senza risposta
     diventa un guasto con «Riprova», e se l'avvio poi finisce la consegna
     avviene lo stesso. In pratica: mai una finestra a metà.
   - B: consegnare appena la finestra è disegnata, con il vault che si apre
     dentro l'app. Serve un task in più che riordini l'avvio di
     `desktop-shell.ts` e della cornice (chi monta prima, chi legge il nome del
     vault). In pratica: l'app si vede prima su un vault lentissimo, ma con un
     rischio di regressioni sull'avvio intero.
2. **Che cosa racconta l'attesa?**
   - **A (consigliata): le tre fasi che la shell conosce già** (la pagina, la
     finestra, il vault col suo nome), le stesse di `state/startup-timing.ts`.
     Nessun contratto nuovo col host. In pratica: su un vault grande la riga
     dice «Apro «Note»…» e la scia scorre, senza percentuale.
   - B: un contratto nuovo del host (eventi di avanzamento dell'apertura del
     vault e dell'indice). In pratica: una percentuale vera, ma IPC nuovo,
     mirror TS, fake host e test di conformità, per un'attesa che oggi dura
     di solito meno di 2 s.
3. **L'icona dell'app** (la «F» viola nella barra delle applicazioni) non è il
   marchio di Fub. Consigliata: un'issue a parte, con il disegno dell'icona per
   le tre piattaforme. In pratica: per ora la schermata è bella e l'icona resta
   quella.
4. **La schermata di lancio nativa del telefono** (prima che la WebView parta).
   Consigliata: un'issue a parte, perché si fa nei progetti Android e iOS
   generati. In pratica: sul telefono resta un istante di schermata del
   sistema prima della nostra.

## La misura del lampo

Prove usa e getta con Playwright e il Chromium di `apps/client`, finestra
1280×800, luce scura, nessuna preferenza salvata. Le foto sono in
`/home/fubeo/.cache/fub-k1/tmp/caricamento/foto/` (fuori dal repo).

| Avvio | Rallentamento | Che cosa si vede | Foto |
|---|---|---|---|
| produzione (`vite build` del banco, server statico) | CPU 4×, 150 ms di rete | pagina vuota fino a 339 ms; da 339 a 3525 ms solo `structure.css`: corpo bianco, bottoni nativi; tema a 3525 ms; i caratteri cambiano verso 4,3 s | `prod-bench-dark/f001-683ms.png` |
| sviluppo (Vite su 1448, già caldo) | CPU 4×, 40 ms | HTML nudo da 10 a 8058 ms: la foto dell'utente | `dev-dark/f002-108ms.png` |
| sviluppo | CPU 1× | HTML nudo da 4 ms a circa 5112 ms; primo disegno a 44 ms | — |

La causa è una sola: niente decide colori e luce prima del JS. In sviluppo Vite
inietta anche `structure.css` dal JS; in produzione `structure.css` arriva come
`<link>` ma la pelle e il tema li monta `mountTheme` alla fine del grafo. Nella
finestra Tauri, prima del primo disegno della WebView, si vede il fondo di
default della finestra (bianco), perché `crates/fub-app/tauri.conf.json` e
`document_windows.rs` non danno un colore.

## Come funziona (per tutti i task)

- **Lo strato in linea.** Nel `<head>` di `index.html`, `mobile.html` e
  `document.html` c'è lo stesso `<style id="avvio-stile">` (dal prototipo, blocco
  marcato `→ apps/client/index.html…`): variabili private `--avvio-*` per le
  quattro luci, `:root{background}`, l'aspetto di `.avvio`. Sta in linea e non
  nella pelle perché deve valere al primo disegno, prima di ogni JS e anche col
  JS spento, mentre la pelle la monta il JS dopo il sanitizer. Il sanitizer non
  lo legge: per questo non usa i ruoli del tema e se ne va alla consegna. La CSP
  di Tauri permette lo stile in linea (`style-src 'unsafe-inline'`) ma **non** lo
  script in linea (`script-src 'self'`): per questo gli script sono file.
- **Gli attributi propri.** Lo strato scrive `data-avvio-luce`,
  `data-avvio-contrasto`, `data-avvio-moto` e `data-avvio` su `<html>`, mai
  `data-theme`: `shells/scrittoio/frame/light.ts` e `panels/settings.ts`
  aspettano `data-theme` dal tema vero.
- **Solo classi nel CSS** (`.avvio`, `.avvio-marchio`…), mai `#avvio`: il
  fantasma di `moto` (`exitGhost`) clona l'elemento e toglie gli `id`.
- **Nessun `</style` dentro un commento del CSS** in linea: chiude l'elemento.
- **Due script classici**, serviti da `public/`:
  - `/avvio/luce.js`, sincrono nel `<head>` subito dopo lo stile: risolve luce,
    contrasto e moto come `theme.ts` e li scrive su `<html>`, applica i colori
    salvati, e da subito ascolta (in cattura) gli `error` degli `<script>`.
  - `/avvio/stati.js`, `defer` subito dopo: gira a pagina letta, prima dei
    moduli. Tiene i tempi (marchio, attesa, lento, guasto), mette i testi
    salvati, disegna il guasto.
- **La cache `fub.avvio`** in `localStorage`:
  `{ v: 1, luce, contrasto, moto, colori, testi, lingua }`.
  - `luce` e `contrasto` sono le *scelte* («system», «light», «dark»…), non il
    risultato.
  - `colori` ha una voce per luce risolta (`dark`, `light`, `dark-high`,
    `light-high`), con le otto chiavi `sfondo testo tenue accento inchiostro
    bordo guasto fuoco`.
  - `testi` ha i testi dello strato nella lingua risolta.
  - La scrive solo `src/avvio/` alla consegna; la leggono solo i due script.
  - Ogni colore passa `CSS.supports("color", v)` e non contiene `; { } < >`;
    se no si usa il colore di serie del CSS.
  - Una `v` diversa da 1 o un JSON rotto vale come assente.
  - Senza `fub.avvio`, `luce.js` legge `fub.appearance.theme` e
    `fub.appearance.preferences` (le cache di `theme.ts`), poi il sistema;
    il ripiego finale è la luce scura, come `theme.ts`.
- **I tempi**, contati da `performance.now()` della pagina:

  | Momento | Che cosa succede |
  |---|---|
  | 0 | il fondo |
  | 120 ms, o appena c'è il carattere del marchio (al più 1 s) | il marchio entra (220 ms) |
  | 2 s | la riga della fase e la scia |
  | 10 s | «Ci vuole più del solito.» |
  | 30 s senza `data-pronta` | il guasto per tempo |

- **La consegna** (in `src/avvio/`):
  1. aspetta il tema definitivo (anche quello dal catalogo) e
     `document.fonts.ready`, ciascuno al più 1,5 s;
  2. scrive `fub.avvio`;
  3. se il marchio non era ancora entrato, toglie lo strato senza animazione.
     L'avvio istantaneo non lampeggia: si vede solo il fondo, che è già quello
     dell'app;
  4. se no, lascia il marchio visibile almeno 400 ms, poi rende l'app viva
     (via `inert`, il fuoco al suo posto, lo strato senza puntatore) e solo
     dopo anima, così l'app risponde dal primo fotogramma del passaggio:
     - **A, «si posa»**: il marchio vola sul bottone del menu con la molla
       `snap` e intanto si stringe alla sua misura con la molla `elastic`
       (va un poco oltre e torna); l'app sotto respira da 0,98 con `elastic`;
     - **B, «cascata»**: lo strato sfuma in 90 ms e le regioni dell'app
       entrano in ordine di lettura, 30 ms l'una dall'altra, con `elastic`;
     - con moto ridotto, una sola dissolvenza di 90 ms;
  5. toglie lo strato e il resto.

## Dal prototipo

| Pezzo | Destinazione | Task |
|---|---|---|
| primo blocco `<style>` (marcato `→ apps/client/index.html…`), con i due `@font-face` del commento al posto di quelli del blocco «solo prototipo» | `<style id="avvio-stile">` nel `<head>` di `apps/client/index.html`, `mobile.html`, `document.html` | T1 |
| blocco `#proto-senza-js` (la regola, non l'attributo `media`) | `<noscript><style>…</style></noscript>` nel `<head>` delle tre pagine | T1 |
| markup di `#avvio.avvio` (velo, colonna, il posto `.avvio-posto` col marchio dentro, info con attesa/lento/guasto, frase senza JS, annuncio) | primo figlio di `<body>`, prima dello skip-link, nelle tre pagine | T1 |
| scia A e passi B: la sola scia A va nel codice; i passi restano nel prototipo finché l'utente non sceglie B | — | T1 |
| la logica di `applica()` (attributi, testi, nome, didascalie) | `apps/client/public/avvio/luce.js`, `stati.js` | T1 |
| `consegna()` (A «si posa», B «cascata», ridotto) e le tabelle `CASCATA` | `apps/client/src/avvio/consegna.ts`, sopra `moto` (`animate` con `spring: "snap"` ed `"elastic"`, `duration: DURATION.state`/`swap`, `pseudo: "::after"`, `delay`) | T2 |
| `campiona()` e `anima()` del prototipo | nessuna: sono la copia di `sampleSpring` e di `animate`, che T2 usa direttamente | — |
| regole `.avvio[data-consegna]{pointer-events:none}` e `:root[data-avvio="posa"] .brand-mark{opacity:0}` | già nel blocco in linea (T1); le usa T2 | T1, T2 |
| `.proto-app` e i suoi pezzi, `.proto-toppa`, `.proto-marchio-vero`, foto dell'app, barra, note, palco | solo prototipo: non vanno nel codice (i pezzi stanno per `#topbar`, `#rail`, `#sidebar`, `#panes`, `#right-pane`, `#status-band`, la copia per `#brand-menu .brand-mark`) | — |
| gli stati da fotografare | `apps/client/bench/scene.mjs` | T4 |

Testi (chiavi nuove, italiano e inglese, in `src/i18n/catalog.ts`):

| Chiave | Italiano |
|---|---|
| `app.avvio.annuncio` | «Fub si sta avviando» |
| `app.avvio.pagina` | «Carico Fub…» |
| `app.avvio.finestra` | «Preparo la finestra…» |
| `app.avvio.vault` | «Apro «{name}»…» |
| `app.avvio.lento` | «Ci vuole più del solito.» |
| `app.avvio.guasto` | «Fub non è partito» |
| `app.avvio.motivo.script` | «Una parte di Fub non si è caricata ({src}).» |
| `app.avvio.motivo.tempo` | «Nessuna risposta da 30 secondi durante {phase}.» (`{phase}` con le `app.startup_phase.*` che ci sono già) |
| `app.avvio.copia` | «Copia i dettagli» |
| `app.avvio.copiato` | «Dettagli copiati» |
| `app.avvio.senza_js` | «Fub ha bisogno di JavaScript per partire.» |

«Riprova» riusa `app.retry`.

## T1 · Lo strato d'avvio nelle tre pagine

Perché: è ciò che toglie il lampo: colori, luce e marchio prima di ogni modulo,
anche in sviluppo e col JS spento.
Tocca:
- `apps/client/index.html`, `apps/client/mobile.html`, `apps/client/document.html`
- `apps/client/public/avvio/luce.js` (nuovo), `apps/client/public/avvio/stati.js` (nuovo)
- `apps/client/src/i18n/catalog.ts` (le chiavi `app.avvio.*`)
- `apps/client/src/avvio/pagine.test.ts` (nuovo), `apps/client/src/avvio/luce.test.ts` (nuovo), `apps/client/src/avvio/stati.test.ts` (nuovo)
- `apps/client/src/shells/scrittoio/mobile/mobile-html.test.ts` e `apps/client/src/shells/scrittoio/document/document-html.test.ts` (solo se i loro elenchi di script o di id vanno aggiornati)
- `apps/client/src/avvio/consegna.ts` (nuovo, prima forma), `apps/client/src/avvio/consegna.test.ts` (nuovo)
- `apps/client/src/shells/scrittoio/bootstrap.ts`, `apps/client/src/shells/scrittoio/mobile/compose.ts`, `apps/client/src/shells/scrittoio/document/window.ts` (solo la chiamata a `consegna`)
Non toccare:
- la pelle (`src/theme/scrittoio/skin/`), `theme.ts`, `desktop-shell.ts`, il banco;
- `crates/`;
- il markup esistente delle pagine, salvo `inert` e `aria-busy="true"`:
  - su `#app` e sullo skip-link in `index.html` e `mobile.html`;
  - su `#document-window` in `document.html`.
Dipende da: nessuno
Cosa fare:
- Nel `<head>` delle tre pagine, in quest'ordine e prima di ogni altro
  script:
  1. due `<link rel="preload" as="font" type="font/woff2" crossorigin>`, per
     `/fonts/newsreader-latin-opsz-italic.woff2` e
     `/fonts/hanken-grotesk-latin-wght-normal.woff2`;
  2. lo `<style id="avvio-stile">` del prototipo, con i due `@font-face` del
     suo commento, ma con nomi di famiglia propri («Avvio Newsreader»,
     «Avvio Hanken») perché non tocchino quelli di `fonts.css`. Il marchio usa
     `font-display: block`, il testo `swap`;
  3. il `<noscript><style>` della frase senza JS;
  4. `<script src="/avvio/luce.js"></script>`, poi
     `<script defer src="/avvio/stati.js"></script>`.
- Il markup di `#avvio.avvio` come primo figlio di `<body>`, uguale nelle tre
  pagine, con `data-i18n` sui testi e i testi italiani di ripiego.
  - In `document.html` il volo non c'è (manca `#brand-menu`): la consegna è
    la B di T2, con `#document-window` al posto delle regioni.
  - `.avvio-annuncio` ha `role="status"`, ed è vuoto finché il marchio non
    entra.
- `luce.js`, IIFE senza globali e senza `import`:
  1. legge `fub.avvio`, se no le due cache di `theme.ts`;
  2. risolve con le stesse regole di `effectiveTheme`/`effectiveContrast`
     di `src/theme/theme.ts` (righe 166–180) e della preferenza di moto di
     `theme/reduced-motion.ts`;
  3. scrive `data-avvio-luce`, `data-avvio-contrasto` e `data-avvio-moto` su
     `<html>`;
  4. applica i `colori` validi come proprietà `--avvio-*` sullo stile di
     `<html>`;
  5. aggiunge su `window` un ascoltatore `error` in cattura: un `<script>` o
     un `<link rel="modulepreload">` che non arriva scrive
     `data-avvio-script` (il percorso) su `<html>`;
  6. ogni accesso a `localStorage` sta in un `try`.
- `stati.js`:
  - mette i `testi` salvati sugli elementi con `data-i18n` dentro `.avvio`;
  - imposta `data-marchio` (e `data-marchio-da` con l'ora) a 120 ms, o appena
    il carattere del marchio è pronto, al più a 1 s, e scrive l'annuncio;
  - imposta `data-stato="attesa"` a 2 s e `"lento"` a 10 s;
  - a 30 s senza `data-pronta` su `.avvio`, mostra il guasto per tempo;
  - con `data-avvio-script`, o con un evento `avvio:guasto` su `.avvio`
    (`detail.motivo`), mostra subito il guasto con quel motivo.
  - Nel guasto:
    - mette `data-stato="guasto"` e il motivo come `textContent`;
    - dà il fuoco a Riprova (`location.reload()`);
    - «Copia i dettagli» compare solo se c'è `navigator.clipboard`, e copia
      motivo, fase, `navigator.userAgent` e i tempi;
    - l'annuncio diventa titolo + motivo.
  - Mai `innerHTML`; nessun timer resta acceso dopo che `.avvio` è stato tolto
    (ogni giro controlla `isConnected`).
- La riga della fase legge `data-fase` (`pagina`, `finestra`, `vault`) e
  `data-nome` da `.avvio`: le scrive T2. Il nome sta in uno `<span>` fra le
  virgolette, tagliato dal CSS (`max-width: 26ch`, ellissi).
- Le chiavi della tabella «Testi», in italiano e in inglese.
- I test (happy-dom):
  - `pagine.test.ts` verifica che:
    - lo stile, il noscript e il markup di `.avvio` siano identici nelle tre
      pagine;
    - lo stile venga prima di ogni `<script>`, `luce.js` sia sincrono e
      `stati.js` sia `defer`;
    - il CSS in linea non contenga `#avvio` né `</style`;
    - ogni `data-i18n` dello strato abbia la sua chiave nel catalogo.
  - `luce.test.ts` carica `public/avvio/luce.js?raw` e lo esegue su una
    tabella di casi (cache assente, rotta, `v: 2`, scelta «system» con
    sistema chiaro/scuro, alto contrasto, colore cattivo `red;}`). Per ogni
    caso confronta gli attributi con `effectiveTheme`/`effectiveContrast`.
  - `stati.test.ts`, con timer finti, verifica:
    - 119 ms: niente marchio; 2 s: attesa; 10 s: lento; 30 s: guasto;
    - `data-pronta` prima dei 30 s: niente guasto;
    - lo script mancante dà subito il guasto e il fuoco su Riprova.
- **La consegna minima**, perché nessuno stato intermedio del ramo lasci lo
  strato sopra l'app. Senza di essa lo strato coprirebbe tutto e `#app`
  resterebbe inerte negli e2e, che iniettano il `<body>` di `index.html`.
  - `src/avvio/consegna.ts` esporta `consegna({ volo })`, che per ora fa solo
    i passi 6 e 8 di T2 (app viva, fuoco e pulizia), subito e senza
    animazione;
  - non fa niente se `.avvio` non c'è;
  - si chiama alla fine di `startup` in `bootstrap.ts` e in
    `mobile/compose.ts`, e alla fine di `bootDocumentWindow` (anche nel ramo
    di `invalid()`), nei punti descritti in T2;
  - T2 la completa senza spostare le chiamate.
- `consegna.test.ts`: dopo `consegna()` non ci sono più `.avvio`,
  `#avvio-stile`, `data-avvio-*`, `inert` né `aria-busy`, e il fuoco non resta
  su `body`.
Dal prototipo: il primo blocco `<style>`, il blocco senza JS, il markup di
`#avvio`, la parte di `applica()` che scrive attributi e testi.
Casi limite:
- `localStorage` che lancia (finestra privata): si va avanti col sistema.
- Un nome di vault lunghissimo o con `<`: `textContent`, ellissi.
- Lingua inglese al primo avvio: i testi italiani di ripiego finché la cache
  non c'è; `lang` resta quello della pagina.
- Alto contrasto forzato (`forced-colors`): le regole del prototipo.
- Pagina aperta col JS spento: marchio e frase, nella luce del sistema.
- `vite build`:
  - copia `public/avvio/` così com'è, e lascia i due `<script>` classici;
  - non deve né raggrupparli né riscriverli.
Fatto quando:
- i quattro test nuovi passano, e quelli delle pagine e della luce falliscono
  togliendo lo stile da una pagina o cambiando una regola di luce in
  `luce.js`;
- gli e2e esistenti (`src/*.e2e.test.ts`, `src/redraw.test.ts`) restano verdi
  con lo strato nel `<body>`;
- `npm run build` produce `dist/index.html` con `avvio-stile` e
  `/avvio/luce.js`, e `dist/avvio/` ha i due file;
- aprendo il banco (`npm run bench -- --port 1448 --strictPort`) con la CPU
  rallentata, il primo disegno è il fondo scuro e non c'è nessun bottone
  nativo; a shell pronta lo strato se ne va (foto nel resoconto del coder).
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T3 · Il fondo della finestra nativa

Perché: prima che la WebView disegni, la finestra Tauri mostra il suo fondo
(bianco): nel tema scuro è un lampo.
Tocca:
- `crates/fub-app/tauri.conf.json` (finestra `main`: `"visible": false`)
- `crates/fub-app/src/lib.rs` (il `setup`, righe ~2624–2650)
- `crates/fub-app/src/document_windows.rs` (il `WebviewWindowBuilder`, riga ~287)
- `crates/fub-app/src/avvio.rs` (nuovo; il modulo dichiarato in `lib.rs`)
Non toccare:
- `apps/client/` (i fogli si leggono, non si cambiano);
- `fub-host`, il resto della finestra (decorazioni, zoom);
- la CSP.
Dipende da: nessuno
Cosa fare:
- In `avvio.rs`:
  - una funzione che dalla scelta di luce di macchina
    (`fub_host::settings::APPEARANCE_THEME`: «system», «light», «dark») e da
    `APPEARANCE_CONTRAST` dà il `tauri::window::Color` del fondo:
    `#0a0e16` scuro, `#e8edf5` chiaro (gli alti contrasti hanno oggi lo stesso
    `--bg`);
  - «system» usa `window.theme()`; un errore, o un sistema che non risponde,
    dà lo scuro, come `theme.ts`.
- Nel `setup`, per ogni finestra:
  1. `set_background_color(Some(colore))`; un errore si ignora con un
     commento sul perché;
  2. poi `show()` sulla `main` (`#[cfg(not(mobile))]`).
  `show()` va chiamato anche se il colore fallisce, e prima di
  `start_control`.
- Nelle finestre documento: `.background_color(colore)` sul builder, con la
  stessa funzione e le stesse impostazioni di macchina.
- Un test in `avvio.rs` legge con `include_str!`
  `apps/client/src/theme/scrittoio/sheet-{dark,light,dark-high,light-high}.css`,
  estrae `--bg:` e pretende che coincida con i colori della funzione: se un
  foglio cambia, il test lo dice.
Casi limite:
- Mobile: niente `visible` né `show()`; il fondo nativo non è supportato
  (lo dice la documentazione di Tauri 2.11).
- macOS: il colore non arriva al livello della WebView, solo alla finestra
  (limite di Tauri): resta da guardare a mano, fuori dalla CI.
- Un tema installato con un altro fondo: la finestra usa quello di serie fino
  al primo disegno; poi vale la cache di T1.
- Una finestra che non si mostra è peggio di un lampo: `show()` non deve
  dipendere da niente che possa fallire.
Fatto quando:
- il test dei colori passa e fallisce cambiando un `--bg` in un foglio;
- `cargo build -p fub-app` passa;
- la finestra si apre con il fondo della luce scelta (Linux, a occhio con
  `cargo tauri dev` o il banco WebView di `CLAUDE_DEVICE.md`), senza lampo
  bianco.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T2 · La consegna all'app

Perché: lo strato deve lasciare il posto all'app nel momento giusto, senza
scatti, e dire il guasto quando l'avvio fallisce.
Tocca:
- `apps/client/src/avvio/consegna.ts` e `apps/client/src/avvio/consegna.test.ts` (nati in T1)
- `apps/client/src/desktop-shell.ts` (`init()` e `mountDesktopShell`)
- `apps/client/src/shells/scrittoio/bootstrap.ts`
- `apps/client/src/shells/scrittoio/mobile/compose.ts`
- `apps/client/src/shells/scrittoio/document/window.ts`
- `apps/client/src/theme/theme.ts` (solo se manca un modo per sapere che il tema definitivo è montato)
- `docs/architecture/frontend-and-ipc.md`
Non toccare:
- le tre pagine, `public/avvio/`, `catalog.ts` (T1);
- il banco (T4);
- `moto` (si usa, non si cambia);
- l'ordine dell'avvio della shell (domanda 1).
Dipende da: T1
Cosa fare:
- `consegna.ts` (la prima forma è di T1) esporta, ciascuna senza effetto se
  `.avvio` non c'è (test, pagine senza strato):
  - `fase(f, nome?)`, che scrive `data-fase` e `data-nome`;
  - `pronta()`, che scrive `data-pronta`;
  - `fallito(motivo)`, che manda l'evento `avvio:guasto`;
  - `consegna({ volo })`.
- `desktop-shell.ts`:
  - `fase("finestra")` all'inizio di `init()`;
  - `fase("vault", nome)` prima di `openInitialVault`, col nome che userebbe
    la barra;
  - `pronta()` subito dopo `clock.mark("shell")`;
  - nel `catch` di `mountDesktopShell`, `fallito(reason)` al posto
    dell'avviso, che sotto lo strato non si vedrebbe. La riga di
    `vaultPathEl` resta.
  - Un vault iniziale che non si apre non è un guasto: la consegna avviene, e
    l'avviso dell'app lo dice come oggi.
- I punti di chiamata li mette T1, e T2 li tiene; ecco quali sono. La consegna
  si chiama alla fine vera dell'avvio, perché `startup` si risolva dopo:
  - in `shells/scrittoio/bootstrap.ts`: `startup` diventa la promessa della
    composizione seguita da `await consegna({ volo: true })`;
  - lo stesso in `mobile/compose.ts`;
  - in `document/window.ts`: `consegna({ volo: false })` alla fine di
    `bootDocumentWindow`, anche nel ramo di `invalid()`, perché lì la serie
    (`mountSeriesFallback`) è già montata. Il tema rispecchiato dal ponte può
    non arrivare mai, quindi non si aspetta: quando arriva, cambia i colori
    sotto.
  - Se l'avvio è finito nel guasto, niente consegna (questo lo aggiunge T2).
- `consegna`:
  1. aspetta il tema definitivo (incluso il catalogo: `waitingForCatalog` in
     `theme.ts`) e `document.fonts.ready`, ciascuno al più 1,5 s;
  2. scrive `fub.avvio` (forma in «Come funziona»): colori letti con
     `getComputedStyle(document.documentElement)` da
     `--bg --text --muted --accent --accent-contrast --border --danger --focus-ring`,
     e testi `t()` delle chiavi `app.avvio.*`;
  3. porta le `--avvio-*` dello strato ai colori appena letti, così il velo
     sfuma verso il fondo vero;
  4. se `.avvio` non ha `data-marchio`, fa subito i passi 6 e 8, senza
     animazione;
  5. se no, aspetta che siano passati 400 ms da `data-marchio-da`;
  6. rende viva l'app **prima** di animare, così risponde dal primo
     fotogramma del passaggio:
     - `data-consegna` e `aria-hidden="true"` su `.avvio` (la regola in linea
       `.avvio[data-consegna]{pointer-events:none}` lascia passare i clic);
     - toglie `inert` e `aria-busy` da `#app`, dallo skip-link e da
       `#document-window`;
     - fuoco: se `document.activeElement` è `body`, lo dà, nell'ordine, al
       contenuto modificabile del foglio attivo (`.pane.focus`), al primo
       bottone della scelta del vault, a `#panes`. Le chiamate `focus()`
       fatte durante l'avvio su un `#app` inerte si sono perse.
  7. anima, con le molle e i tempi di `moto` (nessun numero nuovo):
     - **moto ridotto** (`motionLevel() === "reduced"` o `data-avvio-moto`):
       lo strato sfuma in `DURATION.state` (90 ms), lineare; il marchio vero
       resta visibile;
     - **A, «si posa»**, come `consegna()` del prototipo:
       1. misura `#brand-menu .brand-mark` (rettangolo bersaglio) e
          `.avvio-marchio` prima di muovere qualcosa;
       2. le info sfumano in `DURATION.state`, lineare; il velo in
          `DURATION.swap` (140 ms) con l'uscita (`ease-out`,
          `[0, 0, 0.58, 1]`); l'ombra `::after` del marchio in
          `DURATION.state` (`pseudo: "::after"`);
       3. `#app` (o `#document-window`) respira da `scale: 0.98` a 1 con
          `spring: "elastic"` (la scala d'entrata del lanciatore);
       4. `data-avvio="posa"` su `<html>` nasconde il marchio vero;
       5. `.avvio-posto` trasla, centro su centro, fino al bersaglio con
          `spring: "snap"`; intanto `.avvio-marchio` scala a lato del
          bersaglio / 56 con `spring: "elastic"`: scende sotto la misura
          (circa 23 px contro 28 verso i 170 ms), torna su e si ferma
          identico al marchio vero (raggio 16 × 0,5 = 8, glifo 38 × 0,5 = 19);
       6. quando tutti e due i `finished` arrivano, toglie `data-avvio` e
          sfuma il marchio dello strato sopra quello vero in
          `DURATION.state` (copre il glifo e il raggio diversi del telefono);
     - **B, «cascata»**, o `volo: false`, o un bersaglio senza rettangolo:
       - lo strato sfuma in `DURATION.state`, lineare; il marchio scala a
         0,94 con `spring: "snap"` (`ENTER_SCALE` del dialogo);
       - le regioni presenti e con un rettangolo entrano in ordine di
         lettura con `spring: "elastic"`, da `opacity: 0` e una posa,
         sfasate di `FAN_EACH` (30 ms, `stagger({ each: 30 })`):
         `#topbar` y −8, `#rail` x −8 (sul telefono, in basso, y +8),
         `#sidebar` x −12, `#panes` y +16 e scala 0,98, `#right-pane` x +12,
         `#status-band` y +8;
       - in `document.html` non ci sono regioni: entra `#document-window`
         come `#panes`.
     - Il livello calmo lo gestisce `moto` (`springFor`: molle critiche),
       senza rami in `consegna.ts`.
  8. pulizia, quando le animazioni dello strato finiscono:
     - toglie `.avvio`, `#avvio-stile`, gli attributi `data-avvio-*` e le
       proprietà `--avvio-*`;
     - annulla solo le animazioni dello strato; quelle dell'app finiscono da
       sole e non lasciano `fill`.
- Ogni animazione passa da `moto` (`animate`, `whenReduced`), con `lifetime`.
  Un `startup` chiuso a metà (la pagina che si ricarica) non lascia animazioni
  vive né lo strato a metà (`check-listeners`).
- I test (`consegna.test.ts`, happy-dom, timer finti):
  - senza `data-marchio`: nessuna animazione e strato tolto;
  - con il marchio entrato da 100 ms: la consegna aspetta fino a 400 ms;
  - al primo fotogramma del passaggio (prima di qualunque `finished`):
    niente `inert` né `aria-busy`, `.avvio[data-consegna]`, il fuoco già al
    suo posto;
  - A: `animate` riceve `spring: "snap"` per `.avvio-posto`, `"elastic"` per
    `.avvio-marchio` e `#app`, e il bersaglio misurato; B: `"elastic"` per
    ogni regione presente con `delay` 0, 30, 60…; ridotto: una sola
    dissolvenza di 90 ms;
  - `volo: false` o `#brand-menu` senza rettangolo: B;
  - dopo la consegna: niente `.avvio`, niente `data-avvio*` su `<html>`,
    nessuna animazione viva (`document.getAnimations()` vuoto), e
    `fub.avvio` scritto e valido;
  - `fallito()`: lo strato resta e Riprova ha il fuoco;
  - `localStorage` che lancia: la consegna avviene lo stesso.
- In `docs/architecture/frontend-and-ipc.md`, accanto al paragrafo «Le pagine
  `index.html`, `mobile.html` e `document.html`…» (riga ~215):
  - lo strato d'avvio e la sua cache `fub.avvio`;
  - i tempi;
  - chi lo consegna;
  - perché sta in linea;
  - perché il suo CSS ha un `@keyframes` (la scia) pur fuori dalla regola
    «la pelle non ha fotogrammi chiave» (riga ~240): non è pelle, gira prima
    dei moduli e se ne va alla consegna.
Dal prototipo: `consegna()` (A, B, ridotto) e le pose di `CASCATA`.
`campiona()` e `anima()` del prototipo sono solo la copia di `sampleSpring` e
di `animate`, per mostrare le molle vere in una pagina sola: T2 usa `moto`.
Casi limite:
- L'avvio istantaneo (cache calda): niente marchio che lampeggia.
- Gli e2e in happy-dom:
  - iniettano solo il `<body>`, quindi `stati.js` non gira e `data-marchio`
    manca: la consegna toglie tutto subito, senza tempi in più;
  - happy-dom può non avere `document.fonts`: si salta l'attesa, non si
    lancia.
- Il tema dal catalogo che non arriva: dopo 1,5 s si consegna con quello che
  c'è.
- Il guasto per tempo e poi l'avvio che finisce: la consegna avviene.
- Il guasto della shell: lo strato resta, Riprova ricarica.
- Il telefono: il volo va sul marchio della barra mobile (44 px, raggio
  12,6, glifo 30); la scala è 44/56 e la sfumatura finale copre il raggio e
  il glifo diversi.
- `#brand-menu` nascosto (finestra stretta) o senza rettangolo: B.
- `.brand-mark` ha una transizione CSS su `transform`: la consegna anima solo
  il marchio dello strato, mai quello vero, che cambia solo `opacity` per la
  regola in linea.
- Il respiro di `#app` è una `scale` sotto cui c'è CodeMirror: le misure di
  CodeMirror fatte durante i ~300 ms del respiro si rifanno da sole
  (`requestMeasure`); il coder lo verifica aprendo una nota col cursore.
- Un clic durante il passaggio va all'app (lo strato non prende il
  puntatore); un tasto va al fuoco già dato.
- La pagina ricaricata a metà passaggio: con `lifetime`, niente animazioni
  vive né strato a metà.
- `bench:motion`: le animazioni toccano solo `transform` e `opacity`, e a
  consegna finita non ne resta nessuna.
Fatto quando:
- i test di `consegna.test.ts` passano;
- gli e2e esistenti (`src/*.e2e.test.ts`) restano verdi senza tempi in più;
- `npm run bench:motion` è verde;
- sul banco (`npm run bench -- --port 1448 --strictPort`), aprendo
  `index.html` e `mobile.html` in tutte e due le luci, le foto di A a 0, 120,
  220 e 1000 ms dall'inizio del passaggio (animazioni ferme con
  `currentTime`, come `proto/foto.mjs`) mostrano: a 120 ms il marchio sotto
  la misura del bersaglio, a 220 ms di nuovo vicino, a 1000 ms nessuno strato
  e `#brand-menu .brand-mark` entro 1 px dal rettangolo misurato al passo 7.1;
- con `prefers-reduced-motion`, la dissolvenza di 90 ms e nessun `transform`;
- con la CPU rallentata 4× (CDP `Emulation.setCPUThrottlingRate`), nessun
  intervallo fra due `requestAnimationFrame` sopra 25 ms da 40 ms prima a
  1100 ms dopo l'inizio del passaggio (come `proto/misura.mjs`);
- le foto e le misure sono nel resoconto del coder.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T4 · La guardia del lampo e le scene del banco

Perché: senza una prova automatica il lampo torna al primo `index.html` che
cambia; e gli stati dello strato vanno fotografati in tutte e due le luci.
Tocca:
- `apps/client/bench/lampo.mjs` (nuovo)
- `apps/client/package.json` (script `bench:lampo`)
- `apps/client/bench/scene.mjs` (quattro scene)
- `apps/client/bench/stage.mjs` (la condizione d'arrivo di una scena, e `QUIET`)
- `apps/client/bench/stage.test.ts` e `apps/client/bench/scene.test.ts`, se servono
- `apps/client/bench/fake-ipc.ts` (la query `avvio=attesa|guasto`)
- `scripts/check.sh` (`bench:lampo` nell'elenco di `--banchi`)
- `docs/development/testing-and-quality.md`
Non toccare:
- `src/`, le pagine, `public/avvio/` (T1, T2);
- `bench/baseline/` (le foto nuove arrivano dal runner);
- `.github/` (la riga di CI e quella di `CONTRIBUTING.md` le aggiunge
  l'orchestratore).
Dipende da: T1, T2
Cosa fare:
- `bench/lampo.mjs` apre il banco con `openStage` e lo prova così:
  1. Per ogni luce, con `colorScheme` e senza cache, e poi con `fub.avvio`
     chiaro su un sistema scuro (con `addInitScript`): trattiene la richiesta
     di `/src/main.ts` con `page.route` finché non ha guardato, e verifica:
     - il fondo calcolato di `<html>` è quello della luce attesa;
     - `.avvio` copre tutta la finestra;
     - `document.elementFromPoint` in nove punti cade dentro `.avvio`;
     - `#app` è `inert`;
     - nessun `button` di `#app` ha l'aspetto nativo (sfondo
       `buttonface`/bianco).
  2. Poi rilascia la richiesta, aspetta `data-bench="ready"` e verifica:
     niente `.avvio` né `#avvio-stile`, niente `data-avvio-*`, `#app` non
     `inert`.
  3. Lo stesso su `mobile.html`.
  4. Esce con un codice diverso da zero e un messaggio che dice quale
     controllo è caduto. È il presidio: fallisce se si toglie lo stile in
     linea da una pagina.
- `fake-ipc.ts`:
  - la query si legge alla nascita del fake, perché `window.bench` arriva
    troppo tardi per l'avvio; usa le porte che ci sono già in
    `src/host/fake.ts`, senza un meccanismo nuovo;
  - con `avvio=attesa`, `host.throttle("openVault")`: il vault non si apre
    mai;
  - con `avvio=guasto`, `host.fault("initialVault", "il ponte non risponde")`:
    `init()` lancia e `mountDesktopShell` finisce nel guasto.
    `openVault` non va bene qui, perché `openInitialVault` ne cattura
    l'errore e lo dice nell'app.
- `stage.mjs`:
  - una scena può dichiarare `ready` (una funzione da `waitForFunction`) al
    posto di `data-bench="ready"`;
  - `QUIET` ferma `.avvio-scia` (`animation: none`), perché lo scatto stia
    fermo.
- Le scene, su `index.html` salvo l'ultima:
  - `avvio-attesa`: `ready` è `.avvio[data-stato="attesa"][data-fase="vault"]`;
  - `avvio-lento`: `data-stato="lento"`, entro 15 s;
  - `avvio-guasto`: guasto col fuoco su Riprova;
  - `avvio-telefono`: `mobile.html`, `PHONE`, attesa.
  Ognuna ha titolo e `prepare` vuoto. Entrano anche nel banco a11y, che le
  prende da `SCENE`.
- `docs/development/testing-and-quality.md`, sezione «Visuale e
  accessibilità»: che cosa prova `bench:lampo` e le quattro scene.
Casi limite:
- Il banco gira con `reducedMotion: "reduce"`: la consegna è la dissolvenza da
  90 ms, e le scene esistenti non cambiano (lo strato è già andato quando
  `startup` si risolve).
- La scena `avvio-lento` aspetta una condizione, non un tempo.
- `scene.test.ts` pretende tutte le baseline o nessuna: le otto foto nuove
  mancano finché l'orchestratore non le prende dall'artefatto `banco-visivo`
  del runner dopo la spinta. Il coder lo scrive nel resoconto, e il solo
  rosso ammesso di `--rapido` è quella riga.
Fatto quando:
- `npm run bench:lampo` passa;
- tolto `<style id="avvio-stile">` da `index.html` in una copia di prova,
  fallisce;
- `npm run bench:a11y -- --light=dark` passa con le scene nuove;
- le foto locali delle quattro scene (`bench/.output/`) sono nel resoconto del
  coder.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## Non verificato da qui

- La finestra Tauri su Windows e macOS: solo in CI, che costruisce ma non
  guarda. Il fondo della WebView su macOS non è impostabile (limite di
  Tauri): va guardato a mano su un Mac.
- Il telefono vero (Android/iOS), e la schermata di lancio nativa
  (domanda 4).
- La finestra Tauri su Linux col tema chiaro scelto e il sistema scuro: da
  guardare a mano dopo T3.
