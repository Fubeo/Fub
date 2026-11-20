# Annotazioni dei PDF

> **Per chi:** chi legge e annota i PDF di un vault.
> **Risultato:** sapere come si annota un PDF, dove stanno le annotazioni e
> che cosa succede quando il PDF cambia o manca.

## Il visore dei PDF

Il visore (`apps/client/src/editors/media/pdf-view.ts`) ha in cima la barra
in una fila del kit, «Strumenti del PDF», che non va mai a capo: in una
finestra stretta scorre di lato. I suoi foglietti, in ordine:

- pagina precedente e successiva, spente ai capi del PDF (tutte e due in un
  PDF di una pagina);
- le miniature, quando il motore le sa disegnare;
- il sommario, un elenco a tendina, soltanto se il PDF ne ha uno;
- la ricerca, il campo con la lente: il numero dei risultati, o «Nessun
  risultato», si legge nella riga sotto la barra;
- adatta alla larghezza, due pagine affiancate e colori scuri;
- «Mostra le annotazioni», quando il PDF ne ha (vedi sotto), e «Annota»,
  quando c'è, nello stesso foglietto.

I pulsanti sono figure; il nome si legge nel suggerimento e lo dice il
lettore di schermo. Tab entra nella barra e ne esce con un passo solo, le
frecce passano da un controllo all'altro, Home e Fine vanno ai capi. In fondo
alla barra «…» («Altre azioni del PDF») apre il menu con «Apri con un'altra
app» e «Copia il link alla pagina», ciascuna soltanto se l'host la offre;
senza nessuna delle due «…» non c'è.

La pagina che si legge sta nella banda di stato, «Pagina 3 di 12», o «Pagine
3–4 di 12» con due pagine affiancate, e cambia con la pagina. Un PDF che non
si apre mostra la sua nota d'errore e nella banda non dice nessuna pagina. La
riga di stato del visore resta per il caricamento, gli errori e la ricerca, e
per il lettore di schermo.

Le pagine del visore si disegnano fuori dal thread principale (#525): un
worker (`pdf-render-worker.ts`, la regola in `pdf-render-serve.ts`) apre lo
stesso PDF con il suo pdf.js, disegna la pagina in un `OffscreenCanvas` e la
manda come `ImageBitmap`, che il visore mette in un canvas `bitmaprenderer`;
la pagina di prima resta finché la nuova non c'è. Il worker nasce alla prima
pagina chiesta, e quella pagina, finché il worker apre il PDF, si disegna nel
thread principale. Una pagina che il worker non disegna si disegna nel thread
principale; una WebView senza `OffscreenCanvas` o `bitmaprenderer`, un worker
senza font, che non apre il PDF entro 20 secondi, che tiene una pagina più di
10 secondi o che cade lasciano tutto al thread principale, come prima. Una
WebView che non sa disegnare nel worker lo scopre una volta: fino al riavvio
gli altri PDF non aprono il worker. Chiuso il PDF, il worker si chiude subito,
anche a metà apertura, e una pagina arrivata tardi si butta.

Il worker costa memoria: tiene una sua copia dei byte e un secondo pdf.js che
li analizza, da due a due volte e mezza il file in più (126 MB diventano 451
MB invece di 180). Per questo un PDF oltre 64 MiB non apre il worker e si
disegna nel thread principale: lì il prezzo sarebbe di centinaia di MB, mentre
fino a quella misura resta intorno ai 170 MB e compra la fluidità delle pagine,
che serve soprattutto alle scansioni. Le misure sono in
[La pagina del PDF disegnata in un worker](../misure/2026-11-20-linux-pdf-pagina-worker.md#la-memoria).
Miniature, schede vive, lavagna, stampa ed esportazione disegnano ancora nel
thread principale.

### Le annotazioni nel visore

Con la feature `draw`, il visore cerca accanto al PDF le sue annotazioni,
`X.pdf.fubann`, e le disegna sopra le pagine, in sola lettura: dove le mette
«Annota», alla misura della pagina, con una pagina sola o due affiancate e
con «Adatta alla larghezza». Non hanno maniglie né selezione, e i clic vanno
al visore. Non prendono i «Colori scuri»: restano dei loro colori, come in
«Annota». Per modificarle si apre «Annota».

L'interruttore «Mostra le annotazioni» sta prima di «Annota», nel suo
foglietto, e c'è soltanto quando il PDF ha delle annotazioni che si leggono.
È acceso a ogni apertura e non si ricorda, come i «Colori scuri»; spento, le
pagine sono il PDF e basta. Il lettore di schermo ne dice il nome e lo stato.

Le annotazioni si rileggono quando il file si salva, da un altro riquadro con
«Annota» aperto o da fuori, e vale l'ultimo salvataggio. Un file che nasce
dopo l'apertura, col primo «Annota», fa comparire l'interruttore; uno che
sparisce lo toglie. Un PDF senza annotazioni non scarica niente di più: il
codice che le disegna arriva solo quando il file c'è.

Ogni pagina è un'immagine fatta col testo del file: script, collegamenti e
risorse esterne che il file contenesse non partono. Ciò che sta fuori dalle
pagine del file, o oltre l'ultima pagina del PDF, non si vede.

La riga sotto la barra dice quando il PDF è cambiato dopo le annotazioni,
con le parole dell'avviso di «Annota» (vedi
[Quando il PDF cambia o manca](#quando-il-pdf-cambia-o-manca)): le
annotazioni si vedono lo stesso. Un file che non si legge, o che non è stato
fatto con Fub, non si disegna, non ha l'interruttore e la riga lo dice.

La stampa del PDF resta il PDF, senza le annotazioni.

## Annotare un PDF

Con la feature `draw` dell'host il visore dei PDF ha il pulsante «Annota»,
in fondo alla sua barra; la palette offre lo stesso comando, «Annota il PDF»
(`pdf.annotate`). La prima volta il comando crea `X.pdf.fubann` accanto a
`X.pdf` e lo apre; dopo lo apre soltanto. Il PDF non si scrive mai: le
annotazioni stanno nel loro file, che segue il PDF quando cambia nome. Senza
la feature il pulsante non c'è. Il pulsante segue l'elenco dei comandi anche
dopo che il visore si è aperto: una scheda ripristinata all'avvio, montata
prima che l'elenco arrivi, lo prende appena arriva, con l'interruttore delle
annotazioni. Il comando è descritto in
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
- **Lettura**: la stessa pagina senza strumenti, con la barra delle pagine e
  accanto l'elenco delle annotazioni. Proietta su `reading`, e `Mod-E` passa
  dall'una all'altra.

Le due modalità hanno gli id di quelle del disegno, così il riquadro le
ricorda allo stesso modo.

## Le pagine

Si vede una pagina per volta, a tutta misura. La barra delle pagine ha
«Pagina precedente», «Pagina successiva» e il numero della pagina, che si
scrive e si conferma con Invio; `Pag↑` e `Pag↓` sfogliano anche dal foglio.
Ogni cambio di pagina si annuncia: «Pagina 3 di 12».

La pagina del PDF è il fondo, e non si sceglie né si modifica. Si disegna
intera a circa quattro milioni di pixel; quando lo zoom si ferma, la parte che
si vede si ridisegna alla risoluzione dello zoom, fino a sedici milioni di
pixel.

Si sfogliano tutte le pagine del PDF, annotate o no, più ogni pagina annotata
oltre l'ultima. Una pagina riceve il suo gruppo nel file solo col primo
oggetto: aprire non scrive niente.

## Gli strumenti

Le annotazioni si aprono nello spazio Completo, con l'evidenziatore in mano.
Ogni strumento ha un tasto, che vale col fuoco sul foglio:

- **Selezione** (`V`), **Penna** (`P`) e **Gomma** (`E`), come nel disegno;
- **Mano** (`H`) e, nella sua tendina, **Zoom** (`Z`), che muovono la vista
  come nel disegno;
- **Evidenziatore** (`Maiusc+P`): un tratto giallo largo e semitrasparente;
  con `Maiusc` tenuto durante il tratto, il tratto è dritto;
- **Nota** (`N`): toccare la pagina apre un dialogo con il corpo della nota e
  un'etichetta di una riga, che sulla pagina si legge; senza etichetta vale
  l'inizio del corpo. Una nota si cambia toccandola con lo strumento Nota,
  o con la Selezione col doppio clic oppure scegliendola e premendo Invio;
- **Rettangolo** (`R`), **Ellisse** (`O`), **Linea** (`L`) e **Freccia**
  (`Maiusc+L`), come nel disegno;
- **Copertura** (`C`): un rettangolo pieno e opaco che nasconde una zona
  della pagina.

La copertura non toglie niente dal PDF: il contenuto sotto resta nel file e si
copia, si cerca e si stampa. Non è una redazione, e non si chiama così: toglie
il contenuto soltanto il [PDF redatto](#esportare).

Si scrive solo sulla pagina. Un tratto, una forma o una nota che comincia nel
margine fuori dalla pagina non crea niente, e lì gli strumenti che scrivono
hanno il cursore normale invece della mira; un tratto o una forma che comincia
sulla pagina ed esce si ferma al bordo, e una forma tenuta diritta con
`Maiusc` si accorcia restando quadrata o sul suo angolo. Gomma e Selezione
lavorano anche fuori. Le annotazioni già scritte fuori dalla pagina, da
versioni precedenti o da un altro programma, si aprono e si vedono come
sono: niente le sposta o le toglie da sé. Il disegno libero non ha questo
limite: lì la pagina si allarga.

Con la tastiera, Invio sul foglio aggiunge un oggetto dello strumento al
centro della vista, dentro la pagina, e lo lascia scelto: le frecce lo
spostano. Evidenziatore e copertura ricordano ciascuno il proprio colore,
separato da quello di penna, note e forme; nota e copertura non hanno
spessore.

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

Si scrive solo su una pagina di cui si sa la misura vera: quella del PDF
letto, o quella che il file ha scritto per quella pagina. Una pagina che
nessuno dei due misura si vede, bianca, con la misura di un'altra pagina del
file o A4, ma non si scrive: gli strumenti sono spenti e l'avviso dice
perché. Anche mentre il PDF si sta leggendo non si scrive, senza avviso. Un
segno nato su una misura di ripiego cadrebbe fuori dalla pagina quando poi il
PDF si legge, più piccolo. Le annotazioni già scritte così da versioni
precedenti si aprono come sono: niente le riporta sulla pagina.

Ogni messaggio dell'avviso sta su una riga, accorciato coi puntini; il testo
intero è nel suggerimento e lo legge il lettore di schermo.

Un elemento fuori dalle pagine, scritto a mano o da un altro programma, non si
vede sul foglio: un avviso li conta, e la sorgente li mostra.

## Esportare

«Esporta…», nella palette e nel menu del riquadro, fa uno di due file. Nessuno
dei due tocca il PDF del vault.

- **PDF annotato**: l'originale, identico byte per byte, con un aggiornamento
  in coda. Le annotazioni stanno in un livello che porta il titolo delle
  annotazioni, o il nome del file, e che i lettori di PDF sanno nascondere; le
  note diventano note del PDF, con l'etichetta e il corpo. Sotto una copertura
  il contenuto c'è ancora.
- **PDF redatto**: un file nuovo con le sole pagine. Una pagina con almeno una
  copertura diventa un'immagine a 200 punti per pollice, con le annotazioni e
  i commenti del PDF disegnati dentro: il contenuto sotto le coperture non c'è
  più, e il testo di quella pagina non si seleziona né si cerca. Le altre
  pagine si copiano come sono, con le annotazioni sopra. Del documento restano
  le pagine e nient'altro: niente segnalibri, allegati, script, moduli,
  struttura per l'accessibilità o metadati.

Il file si chiama come il PDF, con una parola fra parentesi nella lingua
dell'interfaccia: «Bando (annotato).pdf», «Bando (redatto).pdf». Prima
dell'export le modifiche in coda si salvano. Il file compare nel centro
attività, che si apre da sé: «Salva…» chiede dove metterlo, e accanto
«Stampa…» lo passa al lettore di PDF del sistema.

Se il PDF è cambiato da quando è stato annotato, il PDF annotato esce lo
stesso, mentre il PDF redatto no: una copertura potrebbe non stare più su ciò
che nasconde. Prima si controllano le annotazioni e si conferma la versione.
Un PDF che manca, che non si legge o che chiede una password non si esporta, e
il messaggio dice perché: l'errore dell'exporter esce con la frase del suo
catalogo, nella lingua dell'interfaccia, e il centro attività la mostra.

Il formato dei due file è nel [formato delle
annotazioni](../reference/annotation-format.md#9-export).

## Apri come sorgente

«Apri come sorgente» mostra le annotazioni come testo SVG, con l'anteprima
accanto, come per un disegno. Valgono le regole del disegno per la sorgente,
per più riquadri sullo stesso file e per il file su disco: un gesto cambia
soltanto i byte che deve cambiare.
