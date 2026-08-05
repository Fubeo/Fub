# 0104 — La superficie di scrittura si presta, e un invariante che non sa dove finisce è una scusa

**Stato**: accolta
**Data**: 2026-08-05
**Chiude**: [§23.2](../roadmap/23-cosa-costano-le-decisioni-chiuse.md#232-linvariante-dei-terzi-ha-una-seconda-eccezione-e-non-è-scritta)
**Commit**: *(questo commit)*

---

## La domanda

L'invariante di questo progetto è *«una feature ufficiale è ciò che scriverà un
plugin di terzi»*. La [0017](0017-chi-disegna-cio-che-il-core-non-conosce.md) la
cita come il punto in cui era **già falsa una volta** — un'estensione di sintassi
non poteva essere un plugin — e l'ha resa vera dando al terzo la propria strada
invece della nostra.

La §23.2 sostiene che sia falsa una seconda volta, e che stavolta nessuno l'abbia
scritto. La tesi: sei verbali hanno costruito la superficie di scrittura e
ognuno, per una ragione buona e sua, l'ha messa dalla parte della shell; sommati
dicono che **un terzo non può portare un'altra esperienza di scrittura, può solo
decorare la nostra**, e questa frase non sta scritta da nessuna parte.

La domanda operativa che la voce pone è una sola, e non è tecnica: *«l'editor è
della shell» vuol dire **questo editor** o **l'editing**?*

## Cosa la misura ha cambiato, prima di progettare

Tre cose, e la prima ribalta la diagnosi.

**Le sei decisioni non sono la barriera.** Rilette una per una contro la domanda
giusta — *quell'argomento vale contro un terzo che porta la propria superficie, o
solo contro un terzo che tocca la nostra?* — quattro delle sei non arrivano
nemmeno a sfiorare il caso, e una lo **concede per iscritto**:

- la [0018](0018-chi-vede-il-modello-parsato.md) scrive «un buffer aperto e non
  salvato non lo conosce nessuno al di qua del confine: **chi disegna un editor
  tiene il proprio testo**». Non nega la superficie di terzi: descrive esattamente
  come funzionerebbe;
- la [0045](0045-l-undo-ha-due-pile.md) è neutrale per costruzione — dice «due
  soggetti, due pile», non «l'editor è nostro»; un terzo con la propria superficie
  avrebbe la propria pila, e il punto d'incontro (`WriteBase` → `Conflict`)
  funziona identico su un buffer che non è nostro;
- la [0082](0082-una-porta-per-chi-cerca.md) **esclude l'editing dal proprio
  campo** in una riga esplicita: vincola le superfici della shell a non farsi un
  secondo motore di ranking, e il trova/sostituisci lo lascia fuori dicendo che
  «è editing»;
- la [0088](0088-cio-che-non-e-ancora-successo.md) — la più difendibile delle sei
  — protegge la bozza *altrui*: nessun plugin deve poter scrivere nel testo non
  salvato di un altro. Un terzo che porta la propria superficie scriverebbe le
  **proprie** bozze, e l'argomento non lo raggiunge.

Restano la [0078](0078-i-riquadri-sono-un-fatto-della-shell.md) e la
[0090](0090-una-sequenza-e-una-modalita-che-scade.md), e nemmeno quelle chiudono
la porta: la casella della 0078 che chiedeva «un riquadro che tenga una *view* e
non solo tab di documenti» **è stata chiusa dalla
[0079](0079-il-grafo-esce-dall-overlay.md)**, cioè la strada che la voce dice
esistere esiste davvero; e la 0090 dichiara che inventare una modalità «è un
progetto suo e non è questa voce», cioè scarta la domanda invece di rispondere.

Quindi la somma che la voce accusa **non c'è**. Nessuno ha deciso di negare la
superficie di scrittura a un terzo: è una cosa diversa, ed è la seconda scoperta.

**Ciò che impedisce l'editing di terzi sono due assenze, e nessuna è stata
decisa.** La prima è la più netta e si misura con un `grep` che torna vuoto: nel
contratto **non esiste nessun evento di tastiera** — non un `KeyEvent`, non una
`key`, niente. Un provider riceve `UiAction`, cioè un gesto già interpretato da
qualcun altro, e sotto una superficie di scrittura l'interpretazione *è* il
lavoro. La seconda: `UiNode` è dichiarativo per costruzione, `TextInput` e
`TextArea` non hanno cursore né selezione, e `Html`/`WebView` sono riservati a
`Trust::Core` — la via d'uscita che un terzo userebbe per disegnarsi la propria
superficie è chiusa a chiave, per ragioni che riguardano il **contenuto attivo** e
non l'editing.

Un'assenza non è una decisione, e la differenza conta: una decisione si discute,
un'assenza non si trova. Ecco perché la riga non era scritta.

**Il metro non aveva una voce in cui scriverla, e questo è il difetto peggiore —
fuori dalla voce, per la quinta volta di fila.** In
[plugin-boundary.md](../architecture/plugin-boundary.md) c'è il posto dove uno che
si chiede *«posso scrivere un plugin che fa X?»* va a guardare: il metro a tre
voci, che si dichiara esaustivo con una riga sola — *«chi inciampa in **una sola**
delle tre non può essere solo un guest»*. Le tre voci sono posizione rispetto al
prestito, frequenza × payload, prima o dopo la scrittura.

Un editor di terzi **non inciampa in nessuna delle tre**. Non tiene il vault più a
lungo di una view qualunque, non attraversa il confine più spesso, non ha bisogno
di interporsi prima della scrittura. Passa il metro, e resta impossibile.

Il metro pesa un **costo**, e queste sono assenze di **superficie**: un metro che
sa dire solo «quanto costa» non ha modo di nominare chi non passa perché non c'è
una porta, e allora quel caso non risulta da nessuna parte — non vietato, non
caro, non impossibile, semplicemente non previsto. Si scopre scrivendolo.

## La decisione

**«L'editor è della shell» vuol dire *questo* editor, non *l'editing*. La
superficie si presta.**

Un terzo che porti la propria esperienza di scrittura — una modalità modale, un
editor strutturato, una tela — è un **cliente previsto**, non un abuso. La strada
che percorrerà è quella che esiste già: `ViewSurface::Main`, ospitata dalla 0079;
un riquadro che tiene una tab di view; il `pane` del `ViewContext` dalla
[0007](0007-contesto-di-sessione.md) per sapere dove sta; le selezioni dalla
[0093](0093-le-selezioni-sono-n-e-il-buffer-e-uno.md); `VaultWrite::apply_edit`
per scrivere il testo. Più le due porte che mancano, che si aprono in modo
**additivo** — un evento di tastiera è un tipo nuovo, non un tipo cambiato.

Questa è la risposta che costa di più delle due, ed è scelta apposta. L'altra —
«l'editing è della shell, punto» — sarebbe stata più facile da mantenere e avrebbe
reso *nostri da fare* interi capitoli di FEATURES che oggi si possono immaginare
di terzi. Ma avrebbe anche reso false, in un colpo, le righe con cui questo repo
descrive sé stesso: *«stessa strada per feature native e plugin di terzi»*, *«sono
la strada che percorrerà un plugin di terzi»*, *«girano con ciò che avrà un plugin
di terzi — il contratto e nient'altro»*. Un progetto che scrive quelle frasi e poi
tiene per sé la superficie su cui l'utente passa il novanta per cento del tempo
non ha un invariante: ha un'insegna.

**Le due porte non si aprono qui, e non è una scusa.** La voce chiede una riga,
non una superficie, e costruire l'evento di tastiera adesso vorrebbe dire
progettarlo senza un cliente — cioè la forma di difetto che la seduta 22 ha
contestato a chi l'aveva aperta. Il primo cliente ha già un nome, ed è scritto
sotto.

## Il buco dichiarato, e dove sta

Nella forma che la [0064](0064-il-supporto-sta-sotto.md) ha inventato: non una
casella da spuntare, una riga da **trovare** prima di scoprirla. Sta in
`plugin-boundary.md`, accanto al metro e non in fondo a un verbale, perché quello
è il posto in cui uno inciampa mentre si chiede se può.

Il metro guadagna una **quarta voce** — *se la superficie esiste* — e il buco che
la quarta voce trova è la superficie di scrittura: **non vietata, non attrezzata**.
Ci sta scritto cosa c'è già, cosa manca esattamente (le due porte, nominate) e la
clausola di intento, che è la firma della forma: *sta scritto qui perché chi vorrà
portare la propria superficie di scrittura deve trovarlo prima di scoprirlo*.

I buchi dichiarati diventano **due**, e la [0067](0067-il-registro-di-cio-che-e-successo.md)
aveva riaffermato che restassero uno. Non è una deroga: è il caso per cui la forma
era stata inventata. Un buco dichiarato non entra in nessun totale e non è lavoro
rimandato — è un fatto sulla forma del contratto che qualcuno dedurrebbe al
contrario, e questo lo è due volte, perché qui la deduzione sbagliata la produce
l'invariante stesso.

## L'invariante, misurato — che è la parte con del codice dentro

`docs/todo.md` classifica la §23.2 nella famiglia **presidi**, e la voce dice «una
riga di prosa». Avevano ragione tutte e due, ma non nello stesso punto: la riga di
prosa è la decisione; il presidio è ciò che impedisce alla riga di invecchiare in
silenzio.

Perché il difetto vero non è che la garanzia sia falsa. È che **non sa dove
finisce**, e un universale che non sa dove finisce è la stessa forma che la
[0103](0103-un-registro-dice-cosa-e-successo.md) ha trovato in un test: un
enunciato affermato su un insieme che non si è mai contato.

Contato: le feature ufficiali di questo repo stanno su **quattro** superfici delle
**dieci** che il contratto nomina. Sei non hanno **nessun** dogfooding. Il file che
di mestiere fa il dogfooding — `fub-features/tests/conformita.rs` — lo dichiara nel
proprio `//!` con parole che erano già la regola giusta: *«una view non provata non
è solo una view non presidiata: è un dogfooding in meno, cioè una prova in meno che
le asserzioni della suite siano giuste»*. Le contava sulle **view**, che sono la
cosa che si vede. Ma un plugin di terzi non si attacca a una view: si attacca a una
**superficie**. L'universale era su quelle, e nessuno le aveva contate.

Da qui, tre presidi:

- **`ViewSurface::ALL`** in `fub-abi`, con lo stesso argomento di
  `Capability::ALL`: tutto ciò che vuole dire qualcosa su *tutte* le superfici sta
  a valle di questo elenco, e senza di lui lo dice a memoria. Il presidio dei
  discriminanti è quello già scritto per le capacità — contigui da zero, quindi
  `0..len` vieta insieme i duplicati e i buchi;
- **`il_dogfooding_dichiara_fin_dove_arriva`** in `conformita.rs`: per ogni
  superficie, o una feature ufficiale ci sta, o c'è scritto **perché no**. Il
  `match` è esaustivo apposta — una superficie nuova nel contratto *non compila*
  finché qualcuno non la classifica — e il conto delle scoperte sta in un posto
  solo, con l'assert che lo tiene vero;
- **il banco delle superfici** in `frontend/src/ui/views.test.ts`, che estrae
  l'elenco dal **mirror generato** invece di ricordarselo: ogni superficie del
  contratto è classificata dalla shell — ospitata in un contenitore, aperta in un
  riquadro, o non ospitata **con una ragione da dire**.

Le due direzioni del secondo presidio non si equivalgono, e vale la pena scriverlo.
«Una superficie esercitata non può essere dichiarata scoperta» si pretende sempre.
L'inversa — «una dichiarata coperta è davvero esercitata» — dipende dalle feature
accese, e pretenderla renderebbe rossa una build legittima (§16.3); per quella
basta l'esaustività del `match`, che agisce sul compilatore e non su una suite.

## Verificare il rosso ha trovato un buco nel presidio da cui avevo copiato

`ViewSurface::ALL` ha preso da `Capability::ALL` la forma **e l'argomento**: i
discriminanti di un enum senza payload sono contigui da zero, quindi pretendere
che quelli di `ALL` siano esattamente `0..len` vieta insieme i duplicati e i
buchi. È vero, ed è elegante. Provato rosso una riga alla volta, si scopre che
vieta due casi su tre.

Togliere una riga **in mezzo**: rosso. Duplicare una riga tenendo la lunghezza:
rosso. Togliere l'**ultima** e portare la lunghezza da dieci a nove: **verde** —
`visti` diventa `[0..8]` e `attesi` è `(0..9)`, cioè `[0..8]`, e coincidono.

Il caso scoperto è precisamente quello che capita: si aggiunge una variante *in
fondo* all'enum, ci si dimentica dell'elenco, e il compilatore chiede solo che la
lunghezza torni. Il commento sopra `ALL` prometteva di presidiare quello — *«chi
aggiunge una variante la aggiunge anche qui, e il presidio glielo ricorda in
rosso invece che a M5»* — e presidiava tutto tranne quello.

La ragione è generale e vale la pena scriverla: **un conto sa dire se un elenco è
coerente con sé stesso; non sa quante cose esistano fuori di lui.** Per quello
serve qualcuno che le conosca tutte, e l'unico che le conosce tutte è il
compilatore. Da qui `indice_dichiarato` — un `match` esaustivo senza `_` il cui
solo mestiere è non compilare quando l'enum cresce — e l'assert che lega
`ALL.len()` all'indice dell'ultima variante dichiarata.

**Lo stesso buco stava in `Capability::ALL`**, che è l'originale, e riguarda
diciannove famiglie di permessi invece di dieci superfici: una famiglia
dimenticata in coda non viene concessa da `Granted::new` né pretesa dal presidio
delle capacità simulate, e sparisce da entrambi restando verde. È riparato allo
stesso modo, nello stesso commit, perché un difetto trovato nella copia sta
nell'originale per costruzione — e lasciarcelo sapendolo sarebbe stato peggio che
non averlo mai cercato.

Estende la trappola 9 in una direzione che non aveva: **verificare il rosso non
serve solo sui banchi nuovi, serve sui banchi da cui si copia.** Una forma
riusata porta con sé la propria zona cieca, e la porta in silenzio, perché
riusarla sembra prudenza.

## Il numero che nessuno confrontava

L'intestazione del banco della shell diceva *«per sette superfici su otto le due
cose si chiamano uguale»*. Le superfici erano **dieci**, e lo erano da prima che
quella riga fosse scritta.

Nessun presidio se n'era accorto perché quel numero era **dedotto**: non c'era
niente che lo confrontasse con l'enum. È la forma che il §16.7 chiama col suo nome
— *esaustivo a memoria, non per costruzione* — e la conseguenza è più fine di un
commento sbagliato: un elenco tenuto a memoria non mente dicendo il falso, mente
**tacendo una riga**, e una riga taciuta in un elenco di superfici è una superficie
su cui nessuno si è chiesto niente.

È anche la ragione per cui il banco della shell legge il mirror generato invece di
elencare le dieci a mano. Il `switch` di `surfaceContainer` lo tiene già onesto il
compilatore; ciò che il compilatore non vede è che **tre** superfici tornano `null`
e solo **due** hanno una ragione scritta. La terza è `main`, che è ospitata da un
riquadro e non da un contenitore — e la differenza fra «non ancora» e «non si può»
è tutta lì, che è poi la differenza su cui verte l'intera voce.

## Il primo cliente ha un nome

La modalità vim. La 0090 la nomina di sfuggita per scartare un esempio — `g d` è
ineseguibile perché *«sotto questa tastiera c'è un editor in cui `g` è testo di
qualcuno»* — e la frase è vera: è **esattamente** la ragione per cui una modalità
normale esiste.

Il suo verdetto in [funzionalità future](../appendix/funzionalita-future.md) era
`da decidere`, e rimandava qui: *«se l'editing è della shell, questa è una feature
nostra o non è; se la superficie si presta a un terzo, è il primo cliente di quel
prestito»*. Con questa decisione il verdetto è il secondo, e passa da domanda
aperta a lavoro con una collocazione: non una feature che dobbiamo fare noi perché
nessun altro può, ma la prima che chiederà le due porte — ed è il cliente giusto
per progettarle, perché una modalità modale è precisamente il caso che ha bisogno
di un tasto nudo e non di un gesto già interpretato.

## Il prezzo, dichiarato

**Le due porte restano chiuse.** Chi vuole portare la propria superficie di
scrittura, oggi, non può ancora — e adesso lo legge invece di scoprirlo dopo aver
scritto metà editor. Il prezzo è dichiarato, non pagato: è la differenza fra un
debito scritto e un debito taciuto.

**Il conto delle superfici scoperte va tenuto a mano.** L'assert che lo pretende è
una riga da aggiornare il giorno in cui una feature ufficiale scende su `Bottom` o
`Modal`. È voluto: quel numero è l'unico posto del repo in cui la copertura del
dogfooding è scritta **una volta sola** invece che dedotta, e dedurla è ciò che
aveva prodotto il «sette su otto».

**La quarta voce del metro non ha un presidio a macchina**, come non l'hanno le
altre tre. È prosa che argomenta, e il suo presidio è di essere nel posto in cui si
inciampa.

## Cosa NON è cambiato, e perché

**Nessuna riga di WIT, nessun tipo nuovo, nessuna firma.** `ViewSurface::ALL` è una
costante Rust: il WIT non la vede, perché l'enum ci stava già per intero. La voce
diceva «non c'è una firma da scrivere» e su questo aveva ragione — sbagliava
soltanto la diagnosi di *perché* non ce ne fosse bisogno.

**Le sei decisioni restano tutte in piedi.** Nessuna è stata riaperta e nessuna
andava riaperta: la lettura che le accusava era una somma che nessuna di loro
autorizza. Quella della 0088 in particolare non cede di un millimetro — le bozze di
un altro restano irraggiungibili, e un editor di terzi avrà le proprie.

**Il buffer resta della shell.** Prestare il riquadro non vuol dire pubblicare il
nostro buffer: chi porta la propria superficie tiene il proprio testo, che è
letteralmente ciò che la 0018 aveva già scritto.
