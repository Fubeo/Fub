# La bacheca della Base

La vista Bacheca di una [Base](bases.md) (`kanban`): una corsia per ogni
valore della proprietà del raggruppamento (`group`), con le note come schede.
Il codice è `apps/client/src/editors/base/surface.ts` (`drawKanban`); la scelta
della proprietà sta in `apps/client/src/editors/base/view-keys.ts`. Le corsie
di una Selezione o di uno Stato: [Nella Bacheca di una
Base](../reference/property-types.md#nella-bacheca-di-una-base).

## Le corsie di una bacheca nuova

Una bacheca aggiunta con «+» ([Una vista nuova](bases.md#una-vista-nuova))
prende come corsie, nell'ordine:

1. il raggruppamento della vista aperta;
2. la prima proprietà delle note dichiarata Stato, poi Selezione, nel
   registro dei tipi;
3. fra le colonne della vista e poi le proprietà delle note, la prima di
   testo (o lista) con pochi valori nelle note della vista: al più 12, e
   almeno una corsia con due note; se nessuna ne ha così pochi, quella che
   ne ha meno.

Mai una data, un numero o una casella: una proprietà con anche un solo
valore di quelle specie non fa corsie da sola.

## Cambiare la proprietà

Sopra le corsie, «Corsie per» dice la proprietà del raggruppamento e la
cambia: il menu offre le colonne della vista e poi le proprietà delle note,
tranne le date. Sceglierne una scrive `group` (`{ key: … }`) con
`base.view.set`, come lo scriverebbe la mano. Le corsie vuote aggiunte dalla
bacheca erano della proprietà di prima e non restano.

Una bacheca il cui file non dice `group` lo scrive al posto delle corsie e
offre la stessa scelta. In sola lettura e in una Base dentro una nota il menu
mostra la proprietà ma è spento. La data del calendario si cambia allo stesso
modo dalla sua testa ([Il calendario della Base](bases-calendar.md)).
