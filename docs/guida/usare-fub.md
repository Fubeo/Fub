# Usare Fub

## Il vault

Un vault è una normale cartella locale. Le note restano file leggibili anche senza Fub; il provider Markdown gestisce frontmatter, link, tag, callout ed embed secondo il contratto del progetto.

Aprire un vault non dovrebbe richiedere di importarlo o convertirlo. Fub mantiene però una cartella di servizio `.fub/` per impostazioni, stato, bozze, indici e dati delle funzionalità. Non cancellarla senza sapere cosa contiene: consulta [dati e recupero](dati-e-recupero.md).

## Le superfici principali

La shell comprende:

- esplora file e navigazione del vault;
- editor e anteprima del documento;
- ricerca e apertura rapida;
- viste come grafo, tag, struttura e proprietà quando il relativo bundle è attivo;
- impostazioni, attività e diagnostica dei lavori lunghi.

L'elenco verificato dei bundle ufficiali è in [`STATO.md`](../STATO.md). Le pagine di [`features/`](../features/README.md) descrivono requisiti di prodotto e non devono essere interpretate come prova che una funzione sia già disponibile.

## Modifica e salvataggio

Il testo aperto vive in un buffer del documento. Le viste dello stesso documento devono condividere il contenuto autorevole, mentre cursore, selezione e scorrimento appartengono alla singola vista.

Fub distingue almeno questi casi:

- contenuto invariato;
- modifiche locali non ancora salvate;
- salvataggio in corso;
- errore di salvataggio;
- conflitto con una modifica arrivata dal disco.

Quando compare un conflitto, non sovrascrivere alla cieca il file esterno. Conserva entrambe le versioni e scegli consapevolmente quale mantenere.

## Lavori lunghi

Indicizzazione, backup e altre operazioni non devono bloccare l'apertura del vault. La shell espone avanzamento, esito ed eventuale cancellazione. Durante un'indicizzazione incompleta, una ricerca può essere parziale: l'interfaccia deve dichiararlo invece di mostrare un falso “nessun risultato”.

## Limiti attuali

Fub è una versione di sviluppo. Il runtime WASM e il percorso completo per plugin di terzi sono ancora parte del lavoro di progetto. Per una fotografia aggiornata consulta [`STATO.md`](../STATO.md) e [`todo.md`](../todo.md).