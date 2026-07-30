# 0038 — Il kernel possiede il sidecar: chi scrive l'organizzazione, e chi la porta dietro a un rename

|  |  |
|---|---|
| **Decisa** | 2026-07-28 |
| **Origine** | `todo.md` §11.3 (seduta 11) — chiude la voce |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/11-impostazioni-e-i-tre-stati.md)

---

`.fub/workspace.json` tiene le icone, le note appuntate, gli ordinamenti
scelti a mano e gli spazi: **come questo vault si presenta**. Sono dati
autorevoli e non derivati — persi, non si ricostruiscono da niente, a differenza
di `.fub-data/` che si cancella e si rifà con una scansione — ed erano tenuti
peggio dei derivati:

- li leggevano e scrivevano **due funzioni dell'host** con `std::fs` nudo
  (`records.rs`): niente versione di schema (§15.3), niente scrittura atomica,
  fuori dal cestino e dal versioning;
- si scriveva **il blob intero**: la shell rileggeva tutto, cambiava un campo e
  riscriveva tutto. Con due finestre sullo stesso vault è una *lost update* — la
  seconda che salva cancella ciò che ha fatto la prima, e nessuna delle due se ne
  accorge;
- la **migrazione sui rename era in TypeScript** (`migrateOrganization`),
  appesa all'evento `document_renamed` che la shell riceve. Un evento che i freni
  del canale possono troncare ([0034](0034-il-freno-e-il-raggruppamento.md)), e
  che a Fub chiuso non arriva affatto;
- e **leggerli era un comando IPC**, cioè una cosa che sapeva chiedere la shell e
  nessun altro.

La 0036 aveva scritto che lo store di configurazione doveva **assorbirlo**, non
affiancarlo. Questo verbale lo assorbe — con una precisazione che cambia la
forma della risposta.

## La risposta, in una frase

**Il sidecar resta dov'è, perché quello è il posto giusto — l'organizzazione
viaggia col vault — ma cambia proprietario: lo tiene il kernel, gemello dello
store di configurazione e con la stessa disciplina (versione di schema, scrittura
atomica, un file illeggibile che non si riscrive); si scrive per chiave e non a
blob intero; si legge dal canale dati come qualunque altro dato; e la migrazione
dei rename sta dentro l'operazione che sposta l'identità, non su un evento.**

## Le decisioni prese, da NON ridiscutere senza motivo

### «Assorbire» non voleva dire spostarlo dentro le impostazioni

La 0036 diceva «lo store di configurazione deve assorbirlo», e la lettura
letterale sarebbe stata: le icone diventano chiavi di impostazione. Sarebbe stata
sbagliata, e per le stesse ragioni che la 0036 usa per tenere fuori gli altri due
stati: un'impostazione **ha uno schema dichiarato in un manifest**, e le chiavi
qui sono path che l'utente crea rinominando le proprie note; un'impostazione ha
un valore per chiave, questa ha una mappa che cresce col vault.

Ciò che andava assorbito era **la disciplina**, non il file. Il file resta
`<root>/.fub/workspace.json` perché l'organizzazione *viaggia col vault*: chi
sincronizza le sue note si porta dietro il modo in cui le ha messe in ordine, e
chi passa un vault a un collega gliene passa uno organizzato. È esattamente il
confine opposto a quello dello stato di vista ([0037](0037-lo-stato-di-vista.md)),
che sta nella cartella della macchina proprio perché non deve viaggiare — e i due
verbali insieme chiudono la domanda che la seduta 11 poneva: *dove sta ciascuna
delle tre cose, e perché non nello stesso posto*.

### Il tipo sale nel contratto, e cambia nome

`WorkspaceMeta` era un tipo dell'host, rispecchiato nel mirror TS dell'app.
Adesso è `fub_abi::organization::Organization`, perché attraversa il contratto:
lo restituisce `IndexResult::Organization`.

Il nome cambia per una ragione che si vede solo dal kernel: là dentro
`Workspace` è **un'altra cosa** — il vault montato, coi suoi indici e i suoi
provider — e due tipi vicini che dicono «workspace» intendendo l'uno il vault
aperto e l'altro le sue icone sono il genere di vicinanza che si legge male una
volta sola, e poi si ricopia.

### Si legge dal canale dati

`IndexQuery::Organization` → `IndexResult::Organization`, servita dall'indice del
kernel come le impostazioni, i tag e lo stato del vault. La regola è quella della
[0013](0013-elenco-delle-capacita.md): un elenco è **dati**, e i dati hanno un
canale solo. Prima era un comando IPC, quindi la shell poteva chiedere
l'organizzazione e un provider no — e un pannello di terzi che volesse mostrare
le note appuntate non aveva modo di sapere quali fossero.

Ne segue anche chi può **rispondere**: il kernel dichiara la rotta
(`QueryKind::Organization`), e prima quella domanda non aveva un proprietario
affatto.

### Si scrive per chiave — e non è una capacità

Quattro mutatori: `set_icon`, `set_pinned`, `set_space`, `set_order`. Sostituiscono
la coppia leggi-tutto/scrivi-tutto, e chiudono la *lost update* fra due finestre:
ognuno tocca la propria chiave, e il resto del file non passa nemmeno dalle mani
di chi scrive.

Sono metodi del `Workspace` e comandi IPC, **non capacità dell'`HostApi`**. È la
regola del §1.6 applicata al contrario: una variante entra nel contratto solo con
un cliente vero, e qui il cliente vero non c'è — nessun plugin chiede di
appuntare una nota. Una capacità concessa a nessuno è superficie da mantenere,
documentare e sandboxare per sempre, ed è più facile aggiungerla il giorno che
serve che toglierla dopo averla congelata. Leggere invece passa dal canale dati,
che chiunque ha: l'asimmetria è voluta e riflette chi ha un caso d'uso oggi.

### La migrazione sta dentro l'operazione, non sull'evento

`migrate_identity` — il punto in cui un documento cambia path — sposta anche
icona, pin e posto nell'ordinamento. Il testo della roadmap diceva «migrazione
della chiave lato kernel **sull'evento `DocumentRenamed`**», e lo scarto va
motivato: è la lezione di M2 sugli `IndexProvider`. La coda degli eventi ha un
budget e può troncare ([0034](0034-il-freno-e-il-raggruppamento.md)); un dato
derivato che si perde un evento si ricostruisce, un dato **autorevole** no.

Il guadagno si vede subito, ed è più grande della sola robustezza: passando di
lì migra anche la rinomina fatta da **un'altra app mentre Fub è aperto**,
perché `sync_renamed_path` — la strada del rilevatore — arriva allo stesso punto.
Con la migrazione nella shell, quel caso era scoperto: la nota si spostava e
l'icona restava attaccata al path vecchio.

L'errore **non risale**: il file è già stato spostato quando si arriva lì, e far
fallire una rinomina riuscita perché un'icona non si è spostata sarebbe il verso
sbagliato. La rinomina vale, l'icona resta indietro, e qualcuno lo dice
(`organization_warnings`).

### La versione di schema arriva su un file che non ce l'aveva

Il campo `version` è nuovo su un formato che esiste già. Un file scritto prima di
questa voce non ce l'ha: `#[serde(default)]` lo fa valere `0`, che è ≤ della
versione corrente, quindi si apre e si legge — e la prima scrittura lo porta a 1.
È anche l'argomento a favore della regola: una versione si mette **dal primo
giorno**, perché aggiungerla dopo funziona solo grazie all'assunzione che ciò che
non ce l'ha venga da prima.

### Un ordine vuoto si dimentica

`set_order(cartella, [])` toglie la chiave invece di scrivere una lista vuota:
«nessun ordine scelto a mano» e «un ordine scelto a mano che è vuoto» sono la
stessa cosa per chi legge, e la prima si scrive senza lasciare una riga per ogni
cartella che qualcuno ha toccato e rimesso a posto. Stessa mossa del filtro nella
[0037](0037-lo-stato-di-vista.md), e per la stessa ragione.

### Gli orfani restano, ed è una scelta

Una chiave che punta a un path che non esiste più **non si pota**. La politica va
dichiarata invece di restare implicita, perché la scelta opposta sembra più
ordinata: un vault cambia anche fuori di qui — un file torna da un backup, un
`git checkout` cambia branch, una cartella si rimonta — e potare l'icona di una
nota che ricomparirà domani vuol dire distruggere un dato autorevole per fare
ordine in un file di poche righe. Il costo di tenerli è una riga di JSON; quello
di sbagliare a toglierli non si ripara.

### La shell tiene uno specchio, e scrive prima sul backend

`state.meta` resta, ma non è più la verità: è uno specchio di ciò che il kernel
tiene. Le scritture vanno **prima al backend e poi allo specchio**, che è il
verso opposto a quello di prima — con l'ottimismo al contrario una scrittura
rifiutata (un sidecar illeggibile) lascerebbe la sidebar a mostrare un'icona che
sul disco non c'è, e l'utente la ritroverebbe sparita alla riapertura.

Sparisce anche `metaBroken`, il flag con cui la shell si ricordava di non
salvare: adesso il congelamento lo fa il kernel, rifiutando ogni scrittura una
per una. Un secondo posto in cui ricordarsi di non salvare era un posto in cui
dimenticarsene.

## Cosa si è scartato, e perché

**Tenere il sidecar dentro `.fub-data/`.** È la cartella dei dati derivati, e
questi non lo sono: una cartella che si può cancellare per liberare spazio non è
il posto di un dato che, perso, non torna.

**Farne chiavi di impostazione.** Vedi sopra: uno schema dichiarato in un
manifest non descrive chiavi che l'utente crea rinominando le proprie note.

**Le quattro scritture come capacità dell'`HostApi`.** Sarebbe stato coerente
con «leggere passa dal canale dati», ed è stato scartato per la regola del §1.6:
nessun plugin le chiede oggi. Il giorno che un plugin vorrà appuntare una nota,
la capacità si aggiunge — additiva, quindi minor.

**Dedurre la rinomina di una cartella da N rinomine di documenti.** Il kernel non
ha un'operazione «rinomina cartella», e da un'altra app quel gesto arriva come N
rinomine di documenti: le icone delle *note* migrano quindi una per una, quella
della cartella no. Indovinare «la cartella X è diventata Y» da un prefisso comune
è un indovinello, e questo file tiene dati autorevoli. È scritto fra le cose
scoperte, non risolto a metà.

## Cosa resta scoperto (e dove è scritto)

- **La rinomina fatta a Fub chiuso.** Nessuno la vede, e al riavvio non c'è
  modo di sapere che `b.md` era `a.md`: l'icona resta orfana. Non è questa voce —
  è il **§13.1** (P0, aperto), *il path è l'identità*, e si chiude dando ai
  documenti un'identità che il path non è. Questa voce ha chiuso ciò che si può
  chiudere finché l'identità è il path.
- **La rinomina di una cartella**, per la ragione qui sopra: icona e ordine della
  cartella restano orfani.
- **Nessuno lo dice all'utente.** Un sidecar illeggibile adesso fa fallire ogni
  scrittura con un messaggio, e la shell lo scrive in console — che in un'app
  impacchettata non si apre. La superficie che manca è il **§20.4**, e questa
  voce ha migliorato ciò che c'era sotto: prima la shell smetteva di salvare in
  silenzio, adesso il rifiuto almeno esiste come esito.
- **Gli orfani non si potano**, per scelta dichiarata sopra.
