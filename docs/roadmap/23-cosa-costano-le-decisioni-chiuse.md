# 23. Cosa le decisioni chiuse costano a chi usa Fub

Una **seduta** della [roadmap infrastrutturale](../todo.md): prezzi dichiarati da un verbale, ognuno in una riga, che nessun elenco ha poi sommato.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

**Questa seduta l'ha trovata una verifica, ed è la terza.** Le due precedenti —
quella che ha aperto la [§21.10](21-la-ricerca-predefinita.md) e quella che ha
aperto la [seduta 22](22-cosa-sa-dire-un-abbonamento.md) — controllavano contro i
sorgenti un'affermazione arrivata **da fuori**. Questa ha un oggetto nuovo: i
**verbali stessi**, riletti in fila con una domanda che nessuna delle sei del
[criterio](../todo.md) pone. Le sei guardano il sistema — cosa manca, cosa ha la
forma sbagliata, cosa non mantiene, quante volte è scritto, a quale domanda
nessuno ha risposto, cosa fallisce in silenzio. Questa guarda **chi usa l'app** e
**chi scriverà un plugin**: *una decisione presa bene, cosa costa a loro?*

**Perché stanno insieme.** Tutte nascono dallo stesso movimento, e non da
un errore: una decisione argomentata bene dichiara il proprio prezzo in una riga
del verbale — «la migrazione non copre la rinomina fatta ad app chiusa», «la
capacità manca per sempre», «servono prima §9.1 e §7.3» — e lì la riga resta. Il
verbale è immutabile e fa il suo mestiere; ciò che manca è che qualcuno **sommi
quei prezzi** e decida se sono ancora quelli. È la famiglia della
[0054](../decisions/0054-il-banco-del-lato-provider.md) vista dal verso mite: non
una garanzia dichiarata che non esiste, ma un costo dichiarato che nessuno
rilegge — perché il motivo per cui lo si scrive è smettere di doverci pensare.

Le prime tre si sono trovate in tre punti diversi della stessa rilettura, e la
proprietà che le lega la si vede solo mettendole in fila: **in tutte e tre la
decisione regge e la sua premessa no**. La 0043 ha scartato l'unica alternativa
che aveva guardato; l'invariante dei terzi è vera nel documento che la scrive e
falsa su una superficie che sei verbali hanno costruito dopo; i due bloccanti che
tenevano fuori la rete sono caduti uno per uno, in due sedute che non sapevano di
toccarli. Sono tre modi diversi di invecchiare, e nessuno dei tre si vede
rileggendo il verbale contro i sorgenti **del suo tempo**.

**Cosa questa strada produce soprattutto, e va scritto.** Falsi positivi. La
stessa rilettura ne ha prodotti cinque, tutti plausibili e tutti caduti al primo
controllo, e vale la pena elencarli perché chi la ripercorre non li ribatta:

- **la ricerca built-in** ([0025](../decisions/0025-la-ricerca-predefinita.md))
  non chiude nessuna porta — la famiglia `Documents` ha un padrone solo ma si
  sostituisce chiedendola per nome
  ([0019](../decisions/0019-il-canale-dati.md)), e il fuzzy sta nella query
  **proprio perché** si possa spegnere una domanda alla volta;
- **l'elenco delle capacità** ([0013](../decisions/0013-elenco-delle-capacita.md))
  è chiuso per **regola** e non per numero: la
  [0018](../decisions/0018-chi-vede-il-modello-parsato.md) ne ha aggiunte due
  dopo, col criterio scritto lì dentro, e la crescita è una minor;
- **la cronologia accesa di default**
  ([0086](../decisions/0086-una-cronologia-e-la-sua-porta.md)) non esce dalla
  macchina, l'interruttore viaggia col vault e spegnerlo cancella;
- **i pesi della ricerca** ([0084](../decisions/0084-un-peso-e-una-preferenza.md))
  sono quattro chiavi di impostazione con minimo e massimo, non costanti;
- **la spegnibilità totale** ([funzionalità future](../appendix/funzionalita-future.md))
  regge alla lettera: spegnere è non registrare, e ciò che non è registrato non
  esiste.

**La seconda rilettura, e perché questa seduta cresce invece di chiudersi.** La
prima ha riletto i verbali **in fila**, cercando i prezzi dichiarati ovunque
fossero. La seconda ha fatto l'opposto: ha preso i **primi dieci** e li ha letti
uno per uno contro i sorgenti di **oggi**, con le due domande di questa seduta —
*cosa costa a chi usa l'app, cosa costa a chi scriverà un plugin*. Ne sono uscite
cinque voci (§23.4–§23.8), e la ragione per cui non stanno in una seduta nuova è
che hanno la stessa forma delle prime tre: la decisione regge, il prezzo lo
dichiara il verbale, nessuno l'ha risommato.

Ma il **verso** in cui la premessa invecchia, qui, è un altro, e va scritto
perché è ciò che questa rilettura insegna alla prossima. Nelle prime tre la
premessa era vera e il mondo si è mosso sotto. In due delle cinque nuove la
premessa era **incompleta il giorno stesso**: la
[0007](../decisions/0007-contesto-di-sessione.md) ha scritto il criterio giusto —
«un campo in più a un record è una migrazione di ogni provider che lo riceve»,
quindi i campi si mettono tutti adesso — e poi ha lasciato che uno di quei campi
avesse il **tipo** sbagliato; la stessa decisione ha messo il testo dell'utente
dentro una capacità la cui riga di documentazione dice «che ore sono». Nessuna
delle due si vede rileggendo il verbale: il verbale le dichiara entrambe, con
tanto di prezzo. Si vedono solo **eseguendo il criterio del verbale sul verbale
stesso**, che è la cosa che nessuna delle dieci strade del
[criterio](../todo.md) chiede di fare.

**Tre falsi positivi in più, dalla seconda rilettura.** Stessa disciplina: si
elencano perché chi la ripercorre non li ribatta, e tutti e tre venivano da un
verbale che dichiarava un residuo poi chiuso **altrove** — cioè dal modo esatto
in cui [strozzature.md](strozzature.md) dice di invecchiare.

- **la tastiera** non è configurabile *secondo la
  [0009](../decisions/0009-registro-dei-comandi.md)*, che lascia fuori «la
  tastiera configurabile» e ignora le scorciatoie senza modificatori. Lo è dalla
  [0077](../decisions/0077-una-scorciatoia-e-una-chiave.md): una scorciatoia è
  una **chiave di impostazione** che il kernel fabbrica registrando il provider,
  e i comandi della shell sono comandi come gli altri;
- **le impostazioni scrivibili da un programma** sono la casella non spuntata
  della [0010](../decisions/0010-comando-descritto-a-una-macchina.md) —
  `CommandReach::Settings` era vocabolario senza schema. La
  [0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md) ha costruito il cancello
  (`SettingSpec.program_writable`) e ci ha messo dentro il criterio;
- **le sette varianti di `IndexQuery` che nessun provider può servire** sono
  l'ultimo paragrafo della [0005](../decisions/0005-canale-dati-verso-le-view.md),
  e sono la §5.1: chiusa dalla [0019](../decisions/0019-il-canale-dati.md), che
  ha fatto delle risposte del kernel un `IndexProvider` registrato per primo.

**E una che non è un falso positivo ma un doppione, il che è peggio:** «nessuno,
di qua dal confine, può leggere il buffer non salvato» è un difetto vero e sta
già scritto — è la **[§23.2](#232-linvariante-dei-terzi-ha-una-seconda-eccezione-e-non-è-scritta)**,
che lo elenca come il primo dei sei verbali che hanno messo la scrittura dalla
parte della shell. Una rilettura che parte dai verbali vecchi ritrova per forza
le voci aperte: la disciplina è cercarla nell'indice prima di scriverla, perché
una voce in doppio non si vede come un errore — si vede come due lavori.

**La terza rilettura, e cosa cambia a leggerli tutti insieme.** La prima ha
riletto i verbali in fila; la seconda ha preso i primi dieci e li ha letti uno per
uno contro i sorgenti di oggi. La terza li ha presi **tutti e novanta**, divisi in
cinque lotti letti in parallelo, con una domanda più stretta delle due di questa
seduta: *questa decisione toglie a chi usa l'app **qualità**, **libertà** di
modificare e scegliere, o **privacy**?* Ne sono uscite otto voci (§23.9–§23.16).

Quello che la lettura in parallelo trova e le due precedenti non potevano trovare
è una cosa sola, e vale come metodo: **le coppie**. Un lotto solo non le vede
perché stanno in due verbali che non si nominano a vicenda, e una lettura in fila
le separa nel tempo. Sono tre, e sono le tre voci più forti del giro: le
scorciatoie sono diventate dati del vault ([0077](../decisions/0077-una-scorciatoia-e-una-chiave.md))
il giorno dopo che le impostazioni erano diventate dati del vault
([0076](../decisions/0076-le-impostazioni-vivono-nel-vault.md)), e l'argomento di
rischio che la prima aveva smontato valeva su tema e lingua, non sui tasti; le
bozze sono negate in scrittura **per sempre** perché troppo private e concesse in
lettura a chiunque legga il vault ([0088](../decisions/0088-cio-che-non-e-ancora-successo.md));
la `base` di una scrittura è nata facoltativa
([0089](../decisions/0089-da-cosa-e-partita-una-scrittura.md)) proprio dove il
rilevamento delle modifiche esterne non c'è
([0030](../decisions/0030-il-rilevamento-si-puo-chiedere.md)). In tutte e tre,
ciascuna metà è difendibile e il prodotto delle due non l'ha guardato nessuno —
che è la forma della [§23.3](#233-due-bloccanti-caduti-e-la-rete-non-se-nè-accorta),
ritrovata tre volte.

E una seconda cosa, che è il rovescio del pregio di questo repo: **quasi tutti
questi difetti li dichiarano i verbali stessi**, spesso nella riga accanto al
codice che li causa — «il caso resta scoperto, e questa riga è il posto dove si
vede» ([0065](../decisions/0065-una-scrittura-o-c-e-o-non-c-e.md)), «se un giorno
lo facesse questa è la riga da rileggere»
([0032](../decisions/0032-il-runner-dei-job.md)). Nessuno è stato dedotto contro
il testo. È esattamente il difetto che questa seduta esiste per riparare, visto
alla sua densità massima: la disciplina di scrivere il prezzo accanto alla scelta
ha retto su tutti e novanta, e il debito non sta nell'averlo nascosto — sta nel
non aver ancora fatto la somma.

**Cinque falsi positivi del terzo giro**, con la stessa disciplina degli altri due
elenchi — si scrivono perché chi ripercorre non li ribatta. Uno è di specie nuova
e va guardato per primo:

- **la normalizzazione dei nomi non esiste come la si è raccontata.** L'accusa era
  che `rules::path::normalize` facesse `to_lowercase` sui nomi e che la NFC
  cambiasse in silenzio ciò che l'utente digita. Quella funzione **non esiste**: il
  `to_lowercase` sta in `resolution_key`, che decide quando due nomi sono lo
  **stesso** nome e non tocca nulla sul disco, e la normalizzazione dei nomi nuovi
  è `path_policy::normalized()`, che fa NFC **senza** lowercase — perché il disco
  il caso lo conserva. È il caso che la [§21.10](21-la-ricerca-predefinita.md) ha
  insegnato a temere, arrivato stavolta da dentro: un'affermazione plausibile
  sull'architettura, con il difetto vero un centimetro più in là. La lezione è che
  **la verifica contro i sorgenti va fatta anche quando l'affermazione la produce
  una nostra rilettura**, e non solo quando arriva da fuori;
- **il rollback di un lotto** non è una voce mancante: da quando il journal c'è
  ([0067](../decisions/0067-il-registro-di-cio-che-e-successo.md)) è *scrivibile*,
  e [strozzature.md](strozzature.md) lo registra già assegnandolo a chi lo userà
  (17.3, 22.4). Ciò che resta scoperto è un'altra cosa e più stretta, ed è la
  [§23.14](#2314-unoperazione-a-metà-non-sa-di-essere-a-metà);
- **gli avvisi che finiscono su `stderr`** sembravano una classe aperta contata
  cinque volte. Sono la [seduta 20](20-quando-qualcosa-va-storto.md), e quattro
  voci su cinque sono chiuse — i quattordici della shell dalla
  [0080](../decisions/0080-un-guasto-si-dice-a-chi-sta-lavorando.md). Resta il solo
  §20.5;
- **l'indice di ricerca fuori dalla cifratura** è vero e non è una voce: la
  [0064](../decisions/0064-il-supporto-sta-sotto.md) lo scrive come **buco
  dichiarato**, cioè nella forma che la [§23.2](#232-linvariante-dei-terzi-ha-una-seconda-eccezione-e-non-è-scritta)
  chiede di usare. Una riga da trovare prima di scoprirla c'è già;
- **il debito di contrasto** della [0042](../decisions/0042-il-catalogo-della-shell.md)
  ha un lucchetto — la costante `SOTTO_AA` — quindi non può crescere in silenzio.
  È il modello di come si tiene un debito, non un debito da riaprire.

**E tre delle sedici sono P0.** Le prime tre non lo erano, e la riga qui sopra diceva
che la tentazione, su una seduta che parla di prezzi pagati dall'utente, è
chiamarle P0 per **importanza** — cioè commettere l'errore che la
[seduta 22](22-cosa-sa-dire-un-abbonamento.md) ha appena contestato a chi
l'ha aperta. La riga resta vera e il criterio non cambia: **P0 è la scadenza, non
l'importanza**, e [leva.md](leva.md) esiste apposta per dire che una voce può
essere P1 e restare la più importante da capire. Passate una per una: la §23.1 è
una regola dentro `reconcile` e non tocca una firma; la §23.2 è una riga di prosa
e una decisione di prodotto; la §23.3 aggiungeva una capacità, e l'elenco della
0013 è chiuso alla **sottrazione**, non alla crescita — la
[0097](../decisions/0097-un-recinto-che-vale-anche-quando-nessuno-guarda.md)
l'ha aggiunta senza toccare una firma, che è la conferma del criterio; la §23.5 sposta un
permesso e non una firma; la §23.6 aggiunge un modo accanto a quello che c'è; la
§23.7 e la §23.8 sono regole del kernel.

La **§23.4** è l'eccezione, e lo è per il criterio e non contro: `Selection` è un
campo di un **record** del contratto, e passare da uno a molti gli cambia il
**tipo**. Non è una variante in fondo a un enum — è la cosa che
[`wit_additivity`](../architecture/wit-congelato.md) rifiuta per costruzione, e
che dopo M4 costa una major. È anche l'unica voce di questa seduta il cui costo
non cresce di poco per volta: cresce **tutto in una volta**, il giorno del
freeze.

**Le altre due P0 le ha portate il terzo giro, e hanno la stessa forma della
§23.4** — non l'importanza, il **tipo**. La §23.11 voleva che `base` smettesse di
essere `Option`, e la
[§23.12](#2312-un-troncamento-che-il-chiamante-non-può-vedere) che `random-bytes`
smetta di restituire una lista nuda: in tutti e tre i casi ciò che cambia è il
tipo di qualcosa di già pubblicato, cioè la riga che
[`wit_additivity`](../architecture/wit-congelato.md) fa diventare rossa. Che
fossero tre su sedici, e che le altre tredici non lo siano nemmeno parlando di
privacy e di dati persi, è la prova che il criterio ha retto anche a un giro
fatto con una lente — qualità, libertà, privacy — che spinge in direzione
opposta. **Sono chiuse tutte e tre**, in tre commit di fila: la §23.11 dalla
[0092](../decisions/0092-una-base-si-dichiara.md), la §23.4 dalla
[0093](../decisions/0093-le-selezioni-sono-n-e-il-buffer-e-uno.md) — la più larga
delle tre, e l'unica con una decisione di forma vera dentro — e la §23.12 dalla
[0094](../decisions/0094-un-tetto-che-si-fa-sentire.md), la più piccola, che lo
diceva di sé. **Non resta nessuna P0 prima del freeze di M4.**

Le tre insieme dicono una cosa che nessuna diceva da sola: in tutti e tre i casi
la firma pubblicata **rappresentava meno di quanto l'app sapesse già fare** — una
base che c'era e si ometteva, tre cursori accesi e uno solo pubblicato, un
rifiuto che l'host conosceva e rendeva come un dato. Nessuno dei tre ritagli ha
aggiunto una funzione: hanno dato una forma a ciò che si stava già perdendo per
strada.

**E una aveva una scadenza che non era il freeze**, il che non la rendeva P0 ma
le dava un **ordine**: la §23.5 andava decisa prima della §23.3. Finché non c'è
rete, un plugin che legge quel che l'utente seleziona non ha dove mandarlo; il
giorno che la rete entra, ce l'ha. Le due voci non si sono mai incontrate perché
stanno in due verbali diversi, ed è la stessa forma della §23.3 stessa — due cose
vere separatamente che nessuno ha moltiplicato.

**L'ordine è stato onorato**, e da tre verbali di fila: la
[0095](../decisions/0095-cosa-guardo-e-cosa-sto-scrivendo.md) ha messo i cancelli
della sessione, la [0096](../decisions/0096-una-bozza-non-e-una-nota.md) quello
delle bozze, e solo dopo la
[0097](../decisions/0097-un-recinto-che-vale-anche-quando-nessuno-guarda.md) ha
aperto la rete. Il giorno in cui un plugin ha avuto dove mandare le note
dell'utente, le due cose che più valeva non fargli leggere avevano già un
permesso proprio — che è il prodotto delle due metà guardato **prima** invece
che dopo, cioè l'unica volta in questa seduta in cui è successo.

**È stata presa per prima appena le P0 sono finite**, e la
[0095](../decisions/0095-cosa-guardo-e-cosa-sto-scrivendo.md) l'ha chiusa: quello
che era «un ordine e non una priorità» è diventato il criterio con cui si è
scelto, il primo turno in cui a ordinare il lavoro non era una scadenza. Ciò che
si è trovato facendola vale per le voci di questa seduta ancora aperte: **la
raccomandazione della voce era sbagliata**, e non per poco — diceva di guardare
per prima l'opzione che «non inventa niente», e quell'opzione avrebbe fatto
scomparire la scelta che la voce esiste per dare. Una voce di questa seduta
dichiara un prezzo bene e propone un rimedio a intuito: il primo va creduto, il
secondo va misurato.

### 23.1 Una rinomina fatta ad app chiusa scollega tutto ciò che è indicizzato per path

*chiusa dalla [0099](../decisions/0099-una-rinomina-che-non-ha-visto-nessuno.md) — l'apertura **riconosce dal contenuto** ciò che il rilevatore non ha visto: un sparito e un comparso con la stessa impronta sono la stessa nota, e ciò che le stava attaccato la segue · nessun id e nessuna tabella nuova, perché le due metà del confronto erano già in memoria per altre ragioni (anagrafe durevole, impronta calcolata leggendo) · **uno a uno o niente**, e nel dubbio non si accoppia — verso opposto alla [0085](../decisions/0085-leggere-non-e-cambiare.md), perché la regola del dubbio non è una costante del repo ma una funzione di cosa costa sbagliare · e nel dubbio **non si raccoglie**: delle due mosse, quella irreversibile si sospende · misurando è saltato fuori un difetto accanto e peggiore — la raccolta girava anche su un'anagrafe **parziale**, quindi «annulla» sulla prima indicizzazione toglieva dal disco lo spazio per-documento delle note non ancora guardate*

La [0043](../decisions/0043-il-path-e-la-chiave.md) ha deciso che **il path è la
chiave per sempre**, e l'argomento regge: un id stabile o vive dentro il file — e
allora è una **proprietà**, che il contratto sa già dire — o vive fuori, e allora
non sopravvive a ciò per cui esiste. Questa voce non lo riapre.

Riapre il **prezzo**, che tre verbali hanno dichiarato separatamente e nessuno ha
sommato. La [0044](../decisions/0044-lo-stato-per-documento.md) lo scrive per
prima: *«la migrazione non copre la rinomina fatta ad app chiusa che il watcher
non può accoppiare: quella nota risulta sparita e ne nasce una nuova, quindi i
dati vecchi li raccoglie il giro successivo»*. La
[0088](../decisions/0088-cio-che-non-e-ancora-successo.md) ci aggiunge le
**bozze**, che almeno non si raccolgono — una bozza orfana è l'unica copia
rimasta — ma restano attaccate a un nome che non c'è più. E accanto ci sono le
**versioni** e ogni altro spazio per-documento, che seguono la stessa chiave.

Sommati, dicono una cosa che nessuna delle tre righe dice da sola: **chi sposta
le proprie note con un altro strumento perde ciò che Fub aveva costruito per
loro** — e spostare le note con un altro strumento è precisamente la libertà che
il patto di questo progetto promette.

- [x] **La terza strada, che la 0043 non ha guardato.** Il verbale scarta *una*
      implementazione dell'id esterno — la tabella `path → id` tenuta dal kernel
      — e ne conclude, giustamente, che è «il path con un costume addosso». Ma la
      riassociazione non deve passare da un id: può passare dal **contenuto**. Un
      documento sparito e uno comparso con la **stessa impronta** sono la stessa
      nota con un nome nuovo, e il materiale per dirlo è già tutto su disco:
      `Revision::of_bytes` è la stessa funzione di `Revision::of`
      ([0087](../decisions/0087-il-testo-che-sta-dentro-gli-allegati.md)), e
      l'anagrafe è **durevole** fra un avvio e l'altro
      ([0046](../decisions/0046-l-anagrafe-del-vault.md)), con `mtime` e `size`
      per ogni entry. Il watcher accoppia le rinomine che **vede**; qui si tratta
      di accoppiare quelle che non ha visto nessuno, al primo `reconcile`.
- [x] **Perché è una decisione e non una casella.** Le domande da rispondere non
      si rispondono scrivendo il codice. Due impronte uguali sono una rinomina
      solo se una nota è **sparita**: due file identici comparsi senza che
      sparisse niente sono una copia, e trattarli come una rinomina sposterebbe
      la bozza dell'una sull'altra. Quando ne spariscono N e ne compaiono N con
      le stesse impronte, l'accoppiamento non è unico. E soprattutto va scritta
      la regola del **dubbio**, che qui va nel verso opposto a quella della
      [0085](../decisions/0085-leggere-non-e-cambiare.md): là nel dubbio si conta
      come cambiamento, perché una rilettura di troppo costa un file aperto; qui
      nel dubbio **non si accoppia**, perché un accoppiamento sbagliato consegna
      il testo non salvato di una nota a un'altra.
- [x] **Fin dove arriva la migrazione.** Lo spazio per-documento e le bozze
      seguono già la rinomina *vista* ([0044](../decisions/0044-lo-stato-per-documento.md),
      [0088](../decisions/0088-cio-che-non-e-ancora-successo.md)): la strada c'è,
      e ciò che manca è chi la imbocchi quando la rinomina non l'ha vista
      nessuno. Va deciso se vale per tutto ciò che è per-path o per i soli dati
      **autorevoli** della [0048](../decisions/0048-una-radice-sola.md) — un
      derivato si rifà, e rifarlo può costare meno che indovinare.
- [x] **Chi lo chiede.** FEATURES 3.1 (vault su share di rete, vault
      read-only), 2.3 (modifiche esterne), 18.1 (sync). Un client di sync che
      rinomina mentre l'app è chiusa è il caso **normale** di questa famiglia,
      non quello di frontiera: è il motivo per cui esiste.
- [x] **Perché non è P0, e perché non aspetta.** Non c'è una firma: è una regola
      dentro `reconcile`, additiva in qualunque momento. Ma il costo cresce con
      l'attesa in un modo che le altre due voci di questa seduta non hanno —
      **ogni derivato per-path nuovo eredita il difetto**, e da quando la 0044 lo
      ha scritto per la prima volta ne sono nati due (le bozze, e la cronologia
      delle versioni).

### 23.2 L'invariante dei terzi ha una seconda eccezione, e non è scritta

*presidi · **P1** — una riga di prosa e una decisione di prodotto; non c'è una firma da scrivere*

L'invariante è *«una feature ufficiale è ciò che scriverà un plugin di terzi»*, e
la [0017](../decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md) la cita
come il punto in cui era **già falsa una volta**: un'estensione di sintassi non
poteva essere un plugin, e quella decisione l'ha resa vera. Da allora sei verbali
hanno costruito la superficie di scrittura, e ognuno per una ragione buona e sua
l'ha messa **dalla parte della shell**: il buffer non lo conosce nessuno di qua
dal confine ([0018](../decisions/0018-chi-vede-il-modello-parsato.md)), i
riquadri sono un fatto della shell
([0078](../decisions/0078-i-riquadri-sono-un-fatto-della-shell.md)), l'undo del
testo è dell'editor ([0045](../decisions/0045-l-undo-ha-due-pile.md)), la ricerca
dentro la nota aperta sono due letterali
([0082](../decisions/0082-una-porta-per-chi-cerca.md)), le bozze passano da due
porte IPC e la loro capacità manca **per decisione e per sempre**
([0088](../decisions/0088-cio-che-non-e-ancora-successo.md)), la tastiera è un
registro della shell ([0090](../decisions/0090-una-sequenza-e-una-modalita-che-scade.md)).

Nessuna delle sei è sbagliata — quella della 0088 è la più difendibile di tutte:
il testo non ancora salvato è il dato più privato che un vault contenga. Ma
sommate dicono una cosa che nessuna dice da sola, e che **non sta scritta da
nessuna parte**: un terzo non può portare un'altra esperienza di scrittura. Può
solo decorare la nostra.

- [ ] **Scrivere l'eccezione dove sta l'invariante**, nella forma che la
      [0064](../decisions/0064-il-supporto-sta-sotto.md) ha inventato: un **buco
      dichiarato**, che non è una casella da spuntare ma una riga da **trovare**
      prima di scoprirla. Chi arriverà a M5 e leggerà l'invariante ne dedurrà di
      poter scrivere un editor, e ci arriverà lontano prima di accorgersi che no.
      Un'eccezione che si scopre scrivendo costa quanto la
      [0054](../decisions/0054-il-banco-del-lato-provider.md): là una garanzia
      dichiarata non esisteva, qui esiste una garanzia che vale su tutto tranne
      dove serve di più.
- [ ] **Decidere fin dove arriva**, che è la parte che costa. Oggi la riga non
      c'è, quindi non si sa se «l'editor è della shell» voglia dire *questo
      editor* o *l'editing*. Le due risposte producono due prodotti diversi:
      nella prima un terzo porta la propria superficie di scrittura e la shell le
      presta un riquadro — la strada esiste già, perché `ViewSurface::Main` è
      ospitata dalla [0079](../decisions/0079-il-grafo-esce-dall-overlay.md) e un
      riquadro tiene una tab di **view**, non per forza un documento; nella
      seconda non succederà mai, e allora i capitoli di FEATURES che descrivono
      modi di scrivere vanno letti con quella riga in mano.
- [ ] **Il misuratore della domanda è la modalità vim**, e oggi non ha una
      posizione. La [0090](../decisions/0090-una-sequenza-e-una-modalita-che-scade.md)
      la nomina di sfuggita per scartare un esempio — `g d` è ineseguibile perché
      «sotto questa tastiera c'è un editor in cui `g` è testo di qualcuno» — e la
      frase è vera: è **esattamente** la ragione per cui una modalità normale
      esiste. Fino a questa voce, in tutto il repo la parola compariva in
      quella riga sola: non promessa, non negata, nemmeno «da decidere». È una feature che
      l'app da cui questo progetto prende le misure ha, che la libreria su cui
      l'editor è costruito fornisce, e su cui il piano non dice niente. Il suo
      verdetto sta in [funzionalità future](../appendix/funzionalita-future.md);
      qui sta perché **misura** la voce: se l'editing è della shell, una modalità
      vim è una feature nostra o non è; se la superficie si presta, è il primo
      cliente di quel prestito.
- [ ] **Perché non è P0.** Non c'è una firma da aggiungere: la superficie del
      prestito è già ospitata e il `pane` del `ViewContext` c'è dalla
      [0007](../decisions/0007-contesto-di-sessione.md). Ciò che manca è la riga
      che dice **se si può**, e una riga si scrive in qualunque momento — ma va
      scritta prima di M5, perché dopo si legge come una scusa invece che come
      una scelta.

### 23.3 Due bloccanti caduti, e la rete non se n'è accorta

*chiusa dalla [0097](../decisions/0097-un-recinto-che-vale-anche-quando-nessuno-guarda.md) — `HostNetwork::fetch` entra come quindicesima famiglia del contratto e diciottesima del `Guard`, e **`fub:network` è il primo parametro di permesso che questo repo legga**: l'allowlist di host si onora, i redirect non si seguono (è la riga su cui poggia tutto), `*.` è obbligatorio per i sottodomini e le credenziali non prestano un nome dichiarato · nessuna firma toccata, quindi **nessun ritaglio** · resta **una casella**: fermare una richiesta già partita, che oggi aspetta il tetto di tempo dell'host*

La [0013](../decisions/0013-elenco-delle-capacita.md) ha tenuto fuori
`http_fetch` con due bloccanti **nominati**, ed è la forma migliore in cui un no
si possa scrivere: *«servono prima §9.1 (un lavoro lungo che vede il vault)
perché sia utile e §7.3 (`network` letto da qualcuno) perché sia sicura. Due
bloccanti, entrambi nominati; dopo, additiva.»*

Sono caduti tutti e due. Il §9.1 con la
[0027](../decisions/0027-il-lavoro-lungo-vede-il-vault.md) — un job riceve
l'`HostApi` per chiamata, quindi chi scarica ha dove mettere ciò che ha
scaricato. Il §7.3 con la [0021](../decisions/0021-il-confine.md), che ha scritto
perfino la riga d'innesto: *«il giorno che `http_fetch` entrerà,
`Capability::permission()` è la riga che le dà un permesso»*, e il permesso
`fub:network` è già dichiarabile in un manifest, in attesa di qualcosa da
governare.

- [x] **Il gemello di questa voce è già stato fatto, ed è il precedente che la
      rende ovvia.** La [§22.1](22-cosa-sa-dire-un-abbonamento.md) ha rimisurato
      l'**altro** diniego della stessa 0013 — `schedule_at` — ha trovato la
      premessa smentita dalla [0032](../decisions/0032-il-runner-dei-job.md), e ha
      concluso che il no restava giusto **per un'altra regola**: una sveglia
      informa, quindi è un evento e non una capacità
      ([0069](../decisions/0069-cosa-sa-dire-un-abbonamento.md)). Nessuno ha
      fatto lo stesso giro per la rete, e la differenza sta tutta lì: qui
      l'altra regola **non c'è**. Chi scarica ha bisogno della risposta per
      proseguire, che è la definizione di capacità scritta nella 0013 stessa.
- [x] **Cosa va deciso, che non è «si aggiunge `http_fetch`».** Se si concede un
      GET a un'**allowlist di host dichiarata nel manifest** o una capacità nuda
      con un permesso booleano — e la prima ha già la sua forma, perché
      `PluginPermissions.granted` è una mappa con parametro dalla
      [0017](../decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md). Se
      vale **solo dentro un job**, che era la forma che la 0013 immaginava e che
      adesso ha senso. Cosa risponde in **simulazione**, che è il varco della
      [0010](../decisions/0010-comando-descritto-a-una-macchina.md): una
      `DryRun` che scarica non è una simulazione. E se la risposta porta byte o
      testo, che è la stessa domanda che la
      [0087](../decisions/0087-il-testo-che-sta-dentro-gli-allegati.md) ha già
      risposto una volta per i documenti.
- [x] **Chi lo chiede.** FEATURES 18 (sync), 14.2 (clipper), 22 (AI e RAG), 15.1
      (citazioni: DOI, Zotero), 13.4 (trascrizione), 27.2 (API locale). È la
      famiglia più grande fra quelle che oggi non hanno **nessuna** strada, ed è
      l'unica in cui l'assenza non si vede: un plugin di sync non si scrive a
      metà e poi si blocca — non lo prova nessuno, e il buco resta senza lasciare
      traccia.
- [x] **Perché non è P0.** La tentazione è l'opposto — *tocca l'`HostApi`,
      quindi è contratto, quindi P0* — ed è lo stesso errore di categoria che la
      [seduta 22](22-cosa-sa-dire-un-abbonamento.md) ha contestato a chi l'ha
      aperta. Aggiungere una capacità dopo il freeze costa una **minor**, e la
      0013 lo dice nella riga in cui chiude l'elenco. Ciò che scaderebbe è semmai
      la **forma del permesso**, e quella c'è già dalla
      [0017](../decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md).

### 23.4 `Selection` ne porta una sola, e il tipo di un campo non è additivo

*chiusa dalla [0093](../decisions/0093-le-selezioni-sono-n-e-il-buffer-e-uno.md) — il campo diventa `selections: option<selection-set>`, con la primaria **nominata** e l'ancoraggio **sopra l'insieme**, perché il buffer è uno · il multi-cursore era acceso nell'editor da sempre: fuori era la sola facoltà di dirlo · resta **una casella**: `note.task.toggle` su N cursori vuole un `at` che sia una lista, cioè una decisione di firma sua*

La [0007](../decisions/0007-contesto-di-sessione.md) scrive il criterio, e lo
scrive per prima e meglio di chiunque: *«un caso in fondo a un enum dopo il
freeze è una minor; un campo in più a un record è una migrazione di ogni provider
che lo riceve»*. È per quel criterio che `ViewContext` nasce con tutti e quattro
i campi invece che con un sottoinsieme da completare dopo, ed è la ragione giusta.

Poi la stessa decisione dichiara, nel suo *resta fuori*: *«il multi-cursore e le
selezioni multiple (4.2) — `Selection` ne porta una, e la seconda sarebbe
`list<selection>`, cioè additiva solo cambiando il tipo del campo: qui la scelta è
dichiarata, non dimenticata»*. La scelta è dichiarata davvero. Ciò che non è
stato fatto è **applicarle il criterio di tre paragrafi sopra**: cambiare il tipo
di un campo non è meno di aggiungerne uno, è di più — un provider che riceve un
campo nuovo lo ignora e continua a compilare, un provider che riceve `list` dove
leggeva un valore **non compila**, e uno compilato a wasm legge byte che non sono
più quelli. È esattamente ciò che
[`wit_additivity`](../architecture/wit-congelato.md) elenca fra le venti
rotture che deve far diventare rosse (*campo ritipato*), e sarà rosso.

- [x] **La forma, e non è solo «metterci una lista».** Una selezione primaria
      esiste e conta: `selection.wikilink` avvolge *una* cosa, il pannello
      statistiche conta *una* cosa. Va deciso se la primaria è la prima della
      lista per convenzione — che è la regola di CodeMirror e non costa niente al
      confine — o un campo a parte, che è la stessa domanda dello span della 0007
      («un flag che chiunque può dimenticare di leggere protegge meno di un campo
      che, quando non è vero, non c'è») vista dall'altro lato. E va deciso cosa
      significa una **lista vuota** rispetto all'assenza: in lettura non c'è
      cursore, e la 0007 quel caso lo risolve già con `Option`.
- [x] **La regola dello span vale per ognuna, non per l'insieme.** Lo span c'è
      solo quando le sue coordinate valgono per il sorgente che il kernel ha in
      mano; con N selezioni le coordinate sono N e la condizione è **una sola**,
      perché il buffer è uno. Quindi o lo span sparisce da tutte insieme, e allora
      la condizione sta sopra la lista e non dentro le voci — e la forma di oggi,
      `Option` dentro ogni `Selection`, dice il contrario.
- [x] **Chi lo chiede.** FEATURES 4.2 (multi-cursore e selezioni multiple) per
      intero, e con essa ogni azione sulla selezione applicata a più punti — che
      è il gesto per cui il multi-cursore esiste. La shell con più cursori oggi
      pubblica la primaria: non è un difetto della shell, è la sola cosa che il
      contratto le lasci dire.
- [x] **Perché è P0, e cosa succede a non farla.** Non c'è una via additiva:
      `selections: list<selection>` accanto a `selection` sarebbero due firme per
      la stessa domanda — la trappola che questa stessa decisione descrive per
      `active_document` — e tenerle allineate sarebbe compito di ogni shell. Dopo
      M4 la scelta è fra una major e un contratto che nomina il multi-cursore due
      volte. **Oggi costa un tipo.**

### 23.5 Il testo che l'utente seleziona viaggia sotto una capacità che nessuno può negare

*contratto · **chiusa dalla [0095](../decisions/0095-cosa-guardo-e-cosa-sto-scrivendo.md) — `Env` si spacca in tre: l'orologio resta senza permesso perché è della macchina, quale nota è aperta diventa `fub:read-session`, il testo selezionato `fub:read-selection`. Le tre premesse della voce erano cadute tutte e tre, e la sua raccomandazione — appoggiare la selezione a `read-vault` «perché non inventa niente» — era sbagliata: avrebbe fatto scomparire la scelta che la voce esiste per dare***

`Capability::Env` è documentata in `guard.rs` come *«sapere che ore sono e cosa
guarda l'utente»*, e la sua `permission()` è `None`. La riga che spiega quel
`None` è precisa e, per le famiglie che nomina, giusta: *«non è un permesso
dichiarabile nel manifest — i propri blob stanno nel proprio recinto, l'orologio
non è del vault»*. I propri blob e l'orologio non sono roba dell'utente, quindi
non c'è niente da concedere.

Ma sotto `Env` non passa solo l'orologio. Passa `active_context()`, e dentro c'è
`Selection.text`, che la [0007](../decisions/0007-contesto-di-sessione.md)
definisce **sempre presente**: è il testo selezionato, verbatim, per costruzione
anche quando lo span non c'è. Cioè contenuto dell'utente, sotto l'unica famiglia
di capacità che nessun manifest dichiara, nessun pannello mostra e nessuna
politica può negare senza negare anche l'orologio.

Le tre conseguenze si sommano, e nessuna delle tre è visibile dal verbale che
decide una sola delle due metà:

- **scavalca l'allowlist.** Il commento accanto a `Capability::Query` dice perché
  il canale dati è recintato: *«una risposta aggregata non ha un path da
  confrontare con una allowlist»*. Il ragionamento è giusto e si applica identico
  qui — con l'aggravante che un plugin con `read-vault` ristretto a una cartella
  riceve comunque il testo di qualunque selezione in qualunque nota. Il recinto
  sui path si aggira selezionando. (Ed è indipendente dalla casella della
  [§7.1](07-il-confine.md#la-casella-rimasta), che è il caso in cui il filtro per
  prefisso non viene **letto**: qui non c'è nemmeno un prefisso da leggere.)
- **non è un dato, è un flusso.** La 0007 stabilisce che la shell pubblica il
  contesto con un debounce di **150 ms** sul cursore. Chi legge non ottiene
  un'istantanea di cosa c'è selezionato: ottiene una registrazione di ciò che
  l'utente sta facendo nel testo, alla granularità del quinto di secondo.
- **`ContextMask` non è un cancello.** `follows` dichiara *quando ridisegnare*.
  Un provider che dichiara di non seguire niente — come il pannello dei tag, che
  la 0007 porta a esempio — può chiamare `active_context()` quando vuole.

- [x] **Dove passa il taglio.** Le opzioni sono tre e non sono equivalenti:
      spaccare la famiglia in due (`Env` per l'orologio senza permesso, una
      famiglia della **sessione** con un permesso dichiarabile), lasciare la
      famiglia dov'è e mettere il solo `Selection.text` dietro `read-vault` —
      che è il permesso che governa già il contenuto dei documenti, ed è
      l'opzione che non inventa niente — oppure separare nel **contratto** «dove
      sta l'utente» da «cosa ha selezionato», cioè due chiamate invece di un
      record. La prima e la terza fanno crescere la superficie; la seconda no, e
      per questo va guardata per prima.
- [x] **Cosa resta senza permesso, e va detto esplicitamente.** Il `PaneId`, la
      `PaneMode` e il `DocId` attivo non sono contenuto — ma il `DocId` è il
      **nome** di una nota, e i nomi delle note sono privati quanto il testo per
      chi tiene un diario. Va deciso se «cosa guarda l'utente» resti concesso a
      chiunque, e se sì scritto **perché**, invece di essere il residuo di una
      riga che parlava dell'orologio.
- [x] **Il prezzo di recintarla, che esiste.** Il pannello statistiche della 0007
      conta le parole della selezione: è un `ViewProvider` ufficiale, e con un
      cancello dovrà dichiarare `read-vault` per fare una cosa che non legge
      nessun documento. È il caso che rende la decisione non ovvia — un permesso
      troppo grosso per la cosa che si fa è il modo in cui i permessi smettono di
      significare qualcosa, ed è l'argomento a favore della famiglia separata.
- [x] **Perché non è P0, e perché ha comunque un ordine.** Non c'è una firma da
      spostare: `Capability` è un enum del kernel e i permessi sono stringhe del
      manifest, che la [0021](../decisions/0021-il-confine.md) ha reso una mappa
      con parametro. Ma la §23.3 aggiungerà `http_fetch`, e le due voci si
      moltiplicano: oggi chi legge la selezione non ha dove mandarla, domani sì.
      **Il cancello va messo prima della rete**, non insieme — insieme vuol dire
      che una delle due decisioni si prende avendo in testa l'altra a metà.

### 23.6 Un import sta tutto in memoria, e la cosa che si importa più spesso è un vault intero

*contratto · **P1** — il modo a stream è additivo, ma va deciso prima dei cinquanta importer che nascono intorno alla firma di adesso*

La [0006](../decisions/0006-import-export-come-trait.md) ha deciso che il confine
del trasferimento è **di byte e non di path**, ed è la decisione più protettiva
delle prime dieci: il capitolo che in ogni altra applicazione tocca il filesystem
più di tutti **non chiede nessuna capacità filesystem**, e a M5 la sandbox non
deve concedere niente. Questa voce non la riapre — la conclusione va tenuta
qualunque cosa si decida qui.

Riapre il prezzo, che il verbale dichiara in una riga e mezza: *«sorgente e
artefatti stanno in memoria, e uno `stream` al confine resta additivo»*. La riga
è vera. Quello che non dice — e che si vede solo mettendola accanto a
[FEATURES](../FEATURES.md) — è **cosa** si importa: il 17.1 è la migrazione da
Obsidian, Notion, Evernote, Roam. Un vault, cioè la cosa più grande che l'utente
possiede, e la stessa 0006 nomina «un vault Obsidian da 4 GiB» quando parla
d'altro (il lavoro lungo). Dal lato export la simmetria è peggiore: un export di
tutto il vault in PDF produce un `Vec<ExportArtifact>` con dentro l'intero vault
reso.

- [ ] **Quale forma, che non è «aggiungere uno stream».** Al confine WASM non
      esiste un `Read`: le strade sono una `stream<u8>` di WASI, un metodo a
      **chunk** con un cursore tenuto dall'host, o lasciare i byte dove sono e
      dare al provider un **handle** opaco che l'host risolve — che è la stessa
      forma con cui la 0006 tiene fuori il filesystem, applicata al contenuto
      invece che al percorso. La terza merita d'essere guardata per prima proprio
      perché non contraddice la decisione: chi apre e chi legge resta l'host.
- [ ] **Il contenitore è la stessa domanda.** Il *resta fuori* della 0006 elenca
      «zip, cartelle: una sorgente per volta», e la riga sul dispatch spiega che
      `.docx`, `.epub`, `.odt` e mezzo mondo dei backup **sono lo stesso zip**.
      Un contenitore e uno stream non sono due voci: un archivio si sfoglia senza
      tenerlo in memoria o non si sfoglia, e decidere l'uno senza l'altro
      significa deciderlo due volte.
- [ ] **Chi lo chiede.** FEATURES 17 per intero (~120 voci, ~50 importer), 6.3
      (export PDF/Pandoc/Typst), 14.3 (email/EML, che sono archivi per natura).
      È anche l'unica famiglia in cui il difetto **non si vede provando**: un
      importer scritto su un vault di prova funziona, e fallisce sul vault vero
      di chi migra — cioè al primo contatto con un utente nuovo, che è il momento
      peggiore in cui questo progetto possa fallire.
- [ ] **Perché non è P0, e perché non aspetta comunque.** Un modo nuovo accanto a
      quello che c'è è additivo, e la 0006 lo dice. Ma il costo non è nella firma:
      è nei **cinquanta importer** che il 17.1 prevede, ognuno scritto contro la
      forma disponibile quel giorno. È lo stesso moltiplicatore della quarta
      domanda del [criterio](../todo.md) — non lo si paga aggiungendo la voce, lo
      si paga a ogni voce successiva.

### 23.7 Una data scritta come la scrive l'utente non è una data, e non c'è modo di dirlo

*kernel · **P2** — nessuna firma: `PropertyValue` c'è già e la via d'uscita è una regola, non un tipo*

La [0003](../decisions/0003-modello-del-documento.md) decide che *«solo
l'ISO-8601 a larghezza fissa è una data»*, con l'argomento giusto: *«`2026-7-5`
no: un parser tollerante trasformerebbe in date le stringhe dell'utente»*. Chi ha
visto un foglio di calcolo convertire un codice prodotto in una data sa che è la
regola giusta, e va tenuta.

Il prezzo è che un vault esistente — che è **il** caso d'uso, visto che questa app
si apre su vault altrui — porta le date come le ha scritte chi le ha scritte:
`2026-7-5`, `05/07/2026`, `5 luglio 2026`, o il formato che un plugin Obsidian
gli ha messo per anni. Tutte restano `Text`, e la conseguenza non è un errore: è
che il filtro non trova, il raggruppamento per giorno del 10.4 non raggruppa, e
**nessuno dice perché**. Una proprietà che non è una data si comporta esattamente
come una data che non c'è.

- [ ] **Dove sta la dichiarazione.** Il verbale la nomina già — *«sceglierle è lo
      schema per tipo nota, non un indovinello del parser»* — e quello schema è il
      §8.2 di FEATURES, che non esiste. Ma la [0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md)
      ha costruito nel frattempo un posto dove una dichiarazione del vault può
      stare, con due livelli e due cancelli: va deciso se il formato delle date è
      una **impostazione del vault** — una riga, additiva, disponibile domani — o
      se aspetta lo schema per tipo nota, che è un capitolo intero. Le due
      risposte non si escludono: la prima è il default della seconda.
- [ ] **La regola resta «non si indovina», e va scritta così.** Ciò che cambia non
      è la tolleranza del parser: è **chi** dichiara il formato. Un formato
      dichiarato dall'utente non è un indovinello, ed è la differenza esatta fra
      questa voce e la cosa che la 0003 ha giustamente rifiutato.
- [ ] **Il segnale, che è metà del difetto.** Anche prima di qualunque formato in
      più, una proprietà che *sembra* una data e non lo è dovrebbe potersi
      **vedere** — è la sesta domanda del [criterio](../todo.md), «cosa fallisce
      senza produrre nessun segnale», applicata a un dato invece che a un
      `Result`. Oggi la sola strada è aprire la nota e guardare.

### 23.8 Due file che differiscono per una maiuscola sono lo stesso arco

*kernel · **P2** — una regola in `rules/path.rs`; nessuna firma, ma la scelta va scritta dove sta la regola*

La `resolution_key` di `fub_abi::rules::path` fa `trim`, NFC e **`to_lowercase`**
su tutta la chiave, e la [0004](../decisions/0004-il-grafo-e-i-link-non-wiki.md) ne
dà la ragione in una riga che è difficile contestare: *«il vault sincronizzato
fra macOS e Linux è lo stesso vault»*. Un link scritto su un Mac deve risolvere
su Linux, e il caso è l'unica cosa che li separa.

Il prezzo è dall'altra parte, e il verbale non lo nomina: su un filesystem
case-sensitive `Nota.md` e `nota.md` sono **due file veri**, che un utente può
avere e che un client di sync può creare senza chiedere. Per il grafo sono una
chiave sola: i backlink dell'uno finiscono sull'altro, e una rinomina riscrive
riferimenti che puntavano altrove. Non è un link che non risolve — è un link che
risolve **al file sbagliato**, che è il modo peggiore in cui questa famiglia
possa rompersi, perché non lascia traccia.

- [ ] **La collisione va vista, prima ancora che risolta.** Due entry
      dell'anagrafe ([0046](../decisions/0046-l-anagrafe-del-vault.md)) che
      normalizzano alla stessa chiave sono un fatto che il kernel conosce già al
      `reconcile`: dirlo — come la [0090](../decisions/0090-una-sequenza-e-una-modalita-che-scade.md)
      dice i conflitti di scorciatoia all'avvio, guardando il registro fermo —
      costa poco e toglie la parte silenziosa del difetto.
- [ ] **Se l'esatto vince quando c'è.** È la stessa forma della regola che la 0004
      ha già scritto per l'estensione — *«prima l'esatto, poi il senza»* — e
      applicarla al caso sarebbe coerente: `[t](Nota.md)` prende `Nota.md` se
      esiste, e ricade sulla chiave normalizzata solo se non c'è. Va misurato
      contro l'invalidazione incrementale, che oggi dipende da un paio di chiavi
      d'indice e che il test di proprietà `graph_incremental.rs` presidia.
- [ ] **Perché è P2 e non si chiude da sola.** Nessuna firma, e il caso è raro. Ma
      «raro» qui vuol dire *raro finché il vault sta su un disco solo*: è la
      famiglia del sync (FEATURES 18), dove due macchine con due filesystem
      diversi sono il presupposto, non l'eccezione — la stessa ragione per cui la
      [§23.1](#231-una-rinomina-fatta-ad-app-chiusa-scollega-tutto-ciò-che-è-indicizzato-per-path)
      esiste.

### 23.9 Il registro non si spegne, e per una modifica chirurgica porta i byte dell'utente

*kernel · **P1** — un interruttore è una chiave di impostazione, additiva; ciò che va deciso è **cosa** spegne*

La [0067](../decisions/0067-il-registro-di-cio-che-e-successo.md) ha fatto
`.fub/journal.jsonl`, e le due scelte che lo reggono sono giuste tutte e due. È
**autorevole** — non si butta e non si rifà — perché un registro di ciò che è
successo che si possa perdere non serve a niente. E non è spegnibile **apposta**:
il verbale usa la spegnibilità del versioning come argomento contro, e la frase è
buona, *«un tutto-o-niente vero finché qualcuno non tocca un interruttore non è un
tutto-o-niente»*.

Il verbale dichiara anche il prezzo, e con la lucidità che è l'abitudine di questo
repo: *«un registro delle mutazioni nomina i path di ogni nota toccata e quando lo
è stata, cioè è più rivelatore in chiaro di quanto lo sia una nota sola»*. Quello
che nessuno ha sommato è la riga accanto. `Journal::Edited` porta `inverse:
EditRequest`, e un `EditRequest` porta `edits: Vec<TextEdit>`, cioè **il testo
sostituito** — il doc di `journal.rs` lo dice esatto: «porta i byte sostituiti e
non il documento». Le altre varianti no: `Written` porta impronte e non testo, ed
è una distinzione fatta con cura.

Sommate, le due righe dicono una cosa che nessuna dice da sola: **dentro il vault
c'è un file in chiaro, non spegnibile e che l'utente non ha nessun comando per
cancellare, il quale contiene frammenti delle note dell'utente e sopravvive alla
cancellazione delle note da cui vengono**. L'unica cosa che li porta via è il
`TETTO` di diecimila record, che pota il più vecchio a ogni apertura — cioè una
scadenza che dipende da quanto si scrive e non da cosa si vuole far sparire. Chi
svuota il cestino
per far sparire qualcosa non lo fa sparire. E `versioning.enabled` esiste, quindi
l'utente che ha spento il versioning *credendo* di aver spento la conservazione
delle versioni vecchie del proprio testo si sbaglia.

- [ ] **Distinguere le due domande, che il verbale tratta come una.** «Il journal
      si può spegnere» e «il journal conserva contenuto» non sono lo stesso
      interruttore. La seconda si chiude senza toccare la prima: un `Edited` che
      porta gli **span** dell'inverso e non i byte perde la capacità di annullare e
      tiene tutto il resto. Va deciso se l'annullamento vale quel prezzo, e la
      risposta plausibile è che valga — ma allora va scritta, perché oggi la si è
      presa senza porla.
- [ ] **Se un interruttore ci va, cosa spegne.** Le opzioni non sono
      equivalenti: spegnere la **scrittura** del journal (e allora l'audit del
      23.3 di FEATURES nasce bucato), spegnere il solo **contenuto** dentro gli
      inversi, o tenerlo acceso e dargli una **scadenza** — che è la forma che il
      tetto dei diecimila record già suggerisce, applicata al tempo invece che al
      numero. La terza non contraddice la 0067: un registro autorevole può avere
      una finestra dichiarata senza smettere di essere autorevole.
- [ ] **La cancellazione va dove sta il potere.** La
      [0086](../decisions/0086-una-cronologia-e-la-sua-porta.md) ha già la regola
      per un dato di questa specie — la dichiarazione sta nel registro,
      l'esecuzione sta dove sta il potere — e la cronologia ha un comando che la
      cancella. Il journal no. Se resta senza interruttore, un comando che lo
      **pota** è il minimo che la stessa regola imponga.
- [ ] **Chi lo chiede.** FEATURES 23.1 (cifratura at-rest: un file che il
      supporto cifra è un file che qualcuno ha deciso essere sensibile, e questo
      lo è per ammissione del suo verbale), 23.3 (audit), 24.2. E il patto del
      progetto: un vault è dell'utente, e ciò che l'utente cancella deve poter
      sparire.

### 23.10 Le bozze si leggono con il permesso di leggere il vault

*chiusa dalla [0096](../decisions/0096-una-bozza-non-e-una-nota.md) — `Capability::Drafts` con `fub:read-drafts`, **al posto** di `Query` e non sopra, così che l'utente possa dire tutt'e due le frasi: «puoi cercare nelle mie note, non ciò che sto scrivendo adesso» e «puoi ritrovare ciò che non ho salvato, il resto del vault no». L'**insieme** con la §23.5 era già saltato — la 0095 l'ha chiusa da sola —, ed è un quarto modo di invecchiare: una voce che dichiara un ordine e viene scavalcata da quella con cui doveva stare insieme. La casella «il caso migliore» era vera: **zero chiamanti**. Il cancello porta le famiglie a diciassette, cioè oltre i bit dell'`u16`*

La [0088](../decisions/0088-cio-che-non-e-ancora-successo.md) contiene la frase
più netta che un verbale di questo repo abbia scritto sulla privacy: *«il testo
che l'utente non ha ancora salvato è il dato più privato che un vault contenga»*.
Da lì deduce, e bene, che la **scrittura** delle bozze non sarà mai una capacità:
non `draft_write`, non ora e non a M5.

Poi concede la **lettura** sul canale di tutti — `IndexQuery::Drafts` — con
l'argomento della [0085](../decisions/0085-leggere-non-e-cambiare.md): *«leggere
non è cambiare»*, e *«ritrovare ciò che si stava scrivendo è la lettura più
innocua che ci sia»*. L'argomento è vero e risponde alla domanda sbagliata.
«Leggere non è cambiare» protegge l'**integrità**; la frase di due paragrafi sopra
parlava di **riservatezza**, e contro quella minaccia leggere è esattamente il
verbo che conta. Un plugin che legge le bozze e le manda altrove non cambia nulla.

E il permesso non c'è. Il `Guard` non distingue le varianti di query: `Drafts`
passa da `Capability::Query`, che mappa su `permission::READ_VAULT`, e nell'elenco
dei permessi non esiste nulla che nomini le bozze. Quindi **qualunque plugin che
possa leggere un documento salvato può leggere ciò che l'utente sta scrivendo in
questo momento**, e le due cose sono concesse dalla stessa spunta nello stesso
manifest.

- [x] **È la stessa voce della §23.5, con un altro soggetto.** Là il testo
      selezionato viaggia sotto una capacità che nessun manifest dichiara; qui il
      testo non salvato viaggia sotto un permesso che ne governa un altro. Le due
      si decidono insieme o si decidono due volte, perché la risposta è la stessa
      domanda: **il contenuto che l'utente non ha consegnato al disco è una classe
      a sé, o è vault come il resto?** Se è una classe a sé, il permesso è uno solo
      e copre entrambe.
- [x] **Il verso in cui si sbaglia, e va scelto adesso.** Una bozza non è una nota
      che si può rileggere dal disco: è l'**unica copia** di quel testo, e la
      [§23.1](#231-una-rinomina-fatta-ad-app-chiusa-scollega-tutto-ciò-che-è-indicizzato-per-path)
      lo scrive già («una bozza orfana è l'unica copia rimasta»). Un permesso di
      troppo costa a un plugin una riga di manifest; un permesso di meno costa
      all'utente il testo che stava scrivendo.
- [x] **Chi legge oggi, e se gli serve.** Il cliente vero delle bozze è il
      recupero dopo un crash, che è della shell e non passa dal confine. Va
      verificato se **qualche** provider registrato interroghi `Drafts`: se la
      risposta è nessuno, il cancello non costa niente a nessuno e la voce si
      chiude in una riga — che è il caso migliore e va guardato per primo.
- [x] **Perché prima della §23.3.** Identico all'ordine che la §23.5 dichiarava
      per sé: finché non c'è rete, chi legge le bozze non ha dove mandarle. Il
      giorno che `http_fetch` entra, ce l'ha — e le due voci non si sono mai
      incontrate perché stanno in due verbali diversi. La §23.5 è stata chiusa
      per prima dalla
      [0095](../decisions/0095-cosa-guardo-e-cosa-sto-scrivendo.md), quindi il
      posto in cui questa casella atterra esiste già: c'è una famiglia di
      permessi della sessione, e la domanda da farsi è se le bozze ci
      appartengano o vogliano il loro.

### 23.11 La base di una scrittura è facoltativa, e la passa un chiamante solo

*chiusa dalla [0092](../decisions/0092-una-base-si-dichiara.md) — `base` diventa un `WriteBase` a due casi nominati: scrivere ciechi resta possibile e smette di essere ciò che succede omettendo · secondo ritaglio sulla stessa firma in tre commit, e sta scritto*

La [0089](../decisions/0089-da-cosa-e-partita-una-scrittura.md) ha aggiunto a
`write_document` il parametro che mancava, e l'argomento per cui è `Option` è
buono: ci sono chiamanti che non discendono da niente — un importer, un template —
e per loro `None` significa *«scrivi, questo testo non viene da un testo di
prima»*, che è vero e non è un'omissione.

Il prezzo lo dichiara il verbale — tre chiamanti interni «scrivono ciechi» — e i
sorgenti di oggi dicono che sono di più: `transfer.rs`, `versioning.rs`,
`host/kernel.rs`, `workspace.rs`, `session.rs` passano `None` o chiamano la forma
a due argomenti, e l'**unico** che passa una base vera è la shell, da
`panels/document.ts`. Il default del parametro anche lì è `null`.

Messo accanto alla [0030](../decisions/0030-il-rilevamento-si-puo-chiedere.md),
diventa la cosa che nessuno dei due verbali dice: la guardia contro la
sovrascrittura è **opt-in proprio dove il rilevamento non c'è**. Con `watching:
false` — vault su share di rete, cloud drive, vault sincronizzato — il watcher non
vede la modifica esterna *e* il salvataggio non porta la base, quindi il lavoro di
qualcun altro sparisce senza che nessuno dei due meccanismi possa accorgersene.
La 0030 lo nominava come residuo e lo rimandava al §18.1; la 0089 ha costruito
l'attrezzo e l'ha lasciato facoltativo.

- [x] **Obbligatoria, con un modo esplicito di dire «da niente».** La forma che
      chiude la voce non è togliere l'`Option`: è renderla un'**enum** con due
      casi nominati — «discende da questa revisione» e «detta, e la sovrascrittura
      è voluta» — così che scrivere ciechi resti possibile e diventi una cosa che
      si **dichiara** invece che una che si omette. È la stessa regola che la
      [0007](../decisions/0007-contesto-di-sessione.md) scrive per lo span: «un
      flag che chiunque può dimenticare di leggere protegge meno di un campo che,
      quando non è vero, non c'è».
- [x] **I chiamanti interni vanno passati uno per uno**, e non tutti hanno la
      stessa risposta: il versioning che ripristina una versione **detta** davvero,
      l'import pure; `session.rs` e `workspace.rs` che salvano per conto della
      shell no. La distinzione esiste già nel verbale, non è mai stata applicata al
      codice.
- [x] **Perché è P0.** `Option<Revision>` → un tipo con due casi è un **parametro
      ritipato**, che è fra le diciannove rotture che
      [`wit_additivity`](../architecture/wit-congelato.md) fa diventare rosse. Dopo
      M4 costa una major, e la via additiva — un secondo metodo accanto — è la
      trappola delle due firme per la stessa domanda che la 0007 descrive e la
      [§23.4](#234-selection-ne-porta-una-sola-e-il-tipo-di-un-campo-non-è-additivo)
      ripete. **Oggi costa un tipo.**
- [x] **Chi lo chiede.** FEATURES 3.1 (share di rete), 2.3 (modifiche esterne),
      18.1 (sync). La stessa famiglia della §23.1, e per la stessa ragione: sono
      le voci in cui il vault non è di Fub soltanto.

### 23.12 Un troncamento che il chiamante non può vedere

*chiusa dalla [0094](../decisions/0094-un-tetto-che-si-fa-sentire.md) — `random-bytes` rende `result<list<u8>, plugin-error>`: chi riceve `ok` riceve esattamente `n` byte, e i due modi di non riceverli hanno un nome. Il tetto resta fuori dal contratto, perché ciò che va garantito è che superarlo si dica, non quanto vale*

La [0039](../decisions/0039-il-locale-e-il-caso.md) ha messo un tetto a
`random_bytes` — `MAX_RANDOM_BYTES = 1024` — e la scelta è dichiarata in tre posti,
documentata sul trait (*«oltre, l'host rende ciò che può»*) e blindata da un test
che si chiama `the_ceiling_holds_and_does_not_fail`. Il tetto in sé non è il
difetto: un host che non si lascia chiedere un gigabyte di entropia fa il suo
mestiere.

Il difetto è che il tetto è **muto**. La firma è `random-bytes: func(n: u32) ->
list<u8>`: non c'è un `Result`, non c'è un campo, non c'è un evento. Chi chiede
4096 byte ne riceve 1024 e **l'unico modo di saperlo è misurare la lunghezza di
ciò che è tornato** — cioè ricordarsi di controllare una cosa che nella firma non
è segnalata. Il verbale dichiara la scelta; quello che non è stato fatto è
applicarle la sesta domanda del [criterio](../todo.md), *cosa fallisce senza
produrre nessun segnale*, che quel giorno esisteva già.

- [x] **La forma, che è piccola e va scelta comunque adesso.** La prima delle
      tre — `result<list<u8>, plugin-error>` — e fa anche il lavoro della
      seconda. La seconda è stata scartata due volte: non risolve il permesso
      negato, cioè lascia in piedi il peggiore dei due difetti mentre sistema il
      minore, e nel WIT non ci sono costanti, quindi «il tetto nel contratto»
      vuol dire una `func() -> u32` che congela 1024 per sempre. La terza è la
      firma preparata senza chiamante, rifiutata cinque volte di fila dalla 0077
      alla 0093. Una **quarta** è stata valutata — un `variant random-error {
      too-much(u32), denied }`, che renderebbe il tetto leggibile a macchina
      senza prometterlo — e scartata perché costa un vocabolario d'errore
      parallelo a quello che c'è: dalla
      [0041](../decisions/0041-un-errore-e-testo-che-qualcuno-legge.md) in poi un
      errore è testo che qualcuno legge, e `bad-args`/`permission-denied` dicono
      già esattamente le due cose.
- [x] **Quanto pesa davvero, detto senza gonfiarlo.** Poco, e resta vero: nessuno
      chiede più di 1024 byte, e la decisione della 0039 sulla qualità del flusso
      non è stata riaperta. Ma la voce **pesava su una cosa sola e ce n'erano
      due**: accanto al troncamento c'era un `Vec::new()` che rispondeva al
      permesso negato, cioè una **politica travestita da dato** — la famiglia
      della [0013](../decisions/0013-elenco-delle-capacita.md) e della 0021, non quella di un tetto, e il
      più grave dei due. Il guadagno vero non è nel tetto: è che il rifiuto ora
      dice *perché*, che `user_locale` è stata assolta con un argomento invece
      che per inerzia, e che il censimento delle capacità senza esito — fermo
      dalla 0021, e che ne mancava **due** — è tornato giusto.
- [x] **La regola generale, che vale oltre questa capacità.** La domanda era
      quale delle due forme esistenti fosse *la* regola, e la risposta è la 0034:
      **un limite dell'host non deve essere interrogabile, deve essere visibile
      quando morde**. L'`Event::Overflow` pubblica la perdita e non la soglia del
      bus; i tetti della
      [0049](../decisions/0049-una-posizione-dentro-un-documento.md) si dicono
      nella risposta, non in una funzione che li annunci. `random-bytes` era il
      solo posto del confine in cui l'invariante era falsa, e il tetto resta
      fuori dal contratto **perché** quella è la regola — non per pigrizia.
      Guadagno collaterale: 1024 resta alzabile senza rompere nessuno. E ne è
      nata una regola gemella che la voce non chiedeva, sui **fallback muti**: è
      onesto quando la risposta nulla è già un caso del dominio, disonesto quando
      è un valore inventato per occupare il posto di un errore.

### 23.13 Un vault che arriva da fuori rimappa la tastiera

*kernel · **P1** — chiusa dalla [0100](../decisions/0100-i-tasti-che-arrivano-da-fuori.md) — due delle tre strade non esistevano più, e la domanda non era «un vault mai visto» ma «ho già visto questi tasti»*

La [0076](../decisions/0076-le-impostazioni-vivono-nel-vault.md) ha spostato le
impostazioni dentro il vault e nel farlo ha **smontato esplicitamente**
l'argomento di rischio, declassandolo a precauzione: un vault che decide il tema,
la lingua e il formato dell'ora di chi lo apre fa una cosa visibile e reversibile,
e il fastidio non giustifica la complicazione. Su tema e lingua la conclusione è
giusta.

Poi la [0077](../decisions/0077-una-scorciatoia-e-una-chiave.md) ha fatto delle
scorciatoie una **chiave di impostazione**, ed è un'ottima decisione — è ciò che
ha reso la tastiera configurabile, chiudendo un falso positivo di questa stessa
seduta. Il verbale dichiara anche dove nascono: *«nascono nel vault senza dire
niente… viaggiano col vault come il tema e la lingua»*, e i sorgenti confermano —
`SettingSpec::new` ha `scope: SettingScope::Vault` di default e la fabbrica delle
scorciatoie non chiama `per_machine()`.

Il prodotto delle due non l'ha guardato nessuno, e non è tema e lingua. **Un vault
che arriva da fuori — un repo clonato, una cartella condivisa, un vault di esempio
scaricato — rimappa i tasti di chi lo apre**, e fra i comandi che può rimappare ci
sono quelli che cancellano. La differenza con il tema non è di grado: un tema
sbagliato si vede, una scorciatoia spostata si scopre premendola.

- [x] **Quale metà si sposta.** La terza — viaggiano e vengono **dichiarate** —
      ma le altre due non erano alternative: erano già impossibili, e la voce non
      lo sapeva. `per_machine()` non costa solo la cosa buona della 0077: farebbe
      **mentire il vocabolario**, perché oggi `SettingScope::Machine` vuol dire
      «il valore del vault è ignorato con un avviso» e la 0076 ha riservato quella
      parola a ciò che *«non può dipendere da un vault aperto»* — falso di una
      scorciatoia. E il «livello macchina vince» la voce lo dà per esistente,
      *«già la forma dei due livelli della
      [0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md) letta al
      contrario»*: la scala non c'è più, la **0076 l'ha cancellata apposta**,
      quindi rimetterla per una famiglia sola è riscrivere «prima guardo qui, poi
      lì». Anche il criterio della terza era sbagliato — «un vault **mai visto**»
      non è la domanda, perché un vault aperto ieri riceve tasti nuovi stanotte da
      un sync e la riga nel registro nasce alla prima apertura, non a una risposta.
      La domanda che regge tutti e due i casi è *«ho già visto **questi** tasti»*.
- [x] **Il criterio che manca, ed è più largo di questa voce.** Non taglia in due
      ma in **tre**, e non per chi descrive: per **che cosa può fare il valore
      peggiore**. *Una sottrazione non concede* (`plugins.disabled`, i permessi
      della [0098](../decisions/0098-un-permesso-si-vede-e-si-nega.md): il peggio è
      il default che l'utente ha già accettato). *Si vede e si disfa* (tema,
      `locale.*`, pesi della ricerca, feature accese — la frase della 0076, che per
      questa specie resta vera). *Cambia cosa fa un gesto dell'utente* (oggi solo
      `keys.*`, e il valore non si vede finché non lo premi). Il tema descrive chi
      guarda ed è innocuo: era la riga della voce a tagliare nel posto sbagliato.
- [x] **Non è la stessa cosa di un plugin ostile**, e la conclusione regge:
      niente permesso, niente sandbox, nessuna chiave che un vault non possa
      contenere. A M4 il valore del cancello è la **dichiarazione**, non
      l'imposizione. Il prezzo misurato però è più alto di come la voce lo racconta:
      `vault.undo` è l'**unico** comando che dichiari una scorciatoia, quindi un
      vault estraneo non ne sposta una — ne **arma** una che non c'era, senza
      nessuna abitudine che protegga, e `trash.empty` non ha parametri e porta
      `.irreversible()`. Assolta invece la porta grossa: `settings.import` passa già
      da `program_writable`.
- [x] **Chi lo chiede.** Serviti tutti nella stessa forma, perché la domanda sta
      sulla **chiave** e non sull'elenco dei comandi: FEATURES 1.4, 17.1 e 25 non
      chiedono niente di nuovo, e la §16.3 nemmeno — quando la tastiera della shell
      diventerà configurabile come le altre, i comandi rimappabili dall'esterno
      saranno tutti e questa domanda li coprirà senza cambiare forma.

### 23.14 Un'operazione a metà non sa di essere a metà

*contratto · **P1** — l'esito parziale è una forma che manca a tre posti diversi; il rollback invece è già scrivibile*

Tre verbali dichiarano lo stesso buco su tre superfici, e nessuno dei tre lo
nomina come lo stesso buco. La [0011](../decisions/0011-il-lotto.md): *«se una
delle N scritture fallisce le altre restano fatte»*. La
[0041](../decisions/0041-un-errore-e-testo-che-qualcuno-legge.md): *«il successo
parziale non è esprimibile»*. La [0045](../decisions/0045-l-undo-ha-due-pile.md),
che è il caso peggiore perché il danno arriva dopo: `vault.archive` compone gli
inversi dei passi riusciti, *«ma la voce risultante non dice che è parziale, e chi
la annulla non sa che stava disfacendo undici note su dodici»*.

Il **rollback** non è questa voce e va tolto di mezzo: da quando il journal c'è
([0067](../decisions/0067-il-registro-di-cio-che-e-successo.md)) una transazione
di lotto è scrivibile, e [strozzature.md](strozzature.md) lo assegna già a chi la
userà. Ciò che resta è più stretto e non lo risolve il journal: **anche
un'operazione che nessuno vuole annullare deve poter dire di essere riuscita a
metà**, e oggi ha solo due parole, riuscito e fallito.

- [ ] **Dove va la forma.** Non è un tipo nuovo per ogni superficie: è una
      risposta alla domanda *«di N cose, quante e quali»*, e i posti che la vogliono
      sono l'esito di un lotto, l'esito di un comando
      ([0010](../decisions/0010-comando-descritto-a-una-macchina.md)) e la voce di
      undo. Va deciso se è un campo su `CommandOutcome`, un `Trouble` accanto
      all'esito riuscito — la strada della
      [0052](../decisions/0052-cio-che-va-storto-e-un-evento.md), che costa meno —
      o una terza variante, che è la più chiara e la più invasiva.
- [ ] **L'undo è il caso che decide.** Una voce di undo parziale che si presenta
      come intera è l'unico punto in cui questo buco **produce un secondo danno**:
      l'utente annulla credendo di rimettere le cose come stavano e ne rimette
      undici su dodici. Anche senza nessuna delle forme qui sopra, quella voce deve
      portare il proprio conto — ed è la cosa da fare per prima perché non aspetta
      nessuna decisione.
- [ ] **Perché non è P0.** Un campo in più su un record è la migrazione che la
      0007 descrive, ma qui la strada del `Trouble` accanto all'esito non tocca
      nessuna firma esistente: è una variante già additiva su un canale che c'è. La
      scadenza era semmai quella della §23.11, con cui condivide il verso — un
      chiamante che non sa di aver fatto metà lavoro e uno che non sapeva di aver
      sovrascritto sono lo stesso silenzio. Quella metà l'ha chiusa la
      [0092](../decisions/0092-una-base-si-dichiara.md), e il modo in cui l'ha
      chiusa vale anche qui: non si toglie il caso silenzioso, gli si dà un nome.

### 23.15 La rete che regge i panici non ha un presidio, ha una nota

*presidi · **P2** — una riga di `Cargo.toml` e un test che la legga; il costo è tutto nell'attesa*

La [0032](../decisions/0032-il-runner-dei-job.md) ha messo un `catch_unwind`
intorno a ciò che i componenti eseguono, e nel farlo ha scritto la riga esatta del
rischio: *«`catch_unwind` presuppone che il panico srotoli. Un profilo con `panic
= "abort"` farebbe sparire questa rete in silenzio; il workspace non lo imposta, e
se un giorno lo facesse questa è la riga da rileggere»*.

Il workspace non lo imposta davvero — verificato: non c'è `panic = "abort"` in
nessun `Cargo.toml`, e non c'è nemmeno un `[profile.release]`. Quindi oggi non
c'è nessun difetto. Quello che c'è è una **casella indirizzata a nessuno**, ed è
la forma che [todo.md](../todo.md) ha già imparato a diffidare: *«un indirizzo
dice chi potrà, non chi lo farà»*. Qui l'indirizzo è ancora meno di così — è una
riga di prosa dentro un verbale immutabile, che chiede a un lettore futuro di
ricordarsi di rileggerla nel momento esatto in cui aggiunge un profilo di
release, che è il momento in cui non la sta leggendo.

E il test che copre il comportamento non aiuta: `il_panico.rs` verifica che la
rete tenga, ma sotto `panic = "abort"` quel test **abortirebbe il processo**
invece di fallire con un messaggio. Non è un presidio, è la prima vittima.

- [ ] **Il presidio, che è piccolo.** Un test che legga il profilo effettivo e
      fallisca se `panic` è `abort` — la stessa specie di
      [`wit_additivity`](../architecture/wit-congelato.md) e del test che conta i
      verbali della [0072](../decisions/0072-un-numero-si-scrive-accanto-a-come-si-ricava.md):
      un'affermazione scritta in un documento che diventa una cosa che il
      compilatore o la CI sa verificare. È il criterio della
      [§16.7/§16.8](16-crate-sdk-banchi-di-prova.md) applicato a un fatto del
      `Cargo.toml` invece che a un elenco.
- [ ] **Perché ha senso farlo prima che serva.** Un `[profile.release]` con
      `panic = "abort"`, `lto` e `strip` è la prima cosa che si aggiunge quando si
      guarda la dimensione del binario — cioè quando si prepara una release, che è
      il momento peggiore per scoprire di aver disattivato la rete che protegge
      l'utente dai plugin. Il costo di scriverlo adesso è mezz'ora; il costo di
      scriverlo dopo è che non lo si scrive.
- [ ] **La domanda vera sta sotto, e va posta una volta.** Se un giorno il profilo
      lo volesse davvero, la risposta non è «allora niente `catch_unwind`»: è che
      un componente che pania va isolato altrove — il processo separato, o il guest
      WASM di M5, che quella proprietà ce l'ha per costruzione. Vale la pena
      scriverlo accanto al presidio, perché è la ragione per cui il presidio non è
      un divieto per sempre.

### 23.16 Su Windows un hardlink si stacca in silenzio

*kernel · **P2** — nessuna firma: una funzione che su una piattaforma sa rispondere solo «no»*

La [0065](../decisions/0065-una-scrittura-o-c-e-o-non-c-e.md) ha deciso bene due
volte: la scrittura è temp+rename+fsync, e dove l'inode ha **altri titolari** —
symlink, hardlink — si scrive sul posto, perché la rename farebbe un danno
peggiore che una scrittura non atomica. Rinunciare all'atomicità in quel caso è la
scelta giusta, e il verbale la argomenta.

Il rilevamento però non è portabile. `condiviso()` conta `nlink` sotto `#[cfg(unix)]`
e su tutto il resto risponde **`false` costante**, perché `std::fs::Metadata` su
Windows non espone il conteggio. Il commento accanto lo ammette per esteso —
*«Windows sa avere hardlink e sa contarli, ma non attraverso `std::fs::Metadata`…
Il caso resta scoperto, e questa riga è il posto dove si vede»*.

La conseguenza è la peggiore della famiglia: su Windows un file con più nomi prende
la strada della rename, e la rename **stacca l'hardlink**. Il secondo nome resta
congelato al contenuto vecchio, senza errore e senza avviso. È esattamente il
«danno certo e muto» che il verbale dice di voler evitare, non evitato lì. (I
symlink invece funzionano ovunque: quel ramo passa da `symlink_metadata` e non da
`nlink`.)

- [ ] **La via che esiste, e va misurata.** Windows il conteggio ce l'ha —
      `GetFileInformationByHandle` restituisce `nNumberOfLinks` — quindi la
      domanda non è *se* si può, è se vale una dipendenza (`windows-sys`) o una
      chiamata FFI diretta su un progetto che ha una politica severa sulla supply
      chain ([0001](../decisions/0001-supply-chain-e-sbom.md)). Va guardato anche
      il verso conservativo: se il conteggio non si può avere, **scrivere sul posto
      sempre** su quella piattaforma è un'opzione — costa l'atomicità a tutti per
      proteggere pochi, ed è probabilmente troppo, ma va scartata avendola detta.
- [ ] **Il presidio, che oggi non può esistere.** Nessun test di questo repo gira
      su Windows, quindi il caso non è solo scoperto: è **inosservabile**. È la
      §17.2 vista da un lato che quella voce non nomina — non «i test della shell»
      ma i test di ciò che cambia con la piattaforma, di cui questo è il primo
      esemplare vero.
- [ ] **Perché è P2 e perché non si chiude da sola.** Nessuna firma, e chi tiene
      hardlink dentro un vault è raro. Ma è la stessa parola «raro» della
      [§23.8](#238-due-file-che-differiscono-per-una-maiuscola-sono-lo-stesso-arco):
      raro finché il vault sta su una macchina sola e non lo tocca nessun altro
      strumento — e gli hardlink dentro un vault li mettono precisamente gli
      strumenti che questo progetto promette di non ostacolare.

### 23.17 Tre permessi nuovi in tre commit, e nessuno li mostra a chi deve accettarli

*chiusa dalla [0098](../decisions/0098-un-permesso-si-vede-e-si-nega.md) — una chiave d'impostazione per ogni coppia componente-permesso, concessa finché qualcuno non dice di no; la frase la scrive la shell, perché chi chiede un permesso non deve poter scrivere la frase con cui glielo si concede*

Questa voce esiste perché una riga si è ripetuta tre volte. La
[0095](../decisions/0095-cosa-guardo-e-cosa-sto-scrivendo.md) chiude il suo
«cosa resta fuori» con *«resta fuori il pannello che i permessi li mostra»*; la
[0096](../decisions/0096-una-bozza-non-e-una-nota.md) la ripete per
`fub:read-drafts`; la
[0097](../decisions/0097-un-recinto-che-vale-anche-quando-nessuno-guarda.md) per
`fub:network`. Tre permessi nuovi in tre commit, tutti comparsi in `PluginInfo`
da soli — cioè nel dato che l'inventario porta alla shell — e **nessuna
superficie che li renda leggibili a chi dovrebbe deciderli**.

La terza volta è il momento in cui questo repo smette di dichiarare e comincia a
contare, ed è la stessa diagnosi che la
[§16.7](16-crate-sdk-banchi-di-prova.md) fa agli elenchi: *chi lo legge, lo
trova?* Una riga in fondo a un verbale la legge chi apre quel verbale.

- [x] **Perché adesso pesa più di prima, e non è «uno in più».** I permessi
      della 0095 e della 0096 sono **binari**: vederli o no cambia se l'utente
      sa. `fub:network` ha un **parametro che è il permesso stesso** — la
      differenza fra `["api.acme.com"]` e nessun elenco è la differenza fra un
      plugin che parla con un servizio e uno che può mandare le note dell'utente
      ovunque, e la 0097 ha scelto **deliberatamente** di lasciare quella
      differenza fuori dal cancello (senza parametro = qualunque host, per la
      regola uniforme di `OptionMap`) proprio perché *«ciò che cambia resta dove
      deve, cioè nella frase che l'utente legge accettando»*. Quella frase oggi
      non gliela legge nessuno: **il verbale ha delegato a una superficie che
      non esiste**, ed è la ragione più forte per cui questa voce non può
      restare una riga.
- [x] **Cosa va deciso, che non è «si fa un pannello».** Se i permessi si vedono
      **prima** (un momento di accettazione all'installazione, che è la forma
      che il patto suggerisce) o **dopo** (un'ispezione nelle impostazioni, che
      è quello che la [0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md) ha già come
      casa). Se sono **negabili uno per uno** — e qui la risposta sembra sì,
      perché il `Guard` lo regge già: `Granted` calcola la maschera dai permessi
      del manifest, e togliere una chiave è una sottrazione che il kernel
      applica senza sapere chi l'ha decisa. Se una **revoca** a plugin montato
      ha effetto subito: la 0097 ha scritto la riga che dice di sì per la rete
      (`JobHost::fetch` rilegge il permesso a ogni chiamata invece di catturarlo
      all'avvio del job), ed è un precedente da onorare o da contraddire con un
      argomento.
- [x] **Il dato c'è già, ed è metà del lavoro fatto.** `PluginInfo` porta i
      permessi con i loro parametri, e la 0042 ha il catalogo che non compila se
      una chiave manca — quindi le frasi in italiano hanno dove stare e un
      presidio che le pretende. Ciò che manca è chi le dispone e chi le legge.
      Va misurato invece che assunto: **quante** chiavi sono oggi dichiarabili,
      e quante di quelle hanno un parametro che cambia cosa si può fare (oggi
      una sola, `fub:network`).
- [x] **Perché è P1 e non P0.** Nessuna firma del contratto cambia: è shell e
      un pezzo di §7.6. Ma è l'unica voce di questa seduta il cui costo cade
      **interamente sull'utente** invece che su chi scrive plugin — un permesso
      invisibile non fa fallire niente, fa solo sì che una scelta che era sua la
      prenda qualcun altro al posto suo. Ed è anche la voce che rende vere, a
      posteriori, quattro decisioni già prese: finché non c'è, la parte
      «l'utente può vederla e negarla» del valore che 0021, 0095, 0096 e 0097
      attribuiscono ai loro cancelli è una promessa scoperta.
