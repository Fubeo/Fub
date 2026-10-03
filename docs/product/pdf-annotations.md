# Annotazioni dei PDF

> **Per chi:** chi legge e annota i PDF di un vault.
> **Risultato:** sapere come si annota un PDF, dove stanno le annotazioni e
> che cosa succede quando il PDF cambia o manca.

## Annotare un PDF

Con la feature `draw` dell'host il visore dei PDF ha il pulsante «Annota»,
in fondo alla sua barra; la palette offre lo stesso comando, «Annota il PDF»
(`pdf.annotate`). La prima volta il comando crea `X.pdf.fubann` accanto a
`X.pdf` e lo apre; dopo lo apre soltanto. Il PDF non si scrive mai: le
annotazioni stanno nel loro file, che segue il PDF quando cambia nome. Senza
la feature il pulsante non c'è. Il comando è descritto in
[Vault e file](vault-and-files.md).

Il file `.fubann` si apre come le annotazioni del suo PDF: il profilo `pdf`
della famiglia `canvas` (`apps/client/src/editors/spatial/pdf/surface.ts`),
con le pagine del PDF sotto e gli strumenti del disegno sopra. Il codice si
scarica la prima volta che si aprono delle annotazioni o un disegno, come per
i [Disegni](drawing.md). Il formato del file è nel
[formato delle annotazioni](../reference/annotation-format.md).

## Modalità

- **Annota**, la predefinita: la barra degli strumenti, la pagina e la barra
  delle pagine. Proietta sul ruolo `live_preview`.
- **Lettura**: la stessa pagina senza strumenti, con accanto l'elenco delle
  annotazioni. Proietta su `reading`, e `Mod-E` passa dall'una all'altra.

Le due modalità hanno gli id di quelle del disegno, così il riquadro le
ricorda allo stesso modo. *(proposta del 3 ottobre 2026, da rivedere)*

## Le pagine

Si vede una pagina per volta, a tutta misura. La barra delle pagine ha
«Pagina precedente», «Pagina successiva» e il numero della pagina, che si
scrive e si conferma con Invio; `Pag↑` e `Pag↓` sfogliano anche dal foglio.
Ogni cambio di pagina si annuncia: «Pagina 3 di 12».

La pagina del PDF è il fondo, e non si sceglie né si modifica. Si disegna
intera a circa quattro milioni di pixel; quando lo zoom si ferma, la parte che
si vede si ridisegna alla risoluzione dello zoom, fino a sedici milioni di
pixel. *(proposta del 3 ottobre 2026, da rivedere)*

Si sfogliano tutte le pagine del PDF, annotate o no, più ogni pagina annotata
oltre l'ultima. Una pagina riceve il suo gruppo nel file solo col primo
oggetto: aprire non scrive niente.

## Gli strumenti

Le annotazioni si aprono al livello Standard, con l'evidenziatore in mano.
Ogni strumento ha un tasto, che vale col fuoco sul foglio:

- **Selezione** (`V`), **Penna** (`P`) e **Gomma** (`E`), come nel disegno;
- **Evidenziatore** (`H`): un tratto giallo largo e semitrasparente; con
  `Maiusc` il tratto è dritto;
- **Nota** (`N`): toccare la pagina apre un dialogo con il corpo della nota e
  un'etichetta di una riga, che sulla pagina si legge; senza etichetta vale
  l'inizio del corpo. Una nota si cambia toccandola con lo strumento Nota,
  o con la Selezione col doppio clic oppure scegliendola e premendo Invio;
- **Rettangolo** (`R`), **Ellisse** (`O`), **Linea** (`L`) e **Freccia**
  (`A`), come nel disegno;
- **Copertura** (`C`): un rettangolo pieno e opaco che nasconde una zona
  della pagina.

La copertura non toglie niente dal PDF: il contenuto sotto resta nel file e si
copia, si cerca e si stampa. Non è una redazione, e non si chiama così.

Con la tastiera, Invio sul foglio aggiunge un oggetto dello strumento al
centro della vista, dentro la pagina, e lo lascia scelto: le frecce lo
spostano. Evidenziatore e copertura ricordano ciascuno il proprio colore,
separato da quello di penna, note e forme; nota e copertura non hanno
spessore. *(proposta del 3 ottobre 2026, da rivedere)*

## La Lettura

L'elenco accanto alla pagina ha un titolo per ogni pagina annotata, in ordine
di numero: il titolo porta a quella pagina. Sotto ci sono le note, con
l'etichetta e il corpo, e il conto degli altri segni. Le note che stanno fuori
dalle pagine hanno una sezione a parte. Senza annotazioni l'elenco dice
«Ancora nessuna annotazione.».

Su uno schermo stretto l'elenco va sotto la pagina.

## Quando il PDF cambia o manca

Il file ricorda la versione del PDF che annota, con un'impronta dei byte e il
numero di pagine; la scrive il primo gesto, nello stesso passo di annulla.
All'apertura l'editor confronta e non scrive niente.

- **Il PDF è cambiato.** Un avviso lo dice, con il numero di pagine di prima
  e di adesso se è diverso. Le annotazioni restano dove sono: controllarle
  tocca a chi annota. «Conferma questa versione» lega le annotazioni al PDF
  nuovo, in un passo di annulla suo.
- **Il PDF non c'è**, o non si legge: un avviso lo dice, le pagine sono
  bianche della misura scritta nel file, e le annotazioni si modificano lo
  stesso. Il legame non cambia.
- **Il file non nomina un PDF del vault**, per esempio un URL esterno: le
  pagine sono bianche, come sopra.

Un elemento fuori dalle pagine, scritto a mano o da un altro programma, non si
vede sul foglio: un avviso li conta, e la sorgente li mostra.

*(proposta del 3 ottobre 2026, da rivedere)*

## Apri come sorgente

«Apri come sorgente» mostra le annotazioni come testo SVG, con l'anteprima
accanto, come per un disegno. Valgono le regole del disegno per la sorgente,
per più riquadri sullo stesso file e per il file su disco: un gesto cambia
soltanto i byte che deve cambiare.
