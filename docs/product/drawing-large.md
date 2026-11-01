# Disegni grandi

> **Per chi:** chi apre disegni di decine di migliaia di elementi: una
> mappa, lo schema di un impianto, una lavagna piena, un disegno venuto da
> un altro programma.
> **Risultato:** sapere fin dove un disegno resta modificabile, che cosa fa
> la vista quando il disegno è grande, quanto ci mettono l'apertura, la
> vista, la scelta e un tratto, e come lo si misura.

Un [disegno](drawing.md) si modifica fino a 50 000 elementi e 20 MiB; oltre
si apre in sola lettura ([formato della scena, limiti](../reference/scene-format.md#11-limiti)).
Fino a quel limite l'editor è lo stesso di un disegno piccolo: gli stessi
strumenti, la stessa scelta, gli stessi annulli. Cambia soltanto il modo in
cui la vista segue i gesti.

## La vista

Da 5 000 forme, mentre la vista si muove, con la rotella, lo zoom, le dita o
i tasti, il disegno la segue tutto insieme, come un'immagine: il browser lo
compone senza ridisporre né ridipingere niente, e uno zoom ingrandisce per
un momento i pixel di prima, che possono sembrare sfocati. 150 millisecondi
dopo che la vista si è fermata il disegno si ridipinge nitido nella vista
nuova. Sotto le 5 000 forme ogni passo della vista ridisegna subito.

L'immagine che segue la vista è ciò che si vede più un margine attorno, un
quarto del lato più lungo della vista: tanto può scoprire uno spostamento, o
uno zoom indietro, prima che il disegno si ridipinga. Un passo che andrebbe
oltre, e un salto, come il passaggio a un'altra tavola o uno zoom di più del
doppio, ridisegnano subito, come in un disegno piccolo: non si vede mai un
bordo vuoto, e un disegno largo, con centinaia di tavole viste da vicino,
non costa più di uno stretto.

Quel ridisegno è un fotogramma solo, ma in un disegno grande si sente: il
browser ridispone ogni testo alla scala nuova. Con 49 900 elementi, 1 280 dei
quali testi, dopo uno zoom costa circa 80 ms, la metà per i testi; dopo uno
spostamento, che non cambia la scala, meno di 20.

In ogni disegno il puntatore lo prende un velo trasparente sopra il foglio,
e l'editor trova da sé che cosa c'è sotto, con l'indice che usa per la
scelta: il browser non deve cercarlo fra decine di migliaia di elementi a
ogni movimento. Per chi disegna non cambia niente.

## Quanto ci mette

Il banco delle scene grandi apre tre lavagne, di 5 000, 20 000 e 49 900
elementi, con fondi, titoli, gruppi, forme e tratti a penna, e le percorre
come farebbe una persona. Su server-di-fub, un mini PC con un Ryzen 7 7730U,
a riposo, nel peggiore di otto giri, dall'evento al fotogramma dipinto:

| | 5 000 elementi | 20 000 | 49 900 |
|---|---:|---:|---:|
| Apertura, fino all'ultimo oggetto dipinto | 1,2 s | 1,5 s | 3,1 s |
| Un passo della rotella o di Ctrl+rotella | 10 ms | 6 ms | 12 ms |
| Un movimento della penna | 3 ms | 5 ms | 10 ms |
| Un tasto dello zoom | 18 ms | 23 ms | 32 ms |
| Il clic che sceglie | 22 ms | 32 ms | 48 ms |
| Il tasto di uno strumento | 15 ms | 20 ms | 31 ms |
| Il rilascio del tratto | 50 ms | 179 ms | 432 ms |
| Annulla | 34 ms | 99 ms | 224 ms |
| Un passo che ridisegna subito | — | 30 ms | 72 ms |
| Il ridisegno quando la vista si ferma | — | 47 ms | 86 ms |

La lavagna di 5 000 elementi ha meno di 5 000 forme: la sua vista ridisegna
a ogni passo, e non si assesta.

Ciò che segue un gesto o risponde a un comando cresce poco con la misura
del disegno; ciò che scrive cresce con lei. Ogni passo che scrive ricava di
nuovo dal testo la scena, l'indice degli oggetti e il loro albero, circa
6 ms ogni mille elementi, e il primo dopo molti ridisegni della vista paga
anche il garbage collector del browser: per questo il rilascio a 49 900
elementi arriva a 432 ms, e di solito ne costa meno di 300. Il modo di
abbassarlo è ricavare dal testo solo la parte che il passo ha cambiato.

## Il banco

```bash
cd apps/client
npm run bench:large                     # 5 000, 20 000 e 49 900 elementi, con le soglie
npm run bench:large -- --elements 30000 # da 200 a 49 900 elementi, senza soglie
npm run bench:large -- --cpu 4          # la pagina quattro volte più lenta
```

Il banco ([`large.mjs`](../../apps/client/bench/large.mjs)) apre il disegno
nell'app vera, nello spazio Completo, e fa otto corse: lo zoom coi tasti, la
rotella che porta un rettangolo al centro della vista, Ctrl+rotella su di
lui, la rotella e Ctrl+rotella col disegno sei volte più grande della
vista, un clic che sceglie il rettangolo, i tasti di due strumenti, un
tratto a penna e Annulla. Ogni passo si controlla: lo zoom tiene fermo il suo punto, la
rotella sposta del suo passo, la scelta dice «1 oggetto scelto.» e mostra la
misura del rettangolo, il tratto aggiunge un tracciato solo sulla strada del
puntatore, e Annulla lo toglie.

Le soglie, in CI a ogni push:

- un passo che **segue un gesto** dipinto entro 50 ms, tre fotogrammi;
- uno che **risponde a un comando** entro 100 ms;
- uno che **scrive** entro 250, 500 e 1 000 ms, per i tre disegni;
- l'**assestamento** della vista, e un passo che ridisegna subito, entro
  100, 150 e 300 ms;
- l'**apertura** entro 4, 6 e 10 secondi;
- nessun compito lungo, oltre 50 ms, fuori dai passi che rispondono,
  scrivono o ridisegnano e dagli assestamenti.

Il banco prova anche sé stesso: un passo sbagliato e uno lento, piantati
apposta, devono fargli vedere il rosso. Il referto, con ogni passo, sta in
`apps/client/bench/.output/large.json`; le soglie, con le misure su cui
poggiano, anche nel [budget prestazionale](performance-budget.md#i-disegni-grandi).

## Chi monta l'editor

La soglia delle 5 000 forme è `LARGE_SCENE_SHAPES`, in
`apps/client/src/editors/spatial/painter/svg-dom.ts`, con la vista portata
dalla radice del painter. La lavagna del banco sta in
`apps/client/bench/large-fixture.ts`: lo stesso numero di elementi dà sempre
lo stesso disegno. Non c'è niente da montare: le scene grandi valgono in
tutti e due gli spazi.
