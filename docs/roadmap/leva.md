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
fatta)**, **[decisione 0016](../decisions/0016-cosa-e-una-view.md) (i nodi di
input in `UiNode` — fatta)** e **§9.3 (registry e job — fatto, con la
[decisione 0031](../decisions/0031-chi-possiede-i-bundle.md) e la
[0032](../decisions/0032-il-runner-dei-job.md))** — insieme
spostano dal "cablato nell'app" al "registrato" praticamente ogni capitolo di
FEATURES dal 4 al 22, e sono le tre che il freeze di M4 rende definitive. Accanto a quelle, dal
secondo giro: **[decisione 0007](../decisions/0007-contesto-di-sessione.md) (contesto e selezione)**, senza cui metà dei capitoli 4, 13
e 22 non potrà mai essere un provider; **[decisione 0011](../decisions/0011-il-lotto.md) (il lotto — fatto, con la [decisione 0012](../decisions/0012-origine-degli-eventi.md))**,
prerequisito silenzioso di bulk fix, import, automazioni e database; e **§7.2 + §7.3 — chiusi dalla
[decisione 0021](../decisions/0021-il-confine.md)**, che sono il posto dove ogni
famiglia di provider futura atterra senza portarsi dietro la propria copia della
disciplina.

Dal terzo giro se ne aggiungono due dello stesso peso. **Le superfici
([decisione 0016](../decisions/0016-cosa-e-una-view.md) — fatta)**: senza area
principale, status bar, ribbon e menu nel contratto, i capitoli 11, 12, 7.3,
10.3 e 11.5 — cioè la metà di FEATURES per volume — non avevano un posto dove
atterrare, e ognuno avrebbe ripetuto la scappatoia che il grafo ha già fatto.
Ora il contratto le nomina; **ospitarle** tutte è un'altra cosa — e il modello di
layout, che era il pezzo mancante, c'è dal ~~§1.2~~
([0078](../decisions/0078-i-riquadri-sono-un-fatto-della-shell.md)). Con la
~~§3.3~~ ([0079](../decisions/0079-il-grafo-esce-dall-overlay.md)) anche `main` è
ospitata — un riquadro tiene una tab di **view**, e il grafo è il primo a starci
dentro — quindi delle dieci superfici ne restano **due** non ospitate: `menu` e
`context_menu`, che vogliono superfici che questa shell non ha. Ed è la riga che
vale la pena rileggere fra un anno: l'ultima delle tre a cadere è caduta perché
il contratto bastava già, non perché qualcuno gli abbia aggiunto qualcosa.
**[decisione 0008](../decisions/0008-modifica-chirurgica.md) (la primitiva di edit)**: finché l'unico modo di cambiare un documento è
riscriverlo tutto, ogni feature che tocca il testo perde cursore, selezione e
undo, e due di loro non si possono comporre — è il prerequisito silenzioso della
[decisione 0007](../decisions/0007-contesto-di-sessione.md) (la selezione), della [decisione 0011](../decisions/0011-il-lotto.md) (un lotto è una lista di edit) e del §13.3
(l'inverso di un edit è un edit) — **chiuso** dalla
[decisione 0045](../decisions/0045-l-undo-ha-due-pile.md), che quella previsione
l'ha confermata al primo passo: `EditReport::inverse()` è metà dell'undo delle
operazioni, e l'altra metà — l'inverso di una rinomina, di una cancellazione —
non è un edit e non è nemmeno un vocabolario nuovo: è un **comando**.

Dal quarto giro se ne aggiungono due dello stesso peso, e vanno sopra tutte le
altre perché non allargano una capacità: ne rendono una **inesprimibile**.
~~**§9.1 (il job che vede il vault)**~~ — **chiusa** dalla
[decisione 0027](../decisions/0027-il-lavoro-lungo-vede-il-vault.md), e resta qui
perché era la voce di cui si poteva dire che un quinto di FEATURES non aveva un
posto dove girare: i capitoli 17, 18, 22 e 19.4 — il volume maggiore dopo l'11 e
il 12 — camminano il vault, e l'unica alternativa era farlo nel giro sincrono,
con il workspace preso in esclusiva. Adesso un job ha l'`HostApi`, e se lo prende
una chiamata alla volta: chi salva aspetta una lettura invece di tutte. ~~**§3.1 (il parser
estendibile)**~~ — **chiusa** dalla [decisione 0017](../decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md),
e resta qui perché era la sola voce di cui si potesse dire *«l'invariante del
progetto è già falsa»*: un'estensione di sintassi non poteva essere un plugin, e
con le ~50 del capitolo 5.2 in arrivo la falsità diventava la
regola. Accanto, di poco sotto: **§7.5 (i servizi fra plugin — chiuso dalla
[decisione 0021](../decisions/0021-il-confine.md))**, senza cui il
capitolo 21 descriveva crate linkati e non moduli installabili separatamente, e
**§8.1 (la scomposizione del `Workspace`, **chiusa** dalla
[decisione 0022](../decisions/0022-il-kernel-a-pezzi.md))**, che è il posto dove
tutte le altre voci di questo piano andranno ad atterrare — non più come campi
di un `struct` solo, ma dentro uno dei cinque proprietari.

Dal quinto giro se ne aggiungono due. **Una view che non ha stato e non può
chiedere di ridisegnarsi ([decisione 0016](../decisions/0016-cosa-e-una-view.md)
— fatta)**: erano due firme che insieme dicevano che una view è una funzione
pura sincrona, e su quella forma non reggeva nulla di interattivo né di
asincrono — cioè i capitoli 11, 12, 11.5 e 22, gli stessi che le superfici
stavano cercando dove mettere. **§7.4 (gli spazi di nomi degli id)**: non era la
più grande, era la più **datata** — l'unica voce dell'intero piano che non
riguardava ciò che scriveremo ma ciò che avremmo già pubblicato, e il cui costo
non si misurava in lavoro ma in id di terzi da rinominare. **Chiusa** dalla
[decisione 0021](../decisions/0021-il-confine.md), che è stata pagata al prezzo
previsto: nessuno, perché nessun id di terzi esiste ancora.

In questo scaglione il quinto giro ne aveva messa una terza, la **§4.2 (il
modello parsato in mano ai provider — ora chiusa con la
[decisione 0018](../decisions/0018-chi-vede-il-modello-parsato.md))**, ed era
**scesa** prima di chiudersi: diceva che il
`DocumentModel` non attraversa il contratto in nessuna direzione, e non è vero —
`IndexProvider::on_documents_indexed` lo spinge a ogni indicizzazione. Chi può
stare dentro un indice (task, flashcard, citazioni, chunking) è servito, quindi
la voce non rende inesprimibile niente: rende **stretto** il percorso one-shot,
chi vuole il modello di una nota adesso e non era in ascolto quando è passata. È
il criterio di questo file applicato a sé stesso — inesprimibile sta sopra
stretto — e vale la pena che la retrocessione si veda, perché la voce era stata
messa in cima con una frase che nessuno aveva verificato.

Dal sesto giro se ne aggiungeva una sola dello stesso peso, e stava accanto al
§3.1 per la stessa ragione: **§5.1 (sette varianti su nove di `IndexQuery` non
arrivano a nessun provider)** — **chiusa** con la
[decisione 0019](../decisions/0019-il-canale-dati.md), insieme al resto della
seduta 5. Vale la pena leggerne l'argomento, perché è il criterio di questa
pagina applicato bene: Non allarga una capacità: ne
rende una inesprimibile, e lo fa su un canale che la [decisione 0005](../decisions/0005-canale-dati-verso-le-view.md) ha appena chiamato
«il canale dati verso le view» — grafo, proprietà e salute del vault sono
kernel-owned e non scavalcabili, quindi tutte le famiglie che vorrebbero
estenderli (7.3, 8.2, 7.2, 10, 15.1) hanno una strada sola, il `Custom`, cioè un
vocabolario privato accanto a quello ufficiale che dice la stessa cosa. Sotto,
di poco: **§7.1** e **§6.2**, che non rendevano inesprimibile niente ma
moltiplicavano ogni voce futura — l'una per il numero di implementazioni
dell'host, l'altra per il numero di linguaggi in cui la stessa regola va
scritta. La prima è **chiusa** con la
[decisione 0021](../decisions/0021-il-confine.md), e il moltiplicatore è
sparito: una politica nuova è un `impl Policy` da dieci righe invece di una impl
da ventiquattro metodi. La seconda è **chiusa** con la
[decisione 0020](../decisions/0020-le-regole-in-un-posto-solo.md), insieme al
§6.1: il moltiplicatore resta (le regole condivise sono ancora scritte due
volte) ma non moltiplica più il **rischio**, perché una fixture generata tiene
uguali le due copie e ogni regola nuova nasce con la sua invece che con un
commento. Toglierlo davvero è la fine corsa del §6.2 — `fub-abi` compilato a
wasm32 — e non è urgente proprio perché il presidio c'è.

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
~~**§20.1 (l'alimentazione dell'indice non ha un esito)**~~: `on_document_indexed`,
`on_document_removed` e `reconcile` restituivano `()`, quindi un indice che
perdeva un documento **non aveva modo di dirlo** — e non era ipotetico, era già
scritto nel provider di ricerca, con il commento che spiega perché mentire
sarebbe peggio e nessun valore di ritorno con cui non mentire. Non allargava una
capacità: rendeva inesprimibile «l'indice non ha accettato questa nota», su un
canale che il piano aveva scelto di alimentare dal kernel **proprio** per non
poterla perdere in silenzio. **Chiusa** dalla
[decisione 0051](../decisions/0051-l-alimentazione-risponde.md), che ha
confermato lo statuto e ne ha aggiunto un pezzo che la voce non aveva: la stessa
firma teneva insieme *due* domande — la forma dell'esito e la **grana** della
chiamata — e avevano una risposta sola, l'esito per lotto. Deciderne una avrebbe
lasciato l'altra a una major.

Delle altre tre voci della [seduta 20](20-quando-qualcosa-va-storto.md) non ne
resta nessuna, e vanno lette con un criterio diverso che il settimo giro
aggiunge: **una voce che non scade non sale mai, e per questo il suo costo si
paga tutto adesso**. Nessuna delle tre era una firma — il kernel che scartava
gli esiti che aveva in mano (§20.3) e la variante di evento che il verbale della
[decisione 0013](../decisions/0013-elenco-delle-capacita.md) aveva già deciso e
rimandato per mancanza di clienti (§20.2), entrambe **chiuse** dalla
[decisione 0052](../decisions/0052-cio-che-va-storto-e-un-evento.md); e la shell
che non aveva una superficie dove dire niente (§20.4), chiusa dalla
[decisione 0080](../decisions/0080-un-guasto-si-dice-a-chi-sta-lavorando.md)
— quindi il freeze non le toccava, e nessuna passata precedente aveva un motivo per
guardarle. Ma il conto non era rimandato: erano le voci il cui prezzo si paga in
difetti che non lasciano traccia, e un difetto che non lascia traccia non entra
in nessuna lista di priorità perché nessuno lo ha visto. Averle prese guardandole
invece che aspettando che scadessero è il criterio, e ha prodotto una voce nuova
(§20.5) che nessuno stava cercando — chiusa a sua volta dalla
[decisione 0111](../decisions/0111-il-budget-e-un-tetto-sul-lavoro.md), che ne
ha corretto due premesse: i posti da cui un evento spariva erano quattro invece
di tre, e le due strade che la voce dava per alternative servivano tutt'e due.

Il sesto giro ha applicato quel criterio e ha trovato il secondo caso, **§5.1**,
adesso chiuso con la [decisione 0019](../decisions/0019-il-canale-dati.md).
La forma era la stessa della [decisione 0004](../decisions/0004-il-grafo-e-i-link-non-wiki.md) — una promessa che vale a metà e in silenzio, e
la metà mancante non la scopre chi legge il contratto ma chi prova a usarlo.
Accanto, il criterio proprio di questo giro, da portare avanti allo stesso modo:
alla domanda «cosa manca» e «cosa non mantiene» va aggiunta **«quante volte è
scritto, e da cosa cresce quel numero»** — perché un moltiplicatore non si vede
mentre lo si crea, si vede quando è già stato applicato venti volte.

E il settimo giro ha chiuso il terzo membro della famiglia dei
**moltiplicatori** — quella del §7.1 e del §6.2 qui sopra, le voci che non
rendono inesprimibile niente ma fanno pagare ogni voce successiva. Era il
**§16.4** («il contratto si scrive quattro volte a mano»), chiuso insieme al
§16.5 dalla [decisione 0053](../decisions/0053-il-contratto-ha-una-sorgente.md),
e vale rileggerne l'esito perché è il caso in cui il criterio di questa pagina si
è applicato **al numero stesso**.

La voce chiedeva da quale dei quattro posti generare gli altri tre. Il conto vero
dice che i quattro posti non sono quattro grafie: il WIT e il mirror TS sono
proiezioni su **due confini con due forme diverse** — un evento è
`{"type":"trouble",…}` piatto sull'IPC e un `variant` con il payload in un record
a sé nel WIT — quindi nessuno dei due si genera dall'altro, e l'arena non è una
scrittura dei tipi ma il codice che implementa la scelta di rappresentazione del
WIT. Ma soprattutto: contando i **punti di scrittura** invece dei posti, il
termine più grande non è nessuno dei quattro. Sono i **presidi**, che ripetono
ciò che i quattro dicono già — dieci punti su ventidue, per una variante
additiva. È il criterio del sesto giro (*«quante volte è scritto, e da cosa
cresce quel numero»*) rivolto contro la voce che quel criterio aveva aperto: la
risposta non stava nel generare uno dei quattro, ma nel togliere di mezzo ciò che
li ricopiava. Il moltiplicatore, come per il §6.2, non è azzerato ma
**presidiato** — e per gli `enum` senza payload è sceso da quattro scritture a
due.

Il settimo giro ne ha aggiunta una sesta, e con essa il terzo caso della
famiglia della [decisione 0004](../decisions/0004-il-grafo-e-i-link-non-wiki.md):
**«cosa fallisce senza produrre nessun segnale»**. La promessa che vale a metà,
stavolta, è quella sul silenzio stesso — *«perdite silenziose non esistono per
contratto»* è scritto nell'architettura ed è vero della sola coda eventi.
Cercandola, il presupposto da non dare per buono è che un `Result` restituito sia
un `Result` letto, e che un messaggio scritto sia un messaggio arrivato: i
messaggi che vanno alla console della webview — dove, in un'app impacchettata,
non ha un lettore nessuno — erano **sedici** e oggi sono **zero** [conta: diagnostica-shell]
(il conto diceva tre contando le righe che li *nominano* in un commento),
e quelli che andavano a `stderr` erano
**ventisette** e oggi sono zero in codice di produzione, distribuiti fra due
destinazioni dalla [decisione 0062](../decisions/0062-il-log-e-il-pavimento-l-evento-e-la-porta.md)
(*il log è il pavimento, l'evento è la porta*). (I numeri sono stati ricontati
dalla [decisione 0052](../decisions/0052-cio-che-va-storto-e-un-evento.md), che
li ha trovati scritti a mano in quattro posti con tre valori diversi e nessuno
giusto. **Non si ricontano più a ogni giro**: la
[§16.8](16-crate-sdk-banchi-di-prova.md#168-la-prosa-che-conta-i-sorgenti-non-ha-nessun-presidio)
è chiusa dalla [decisione 0072](../decisions/0072-un-numero-si-scrive-accanto-a-come-si-ricava.md)
e li presidia lei — e il «sedici» di due righe più su è **uno dei numeri che quel
presidio ha trovato invecchiati**, cioè il caso esatto per cui è stato scritto.
Vale la pena tenerlo scritto invece di sostituirlo: la frase che dice quanto un
numero è sceso è vera più a lungo di quella che dice quanto vale.) Il canale
di destinazione è ora costruito per il primo dei due — `Event::Trouble` più il
pavimento del log, con il centro notifiche in ascolto — e con la
[decisione 0080](../decisions/0080-un-guasto-si-dice-a-chi-sta-lavorando.md) lo
è anche per il secondo (§20.4): i quattordici della shell chiamano la stessa
porta, e il salvataggio ha l'esito che non aveva.

**Fuori dai giri**, e con lo statuto delle voci del quarto scaglione — *rende
inesprimibile, non stretto* — ne arrivano due dalla
[decisione 0025](../decisions/0025-la-ricerca-predefinita.md), che non ha cercato
voci: le ha **create**, decidendo cosa l'app deve fare.

**§21.3 (gli estratti sono ancorati allo snippet, non al documento)** — ora
chiusa con la [decisione 0049](../decisions/0049-una-posizione-dentro-un-documento.md):
`DocumentMatch.highlights` erano span *dentro `snippet`*, quindi la ricerca
dentro la nota aperta, il salto all'occorrenza e le occorrenze multiple per nota
non erano strette — non si potevano scrivere. E la destinazione esisteva già:
`ViewUpdate::Reveal` era in repo dal pannello outline e aspettava coordinate che
nessuno poteva produrre, che è la forma più netta in cui una capacità può
mancare — metà del giro c'è, metà è indicibile.

**§21.1 (la tolleranza ai refusi non è dicibile)** — ora chiusa con la
[decisione 0050](../decisions/0050-cosa-si-chiede-a-una-ricerca.md) — si legge al
contrario di come sembra, e per questo stava qui invece che fra le rifiniture. Non è che manchi il
fuzzy: manca il modo di chiedere l'**esattezza**, perché oggi l'esattezza è
implicita, e ciò che è implicito non si può pretendere. Il giorno in cui il
provider comincia a indovinare cominciano a indovinare nello stesso istante
`vault.replace`, le collezioni, i template e le automazioni, e nessuno di loro ha
una parola per dire di no. È la famiglia della
[decisione 0004](../decisions/0004-il-grafo-e-i-link-non-wiki.md) — una promessa
che vale a metà e in silenzio — vista **prima** di farla: l'unica volta in cui
costa una variante invece di una migrazione, e l'unica in cui il criterio di
questa pagina serve a evitare un difetto invece che a ordinarne la riparazione.

**Fuori anche da quelle**, e con lo stesso statuto, ne arriva una terza che non
l'ha portata nessuna decisione: la **§21.10 (il riferimento a un blocco si parsa
e la risposta non ha dove metterlo)**, ora chiusa insieme alla §21.3 con la
[decisione 0049](../decisions/0049-una-posizione-dentro-un-documento.md) —
perché le due chiedevano la stessa primitiva da due firme diverse. Stava qui per
la ragione della
[0004](../decisions/0004-il-grafo-e-i-link-non-wiki.md) — una promessa che vale a
metà e in silenzio — portata al suo caso limite. Nelle altre della famiglia il
pezzo mancava; qui c'è tutto: la sintassi si scrive, il parser la riconosce, il
modello porta l'ancora, `LinkTarget::Wiki` porta il blocco, il mirror TypeScript
lo rispecchia, e poi `IndexResult::Resolved(Option<DocId>)` non aveva dove
metterlo e tutti e cinque i punti che risolvono un wikilink lo scartavano con
`..`. Il risultato era che `[[Nota#^blocco]]` apriva la nota in cima e niente lo
diceva: non una capacità stretta, ma una capacità **costruita e poi troncata
all'ultimo centimetro**, che è il modo peggiore in cui una promessa può essere
falsa, perché ogni indizio disponibile dice che è vera.

E c'è una seconda lezione, che riguarda questa pagina e non quella voce: la riga
di [strozzature.md](strozzature.md) che diceva «nessun `^block-id`» era falsa da
undici verbali, e nessuno l'aveva riletta. Un indice inverso invecchia come tutto
il resto — con l'aggravante che è il posto dove si va a cercare *se una cosa
manca*, cioè quello in cui una riga vecchia non allunga il lavoro: lo dirotta.

## Due voci che stanno qui e restano P2

La **seconda verifica** — quella che ha aperto la
[seduta 22](22-cosa-sa-dire-un-abbonamento.md) — ha confermato la lezione qui
sopra su scala più grande: altre **tre** righe di
[strozzature.md](strozzature.md) erano morte da tempo (le view istanziabili dalla
[0016](../decisions/0016-cosa-e-una-view.md), l'origine degli eventi scritta due
volte e barrata una sola, la grana dell'abbonamento dalla
[0033](../decisions/0033-la-grana-di-un-abbonamento.md)), e a trovarle è stato
qualcuno che quelle righe non le aveva mai lette. Un indice inverso non lo
rilegge chi lo ha scritto.

Ma la parte che appartiene a **questa** pagina è un'altra, ed è il modo in cui
quella lettura si è sbagliata: chiedeva di promuovere la
[§15.1](../decisions/0064-il-supporto-sta-sotto.md) e la
[§15.2](15-il-disco.md#152-durabilità-e-recovery) a P0 perché «sono il pavimento
su cui poggia un capitolo intero e mezzo». La premessa è giusta; la conclusione
confonde i due assi che questa pagina esiste per tenere separati. **La leva non è
la scadenza.** P0 vuol dire *scade col freeze*, e nessuna delle due scade: la
§15.1 è un `trait VaultStorage` interno al kernel e la §15.2 è temp+rename+fsync —
e, dalla [0067](../decisions/0067-il-registro-di-cio-che-e-successo.md), un file
in coda dentro `.fub/`: nessuna delle due è una firma del contratto, e la seconda
non lo è diventata nemmeno crescendo. Che la disciplina avesse già
funzionato lo dimostra la seduta 15 stessa: la sua **unica metà di firma** era la
§15.4 — dove si dichiara la classe di un dato persistito — ed era P0, ed è stata
chiusa dalla [0048](../decisions/0048-una-radice-sola.md) **prima** del freeze,
lasciando indietro solo l'implementazione.

Detto questo, la premessa merita di stare scritta, ed è questo il posto:

**§15.1 (astrazione sullo storage)** — ora **chiusa** con la
[0064](../decisions/0064-il-supporto-sta-sotto.md), e la premessa resta scritta
perché è la ragione per cui la voce contava — rende **inesprimibile**, non stretta, la
cifratura at-rest — che è il capitolo 23.1 quasi per intero: per-note, per-folder,
encrypted fields, encrypted cache, encrypted thumbnails, indice di ricerca
cifrato. Il motivo per cui non può essere un plugin non è che manchi un hook sul
VFS: è che la stratificazione funziona solo se la cifratura sta **sotto**
`data_*` e `vault_*`, dove nessun cliente la vede. Un `VaultStorage` che cifra
non chiede una riga a nessuno; un plugin di cifratura farebbe attraversare il
confine a ogni byte del vault due volte, e l'indice di ricerca — che persiste
attraverso lo spazio dati come chiunque altro — resterebbe in chiaro comunque.
Accanto le stanno 18.1 (sync), 26.3 (PWA su OPFS), 3.1 (vault read-only e su
share di rete) e 2.3 (drive rimovibili): sono cinque famiglie che chiedono
**cinque supporti diversi** allo stesso identico posto.

E c'è un dettaglio che vale come criterio: **il «secure delete» del 23.1 è core
per costruzione del modello di permessi di questo progetto**. Cancellare davvero
una nota vuol dire epurarla dal cestino, dagli snapshot del versioning,
dall'indice e dalle thumbnail — e lo spazio dati di ogni componente è privato e
assegnato dall'host ([0021](../decisions/0021-il-confine.md)), con i tombstone
del versioning che stanno **fuori** da `doc/` per regola scritta
([0044](../decisions/0044-lo-stato-per-documento.md)), cioè apposta perché
sopravvivano al documento. Un plugin «secure delete» non può raggiungere quegli
snapshot nemmeno volendo. O lo fa il core, o è una promessa con sopra una UI.

**§15.2 (durabilità e recovery)** rende inesprimibile una promessa diversa:
l'atomicità di scritture che non si eseguono. Il 24.2 chiede atomic writes,
journaling, crash recovery, autosave e corruption detection, e nessuna delle
cinque può essere un componente perché la correttezza di **tutti gli altri**
poggia sopra. Delle cinque ne restava fuori una sola quando la voce si è chiusa,
ed è la **corruption detection** — che non è di qui, e adesso nemmeno per metà:
la versione di schema del §15.3 è chiusa con la
[0106](../decisions/0106-un-formato-si-presenta.md), che ha misurato quanto
poco le due domande si somiglino — un numero di schema dice quale formato sono
quei byte, non se sono integri —, quindi la corruption detection è **tutta** del
24.2. Le altre quattro: la prima
con la
[0065](../decisions/0065-una-scrittura-o-c-e-o-non-c-e.md), che l'ha messa dentro
il supporto che la 0064 aveva appena costruito — e con la
[0066](../decisions/0066-un-aggiornamento-non-e-una-scrittura.md) l'atomicità vale
anche per un **aggiornamento** e non solo per una scrittura —, la seconda con la
[0067](../decisions/0067-il-registro-di-cio-che-e-successo.md), e le due rimaste
— **crash recovery** e **autosave**, che erano poi la stessa casella — con la
[0088](../decisions/0088-cio-che-non-e-ancora-successo.md). Il caso più netto
non stava nemmeno nel 24: era il 22.4, che promette al centro di comando LLM la
«transazione atomica per operazione batch» e il «rollback completo». Quel capitolo
è per il resto un cliente del registro dei comandi e sta benissimo come plugin —
quelle due righe però le poteva mantenere solo il journal, perché il lotto della
[0011](../decisions/0011-il-lotto.md) coalizza gli eventi e **non** è una
transazione, e sta scritto nel suo stesso verbale. Adesso il journal c'è, e ciò che
resta di quelle due righe non è più inesprimibile: è **da scrivere**, che è un'altra
categoria — chi ripercorre il registro all'indietro compone `UndoStep`
([0045](../decisions/0045-l-undo-ha-due-pile.md)) e trova nella riga tutto ciò che
gli serve. È la prima volta che una voce di questa pagina scende da *inesprimibile*
a *da fare* senza che il cliente sia stato scritto: la leva si misura su cosa si
**può** dire, e dirlo è bastato.

Entrambe erano **P2** mentre erano aperte, e le due cose non erano in
contraddizione: è esattamente la frase con cui questa pagina si apre. Adesso sono
chiuse tutte e due, e questa pagina le tiene perché **la premessa resta vera** —
è la ragione per cui contavano, non un residuo di lavoro. La §15.1 è stata poi presa **da P2**,
senza essere promossa e senza che il freeze c'entrasse, il giorno in cui non
c'erano più P0 aperte: è la prima volta che a scegliere è stata la leva e non la
scadenza, che è ciò per cui questa pagina esiste. E la seconda volta è stata
mezza §15.2, il turno dopo, per la stessa ragione e con un'aggiunta che vale come
criterio: **a scegliere è stata anche la voce già fatta**. La 0064 aveva lasciato
scritto cosa sarebbe sceso dentro quella funzione, e una voce che ne aspetta
un'altra scritta nero su bianco costa meno se la si prende subito — dopo, il
posto preparato per lei bisogna ricostruirsi il perché era preparato.

E la terza volta è la riga che restava di quella metà, chiusa dalla
[0066](../decisions/0066-un-aggiornamento-non-e-una-scrittura.md), che aggiunge
al criterio una cosa che le prime due non avevano: **la leva di una voce non si
misura dal codice che chiede**. Il lock è quattro righe; il suo prezzo è un MSRV
alzato, cioè una promessa verso chi compila. Una voce che costa poco a scrivere e
molto a decidere sta in questa pagina come una che costa il contrario, e chi
ordina il lavoro guardando la dimensione del diff le vede tutte e due sbagliate.

E la **quarta** è il journal, con la
[0067](../decisions/0067-il-registro-di-cio-che-e-successo.md), presa per la
ragione più esplicita delle tre: sotto ci stavano quattro promesse fatte altrove —
17.3, 16.3, 23.3 e le due righe del 22.4 — che nessuna quantità di lavoro nei
rispettivi capitoli avrebbe reso vere, perché non erano strette, erano
**indicibili**. Quella è la prima riga di questa pagina, ed è la prima volta che a
sceglierla è stata la nota che le due voci precedenti avevano lasciato scritta in
fondo al proprio verbale: *«ciò che resta è recovery»*. Una voce che si è già
divisa da sé, in due decisioni di fila, dice a chi arriva dopo quale pezzo
prendere — che è la 0064 letta a scala di voce invece che di casella.

E la **quinta** chiude la §15.2, con la
[0088](../decisions/0088-cio-che-non-e-ancora-successo.md). È la volta in cui il
criterio si è visto meglio, perché è quella in cui è stato **applicato al
contrario**: le due caselle rimaste erano state scritte prima del supporto, della
scrittura atomica e del journal, e rileggerle contro quel codice ha detto che una
delle due chiedeva una cosa **diventata impossibile nel modo in cui la
chiedeva**. `vault_health` non era da spostare nel registro: era già una query, e
una lettura non è un comando. Il criterio delle prime quattro dice quale voce
prendere; questa aggiunge cosa farne quando la si è presa — **una voce ferma non
si esegue, si rimisura**, perché ciò che aspettava può essere caduto e ciò che
manca può non essere scritto nella voce. È la stessa lezione della
[0087](../decisions/0087-il-testo-che-sta-dentro-gli-allegati.md), arrivata da
una seduta diversa a un turno di distanza: due volte di fila, quindi non un
caso.

E la **sesta** è la §18.1, con la
[0089](../decisions/0089-da-cosa-e-partita-una-scrittura.md), presa come P1 più
grossa fra le rimaste e con un criterio che le cinque prima non avevano: **due
caselle che si pagano una volta sola**. Dare una base a `write_document` chiude
un difetto vecchio — il salvataggio dell'editor copriva una scrittura altrui che
il watcher non aveva visto — *e* rende calcolabile la base delle bozze, che la
0088 aveva dovuto lasciare a «non lo so» un turno prima, per iscritto, perché
ricalcolarla di là dal confine sarebbe stata una seconda verità. Il secondo
effetto non era ottenibile lavorando sulla 0088: quel verbale l'aveva già
guardato e aveva potuto solo scriverne il limite. Una voce che **sblocca il
residuo dichiarato di quella prima** vale più della somma delle due, e la somma
è ciò che una tabella di priorità sa vedere.

E la rimisurazione è arrivata per la **terza** volta di fila, con un modo nuovo:
la 0087 e la 0088 avevano trovato che ciò che la voce aspettava era **caduto**;
qui ciò che la voce chiedeva era stato **deciso di no** — la prima casella
nominava un canale verso la webview che la
[0018](../decisions/0018-chi-vede-il-modello-parsato.md) ha stabilito che non ci
sarà. È una specie diversa di obsolescenza e si trova solo nello stesso modo:
rileggendo la voce contro i verbali venuti dopo di lei. Una voce è sempre più
vecchia del verbale che la contraddice, e non ha modo di saperlo da sé.

E la **settima** è la §23.5, con la
[0095](../decisions/0095-cosa-guardo-e-cosa-sto-scrivendo.md), ed è la prima
volta che a scegliere è stato un **ordine scritto dentro una voce**. Le sei prima
erano state prese perché la leva le metteva in cima, o perché una voce già fatta
diceva quale pezzo prendere; questa perché portava una frase — *va decisa prima
della §23.3* — che nessuna tabella di priorità sa leggere, essendo una relazione
fra due righe e non una proprietà di una. Le P0 erano finite col turno prima, e
in un giro in cui la scadenza non ordina più niente **l'unica cosa che ordinava
era quella frase**. Vale come criterio: una voce che dichiara di dover venire
prima di un'altra si è già data una priorità, e sta a chi ordina il lavoro
accorgersi che l'ha fatto — perché è scritta nel posto in cui nessuno la cerca,
cioè dentro la voce e non nella colonna.

E c'è una seconda cosa, che riguarda questa pagina più della precedente. La §23.5
è la voce che ha **fondato la quinta specie** — quella che compone invece di
moltiplicare — e chiuderla ha detto che la composizione era vera e la
descrizione no. Presa da sola non era «innocua perché chi legge la selezione non
ha dove mandarla»: era innocua perché chi la legge oggi è un plugin nativo, che
gira in-process e non ha bisogno di leggerla dal contratto per averla. La rete non
crea il difetto, lo rende **imponibile a qualcuno che prima non lo era** — un
componente sotto sandbox. È una correzione piccola e cambia cosa cercare: le voci
della quinta specie non si trovano chiedendo *cosa diventa possibile*, ma *a chi
diventa possibile*.

E la **rimisurazione** è arrivata per la quinta volta di fila, con il raccolto
più grosso: **tre premesse su tre** cadute, e per la prima volta una che rendeva
la voce **peggiore** invece che più piccola. Le quattro volte prima avevano
trovato cose che si erano svuotate — un bloccante caduto, una richiesta decisa di
no, un banco che vedeva. Qui la [0093](../decisions/0093-le-selezioni-sono-n-e-il-buffer-e-uno.md)
aveva moltiplicato per N il flusso che la voce descriveva al singolare, tre
commit prima e senza che nessuna delle due se ne accorgesse. **Una voce ferma non
diventa solo obsoleta: può diventare più urgente stando ferma**, e il turno che
la rilegge è l'unico posto in cui questo si vede.

E l'**ottava** è la §23.10, con la
[0096](../decisions/0096-una-bozza-non-e-una-nota.md), che a scegliere ha avuto
lo stesso criterio della settima e ne ha scoperto il limite. La §23.10 portava
**due** frasi d'ordine e non una — *va decisa insieme alla §23.5 e prima della
§23.3* — e la prima delle due era già saltata: la 0095 aveva chiuso la §23.5 da
sola, un turno prima, onorando l'ordine che la §23.5 dichiarava di sé e non
vedendo quello che un'altra voce dichiarava su di lei. La §23.10 lo aveva
previsto per iscritto (*«le due si decidono insieme o si decidono due volte»*), e
si sono decise due volte.

Il criterio che ne esce è la settima con un pezzo in più, e il pezzo costa poco:
**un ordine scritto in una voce va cercato anche nelle voci che la nominano**,
non solo in quella che si sta per fare. Una relazione fra due righe la scrive
una delle due, e non c'è nessuna regola che dica quale — la §23.5 diceva *prima
della §23.3* e la §23.10 diceva *insieme alla §23.5*: chi apriva la prima non
aveva motivo di leggere la seconda. Il costo è stato piccolo qui, perché le due
metà si sono comunque decise a un commit di distanza e la seconda ha potuto
correggere la prima invece di ripeterla — la casella che voleva un permesso solo
per tutt'e due è l'unica della §23.10 che non ha retto. Ma la forma dell'errore
è la stessa che questa pagina esiste per vedere: **una relazione fra due voci non
è di nessuna delle due, quindi non la legge nessuno.**

**E non c'è una nona volta, il che è a suo modo il risultato.** Il turno dopo ha
chiuso la §23.3 con la
[0097](../decisions/0097-un-recinto-che-vale-anche-quando-nessuno-guarda.md), e a
ordinarlo è stato di nuovo un ordine scritto — ma è **la stessa relazione** che
l'ottava ha già analizzato, letta dal capo opposto: *prima della §23.3* vista da
chi finalmente arriva alla §23.3. Contarla sarebbe contare due volte una
relazione sola, che è precisamente il **doppione** che [todo.md](../todo.md)
nomina come rischio di questa strada. Questa pagina conta le volte in cui la leva
ha scelto **contro** l'ordine che un altro criterio avrebbe dato; qui non ha
scelto niente, ha **eseguito**.

Ciò che invece va registrato è che il criterio corretto dall'ottava ha
funzionato al primo giro utile. La lezione era *un ordine scritto in una voce va
cercato anche nelle voci che la nominano*: la 0097 è arrivata per terza, dopo
0095 e 0096, e ha trovato i due cancelli già montati. **Un criterio si verifica
il turno in cui non produce nessun aneddoto**, e l'ottava volta è l'ultima che
questa relazione doveva generare.

## La terza verifica, e le tre voci che ne escono

La [seduta 23](23-cosa-costano-le-decisioni-chiuse.md) è la prima che non ha
guardato il repo né un'affermazione arrivata da fuori: ha guardato **i verbali**,
con la domanda che questa pagina fa di mestiere applicata a un soggetto nuovo —
non *quale voce conta di più per il sistema* ma **cosa una decisione presa bene
costa a chi usa l'app**. Le tre voci che ne escono si ordinano fra loro col
criterio di sempre, e cadono in tre scaglioni diversi.

**§23.3 (la rete)** — *chiusa dalla
[0097](../decisions/0097-un-recinto-che-vale-anche-quando-nessuno-guarda.md)* —
stava nel primo, quello del *rende inesprimibile*, e ci stava
senza sfumature: non c'era nessun modo di scrivere un plugin che parlasse con
qualcosa fuori dal disco. Sotto ci stanno 18 (sync), 14.2 (clipper), 22 (AI e
RAG), 15.1 (citazioni), 13.4 (trascrizione) — cioè la famiglia più grande fra
quelle che non hanno **nessuna** strada. Ma la ragione per cui sta in questa
pagina non è la dimensione: è che l'assenza **non si vede**. Un plugin di sync
non si scrive fino a metà e poi si blocca contro una firma mancante; non lo prova
nessuno, e il buco non lascia traccia — che è il modo in cui una capacità può
mancare senza che nessuna riga di codice lo dica. E il no che la teneva fuori era
scritto nella forma migliore possibile, con **due bloccanti nominati**: sono
caduti tutti e due, in due sedute che non sapevano di toccarli.

Chiudendola si è visto che il primo scaglione ha un rovescio che questa pagina
non aveva scritto: **una voce che rende inesprimibile qualcosa è anche quella
che, entrando, rende esprimibili tutte le altre in una volta**. La rete non ha
sbloccato una feature, ne ha sbloccate sei — e ha reso operativi, nello stesso
commit, i due permessi che 0095 e 0096 avevano messo *in previsione* di lei. Il
primo scaglione non è quindi solo il più urgente: è il più **denso**, e ordinarlo
per dimensione del buco lo sottostima.

**§23.2 (l'invariante dei terzi)** sta nel secondo, quello dei
**moltiplicatori**, e in una posizione che nessun altro membro di quella famiglia
ha avuto: non moltiplica il lavoro, moltiplica ciò che si dà per scontato. Il
§7.1 e il §6.2 facevano pagare ogni voce successiva; questa fa **credere** a ogni
voce successiva che la superficie di scrittura sia raggiungibile da un terzo,
perché è ciò che l'invariante del progetto dice. Sei decisioni l'hanno resa falsa
una alla volta, ognuna per una ragione buona e sua, e nessuna delle sei aveva il
compito di accorgersene. È la [0054](../decisions/0054-il-banco-del-lato-provider.md)
letta al rovescio: là una garanzia dichiarata non era mai esistita, qui una
garanzia esiste davvero e vale su tutto tranne dove serve di più.

**Chiusa dalla [0104](../decisions/0104-la-superficie-di-scrittura-si-presta.md)**,
e la diagnosi qui sopra era **sbagliata**: non sei decisioni che rendono falso
l'invariante una alla volta — riletti contro la domanda giusta, quattro dei sei
verbali non sfiorano nemmeno il caso e uno lo **concede per iscritto** — ma
**due assenze che nessuno ha mai deciso**: nel contratto non esiste nessun evento
di tastiera, e `Html`/`WebView` sono riservati a `Trust::Core` per ragioni che
riguardano il contenuto attivo e non l'editing. Il posto nel secondo scaglione
regge, il meccanismo no, e la differenza è utilizzabile: una decisione si discute,
un'assenza non si trova — cercare un moltiplicatore fra i verbali lo fa vedere
solo se qualcuno l'ha scritto, e qui il moltiplicatore stava nel **vuoto** fra
uno e l'altro. Per questo la chiusura non ha toccato una firma: ha dato al metro
di [plugin-boundary.md](../architecture/plugin-boundary.md) una quarta voce — *se
la superficie esiste* — perché un metro che sa pesare solo un costo non ha modo
di nominare chi non passa per assenza di porta.

**§23.1 (la rinomina ad app chiusa)** non sta in nessuno dei due, ed è il primo
caso in cui questa pagina deve aggiungere un criterio invece di applicarne uno:
non rende inesprimibile niente e non moltiplica nessuna voce futura — **il conto
lo paga l'utente, una volta, in silenzio, e non se lo può accorgere**. Chi sposta
le proprie note con un altro strumento, che è la libertà che questo progetto
promette per iscritto, perde ciò che Fub aveva costruito per quelle note. È la
famiglia della [0004](../decisions/0004-il-grafo-e-i-link-non-wiki.md) — *una
promessa che vale a metà e in silenzio* — con la differenza che decide dove va
messa: là la promessa era falsa dentro l'app e la si scopriva usandola, qui è
falsa **fuori** dall'app, dove nessun test guarda e nessun evento arriva. Il
costo cresce con l'attesa per una ragione sua, che non è quella del §17.1: ogni
derivato per-path nuovo eredita il difetto, e da quando la
[0044](../decisions/0044-lo-stato-per-documento.md) lo ha dichiarato per la prima
volta ne sono nati due.

**Chiusa dalla [0099](../decisions/0099-una-rinomina-che-non-ha-visto-nessuno.md)**,
e il criterio che aveva costretto ad aggiungere resta — anzi, chiudendola si è
visto anche il suo rovescio: la stessa rilettura ha trovato, in una riga
*adiacente* a quella da cambiare, un difetto della stessa specie e più grave (una
raccolta che girava su un'anagrafe parziale). **Il conto che paga l'utente in
silenzio non si trova cercandolo dove è stato dichiarato**, perché il posto in cui
si dichiara è quello in cui qualcuno se n'era accorto: si trova leggendo cosa sta
attorno.

E una nota di metodo che vale più delle tre voci. Questa pagina ordina ciò che
**resta da fare**; la seduta 23 dice che c'è un secondo posto in cui la leva si
accumula senza che nessuno la misuri, ed è il *«cosa resta scoperto»* in fondo a
ogni verbale. Lì un prezzo si scrive una volta, in una riga, dentro un documento
che per disciplina non si riscrive più — e nessuno lo somma con gli altri. Le tre
voci di quella seduta erano tutte scritte, ognuna nel suo verbale, da mesi.

**§23.4 (una selezione sola) sale sopra tutte, e per il criterio in testa a
questa pagina** — *chiusa dalla
[0093](../decisions/0093-le-selezioni-sono-n-e-il-buffer-e-uno.md), in tempo:
`selections: option<selection-set>`, e la scadenza che questo paragrafo descrive
non è mai arrivata*. Non era la voce più importante di quella seduta — la §23.5 tocca
la privacy e la §23.1 tocca ciò che l'utente perde — ma è l'unica che rende una
capacità **inesprimibile per sempre invece che oggi**. La differenza è tutta nel
verso in cui scade: ogni altra voce di questa pagina descrive qualcosa che non si
può fare *finché non la si fa*, e il giorno che la si fa il debito si azzera. Il
tipo di un campo di un record pubblicato, no: dopo M4 il multi-cursore non è più
una voce di roadmap, è una **major** — cioè la stessa cosa che il presidio della
[0002](../decisions/0002-additivita-del-contratto.md) esiste per impedire, ed è
significativo che a scriverla sia stato lo stesso verbale che ne enuncia il
criterio meglio di chiunque. È il caso più puro della quarta specie di leva —
*ciò che è già pubblicato* — e l'unico in cui costava un'ora allora e una
versione dopo. Che sia stata pagata l'ora e non la versione è la sola prova che
questa pagina abbia mai prodotto di essere servita a qualcosa: il criterio l'ha
portata in cima, ed è arrivata prima del freeze.

**§23.5 (il testo selezionato senza permesso) è di una quinta specie, che questa
pagina non aveva.** Non rende inesprimibile e non moltiplica: **compone**. Presa
da sola è innocua per una ragione che non sta scritta in nessuno dei due verbali
che la creano — chi legge la selezione non ha dove mandarla — e quella ragione è
un'altra voce, la §23.3, che questa stessa roadmap ha poi chiuso. Due
decisioni giuste, in due sedute che non si sono mai incontrate, il cui prodotto è
il difetto. **Il prodotto è stato guardato prima invece che dopo**, ed è l'unica
volta in questa seduta: quando la
[0097](../decisions/0097-un-recinto-che-vale-anche-quando-nessuno-guarda.md) ha
dato a un plugin dove mandare le note dell'utente, le due cose che più valeva non
fargli leggere avevano già un permesso proprio da due commit. Vale come criterio e non come voce: **una leva può stare nel prodotto
di due righe e in nessuna delle due**, e l'unico modo di vederla è leggerle
insieme — che è precisamente ciò che nessuna delle due sedute aveva motivo di
fare.

## La quinta specie non era un caso singolo

Il terzo giro della stessa verifica — tutti e novanta i verbali, con una lente
dichiarata: *qualità, libertà, privacy* — ha portato otto voci, e la cosa che
questa pagina deve registrare non è il numero. È che **tre delle otto hanno la
forma della §23.5**, cioè quella che due paragrafi fa era «una quinta specie che
questa pagina non aveva» e un caso solo. Tre su otto in un giro non è una specie
nuova: è una **famiglia**, e va cercata apposta invece che incontrata.

- **§23.10 (le bozze leggibili da chiunque legga il vault)** — *chiusa dalla
  [0096](../decisions/0096-una-bozza-non-e-una-nota.md)* — compone con la
  §23.3 — *chiusa a sua volta dalla
  [0097](../decisions/0097-un-recinto-che-vale-anche-quando-nessuno-guarda.md)* —,
  e lo fa esattamente come la §23.5, al punto che le due voci vanno decise
  insieme o si decidono due volte, ed è ciò che è successo. La [0088](../decisions/0088-cio-che-non-e-ancora-successo.md)
  nega la scrittura *per sempre* perché quel testo è il dato più privato del vault,
  e concede la lettura sul canale di tutti con un argomento — *leggere non è
  cambiare* — che protegge l'integrità mentre la minaccia è la riservatezza. Ogni
  metà è difendibile; il prodotto è che il permesso di leggere una nota salvata è
  anche il permesso di leggere ciò che l'utente sta scrivendo adesso.
- **§23.13 (un vault che rimappa la tastiera)** — *chiusa dalla
  [0100](../decisions/0100-i-tasti-che-arrivano-da-fuori.md)* — è la coppia più netta, perché le
  due metà distano pochissimo: la [0076](../decisions/0076-le-impostazioni-vivono-nel-vault.md)
  ha smontato l'argomento di rischio sulle impostazioni del vault — e su tema e
  lingua aveva ragione — e la [0077](../decisions/0077-una-scorciatoia-e-una-chiave.md)
  ha messo in quel posto i **tasti**, senza riesaminare l'argomento smontato ora
  che l'oggetto era cambiato. Nessuno dei due verbali sbaglia. La fiducia che
  aprire un vault altrui richiede è cresciuta fra l'uno e l'altro, e non l'ha
  dichiarato nessuno. Adesso la dichiara chi la richiede: un tasto che questa
  macchina non ha mai visto arriva **sospeso**, e la risposta si dà una chiave
  alla volta.
- **§23.11 (la base facoltativa)** — *chiusa dalla
  [0092](../decisions/0092-una-base-si-dichiara.md)* — componeva con la
  [0030](../decisions/0030-il-rilevamento-si-puo-chiedere.md): la guardia contro
  la sovrascrittura era opt-in **proprio dove** il rilevamento delle modifiche
  esterne non c'è. Era anche l'unica delle tre a stare contemporaneamente nella
  quarta specie, *ciò che è già pubblicato*, ed è per questo che era P0 mentre le
  altre due no. Adesso `base` è un `WriteBase` a due casi nominati: scrivere
  ciechi resta possibile e smette di essere ciò che succede omettendo.

**Cosa cambia per chi usa questa pagina.** Le prime quattro specie si trovano
guardando una voce e chiedendosi cosa impedisce. La quinta non si trova
guardando: si trova **incrociando**, e il costo è quadratico nel numero di
verbali — che è la ragione per cui i primi due giri non ne avevano trovata
nessuna leggendo in fila, e il terzo ne ha trovate tre leggendo tutto insieme. Il
criterio pratico che ne esce è più stretto e utilizzabile: **quando un verbale
smonta un argomento di rischio, quell'argomento va riletto ogni volta che
qualcuno mette una cosa nuova nel posto che quel verbale ha aperto.** La 0076 ha
aperto un posto; sei verbali dopo ci sono finiti dentro i tasti.

E una voce della terza specie, quella che la §23.1 ha inaugurato — *il conto lo
paga l'utente, una volta, in silenzio*: **§23.9 (il registro non si spegne)**. Un
file dentro il vault, in chiaro, non spegnibile e senza un comando che lo
cancelli, che per le modifiche chirurgiche porta i byte sostituiti e li tiene
**dopo** che la nota da cui vengono è stata cancellata — finché non li spinge
fuori il tetto dei diecimila record, che è una scadenza legata a quanto si
scrive, non a cosa si vuole far sparire. Sta qui e non fra le
prime due specie per la stessa ragione della §23.1: non rende inesprimibile
niente e non moltiplica nulla: semplicemente, chi cancella qualcosa credendo di
averla fatta sparire si sbaglia, e non ha modo di accorgersene.

**Chiusa dalla [0103](../decisions/0103-un-registro-dice-cosa-e-successo.md)** —
`Edited` porta l'impronta e non più l'inverso, il registro tiene una finestra
dichiarata e c'è un comando che lo svuota — e la chiusura conferma il criterio
per la seconda volta, dal lato del **prezzo**: la voce chiedeva di soppesare
quanto valesse l'annullamento che si perdeva, e misurarlo ha detto che
l'annullamento non passava di lì, che il suo unico consumatore era un test e che
la facoltà temuta non era mai stata esercitata. **Un conto che l'utente paga in
silenzio si scopre spesso essere pagato per niente**: la contropartita che ne
giustificava il prezzo era anche lei dichiarata e mai riscossa, e nessuna delle
due righe lo diceva perché nessuno le aveva lette insieme.
