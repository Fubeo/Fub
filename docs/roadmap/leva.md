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
Ora il contratto le nomina; **ospitarle** tutte è un'altra cosa, ed è il modello
di layout del §1.2.
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

Delle altre tre voci della [seduta 20](20-quando-qualcosa-va-storto.md) ne
restano **due**, e vanno lette con un criterio diverso che il settimo giro
aggiunge: **una voce che non scade non sale mai, e per questo il suo costo si
paga tutto adesso**. Nessuna delle tre era una firma — il kernel che scartava
gli esiti che aveva in mano (§20.3) e la variante di evento che il verbale della
[decisione 0013](../decisions/0013-elenco-delle-capacita.md) aveva già deciso e
rimandato per mancanza di clienti (§20.2), entrambe **chiuse** dalla
[decisione 0052](../decisions/0052-cio-che-va-storto-e-un-evento.md); e la shell
che non ha una superficie dove dire niente (§20.4), che resta aperta — quindi il
freeze non le toccava, e nessuna passata precedente aveva un motivo per
guardarle. Ma il conto non era rimandato: erano le voci il cui prezzo si paga in
difetti che non lasciano traccia, e un difetto che non lascia traccia non entra
in nessuna lista di priorità perché nessuno lo ha visto. Averle prese guardandole
invece che aspettando che scadessero è il criterio, e ha prodotto una voce nuova
(§20.5) che nessuno stava cercando.

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
un `Result` letto, e che un messaggio scritto sia un messaggio arrivato: nel repo
di oggi **quattordici** messaggi vanno alla console della webview e nessuno ha un
lettore in un'app impacchettata — quelli che andavano a `stderr` erano
**ventisette** e oggi sono zero in codice di produzione, distribuiti fra due
destinazioni dalla [decisione 0062](../decisions/0062-il-log-e-il-pavimento-l-evento-e-la-porta.md)
(*il log è il pavimento, l'evento è la porta*). (I numeri sono stati ricontati
dalla [decisione 0052](../decisions/0052-cio-che-va-storto-e-un-evento.md), che
li ha trovati scritti a mano in quattro posti con tre valori diversi e nessuno
giusto: finché la [§16.8](16-crate-sdk-banchi-di-prova.md#168-la-prosa-che-conta-i-sorgenti-non-ha-nessun-presidio) non li presidia, si ricontano a ogni giro.) Il canale
di destinazione è ora costruito per il primo dei due — `Event::Trouble` più il
pavimento del log, con il centro notifiche in ascolto — e resta da costruire per
il secondo (§20.4).

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
poggia sopra. Delle cinque **due** sono fatte: la prima con la
[0065](../decisions/0065-una-scrittura-o-c-e-o-non-c-e.md), che l'ha messa dentro
il supporto che la 0064 aveva appena costruito — e con la
[0066](../decisions/0066-un-aggiornamento-non-e-una-scrittura.md) l'atomicità vale
anche per un **aggiornamento** e non solo per una scrittura —, la seconda con la
[0067](../decisions/0067-il-registro-di-cio-che-e-successo.md). Il caso più netto
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

Entrambe restano **P2**, e le due cose non sono in contraddizione: è esattamente
la frase con cui questa pagina si apre. La §15.1 è stata poi presa **da P2**,
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
