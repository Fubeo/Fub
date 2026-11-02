# 2026-11-02, Linux, server-di-fub: il cancello di K3

Questa pagina conserva le misure del cancello di K3, lo strato dei motori:
la memoria dopo «chiudi tutto» (R1), l'avvio a freddo (S6) e i banchi di
fogli e documenti, prima e dopo K3, sulla stessa macchina e con lo stesso
modo di lancio.

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
  misurato**;
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
  [misura di K0](motori-2026-10-31-linux-ryzen.md) sulla stessa macchina
  (10,5 ms): non è un effetto di K3, ed è da rivedere a parte.

## I tetti

Nessun tetto abbassato:

- `tools/motori-prova/budgets.json`: fogli 6,5 MiB contro un tetto di 7,
  documenti 34,2 contro 35, librerie uguali; i tetti sono già il numero
  misurato arrotondato in su;
- `apps/client/bench/webview/budgets.json`: le soglie `ci` sono del runner
  della CI, e questa macchina non le tara; gli obiettivi sono quelli di N0 e
  del cancello.

## Non misurato

- T8, scaldare e «documento chiuso» (ramo `piano/k3-ipc-motori`): non unito.
- La memoria con un documento ricco aperto e chiuso dal client: senza T8 la
  cache dei documenti si svuota soltanto alla chiusura del vault, che R1 non
  fa.
- macOS, Windows, mobile: R1 legge `/proc`, soltanto Linux.
- Una macchina con scheda grafica.
