# 22. Cosa sa dire un abbonamento

Una **seduta** della [roadmap infrastrutturale](../todo.md): un abbonamento è come questo contratto tiene il lavoro fuori dal confine — qui stanno le tre cose che non sa dire.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

**Questa seduta non l'ha trovata un giro, e nemmeno una decisione di prodotto:
l'ha trovata una verifica.** È la seconda, dopo quella che ha aperto la
[§21.10](21-la-ricerca-predefinita.md) — e per questo vale scriverne il metodo
accanto alle voci. Una lettura esterna di [FEATURES.md](../FEATURES.md) ha
prodotto nove affermazioni sull'architettura di questo repo. Controllate contro i
sorgenti: sei erano vere **e già scritte** — la cifratura at-rest che poggia sulla
[§15.1](../decisions/0064-il-supporto-sta-sotto.md) sta nella voce da quando la
voce esiste, l'`Origin` che impedisce a un'automazione di richiamarsi da sola è
la [0012](../decisions/0012-origine-degli-eventi.md), la maschera valutata dal
kernel è la [0033](../decisions/0033-la-grana-di-un-abbonamento.md). La tesi
centrale — *«§15.1 e §15.2 non sono più P2, sono il pavimento»* — era invece
sbagliata nel modo che [`todo.md`](../todo.md) nomina per primo: **P0 è la
scadenza, non l'importanza**, e [`leva.md`](leva.md) esiste apposta per dire che
una voce può essere P2 e restare la più importante da capire. La prova che la
disciplina aveva già funzionato è nella stessa seduta 15: la sua unica **metà di
firma** era la §15.4, ed era P0, ed è chiusa dalla
[0048](../decisions/0048-una-radice-sola.md) prima del freeze; il `trait
VaultStorage` è rimasto P2 perché è un trait interno al kernel e non scade.

Restano tre cose che nessuno aveva scritto. Sono qui, e sono **tutte e tre
chiuse**: la terza dalla [0063](../decisions/0063-la-maschera-e-dell-esemplare.md),
che ne lascia una casella, e le altre due dalla
[0069](../decisions/0069-cosa-sa-dire-un-abbonamento.md), che ne apre una nuova —
la §22.4, l'orario di parete.

**Un avvertimento su questo cappello, scritto dopo.** La frase qui sotto — «tre
estensioni della stessa maschera» — **è sbagliata**, e le due decisioni che hanno
chiuso la seduta l'hanno smentita ognuna a modo suo: la §22.3 è diventata una
funzione su `ViewProvider` ([0063](../decisions/0063-la-maschera-e-dell-esemplare.md))
e la §22.1 un campo di manifest, perché *una maschera filtra e non causa*
([0069](../decisions/0069-cosa-sa-dire-un-abbonamento.md)). L'accorpamento che
questo cappello dichiarava ha retto lo stesso, ma per un'altra ragione — la
**regola** che il ritiro della 0063 ha messo a verbale, non il record — e resta
scritto qui com'era perché è il caso su cui il criterio della
[0054](../decisions/0054-il-banco-del-lato-provider.md) si è precisato: un
cappello si legge per cosa afferma, e ciò che afferma può essere falso senza che
la sua conclusione lo sia.

**Perché stanno insieme.** Un **abbonamento** — in questa seduta: ogni
dichiarazione di interesse, non solo `subscriptions()` — è il modo con cui questo
contratto tiene il lavoro fuori dal confine: chi ascolta dichiara prima, il
kernel valuta, e il guest si sveglia solo a corrispondenza avvenuta
([0033](../decisions/0033-la-grana-di-un-abbonamento.md)). Le tre voci sono tre
cose che quella dichiarazione non sa dire: **quando** (§22.1), **cosa è
cambiato** (§22.2), e **per quale esemplare** (§22.3). Decise separate darebbero
tre estensioni della stessa maschera, disegnate da tre lati, con tre modi di
essere valutate.

**E nessuna delle tre scade col freeze** — né la quarta, che è nata chiudendo la
prima. Vale scriverlo perché la tentazione era
chiamarle P0 per importanza — cioè commettere l'errore che questa stessa seduta
ha appena contestato a chi l'ha aperta. Passate una per una alla tabella di
[`architecture/wit-congelato.md`](../architecture/wit-congelato.md): la
dichiarazione di un timer è un campo di manifest, un campo di maschera o
un'interfaccia nuova — tutte e tre in coda; il *cosa è cambiato* è un campo in
fondo a un record e uno in fondo alla maschera; una maschera per esemplare è una
funzione nuova su un'interfaccia che c'è già. **Niente di pubblicato si sposta.**
Sono P1: vanno con M3, e il loro conto lo paga chi scriverà la prima automazione.
La §22.3 è la sola che ha un modo di diventare P0, ed è scritto nella sua ultima
casella — la [0063](../decisions/0063-la-maschera-e-dell-esemplare.md) ha preso
l'altro verso, quello additivo, e con lui la voce non scade più.

**Le due che restano sono state tentate una volta, e ritirate.** Vale scriverlo
qui perché la prossima volta la tentazione tornerà nella stessa forma: i campi
c'erano — `document-changes` e `schedule` in fondo alla maschera, un `changes` in
fondo a `event-document-changed`, un `timer-fired` in coda al variant — e non li
guardava nessuno. `mask_wants` non filtrava, `ingest_model` riempiva `None`, il
timer non lo faceva scattare niente. Aggiungere la dichiarazione è la parte
facile di tutte e due queste voci, ed è la parte che non serve a nulla da sola:
finché il kernel non la valuta, una maschera che si può scrivere è una promessa
fatta a chi la scrive.

### 22.1 Un abbonamento non sa dire quando

*chiusa dalla [0069](../decisions/0069-cosa-sa-dire-un-abbonamento.md) — la dichiarazione sta nel manifest, perché una maschera filtra e non causa; e ne nasce la §22.4*

- [x] **Il no della [0013](../decisions/0013-elenco-delle-capacita.md) è ancora
      giusto; la sua ragione no.** `schedule_at`/`schedule_every` erano stati
      esclusi così: «*il kernel è sincrono e non possiede thread: `spawn_job`
      accoda e chi ha i thread (l'app) drena*». Dalla
      [0032](../decisions/0032-il-runner-dei-job.md) i thread ci sono — un pool
      per vault, posseduto dall'host, che aspetta un campanello **prestato** dal
      kernel (`JobBell`), che è la stessa mossa della bandiera di cancellazione.
      Il bloccante nominato non c'è più. La conclusione resta valida lo stesso, ma
      per **l'altra** regola della stessa 0013: *una capacità è ciò di cui il
      chiamante ha bisogno della risposta per proseguire; ciò che si limita a
      informare è un evento.* Una sveglia informa. Quindi non `schedule_at`: un
      evento — e il precedente che dice che funziona è la
      [0035](../decisions/0035-il-lavoro-lungo-si-racconta.md), che ha fatto
      esattamente questo col progresso.

      *Confermato, e con la premessa smentita per iscritto: dalla
      [0032](../decisions/0032-il-runner-dei-job.md) i thread ci sono, quindi a
      reggere la conclusione è l'altra regola. La 0013 aveva anche previsto la
      forma — «quando arriveranno, arriveranno come `Event`, ed è additivo» — e
      `Event::TimerFired { owner, timer }` è quella riga resa vera.*
- [x] **Ciò che manca è la dichiarazione, non lo scheduler.** `EventMask` sa dire
      tre cose — le specie, il prefisso di topic, il soggetto (`event.rs`) — e
      nessuna delle tre è *quando*. Un plugin che voglia svegliarsi alle 9, o
      ogni ora, o fra dieci minuti, non ha **dove scriverlo**: non nella
      maschera, non nel manifest, non fra le capacità. Lo scheduler in sé è
      codice dell'host e non costa una decisione; il posto dove un plugin
      dichiara un timer sì, ed è l'unica parte che il freeze guarda.

      *Il posto è il `PluginManifest` (`timers: list<timer-spec>`), e la ragione
      per cui **non** è la maschera è più forte di «non ci stava»: una maschera si
      applica agli eventi che accadono, e un timer che nessuno ha fatto partire
      non ne genera nessuno da filtrare. Era un errore di categoria, ed è la
      ragione per cui il tentativo ritirato non poteva trovare un valutatore. Lo
      scheduler è dell'host come previsto, ma la **regola** di quando suona sta
      nel contratto (`TimerSchedule::nth_after`): il kernel non legge l'orologio,
      e due host non devono avere due idee di cosa voglia dire «ogni ora».*
- [x] **Chi lo chiede.** FEATURES 16.2 (trigger su orario, su data, su
      intervallo), 16.3 (schedule, delay, retry), 10.5 (promemoria e notifiche a
      scadenza), 18.1 (sync periodico), 24.2 (background sync efficiente). Sono
      l'unica famiglia di trigger del 16.2 che **non** nasce da un evento del
      vault: tutte le altre hanno già il canale e aspettano solo chi le ascolti.

      *Servite, meno l'orario di parete: `every` e `after` coprono «ogni ora» e
      «fra dieci minuti», «alle 9» diventa la §22.4.*
- [x] **Perché non è P0.** Le tre forme che la dichiarazione può prendere sono
      tutte additive: un campo del `PluginManifest` (il precedente è `settings`,
      [0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md)), un campo in
      fondo a `EventMask`, o un'interfaccia nuova. Il caso di `Event` per la
      sveglia è additivo per la regola che questo progetto si è scelto — con
      l'avvertenza che
      [`wit-congelato.md`](../architecture/wit-congelato.md) scrive a chiare
      lettere: nel component model un caso in più su un `variant` non è nemmeno
      additivo davvero.

      *Presa la prima delle tre — il campo di manifest —, e il caso in coda al
      `variant` c'è comunque. `frozen/0.1.0.wit` **non è stato toccato**: il
      precedente per il caso in coda è la
      [0041](../decisions/0041-un-errore-e-testo-che-qualcuno-legge.md), che ne
      aveva aggiunti tre a `plugin-error` chiamandoli additivi.*

### 22.2 Un evento dice quale documento, non cosa è cambiato

*chiusa dalla [0069](../decisions/0069-cosa-sa-dire-un-abbonamento.md) — si filtra per aspetto e si legge per nome*

- [x] **`DocumentChanged { id }` e basta** (`abi.wit`, `event-document-changed`).
      Chi ascolta sa che *quella nota* è cambiata, non cosa: per sapere se è
      cambiato un tag deve rileggere il modello e confrontarlo con quello che si
      era tenuto.

      *Adesso dice anche cosa: `changes: option<doc-changes>`. E i due stati
      dell'`option` sono due cose diverse — assente è *non lo so* e passa ogni
      filtro, presente e vuoto è *niente è cambiato* e non passa.*
- [x] **La 16.2 chiede tre trigger che sono esattamente questo**: «trigger su tag
      aggiunto», «su proprietà cambiata», «su task completato». Nessuno dei tre è
      una specie di evento e nessuno dei tre è filtrabile da una maschera:
      un'automazione su «la scadenza è cambiata» si sveglia a **ogni** scrittura
      di **ogni** nota del suo soggetto, e rilegge per scoprire che non la
      riguardava. È la famiglia di automazioni più grande del capitolo 16, ed è
      quella che paga il conto più alto.

      *Due dei tre sono serviti per nome (`tags_added`/`tags_removed` e
      `properties`); il terzo — «task completato» — **non ha un campo nel
      modello**, quindi non è distinguibile da un cambio di corpo. Non è stato
      nominato in `DocChange` per non promettere una grana che il kernel non sa
      produrre: è un buco dichiarato, e l'enum cresce in coda il giorno che
      `DocumentModel` avrà i task.*
- [x] **È l'argomento della [0033](../decisions/0033-la-grana-di-un-abbonamento.md)
      un piano più in basso.** Quella voce esisteva perché con la sola grana
      delle specie ogni handler si svegliava per N feature × M documenti; la
      maschera ha guadagnato il topic e il soggetto, e il conto è sceso di due
      ordini. Il *cosa* è la terza grana, e la sua assenza rimette in piedi lo
      stesso moltiplicatore sull'evento più caldo del contratto.

      *La terza grana è `DocChange`, sei aspetti chiusi dal contratto. Il
      moltiplicatore che resta è sul **risveglio** e non più sulla **rilettura**,
      che era la parte cara: chi si sveglia sa già, dai nomi che l'evento porta,
      se lo riguardava.*
- [x] **Il posto dove la differenza è calcolabile esiste, ed è uno solo**:
      `Workspace::ingest_model` (`workspace.rs`), la coda di ogni scrittura. Lì
      il modello nuovo è in mano e i metadati di prima sono ancora in cache —
      `on_document_indexed(&model)` è la riga che li sostituisce. Chi volesse
      dire *cosa* è cambiato non deve andarlo a ricalcolare da nessuna parte: gli
      basta guardare prima di sovrascrivere. È la stessa specie di spreco della
      [seduta 20](20-quando-qualcosa-va-storto.md) — un esito che si ha in mano e
      si butta — vista sul canale degli eventi invece che su quello degli errori.

      *Esatto, e il diff costa **zero letture dal disco**: si calcola in
      `ingest_model` prima di toccare qualunque cosa. Il corpo non stava in
      cache — è lo split metadata/body — e a rispondere per lui è l'impronta che
      l'anagrafe teneva dal giro prima (§14.1), che era già in memoria.*
- [x] **Perché non è P0**: un campo in fondo a `event-document-changed` e uno in
      fondo a `EventMask` per filtrarlo. Due record, due aggiunte in coda.

      *Alla lettera, più tre tipi nuovi (`doc-change`, `doc-changes`) e nessun
      ritaglio della linea di base.*

### 22.3 La maschera di ridisegno è della view, non dell'esemplare

*chiusa dalla [0063](../decisions/0063-la-maschera-e-dell-esemplare.md) — resta una casella, ed è la sola metà che non si risolveva nel contratto delle view*

`ViewProvider` ha `interests(&ViewInstance) -> ViewInterests { refresh, follows }`,
e il record sta nel WIT accanto a `view-spec`. I due campi della spec restano il
caso largo e il default — la decisione è additiva, e la §22.3 non scade più. Le
maschere si risolvono **dove le spec si chiedono**, alla registrazione
(`specs_dichiarate`), perché la verità su cosa un provider offre è del registro e
non di chi interroga; chi apre un esemplare con parametri la chiede a
`Workspace::view_interests`, e non è passata dall'IPC perché la domanda che la
shell fa oggi ha già la sua risposta dentro `list_views`
([0057](../decisions/0057-la-dieta-dell-ipc.md)).

- [ ] **Resta il secondo cliente, che non è nemmeno una view.** Una query
      **incorporata in una nota** (9.2, «query embed») non è un esemplare di
      `ViewSpec`: è un blocco reso dal renderer, dentro il documento aperto. Per
      quella un canale di invalidazione non esiste **affatto**, e la domanda
      «chi la ridisegna quando cambia ciò che interroga» oggi non ha una riga in
      nessuna voce. La seduta diceva che le due metà vanno decise insieme «o le
      due si sceglieranno due meccanismi»: la prima, decisa, **è** il meccanismo
      — una dichiarazione di interesse per esemplare, valutata da chi possiede
      l'evento — e ciò che resta è portarcelo dentro, non sceglierne un altro.
      Un blocco reso dentro un documento non ha un id di view a cui appendere una
      spec, e la sua dipendenza nasce dal testo che lo contiene: è lì che la
      risposta va cercata, non in `ViewSpec`.

### 22.4 Un orario di parete non è un intervallo

*nata dalla [0069](../decisions/0069-cosa-sa-dire-un-abbonamento.md), che ha chiuso la §22.1 senza di lei · contratto · **P1** — additiva, quindi non scade col freeze*

`TimerSchedule` sa dire `every` e `after`, cioè le due forme che si misurano in
**tempo trascorso**: «ogni ora» e «fra dieci minuti». La §22.1 ne nominava tre, e
la terza — «alle 9» — non è la stessa specie di domanda.

- [ ] **Un orario di parete vuole un fuso, e nessuno sa da dove lo prende.** Il
      sistema? Un'impostazione (§11.1)? Il locale della
      [0039](../decisions/0039-il-locale-e-il-caso.md), che l'host già conosce e
      che però dice *come si scrive un'ora*, non *in che fuso si vive*? Sono tre
      risposte diverse e producono tre comportamenti diversi per un vault
      sincronizzato fra due macchine in due paesi — che è il caso normale, non
      quello di frontiera.
- [ ] **E vuole una regola sull'ora legale.** Il giorno in cui l'ora legale
      entra, le 2:30 non esistono; il giorno in cui esce, esistono due volte. Una
      sveglia dichiarata a quell'ora o salta un giro o ne fa due, e quale delle
      due sia giusta dipende da cosa la sveglia fa: un promemoria vuole saltare,
      un backup vuole girare. È una decisione, e prenderla di straforo dentro
      un'implementazione vorrebbe dire che nessuno la trova più.
- [ ] **Chi lo chiede.** FEATURES 16.2 (trigger su orario e su data), 10.5
      (promemoria e notifiche a scadenza). Sono la metà della famiglia che la
      §22.1 ha servito: chi vuole svegliarsi *ogni tanto* è servito, chi vuole
      svegliarsi *alle nove* no.
- [ ] **Perché non è P0.** `timer-schedule` è un `variant` nato con la
      [0069](../decisions/0069-cosa-sa-dire-un-abbonamento.md) e mai pubblicato:
      un caso in coda è additivo, e chi ha dichiarato `every` non se ne accorge.
      Ciò che il freeze guarda — il posto della dichiarazione — è già deciso ed è
      il manifest.
