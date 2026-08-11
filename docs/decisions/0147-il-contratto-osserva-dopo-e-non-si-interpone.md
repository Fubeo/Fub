# 0147 — Il contratto osserva dopo, e non si interpone

**Stato**: accolta **Data**: 2026-08-11 **Chiude**: §27.2 **Commit**: *(questo
commit)*

---

## La domanda

La [§27.2](../roadmap/27-tre-scommesse-che-nessuno-ha-provato.md#272-un-plugin-può-osservare-dopo-non-decidere-prima)
chiede se al contratto serva un punto di interposizione: una firma che riceva
l'operazione proposta e risponda «passa» / «passa così» / «no, con questa
ragione», dentro il prestito esclusivo e prima che i byte atterrino. E se serve,
è la specie di firma che dopo il freeze non si aggiunge senza una major — la
ragione della [0002](0002-additivita-del-contratto.md), che rende la voce una
P0.

## La premessa, rimisurata

Censimento rifatto a `8581cb0`:

- l'unico trait che vede passare una mutazione è `EventHandler`
  (`crates/fub-abi/src/traits.rs:3708`), con `subscribed` e `handle`; il secondo
  torna un `Result` che **sembra** un veto e non lo è — il chiamante
  (`crates/fub-kernel/src/workspace.rs:5501`) ne fa un guasto registrato, col
  commento che dice esattamente la semantica: *«l'errore di un handler non deve
  far fallire l'operazione che ha emesso l'evento — ma "non far fallire" non
  vuol dire "non dirlo" (§20.3)»*;
- l'ordine del corpo di una scrittura è dichiarato in
  `write_source` (`workspace.rs:2331`): **parse, disco, ingestione, dispatch**.
  Quando `handle` viene chiamato, il disco è già stato scritto;
- le interfacce export del `plugin-world` sono **undici** come la voce diceva
  (`crates/fub-abi/wit/fub/abi.wit:3997`): plugin, format, syntax, renderer,
  command, view, index, event-handler, service, importer, exporter. Nessuna
  riceve l'operazione proposta: tutte sono posteriori (`event-handler`) o
  parallele — chiamate per il proprio mestiere, non interposte nella scrittura
  altrui. Gli implementatori reali di `EventHandler` sono tre (versioning, pesi
  della ricerca, spia del banco) e funzionano **perché** sono osservatori:
  nessuno ha mai avuto bisogno di dire di no.

## Che cosa il repo aveva già deciso qui vicino

- La [0127](0127-la-mutazione-e-il-prodotto-della-scrittura.md): la mutazione
  **è** il prodotto della scrittura. L'evento non può che venire dopo — e un
  punto di interposizione, se ci sarà, non è un evento.
- La [0052](0052-cio-che-va-storto-e-un-evento.md): il ramo «non far fallire»
  è deciso; il ramo «poter impedire» non era mai stato posto. Questa voce lo
  pone, e questo verbale lo chiude.
- La [0065](0065-una-scrittura-o-c-e-o-non-c-e.md): una scrittura o c'è o non
  c'è. Un veto a metà romperebbe la promessa; il momento giusto sarebbe prima
  del disco, non durante.
- La [0104](0104-la-superficie-di-scrittura-si-presta.md): la superficie non
  vieta, non dà gli strumenti — e la lezione di quel verbale è che **una firma
  non si progetta senza un cliente** (l'evento di tastiera fu scartato perché
  «progettarlo adesso vorrebbe dire progettarlo senza un cliente, cioè la forma
  di difetto che la seduta 22 ha contestato»).
- [plugin-boundary.md](../architecture/plugin-boundary.md), punto 3 del metro:
  *«il contratto permette di osservare una modifica — `EventHandler`, dopo — e
  non di interporsi: non esiste nessun punto che preceda `write_document` e
  possa dire di no. Chi deve decidere prima che il file atterri non è un plugin
  stretto, è un plugin **impossibile**»*. E la riga che ne segue, scritta nella
  stessa pagina: **il sync è un servizio del core**, estendibile semmai nei
  backend di trasporto.

## Le tre forme, e chi paga

- **(a) Un trait nuovo, prima del freeze.** Paga il contratto — una firma per
  sempre — e paga chi scrive: ogni scrittura passa da un giro in più, anche
  quando nessuno è registrato. In cambio sync, politiche e cifratura diventano
  cittadini normali del contratto.
- **(b) Solo un punto di aggancio del supporto.** La possibilità di sostituire
  `VaultStorage`, che copre la cifratura e non il merge. Paga chi vuole il
  sync, che resta fuori.
- **(c) Com'è oggi.** Paga il piano — FubSync e le politiche restano codice del
  kernel — e il giorno che il veto si aggiungesse, si aggiungerebbe dopo il
  freeze.

## La decisione: (c)

**Il punto di interposizione non entra nel contratto.** La prova che decide è
la seconda, quella del secondo chiamante: una firma che gira prima di ogni
scrittura ha come secondo chiamante **la scrittura stessa** — che paga il giro
in più per sempre, per un primo chiamante che non esiste. I tre clienti che la
voce elencava hanno già una casa, e tutte e tre sono decise prima di questo
verbale:

- **il sync** — plugin-boundary l'ha già dichiarato **servizio del core**
  proprio sul punto 3: chi deve decidere il merge prima che il file atterri
  non è un plugin, ed è scritto. Un sync di casa fa il merge dentro il kernel,
  dove i cancelli che «decidono prima» esistono già: la base attesa
  (`WriteBase::DescendsFrom` → `Stale`/`Conflict`), il permesso del `Guard`, e
  il parse puro che precede il disco proprio per tenere la mutazione atomica.
  Nessuna di quelle porte è una firma del contratto: sono del kernel, e un
  servizio del core le usa senza toccare il contratto;
- **la cifratura** — il punto di aggancio è già un fatto: `VaultStorage` è un
  tratto del kernel consumato come `Arc<dyn VaultStorage>` ovunque
  (`documents.rs`, `organization.rs`, `entries.rs`, `journal.rs`). Un supporto
  cifrato è un'implementazione del kernel che avvolge `FsStorage`; la
  forma (b) non è una proposta, è lo stato di oggi, e la
  [mappa-visuale](../architecture/mappa-visuale.md) «segna fin dove arriverà il
  supporto cifrato» dalla parte del core;
- **la politica di vault** («questa nota non esce da qui») — non compare in
  nessun altro punto del repo: né feature, né milestone, né casella. È
  l'elenco dei clienti che la voce stessa forniva, e su tre uno è senza nome.

Aggiungere la firma oggi perché il freeze incombe sarebbe la resa all'ostacolo,
non una decisione: senza il freeze — prova uno — la risposta sarebbe aspettare
un cliente, che è la disciplina della seduta 22 e della 0104. E la P0 si
scioglie da sola: la capacità di decidere prima non è una forma del contratto,
è una capacità del kernel, e i servizi del core la esercitano senza migrazioni.
La major temuta colpirebbe solo un veto *visibile a un terzo* — che è
precisamente ciò che nessun piano chiede.

Sul costo della forma (a) c'è una misura già presa altrove: un permesso che
nessuno legge (`fub:write-vault`, dichiarato da plugin-boundary) è il prezzo
di una firma per un cliente che non c'è, e questo repo l'ha già rifiutato due
volte. La stessa forma, applicata a un trait che intercorrerebbe in ogni
scrittura, è più cara: il giro in più è permanente e la semantica del
«passa così» — una trasformazione a metà del percorso — costringerebbe a
ricostruire modello e indici dal contenuto trasformato, cioè a riaprire
l'atomicità che la 0127 e la 0065 hanno costruito.

## La premessa caduta

La voce si apriva sulla premessa *«serve un punto di interposizione»*, e la P0
la rendeva urgente. Verificata contro i sorgenti, cade: dei tre clienti che la
voce stessa elencava, due sono del core per decisione già scritta e il terzo
non ha un nome. Sembrava vera per una ragione precisa — tre candidati in una
tabella, tutti con una necessità di *momento*: il merge, il no, il sotto. Ma
guardando dove ciascuno dei tre può stare, nessuno dei tre chiede una firma del
contratto: chiedono porte che il kernel ha già o una feature che nessuno ha
ancora pianificato.

## Cosa resta scoperto

**Zero caselle.** Il supporto cifrato e il sync non sono lavoro già deciso da
questa voce: sono feature del core dei loro milestone, e chiuderli qui
vorrebbe dire inventare lavoro non deciso. Il fatto — *osservare dopo, non
decidere prima* — resta scritto nel punto 3 di plugin-boundary, che è il posto
in cui uno inciampa mentre si chiede se può: chi vorrà un veto di terzi lo
troverà lì, dichiarato, con la ragione accanto.
