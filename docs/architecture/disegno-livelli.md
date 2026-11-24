# I livelli del motore nel Completo

> **Domanda:** come un livello di Fub e i comandi sui livelli, sulla selezione
> per carattere e sul livello corrente passano dal motore vettoriale al file?
> **Fonti autorevoli:** `crates/fub-disegno/src/differenza.rs`,
> `crates/fub-disegno/src/famiglie/`, `apps/client/src/editors/spatial/completo/`.
> **Decisioni:** [ADR 0250](../decisions/0250-il-disegno-completo-sul-motore.md),
> [ADR 0239](../decisions/0239-il-disegno-sul-motore-vettoriale.md).

Questa pagina continua [Il disegno completo](disegno-completo.md): lì il
percorso di un comando, la mappa, l'indice e il disco; qui i livelli.

Nel motore un livello di Fub si chiama col suo id, perché la mappa lega per
nome; il nome che si vede resta `fub:layer`, e `document.inspect` dà l'id.
Per la differenza (`crates/fub-disegno/src/differenza.rs`) un livello
rinominato è il `set` di `fub:layer`, l'occhio `display`, il lucchetto
`fub:locked`. Un livello nuovo in cima al documento del motore è l'`add` di
`<g id="l…" fub:layer="Livello N">` vuoto nella radice, al suo posto fra i
livelli (in fondo se va sopra tutti, se no dopo il livello che ha sotto), con
`fub:locked` e `display` se nasce bloccato o nascosto; il nome di serie è il
primo «Livello N» libero. Un nome vuoto, oltre 80 caratteri o con caratteri di
controllo è un errore `BadArgs` prima del motore, e la differenza lo rifiuta
di nuovo. Il colore, il modello, la stampa, l'anteprima e le immagini attenuate
di un livello non hanno un attributo nel formato: `Unsupported`, e le finestre
di Nuovo livello e Opzioni livello chiedono solo nome, occhio e lucchetto. Gli
elementi fuori da ogni livello stanno in un livello del motore senza elemento
nel file, che non si rinomina, non si nasconde e non si elimina (`Unmapped`);
un livello nuovo sotto di lui non ha un posto da scrivere (`Unsupported`).

Unire (`layer.merge`) e invertire (`layer.reverse`) vogliono almeno due righe,
e unire vuole livelli, non oggetti; invertire vuole righe dello stesso livello
o gruppo. Un argomento così è `BadArgs` col perché in italiano, prima del motore;
un livello bloccato si rifiuta (`Locked`). Il livello nel cui nome cade l'unione
è l'ultimo elencato in `ids`. Seleziona grafica (`layer.selectAll`) sceglie
l'arte visibile e sbloccata del livello, e con un livello bloccato non sceglie
niente (`Empty`). Nascondi altri e Blocca altri (`layer.hideOthers`,
`layer.lockOthers`) tengono i livelli di primo livello della selezione: Fub li
calcola e li passa al motore come `ids`; senza scelta né righe la voce è spenta
col suo perché e il comando rifiuta `Empty`.

Duplica livello (`layer.duplicate`) copia le righe di `ids`: la copia va subito
sopra l'originale, come livello del file, col nome «… copia» e i suoi oggetti
(`differenza.rs`, `livello_nuovo`). Anche un livello bloccato si copia: la copia
nasce sbloccata, prende gli oggetti e si blocca con un `set` alla fine, perché
la scena non mette niente in un livello bloccato. Sposta righe (`layer.move`,
`ids`, `target`, `place` sopra, sotto o dentro, `copy`) e Riordina
(`node.move`) spostano righe nella scena; come in VectorCraft un livello o un
gruppo bloccato non prende niente e una riga non va dentro se stessa
(`Unsupported`); in più una riga bloccata non si sposta, la sua copia sì.
Appiattisci (`layer.flatten`, `id`) porta tutto nel livello della riga data e
scarta i livelli nascosti; un livello nascosto non prende niente (`Hidden`) e un
livello bloccato ferma il comando (`Locked`). Seleziona per colore
(`select.color`) vuole `fill`, `stroke` o tutti e due, controllati in italiano
prima del motore (`BadArgs`). Senza righe questi comandi non partono (`Empty`):
il motore prenderebbe il suo livello corrente, che non è quello del client.
Restano «da fare», con la causa nella mappa, Nuovo sottolivello e Raccogli in un
nuovo livello (il formato non ha un livello dentro un livello), il livello che
ritaglia, Imposta livello corrente e Individua oggetto (sono del client).

Il livello corrente sta nel client, nella sessione del documento
(`apps/client/src/editors/spatial/livello-corrente.ts`): una cella per
`DocumentSession`, per chiave del livello (id di Fub, o `@posto`), condivisa
dagli editor sullo stesso documento e mai scritta nel file né nella sessione
del motore, che `Banco::ripristina` rifà a ogni comando. Un livello sparito non
svuota la cella: finché manca si usa il più alto né nascosto né bloccato.
Sposta sul livello corrente (`object.arrange.sendToCurrentLayer`, famiglia
`nucleo`) riceve l'id nel `value` (`layer`); il ponte lo toglie prima del motore
(`famiglie/nucleo.rs`), lo risolve sui livelli della copia e lo mette come
livello attivo del documento del motore. Un id che non c'è, o nessuno, vale il
livello più alto libero; il livello nascosto è `Hidden`, quello bloccato
`Locked`, un id che non è testo `BadArgs`; senza livelli di Fub gli oggetti
vanno in cima alla radice.

La carta (`fub-paper`) resta fuori dalla copia del motore quando gli altri figli
della radice sono tutti livelli di Fub (`src/apertura.rs`): così il motore apre
i livelli di Fub come suoi livelli di primo livello, e Oggetto › Nascondi e
Blocca (sopra, altri livelli) lavorano per livello. La carta non conta come
perdita, una scelta che la nomina è bloccata (`Locked`), e un livello portato in
fondo si scrive subito dopo di lei (`after: fub-paper`), mai sotto. Con un
oggetto fuori dai livelli la carta resta nella copia, dentro il livello del
motore senza elemento nel file, come prima. Il file non cambia: la carta resta
il primo figlio della radice.

Nel client la scheda Livelli del Completo è l'albero nativo
(`apps/client/src/editors/spatial/tools/objects.ts`): l'occhio, il lucchetto,
il nome, Nuovo livello ed Elimina livello chiedono a
`apps/client/src/editors/spatial/completo/livelli-porta.ts`, che legge
`document.inspect`, lega l'id della scena all'id del motore
(`completo/livelli-modello.ts`) e manda `disegno.layer.setProps`, `new` o
`delete` con quegli `ids`. Le operazioni che tornano passano dal commit di
sempre. Quando la porta risponde `nativo` (motore assente, famiglia non pronta,
livello che il motore non conosce) l'editor scrive le stesse operazioni da sé;
un livello bloccato si ferma prima, col motivo `draw.livelli.bloccato`.
Col motore, la scheda ha in testa il bottone «Menu dei livelli» (il menu del
pannello Livelli di VectorCraft: nel Completo la riga delle opzioni non ha il
pulsante dei livelli), con due voci in più, Duplica e Appiattisci, che mandano
`disegno.layer.duplicate` e `disegno.layer.flatten`. Non hanno una strada
nativa: senza motore non partono, e lo dicono (`draw.livelli.senzaMotore`). Lo
spostamento delle righe della scheda resta nativo: `layer.move` e `node.move`
sono comandi del motore, ma la scheda non li chiama ancora.
L'albero si rifà dalla scena dopo ogni commit, quindi non serve un aggancio in
più per sapere che il motore ha cambiato il documento.

Seleziona testo per font (`select.font`) sceglie i testi che hanno il carattere,
e lo stile se c'è, in una delle loro parti (anche dentro un gruppo), fra quelli
visibili e sbloccati: la selezione di prima non conta, e il comando non cambia il
file. Un carattere che nel disegno non c'è, o c'è solo su testi nascosti o
bloccati, è un `BadArgs` col perché in italiano, prima del motore. Le opzioni
della modifica globale (`select.globalEditOptions`) cambiano la sessione del
motore e non il file: rispondono con una lettura, le opzioni e il conteggio di
ciò che Avvia prenderebbe (la stessa regola di appartenenza del motore), e
restano nella sessione finché il disegno è aperto. Avvia la modifica globale
(`select.globalEdit`) non è ancora nel Completo: il suo stato sta nel documento
del motore, che Fub ricrea a ogni comando, e la causa è nella mappa.
