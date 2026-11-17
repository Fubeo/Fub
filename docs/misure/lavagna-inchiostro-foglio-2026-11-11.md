# 2026-11-11, Linux, la penna sul foglio vivo sulla lavagna (S8)

Questa pagina conserva la **seconda delle due misure** del cancello di N4:
la stessa misura di S8 della [prima](lavagna-inchiostro-2026-11-09.md), ma
con la penna sopra la scheda del foglio `voti.xlsx` viva, cioè con le celle
del foglio vero dentro la lavagna (D-7 (c) del piano N4). La prima misurava
il caso simile, una tabella di testo sotto la penna.

> **Per chi:** chi decide se la lavagna può chiudere la voce «seconda misura»
> di N4, e chi decide il lavoro che viene dopo.
> **Risultato:** la voce **non si chiude**: a penna il fotogramma più lungo
> è di 174 ms (la meta è 33 ms), e lo spostamento della scheda del foglio
> arriva a 141 ms. Il tempo va soprattutto mentre il tratto si muove sopra le
> celle e nei fotogrammi senza evento del puntatore.

## Chi, cosa, quando

- ramo `coder/n4-t23`, base `23f4da190` (`piano/n6-lavagna`, con N4 e la
  scheda di foglio viva di N6 T7, T11, T12, T13). Il codice dell'app è quello
  di `23f4da190`: il referto scrive quel commit. La modifica del banco
  (`apps/client/bench/webview/run.mjs`, scenario S8) sta nel commit che
  aggiunge questa pagina;
- lo scenario: S8 di `apps/client/bench/webview/run.mjs`, dati da
  `fixtures.mjs` (invariati), descritto in
  [Misure nella WebView](../development/webview-measurements.md);
- comandi, da `apps/client/`, dopo `npm run build` e
  `cargo build --release --locked -p fub-app --features tauri/custom-protocol`:
  per i tre giri sotto Xvfb,
  `xvfb-run -a -s "-screen 0 1280x800x24" npm run bench:webview -- --only=S8 --budgets=targets --native-driver=/usr/bin/WebKitWebDriver --out=…`,
  per i tre sullo schermo vero lo stesso comando senza `xvfb-run`, con
  `DISPLAY=:0`.

Il banco di questo ramo cambia S8 in tre punti, e la prima misura non è
rifatta: le sue cifre restano quelle della pagina del 9 novembre.

1. **La scheda del foglio viva.** Il fit della lavagna dà zoom 0,33 con
   questi dati, sotto la soglia di `LIVE_ZOOM_MIN` (0,35): a quello zoom
   `voti` resta un segnaposto. Lo scenario la ingrandisce con cinque scatti
   di Ctrl+rotella sul centro della scheda, portando lo zoom a 0,54, poi
   aspetta `[data-card-kind=sheet][data-card-mode=live] [data-card-state=content]`
   per al più 60 s. Il Ctrl+rotella del driver non ingrandisce la lavagna
   (lo zoom resta 0,33): lo scatto è quindi un evento `wheel` con `ctrlKey`
   mandato dalla pagina, prima della sonda, fuori dalla misura.
2. **Penna e spostamento sulla scheda del foglio**, non sulla tabella: i
   dieci tratti cadono sulle celle di `voti`, e lo spostamento riguarda la
   scheda del foglio, avanti e indietro di 101 px (la scheda sta a destra e
   200 px uscirebbero dalla finestra di 1049 px), posata 60 px più in basso.
   La tabella di testo resta sulla lavagna con i suoi 1000 tratti.
3. **Il referto dice se la misura vale**: `sheetLive` e `sheetState` nel
   referto di S8, e la nota «la misura non vale per D-7 (c)» se la scheda
   non diventa viva entro 60 s.

## La macchina

- `pc-debian-di-fub`: Intel Core i5-13600KF, 20 thread, 31 GiB di memoria,
  scheda grafica NVIDIA RTX 4070 (driver 550), leggibile da WebKit;
- Debian GNU/Linux 13, kernel 6.12.113;
- Xvfb 1280 × 800 × 24, come T15: **rendering in software**, senza GPU; per
  lo schermo vero, il server Wayland della sessione (`DISPLAY=:0`) con la
  GPU;
- WebKitGTK 2.54.0 (`libwebkit2gtk-4.1-0` 2.54.0-1~deb13u3), user agent
  `AppleWebKit/605.1.15 … Version/60.5 Safari/605.1.15`.

Il referto scrive `session: wayland` anche nelle corse sotto Xvfb, perché
l'ambiente eredita `XDG_SESSION_TYPE`: quelle corse sono X11 sotto Xvfb.

## I dati

- `S8/Lezione.canvas`, come in T15: la scheda `tabella` (testo con la tabella
  Markdown di 100 righe per 100 colonne), la scheda `voti` (`S8/voti.xlsx`, un
  foglio di 100 × 100 celle, 640 × 420 nella lavagna) e 2000 tratti `fub:ink`:
  1000 sulla tabella, 500 sul foglio e 500 liberi;
- `S8/voti.xlsx`: sha256 `b75d51082070…` prima e dopo in tutti i giri.

## Come si misura

1. La lavagna aperta; si aspettano i 2000 tratti asciutti, poi la scheda del
   foglio viva con le celle (al più 60 s), dopo lo zoom del punto 1.
2. Dieci tratti da 300 ms sopra la scheda del foglio. **WebKitWebDriver non
   manda una penna che scrive**: della penna arriva solo il `pointerdown`, poi
   niente (una sola campionatura `pen` vista dalla sonda). I dieci tratti
   sono quindi del mouse con D tenuto, dopo un `blur` che annulla il tratto
   di penna rimasto giù. Tutti e dieci scrivono.
3. Lo spostamento della scheda del foglio dalla testata, avanti e indietro
   per 2 s, posata 60 px più in basso.
4. Lo sha256 di `voti.xlsx` letto dal disco prima della penna e 3 s dopo lo
   spostamento.

`S8.penFrameGap.max` è il fotogramma più lungo mentre la sonda è accesa per
i dieci tratti, pause del driver comprese. La meta è 33 ms (`budgets.json`,
solo `targets`).

## I tre giri sotto Xvfb

Millisecondi; il carico è quello di `/proc/loadavg` (primo numero) prima e
dopo ogni corsa.

| Misura | Giro 1 | Giro 2 | Giro 3 |
|---|---|---|---|
| carico prima → dopo | 0,89 → (non letto) | 0,77 → 1,03 | 0,94 → 1,24 |
| input | mouse con D | mouse con D | mouse con D |
| zoom della scheda del foglio | 0,54 | 0,54 | 0,54 |
| scheda del foglio viva con le celle | sì | sì | sì |
| fotogramma più lungo a penna | **174** | 170 | 168 |
| p95 dei fotogrammi a penna | 83 | 77 | 82 |
| fotogrammi a penna oltre 33 ms | 47 su 215 | 44 su 216 | 43 su 217 |
| fotogramma più lungo allo spostamento | 137 | 134 | 141 |
| path asciutti: prima → dopo i tratti → dopo lo spostamento | 2000 → 2010 → 2010 | 2000 → 2010 → 2010 | 2000 → 2010 → 2010 |
| sha256 di `voti.xlsx` prima e dopo | uguale | uguale | uguale |

Lo sha256 è `b75d51082070…` prima e dopo in tutti e tre i giri.

**Il peggiore: 174 ms a penna, 141 ms allo spostamento** (giro 1 per la
penna, giro 3 per lo spostamento). La meta di 33 ms non è raggiunta: è oltre
cinque volte. Il primo giro è 4 e 6 ms più lento degli altri due: dentro il
rumore, e non si scarta.

## Sullo schermo vero, con la GPU

Le stesse corse senza `xvfb-run`, con `DISPLAY=:0` e la sessione Wayland
di questa macchina: WebKitGTK disegna con la GPU della RTX 4070. Sono numeri
di un altro ambiente, non si sommano con quelli di Xvfb.

**Due giri su tre sono validi. Il terzo non è stato misurato:** un altro
banco girava sulla stessa macchina nello stesso momento, e l'app ha un'istanza
unica, quindi la sessione non partiva (vedi «Che cosa è successo prima»). Il
terzo giro va rifatto con lo stesso comando, da solo sulla macchina.

| Misura | Giro 1 | Giro 2 | Giro 3 |
|---|---|---|---|
| carico prima → dopo | 1,04 → 1,23 | 1,11 → 1,98 | non misurato |
| zoom della scheda del foglio | 0,54 | 0,54 | non misurato |
| fotogramma più lungo a penna | 168 | 180 | non misurato |
| p95 dei fotogrammi a penna | 78 | 80 | non misurato |
| fotogrammi a penna oltre 33 ms | 43 su 216 | 51 su 209 | non misurato |
| fotogramma più lungo allo spostamento | 138 | 139 | non misurato |
| sha256 di `voti.xlsx` prima e dopo | uguale | uguale | non misurato |

**Il peggiore dei due giri validi: 180 ms a penna, 139 ms allo spostamento.** Sui due giri con la GPU il numero non scende rispetto a Xvfb: la distanza dalla meta resta di oltre cinque volte.

## Accanto alla prima misura

| Misura | T15, tabella di testo, Xvfb (9 novembre) | T23, scheda del foglio viva, Xvfb (11 novembre) |
|---|---|---|
| zoom sotto la penna | fit della lavagna, non letto in T15 (0,33 su questa macchina) | 0,54 |
| scheda sotto la penna | tabella di testo, 10.000 celle | foglio vivo, 100 × 100 celle |
| fotogramma più lungo a penna, il peggiore | 205 ms (giro 3) | 174 ms (giro 1) |
| fotogrammi a penna oltre 33 ms | 56 su 267 (giro 3) | 47 su 215 (giro 1) |
| fotogramma più lungo allo spostamento, il peggiore | 879 ms (giro 2) | 141 ms (giro 3) |
| sha256 di `voti.xlsx` | uguale | uguale |

I due spostamenti non sono la stessa cosa: in T15 si muoveva la tabella di
testo con i suoi 1000 tratti, in T23 la scheda del foglio con i suoi 500.
I due numeri di spostamento non sono una misura confrontabile. Lo zoom è
diverso (0,33 contro 0,54): a 0,54 ci sono più pixel da dipingere,
quindi T23 è il caso più pesante del foglio, non un confronto a parità.

## La voce del cancello

Il cancello di N4 dice «sopra il foglio vero dentro la lavagna, nessun
fotogramma oltre 33 ms; chiude la voce». **La voce non si chiude**: sotto Xvfb
ci sono fotogrammi a penna oltre 33 ms in tutti e tre i giri, il più lungo di
174 ms.

**Dove va il tempo** (giro 1, il peggiore, a penna):

| Fotogrammi oltre 33 ms, a penna | oltre 33 ms | il più lungo |
|---|---|---|
| durante il movimento del tratto (la scia) | 11 | 174 ms |
| al rilascio (il tratto si scrive) | 10 | 83 ms |
| senza nessun evento del puntatore | 26 | 89 ms |

Che cosa dicono:

- **Il picco è mentre il tratto si muove.** Il fotogramma più lungo, 174 ms,
  cade durante il movimento, come in T15 (205 ms). La lettura di T15 è che la
  scia, un SVG sopra la scheda, fa ridipingere in software la zona sotto a
  ogni movimento: qui la zona sotto sono le celle vive del foglio. È una
  lettura, non una misura.
- **La maggioranza dei fotogrammi lunghi non ha evento.** 26 su 47, con un
  massimo di 89 ms: il costo sembra stare nel disegno più che negli
  ascoltatori del puntatore. Il profilo dentro il disegno non è misurato
  qui: è la domanda che chiede un task.
- **Al rilascio pesano i tratti**, come in T15: il tratto si scrive nel
  modello e diventa un path asciutto. Il perché preciso non è misurato.
- **La posa della scheda** resta un fotogramma solo, 137 ms in questo giro,
  sotto il picco della penna.

Il carico della macchina era fra 0,77 e 1,24 nelle corse sotto Xvfb: il
rumore non spiega la distanza dalla meta.

**Il passo successivo** lo decide l'orchestratore: chiedere al pianificatore
un task, prima di T25, che mostri dove va il tempo dentro il disegno della
scheda viva (il profilo di `#render` e del commit del tratto sulla scheda
del foglio).

## Che cosa è successo prima dei tre giri

- Alcune prove sono fallite prima di una corsa valida: lo zoom non è partito
  col Ctrl della rotella del driver; un punto dello spostamento usciva dalla
  finestra (il driver lo rifiuta), e la corsa è passata a leggere la
  geometria e a tenere la posa dentro la finestra. I loro referti non si usano.
- Due tentativi sullo schermo vero sono falliti all'avvio della sessione:
  l'app ha un'istanza unica (`tauri-plugin-single-instance`), e un altro
  banco ne avviava una nello stesso momento, quindi la sessione non partiva.
  Una corsa è stata interrotta a metà per lo stesso motivo. I referti di quei
  tentativi non si usano, e il terzo giro sullo schermo vero non è stato
  rifatto per non far fallire il banco degli altri.

## Che cosa non è misurato

- la penna vera: WebKitWebDriver non la manda, i tratti sono del mouse con
  D; il percorso del tratto è lo stesso, gli eventi della penna
  (pressione, coalescenti) no;
- lo zoom del fit (0,33) con la scheda viva: a quello zoom la scheda resta un
  segnaposto, e questo è un fatto da portare in N6, non una misura;
- la posa della tabella di testo sullo stesso zoom di T23;
- i controlli di T15 (senza tabella, senza tratti): non fatti qui;
- il profilo dentro `#render` e dentro il commit del tratto;
- una macchina con la GPU in un'app vera con l'inchiostro su più schede vive,
  WebView2, WKWebView e Android.
