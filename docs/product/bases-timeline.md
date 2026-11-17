# La linea del tempo della Base

La vista Linea del tempo di una [Base](bases.md) (`timeline`, scritta su
disco come `type: table` col blocco `fub:`, con `start` e, facoltativa,
`end`). Il codice è `apps/client/src/editors/base/timeline.ts`; la scrittura
passa da `apps/client/src/editors/base/surface.ts`.

Ogni nota è una riga: il nome a sinistra, e a destra una barra dal giorno
d'inizio al giorno di fine, compreso, con le due date scritte dentro. Una
nota senza la fine è un punto nel giorno d'inizio. Il giorno è quello
scritto, e l'ora non lo sposta. Una nota con la fine prima dell'inizio si
disegna fra le due date con il bordo tratteggiato del rosso, e chi legge con
la voce sente «la fine viene prima dell'inizio». Una nota che cade fuori dai
giorni mostrati ha al bordo una data con la freccia, che porta i giorni fin
lì. Le note senza l'inizio non hanno riga: a destra della testata c'è quante
sono.

Sopra le righe ci sono i giorni mostrati, i due passi, il pulsante che torna
al giorno corrente e lo zoom: **Settimane** (otto colonne di una settimana,
dal giorno della lingua dell'interfaccia), **Mesi** (sei) e **Anni**
(quattro). Si apre col giorno corrente nella seconda colonna. La riga della
scala dice le due proprietà («richiesta → consegna») e il nome di ogni
colonna; una riga verticale dell'accento segna il giorno corrente, e la sua
scritta prende il posto del nome della colonna sotto. Come le altre viste, la linea del tempo mostra 100 note con una
data, poi «Mostra altre».

## Spostare le date

Trascinare la barra sposta tutte e due le date dello stesso numero di
giorni; trascinarne un bordo cambia una data sola, e un bordo non passa
l'altro. Durante il trascinamento la barra segue il puntatore a giorni
interi senza scrivere niente; Esc lo annulla, e un clic senza movimento apre
la nota. Al rilascio Fub riscrive le date nella nota con
`note.property.set`, una proprietà per volta e col valore letto come
confronto: se la nota è cambiata mentre la si trascinava non si scrive
niente, sotto la barra resta il perché, e la vista la rilegge com'è. Se la
seconda scrittura non riesce, la prima si annulla, così una barra non resta
mai a metà. La data resta della sua specie, come nel
[calendario](bases-calendar.md): una data con l'ora tiene l'ora, i minuti e il
fuso. L'avviso dice le date nuove e ha «Annulla», che annulla tutte e due le
scritture.

Non si spostano le note in sola lettura, quelle che non sono Markdown, le date
che sono `file.*` o formule, e i valori che non sono date: la barra resta, ma
non si prende.

## Dalla tastiera

Ogni riga è una cella della griglia, e il fuoco ne ha una per volta: le
frecce su e giù vanno fra le note (Home e Fine alla prima e all'ultima),
quelle a sinistra e a destra spostano i giorni mostrati di una colonna, Invio
apre la nota. Maiusc con le frecce sposta tutta la barra di un giorno, Alt
sposta l'inizio e Alt+Maiusc la fine. «+» e «-» cambiano lo zoom.

## Senza l'inizio

Una linea del tempo che non dice la sua proprietà d'inizio lo scrive al
posto delle righe e offre le proprietà data delle note: sceglierne una scrive
`start` con `base.view.set`. In sola lettura e in una Base dentro una nota la
scelta non c'è.

## Al telefono

Il nome sta sopra la sua barra, e la riga della scala non ha la colonna dei
nomi.
