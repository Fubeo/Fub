# 0247 — La prova del motore del PDF: la vista compone, Fub scrive

- **Stato:** proposta
- **Data:** 2026-11-18
- **Ambito:** contratto
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

L'esportazione delle note in PDF ha bisogno di un motore. La strada A
è quella consigliata: la pagina la compone la vista, il PDF lo scrive Fub. La vista rende la nota
con la Lettura, la impagina e misura ciò che ha disegnato: ogni pezzo di
testo col suo carattere e la posizione di ogni lettera, i fondi e i bordi, i
vettori, le immagini. Il core riceve l'elenco delle pagine e scrive il PDF
con testo vero e caratteri incorporati in sotto-insieme, senza andare a capo
e senza impaginare. La prova serve a sapere se A regge prima di costruirci
sopra il resto dell'esportazione. Il piano non descrive le altre strade:
questo ADR riporta i numeri di A, e la scelta fra A e B la fa chi coordina
il piano.

La prova sta in `crates/fub-features/src/pdf_export/` (lo scrittore),
`apps/client/src/export/probe.ts` (la misura della vista) e nel banco
`apps/client/bench/pdf-prova.mjs`. Il banco rende una nota di prova
(`bench/pdf-prova-nota.ts`: titoli, grassetto e corsivo nella stessa riga,
codice in linea, collegamento, formula in linea e in blocco, tabella, codice
colorato, diagramma mermaid, immagine) su quattro pagine A4. Poi fotografa la
vista pagina per pagina e fa scrivere il PDF al core. `hayro` ridisegna il PDF
alla stessa scala e `lopdf` ne estrae il testo. I numeri dipendono dalla
macchina: questi vengono da un PC Linux con il Chromium headless di
Playwright, in una corsa del 2026-11-18.

### I numeri

| Misura | Valore | Contro |
|---|---|---|
| Misura della vista (167 pezzi, 3508 lettere, 17 facce) | 41 ms | — |
| Impaginazione e JSON nella vista | 0,8 ms | — |
| JSON dell'elenco, in tutto | 139 KB | — |
| JSON della pagina più pesante (la prima, col diagramma) | 100 KB | 64 KiB, `MAX_GRID_COMMAND_PARAMS_BYTES` |
| JSON delle altre pagine | 8,7 – 16,7 KB | 64 KiB |
| Lettura del JSON nel core | 1,3 ms | — |
| Scrittura del PDF nel core (caratteri incorporati) | 84 ms | — |
| PDF | 82 KB | — |
| Testo estratto dal PDF | uguale alle lettere misurate e al testo della nota resa | — |
| Pixel diversi, pagine 1 / 2 / 3 / 4 | 2,43 / 0,30 / 0,59 / 0,84 % | 1 % |
| Pixel diversi col testo spostato apposta di 1 px | 3,9 % | deve superare l'1 % |

I tempi sono di una corsa con la coda dei controlli pesanti occupata: valgono
come ordine di grandezza. La prima corsa (gli stessi pezzi, prima della
correzione dei caratteri qui sotto) aveva dato 36,5 ms di misura e 37 ms di
scrittura.

### Da dove viene lo scarto della pagina 1

Il confronto usa `pixelmatch` con soglia 0,1, senza contare i pixel che
riconosce come antialiasing. Lo scarto della pagina 1 diviso per regione:

| Pagina 1 | Soglia 0,1 | Soglia 0,1 contando l'antialiasing | Soglia 0,3 |
|---|---|---|---|
| Dentro i vettori | 2,25 % | 2,56 % | 0,06 % |
| Fuori dai vettori | 0,17 % | 0,96 % | 0,06 % |

- **Caratteri.** Prima della correzione la misura non trovava il file delle
  facce dell'app: il caricatore del tema (`theme/loader.ts`) toglie le
  regole `@font-face` dai suoi fogli e le passa a `document.fonts` come
  `FontFace`, che non dice il suo file. Il PDF usciva coi caratteri di
  riserva, con 2 – 4,5 % di pixel diversi su ogni pagina. Ora la misura
  riceve il CSS dei caratteri del tema (`ProbeOptions.fontFaces`) e le
  pagine di solo testo stanno fra 0,3 e 0,84 %.
- **Antialiasing.** Skia (la vista) e `hayro` (il PDF) non sfumano i bordi
  delle lettere allo stesso modo: contando anche quei pixel le pagine di
  testo salgono a 1,9 – 4,2 %, alzando la soglia di colore a 0,3 scendono
  sotto lo 0,6 %. È la parte dello scarto che resta anche col PDF giusto.
- **Raster contro vettore.** Non pesa: la radice della formula, un vettore
  SVG di KaTeX, coincide con la vista. Lo scarto dentro i vettori è tutto del
  diagramma mermaid. Nella vista i quattro nodi hanno quattro colori e gli
  angoli tondi; nel PDF hanno tutti il colore di base e gli angoli dritti. Il
  CSS che mermaid mette nell'SVG colora i nodi con selettori
  `:nth-child(…)` e `:not([class])` e arrotonda gli angoli con `rx` e `ry`
  come proprietà CSS; `usvg`, che legge l'SVG per `svg2pdf`, non applica
  queste regole.

Senza il diagramma la pagina 1 sta a 0,17 %: con la correzione dei caratteri,
ogni pezzo che la vista disegna come testo, fondo, bordo, immagine o vettore
semplice arriva nel PDF sotto la soglia.

### Il peso del diagramma

Il vettore del diagramma pesa 84 KB nel JSON, e 64,5 KB di questi sono un
carattere (Inter) incorporato in base64 nel `<style>` dell'SVG. Senza quel
carattere la pagina 1 peserebbe circa 35 KB, sotto il limite dei comandi
della griglia.

## Decisione

Proposta, da confermare da chi coordina il piano:

- La strada A regge per il testo: le lettere arrivano nel PDF uguali e allo
  stesso posto della vista, il testo si estrae uguale, e il banco vede uno
  spostamento di un pixel. I costi (decine di millisecondi per quattro
  pagine, nella vista e nel core) non pesano su un'esportazione.
- Lo scarto che resta è nei vettori che portano CSS che `usvg` non applica.
  Se si va avanti con A, la vista passa al core un SVG già risolto: legge gli
  stili calcolati di ogni elemento del diagramma reso, li scrive come
  attributi (`fill`, `stroke`, `rx`, `ry`, …), toglie il `<style>` e i
  caratteri incorporati, e lascia le etichette al testo vero che la prova già
  scrive coi caratteri di serie. Questo chiude insieme lo scarto dei colori e
  degli angoli e il peso della pagina 1.
- La soglia del confronto resta all'1 % con soglia di colore 0,1: è quella
  che vede lo spostamento di un pixel. Non si alza per far passare la
  pagina 1.

## Conseguenze

### Positive

- Anteprima e file nascono dalla stessa misura: sulla macchina che esporta
  coincidono.
- Il core non impagina e non va a capo: le regole dell'impaginazione restano
  nella vista, dove sono le misure.

### Negative

- Due macchine possono andare a capo in punti diversi e scrivere due PDF
  diversi della stessa nota: coincidono sulla macchina che esporta, non fra
  macchine.
- Ogni vettore che arriva al core deve essere un SVG che `usvg` sa leggere:
  la vista deve risolverne il CSS prima di passarlo.
- Una pagina con un vettore grande può superare il limite di un comando: la
  porta definitiva (`invoke_command` e un lavoro del core) dovrà passare le
  pagine a pezzi o i vettori per riferimento.

### La feature Cargo

Il piano chiedeva una feature `pdf-export` sua. La prova sta dietro `draw`,
che porta già tutte le crate che usa (`svg2pdf`, `lopdf`, `hayro`, i
caratteri), e non aggiunge crate al `Cargo.lock`. Una feature sua resterebbe
fuori dal default, e il presidio `.github/scripts/check-cargo-feature-default.mjs`
accetta una feature fuori dal default solo con una voce nella sua lista
`FUORI_DAL_DEFAULT` e il passo di CI che la compila. Per averla servono:

- la voce `crates/fub-features/Cargo.toml#pdf-export` in quella lista, con il
  passo che la prova (modificare il presidio è una scelta sui controlli della
  CI, non di chi scrive il task);
- un passo in `.github/workflows/ci.yml`, accanto a quelli di `draw`:
  `cargo nextest run -p fub-features --features pdf-export` e il clippy;
- la riga in `crates/fub-features/tests/cargo_features.rs`;
- `pdf-export = ["draw"]` (o le sole crate che usa) in `Cargo.toml`, e
  `#[cfg(feature = "pdf-export")]` al posto di `draw` in `lib.rs`.

## Alternative scartate

### Alzare la soglia del confronto

Con la soglia di colore a 0,3 tutte le pagine passerebbero (pagina 1:
0,12 %). Ma il diagramma ha davvero i colori sbagliati: una soglia che lo fa
passare non vedrebbe più un difetto vero.

### Mandare il diagramma come immagine

Passerebbe il confronto, ma il diagramma non sarebbe più un vettore nel PDF e
le sue etichette non si potrebbero selezionare: è proprio ciò che la strada A
promette.

## Verifica

- `cargo nextest run -p fub-features --features draw pdf_export`: lo
  scrittore, i caratteri incorporati, il carattere che non si può
  incorporare, le etichette dei vettori come testo.
- `apps/client/src/export/probe.test.ts`: l'impaginatore della vista e la
  tabella delle facce, che legge il file dal CSS dei caratteri ricevuto.
- `node bench/pdf-prova.mjs` (dalla coda dei controlli pesanti): il confronto
  a pixel pagina per pagina, il testo estratto, e la differenza messa
  apposta che il confronto deve vedere.
