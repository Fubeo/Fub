# La superficie su un tratto

> **Domanda:** come si modifica soltanto una sezione o un blocco di una nota,
> dentro un'altra, senza una seconda copia del documento?
> **Fonti autorevoli:** `apps/client/src/editors/core/range-surface.ts`,
> `apps/client/src/editors/core/section-anchor.ts`, le prove «una superficie
> su un tratto della sessione» in `apps/client/src/state/document-session.test.ts`
> e `apps/client/src/editors/text/range-surface.integration.test.ts`.

## In breve

Una superficie può mostrare soltanto un tratto della sessione: la sezione di
un titolo o il blocco di un id, che una trasclusione viva modifica dove sta.
È una superficie come quella di un riquadro
([superfici dell'editor](editor-surfaces.md)): la `DocumentSession` resta una
sola, e il tratto ne è una finestra.

## L'àncora

`RangeSurface.open(session, { id, anchor })` legge l'àncora (`#Titolo` o
`#^id`, `parseSectionAnchor`) sul testo di adesso, e dà `null` se non c'è. La
lettura (`resolveSectionAnchor`) segue le regole di `section_of` e `block_of`
del kernel: la sezione va dal titolo fino al prossimo titolo di livello pari o
superiore, il blocco è quello che porta l'id in coda alla sua ultima riga o su
una riga sua dopo una vuota. Le righe vuote prima del titolo dopo restano
fuori dalla sezione, e così il terminatore finale del file: ciò che si scrive
in fondo al tratto non si attacca al titolo dopo.

## La sessione e la vista

La superficie si sottoscrive alla sessione con la sua identità, come un
riquadro, e le porta le modifiche della vista locale come `TextOperation` sul
documento intero (`acceptSurfaceChange`): buffer, revisione, coda,
salvataggio e bozza restano della sessione, e i terminatori del file restano i
suoi anche dove la superficie scrive. Una modifica della vista rimasta
indietro si ribasa sul tratto (`rebaseStaleChange`); se non regge, la vista si
riallinea.

La vista locale è un `TextEngine` col solo testo del tratto, collegato con
`connect`: cursore, selezione e annulla sono suoi. Le modifiche delle altre
superfici le arrivano con `syncDoc`, fuori dalla sua cronologia, e
nelle coordinate del tratto.

## Il tratto che segue il testo

A ogni dato della sessione il vecchio inizio passa per la mappa di posizione
dell'operazione, poi l'àncora si rilegge vicino a lui e dentro il tratto
mappato: un titolo uguale altrove non prende il posto di quello tolto, e una
modifica che cancella tutto il tratto lo cancella anche se l'àncora uguale
che c'era dopo gli scivola al posto. Una modifica della superficie stessa
sposta soltanto la fine, senza rileggere: ciò che la persona scrive non
sparisce sotto il cursore, anche se è un titolo nuovo.

| Stato | Quando | Si scrive |
|---|---|---|
| `live` | l'àncora è nel tratto | sì |
| `unanchored` | l'àncora l'ha tolta la superficie stessa; il tratto segue la sola mappa finché torna | sì |
| `lost` | un'altra superficie o il disco hanno tolto l'àncora o il tratto | no, sull'ultimo testo, staccata |
| `closed` | la sessione si è chiusa, o la superficie è distrutta | no |

`watchStatus` e il disposer di `connect` sono gli unici ascoltatori; `destroy`
stacca superficie, vista e ascoltatori, e si può chiamare più volte.
