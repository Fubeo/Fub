# Le voci a leva più alta

Il resto della roadmap dice *quando* prendere una voce. Questo dice *quali contano di più*: la leva non è la scadenza, e una voce può essere P2 e restare la più importante da capire.

[← indice](../todo.md)

---

Il resto del documento dice *quando* prendere una voce. Questa sezione dice
*quali contano di più*, ed è l'unica parte dell'«ordine consigliato» dei sei giri
che la nuova struttura non assorbe: la leva non è la scadenza, e una voce può
essere P2 e restare la più importante da capire.

Il criterio con cui i sei giri l'hanno misurata è uno solo, e vale anche per le
voci future: **una voce che rende una capacità *inesprimibile* sta sopra una che
la rende stretta.** Le altre due, sotto: quella che *moltiplica* ogni voce
successiva, e quella che è *datata* — cioè che non riguarda ciò che scriveremo
ma ciò che abbiamo già pubblicato.

Nota di rotta: le voci con l'effetto leva più alto sono **[decisione 0009](../decisions/0009-registro-dei-comandi.md) (comandi —
fatta)**, **§2.1 (input in `UiNode`)** e **§9.3 (registry + job)** — insieme
spostano dal "cablato nell'app" al "registrato" praticamente ogni capitolo di
FEATURES dal 4 al 22, e sono le tre che il freeze di M4 rende definitive. Accanto a quelle, dal
secondo giro: **[decisione 0007](../decisions/0007-contesto-di-sessione.md) (contesto e selezione)**, senza cui metà dei capitoli 4, 13
e 22 non potrà mai essere un provider; **[decisione 0011](../decisions/0011-il-lotto.md) (il lotto — fatto, con la [decisione 0012](../decisions/0012-origine-degli-eventi.md))**,
prerequisito silenzioso di bulk fix, import, automazioni e database; e **§7.2 + §7.3**, che
sono il posto dove ogni famiglia di provider futura atterra senza portarsi
dietro la propria copia della disciplina.

Dal terzo giro se ne aggiungono due dello stesso peso. **§2.2 (le superfici)**:
senza area principale, status bar, ribbon e menu nel contratto, i capitoli 11,
12, 7.3, 10.3 e 11.5 — cioè la metà di FEATURES per volume — non hanno un posto
dove atterrare, e ognuno ripeterà la scappatoia che il grafo ha già fatto.
**[decisione 0008](../decisions/0008-modifica-chirurgica.md) (la primitiva di edit)**: finché l'unico modo di cambiare un documento è
riscriverlo tutto, ogni feature che tocca il testo perde cursore, selezione e
undo, e due di loro non si possono comporre — è il prerequisito silenzioso della
[decisione 0007](../decisions/0007-contesto-di-sessione.md) (la selezione), della [decisione 0011](../decisions/0011-il-lotto.md) (un lotto è una lista di edit) e del §13.3
(l'inverso di un edit è un edit).

Dal quarto giro se ne aggiungono due dello stesso peso, e vanno sopra tutte le
altre perché non allargano una capacità: ne rendono una **inesprimibile**.
**§9.1 (il job che vede il vault)**: finché il lavoro lungo non può leggere il
vault, i capitoli 17, 18, 22 e 19.4 — cioè il volume maggiore di FEATURES dopo
l'11 e il 12 — non hanno un posto dove girare, e l'unica alternativa è farli nel
giro sincrono, con il workspace preso in esclusiva. **§3.1 (il parser
estendibile)**: è l'unico punto in cui l'invariante «una feature ufficiale è ciò
che scriverà un plugin» è già falsa oggi — un'estensione di sintassi non può
essere un plugin, e con le ~50 del capitolo 5.2 in arrivo la falsità diventa la
regola. Accanto, di poco sotto: **§7.5 (i servizi fra plugin)**, senza cui il
capitolo 21 descrive crate linkati e non moduli installabili separatamente, e
**§8.1 (la scomposizione del `Workspace`)**, che è il posto dove tutte le altre
voci di questo piano andranno ad atterrare — una alla volta, come campi.

Dal quinto giro se ne aggiungono due. **§2.4 + §2.5 (una view che non ha stato e non può
chiedere di ridisegnarsi)**: sono due firme che insieme dicono che una view è una
funzione pura sincrona, e su quella forma non regge nulla di interattivo né di
asincrono — cioè i capitoli 11, 12, 11.5 e 22, gli stessi che il §2.2 sta
cercando un posto dove mettere. **§7.4 (gli spazi di nomi degli id)**: non è la
più grande, è la più **datata** — è l'unica voce dell'intero piano che non
riguarda ciò che scriveremo ma ciò che avremo già pubblicato, e il suo costo non
si misura in lavoro ma in id di terzi da rinominare.

In questo scaglione il quinto giro ne aveva messa una terza, la **§4.2 (il
modello parsato in mano ai provider)**, ed è **scesa**: diceva che il
`DocumentModel` non attraversa il contratto in nessuna direzione, e non è vero —
`IndexProvider::on_document_indexed` lo spinge a ogni indicizzazione. Chi può
stare dentro un indice (task, flashcard, citazioni, chunking) è servito, quindi
la voce non rende inesprimibile niente: rende **stretto** il percorso one-shot,
chi vuole il modello di una nota adesso e non era in ascolto quando è passata. È
il criterio di questo file applicato a sé stesso — inesprimibile sta sopra
stretto — e vale la pena che la retrocessione si veda, perché la voce era stata
messa in cima con una frase che nessuno aveva verificato.

Dal sesto giro se ne aggiunge una sola dello stesso peso, e sta accanto al
§3.1 per la stessa ragione: **§5.1 (sette varianti su nove di
`IndexQuery` non arrivano a nessun provider)**. Non allarga una capacità: ne
rende una inesprimibile, e lo fa su un canale che la [decisione 0005](../decisions/0005-canale-dati-verso-le-view.md) ha appena chiamato
«il canale dati verso le view» — grafo, proprietà e salute del vault sono
kernel-owned e non scavalcabili, quindi tutte le famiglie che vorrebbero
estenderli (7.3, 8.2, 7.2, 10, 15.1) hanno una strada sola, il `Custom`, cioè un
vocabolario privato accanto a quello ufficiale che dice la stessa cosa. Sotto,
di poco: **§7.1** e **§6.2**, che non rendono inesprimibile niente ma
moltiplicano ogni voce futura — l'una per il numero di implementazioni
dell'host, l'altra per il numero di linguaggi in cui la stessa regola va scritta.

Un'ultima nota, che vale come criterio più che come voce: **[decisione 0004](../decisions/0004-il-grafo-e-i-link-non-wiki.md)** (i link
markdown fuori dal grafo) è il primo caso in cui questo piano non descrive un
limite ma un **difetto** — «aggiornamento link su rinomina» è promesso, spedito,
e vero solo per metà dei link. Le quattro passate precedenti guardavano cosa non
si potrà costruire; questa dice di guardare anche cosa è già costruito e non fa
quello che dice. — Il difetto è **chiuso** (la metà kernel; il dettaglio in fondo
alla voce), ma il criterio resta, ed è la parte che vale: nei prossimi giri la
domanda «cosa manca» va accompagnata da «cosa c'è e non mantiene».

Dal settimo giro se ne aggiunge una sola con lo statuto delle voci del quarto —
**rende inesprimibile, non stretto** — e una nota che vale come criterio.
**§20.1 (l'alimentazione dell'indice non ha un esito)**: `on_document_indexed`,
`on_document_removed` e `reconcile` restituiscono `()`, quindi un indice che
perde un documento **non ha modo di dirlo** — e non è ipotetico, è già scritto
nel provider di ricerca, con il commento che spiega perché mentire sarebbe peggio
e nessun valore di ritorno con cui non mentire. Non allarga una capacità: rende
inesprimibile «l'indice non ha accettato questa nota», su un canale che il piano
aveva scelto di alimentare dal kernel **proprio** per non poterla perdere in
silenzio. Con il §5.1 quella firma diventa la strada di tutto il canale dati, non
del solo full-text.

Le altre tre voci della [seduta 20](20-quando-qualcosa-va-storto.md) non hanno
leva alta per il criterio di questa pagina, e vanno lette con un criterio
diverso che il settimo giro aggiunge: **una voce che non scade non sale mai, e
per questo il suo costo si paga tutto adesso**. Nessuna delle tre è una firma —
il kernel che scarta gli esiti che ha in mano (§20.3), la shell che non ha una
superficie dove dire niente (§20.4), la variante di evento che il verbale della
[decisione 0013](../decisions/0013-elenco-delle-capacita.md) ha già deciso e
rimandato per mancanza di clienti (§20.2) — quindi il freeze non le tocca, e
nessuna passata precedente aveva un motivo per guardarle. Ma il conto non è
rimandato: sono le voci il cui prezzo si paga in difetti che non lasciano
traccia, oggi, e un difetto che non lascia traccia non entra in nessuna lista di
priorità perché nessuno lo ha visto.

Il sesto giro ha applicato quel criterio e ha trovato il secondo caso: **§5.1**.
La forma è la stessa della [decisione 0004](../decisions/0004-il-grafo-e-i-link-non-wiki.md) — una promessa che vale a metà e in silenzio, e
la metà mancante non la scopre chi legge il contratto ma chi prova a usarlo.
Accanto, il criterio proprio di questo giro, da portare avanti allo stesso modo:
alla domanda «cosa manca» e «cosa non mantiene» va aggiunta **«quante volte è
scritto, e da cosa cresce quel numero»** — perché un moltiplicatore non si vede
mentre lo si crea, si vede quando è già stato applicato venti volte.

Il settimo giro ne ha aggiunta una sesta, e con essa il terzo caso della
famiglia della [decisione 0004](../decisions/0004-il-grafo-e-i-link-non-wiki.md):
**«cosa fallisce senza produrre nessun segnale»**. La promessa che vale a metà,
stavolta, è quella sul silenzio stesso — *«perdite silenziose non esistono per
contratto»* è scritto nell'architettura ed è vero della sola coda eventi.
Cercandola, il presupposto da non dare per buono è che un `Result` restituito sia
un `Result` letto, e che un messaggio scritto sia un messaggio arrivato: nel repo
di oggi quattordici messaggi vanno a `stderr` e dodici alla console della webview, e
nessuno dei due ha un lettore in un'app impacchettata.
