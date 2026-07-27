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
use crate::traits::JobId;

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
            _ => None,
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
}

/// Insieme di tipi di evento a cui un handler è abbonato.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct EventMask(pub Vec<EventKind>);

impl EventMask {
    pub fn all() -> Self {
        EventMask(vec![
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
        ])
    }

    pub fn contains(&self, kind: EventKind) -> bool {
        self.0.contains(&kind)
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
        assert!(EventMask(vec![EventKind::IndexUpdated]).misses_batches());
        assert!(
            !EventMask(vec![EventKind::IndexUpdated, EventKind::BatchEnded]).misses_batches(),
            "dichiarare tutti e due è la forma giusta, non un doppione"
        );
        assert!(
            !EventMask(vec![EventKind::DocumentChanged]).misses_batches(),
            "chi segue i documenti non perde niente in un lotto: quelli passano tutti"
        );
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
                id: "fubmd.automa".into(),
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
    fn the_actor_answers_the_only_question_it_exists_for() {
        let mio = Actor::Plugin {
            id: "fubmd.automa".into(),
        };
        assert!(mio.is_plugin("fubmd.automa"), "questa l'ho scritta io");
        assert!(!mio.is_plugin("fubmd.altro"));
        assert!(!Actor::User.is_plugin("fubmd.automa"));
    }
}
