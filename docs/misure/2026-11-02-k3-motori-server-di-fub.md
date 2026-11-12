# 2026-11-02, Linux, server-di-fub: il cancello di K3

Questa pagina conserva le misure del cancello di K3, lo strato dei motori:
la memoria dopo «chiudi tutto» (R1), l'avvio a freddo (S6) e i banchi di
fogli e documenti, prima e dopo K3, sulla stessa macchina e con lo stesso
modo di lancio. La sezione del 2026-11-04 aggiunge R1 e le prove dei
motori con i documenti che la shell chiude (T8, T10, T11).

> **Per chi:** chi decide se K3 chiude il suo cancello e chi rifà la misura
> dopo un altro motore.
> **Risultato:** sapere che cosa K3 ha cambiato nei numeri, che cosa no, e
> quanto pesa il rumore.

## Il giudizio

Il cancello **non passa per intero**: passa sull'avvio e sui banchi, non
passa sugli obiettivi di R1.

| Fatto quando | Esito | Perché |
|---|---|---|
| dopo «chiudi tutto» la RAM torna entro la tolleranza di K0 | **non passa** sugli obiettivi (`targets`), passa sulle soglie `ci` | la pendenza dei giri resta fra 7,5 e 9,2 MiB per giro (obiettivo 1); il residuo supera i 50 MiB in un giro su tre. Il processo dell'app ora rende memoria (residuo da +7…+12 a −53…−61 MiB), ma quasi tutto il residuo è della WebView, che K3 non tocca |
| il tempo d'avvio di Fub non cambia | **passa** | S6 mediana 4288 ms prima, 4273 ms dopo, su otto avvii per lato; la differenza sta dentro il rumore |
| nessuna regressione nei banchi di fogli e documenti | **passa, con una nota** | `bench:grid`, `bench:fidelity`, `bench:large`, `corpus.rs` e le prove dei motori uguali; in `tempi.rs` la lettura di una cartella **dopo che un'altra si è chiusa** costa dal 6 al 15% in più, il prezzo della memoria resa (vedi [La lettura dopo «tutto chiuso»](#la-lettura-dopo-tutto-chiuso)) |

## Chi, cosa, quando

- **prima**: il commit `cb4213ec`, che ha lo stesso codice di `620f0acd`, il
  `main` da cui parte K3 (`git diff cb4213ec 620f0acd -- crates apps` è
  vuoto: cambiano soltanto documenti);
- **dopo**: `c5851334`, il ramo `piano/k3-motori` con T1–T7. T8 (scaldare e
  «documento chiuso», ramo a parte `piano/k3-ipc-motori`, PR #296) **non è
  misurato** qui: lo misura
  [la sezione del 2026-11-04](#2026-11-04-i-documenti-che-si-chiudono);
- 2026-11-02, dalle 15:35 alle 17:40, misurato dal coder di T9;
- stessa build per i due lati: `npm ci && npm run build`, poi
  `cargo build --release --locked -p fub-app --features tauri/custom-protocol`;
  Rust 1.95.0, Node 22.23.3.

## La macchina

- `server-di-fub`: AMD Ryzen 7 7730U, 16 nuclei logici, 15 GiB di memoria;
- Debian GNU/Linux 13 (trixie), kernel 6.12.111;
- nessuna scheda grafica usata (`/dev/dri` non è leggibile): WebKit disegna
  sul processore;
- WebKitGTK 2.54.0 (`libwebkit2gtk-4.1`, user agent
  `AppleWebKit/605.1.15 … Version/60.5 Safari/605.1.15`), sotto Xvfb
  `1280x800x24`, sessione senza desktop;
- i banchi del client: Chromium senza finestra di Playwright 1.61.1, con
  `FONTCONFIG_FILE` di `~/.local/opt/chrome-libs`.

È un server, non il portatile di riferimento: i numeri valgono per il
confronto prima/dopo, non come obiettivo assoluto.

Ogni giro è partito solo con il carico medio a un minuto sotto 3; il carico
di ogni giro è nelle tabelle. Sulla macchina girano sempre alcuni servizi
(syncthing, un processo Java, Docker).

## R1, la memoria dopo «chiudi tutto»

Comando, dalla cartella `apps/client/` di ogni lato:

```bash
xvfb-run -a -s "-screen 0 1280x800x24 -maxclients 2048" node bench/webview/run.mjs \
  --only=R1,S1,S6 --budgets=targets --driver=$HOME/.cargo/bin/tauri-driver \
  --native-driver=/usr/bin/WebKitWebDriver --out=DIR
```

Tre giri per lato, alternati (prima, dopo, prima, …). La procedura è quella
di [Misure nella WebView](../development/webview-measurements.md): vuota,
sette file aperti uno dopo l'altro, tutto chiuso, la lettura dopo 60 s, poi
dieci volte apri tutto e chiudi tutto. PSS in MiB; «app» è il processo di
Fub (l'host Rust), «WebView» i processi di WebKit.

| Giro | Inizio, carico 1/5/15 min | Vuota (app · WebView) | Residuo | App | WebView | Pendenza giri | App | WebView | Residuo 60 s dopo i giri | App |
|---|---|---|---|---|---|---|---|---|---|---|
| prima 1 | 15:35, 2,57 / 8,02 / 7,42 | 1114,2 (448,3 · 623,4) | 25,7 | 7,3 | 19,3 | −0,93 | 0,28 | −1,20 | 63,2 | 14,7 |
| prima 2 | 15:58, 1,36 / 1,07 / 2,43 | 1071,7 (403,2 · 624,3) | 296,1 | 11,5 | 285,2 | 11,78 | 0,01 | 11,80 | 131,4 | 18,6 |
| prima 3 | 16:22, 0,72 / 0,90 / 1,23 | 1112,8 (426,6 · 641,8) | −9,8 | 11,7 | −20,9 | 11,76 | 0,31 | 11,45 | 107,5 | 21,7 |
| dopo 1 | 15:46, 0,92 / 1,82 / 4,10 | 1141,0 (431,6 · 667,1) | −15,4 | −61,0 | 46,2 | 7,48 | 0,24 | 7,25 | −24,2 | −66,9 |
| dopo 2 | 16:09, 0,90 / 0,88 / 1,61 | 1042,6 (383,0 · 617,3) | 0,0 | −55,4 | 56,1 | 8,26 | 0,29 | 7,97 | 99,2 | −56,7 |
| dopo 3 | 16:34, 1,13 / 0,90 / 1,04 | 1045,4 (379,6 · 623,5) | 69,3 | −52,7 | 122,8 | 9,23 | 0,29 | 8,95 | 69,1 | −54,8 |

Il residuo totale comprende anche il processo di rete, fermo fra −0,8 e
−0,6 MiB in tutti i giri. Gli obiettivi (`targets` di
`apps/client/bench/webview/budgets.json`) sono residuo ≤ 50 MiB e pendenza
≤ 1 MiB per giro; le soglie `ci` 480 e 20.

Che cosa ne viene:

- **Il processo dell'app ora rende memoria.** Prima, dopo «chiudi tutto»
  l'app teneva da 7 a 12 MiB più della partenza; dopo, da 53 a 61 MiB
  **meno**. La memoria scende quando, dopo il foglio di calcolo, si apre la
  scheda successiva: nei tre giri «dopo» l'app passa da 441,0, 392,2 e
  390,5 MiB con il foglio aperto a 367,2, 314,9 e 319,3 MiB con il PDF; nei
  giri «prima» lo stesso passo la fa crescere di 1,3–1,9 MiB. È il
  `malloc_trim` dell'ultima istanza dei fogli chiusa (T5): rende al sistema
  anche la memoria che l'allocatore teneva dall'indicizzazione dell'avvio,
  non soltanto quella del motore. Per questo il residuo dell'app scende sotto
  zero: la partenza «vuota» la comprendeva.
- **La pendenza dell'app non cambia**: da 0,01 a 0,31 MiB per giro prima, da
  0,24 a 0,29 dopo. Ogni giro lascia ancora qualche centinaio di KiB nel
  processo dell'app.
- **La WebView decide il totale.** Il residuo della WebView va da −20,9 a
  285,2 MiB prima e da 46,2 a 122,8 dopo; la sua pendenza fra −1,2 e 11,8
  prima, fra 7,3 e 9,0 dopo. È la raccolta della memoria di WebKit, che K3
  non tocca.
- **La differenza prima/dopo del totale sta dentro il rumore.** La pendenza
  totale va da −0,93 a 11,78 prima e da 7,48 a 9,23 dopo; nella CI su `main`
  oscilla da −4 a +48 MiB per giro fra un run e l'altro. Tre giri per lato
  non distinguono un cambiamento della WebView; il cambiamento del processo
  dell'app (circa −65 MiB di residuo) sta invece ben fuori dal suo rumore
  (da 7,3 a 11,7 prima, da −61,0 a −52,7 dopo).

### Nella CI

Il job «la WebView vera (WebKitGTK, S1–S3)» misura R1 sul runner, con la
soglia `ci`:

| Run, job | Commit | Residuo | App | WebView | Pendenza | App | WebView | Esito |
|---|---|---|---|---|---|---|---|---|
| 41367041872, job 125029284261 (`main`) | `620f0acd` | 53,7 | 5,5 | 47,2 | 34,67 | 0,43 | 34,24 | rosso: pendenza oltre 20 |
| 41390113100, job 125099560748 (PR #295) | `c5851334` | −8,8 | −74,0 | 64,2 | 19,58 | 0,11 | 19,46 | verde |

Un run per lato: dice la stessa cosa della macchina (il residuo dell'app
diventa negativo), non dice niente di più sulla WebView.

## S6, l'avvio a freddo

S6 misura dall'inizio della pagina alla prima riga della nota che S1 ha
lasciato aperta. Un avvio per giro: i tre giri di R1 sopra, più cinque giri
con `--only=S1,S6`, alternati, dalle 16:47 alle 17:13 (carico a un minuto fra
0,56 e 1,51).

| Lato | Gli otto avvii, ms | Mediana |
|---|---|---|
| prima | 1304, 4198, 4477, 4295, 4394, 1330, 4380, 4281 | 4288 |
| dopo | 4197, 4308, 4270, 4388, 4276, 4257, 1306, 4298 | 4273 |

- L'avvio ha due modi su tutti e due i lati: circa 1,3 s (due avvii su otto
  prima, uno dopo) e fra 4,2 e 4,5 s. Il modo lento non viene da K3: c'è
  già prima. L'obiettivo di S6 (1500 ms) lo passa soltanto il modo veloce,
  prima come dopo.
- Dentro il modo lento i due lati stanno nello stesso intervallo (4198–4477
  prima, 4197–4388 dopo): K3 non cambia l'avvio.

S1, che gira prima di S6, dà un p95 del tasto fra 115 e 128 ms prima e fra
115 e 129 dopo, sugli stessi otto giri.

## I banchi del client

Dalla cartella `apps/client/` di ogni lato, con Chromium senza finestra; dalle
17:13 alle 17:20, carico a un minuto fra 0,61 e 1,60.

| Banco | Prima | Dopo |
|---|---|---|
| `bench:grid` | 24 controlli su 24 a posto | 24 controlli su 24 a posto |
| `bench:fidelity` | 100 confronti su 100 a posto | 100 confronti su 100 a posto |

`bench:large`, due giri per lato; l'apertura è «dipinto», poi il tratto a
penna e l'annulla, in ms:

| Elementi | Prima: apertura | Dopo: apertura | Prima: tratto scritto | Dopo: tratto scritto | Prima: annulla | Dopo: annulla |
|---|---|---|---|---|---|---|
| 5.000 | 956,2 · 942,8 | 937,9 · 942,3 | 49,8 · 44,5 | 44,7 · 43,1 | 33,1 · 33,6 | 34,6 · 33,8 |
| 20.000 | 2013,2 · 2037,2 | 1998,9 · 2032,8 | 128,8 · 190,7 | 177,8 · 179,9 | 94,4 · 90,1 | 102,4 · 99,5 |
| 49.900 | 4834,5 · 4785,2 | 4803,0 · 4803,9 | 294,1 · 292,5 | 288,0 · 293,9 | 274,2 · 271,8 | 262,9 · 269,2 |

Nessuna differenza fuori dalla variazione fra due giri dello stesso lato.

## I tempi dei fogli e dei documenti

Sette giri per lato, alternati, dalle 17:24 alle 17:25, carico a un minuto
fra 1,50 e 2,32. Mediana dei sette giri, in ms.

### `tempi.rs` dei fogli

```bash
FUB_XLSX_TEMPI=DIR cargo test --release --locked -p fub-format-xlsx --test tempi -- --ignored --nocapture
```

`DIR` ha 23 cartelle: tre generate per questa misura (ZIP senza
compressione: 200 × 6 numeri e testo, 20.000 × 10 numeri, 10.000 × 8 con
una somma per riga) e venti file di prova pubblici di Apache POI. Le più
grandi:

| Cartella | Byte | Lettura prima | Lettura dopo | Griglia prima | Griglia dopo |
|---|---|---|---|---|---|
| `Grande-20000x10.xlsx` | 6.469.117 | 115,83 | 122,77 | 213,94 | 215,90 |
| `Formule-10000x8.xlsx` | 2.762.317 | 84,55 | 93,62 | 127,01 | 128,35 |
| `51585.xlsx` | 262.225 | 51,31 | 51,49 | 57,98 | 59,42 |
| `FormulaEvalTestData_Copy.xlsx` | 65.011 | 14,26 | 16,36 | 16,99 | 17,29 |
| `Tabella-200x6.xlsx` | 41.812 | 0,99 | 1,04 | 2,29 | 2,39 |

Le altre diciotto stanno fra 0,8 e 3,4 ms in tutti e due i lati.

#### La lettura dopo «tutto chiuso»

La lettura dopo K3 è più lenta del 6–15% sulle cartelle grandi, e in modo
stabile: `Formule-10000x8.xlsx` va da 84,5 a 84,7 ms nei sette giri prima e
da 91,6 a 94,8 dopo. Il codice della lettura (`fub_format_xlsx::read`) non è
cambiato. La differenza viene dall'ordine della prova: ogni cartella apre
una griglia e la lascia cadere, e dopo K3 la chiusura dell'ultima istanza
chiama `malloc_trim`, che rende al sistema la memoria; la cartella dopo
la chiede di nuovo al sistema.

Le prove, rifatte una volta per lato alle 17:25:

- i page fault minori di tutta la prova raddoppiano: da 10.075–10.227 a
  20.293–21.026;
- con la sola `Formule-10000x8.xlsx` nella cartella, cioè una lettura in un
  processo appena partito, i due lati quasi si toccano: da 93,2 a 94,7 ms
  prima, da 95,1 a 96,5 dopo, su tre giri (dall'1 al 2% in più, contro il
  6–15% della prova intera).

Quindi la prima apertura dopo che tutti i fogli si sono chiusi costa quasi
quanto la prima apertura dopo l'avvio. È il prezzo della memoria resa,
non una regressione del motore.

### `corpus.rs` dei documenti

```bash
cargo test --release --locked -p fub-format-rich --test corpus -- --ignored --nocapture tempi
```

| File | Apertura prima | Apertura dopo | Salvataggio prima | Salvataggio dopo |
|---|---|---|---|---|
| `docx/grande-3000-paragrafi.docx` | 128,24 | 131,07 | 192,19 | 189,73 |
| `docx/libreoffice.docx` | 4,27 | 4,28 | 5,34 | 5,13 |
| `docx/stili-elenchi-tabelle.docx` | 3,25 | 3,42 | 3,39 | 3,44 |
| `docx/senza-perdite.docx` | 2,84 | 2,89 | 3,32 | 3,31 |
| `docx/commenti.docx` | 2,13 | 2,13 | 2,32 | 2,27 |

Gli altri 24 file del corpus stanno sotto i 3,1 ms e cambiano al più di
0,16 ms fra i due lati.

## Le prove dei motori da soli

```bash
CARGO_TARGET_DIR=DIR/target node tools/motori-prova/misura.mjs --out DIR --solo fogli,documenti --giri 3
```

Un giro per lato per compilare, poi quattro giri per lato alternati, dalle
17:38 alle 17:40 (carico a un minuto fra 1,38 e 2,93). Le prove collegano il
motore a Fub da solo, senza lo strato dei motori: misurano il motore, non
K3. GridCraft è la copia in `vendor/gridcraft` (dopo K3 ha la patch 0011,
che la prova non chiama); WordCraft è quello di Git `9130181`, uguale nei due
lati. `cargo bloat` non è installato: il peso per crate non c'è.

| Prova | Lato | Senza simboli | Prima apertura, ms | Tutto chiuso, MiB | Dopo `malloc_trim`, MiB | Residuo, MiB |
|---|---|---|---|---|---|---|
| fogli, `Tabella.xlsx` | prima | 6,5 MiB | 1,1–1,2 | 5,6–5,8 | 5,4–5,5 | 2,1–2,2 |
| fogli, `Tabella.xlsx` | dopo | 6,5 MiB | 1,1–1,2 | 5,7–5,8 | 5,5–5,6 | 2,3 |
| documenti, `Documento.docx` | prima | 34,2 MiB | 14,7–17,0 | 30,2–30,7 | 22,1–22,6 | 17,0–17,7 |
| documenti, `Documento.docx` | dopo | 34,2 MiB | 13,9–15,4 | 30,1–37,6 | 22,0–22,5 | 17,1–17,7 |

- I motori da soli non cambiano: K3 agisce nello strato che li ospita, non
  dentro le prove.
- La prima apertura di `Documento.docx` sta fra 13,9 e 17 ms nei due lati,
  sopra l'obiettivo di 11 ms scritto con la
  [misura di K0](2026-10-31-motori-linux-ryzen.md) sulla stessa macchina
  (10,5 ms): non è un effetto di K3, ed è da rivedere a parte.

## 2026-11-04: i documenti che si chiudono

La misura di sopra non ha T8: senza «documento chiuso» la cache dei
documenti si svuotava soltanto alla chiusura del vault. Questa sezione
rifà R1 e le prove dei motori con T8, T10 e T11, cioè con la shell che dice
all'host quando una sessione di documento finisce.

- **nuovo**: `3c7b4f5d`, il ramo `piano/k3-motori` con T1–T15 e T18;
- **dopo di T9**: `c5851334`, lo stesso lato «dopo» della misura di sopra,
  rimisurato nelle stesse ore per un confronto onesto;
- 2026-11-04, dalle 09:26 alle 10:42, misurato dal coder di T16, sulla
  stessa macchina (`server-di-fub`, WebKitGTK 2.54.0, Xvfb `1280x800x24`);
- stessa build per i due lati: `npm ci && npm run build`, poi
  `cargo build --release --locked -p fub-app --features tauri/custom-protocol`;
  Rust 1.95.0, Node 22.23.3.

### Che cosa misura R1 con i documenti chiusi

R1 apre `Documento.docx` (un `.docx` del corpus, nell'editor dei documenti)
come quarto dei sette file e poi chiude tutte le schede. Con T11 chiudere
la scheda chiude la sessione del documento, che manda `document_closed`
all'host; chiuso l'ultimo documento, l'host svuota la cache dei documenti e
chiama `malloc_trim` (`crates/fub-host/src/rich.rs`). R1 quindi misura già
il residuo con il documento chiuso dal client, senza cambiare lo scenario:
è la lettura «chiuse» dopo «chiudi tutto».

### R1

Comando, dalla cartella `apps/client/` di ogni lato (è
`npm run bench:webview` con le opzioni di T9; la porta 4474 tiene libere
quelle del banco):

```bash
xvfb-run -a -s "-screen 0 1280x800x24 -maxclients 2048" node bench/webview/run.mjs \
  --only=R1 --budgets=targets --driver=$HOME/.cargo/bin/tauri-driver \
  --native-driver=/usr/bin/WebKitWebDriver --port=4474 --out=DIR
```

Tre giri per lato, alternati (dopo di T9, nuovo, dopo di T9, …), ognuno
partito con il carico a un minuto sotto 3. PSS in MiB, colonne come nella
tabella di sopra; il carico è quello all'inizio e alla fine del giro.

| Giro | Inizio, carico 1/5/15 min | Fine, carico | Vuota (app · WebView) | Residuo | App | WebView | Pendenza giri | App | WebView | Residuo 60 s dopo i giri | App |
|---|---|---|---|---|---|---|---|---|---|---|---|
| dopo di T9 1 | 09:26, 0,91 / 0,43 / 0,27 | 09:36, 0,59 / 0,86 / 0,63 | 1111,2 (433,6 · 635,7) | −65,2 | −62,4 | −2,0 | 11,70 | 0,08 | 11,61 | −37,9 | −86,7 |
| dopo di T9 2 | 09:47, 2,73 / 5,26 / 3,24 | 09:57, 0,80 / 1,85 / 2,31 | 1130,0 (415,8 · 671,8) | 169,4 | −60,6 | 230,9 | 9,43 | 0,30 | 9,12 | 22,7 | −79,1 |
| dopo di T9 3 | 10:07, 0,78 / 1,35 / 1,84 | 10:17, 0,33 / 0,95 / 1,43 | 1017,8 (410,1 · 565,5) | 222,1 | −82,5 | 305,5 | 10,76 | 2,16 | 8,60 | 26,9 | −87,4 |
| nuovo 1 | 09:36, 0,59 / 0,86 / 0,63 | 09:46, 4,86 / 6,04 / 3,30 | 1103,8 (440,8 · 621,2) | −20,4 | −74,4 | 54,9 | 0,34 | −7,47 | 9,41 | −28,6 | −131,1 |
| nuovo 2 | 09:57, 0,80 / 1,85 / 2,31 | 10:07, 0,78 / 1,35 / 1,84 | 1091,7 (423,6 · 625,8) | −53,7 | −104,9 | 52,1 | 14,09 | 0,03 | 14,06 | 48,6 | −103,3 |
| nuovo 3 | 10:17, 0,33 / 0,95 / 1,43 | 10:27, 0,75 / 1,22 / 1,34 | 1139,7 (440,2 · 655,3) | −73,5 | −87,4 | 14,8 | 6,79 | 0,15 | 6,64 | −85,0 | −83,8 |

Il processo di rete resta fra −0,9 e −0,8 MiB in tutti i giri. Alla fine
di «nuovo 1» il carico è salito a 4,86 per il lavoro di un'altra copia
sulla stessa macchina; il giro dopo è partito con il carico a un minuto
sotto 3, gli altri sotto 1.

Il passo che conta è «chiudi tutto», dall'ultimo file aperto (l'immagine)
alla lettura «chiuse», nel processo dell'app:

| Giro | App con i sette file aperti | App dopo «chiudi tutto» | Differenza | All'apertura di `Documento.docx` |
|---|---|---|---|---|
| dopo di T9 1 | 371,9 | 371,2 | −0,7 | +3,7 |
| dopo di T9 2 | 355,9 | 355,2 | −0,7 | +3,4 |
| dopo di T9 3 | 328,4 | 327,7 | −0,7 | +2,4 |
| nuovo 1 | 380,2 | 366,8 | −13,4 | +4,1 |
| nuovo 2 | 345,1 | 318,7 | −26,4 | +2,8 |
| nuovo 3 | 381,5 | 352,8 | −28,7 | +2,9 |

Che cosa ne viene:

- **Chiudere il documento rende memoria.** Senza T8 «chiudi tutto» lascia
  l'app dov'era (−0,7 MiB in tutti e tre i giri); con T8–T11 l'app scende
  di 13–29 MiB. È più di quanto il documento aveva preso all'apertura
  (2,8–4,1 MiB): come per i fogli, il `malloc_trim` dopo l'ultimo documento
  chiuso rende al sistema anche la memoria libera che l'allocatore teneva
  da prima.
- **Il residuo dell'app scende ancora**: da −82,5…−60,6 MiB sul lato di T9
  a −104,9…−74,4 sul nuovo. I giri «dopo di T9» stanno vicino ai numeri
  «dopo» della misura di sopra (da −61,0 a −52,7), con un giro più basso.
- **La pendenza dell'app resta vicina a zero**: 0,03 e 0,15 MiB per giro in
  due giri nuovi, contro 0,08–2,16 per il lato di T9. Il −7,47 di «nuovo 1»
  viene da un solo salto: nell'ottavo giro l'app scende da 368,6 a 309,6 MiB
  e lì resta. La misura non dice che cosa l'abbia liberato.
- **La WebView decide ancora il totale.** Il suo residuo va da −2,0 a
  305,5 MiB sul lato di T9 e da 14,8 a 54,9 sul nuovo, la sua pendenza da
  8,6 a 11,6 e da 6,6 a 14,1. Il residuo totale sta sotto i 50 MiB in tre
  giri nuovi su tre (in uno su tre sul lato di T9), ma la pendenza totale
  supera 1 MiB per giro in due giri nuovi su tre, e tre giri non
  distinguono un cambiamento della WebView dal suo rumore.

Il giudizio di R1 in cima non cambia: il cancello resta **non passa** sugli
obiettivi, per la pendenza della WebView.

### Le prove dei motori dopo «chiudi tutto»

Lo stesso comando di [Le prove dei motori da soli](#le-prove-dei-motori-da-soli),
con `--solo fogli,documenti --giri 3` e una cartella di compilazione per
lato. Un giro per lato per compilare, poi quattro giri per lato alternati,
dalle 10:41 alle 10:42, carico a un minuto fra 2,04 e 2,58 (scende dalla
compilazione appena finita). `tools/motori-prova` e `vendor/` sono uguali
fra `c5851334` e `3c7b4f5d`: la prova collega il motore a Fub da solo,
senza lo strato dei motori, e quindi senza T8.

| Prova | Lato | Senza simboli | Prima apertura, ms | Tutto chiuso, MiB | Dopo `malloc_trim`, MiB | Residuo, MiB |
|---|---|---|---|---|---|---|
| fogli, `Tabella.xlsx` | dopo di T9 | 6,5 MiB | 1,2 | 5,7–5,8 | 5,5 | 2,1–2,3 |
| fogli, `Tabella.xlsx` | nuovo | 6,5 MiB | 1,1–1,2 | 5,7–5,8 | 5,5 | 2,1–2,3 |
| documenti, `Documento.docx` | dopo di T9 | 34,2 MiB | 13,1–15,3 | 30,1–30,6 | 22,0–22,4 | 17,0–17,6 |
| documenti, `Documento.docx` | nuovo | 34,2 MiB | 13,3–14,4 | 30,5–30,7 | 22,4–22,6 | 17,5–17,7 |

Le prove non cambiano, come ci si aspetta: T8 agisce nell'host, che la
prova non usa. La prima apertura di `Documento.docx` resta sopra
l'obiettivo di 11 ms, come nella misura di sopra.

## I tetti

Nessun tetto abbassato, nemmeno con la misura del 2026-11-04 (gli stessi
pesi):

- `tools/motori-prova/budgets.json`: fogli 6,5 MiB contro un tetto di 7,
  documenti 34,2 contro 35, librerie uguali; i tetti sono già il numero
  misurato arrotondato in su;
- `apps/client/bench/webview/budgets.json`: le soglie `ci` sono del runner
  della CI, e questa macchina non le tara; gli obiettivi sono quelli di N0 e
  del cancello.

## Non misurato

- Lo scaldare del motore (`warm_engine`): R1 apre i file dal selettore
  rapido e non ne misura a parte né il tempo né la memoria.
- Le chiavi di apertura che restano nell'host dopo una finestra ricaricata,
  fino alla chiusura del vault o al tetto di 1024 (vedi
  [Scaldare e chiudere un documento](../architecture/motori.md#scaldare-e-chiudere-un-documento)):
  R1 non ricarica la finestra.
- macOS, Windows, mobile: R1 legge `/proc`, soltanto Linux.
- Una macchina con scheda grafica.
