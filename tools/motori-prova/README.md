# Le prove dei motori

Questa cartella collega ogni motore Craft a Fub da solo, fuori dal workspace,
per prendere le misure di K0 del piano dei componenti: il peso nel programma,
la memoria, i tempi di apertura e le librerie che il motore porta con sé.

> **Per chi:** chi rifà le misure di un motore dopo un aggiornamento, o ne
> aggiunge uno.
> **Risultato:** sapere come si misura un motore e dove vanno i numeri.

## Le prove

Una cartella per motore, ognuna con un workspace suo:

| Cartella | Motore | Da dove | Che cosa fa |
|---|---|---|---|
| `vettori/` | VectorCraft `ed733b7` | Git | apre un SVG e lo disegna a 2880 × 1800 |
| `pdf/` | PdfCraft `c735fb7` | Git | apre un PDF e disegna ogni pagina a scala 2 |
| `pdf-dominio/` | i 13 crate di dominio di PdfCraft, senza facciata | Git | come `pdf/`, con il renderer preso direttamente (P0) |
| `foto/` | PhotoCraft `b1cfff9` | Git | apre un'immagine e la compone ridotta a 2880 × 1800 |
| `luce/` | LightCraft `445dd31` | Git | importa una foto e la sviluppa a 2880 × 1800, sul processore |
| `documenti/` | WordCraft `9130181` (v0.10.0), con la facciata engine | Git | apre un documento, lo impagina e disegna ogni pagina a scala 2 |
| `fogli/` | GridCraft v0.11.1, con la facciata engine | `vendor/gridcraft` | apre una cartella e scrive la prima schermata di celle |

`comune/` ha ciò che hanno in comune: l'orologio, la memoria letta da
`/proc/self/status` (soltanto Linux) e il referto, una riga JSON su stdout.

Ogni prova fa gli stessi passi: avvio del motore, prima apertura (freddo),
seconda apertura di una copia (scaldato), tutto chiuso, e poi `malloc_trim`,
che distingue la memoria che il motore tiene da quella che l'allocatore di
glibc non ha ancora reso. Tutte dipendono da `fub-abi`, così si compilano
accanto al contratto di Fub.

## Perché un workspace per motore

Come dipendenza Git, un motore non porta le sue `[patch.crates-io]`: chi lo
incorpora le ripete. E le patch dei motori non sono le stesse:

- VectorCraft manda `hayro-*` e `krilla` a `storytold/craft-libs` `92d392c`;
- PdfCraft manda `hayro-*`, `lopdf` e `vello_cpu`/`vello_common` alle sue copie
  in `vendor/`;
- WordCraft manda `krilla` a `craft-libs` `c348732`.

In un workspace un crate si sostituisce una volta sola, quindi questi motori
non stanno insieme senza allineare prima le revisioni. Le patch
dell'interfaccia (egui, winit) qui non servono: nessuna prova compila
un'interfaccia.

## Misurare

Dalla radice del repository, con [`cargo-bloat`](https://github.com/RazrFalcon/cargo-bloat)
nel `PATH`:

```bash
node tools/motori-prova/misura.mjs --out /tmp/misure-motori
node tools/motori-prova/misura.mjs --out /tmp/misure-motori --solo pdf,foto --giri 5
```

Per ogni prova lo script:

1. compila in `release` (con i simboli, per `cargo bloat`) e in `spoglio`
   (senza, come si distribuisce);
2. pesa il programma e i quindici crate più grandi;
3. la fa girare tre volte su ogni file di esempio e tiene la mediana di ogni
   passo;
4. conta le librerie del suo `Cargo.lock` rispetto a quello di Fub: quante ci
   sono già, quante sono nuove, quali compaiono in una versione che Cargo non
   può unire a quella di Fub (le doppie di `cargo tree -d`, una volta dentro
   Fub), quali vengono da Git;
5. controlla che non entri nessuna interfaccia (egui, eframe, winit, tao,
   gtk, rfd) e dice se entra `wgpu`.

Il `Cargo.lock` di ogni prova è suo: partire da quello di Fub non si può,
perché un motore chiede a volte una versione più nuova di quella fissata là
(VectorCraft vuole `zerovec` 0.11.7, Fub ne ha 0.11.6). Due versioni
compatibili per Cargo contano come una libreria già in Fub. I file di esempio sono quelli
del banco WebView (`S5/Foglio.svg` e la cartella `R1/`), più una foto di
3200 × 2000 e un PDF di quaranta pagine generati dallo script. Nessuna prova
legge un vault vero.

I numeri vanno in `docs/misure/motori-*.md`, con macchina, sistema e commit.
