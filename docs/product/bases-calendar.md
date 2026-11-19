# Il calendario della Base

La vista Calendario di una [Base](bases.md) (`calendar`, scritta su disco come
`type: table` col blocco `fub:`). Il codice è
`apps/client/src/editors/base/calendar.ts`; la scrittura passa da
`apps/client/src/editors/base/surface.ts`.

Il calendario mostra un mese, con ogni nota nel giorno della sua proprietà
data (`date` nel blocco `fub:`): il giorno è quello scritto, e l'ora non lo
sposta. La settimana comincia dal giorno della lingua dell'interfaccia (il
lunedì in italiano, la domenica in inglese americano); i giorni del mese prima
e del mese dopo che completano le settimane sono più tenui, con le loro note.
Il giorno corrente ha il numero nel cerchio dell'accento. Sopra la griglia ci
sono il mese, i due passi («Mese prima», «Mese dopo») e il pulsante che torna
al mese corrente; a destra, quante note non hanno la data e «Data», il menu
della proprietà data (sotto). Un giorno mostra al
massimo tre note: le altre sono «+N», che apre il giorno, e «Meno» lo
richiude. Il calendario mostra tutte le note della vista, senza «Mostra
altre». Il piede è quello delle altre viste.

## Spostare una nota

Trascinare una nota su un altro giorno riscrive la sua data nella nota con
`note.property.set`, una sola proprietà, col valore letto come confronto: se
la nota è cambiata mentre la si trascinava non si scrive niente, sotto la
barra resta il perché, e il calendario la rilegge com'è. La data resta della
sua specie: una data sola resta una data sola, una data con l'ora tiene l'ora,
i minuti, i secondi e il fuso (`2026-08-20T10:30` portata al 22 diventa
`2026-08-22T10:30`). Il valore si scrive come tutte le proprietà cambiate da
Fub, in ISO e tra virgolette: una data scritta in un altro ordine
(`20/08/2026`, letta con l'ordine del vault) torna ISO. L'avviso dice dove è
andata la nota e ha «Annulla», l'annulla del vault.

Non si spostano le note in sola lettura, quelle che non sono Markdown, le date
che sono `file.*` o formule, e i valori che non sono date.

## Dalla tastiera

Le frecce vanno fra i giorni (anche nel mese prima o dopo, che si apre), Tab
fra le note del giorno col fuoco, Invio apre la prima nota del giorno (o
quella col fuoco). Maiusc con le frecce sposta la nota col fuoco, o la prima
del giorno, di un giorno o di una settimana; il fuoco la segue nel giorno
nuovo.

## La proprietà della data

«Data», nella testa, dice la proprietà data del calendario e la cambia: il
menu offre le proprietà delle note che hanno per valori delle date, dalla più
presente nelle note della vista alla meno. Sceglierne una scrive `date` nel
blocco `fub:` con `base.view.set`, come lo scriverebbe la mano. In sola
lettura e in una Base dentro una nota il menu la mostra ma è spento.

Un calendario nuovo, aggiunto con «+», prende la proprietà data che più note
della vista hanno ([Una vista nuova](bases.md#una-vista-nuova)).

## Senza la data

Un calendario che non dice la sua proprietà data lo scrive al posto della
griglia e offre le proprietà data delle note, nello stesso ordine:
sceglierne una scrive `date` con `base.view.set`. In sola lettura e in una
Base dentro una nota la scelta non c'è.

## Al telefono

Il mese è una colonna di giorni, senza la riga dei nomi e senza i giorni degli
altri mesi: accanto al numero c'è il nome del giorno.
