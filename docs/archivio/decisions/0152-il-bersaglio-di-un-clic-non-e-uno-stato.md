# 0152 — Il bersaglio di un clic non è uno stato della sessione

**Stato**: accolta **Data**: 2026-08-12 **Chiude**: §26.5 **Commit**: *(questo
commit)*

---

## La domanda

La [§26.5](../roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md#265-il-menu-contestuale-la-superficie-cè-il-bersaglio-del-clic-no)
chiedeva se un terzo possa aggiungere una voce a un menu contestuale, e prima
ancora **su che cosa** sarebbe quella voce: chi dice al comando che il clic
destro è caduto su *quella* riga dell'albero, su *quella* linguetta, su *quel*
link.

La voce misurava che il contratto **rimanda a un campo che non esiste**: sopra
`context-menu`, `abi.wit` scriveva *«Cosa fosse il bersaglio del clic lo dice il
contesto di sessione (decisione 0007), non un parametro di questa superficie»*,
e `record view-context` è `pane, doc, selections, mode` — quattro campi, nessun
bersaglio. La sua raccomandazione era la forma **(a)**: il bersaglio entra nel
contesto, come campo in fondo al record o come caso in fondo a `context-kind`.

## La premessa, rimisurata

Rimisurata a `9afcdd9`.

- **La promessa falsa c'è ed era in tre copie.** Il doc di `context-menu` la
  faceva nel WIT e in `ViewSurface::ContextMenu`; e `view-context` la
  confermava dal suo lato, scrivendo che «quale nota si guarda **e dove si è
  cliccato** sono decisioni dell'utente sull'app» — una frase che nomina un
  fatto che quel record non porta. Il gemello Rust
  (`session.rs`, `ViewContext`) diceva la stessa cosa.
- **La 0007 aveva già scritto la ragione contro la forma (a), e la voce non
  l'ha letta.** Il verbale che `abi.wit` citava per promettere il bersaglio è
  lo stesso che dice: *«un campo in più a un record è una migrazione di ogni
  provider che lo riceve. I quattro campi sono perciò tutti qui — pannello,
  documento, selezione, modalità — e non un sottoinsieme da completare dopo»*.
  La voce prezza la mossa con `wit_additivity` («un campo in fondo a un
  `record`» è additivo) e conclude «fattibile dopo il freeze». Sono due misure
  di due cose diverse e sono vere tutte e due: additiva è la **riga del WIT**,
  migrazione è **chi la riceve**. Il prezzo che conta è il secondo.
- **Il primo chiamante non c'è, e non per la ragione solita.** Non è che manchi
  un plugin prima di M5: è che il produttore che esiste non ne ha bisogno.
  `showContextMenu(at, items)` (`frontend/src/ui/menu.ts`) riceve le voci come
  letterali da chi apre il menu, e chi apre il menu è l'ascoltatore
  `contextmenu` — che il bersaglio **ce l'ha già in mano**, è l'elemento su cui
  ha cliccato. Un campo nel contesto sarebbe riempito dalla shell e riletto
  dalla shell, che la risposta ce l'ha da prima di scriverla.
- **La riga stantia che la voce segnalava è già riparata.**
  `ui-protocol.md:121` dice adesso «Questa shell ne ospita **otto**», e le due
  che restano fuori sono quelle di `NON_OSPITATE`. Chi legge la §26.5 e poi il
  documento non trova più due numeri.

## La decisione

**No alla forma (a): il bersaglio non entra in `view-context`, né come campo né
come caso di `context-kind`.** La ragione non è il costo, è la **specie**.

`view-context` è uno **stato che dura**: lo pubblica la shell (con un debounce
di 150 ms sul cursore, 0007), lo custodisce il kernel, e lo legge un provider
**quando gli capita di girare** — al ridisegno, all'apertura, alla richiesta di
un'azione. Il bersaglio di un clic destro è vero per un istante: nell'istante
dopo il menu è chiuso e quel valore è una bugia che nessuno ha aggiornato. Un
campo così, dentro un record letto quando capita, non è un dato in più: è un
dato che è **sbagliato nella maggioranza delle letture**, e la minoranza in cui
è giusto non si distingue dall'altra guardandolo.

Il caso in fondo a `context-kind` è la stessa cosa vista dalla maschera:
`context-kind` nomina le parti al cui **cambio** una view invecchia, e una view
che dichiarasse di seguire il bersaglio chiederebbe di essere ridisegnata a
ogni clic destro dell'utente — che è, con un altro nome, ciò che la 0007 si è
rifiutata di far passare per l'event bus («consegnare ogni movimento del cursore
a ogni `EventHandler` registrato»). **Un clic non cambia il contesto: lo
interroga.**

**Dove andrà il bersaglio, il giorno che serva.** Con l'**invocazione**, non con
lo stato: `command-spec` ha già `params`, che è la forma con cui un comando
riceve ciò su cui agisce, e una funzione o un'interfaccia nuova è additiva per
`wit_additivity` e **non scade col freeze**. Quindi la porta che questa
decisione lascia aperta è più larga di quella che chiude, e non ha una data.

**Il lavoro portato è la riparazione della promessa**, nei tre posti in cui era
scritta: il doc di `context-menu` nel WIT e in `ViewSurface::ContextMenu` dice
adesso che il contesto quel campo non ce l'ha e non lo avrà, e che il bersaglio
viaggerà con l'invocazione; il doc di `view-context` e quello di `ViewContext`
dicono che i campi sono quattro, con la ragione della 0007 accanto.

**E una decisione scritta in un doc non diventa rossa**, quindi accanto c'è la
metà che lo diventa: `crates/fub-abi/tests/il_contesto_ha_quattro_campi.rs`
legge il sorgente di `session.rs` e pretende che i campi di `ViewContext` siano
quei quattro, in quell'ordine — che è anche l'ordine del WIT, dove l'ordine è il
confine. Visto rosso aggiungendo un quinto campo `target` (`left: ["target",
"pane", "doc", "selections", "mode"]`), col messaggio che nomina la decisione
che si sta scavalcando. Sta sul **sorgente** e non su un valore serializzato
perché `ViewContext` non ha un `Default` e costruirne uno legherebbe il conto
dei campi a un `PaneId` e a un `PaneMode`, che con la domanda non c'entrano.

## Le forme scartate

- **(b) La collocazione entra nel comando** — un campo in `command-spec` che
  dica in quali menu il comando compare. La voce lo dice da sé: senza il
  bersaglio è «la porta davanti al muro», e adesso che il bersaglio non arriva
  da lì il muro è più alto, non più basso. In più porterebbe un **vocabolario di
  zone**, che è un nome pubblico e quindi la stessa spesa che la
  [§26.1](../roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md#261-un-accordo-ha-un-contesto-o-non-ce-lha)
  non ha ancora deciso di pagare. Resta possibile per sempre: un campo in fondo
  a un `record` è additivo, ed è la sola cosa che qui si irrigidisce — la
  *posizione*, che è cosmetica.
- **(c) Solo shell: un registro di contributi in `ui/menu.ts`** — la voce la
  giudica «la forma che sembra un progresso e non ne è uno», e la misura le dà
  ragione: i chiamanti di produzione di `showContextMenu` sono cinque e stanno
  **tutti nello stesso file** (`panels/explorer.ts`). Un registro che
  disaccoppia cinque chiamanti da un file solo compra ordine, non una porta, e
  nasconde la lente — perché il numero che cresce non è quante voci mette il
  core, è **quante superfici vorrebbero un menu**: una oggi, cinque nel corpus.
- **(a) in una forma attenuata — un bersaglio che vale «solo durante il
  menu»** — è la forma che verrebbe in mente per salvare la (a), e si scarta da
  sé: un campo valido solo in una finestra di tempo che il contratto non
  descrive è esattamente il `dirty: bool` che la 0007 ha già rifiutato, «un flag
  che chiunque può dimenticare di leggere protegge meno di un campo che, quando
  non è vero, non c'è».

## Cosa resta scoperto

- **L'utente non ci guadagna niente, e va detto.** Su quattro delle cinque
  superfici che il corpus nomina — editor, scheda, blocco, albero, link — un
  menu contestuale non c'è, e sull'unica che ce l'ha non si può togliere,
  aggiungere né riordinare una voce. Questa decisione toglie una promessa falsa
  e nomina la strada; non apre nessuna porta.
- **Un terzo continua a non poter contribuire una voce**, e il motivo non è più
  un campo mancante nel contratto: è che questa shell un menu contestuale
  estendibile non lo ospita, e lo dichiara.
- **La forma dei `params` di un'invocazione di menu non è disegnata.** Questo
  verbale dice *dove* andrà il bersaglio, non *com'è fatto*: se sia un path, un
  `doc-id`, una scheda o un target di link è la domanda che si porrà il primo
  chiamante vero, e porsela adesso vorrebbe dire disegnarla senza di lui.
