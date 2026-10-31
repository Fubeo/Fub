# 2026-10-31, Linux, i sei motori Craft da soli

Questa pagina conserva la prima misura di K0 dei motori Craft: ogni motore
collegato a Fub da solo, con le prove di `tools/motori-prova/`.

> **Per chi:** chi decide come i motori entrano in Fub (K1–K4), chi fissa i
> tetti di `budgets.json` e chi rifà la misura dopo un aggiornamento.
> **Risultato:** sapere quanto pesa ogni motore, quanta memoria tiene, quanto
> ci mette ad aprire un file e quante librerie porta che Fub non ha già.

## Chi, cosa, quando

- prove di `tools/motori-prova/` al commit `5a02602d`, ramo
  `fase/k0-misure`, 2026-10-31; il referto dice `f03ef813` perché le prove
  sono state misurate un attimo prima di essere committate, identiche;
- comando: `node tools/motori-prova/misura.mjs --out DIR`, tre giri per file,
  mediana di ogni passo;
- Rust 1.95.0, profilo `release` (peso per crate) e `spoglio` (senza simboli).

| Motore | Revisione |
|---|---|
| VectorCraft | `ed733b7` |
| PdfCraft | `c735fb7` |
| PhotoCraft | `b1cfff9` |
| LightCraft | `445dd31` |
| WordCraft, con la facciata engine | `9130181` (v0.10.0) |
| GridCraft, con la facciata engine | v0.11.1, la copia in `vendor/gridcraft` |

## La macchina e il sistema

- AMD Ryzen 7 7730U, 16 nuclei logici, 15 GiB di memoria;
- Debian GNU/Linux 13 (trixie), kernel 6.12.111;
- nessuna scheda grafica usata: LightCraft sviluppa sul processore
  (`app.gpu` spento), gli altri motori non ne chiedono una.

È un server, non il portatile di riferimento: i tempi valgono per
confrontare i motori fra loro, non come obiettivo.

## I file di esempio

| File | Che cos'è | Byte |
|---|---|---|
| `Foglio.svg` | il disegno di S5, duemila tracciati | 196.485 |
| `Stampa.pdf` | una pagina, da `R1/` | 15.813 |
| `Lungo.pdf` | quaranta pagine A4 di testo, generato | 206.466 |
| `Immagine.png` | 800 × 500, da `R1/` | 26.062 |
| `Foto.png` | 3200 × 2000, sfumature e rumore, generata | 15.490.272 |
| `Documento.docx` | due pagine, da `R1/` | 4.421 |
| `Tabella.xlsx` | 200 × 6, da `R1/` | 41.683 |

Sono file piccoli, salvo la foto: un documento Word o un PDF veri pesano di
più. Il corpus vero dei PDF è quello di P0, non ancora pronto.

## Il peso

| Motore | Programma senza simboli | `.text` | I crate più grandi |
|---|---|---|---|
| VectorCraft | 64,6 MiB | 50,3 MiB | `vectorcraft_engine` 11,8, `vectorcraft_doc` 4,1, `vectorcraft_format` 2,7, `vectorcraft_tools` 2,0 |
| PhotoCraft | 50,3 MiB | 36,5 MiB | `photocraft_engine` 9,7, `photocraft_algo` 4,5, `photocraft_codecs` 3,4, `photocraft_io` 1,8 |
| LightCraft | 35,9 MiB | 27,5 MiB | `lightcraft_engine` 5,5, `jixel` 2,7, `lightcraft_codecs` 1,6, `naga` 1,3 |
| WordCraft | 34,2 MiB | 22,4 MiB | `wordcraft_engine` 5,4, `wordcraft_docx` 1,7, `wordcraft_formats` 1,4, `wordcraft_doc` 1,3 |
| PdfCraft | 24,0 MiB | 15,2 MiB | `boa_engine` 3,7, `pdfcraft_js` 0,7, `hayro_interpret` 0,7, `pdfcraft_xfa` 0,7 |
| GridCraft | 6,5 MiB | 4,4 MiB | `gridcraft_xlsx` 0,9, `gridcraft_engine` 0,7, `gridcraft_functions` 0,6 |

Il programma comprende la libreria standard di Rust e `fub-abi`; i crate
sono in MiB di `.text`. Il crate più grande di PdfCraft è l'interprete
JavaScript (`boa_engine`), che arriva con la facciata engine.

## La memoria e i tempi

RSS in MiB dopo ogni passo, picco fra parentesi; tempo del passo in
millisecondi. «Avvio» è la sessione del motore creata, col file già letto.

| Motore, file | Avvio | Prima apertura | Seconda apertura | Tutto chiuso | Dopo `malloc_trim` |
|---|---|---|---|---|---|
| VectorCraft, `Foglio.svg` | 7,7 · 0,2 ms | 35,1 (73,9) · 42 ms | 44,5 (82,8) · 40 ms | 43,1 | 28,8 |
| PdfCraft, `Stampa.pdf` | 6,9 · 0,1 ms | 14,1 · 3,3 ms | 15,1 · 2,3 ms | 15,2 | 13,8 |
| PdfCraft, `Lungo.pdf` (40 pagine) | 7,1 · 0,1 ms | 22,4 · 369 ms | 22,6 · 368 ms | 22,8 | 13,1 |
| PhotoCraft, `Immagine.png` | 9,4 · 3,6 ms | 23,7 (28,9) · 7 ms | 34,0 · 4,6 ms | 32,6 | 22,6 |
| PhotoCraft, `Foto.png` | 24,5 · 3,6 ms | 172,2 (250,5) · 196 ms | 225,4 (303,5) · 174 ms | 225,6 | 131,8 |
| LightCraft, `Immagine.png` | 8,2 · 0,5 ms | 19,2 (176,0) · 147 ms | 27,4 (188,8) · 147 ms | 27,6 | 19,6 |
| LightCraft, `Foto.png` | 37,5 · 0,5 ms | 132,3 (289,2) · 248 ms | 151,1 (381,0) · 231 ms | 151,3 | 136,2 |
| WordCraft, `Documento.docx` | 5,1 · 0,1 ms | 29,0 · 10,5 ms | 29,5 · 3,0 ms | 29,6 | 21,6 |
| GridCraft, `Tabella.xlsx` | 3,5 · 0,1 ms | 5,5 · 1,1 ms | 5,7 · 1,0 ms | 5,7 | 5,5 |

Che cosa misura ogni apertura:

- VectorCraft: apre il disegno e lo disegna intero a 2880 × 1800;
- PdfCraft e WordCraft: aprono e disegnano ogni pagina a scala 2;
- PhotoCraft: apre e compone l'immagine ridotta a 2880 × 1800;
- LightCraft: importa la foto e la sviluppa a 2880 × 1800;
- GridCraft: apre la cartella e scrive la prima schermata di celle (60 × 26)
  come la cella le mostra; i pixel della griglia li disegna Fub.

Che cosa ne viene:

- **Chiudere non rende la memoria.** In nessun motore la RSS scende quando
  tutto è chiuso: la tiene l'allocatore di glibc. `malloc_trim` ne rende una
  parte. Il cancello «dopo chiudi tutto» di K1 non può contare sulla sola
  chiusura: serve `malloc_trim` (o un allocatore che restituisce) e una
  tolleranza scritta su questi numeri.
- **PhotoCraft e LightCraft tengono memoria anche dopo.** Con la foto grande,
  dopo `malloc_trim` restano circa 130 MiB in tutti e due, contro i 25–35 MiB
  dell'avvio: cache del motore che la chiusura non svuota. Va chiesto a loro,
  o svuotato da Fub, prima del cancello.
- **Il secondo file costa meno solo nei motori con molto da preparare.**
  WordCraft passa da 10,5 a 3 ms, PhotoCraft e VectorCraft guadagnano poco,
  PdfCraft e LightCraft niente.

## Le librerie

Contate dal `Cargo.lock` di ogni prova, per tutti i sistemi. «Già in Fub»
vuol dire lo stesso nome in una versione che Cargo può unire a quella di
Fub; «doppie» sono i nomi che Fub ha in una versione che Cargo non può unire,
quindi compilati due volte.

| Motore | Pacchetti esterni | Già in Fub | Nuovi | Doppie con Fub | Da Git | Interfaccia | `wgpu` |
|---|---|---|---|---|---|---|---|
| PdfCraft | 504 | 282 | 181 | 41 | 41 | nessuna | no |
| PhotoCraft | 425 | 264 | 138 | 23 | 25 | nessuna | no |
| LightCraft | 336 | 165 | 148 | 23 | 23 | nessuna | 30.0.1 |
| VectorCraft | 223 | 139 | 54 | 30 | 29 | nessuna | no |
| WordCraft | 188 | 142 | 30 | 16 | 14 | nessuna | no |
| GridCraft | 79 | 77 | 0 | 2 | 0 | nessuna | no |

Le doppie più pesanti sono quelle già note dal piano: i caratteri
(`read-fonts` 0.41/0.43/0.44 contro 0.35/0.37/0.39 di Fub, `skrifa`,
`font-types`), hayro (0.7 contro 0.5), `vello_cpu` e `vello_common`, `usvg`
(0.48 contro 0.45), la crittografia (`aes`, `cipher`, `hmac`, `rand`). Più
`miniz_oxide` 0.9 contro 0.8, che entra con tutti e sei.

Codice C e rete:

- PdfCraft e PhotoCraft portano `aws-lc-sys`, `ring` e `reqwest`; LightCraft
  `ring`; VectorCraft, WordCraft e GridCraft nessuno dei tre.
- Il crate `cc` (compilazione di C) entra con PdfCraft, PhotoCraft e
  LightCraft.

## Le patch

Le `[patch.crates-io]` dei motori non viaggiano con loro: chi li incorpora le
ripete. VectorCraft manda `krilla` a `craft-libs` `92d392c`, WordCraft a
`c348732`; PdfCraft manda hayro, `lopdf` e vello alle sue copie in `vendor/`.
In un workspace un crate si sostituisce una volta sola: questi motori non
stanno insieme in Fub senza allineare prima le revisioni (K3).

## Non misurato

- macOS e Windows: le prove girano, ma la memoria si legge solo su Linux.
- Il portatile di riferimento e una macchina con scheda grafica.
- Il tempo di compilazione da zero: le prove sono state compilate più volte
  con la stessa cartella `target`.
- Le tre strade per la tela delle foto, le librerie a runtime, il corpus di
  P0: sono i passi dopo di K0.
