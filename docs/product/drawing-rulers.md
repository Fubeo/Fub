# Disegni, righelli e guide

> **Per chi:** chi disegna su misura, in millimetri per la stampa o in pixel
> per lo schermo, e vuole linee di riferimento che restino nel disegno.
> **Risultato:** sapere come si mostrano i righelli, come si tirano, si
> spostano, si bloccano e si eliminano le guide, anche coi numeri, e come
> l'unità del documento cambia ciò che si legge e si scrive.

Dal livello Standard il [disegno](drawing.md) ha i righelli, in alto e a
sinistra, e le guide che se ne tirano: linee orizzontali e verticali che
attraversano il foglio e a cui ciò che si muove si aggancia. A differenza
delle [guide intelligenti](drawing-guides.md), che compaiono durante un
gesto e se ne vanno, le guide del documento restano: sono scritte nel file,
le ritrova chi lo riapre, su qualunque macchina. Il documento ha anche la sua
unità di misura, che vale per i righelli, per i campi e per ciò che l'editor
dice (`apps/client/src/editors/spatial/tools/rulers.ts`).

## I righelli

`Maiusc+R`, o la casella **Mostra i righelli** in «Pagina e griglia», li
mostra e li nasconde; `Ctrl+R`, quello dei programmi di disegno, nel browser
ricarica la pagina. Il cambiamento si annuncia, «Righelli visibili.» o
«Righelli nascosti.».

I righelli coprono il bordo del foglio senza spostare il disegno. Contano
nell'unità del documento dall'origine della scena, l'angolo della pagina di
un documento nuovo, e i numeri si diradano o si infittiscono con lo zoom, così
restano leggibili. Sul righello una fascia grigia dice dove sta la pagina, una
fascia nel colore d'accento dove sta la selezione, e una linea segue il
puntatore. Inquadrare il disegno, lo zoom coi tasti e il cursore della
tastiera tengono conto dei righelli: ciò che si inquadra resta nella parte
che si vede.

Nell'angolo fra i due righelli c'è la sigla dell'unità. Un clic sull'angolo,
o il tasto destro su un righello, apre il menu dei righelli: l'unità del
documento, **Mostra le guide**, **Guide…**, bloccare o sbloccare tutte le
guide, eliminarle tutte e **Nascondi i righelli**.

Come la griglia, mostrare i righelli è una scelta della vista: non entra nel
file, si ricorda su questa macchina e chi monta l'editor la legge e la sceglie
in `grid.rulers`, con `grid`, `setGrid` e `onGridChange`.

## Tirare una guida

Si preme su un righello e si trascina sul foglio, con qualunque strumento:
dal righello in alto viene una guida orizzontale, da quello a sinistra una
verticale. Accanto al puntatore si legge dove sta. Rilasciata sul foglio, la
guida c'è, e si annuncia: «Guida orizzontale aggiunta a 120.». Rilasciata di
nuovo sopra un righello, fuori dal foglio, o senza averla mossa, non c'è.
Dall'angolo non se ne tira nessuna.

Mentre si tira, la guida si ferma sulle righe della griglia, se l'aggancio è
acceso, sui bordi e sui centri degli oggetti e della pagina, se le guide
intelligenti sono accese, e sulle altre guide. Tenendo premuto `Ctrl` o `⌘` si
posa libero. La posizione si scrive con due decimali, come le altre misure
del file.

## Spostarle, bloccarle, eliminarle

Con la **Selezione**, sopra una guida il cursore dice in che direzione si
sposta, e la guida si accende; trascinandola si sposta, e si aggancia come
quando la si tira. Le maniglie della cornice vengono prima delle guide, e le
guide prima degli oggetti: per scegliere un oggetto sotto una guida si
blocca la guida, o si sceglie l'oggetto col riquadro o con la tastiera.
Rilasciata sopra un righello o fuori dal foglio, la guida se ne va: mentre ci
si sta sopra si vede tratteggiata e sbiadita, e accanto al puntatore si legge
«Rilascia per eliminare».

Il tasto destro su una guida, o il tocco lungo, apre il suo menu, con
qualunque strumento: **Blocca la guida** o **Sblocca la guida**, **Elimina la
guida**, **Guide…** e le voci di tutte le guide. Una guida bloccata è
tratteggiata e il puntatore la attraversa: non si sposta e non si accende, e
si sblocca da questo menu. Due clic su una guida, con la Selezione, aprono
«Guide…» sulla sua riga.

Ogni guida tirata, spostata, bloccata o eliminata è un passo di annulla, e si
annuncia.

## Le guide coi numeri

**Guide…**, in «Pagina e griglia» e nei menu dei righelli e delle guide,
apre una finestra con una riga per guida: la direzione, la posizione
nell'unità del documento, la casella **Bloccata** e il pulsante che la
elimina. Le posizioni partono dallo zero dei righelli: le verticali verso
destra, le orizzontali verso il basso. **Aggiungi una verticale** e
**Aggiungi un’orizzontale** mettono una riga al centro di ciò che si vede, a
un numero tondo dell'unità, col fuoco sulla sua posizione; **Elimina tutte le
guide** svuota l'elenco. Una posizione che non è un numero lo dice nella sua
riga, e la finestra non si conferma.

Con **OK** l'elenco intero diventa quello del documento, in un passo di
annulla solo: «Guide aggiornate.». Un campo non toccato resta esatto. È il
modo di lavorare sulle guide per chi non usa il puntatore, e quello per
metterle a una misura precisa.

## Vederle e agganciarsi

**Mostra le guide** (`|`), in «Pagina e griglia» e nel menu dei righelli, le
mostra e le nasconde; il cambiamento si annuncia, «Guide visibili.» o «Guide
nascoste.». Nascoste, le guide restano nel file ma non agganciano. Tirarne una
nuova le rimostra. La scelta si ricorda con la griglia, in
`grid.rulerGuides`.

Finché si vedono, ciò che si muove si ferma sulle guide come sui bersagli
delle guide intelligenti, anche con quelle spente: spostando, ridimensionando,
disegnando una forma, coi nodi e con la penna di Bézier, entro gli stessi
pixel dello schermo. L'annuncio lo dice: «1 oggetto spostato. Agganciato: il
bordo destro in linea con una guida.». `Ctrl` o `⌘` tenuto lascia libero
anche dalle guide.

## L'unità del documento

L'unità si sceglie fra pixel, millimetri, centimetri, pollici e punti, dal
menu dei righelli o dalla voce **Unità** di «Pagina e griglia». Un pollice
vale 96 pixel, 25,4 millimetri e 72 punti, come nei fogli di stile. Cambiarla
è un passo di annulla, si annuncia, «Il documento ora misura in
millimetri.», e il disegno resta com'è: cambia soltanto come si leggono e si
scrivono le misure.

Nell'unità del documento ci sono:

- i numeri dei righelli e la posizione delle guide;
- i campi di «Posizione e misure», della posizione dei nodi, della misura
  della pagina e di «Guide…», col nome che dice l'unità, «Larghezza (mm)»;
- il passo della griglia, che ogni unità ricorda per conto suo: 1, 2, 5, 10
  o 20 millimetri, da 5 la prima volta; 0,2, 0,5, 1, 2 o 5 centimetri, da
  0,5; un sedicesimo, un ottavo, un quarto, mezzo pollice o un pollice, da un
  quarto; 6, 12, 18, 36 o 72 punti, da 12; in pixel restano quelli di
  sempre;
- le misure che si leggono accanto al puntatore e quelle che si dicono:
  «Misure: 20 millimetri × 10,6 millimetri.», e le coordinate del cursore.

Lo spessore del contorno, la dimensione del testo e gli angoli restano nelle
loro unità.

## Nel file

Le guide e l'unità sono attributi della radice: `fub:guides="x 120; y 340.5
locked"` e `fub:units="mm"`. I pixel sono l'unità di serie e non si scrivono;
un documento senza guide non ha l'attributo. Un documento ha al più mille
guide. Se le guide scritte nel file non si leggono, restano com'erano:
l'editor non le mostra, non le cambia coi gesti e lo dice, e «Guide…» le
riscrive da capo. La grammatica è in
[Formato della scena, unità e guide](../reference/scene-format-rulers.md).

## Livelli e tasti

All'Essenziale i righelli e le guide non ci sono; le guide scritte nel file
restano. Nel Personalizzato sono la parte «Righelli e guide», anche senza
«Pagina e griglia»: il pulsante, allora, ha le loro voci. `?` elenca i loro
tasti: `Maiusc+R`, `|`, che vale come si scrive anche con `AltGr`, e `Ctrl` o
`⌘` tenuto mentre si tira una guida.

Le guide sono di un azzurro che non è quello della selezione né quello delle
guide intelligenti, e si legge sulla carta bianca come sul tavolo scuro. Una
guida bloccata e una che se ne va si riconoscono dalla forma, tratteggiate,
non dal colore. Col contrasto forzato le guide prendono il colore di sistema
dei collegamenti, i righelli quelli della pagina.
