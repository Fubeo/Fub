# La cella in modifica della Base

Che cosa succede al testo che si sta scrivendo in una cella di una
[Base](bases.md), prima di Invio, quando le righe si ridisegnano o la nota
cambia da fuori. Il codice è `apps/client/src/editors/base/surface.ts`
(`cellDrafts`, `confirmCell`); i test sono in
`apps/client/src/editors/base/surface-cell-draft.test.ts`.

## Il testo resta nel campo

Un ridisegno della tabella (un'altra nota salvata, la stessa nota cambiata da
fuori, lo scorrimento, un indice aggiornato) rifà le celle. Il campo che si
stava scrivendo riprende il suo testo e il fuoco, non il valore del disco.

## La conferma

Alla conferma (Invio, Tab, un clic fuori) la cella si scrive contro il valore
che la proprietà aveva quando si è cominciato a scrivere, con il controllo
del comando sul valore letto. Un cambio di un'altra proprietà della stessa
nota non conta.

Se intanto quella proprietà è cambiata, niente si scrive. La cella resta col
tuo testo, bordata di rosso, e sopra le righe la Base dice «“Nota” è
cambiata mentre scrivevi in “colonna”», con due scelte:

- «Mantieni il mio testo» scrive sopra il valore di adesso, ancora col
  controllo: se la nota cambia di nuovo, la scelta torna;
- «Usa la versione su disco» lascia il testo e rilegge la nota.

Se la nota cambiata non è più nella vista (un filtro la esclude), l'avviso
riporta il testo scritto, con «Copia il mio testo» al posto di «Mantieni».

## Esc e la chiusura

Esc lascia perdere il testo e mostra il valore del disco. Chiudere la Base
scrive le celle ancora in modifica. Una cella in conflitto non si scrive
sopra la nota cambiata: l'avviso di chiusura dice la nota, la colonna e il
testo.

## I fogli

Nei fogli di calcolo la cella aperta è testo in sospeso della sessione del
documento, e un cambio del file da fuori diventa il conflitto della nota
([la griglia](../architecture/grid-surface.md)). La Base non può usare la stessa via:
il file che cambia è una nota della vista, non il file `.base` della
sessione, e la regola sta nella superficie della Base.
