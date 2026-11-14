# 2026-11-13, Linux, dove va il tempo della penna sul foglio vivo (S8)

Questa pagina conserva il **profilo** dei fotogrammi lunghi di S8 misurati
nella [seconda misura](lavagna-inchiostro-foglio-2026-11-11.md) del
cancello di N4: la penna sopra la scheda del foglio viva, 174 ms nel caso
peggiore contro una meta di 33 ms. Dice quanto costa ogni pezzo, e di chi è
il codice che lo spende.

> **Per chi:** chi decide il lavoro dopo il cancello di N4 (orchestratore,
> pianificatore di N6).
> **Risultato:** il codice dell'inchiostro di N4 spende poco: la scia costa
> al più 2 ms per fotogramma, e la sua parte del rilascio circa 5 ms. I
> fotogrammi lunghi vengono da quattro posti fuori dall'inchiostro: il
> ricalcolo di stile del cursore della penna su tutta la scheda viva
> (62–80 ms a ogni pressione e rilascio di D), i riquadri dei bersagli di
> N6 (80–140 ms all'inizio del tratto), il commit del modello e il resto
> della scrittura al rilascio (45–60 ms), e un buco del driver sotto Xvfb.
> **Nessuna modifica al codice** in questo task: nessuna correzione che
> lasci uguale ciò che si vede ha dato un guadagno misurato.

## Chi, cosa, quando

- ramo `coder/n4-t23a`, base `5e701b198` (`piano/n4-inchiostro`). Il codice
  misurato è quello di `7ce18f820` (la punta di `piano/n6-lavagna`, con N4 e
  la scheda di foglio viva di N6), in una copia a parte; il banco è S8 di
  `apps/client/bench/webview/run.mjs`, invariato;
- le sonde (`performance.measure` attorno a `#render`, al rilascio del
  tratto, alla scia e a `onChange`, più una sonda per fotogramma nel banco e
  una traccia CDP nel Chromium del banco) stavano solo nella copia di misura,
  e sono state tolte prima dei tre giri finali;
- comando dei giri, da `apps/client/`, dopo `npm run build` e
  `cargo build --release --locked -p fub-app --features tauri/custom-protocol`:
  `env -u WAYLAND_DISPLAY GDK_BACKEND=x11 dbus-run-session -- xvfb-run -a -s "-screen 0 1280x800x24 -maxclients 2048" npm run bench:webview -- --only=S8 --budgets=targets --port=4481 --native-driver=/usr/bin/WebKitWebDriver --out=…`.

## La macchina

- `pc-debian-di-fub`: Intel Core i5-13600KF, 20 thread, 31 GiB, Debian 13,
  kernel 6.12.113, WebKitGTK 2.54.0 sotto Xvfb (**rendering in software**);
- **condivisa**: altri agenti compilavano nello stesso momento, con un carico
  da 4 a oltre 90. Ogni numero ha accanto il carico; le cifre assolute di
  questa pagina sono più rumorose di quelle dell'11 novembre (carico sotto
  1,3), i rapporti fra i pezzi no.

## I tre tipi di fotogramma lungo

S8 conta i fotogrammi oltre 33 ms per l'ultimo evento del puntatore prima
del fotogramma: durante il movimento (la scia), al rilascio, senza evento.
La sonda per fotogramma li divide meglio.

### Durante il movimento: non è la scia

- `ink-layer.ts` rifà il percorso della scia in **al più 2 ms** per
  fotogramma; a metà tratto i fotogrammi sono di circa 16 ms;
- comporre la scia su un livello suo (`will-change: transform` su
  `.canvas-ink-wet`) **non cambia** i fotogrammi lunghi: la lettura di T15
  («la scia fa ridipingere la zona sotto») non regge;
- i fotogrammi lunghi «a movimento» sono all'**inizio** del tratto e vicino
  alla pressione di D (vedi sotto), non nel mezzo.

### Il tasto D: il cursore della penna ricalcola lo stile di tutta la scheda

Il banco scrive col mouse tenendo D. A ogni pressione e a ogni rilascio di D
`#applyInkMouse` (in `engine.ts`) mette o toglie `data-ink="pen"` sul
viewport, e `structure.css` gli dà `cursor: crosshair`. `cursor` si eredita:
cambiarlo ricalcola lo stile di **ogni elemento della lavagna**, e la scheda
della tabella (10.000 celle di testo) con quella del foglio vivo sono decine
di migliaia di elementi.

| Prova (sonda con lo stile forzato subito dopo D) | Ricalcolo a ogni D |
|---|---|
| la regola com'è, `cursor: crosshair` | 62–80 ms |
| la stessa regola con una proprietà non ereditata (`outline-color`) | 0–1 ms |
| `cursor: auto` esplicito sugli strati SVG dell'inchiostro | 62–80 ms, invariato |

Il referto del banco lo conferma: la latenza dei tasti di S8 ha p50 72 ms.
Con la penna scelta dal menu il costo c'è una volta sola, quando si sceglie;
con D tenuto c'è due volte per tratto.

**Perché non è corretto qui.** Le due strade che lasciano la croce sopra le
schede cambiano ciò che si vede o toccano N6:

- un velo sopra la lavagna con la croce, come `.rich-ink-veil` delle note:
  diventa il bersaglio del puntatore, e il motore di N6 usa
  `document.elementFromPoint` per sapere che cosa c'è sotto (bersaglio del
  tratto, schede). Va fatto insieme a N6;
- togliere la croce dalle schede (`cursor` esplicito sul contenuto delle
  schede): sopra le schede la penna non mostrerebbe più la croce.

### All'inizio del tratto: i riquadri dei bersagli di N6

Quando il tratto comincia, N6 mostra i riquadri delle schede bersaglio
(`canvas-ink-frames`, l'attributo `hidden` cambiato in `#placeInkFrame`) e
l'etichetta. Il ricalcolo che segue, con le regole `:has()` di
`#layout`, `#panes`, `.pane` e `#workspace` e il `:hover` di `.canvas-node`
(traccia CDP), ferma i fotogrammi per **80–140 ms**. Con riquadri ed
etichetta nascosti il buco sparisce (due prove). Codice di N6.

### Al rilascio: 45–60 ms di thread principale, l'inchiostro ne spende 5

| Pezzo del rilascio (sonde, giri con carico basso) | ms | Di chi |
|---|---|---|
| `Core::commit` di `fub-canvas-core` (rilegge e confronta tutto il sorgente da ~500 KB) | 11–27 | nucleo della lavagna |
| `onChange` della superficie: la shell 11–12, `inspector.changed()` 6 | 17–18 | `surface.ts`, shell |
| modello del nucleo dopo il commit | 5–6 | nucleo della lavagna |
| `#inkTargetClose` (chiusura del bersaglio della scheda) | 6–7 | N6 |
| il tratto dell'inchiostro: record, patch, asciutto, path, operazione | ~5 in tutto | N4 |

Dopo il rilascio vengono fotogrammi da 30 a 54 ms con il thread principale
fermo: è il disegno fuori dal thread principale del cambio scia → asciutto.
Comporre la scia a parte non li ha tolti.

### Senza evento: un buco del driver

Con i tratti del driver, pochi fotogrammi prima del rilascio c'è un buco da
120–150 ms con il thread principale fermo (battiti di 10 ms che saltano).
Non c'è con gli stessi tratti mandati dalla pagina, né con trascinamenti del
driver fuori dalla lavagna; c'è con tratti del driver su una zona vuota della
lavagna. L'ipotesi è la ripetizione automatica del tasto D tenuto sotto
Xvfb; la prova con `xvfb-run -s "-ardelay 30000"` è caduta con un carico di
77 e non vale. Non è codice di Fub finché non è dimostrato il contrario.

## I tre giri finali, senza sonde

Millisecondi, codice di `7ce18f820` senza modifiche (questo task non cambia
il codice), carico di `/proc/loadavg` prima → dopo.

| Misura | Giro 1 | Giro 2 | Giro 3 |
|---|---|---|---|
| carico prima → dopo | 13,7 → 38,3 | 35,9 → 13,8 | 13,8 → 16,8 |
| scheda del foglio viva con le celle (zoom 0,51) | sì | sì | sì |
| fotogramma più lungo a penna | **198** | 187 | 152 |
| p95 dei fotogrammi a penna | 147 | 92 | 81 |
| fotogrammi a penna oltre 33 ms | 66 su 198 | 47 su 212 | 55 su 219 |
| di cui: movimento / rilascio / senza evento | 34 / 10 / 22 | 17 / 10 / 20 | 25 / 10 / 20 |
| latenza dei tasti (D), p50 | 76 | 70 | 75 |
| fotogramma più lungo allo spostamento | 736 | 586 | 557 |
| path asciutti prima → dopo i tratti | 2000 → 2010 | 2000 → 2010 | 2000 → 2010 |
| sha256 di `voti.xlsx` prima e dopo | uguale | uguale | uguale |

Con questo carico il peggiore (198 ms) non dice nulla di nuovo sul codice:
dice che la meta resta lontana. La latenza dei tasti, 70–76 ms in tutti e
tre i giri, è il ricalcolo del cursore della penna misurato sopra.
Lo schermo vero non è stato misurato: senza una correzione da confrontare,
con la macchina carica, non avrebbe aggiunto un'informazione.

## Accanto alle misure di prima

| Misura | T23, 11 novembre, Xvfb, carico < 1,3 | T23a, 13 novembre, Xvfb, carico alto |
|---|---|---|
| fotogramma più lungo a penna, il peggiore | 174 ms | 198 ms (giro 1), 152 ms con il carico più basso (giro 3) |
| codice | `23f4da190` | `7ce18f820`, nessuna modifica |

Le due colonne non misurano una correzione: la differenza è il carico della
macchina e i commit di N6 fra le due basi.

## I lavori che ne vengono

Per l'orchestratore, in ordine di guadagno atteso:

1. **N6, i riquadri dei bersagli all'inizio del tratto** (80–140 ms): non
   cambiare `hidden` su elementi che fanno ricalcolare le regole `:has()`
   della shell; per esempio tenere i riquadri sempre nel DOM e mostrarli con
   `visibility` o con un attributo che nessuna regola `:has()` della shell
   legge, poi misurare il ricalcolo con la sonda.
2. **N4 con N6, il cursore della penna** (62–80 ms per D): un velo con la
   croce che N6 sappia attraversare in `elementFromPoint` (o una sonda del
   bersaglio per coordinate), con un test che la croce resti sopra le schede.
3. **Il nucleo della lavagna, il commit del tratto** (11–27 ms): un commit
   che non rilegga tutto il sorgente per un tratto aggiunto.
4. **La shell, `onChange` della lavagna** (17–18 ms): l'ispettore e la
   shell che non lavorino a ogni tratto.
5. **Il banco**: dimostrare o escludere la ripetizione del tasto sotto Xvfb
   prima di contare quei fotogrammi contro la meta.

## Che cosa non è misurato

- la penna vera (WebKitWebDriver non la manda: i tratti sono del mouse con
  D), lo schermo vero con la GPU in questo task, WebView2, WKWebView e
  Android;
- il guadagno delle correzioni dei punti 1–4: sono prove con sonde, non
  correzioni misurate dal banco;
- la prova della ripetizione del tasto con un carico basso.
