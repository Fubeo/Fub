# La riga dei dati

> **Per chi:** chi scrive nelle note e chi lavora sulla loro testata.
> **Risultato:** sapere che cosa dice la riga sotto il titolo, dove sta in
> ogni modalità e da dove prende i dati.

## Che cosa mostra

Sotto il titolo di una nota una riga dice quando è stata modificata, quante
note la citano e quali etichette porta: «Modificata 07:30 · 3 collegamenti ·
#tema #banco». Il tempo è quello dell'ora relativa della shell («adesso», «2
min fa», l'ora, la data). In Live sta dopo la riga del primo titolo (senza
titolo, in cima al testo, dopo il frontmatter), nei Blocchi sotto il titolo
della testata della pagina, in Lettura dopo il primo titolo; in Sorgente non
c'è. Non è testo della nota: non si scrive, non si seleziona col testo, le
frecce la saltano e copiare non la copia. Il clic su «3 collegamenti» apre la
scheda Collegamenti dell'ispettore, il clic su un'etichetta la cerca come un
tag nel testo. Una parte vuota non si scrive, e senza nessuna delle tre la riga
non c'è.

## Da dove vengono i dati

La legge la shell (`state/note-facts.ts`) e la passa all'editor, che non chiama
l'host da sé: le etichette con la query `tags` ristretta alla nota, i
collegamenti dal `total` della query `backlinks`, l'ultima modifica dalla voce
della nota nell'anagrafe della sua cartella (`entries`, una finestra da 1000);
una nota che lì non c'è, appena arrivata o mai salvata, non scrive il tempo.
Si rilegge all'apertura, quando il kernel ha scritto la nota e al segnale
`documents`, mai a ogni battuta; una lettura vecchia non scrive mai sopra una
nuova.
