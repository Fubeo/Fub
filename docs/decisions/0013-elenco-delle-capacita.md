# 0013 — `HostApi` — chiudere l'elenco delle capacità prima del freeze

|  |  |
|---|---|
| **Decisa** | 2026-07-26 |
| **Origine** | `todo.md` §1.4 (primo giro) |
| **Commit** | `6202e3e` |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [PIANO.md](../PIANO.md)

---

Ogni capacità che manca qui è una feature che **non potrà mai essere un
plugin**. Da decidere una per una, con la risposta a verbale — comprese quelle
che **non** entrano, perché una saltata in silenzio non si distingue, fra sei
mesi, da una scartata apposta:

- [x] **Operazioni strutturali** (`create_document`, `rename_document`,
      `trash_document`, `list_trash`, `restore_document`, `empty_trash`): erano
      kernel-owned e fuori dal contratto. Senza, nessun plugin poteva fare
      template, daily note, import, auto-archiviazione, cleanup wizard — cioè i
      capitoli 16, 17, 8.3, 7.2. `create_folder` **non entra** (§14.3).
- [x] **Invocare comandi** (`run_command`): è ciò che rende componibili macro e
      automazioni (16.2, 16.3) senza che ogni plugin conosca gli altri.
- [x] `storage_*` volatile **tolto**: linea di base ritagliata, l'unica rottura
      del giro.
- [x] Punto di applicazione del permesso: **deciso e rimandato al §7.3**, con
      la ragione a verbale e il varco della [decisione 0010](../decisions/0010-comando-descritto-a-una-macchina.md) esteso a tutte le strutturali.
- [x] **Notifiche e progresso**, **allegati**, **rete**, **tempo differito**,
      **log per-plugin**: decisi uno per uno, e nessuno entra. Le ragioni sotto.

**Fatto: l'elenco è chiuso.** Ventidue metodi. Da qui in avanti aggiungerne uno
è una minor, toglierne uno una major — e questo è il giro in cui si è tolto.

*Il rifiuto è la capacità.* `create_document(id, source)` fallisce se il path è
occupato, ed è la sola cosa che lo distingue da `write_document`, che crea ciò
che non c'è e sovrascrive ciò che c'è. Senza quella differenza non ci sarebbe
motivo di avere due firme; con quella differenza, un plugin di template che
sbaglia la data riceve un errore invece di **cancellare** una nota dell'utente
con una riga che nel codice non sembra una cancellazione. E prende un `DocId`,
non un nome da cui l'host deriva il path: un importer o un template sanno dove
va la nota (`Diario/2026-07-26.md`), e un host che scegliesse la cartella per
loro renderebbe inesprimibile metà del capitolo 16. Chi vuole comunque un nome
libero compone con `free_name`, che c'è già ed è lì per questo — due capacità
che si compongono dicono cosa succede, una che rinomina in silenzio no. È
esattamente ciò che `create_note(None)` faceva da dentro, riscritto da fuori.

*Di rename ce n'è uno, ed è quello del kernel.* Riscrive i wikilink entranti.
L'alternativa — il rename «nudo» — non è una versione più semplice della stessa
operazione: è un'operazione che lascia il vault con i riferimenti rotti, e
nessuna delle due firme lo direbbe. Due semantiche sotto lo stesso nome sarebbero
la trappola per cui un plugin scritto contro l'una si comporta come l'altra
appena l'host cambia. Il rename nudo non ha, oggi, un chiamante; il giorno che
ne avesse uno sarà un parametro in più su una capacità nuova, non un secondo
significato di questo nome. La conseguenza che si è dovuta accettare: una
rinomina è un lotto ([decisione 0011](../decisions/0011-il-lotto.md)), quindi una capacità dell'`HostApi` può toccare N
documenti — ed è giusto che si veda, tant'è che `note.rename` dichiara
`CommandReach::Documents` e il suo piano nomina i sorgenti che riscriverà.

*Il cestino sta tutto di qua, e si chiama come ciò che fa.* `trash_document` e
non `delete_document`: il documento esce dal vault e dagli indici ma non è
distrutto, e ciò che ritorna è l'id con cui si ripristina. L'unica capacità che
distrugge è `empty_trash`, e si chiama così — non è un `trash_document(force:
true)`, perché un booleano che cambia "sposta" in "distruggi" è il parametro che
si passa sbagliato una volta sola. `restore_document` rifiuta se il path
d'origine è di nuovo occupato invece di scegliere un nome d'ufficio: chi chiama
ha `free_name` e decide, come per `create_document`.

*`list_trash` sta accanto a `list_documents`, non dentro `IndexQuery`.* Sembrava
il posto giusto — la [decisione 0005](../decisions/0005-canale-dati-verso-le-view.md) è «il canale dati» — e non lo è: il cestino **non è
indicizzato**. Una nota cestinata non ha modello, né tag, né archi nel grafo: è
per definizione ciò che l'indice non contiene, e chiederla al canale dati
significherebbe promettere che quel canale sappia rispondere su ciò che non ha
letto. Il gemello esatto di `list_trash` per ciò che è vivo — `list_documents` —
è già una capacità e non una query, per la stessa ragione. `TrashEntry` è quindi
salita nel contratto (due id, perché sono due domande: dove il file è ora e dove
tornerebbe).

*`run_command`: tre cose che la firma dice non dicendole.* (a) **Non prende un
`InvokeMode`.** Il modo è dell'host, non della chiamata: chi si sta simulando
invoca in simulazione e riceve il *piano* del comando invocato, e il piano di una
macro è l'unione dei piani dei suoi passi. Se il modo fosse un argomento, una
simulazione potrebbe diventare reale invocando qualcuno — cioè il buco che la
[decisione 0010](../decisions/0010-comando-descritto-a-una-macchina.md) aveva appena chiuso. (b) **Non prende un `Actor`, e non lo riazzera** — la
domanda che la [decisione 0012](../decisions/0012-origine-degli-eventi.md) aveva lasciato aperta. L'attore è chi ha *chiesto*, e
chiedere vuol dire **entrare** nel kernel: la IPC (utente), il watcher, il
dispatch verso un handler (plugin). Invocare non è entrare. Se `run_command`
intestasse le scritture al plugin che invoca, una macro lanciata dall'utente
direbbe all'automazione «questo l'ho chiesto io», e un'automazione che non
riconosce più chi ha chiesto è quella che si richiama da sola — la [decisione 0012](../decisions/0012-origine-degli-eventi.md) letta
dall'altro verso. Decisivo, in più: `write_document` da un plugin non rietichetta
la scrittura, e due capacità che danno due origini allo stesso atto sarebbero
due verità. (c) **Non apre un lotto suo**: si unisce a quello aperto. Una macro
di tre comandi è *una* cosa che qualcuno ha chiesto, quindi un `batch-ended` e un
ridisegno. Un comando non può invocare sé stesso nemmeno per giro: la catena è
nota all'host, e il rifiuto **nomina** il ciclo (`a → b → a`) invece di essere
uno stack overflow o un numero massimo di annidamenti scelto a caso.

Prezzo dichiarato di `run_command`: i `CommandProvider` sono diventati gli unici
provider **condivisi** (`Arc`) invece di essere estratti dal workspace per la
durata della chiamata. Estrarli è la disciplina di view, indici e handler, ed
esiste perché l'host presta `&mut Workspace`; ma con essa una macro non
troverebbe **nessuno** dei comandi da comporre, nemmeno quelli di un altro
provider — e i comandi del proprio provider sono esattamente il caso più comune.
`invoke` prende `&self`, quindi condividere il puntatore basta, e la regola di
visibilità del contratto («durante un callback in scrittura un provider non vede
sé stesso») resta vera dov'era vera: sui provider che il dispatch estrae davvero.

*Il permesso: si può negare, non si può ancora concedere per manifesto.*
`PluginPermissions.write_vault` resta dichiarato da tutti e letto da nessuno, ed
è il §7.3. La differenza con `CommandScope.writes` — che invece è vincolante —
non è di volontà: `writes` è **la dichiarazione dell'atto che si sta per
compiere**, e l'host ha in mano la spec del comando che sta per invocare, quindi
la decisione è locale e non ha bisogno di nessun registro. `write_vault` è una
proprietà di un **plugin**, e questo kernel non ha plugin: ha provider registrati
per id, e `Plugin::manifest()` non viene chiamata da nessuna parte perché non c'è
niente che installi, abiliti o verifichi alcunché. Farlo rispettare oggi vorrebbe
dire inventare il registro dei manifest (§7.3) e il runtime che rende possibile
un provider non fidato (M5); nel frattempo, o si nega tutto a tutti (e niente
funziona) o si concede tutto a tutti (e il controllo è codice morto — la stessa
diagnosi che alla [decisione 0009](../decisions/0009-registro-dei-comandi.md) ha tenuto fuori un campo `trust` dai comandi).

Ciò che invece **è stato fatto adesso** è la metà che non richiede il registro:
il varco della [decisione 0010](../decisions/0010-comando-descritto-a-una-macchina.md) copre tutte e sei le strutturali. Un comando simulato, o che
si è dichiarato di sola lettura, riceve un host che nega `create`, `rename`,
`trash`, `restore` e `empty_trash` con un errore che dice perché, e c'è un test
che le prova **tutte** in fila proprio per accorgersi di quella che un giorno
qualcuno aggiungesse senza pensarci. Il giorno del §7.3, il rifiuto non va
costruito: va solo dato un secondo motivo.

*`storage_*` non sopravvive al freeze.* È l'unica rottura del giro e la linea di
base è ritagliata (`wit/frozen/0.1.0.wit`, con la ragione scritta lì dentro).
Con `data_*` da una parte (persistente, recintato dalla firma) e le impostazioni
del §11.1 dall'altra, allo store volatile a chiave→valore restava solo il caso
«ricordare qualcosa per la durata della sessione» — che il chiamante aveva già
risolto senza saperlo: un provider è un oggetto vivo nel workspace (`handle`
prende `&mut self`), e a M5 un componente WASM ha la propria memoria lineare. Una
capacità che l'host fornisce per qualcosa che il chiamante possiede già è
superficie da mantenere, documentare e sandboxare per sempre. La prova
dell'argomento è arrivata dal codice: l'unico uso vero in tutto il repo era un
test in cui un handler teneva un flag «l'ho già fatto», ed è diventato un campo
di quattro caratteri. Toglierlo dopo M4 sarebbe stata una major; qui è un
ritaglio che si vede in review.

**Cosa NON entra, una per una — perché saltarne una in silenzio è una feature
che dopo il freeze non potrà mai essere un plugin.**

- **`create_folder`** — no, §14.3. Nel kernel le cartelle non esistono: una
  cartella è il prefisso di un `DocId`. Una capacità che creasse una directory
  vuota sul disco produrrebbe una cosa che nessun'altra capacità vede —
  `list_documents` non la mostra, nessun evento la annuncia, nessuna query la
  interroga —, e una capacità il cui risultato è invisibile a tutte le altre non
  è una capacità: è un effetto collaterale sul filesystem. Oggi un plugin «crea
  una cartella» creando un documento dentro, che è ciò che fa anche la shell
  (`convertToFolder` è una rinomina). Quando il §14.3 darà alle cartelle un
  modello, questa sarà additiva.
- **Allegati/asset** (`read_asset`, `write_asset`, `list_assets`) — no, §14.1. Il
  modello non esiste: un PNG nel kernel *non esiste affatto* (`list_documents`
  filtra per estensione dei `FormatProvider`). Il varco senza il modello darebbe
  byte per un file di cui non si può sapere che c'è, che è cambiato, chi lo
  linka: una capacità senza le compagne che la rendono usabile. Va col §14.1.
- **Rete** (`http_fetch`, «solo dentro un job») — no, e le due voci aperte vanno
  lette **insieme**: questa voce la voleva solo dentro un job, e il §9.1 dice che un
  job non vede il vault. Messe insieme dicono che `http_fetch` oggi sarebbe una
  capacità che scarica qualcosa e non ha modo di farne niente — l'unico posto
  dove può girare è l'unico posto che non può scrivere. Servono prima §9.1 (un
  lavoro lungo che vede il vault) perché sia utile e §7.3 (`network` letto da
  qualcuno) perché sia sicura. Due bloccanti, entrambi nominati; dopo, additiva.
- **Tempo differito** (`schedule_at`, `schedule_every`) — no, §8.3. Il kernel è
  sincrono e non possiede thread: `spawn_job` accoda e chi ha i thread (l'app)
  drena. Uno scheduler dovrebbe rientrare in un `&mut Workspace` che in quel
  momento non ha nessuno in mano, e inventarlo qui vorrebbe dire decidere il
  modello di concorrenza del kernel dentro una firma dell'`HostApi`.
- **`notify(level, message)` e `progress(job, done, total)`** — no, e con un
  criterio che vale anche per la prossima. La [decisione 0010](../decisions/0010-comando-descritto-a-una-macchina.md) aveva stabilito che il
  **consenso** non è una capacità perché questo host non può fermarsi a
  chiedere; `notify` non aspetta risposta, quindi quel precedente non lo esclude
  — ma «non aspetta risposta» non è la scusa per entrare, è la **definizione di
  un evento**. La regola, da qui in poi: *una capacità è ciò di cui il chiamante
  ha bisogno della risposta per proseguire; ciò che si limita a informare è un
  evento.* Applicata: `notify` e `progress` sono varianti di `Event`, non metodi
  — e da evento guadagnano due cose che da capacità avrebbero dovuto inventarsi.
  Chi lo ha detto: `Origin.actor` ce l'hanno già, mentre `notify(level, message)`
  avrebbe avuto bisogno di un campo «mittente» che il plugin poteva riempire
  male. Cosa succede in simulazione: `emit` su un host in sola lettura è un
  no-op, quindi un dry-run non fa comparire toast — gratis, e giusto. Non sono
  state **aggiunte** in questo giro perché non hanno un cliente: il percorso in
  cui c'è un utente che aspetta è quello dei comandi, e lì `CommandOutcome.notify`
  già esiste; il centro notifiche è il §3 e il progresso vuole i job del §9.1.
  Quando arriveranno, arriveranno come `Event`, ed è additivo.
- **Log per-plugin** (`log(level, msg)`) — no, stesso criterio: informa e non
  aspetta risposta. Differenza con `notify`: il destinatario è lo sviluppatore,
  non l'utente (20.2, 24.2). Da nativo `tracing` funziona già; da WASM a M5
  l'host deve comunque catturare l'output del componente, e quello è il posto
  dove il log si raccoglie — non una firma in più su questo trait.
- **Leggere l'`Actor` corrente** — no, e la ragione è della [decisione 0012](../decisions/0012-origine-degli-eventi.md): l'origine è ciò
  che l'host **appone**, non ciò che il comando legge; un comando che si
  comportasse diversamente a seconda di chi lo chiama sarebbe una policy (§7.3)
  nascosta dentro un'implementazione. Se un giorno servirà, è additiva.
- **`set_active_context`** — no, già deciso alla [decisione 0007](../decisions/0007-contesto-di-sessione.md) e confermato: quale nota
  guarda l'utente e dove ha cliccato è una decisione dell'app, non una capacità
  da concedere.

**Il cliente vero, e ciò che ha reso vera una regola.** Le cinque azioni
strutturali della shell sono migrate a `CoreCommands` — `note.create`,
`note.rename`, `note.trash`, `trash.restore`, `trash.empty` — e usano **solo**
le capacità nuove, come le userebbe un plugin. Con loro sono spariti sei comandi
Tauri, ed è quella sparizione a rendere vera la regola del §16.6 («una feature
nuova non deve poter aggiungere un comando Tauri»), che finché quei sei erano lì
valeva solo per le feature che non toccano il vault. Restano due comandi Tauri
del giro, e restano per la stessa riga che divide tutto il resto: `list_trash` e
`propose_free_name` **leggono**, e un `CommandOutcome` porta un messaggio e un
effetto, non dati. Ciò che risponde con dei dati passa dal canale di lettura,
anche quando i dati sono del cestino e anche quando la risposta è un nome.

Il cliente di `run_command` è `vault.archive`: sposta N note in una cartella
invocando `note.rename` una volta per nota. Non nomina un solo link — la
riscrittura arriva dal comando invocato — e da lì si vedono in un test le tre
decisioni: simularlo restituisce l'unione dei piani dei passi (il modo viaggia
con l'host), applicarlo emette **un** `batch-ended` con l'attore di chi ha
chiesto, e il piano nomina anche le note che linkavano.

*Resta fuori, dichiarato:* la nota senza titolo di `note.create` si chiama
«Senza titolo» e nasce `.md` **per decisione del comando**, non del contratto:
qual è il formato predefinito lo sa il registro dei formati, che è del kernel e
non è una capacità — quando lo diventerà, sarà quello a rispondere. E la
distinzione fra il rifiuto di un permesso, il recinto del vault e la fiducia di
una view è ancora tutta dentro `PluginError::PermissionDenied(String)`, cioè
prosa: è il §12.2, e i test che discriminano per sottostringa sono lì a
ricordarlo.
