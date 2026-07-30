//! Eventi del sistema, smistati dall'event bus del kernel. I plugin
//! [`EventHandler`](crate::traits::EventHandler) vi si abbonano tramite una
//! [`EventMask`], e ricevono un [`Notice`]: l'evento **e chi lo ha causato**.
//!
//! # Il lotto (decisione 0011): N scritture che sono una cosa sola
//!
//! Il kernel muta un documento alla volta, e questo è giusto: la primitiva di
//! scrittura è per-documento (decisione 0008) e non c'è ragione di cambiarla. Ciò che
//! manca è il modo di dire che N di quelle mutazioni sono **una** operazione.
//! Il caso non è ipotetico: rinominare una nota con 200 backlink riscrive 200
//! sorgenti, ognuna con il suo [`Event::DocumentChanged`] e il suo
//! [`Event::IndexUpdated`], e chi ridisegna su `index-updated` — la shell, ogni
//! view iscritta — lo fa duecento volte per un'operazione che l'utente ha
//! chiesto una volta sola.
//!
//! Un lotto è uno **scope**: il kernel lo apre, ciò che succede dentro porta il
//! suo [`Origin::batch`], e alla chiusura arriva un [`Event::BatchEnded`] con
//! l'elenco dei documenti toccati.
//!
//! ## Cosa il lotto coalizza, e cosa no
//!
//! Solo `index-updated`, e per una ragione precisa: è l'unico evento del
//! contratto **senza payload**, cioè l'unico di cui N copie dicono esattamente
//! quanto ne dice una. Dentro un lotto non viene emesso; al suo posto, alla
//! chiusura, arriva `batch-ended` — che dice la stessa cosa e in più dice
//! *quali* documenti. Gli eventi per-documento invece **continuano a passare
//! tutti**: un handler che reagisce a `document-changed` non deve cambiare una
//! riga per sopravvivere a un lotto, e non perde niente.
//!
//! È l'unico punto in cui questa voce non è additiva, e va detto: chi deriva
//! stato dall'**indice** e si era abbonato al solo `index-updated` dentro un
//! lotto non riceve più niente. La regola è quindi una sola, e il kernel la
//! verifica sulle proprie [`ViewSpec`](crate::traits::ViewSpec): *chi dichiara
//! `index-updated` dichiara anche `batch-ended`*. L'alternativa — emettere tutti
//! e due — avrebbe fatto costare a ogni lotto due ridisegni completi, cioè
//! esattamente il costo che questa voce esiste per togliere.
//!
//! ## Un lotto non è una transazione
//!
//! Non annulla niente. Se una delle N scritture fallisce, le altre restano
//! fatte, e chi ha aperto il lotto se ne accorge dal proprio `Result` — non da
//! un rollback che non c'è. È una scelta a verbale e non una mancanza: il
//! tutto-o-niente vuole un **journal** (§15.2) che sappia rimettere a posto
//! anche se il processo muore nel mezzo, e prometterlo con un nome —
//! `transaction`, `tx`, `rollback` — significherebbe farlo credere a chi legge
//! solo la firma. Il materiale per costruirlo c'è già
//! ([`EditReport::inverse`](crate::edit::EditReport::inverse)); il meccanismo è
//! un'altra milestone, e di chi vinca fra le pile decide il §13.3.
//!
//! # L'origine (decisione 0012): chi ha causato un evento
//!
//! `DocumentChanged { id }` non diceva chi lo aveva provocato, e la shell già ci
//! girava intorno confrontando il testo per non resettare il cursore sull'eco
//! del proprio salvataggio. Con i trigger di 16.2 smette di essere un fastidio e
//! diventa un requisito: un'automazione su-modifica che scrive **si richiama da
//! sé**, e l'unica difesa era il budget del dispatch, che tronca — una rete di
//! sicurezza, non una semantica.
//!
//! [`Origin::actor`] è **chi ha chiesto** l'operazione, non chi l'ha eseguita.
//! La distinzione è la sostanza della voce: quando un'automazione invoca un
//! comando, i documenti li scrive il comando, ma l'origine è l'automazione — ed è
//! ciò che permette al suo stesso handler di dire «questa l'ho scritta io» senza
//! tenere una contabilità privata.
//!
//! # La grana di un abbonamento (decisione 0033): il topic, e il soggetto
//!
//! Una [`EventMask`] era una lista di [`EventKind`], e con quella sola grana
//! chi si abbonava ai custom li riceveva **tutti** — ogni topic di ogni plugin —
//! e chi si abbonava a `document-changed` si svegliava per **ogni** documento
//! del vault. Sul canale più caldo del contratto sono N feature × M documenti,
//! e il costo non lo paga chi aggiunge l'abbonamento: lo pagano tutti gli altri,
//! a ogni scrittura.
//!
//! I campi sono tre e sono in **and**: le specie, i **prefissi di topic**
//! (`ns:nome` del §7.4, spezzati sui separatori del contratto e non sui
//! caratteri) e i **soggetti** ([`Subject`]) — un documento, o una cartella
//! come prefisso di path finché il §14.3 non ne fa un cittadino del kernel.
//! Ognuno vuoto vuol dire *non filtro*: una maschera scritta prima di questa
//! decisione riceve esattamente ciò che riceveva.
//!
//! La regola sta in [`crate::rules::events`] e non qui accanto perché ha **due**
//! lettori: il kernel, che consegna agli handler, e la shell, che decide da sé
//! quando ridisegnare una view dichiarata. Due letture della stessa maschera
//! sono due modi di restringerla, e il secondo non lo vedrebbe nessun test.
//!
//! # Il lavoro lungo si racconta (decisione 0035): tre eventi, non una capacità
//!
//! Un job aveva un evento solo, l'esito ([`Event::JobDone`]), e chi lo aveva
//! chiesto restava senza notizie fino alla fine — un export di duemila note era
//! indistinguibile da un'app ferma. Adesso il ciclo è per intero sul canale:
//! [`JobStarted`](Event::JobStarted) quando il job è accettato,
//! [`JobProgress`](Event::JobProgress) quante volte il job vuole,
//! [`JobDone`](Event::JobDone) alla fine.
//!
//! Il nodo era che **un job non conosce il proprio [`JobId`]**: `run_job` riceve
//! il nome dell'entry point, gli argomenti e l'host, non l'identità. La risposta
//! non cambia la regola della decisione 0013 — il progresso *informa*, quindi è
//! un evento — e mette l'identità dove sta: la timbra l'host del job, quando il
//! job passa da
//! [`report_progress`](crate::traits::HostEvents::report_progress). Da lì viene
//! una proprietà che una firma con l'id fra i parametri non avrebbe: nessuno può
//! raccontare il progresso di un altro.
//!
//! I due eventi nuovi sono **recuperabili**: chi arriva dopo, o chi ha ricevuto
//! un [`Overflow`](Event::Overflow), ricostruisce l'elenco con
//! [`IndexQuery::Jobs`](crate::traits::IndexQuery::Jobs). Per il progresso non è
//! una comodità: è la condizione perché il canale più fitto del contratto possa
//! essere frenato come tutti gli altri.
//!
//! # Cosa resta deliberatamente fuori
//!
//! - **L'annullamento** di un lotto (§15.2 + §13.3): vedi sopra.
//! - **Il lotto aperto da un plugin**: `HostApi` non offre `batch(|…|)` perché
//!   uno scope a chiusura garantita non attraversa il confine dei componenti —
//!   un plugin che aprisse un lotto e non lo chiudesse (o morisse) lo lascerebbe
//!   aperto per sempre. Il lotto di un plugin è la sua **invocazione di
//!   comando**, che l'host apre e chiude per lui.
//! - **Quale comando** ha causato l'operazione: `Origin` porta l'attore e il
//!   lotto, non l'id del comando né il prompt che lo ha generato. Sono i campi
//!   dell'audit trail di 22.4, e vogliono un posto che li conservi (il journal
//!   del §15.2): un campo che nessuno rilegge dopo la fine del giro non è un
//!   audit trail, è una decorazione. Additivo il giorno che il posto c'è.
//! - **L'edit sull'evento**: chi riceve `DocumentChanged` sa che il documento è
//!   cambiato, non *come*. Resta la decisione 0008 a dare la forma e questa voce a non
//!   usarla ancora.

use serde::{Deserialize, Serialize};

use crate::error::PluginError;
use crate::model::DocId;
use crate::settings::SettingScope;
use crate::traits::{EntryKind, JobId, JobProgress};

/// Identità di un lotto (decisione 0011): le N scritture che la portano sono una cosa
/// sola.
///
/// Come [`JobId`], sul confine JSON viaggia come **stringa** — è un u64 pieno
/// usato come identità, e `JSON.parse` perde i bit oltre 2⁵³ in silenzio (vedi
/// [`crate::ipc`]). Nel WIT resta `u64` nativo.
///
/// È opaca e non ordinabile per contratto: due lotti diversi hanno id diversi, e
/// nient'altro è promesso. Chi la confronta con `<` sta assumendo un ordine che
/// un host con più sessioni (§9.6) non deve al suo chiamante.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct BatchId(pub u64);

impl Serialize for BatchId {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        crate::ipc::u64_string::serialize(&self.0, s)
    }
}

impl<'de> Deserialize<'de> for BatchId {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        crate::ipc::u64_string::deserialize(d).map(BatchId)
    }
}

/// Chi ha **chiesto** l'operazione da cui un evento nasce.
///
/// Non chi l'ha eseguita: un comando invocato da un'automazione scrive con
/// l'origine dell'automazione, non con la propria. È la sola lettura per cui il
/// campo esiste — «questa l'ho scritta io?» — e leggerlo come "chi ha toccato il
/// disco" darebbe la risposta sbagliata proprio nel caso di 16.2.
///
/// Enum chiuso e non un record libero: un `String` avrebbe permesso a ogni
/// chiamante di inventarsi la propria convenzione, e un campo su cui non ci si
/// può confrontare non serve a decidere.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Actor {
    /// La persona davanti allo schermo, per il tramite della shell: un
    /// salvataggio, un rename, un comando invocato dalla palette.
    #[default]
    User,
    /// Il filesystem: un'altra app, un sync, una copia da terminale. È l'unica
    /// origine che dice «il vault è cambiato senza passare da noi».
    Watcher,
    /// Il kernel stesso, per ciò che non è di nessun altro: l'apertura del
    /// vault, l'esito di un job, il troncamento della coda.
    Kernel,
    /// Un plugin che ha agito di propria iniziativa (tipicamente dentro
    /// `handle`): l'`id` è quello con cui è registrato.
    Plugin { id: String },
}

impl Actor {
    /// È questo plugin ad aver chiesto l'operazione?
    ///
    /// Sta qui e non in ogni handler perché è *la* domanda per cui l'origine
    /// esiste, e un `matches!` scritto a mano in ogni automazione è un modo in
    /// più di sbagliarla.
    pub fn is_plugin(&self, plugin: &str) -> bool {
        matches!(self, Actor::Plugin { id } if id == plugin)
    }
}

/// Da dove viene un evento: chi lo ha chiesto, e di quale lotto fa parte.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Origin {
    pub actor: Actor,
    /// Il lotto (decisione 0011) dentro cui l'evento è stato emesso, se ce n'è uno.
    /// `None` non significa "non importante": significa che questa scrittura sta
    /// da sola.
    pub batch: Option<BatchId>,
}

impl Origin {
    pub fn by(actor: Actor) -> Self {
        Origin { actor, batch: None }
    }

    pub fn in_batch(mut self, batch: Option<BatchId>) -> Self {
        self.batch = batch;
        self
    }
}

/// Un evento **e** la sua origine: ciò che un handler riceve.
///
/// Un record e non un campo dentro ogni variante dell'evento: l'origine è
/// ortogonale a *cosa* è successo, e ripeterla in otto varianti avrebbe
/// costretto ogni `match` a destrutturarla anche dove non la guarda.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Notice {
    pub event: Event,
    pub origin: Origin,
}

impl Notice {
    pub fn new(event: Event, origin: Origin) -> Self {
        Notice { event, origin }
    }

    /// Un evento senza un'origine particolare: lo ha chiesto l'utente e non fa
    /// parte di un lotto. È la scorciatoia dei test e dei doppi, non una via
    /// dell'host — il kernel l'origine ce l'ha sempre.
    pub fn of(event: Event) -> Self {
        Notice {
            event,
            origin: Origin::default(),
        }
    }

    pub fn kind(&self) -> EventKind {
        self.event.kind()
    }
}

/// Un evento del ciclo di vita del vault.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    /// Il vault è stato aperto/caricato (path radice).
    VaultOpened { root: String },
    /// Un documento è stato creato o modificato.
    DocumentChanged { id: DocId },
    /// Un documento è stato rimosso.
    DocumentRemoved { id: DocId },
    /// Un documento ha cambiato path (l'identità È il path: chi tiene stato
    /// per-documento deve migrare la chiave, non trattarlo come remove+add).
    DocumentRenamed { from: DocId, to: DocId },
    /// L'indice/grafo è stato aggiornato dopo un batch di modifiche.
    ///
    /// **Dentro un lotto non arriva**: al suo posto arriva un [`BatchEnded`],
    /// una volta sola e con l'elenco dei documenti. Chi si abbona a questo si
    /// abbona anche a quello.
    ///
    /// [`BatchEnded`]: Event::BatchEnded
    IndexUpdated,
    /// Esito di un job in background (vedi `HostEvents::spawn_job`): consegnato
    /// sul giro sincrono normale. Chi ha lanciato il job riconosce il proprio
    /// `id`; `job` è il nome dell'entry point, per comodità di filtro.
    JobDone {
        id: JobId,
        job: String,
        result: Result<serde_json::Value, PluginError>,
    },
    /// La coda eventi è stata troncata: il budget anti-ping-pong del dispatch
    /// si è esaurito e `dropped` eventi NON sono stati consegnati agli
    /// handler. Chi deriva stato dagli eventi (indice, grafo, cache) deve
    /// considerarlo stantio e riconciliare da zero. Mai silenzioso: questo
    /// evento è la versione rumorosa del troncamento.
    Overflow { dropped: u64 },
    /// Varco di estensione: eventi definiti dai plugin, con topic **namespaced
    /// come ogni altro nome del contratto** (§7.4): o è l'id di chi lo emette,
    /// o è dentro di esso (`com.acme.tasks:done`). Il core può emettere anche
    /// nudo.
    ///
    /// La convenzione era scritta qui (`"<plugin-id>/<nome>"`) e non la imponeva
    /// niente: un plugin poteva emettere sotto il nome di un altro e far
    /// reagire i suoi handler. Adesso è la stessa regola degli id di view, di
    /// comando e di rotta, e la fa rispettare l'host quando l'evento passa —
    /// che è il solo momento in cui esiste, non avendo una registrazione.
    ///
    /// L'abbonamento è a grana `EventKind::Custom`; il filtro sul topic è a
    /// carico dell'handler.
    Custom {
        topic: String,
        payload: serde_json::Value,
    },
    /// Un lotto (decisione 0011) si è chiuso: le N scritture che lo compongono sono una
    /// cosa sola, e `changed` sono i documenti che ha toccato — creati,
    /// riscritti, rimossi o rinominati — in ordine di prima apparizione e senza
    /// ripetizioni.
    ///
    /// Sostituisce l'[`IndexUpdated`](Event::IndexUpdated) che ognuna di quelle
    /// scritture avrebbe emesso: chi ridisegna lo fa **una volta**, e sa su cosa.
    /// Un lotto che non ha toccato niente non lo emette affatto — come una
    /// modifica senza edit non è una scrittura.
    ///
    /// Non dice se il lotto è **riuscito** per intero: un lotto non è una
    /// transazione (vedi il doc del modulo), e ciò che non è andato lo sa chi lo
    /// ha aperto, dal proprio errore. Un campo `ok: bool` qui sarebbe una
    /// promessa di atomicità che nessuno mantiene.
    BatchEnded { batch: BatchId, changed: Vec<DocId> },
    /// Una view è **invecchiata** per un motivo che il vault non conosce: un job
    /// finito, una risposta dalla rete, un calcolo completato (§2.5).
    ///
    /// Prima di questo evento il protocollo di view era pull-only: `refresh` è
    /// una maschera sugli eventi *del kernel* e `ViewUpdate` esiste solo come
    /// risposta a `on_action`, quindi un provider che finiva un lavoro lungo non
    /// aveva **modo di dire «ridisegnami»** se non emettendo un
    /// [`Custom`](Event::Custom) — cioè svegliando ogni handler e ogni view del
    /// sistema.
    ///
    /// Che sia un evento e non una capacità `invalidate_view` non è una scelta
    /// di comodo: è la regola della decisione 0013 — *una capacità è ciò di cui
    /// il chiamante ha bisogno della risposta per proseguire; ciò che si limita
    /// a informare è un evento*. Da evento guadagna anche l'origine
    /// ([`Origin::actor`]), che una capacità avrebbe dovuto farsi dichiarare da
    /// chi la chiama.
    ///
    /// `instance` assente = **tutte** le istanze di quella view: è ciò che
    /// serve a chi ha ricalcolato un dato che vale per tutte, e chi ne ha
    /// invecchiata una sola la nomina.
    ///
    /// La regola di coalescing è di chi disegna, ed è scritta accanto a lui:
    /// venti inviti a ridisegnare in un giro sono **un** ridisegno.
    ViewInvalidated {
        view: String,
        instance: Option<String>,
    },
    /// Il vault sta per chiudersi: è l'**ultimo giro sincrono** in cui il vault
    /// è ancora quello di prima, ed è il gemello di
    /// [`VaultOpened`](Event::VaultOpened).
    ///
    /// Arriva **prima** che si spenga qualcuno (decisione 0029): chi lo riceve è
    /// ancora registrato, ha ancora l'`HostApi` e può ancora scrivere — è
    /// l'ultimo momento utile per rendere durevole ciò che teneva in memoria. Un
    /// indice non ne ha bisogno (ha `flush` e `close`, che il kernel gli chiama
    /// subito dopo); ne ha bisogno chiunque *non* sia un indice, cioè ogni
    /// `EventHandler` — che non ha, e non avrà, un metodo di ciclo di vita
    /// proprio.
    ///
    /// Che sia un evento e non una chiamata sul trait è la regola della
    /// decisione 0013: chi chiude non ha bisogno della risposta per proseguire,
    /// e la chiusura non si annulla. Chi non fa in tempo a scrivere ha comunque
    /// perso solo ciò che non aveva reso durevole.
    VaultClosed { root: String },
    /// Un lavoro lungo è stato **accettato** (§10.3, decisione 0035): il gemello
    /// d'apertura di [`JobDone`](Event::JobDone), ed è il momento in cui un
    /// centro attività fa comparire la riga.
    ///
    /// «Accettato» e non «partito»: lo emette il kernel quando il job entra in
    /// coda, perché quando parta davvero lo sa solo chi possiede i thread — e la
    /// differenza non cambia niente né per chi guarda né per chi ferma, dato che
    /// un job in coda si annulla come uno in volo (decisione 0032). Il contrario
    /// — aspettare che un thread lo prenda in mano — vorrebbe dire non mostrare,
    /// e non lasciar fermare, esattamente i job che stanno aspettando.
    ///
    /// `job` è il nome dell'entry point, come in `JobDone`; **chi** lo ha chiesto
    /// lo dice [`Origin::actor`], che qui non è il kernel ma il richiedente.
    JobStarted { id: JobId, job: String },
    /// A che punto è un lavoro lungo (§10.3, decisione 0035).
    ///
    /// Lo emette l'host del job quando il job chiama
    /// [`HostEvents::report_progress`](crate::traits::HostEvents::report_progress):
    /// il fatto è un evento — *ciò che si limita a informare* (decisione 0013) —
    /// e l'identità la mette chi ce l'ha, perché un job non conosce il proprio
    /// [`JobId`].
    ///
    /// È il canale **più caldo** del contratto: un job che cammina il vault può
    /// chiamarlo per nota. Per questo si butta senza rimpianti — è
    /// [recuperabile](Event::is_recoverable), e ciò che lo riscopre è
    /// [`IndexQuery::Jobs`](crate::traits::IndexQuery::Jobs) — e per questo il
    /// ponte verso la shell ne tiene **l'ultimo per job** dentro una raffica
    /// (decisione 0034): venti passi avanti in un giro sono un passo avanti.
    JobProgress { id: JobId, progress: JobProgress },
    /// Un'impostazione è cambiata (§11.1): la chiave, e il livello in cui il
    /// valore è stato scritto o da cui è stato tolto.
    ///
    /// Non porta il **valore nuovo**, ed è deliberato: chi reagisce a una
    /// configurazione la rilegge
    /// ([`SettingsRead::setting`](crate::traits::SettingsRead::setting)), e un
    /// valore dentro l'evento sarebbe una seconda copia che invecchia — due
    /// scritture ravvicinate consegnate in ordine inverso, o una consegna persa,
    /// lascerebbero chi ascolta convinto di un valore che non è più quello. La
    /// chiave dice *cosa riguardarsi*, che è l'unica cosa che non si può dedurre
    /// da sola.
    ///
    /// Per la stessa ragione **non è recuperabile**: si può rileggere il valore,
    /// ma non si può riscoprire che è cambiato — e chi si spegne quando lo
    /// spengono deve saperlo anche quando la coda è piena.
    SettingChanged { key: String, scope: SettingScope },
    /// Un file che **non è un documento** è comparso o è cambiato (§14.1): un
    /// allegato, o qualcosa che nessuno sa cosa sia.
    ///
    /// I tre eventi dell'anagrafe sono i gemelli dei tre dei documenti, e sono
    /// tre e non uno per la stessa ragione: l'abbonamento ha la grana del
    /// [`EventKind`] ([decisione 0033](../../../docs/decisions/0033-la-grana-di-un-abbonamento.md)),
    /// e chi vuole sapere solo delle sparizioni — una cache di miniature, un
    /// pannello degli allegati — deve poterlo dire senza ricevere tutto e
    /// filtrare il payload.
    ///
    /// # Perché non `DocumentChanged`
    ///
    /// Perché sarebbe una bugia che qualcuno legge. `DocumentChanged` ha, da
    /// contratto, un lettore che ne riparsa il modello, ne rilegge l'outline, ne
    /// ricalcola i backlink: consegnargli un PNG vuol dire fargli chiedere il
    /// modello di un'immagine. E la bugia sarebbe **retroattiva** — ogni handler
    /// scritto prima di questa voce comincerebbe a ricevere file che non ha mai
    /// chiesto, senza aver cambiato una riga.
    ///
    /// `kind` non è mai [`EntryKind::Document`]: quelli hanno i loro tre eventi.
    /// C'è perché chi ascolta filtra su di lui (un generatore di miniature vuole
    /// gli `Asset`) e perché su una **sparizione** non si può più chiedere: la
    /// voce non c'è più, e l'unico momento in cui la sua specie è ancora nota è
    /// questo.
    EntryChanged { id: DocId, kind: EntryKind },
    /// Un file che non è un documento non c'è più (§14.1).
    EntryRemoved { id: DocId, kind: EntryKind },
    /// Un file che non è un documento ha cambiato path (§14.1).
    ///
    /// Come per [`DocumentRenamed`](Event::DocumentRenamed), **l'identità è il
    /// path**: chi tiene stato attaccato a un allegato — una miniatura, una
    /// trascrizione, un OCR — migra la chiave invece di trattarlo come una
    /// sparizione seguita da una comparsa, o butta via un lavoro che era ancora
    /// buono.
    EntryRenamed {
        from: DocId,
        to: DocId,
        kind: EntryKind,
    },
    /// **Qualcosa è andato storto** (§20.2, decisione 0052): la variante che
    /// la [decisione 0013](../../../docs/decisions/0013-elenco-delle-capacita.md)
    /// aveva previsto — *ciò che si limita a informare è un evento* — e
    /// rimandato perché non aveva un cliente.
    ///
    /// I clienti sono arrivati tutti insieme: **erano** ventisette `eprintln!`
    /// nel backend più due commenti del kernel che nominavano questo canale per
    /// nome («M4: notifica»). Ciò che passa di qui non è un log: è un fatto che
    /// una persona ha diritto di sapere, e in un'app impacchettata `stderr`
    /// non ha un lettore.
    ///
    /// Che cosa, di quei ventisette, passi di qui è deciso dalla
    /// [0062](../../../docs/decisions/0062-il-log-e-il-pavimento-l-evento-e-la-porta.md),
    /// ed è la sola parte di questa prosa che non è più storia: il criterio è
    /// *il log è il pavimento, l'evento è la porta*, e apre la porta solo ciò
    /// che racconta una **perdita**. Le diagnosi per chi sviluppa restano nel
    /// pavimento del log, e `stderr` di produzione è sceso a zero: l'unico
    /// che resta è il sink del log quando non c'è un posto dove scrivere.
    ///
    /// # Perché non è recuperabile
    ///
    /// Perché è **l'unica copia di un fatto**: un guasto non si riscopre
    /// guardando il vault: il vault dopo un flush fallito è identico a com'era
    /// prima, ed è esattamente questa la ragione per cui il flush fallito va
    /// detto. Buttarlo via sotto pressione vorrebbe dire perdere in silenzio
    /// proprio il messaggio che esiste per non perdere niente in silenzio — e
    /// il canale si riempie quando le cose vanno male, cioè quando serve.
    ///
    /// # Il guasto della consegna di un guasto
    ///
    /// Non si emette. Un handler che fallisce **ricevendo** un `Trouble`
    /// produrrebbe un secondo `Trouble` che passa dallo stesso handler, e la
    /// regola sta nel kernel perché è il kernel a emettere: è l'unico ciclo che
    /// questa variante rende possibile, e si chiude dove nasce.
    Trouble {
        severity: Severity,
        /// Il documento di cui si parla, se se ne parla di uno. `None` per ciò
        /// che riguarda il vault intero — un flush fallito, il watcher che
        /// smette — ed è per questo che chi filtra per soggetto lo lascia
        /// **passare**: vedi [`Event::names`].
        subject: Option<DocId>,
        /// **Cosa** è andato storto, nella forma con cui ogni fallimento arriva
        /// a chi disegna (decisione 0041): un `Text`, quindi traducibile da chi
        /// lo mostra invece che una frase già composta.
        error: PluginError,
    },
}

/// Quanto pesa ciò che è andato storto (§20.2, decisione 0052).
///
/// Due gradini e non cinque, come i due toni del centro notifiche: una scala
/// che chi emette non sa dove tagliare finisce con tutto sullo stesso gradino,
/// e a quel punto non distingue più niente.
///
/// Il criterio del taglio è quello della
/// [decisione 0048](../../../docs/decisions/0048-una-radice-sola.md), ed è
/// l'unica ragione per cui questo campo lo si può compilare senza indovinare:
/// **la classe del dato perso dice la severità**. Ciò che è *derivato* si
/// ricostruisce riaprendo il vault, e la sua perdita è un
/// [`Warning`](Severity::Warning); ciò che era autorevole non torna, e la sua
/// perdita è un [`Failure`](Severity::Failure).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    /// Si è perso un **derivato**: un documento che non è entrato in un indice,
    /// un flush che non ha scritto. Il vault è intatto, la verità si
    /// ricostruisce, e ciò che l'utente vede nel frattempo è una risposta
    /// incompleta — che è già abbastanza per doverglielo dire.
    Warning,
    /// Si è perso qualcosa che **non si ricostruisce**: una versione non
    /// salvata, il sidecar di una voce di cestino non scritto (il ripristino
    /// tornerà nel posto sbagliato), una scrittura che non è andata sul disco.
    ///
    /// È anche ciò che il kernel usa quando **non sa**: un handler di terzi che
    /// fallisce non dice cosa non è successo, e sottostimare un guasto è peggio
    /// che sovrastimare un avviso.
    Failure,
}

impl Event {
    pub fn kind(&self) -> EventKind {
        match self {
            Event::VaultOpened { .. } => EventKind::VaultOpened,
            Event::VaultClosed { .. } => EventKind::VaultClosed,
            Event::DocumentChanged { .. } => EventKind::DocumentChanged,
            Event::DocumentRemoved { .. } => EventKind::DocumentRemoved,
            Event::DocumentRenamed { .. } => EventKind::DocumentRenamed,
            Event::IndexUpdated => EventKind::IndexUpdated,
            Event::JobDone { .. } => EventKind::JobDone,
            Event::Overflow { .. } => EventKind::Overflow,
            Event::Custom { .. } => EventKind::Custom,
            Event::BatchEnded { .. } => EventKind::BatchEnded,
            Event::ViewInvalidated { .. } => EventKind::ViewInvalidated,
            Event::JobStarted { .. } => EventKind::JobStarted,
            Event::JobProgress { .. } => EventKind::JobProgress,
            Event::SettingChanged { .. } => EventKind::SettingChanged,
            Event::EntryChanged { .. } => EventKind::EntryChanged,
            Event::EntryRemoved { .. } => EventKind::EntryRemoved,
            Event::EntryRenamed { .. } => EventKind::EntryRenamed,
            Event::Trouble { .. } => EventKind::Trouble,
        }
    }

    /// Il documento che questo evento dice essere cambiato, se ne nomina uno.
    ///
    /// Per un rename è il path **nuovo**: è la chiave sotto cui il documento
    /// esiste dopo l'evento, ed è quella che un lotto deve elencare fra i propri
    /// `changed`.
    pub fn touched(&self) -> Option<&DocId> {
        match self {
            Event::DocumentChanged { id } | Event::DocumentRemoved { id } => Some(id),
            Event::DocumentRenamed { to, .. } => Some(to),
            // I tre dell'anagrafe **non** rispondono qui, e non è una
            // dimenticanza: questa risposta finisce nell'elenco `changed` di un
            // [`BatchEnded`](Event::BatchEnded), che il contratto descrive come
            // i *documenti* che il lotto ha toccato. Chi ridisegna su quella
            // lista chiede il modello di ciò che ci trova dentro. Un allegato
            // che si muove dentro un lotto resta visibile a chi si è abbonato
            // ai suoi eventi, che arrivano interi — è `index-updated` l'unico
            // evento che un lotto coalizza, non gli altri.
            _ => None,
        }
    }

    /// Questo evento si **riscopre riguardando il vault**?
    ///
    /// È la classificazione su cui poggia ogni freno del canale (§10.2,
    /// decisione 0034): quando una coda va sopra il tetto, ciò che è
    /// recuperabile si può buttare — al suo posto arriva un
    /// [`Overflow`](Event::Overflow), che dice «riconcilia da zero» ed è più
    /// forte di ognuno dei singoli eventi buttati. Ciò che recuperabile non è
    /// passa comunque, perché porta **l'unica copia di un fatto**: l'esito di un
    /// job lo aspetta chi lo ha chiesto, il payload di un custom non lo
    /// ricostruisce nessuno, l'apertura e la chiusura di un vault non si
    /// deducono da come il vault è fatto, e un `Overflow` buttato via è
    /// esattamente il messaggio che stava dicendo di aver buttato via qualcosa.
    ///
    /// Sta qui e non in chi frena perché i freni sono **due** — il tetto del bus
    /// e il raggruppamento del ponte — e una seconda idea di cosa sia sacrificabile
    /// sarebbe un evento perso in silenzio da uno dei due.
    pub fn is_recoverable(&self) -> bool {
        match self {
            Event::DocumentChanged { .. }
            | Event::DocumentRemoved { .. }
            | Event::DocumentRenamed { .. }
            | Event::IndexUpdated
            | Event::BatchEnded { .. }
            | Event::ViewInvalidated { .. }
            // Il lavoro in volo si riscopre **chiedendolo**
            // ([`IndexQuery::Jobs`](crate::traits::IndexQuery::Jobs)), che è
            // ciò che quella variante esiste per permettere: un centro
            // attività che riceve un `overflow` ricostruisce l'elenco intero
            // invece di restare fermo su un lavoro finito. Il progresso in
            // particolare **deve** essere sacrificabile, o il canale più caldo
            // del contratto sarebbe l'unico senza freno.
            | Event::JobStarted { .. }
            | Event::JobProgress { .. }
            // I tre dell'anagrafe si riscoprono **chiedendola**
            // ([`IndexQuery::Entries`](crate::traits::IndexQuery::Entries)),
            // che è metà della ragione per cui quella variante esiste: chi
            // riceve un `overflow` ricostruisce l'elenco dei file invece di
            // restare fermo su un allegato che non c'è più.
            | Event::EntryChanged { .. }
            | Event::EntryRemoved { .. }
            | Event::EntryRenamed { .. } => true,
            Event::VaultOpened { .. }
            | Event::VaultClosed { .. }
            | Event::JobDone { .. }
            | Event::Overflow { .. }
            | Event::Custom { .. }
            // Vedi il doc della variante: il valore si rilegge, il *cambio* no.
            | Event::SettingChanged { .. }
            // Un guasto non lo si riscopre riguardando il vault: dopo un flush
            // fallito il vault è identico a com'era, ed è la ragione per cui
            // quel fallimento va detto. Vedi il doc della variante.
            | Event::Trouble { .. } => false,
        }
    }

    /// I documenti che questo evento **nomina**, per decidere se riguarda un
    /// soggetto ([`EventMask::about`]).
    ///
    /// Non è [`Event::touched`] al plurale, e le differenze sono le due che
    /// contano:
    ///
    /// - un **rename** ne nomina due, il path di partenza e quello d'arrivo.
    ///   `touched` risponde a *cosa scrivere nell'elenco di un lotto* e dice il
    ///   nuovo; qui la domanda è *questo evento riguarda la tua cartella?*, e
    ///   una nota che se ne va riguarda la cartella da cui esce esattamente
    ///   quanto quella in cui entra;
    /// - un **lotto** li nomina tutti, ed è ciò che rende un abbonamento per
    ///   cartella utile dentro un lotto invece che cieco.
    ///
    /// Vuoto = l'evento non parla di documenti (`index-updated`, `overflow`,
    /// `vault-closed`, `job-done`, un custom, un lotto che ha toccato il solo
    /// indice): chi filtra per soggetto lo lascia **passare**, perché filtrarlo
    /// via vorrebbe dire perdere in silenzio proprio ciò che non si può perdere.
    pub fn names(&self) -> Vec<&DocId> {
        match self {
            Event::DocumentChanged { id } | Event::DocumentRemoved { id } => vec![id],
            Event::DocumentRenamed { from, to } => vec![from, to],
            Event::BatchEnded { changed, .. } => changed.iter().collect(),
            // Qui invece sì: la domanda è *questo evento riguarda la tua
            // cartella?*, e una cartella la riguarda un PNG che ci entra quanto
            // una nota. Chi si abbona a `Progetti/` per tenerne l'indice
            // aggiornato vuole sapere anche dell'allegato che ci compare.
            Event::EntryChanged { id, .. } | Event::EntryRemoved { id, .. } => vec![id],
            Event::EntryRenamed { from, to, .. } => vec![from, to],
            // Un guasto che nomina un documento è di chi guarda quel documento
            // — la nota che non è entrata nella ricerca riguarda la sua
            // cartella. Uno che non ne nomina nessuno riguarda il vault
            // intero, e passa da tutte le maschere: è la regola già scritta
            // per `overflow` e `vault-closed`, e qui vale con più forza,
            // perché un avviso filtrato via è la cosa che questa variante
            // esiste per non far succedere.
            Event::Trouble {
                subject: Some(id), ..
            } => vec![id],
            _ => Vec::new(),
        }
    }
}

/// Il "tipo" di un evento, senza payload — per gli abbonamenti.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    VaultOpened,
    DocumentChanged,
    DocumentRemoved,
    DocumentRenamed,
    IndexUpdated,
    /// Esito di un job in background.
    JobDone,
    /// Coda eventi troncata: lo stato derivato dagli eventi va riconciliato.
    Overflow,
    /// Eventi custom dei plugin (il topic sta nel payload dell'`Event`).
    Custom,
    /// Un lotto si è chiuso. Chi si abbona a
    /// [`IndexUpdated`](EventKind::IndexUpdated) deve abbonarsi anche a questo:
    /// dentro un lotto è il solo dei due che arriva.
    BatchEnded,
    /// Una view è invecchiata per un motivo che il vault non conosce (§2.5).
    ViewInvalidated,
    /// Il vault sta per chiudersi: l'ultimo giro sincrono in cui è ancora
    /// quello di prima (decisione 0029).
    VaultClosed,
    /// Un lavoro lungo è stato accettato (§10.3).
    JobStarted,
    /// A che punto è un lavoro lungo (§10.3). Chi si abbona a questo si abbona
    /// al canale più fitto che il contratto abbia.
    JobProgress,
    /// Una chiave di configurazione è cambiata (§11.1).
    SettingChanged,
    /// Un file che non è un documento è comparso o è cambiato (§14.1).
    EntryChanged,
    /// Un file che non è un documento non c'è più (§14.1).
    EntryRemoved,
    /// Un file che non è un documento ha cambiato path (§14.1).
    EntryRenamed,
    /// Qualcosa è andato storto (§20.2). Chi si abbona a questo è chi ha una
    /// superficie dove dirlo: il centro notifiche della shell è il primo, e
    /// non sarà l'unico — un pannello di diagnostica e un log su file
    /// chiedono lo stesso canale.
    Trouble,
}

/// **Dove**: il soggetto di un abbonamento (decisione 0033).
///
/// Un documento si nomina con la sua identità, che è il path
/// ([`DocId`]); una cartella si nomina con il **prefisso** di path, perché nel
/// kernel una cartella non è ancora un cittadino — lo diventa col §14.3, e
/// quel giorno questa variante guadagna un tipo invece di una stringa. La
/// forma della maschera è contratto e non poteva aspettarlo: allargarla dopo il
/// freeze costerebbe una migrazione di versione, mentre il tipo del soggetto è
/// una variante in più.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Subject {
    /// Questo documento, e nessun altro.
    Document { id: DocId },
    /// Tutto ciò che sta **dentro** questa cartella, a qualunque profondità.
    /// Il confronto è per segmento e non per caratteri: `Progetti` non contiene
    /// `Progetti-vecchi/nota.md`. La stringa vuota è la radice, cioè tutto il
    /// vault.
    Folder { path: String },
}

impl Subject {
    pub fn document(id: impl Into<String>) -> Self {
        Subject::Document { id: DocId::new(id) }
    }

    pub fn folder(path: impl Into<String>) -> Self {
        Subject::Folder { path: path.into() }
    }

    /// Questo documento sta nel soggetto?
    pub fn holds(&self, doc: &DocId) -> bool {
        match self {
            Subject::Document { id } => id == doc,
            Subject::Folder { path } => crate::rules::events::folder_contains(path, doc.as_str()),
        }
    }
}

/// **A cosa** un handler è abbonato: le specie, il topic dei custom, il
/// soggetto.
///
/// Era una lista di [`EventKind`] e basta, e con quella sola grana ogni handler
/// si svegliava per **ogni** custom di **ogni** plugin e per **ogni** documento
/// del vault: N feature × M documenti, sull'evento più caldo che il contratto
/// abbia. I tre campi sono in **and** fra loro, e ognuno vuoto vuol dire *non
/// filtro*, che è il comportamento di prima — una maschera scritta prima della
/// decisione 0033 continua a ricevere esattamente ciò che riceveva.
///
/// # Cosa il soggetto **non** toglie
///
/// Un evento che non nomina nessun documento passa il filtro del soggetto
/// invece di non passarlo: `overflow` («riconcilia da zero»), `vault-closed`
/// («l'ultimo giro per rendere durevole ciò che hai in memoria») e `job-done`
/// («l'esito che hai chiesto») non sono meno tuoi perché ti sei abbonato a una
/// cartella. La regola opposta — filtrare via ciò che non nomina un soggetto —
/// avrebbe fatto perdere in silenzio proprio i tre eventi che non si possono
/// perdere.
///
/// Un **rename** è del soggetto di partenza *e* di quello d'arrivo: chi guarda
/// una cartella deve sapere che una nota se n'è andata, che è l'unico modo di
/// smettere di tenerne lo stato.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct EventMask {
    /// Le specie. Vuota = nessun evento: un handler che non dichiara niente non
    /// riceve niente.
    pub kinds: Vec<EventKind>,
    /// I **prefissi di topic** dei custom, nella forma `ns:nome` del §7.4 —
    /// `com.acme.tasks` (tutto ciò che quel plugin emette) o
    /// `com.acme.tasks:board` (una famiglia sola). Vuota = tutti i custom.
    ///
    /// Il prefisso si spezza sui separatori del contratto (`:` e `.`), non sui
    /// caratteri: `acme` non è un prefisso di `acmecorp:x`, o filtrare avrebbe
    /// solo cambiato il plugin sbagliato che si sveglia.
    pub topics: Vec<String>,
    /// **Dove**. Vuota = tutto il vault.
    pub subjects: Vec<Subject>,
}

impl EventMask {
    /// Una maschera sulle sole specie: nessun filtro di topic, nessuno di
    /// soggetto.
    pub fn of(kinds: impl IntoIterator<Item = EventKind>) -> Self {
        EventMask {
            kinds: kinds.into_iter().collect(),
            ..EventMask::default()
        }
    }

    pub fn all() -> Self {
        EventMask::of([
            EventKind::VaultOpened,
            EventKind::DocumentChanged,
            EventKind::DocumentRemoved,
            EventKind::DocumentRenamed,
            EventKind::IndexUpdated,
            EventKind::JobDone,
            EventKind::Overflow,
            EventKind::Custom,
            EventKind::BatchEnded,
            EventKind::ViewInvalidated,
            EventKind::VaultClosed,
            EventKind::JobStarted,
            EventKind::JobProgress,
            EventKind::EntryChanged,
            EventKind::EntryRemoved,
            EventKind::EntryRenamed,
        ])
    }

    /// Restringe i custom a questi prefissi di topic.
    pub fn on_topics(mut self, topics: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.topics = topics.into_iter().map(Into::into).collect();
        self
    }

    /// Restringe a questi soggetti ciò che un soggetto ce l'ha.
    pub fn about(mut self, subjects: impl IntoIterator<Item = Subject>) -> Self {
        self.subjects = subjects.into_iter().collect();
        self
    }

    /// La specie è dichiarata? È **metà** della domanda: l'altra metà — il topic
    /// e il soggetto — la fa [`EventMask::wants`], che è ciò che il kernel
    /// chiama per decidere una consegna.
    pub fn contains(&self, kind: EventKind) -> bool {
        self.kinds.contains(&kind)
    }

    /// Questo evento va consegnato a chi ha dichiarato questa maschera?
    ///
    /// È la regola per intero, e sta in [`crate::rules::events`] perché la
    /// applica anche la shell — che decide da sé quando ridisegnare una view
    /// dichiarata, e senza la stessa regola la restringerebbe a modo suo.
    pub fn wants(&self, event: &Event) -> bool {
        crate::rules::events::mask_wants(self, event)
    }

    /// La maschera dichiara `index-updated` senza `batch-ended`?
    ///
    /// È l'unico modo di sbagliare che il lotto ha introdotto (vedi il doc del
    /// modulo), e sta qui perché chi lo verifica — il kernel sulle proprie
    /// `ViewSpec`, un test su quelle di un plugin — lo faccia con la stessa
    /// regola invece che con la propria idea di essa.
    pub fn misses_batches(&self) -> bool {
        self.contains(EventKind::IndexUpdated) && !self.contains(EventKind::BatchEnded)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_full_mask_is_full() {
        let all = EventMask::all();
        for event in [
            Event::VaultOpened { root: "/v".into() },
            Event::DocumentChanged {
                id: DocId::new("a.md"),
            },
            Event::DocumentRemoved {
                id: DocId::new("a.md"),
            },
            Event::DocumentRenamed {
                from: DocId::new("a.md"),
                to: DocId::new("b.md"),
            },
            Event::IndexUpdated,
            Event::JobDone {
                id: JobId(1),
                job: "j".into(),
                result: Ok(serde_json::Value::Null),
            },
            Event::Overflow { dropped: 1 },
            Event::Custom {
                topic: "p/x".into(),
                payload: serde_json::Value::Null,
            },
            Event::BatchEnded {
                batch: BatchId(1),
                changed: vec![],
            },
            Event::ViewInvalidated {
                view: "v".into(),
                instance: None,
            },
            Event::VaultClosed { root: "/v".into() },
            Event::JobStarted {
                id: JobId(1),
                job: "j".into(),
            },
            Event::JobProgress {
                id: JobId(1),
                progress: JobProgress::default(),
            },
        ] {
            assert!(
                all.contains(event.kind()),
                "`EventMask::all` non copre {event:?}: chi si abbona a tutto \
                 perderebbe un evento senza saperlo"
            );
        }
    }

    #[test]
    fn a_mask_that_watches_the_index_must_watch_batches_too() {
        assert!(EventMask::of([EventKind::IndexUpdated]).misses_batches());
        assert!(
            !EventMask::of([EventKind::IndexUpdated, EventKind::BatchEnded]).misses_batches(),
            "dichiarare tutti e due è la forma giusta, non un doppione"
        );
        assert!(
            !EventMask::of([EventKind::DocumentChanged]).misses_batches(),
            "chi segue i documenti non perde niente in un lotto: quelli passano tutti"
        );
    }

    #[test]
    fn a_subscription_can_name_a_topic_and_a_place() {
        // Il caso della voce: due plugin che si parlano, e un handler che si
        // sveglia solo per i propri.
        let miei = EventMask::of([EventKind::Custom]).on_topics(["com.acme.tasks"]);
        assert!(miei.wants(&Event::Custom {
            topic: "com.acme.tasks:done".into(),
            payload: serde_json::Value::Null,
        }));
        assert!(!miei.wants(&Event::Custom {
            topic: "com.altro.note:done".into(),
            payload: serde_json::Value::Null,
        }));

        // E l'evento più caldo, ristretto a una cartella.
        let qui = EventMask::of([EventKind::DocumentChanged]).about([Subject::folder("Progetti")]);
        assert!(qui.wants(&Event::DocumentChanged {
            id: DocId::new("Progetti/Alpha.md"),
        }));
        assert!(!qui.wants(&Event::DocumentChanged {
            id: DocId::new("Diario/2026-07-28.md"),
        }));
    }

    #[test]
    fn a_mask_survives_the_json_boundary_whole() {
        let mask = EventMask::of([EventKind::Custom, EventKind::DocumentChanged])
            .on_topics(["com.acme.tasks:board"])
            .about([
                Subject::document("Progetti/Alpha.md"),
                Subject::folder("Diario"),
            ]);
        let json = serde_json::to_string(&mask).unwrap();
        assert_eq!(serde_json::from_str::<EventMask>(&json).unwrap(), mask);
    }

    #[test]
    fn a_rename_names_the_new_path_as_the_touched_one() {
        let renamed = Event::DocumentRenamed {
            from: DocId::new("Vecchia.md"),
            to: DocId::new("Nuova.md"),
        };
        assert_eq!(renamed.touched(), Some(&DocId::new("Nuova.md")));
        assert_eq!(Event::IndexUpdated.touched(), None);
    }

    #[test]
    fn a_notice_survives_the_json_boundary_with_its_origin() {
        let notice = Notice::new(
            Event::DocumentChanged {
                id: DocId::new("a.md"),
            },
            Origin::by(Actor::Plugin {
                id: "fub.automa".into(),
            })
            .in_batch(Some(BatchId(7))),
        );
        let json = serde_json::to_string(&notice).unwrap();
        assert_eq!(serde_json::from_str::<Notice>(&json).unwrap(), notice);
        assert!(
            json.contains(r#""batch":"7""#),
            "l'id di lotto attraversa il JSON come stringa: {json}"
        );
    }

    #[test]
    fn what_an_overflow_replaces_is_exactly_what_it_covers() {
        // Un `Overflow` dice «riconcilia da zero»: copre ogni evento che si
        // riscopre riguardando il vault, e nessuno di quelli che portano l'unica
        // copia di un fatto.
        for event in [
            Event::DocumentChanged {
                id: DocId::new("a.md"),
            },
            Event::IndexUpdated,
            Event::BatchEnded {
                batch: BatchId(1),
                changed: vec![],
            },
            // Il lavoro in volo lo si riscopre **chiedendolo** (§10.3), ed è
            // la condizione perché il canale più fitto del contratto abbia un
            // freno come tutti gli altri.
            Event::JobStarted {
                id: JobId(1),
                job: "j".into(),
            },
            Event::JobProgress {
                id: JobId(1),
                progress: JobProgress {
                    done: 3,
                    total: Some(10),
                    label: None,
                },
            },
        ] {
            assert!(event.is_recoverable(), "{event:?} lo si riscopre guardando");
        }
        for event in [
            Event::JobDone {
                id: JobId(1),
                job: "j".into(),
                result: Ok(serde_json::Value::Null),
            },
            Event::Custom {
                topic: "p:x".into(),
                payload: serde_json::Value::Null,
            },
            Event::Overflow { dropped: 1 },
            Event::VaultClosed { root: "/v".into() },
            // Il valore si rilegge, il *cambio* no — e chi si spegne quando lo
            // spengono deve saperlo anche a coda piena.
            Event::SettingChanged {
                key: "versioning.enabled".into(),
                scope: crate::settings::SettingScope::Vault,
            },
        ] {
            assert!(
                !event.is_recoverable(),
                "{event:?} porta l'unica copia di un fatto: buttarlo è perderlo"
            );
        }
    }

    #[test]
    fn the_actor_answers_the_only_question_it_exists_for() {
        let mio = Actor::Plugin {
            id: "fub.automa".into(),
        };
        assert!(mio.is_plugin("fub.automa"), "questa l'ho scritta io");
        assert!(!mio.is_plugin("fub.altro"));
        assert!(!Actor::User.is_plugin("fub.automa"));
    }
}
