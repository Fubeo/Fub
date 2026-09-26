# Ricerca, link e grafo

> **Per chi:** chi cerca informazioni o segue relazioni nel vault.
> **Risultato:** distinguere indice, risoluzione dei link, backlink e resa.

## Ricerca

La ricerca full-text è una feature ufficiale. Mantiene un indice persistente e
incrementale, ma il vault resta la fonte autorevole.

Durante una ricostruzione, il canale dati espone lo stato
dell'indicizzazione. Un indice assente o incompatibile può essere rigenerato.

Le query attraversano la porta generica dell'indice; non nasce un comando IPC
per ogni filtro.
Il linguaggio è un albero di clausole in OR e letterali in AND con negazione
per foglia. Le foglie testo, regex e task vivono nell'indice full-text;
proprietà, tag, cartella, path, estensione e link usano i metadati e il grafo
del kernel. Testo significa termini in AND o frase esatta, con tolleranza
esatta o refusi che restringono invece di allargare; `case_sensitive` e le
regex lavorano sui campi memorizzati con limiti dichiarati di pattern,
documenti e byte. La stessa espressione vale per ricerca globale, viste,
query salvate e ricerca incorporata: il pianificatore instrada ogni foglia al
proprietario e ricompone l'AND/OR senza divergenze.

La riga della barra di ricerca ha una sintassi propria, compilata in quella
stessa espressione dalla regola `fub_abi::rules::search_syntax`. La sua gemella
TypeScript è legata da una fixture, così la barra della shell, `fub-cli search`
e i blocchi `query` incorporati leggono le stesse parole allo stesso modo:

- parole separate da spazi in AND, `"frase esatta"`, `-x` per negare, `OR`
  maiuscolo fra alternative e `( … )` per raggruppare;
- `/regex/`, e i filtri di proprietà `[chiave]`, `[chiave:valore]`,
  `[chiave:>v]`, `[chiave:<v]`, con valori numerici, booleani o date ISO
  confrontati per specie;
- gli operatori `tag:`, `path:`, `folder:`, `file:`, `content:`, `heading:`,
  `ext:`, `task:todo`, `task:done` e `match-case:`, con valore anche fra
  virgolette.

Un nome seguito da `:` che non è un operatore resta testo, così un orario o un
URL non producono un errore. Un errore di sintassi porta la specie e la
colonna, e la barra lo mostra al posto dei risultati. Un gruppo negato non è
ammesso, e un'espressione che dopo la distribuzione supera 32 alternative viene
rifiutata, come una che annida più di 32 gruppi uno dentro l'altro.

I tag di una nota sono quelli nel testo e quelli dichiarati dalla chiave `tags`
del frontmatter, come elenco o come stringa separata da virgole o spazi. Il
kernel e l'indice full-text applicano la stessa regola.

## Link

Il provider estrae dalla sorgente l'intento del link:

- wikilink;
- URL;
- path;
- heading o ancora;
- embed.

Il kernel risolve l'intento rispetto al vault e agli indici correnti. La
sorgente conserva ciò che l'utente ha scritto; la risoluzione è un dato
derivato.
Wikilink e path seguono regole diverse: il primo risolve per path con slash,
nome, nome con l'estensione (`[[board.canvas]]`) e alias con priorità
deterministica fra omonimi; il secondo solo per path relativo al documento.
Fra omonimi vince il più vicino alla radice, poi l'ordine dei path; fra
formati diversi dello stesso path (`Progetto.md`, `Progetto.canvas`) il nome
nudo porta prima al formato che dichiara un sorgente di prosa
(`fub:prose-source`), e l'estensione scritta sceglie l'altro. Heading e blocchi condividono slug e ancore
canoniche; un punto rinominato apre la nota senza inventare una destinazione.
Completamento e cambio rapido propongono nomi per pertinenza senza riordinare
nella shell, e la rinomina riscrive soltanto i wikilink che nominavano la nota,
conservando l'estensione se l'autore l'aveva scritta.
Il pannello mostra incoming, outgoing con contesto per riferimento, menzioni
non collegate in entrata e in uscita con filtro, e la conversione esplicita
della menzione in wikilink con revisione e span dichiarati. Il riferimento
scritto è il più corto che la risoluzione del vault manda davvero alla nota
(il nome, poi il nome con l'estensione, poi il percorso senza estensione, poi
il percorso intero); se la
parola trovata è scritta altrimenti, per esempio un alias, resta come testo del
link (`[[Rossi|Mario]]`).
Il pannello tag mostra gerarchia piatta o ad albero, ordinamento per nome o
conteggio e selezione multipla per esemplare; click e selezione lanciano
tramite RunSearch la stessa ricerca che si scriverebbe nella barra
(`tag:nome`, sotto-tag compresi). Pannelli collegati e backlink
nel documento sono opzioni di presentazione degli stessi dati, non indici
duplicati.

```mermaid
flowchart LR
    SOURCE["sorgente"] --> PARSE["link estratto"]
    PARSE --> INDEX["indice dei documenti"]
    INDEX --> RESOLVE["bersaglio risolto"]
    RESOLVE --> BACKLINK["backlink"]
    RESOLVE --> GRAPH["arco del grafo"]
```

Passando sopra un wikilink in Lettura, dopo un breve ritardo compare la nota
collegata in una scheda di sola lettura; in Live serve Ctrl/Cmd, per non
disturbare chi scrive. La scheda legge dal canale dati come gli embed, non apre
sessioni né buffer, e si chiude uscendo dal link e dalla scheda o con Esc. Un
link che non si risolve non apre niente.

## Backlink e vicini

Un backlink parte dal documento sorgente e conserva un contesto leggibile. Le
query per vicini e direzione usano gli stessi dati di identità del grafo.

Il grafo dei link tiene solo documenti. Un allegato nominato da una nota
(`![[foto.png]]`, o un link Markdown a un PDF) entra nei vicini uscenti come foglia,
un passo oltre la nota; la sua posizione dipende dalla cartella degli allegati,
quindi si risolve al momento della domanda. I backlink di un allegato elencano
le note che lo nominano. Il pannello Collegamenti elenca fra gli uscenti solo i
documenti.

Il pannello Collegamenti mostra una sezione per parte (entranti, uscenti,
menzioni non collegate nei due versi) con il numero nel titolo; una parte vuota
resta chiusa su una riga. Il contesto si legge come testo: un wikilink compare
col suo alias o col nome della nota, non con la sua sintassi. Il filtro delle
menzioni sta in fondo, in una sezione chiusa finché non è attivo, e usa la
sintassi della barra di ricerca (un filtro salvato come JSON vale ancora); un
filtro che non si legge lo dice accanto al campo, col carattere a cui si ferma.

Il pannello Cronologia elenca le versioni della nota con l'istante e la
variazione di dimensione rispetto alla precedente. Una versione si sceglie col
click: la sua anteprima parte dal confronto con la nota attuale e porta i
gesti — ripristino, testo intero, copia —; la versione attuale non offre il
ripristino. Ripristinare chiede conferma al posto del bottone, perché riscrive
la nota; il testo di prima resta nella cronologia.

Un file non letto o non parsato non può produrre link affidabili; l'apertura lo
dichiara invece di inventare un grafo completo.

## Graph View

Il provider ufficiale prepara un payload dichiarativo con nodi e archi. La
shell possiede il renderer Canvas e l'interazione. Il kernel non conosce pixel,
camera o animazioni. Il payload dichiara vista locale fino a tre passi, gruppi
per cartella o primo tag, filtri per orfani e allegati e timestamp di modifica;
assenti valgono il grafo globale. Gli allegati sono nascosti di default; il
filtro li aggiunge come nodi con i loro archi. Quale nodo è un documento lo
dice il registro dei formati. Posizione e animazione restano stato della
shell, in memoria e mai nel vault.

Il grafo non ha un posto riservato nella shell. Si apre con il comando
`graph.open` che il componente dichiara (`Mod-Shift-g`), dalla palette, dal menu
Vista o dalla rail, che mostrano ogni view principale apribile senza argomenti.
Con il componente spento spariscono anche comando, voce di menu e icona.

Questo confine deve restare stabile:

- il provider decide **quali dati** mostrare;
- la shell decide **come** disegnarli;
- il frontend non legge strutture interne del kernel;
- refresh e lifecycle seguono il registro delle view.

Il Canvas occupa una superficie separata dallo stato testuale e dall'elenco
delle note. L'elenco si apre con mouse o tastiera, mostra 50 note per pagina e
scorre nel proprio spazio, senza intercettare i gesti del grafo. L'inquadratura
iniziale attende che la superficie abbia dimensioni valide, poi segue il grafo
mentre si distende; smette al primo gesto dell'utente sulla vista o quando la
simulazione si spegne, e un riscaldo successivo non la riprende.

Tornando alla linguetta del grafo, o rifacendo la vista dalla barra, la shell
riprende posizioni, pin, temperatura e inquadratura del montaggio precedente se
i due insiemi di nodi coincidono almeno al 60% in entrambi i versi; i nodi
nuovi nascono accanto ai vicini già piazzati. Sotto la soglia, per esempio
passando dal grafo globale a quello locale, il layout riparte dalla semina.
Ridimensionare il riquadro tiene fermo il centro della vista.

La simulazione integra in secondi: attrito e raffreddamento valgono per
secondo, e i coefficienti della configurazione sono scalati da una costante di
tempo, così un vault di qualche centinaio di note si assesta in pochi secondi a
qualunque frequenza di frame. La repulsione cala come 1/d, quindi la densità del
grafo disteso non dipende dal numero di note. Sotto la soglia di raffreddamento
lo smorzamento cresce, e il loop si ferma su un grafo già fermo.

Un nodo si afferra dopo tre pixel di spostamento, dal punto in cui è stato
preso; sotto la soglia il gesto è un click. Al rilascio il nodo conserva poca
della velocità del trascinamento. Il pan segue il puntatore senza inerzia e,
al rilascio, prosegue con la velocità reale del gesto. La rotella normalizza
righe e pagine in pixel, e il pinch del trackpad ha una sensibilità propria.

I nodi scalano con lo zoom come archi e distanze, con un raggio minimo
visibile; lo sprite si sceglie sui pixel del dispositivo e, oltre il livello
più grande, il nodo si disegna vettoriale. La griglia di sfondo è ancorata al
mondo e segue pan e zoom. Le etichette non si sovrappongono: quella del nodo a
fuoco e quelle delle note aperte hanno la precedenza e restano leggibili a ogni
zoom, le altre compaiono per grado e si saltano se cadrebbero su una già
scritta. Il quartiere del nodo a fuoco si accende e si spegne in dissolvenza,
senza transizione col moto ridotto. La scia del movimento è un'opzione spenta
di default e sbiadisce verso il trasparente, senza coprire la griglia.

Il loop segue il refresh dello schermo, qualunque sia: il passo della fisica è
il tempo reale fra due fotogrammi, e la scia sbiadisce a tempo, non a
fotogrammi. Col moto ridotto il passo è invece quello nominale (1/60 s): conta
lo stato d'arrivo, e il grafo si ferma nello stesso punto a ogni ritmo. L'impostazione **Aspetto → Fotogrammi al secondo**
(`appearance.frame-rate`) mette un tetto al ritmo; il default è il massimo
dello schermo. Il livello della fisica dipende solo dal numero di nodi. Quando
i fotogrammi durano stabilmente più del budget (il periodo del tetto, mai sotto
i 60 fps), il grafo nasconde le etichette dei nodi di grado basso. Le rimette
dopo cinque secondi di fotogrammi di nuovo nel budget.

La modularizzazione del renderer è tracciata nell'issue
[#12](https://github.com/Fubeo/Fub/issues/12). La prova di scala e durata è
nell'issue [#6](https://github.com/Fubeo/Fub/issues/6).

## Comportamenti da non confondere

| Comportamento | Autorità |
|---|---|
| testo del link | file |
| tipo e span del link | modello prodotto dal formato |
| bersaglio risolto | kernel e indice |
| risultato della ricerca | provider di indice |
| payload della view | provider Graph View |
| posizione e animazione dei nodi | shell |
| preferenze grafiche | stato della shell |

- la Graph View non sostituisce la ricerca testuale;
- un arco non prova che il bersaglio sia ancora raggiungibile dopo una modifica
  non indicizzata;
- il layout visuale non è dato persistente del documento;
- il comando esplicito **Riscalda** riattiva il loop; il runner lo verifica con
  un campione di 120 frame, senza tenere il lavoro acceso indefinitamente;
- per cardinalità fino a 400 nodi la repulsione è esatta O(n²); da 401 a 2000
  nodi usa Barnes–Hut con costo atteso O(n log n) e collisioni; oltre 2000 usa
  Barnes–Hut atteso e omette le collisioni;
- lo sleep del loop è preservato quando alpha, camera e trascinamento non
  richiedono lavoro;
- i valori osservati e i criteri provvisori sono raccolti nel
  [budget di performance](performance-budget.md#budget-proposti-e-stato) e nei
  [criteri di acceptance](acceptance.md);
- il benchmark misura una fixture deterministica, non ogni grafo possibile:
  quadtree con nodi clustered o coincidenti può avvicinarsi al caso peggiore
  O(n²), quindi il risultato a 10k non è una garanzia universale;
- le issue [#6](https://github.com/Fubeo/Fub/issues/6) e
  [#12](https://github.com/Fubeo/Fub/issues/12) sono chiuse; il residuo heap
  trasferito a [#56](https://github.com/Fubeo/Fub/issues/56) è stato verificato
  e chiuso.
