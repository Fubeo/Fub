# 0111 — Il budget è un tetto sul lavoro, non sui fatti

**Stato**: accolta
**Data**: 2026-08-06
**Chiude**: [§20.5](../roadmap/20-quando-qualcosa-va-storto.md#205-il-budget-del-dispatch-tronca-senza-guardare-cosa-sta-troncando) — e con lei la [seduta 20](../roadmap/20-quando-qualcosa-va-storto.md) intera
**Commit**: *(questo commit)*

---

## La domanda

Un drenaggio della coda eventi ha un tetto: mille e ventiquattro consegne, e poi
si tronca. Serve a fermare due handler che si rimbalzano eventi a vicenda senza
convergere — cioè a mettere un limite al **lavoro**. Quando quel limite
scattava, però, il dispatcher faceva `self.pending.clear()`: buttava la coda
intera, senza chiedersi cosa ci fosse dentro.

La domanda che la voce poneva, e che va tenuta perché è quella giusta: *se un
budget esiste per fermare una cascata, perché la ferma buttando via anche ciò
che la cascata non ha causato?*

## La decisione, in una riga

> **Il budget è un tetto sul lavoro, non sui fatti.** Quando finisce, ciò che si
> riscopre riguardando il vault diventa un `Overflow` — «riconcilia da zero», che
> è più forte di ognuno dei singoli eventi buttati — e ciò che porta l'unica copia
> di un fatto si consegna lo stesso.

E la regola che decide quale delle due cose sia un evento non si scrive una
terza volta: si sposta nel contratto, accanto alla classificazione da cui
dipende. `fub_abi::rules::events::degrade` era il fondo del ponte verso la
shell; adesso è del contratto, e il budget del dispatch la chiama invece di
rispondersi da sé.

## La falsa alternativa, ed è il pezzo di progetto del giro

La voce chiedeva di scegliere fra due strade: **conservare** ciò che non è
recuperabile, oppure **dire quanti** non recuperabili si sono buttati. La prima
«costa una partizione della coda», la seconda «costa un campo e non ripara
niente».

Misurandole si scopre che non sono alternative, e che nessuna delle due basta.

Applicata da sola, la prima **spegne il segnale proprio nel caso per cui il
budget esiste**. Il presidio storico del troncamento
(`dispatch_budget_stops_infinite_event_loops_loudly`) è un ping-pong di
`Event::Custom`, e un custom **non è recuperabile**: il suo payload non lo
ricostruisce nessuno. Conservando ciò che non è recuperabile, in quella coda non
c'è niente da buttare — quindi nessun `Overflow`, quindi un troncamento
perfettamente muto. Quel test diventa rosso, ed è la misura che ha riprogettato
la seconda metà di questa decisione.

Il perché è che i fatti da salvare sono di **due specie**:

- quelli **già in coda** quando il budget finisce. Sono una fotografia, quindi
  sono finiti: si consegnano, e il tratto finale resta limitato senza bisogno di
  un secondo budget da indovinare;
- quelli che gli handler emettono **mentre ricevono** quel tratto finale. Questi
  non si possono consegnare, e non è una scelta: un handler che risponde a ogni
  evento con un evento non si ferma da sé, e la terminazione è l'unica ragione
  per cui il budget esiste.

Per i primi vale la prima strada, per i secondi la seconda. «Non si può
consegnare» e «non si può dire» sono due cose diverse, e confonderle era il
difetto della voce un passo più in là: quei fatti adesso si **contano**, e il
conto esce in un ultimo `Overflow` che è l'ultima cosa che un drenaggio troncato
consegna.

## Il difetto peggiore stava fuori dalla voce — di nuovo

La voce dice che i posti da cui un evento sparisce sono **tre**, e nomina il
terzo. Contandoli sul sorgente sono **quattro**, e il quarto è a quattro righe
dal terzo: `Dispatcher::drop_pending`, chiamato dal ciclo del `Workspace` subito
dopo aver consegnato l'`Overflow`, con il commento «*ciò che gli handler hanno
emesso gestendo l'Overflow è scartato*». Un `Event::Trouble` emesso lì dentro —
cioè da un handler che fallisce mentre gli si sta dicendo che qualcosa è andato
storto — spariva senza lasciare traccia da nessuna parte.

È lo stesso difetto della voce, un anello più in là, e la voce non poteva
vederlo perché guardava chi **decide** di troncare invece di chi **butta**. Il
conto nuovo `code-che-si-svuotano` esiste per questo: legge il sorgente da fuori
e dice quanti sono quei posti, perché un test non può accorgersi di un
`self.pending.clear()` scritto per uscire da una situazione difficile — il test
che se ne accorgerebbe è proprio quello che chi lo scrive non ha scritto.

Restano tre, e ognuno ha adesso la sua ragione accanto: il drenaggio senza
osservatori (dove non si perde niente, perché la coda serve i soli handler e sul
bus quegli eventi sono già passati interi), il troncamento (che conta ciò che
butta) e l'ultimissimo giro.

## Le premesse della voce, misurate

- **VERA**: `Dispatcher::next_to_deliver` svuotava `pending` in blocco senza
  leggere `is_recoverable`, e i due freni che invece la leggono ci sono tutti e
  due (`bus.rs`, `host/bridge.rs`).
- **VERA**: `Event::Trouble` è dichiarato non recuperabile — «dopo un flush
  fallito il vault è identico a com'era, ed è la ragione per cui quel fallimento
  va detto».
- **VERA e verificata riga per riga**: il centro notifiche riceve comunque,
  perché il ponte parte dal **bus** e `Dispatcher::emit` mette ogni evento sul
  bus *prima* di accodarlo per gli handler. Il danno era ed è tutto dalla parte
  degli `EventHandler`, cioè dei plugin.
- **FALSA nel numero**: «i posti da cui un evento sparisce sono tre». Erano
  quattro (sopra).
- **FALSA come alternativa**: «cosa serve, ed è una scelta fra due» (sopra).
- **Una riga di `is_recoverable` diceva il falso, e lo diceva contando invece
  che guardando**: «*sta qui e non in chi frena perché i freni sono **due***». I
  freni erano tre; il terzo non chiedeva niente a quella funzione, ed è
  esattamente il modo in cui una classificazione «in un posto solo» si ritrova
  ad avere un secondo lettore che non l'ha mai letta.

## Il ritaglio: zero

Non tocca il WIT in nessun punto. `overflow` esiste già nel contratto con il suo
campo `dropped`, e nessun tipo cambia forma: cambia **cosa** finisce dentro quel
conto e **quando** l'evento nasce. È la voce «nessuna firma» per davvero, e il
`frozen/0.1.0.wit` non è stato sfiorato.

## Dove sta la regola, e perché non nel dispatcher

`degrade` poteva restare nel ponte e il dispatcher poteva chiamarla lì: sarebbe
stata una dipendenza del kernel dall'host, cioè il verso vietato. Poteva anche
essere riscritta nel dispatcher: sei righe, e nessuno se ne sarebbe accorto —
finché una delle due copie non avesse cambiato idea.

Sta in `fub_abi::rules::events` per la ragione scritta in cima a
[`crate::rules`](../../crates/fub-abi/src/rules/mod.rs): **chi la applica non è
uno solo**. Il modulo teneva già la maschera di un abbonamento — *chi riceve
cosa* — e questa è la stessa domanda posta da un canale pieno: *chi riceve cosa,
quando non può ricevere tutto*. Il bus non la chiama, e non è un'incoerenza: lui
non ha una raffica sotto gli occhi, ha un evento per volta, e di quella regola
gli serve la sola metà che è già nel contratto (`is_recoverable`).

## Il rosso, e la zona cieca che ha trovato

Quattro rami tolti, uno alla volta:

1. il degrado a budget esaurito rimesso a «butta tutto e annuncia» →
   `un_troncamento_non_butta_un_guasto` rosso;
2. il conto del tratto finale tolto (torna a buttare in silenzio) →
   `il_tratto_finale_dice_quanti_ne_ha_buttati` rosso **e**, cosa che vale più
   del test nuovo, il presidio storico
   `dispatch_budget_stops_infinite_event_loops_loudly` rosso anche lui: è la
   prova che le due metà di questa decisione sono una sola;
3. l'`Overflow` messo in coda invece che dove stava l'ultimo evento che
   sostituisce → rosso il presidio del ponte da cui la forma è copiata
   (`over_the_ceiling_it_says_reconcile_and_keeps_what_nobody_can_rediscover`),
   e **verde** il presidio nuovo del contratto. Zona cieca trovata così: il caso
   che avevo scritto aveva l'ultimo buttato in fondo, cioè non distingueva le
   due posizioni. Il caso che le distingue è quello dell'argomento —
   `index-updated` seguito da `vault-closed`, dove un invito in coda direbbe a
   chi ha appena ricevuto la chiusura di andare a rileggere un vault che non c'è
   più — ed è stato aggiunto;
4. l'`Overflow` emesso anche quando non c'è niente da buttare →
   `nothing_to_drop_is_no_invitation` rosso. È il caso che il ponte non
   incontrava mai e il dispatch incontra subito.

Più il conto nuovo, provato rosso scrivendo «quattro» dove il sorgente dice tre.

**La zona cieca che resta**, e va detta: il conto legge `dispatcher.rs`. Un
quinto posto da cui una coda di eventi si svuota, scritto in un altro file,
passerebbe verde — e il candidato non è ipotetico, è il ciclo di drenaggio sul
`Workspace`, che questa decisione ha reso finalmente **muto** (consegna e basta,
come il modulo dichiarava di aver fatto e non aveva fatto: prima decideva lui
quando fermarsi e cosa scartare).

## Cosa non è chiuso, e va detto

- **L'ultimissimo giro non si può raccontare.** Ciò che un handler emette
  *ricevendo* l'`Overflow` di congedo viene scartato senza dirlo, perché dirlo
  vorrebbe dire un altro evento, che ne produrrebbe altri. Non è un buco
  dichiarato nel senso della [0064](0064-il-supporto-sta-sotto.md): è il punto
  fisso che non converge, e il conto si ferma dove si è potuto dire.
- **`EventMask::all()` non contiene `Trouble`**, di proposito e per una ragione
  che è del [§20.2](../roadmap/20-quando-qualcosa-va-storto.md). Scoperto
  scrivendo il presidio, che infatti nomina le specie una per una: chi si abbona
  «a tutto» oggi i guasti non li riceve, quindi il fatto che il troncamento non
  li butti più si vede solo se qualcuno li ha chiesti. Non è di questa voce e
  non è stato allargato — ma è la seconda serratura sulla stessa porta, e chi
  chiuderà la casella residua del §20.2 deve sapere che c'è.
- **Il tratto finale non ha un budget suo.** È limitato dalla fotografia della
  coda, che è finita ma non piccola: un handler che emette diecimila eventi in
  una sola chiamata si fa consegnare diecimila eventi dopo il troncamento. Il
  limite vero di quel caso è un altro (quanto un handler può emettere in una
  chiamata), e metterci un secondo numero da indovinare qui sarebbe stato
  rispondere alla domanda sbagliata.
