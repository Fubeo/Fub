//! **L'indice dei promemoria**: i compiti aperti che portano un `⏰`, con
//! l'ora del muro a cui suonano.
//!
//! # Un indice derivato, che si ricorda ciò che ha visto
//!
//! Il kernel lo alimenta come ogni indice ([`IndexProvider`]): ogni nota che
//! entra o esce dal vault passa di qui con il suo modello, e il riallineamento
//! dopo la scansione toglie ciò che è sparito ad app chiusa. Un compito
//! spuntato, un `⏰` cancellato o una nota cestinata escono al primo
//! salvataggio, perché la nota rientra con il modello nuovo.
//!
//! È l'unico indice di serie, oltre alla ricerca, che ricava qualcosa dal
//! **corpo** delle note, e per questo è durevole come lei (#521): al `flush`
//! scrive nel suo spazio dati i promemoria di ogni nota con la revisione del
//! sorgente da cui li ha ricavati ([`stored`]), all'`activate` li rilegge, e a
//! [`IndexProvider::up_to_date`] risponde «ce l'ho» per le note la cui
//! revisione dichiarata dal kernel è quella che ha. Senza, la riapertura di un
//! vault rileggeva e rianalizzava ogni nota per lui solo: la domanda è
//! un'intersezione, e il suo «mandami tutto» vinceva su tutti. Il file è un
//! derivato: illeggibile o di un altro schema si butta e si rifà dalle note.
//!
//! Cosa è un promemoria lo dice la regola del contratto
//! ([`fub_abi::rules::tasks::task_reminder`]) sul testo del compito, lo stesso
//! testo della scadenza: un promemoria che non si legge (`⏰ 2026-02-30`) qui
//! non entra, perché non ha un'ora a cui suonare; lo mostra la pastiglia nel
//! testo, che sa dire il refuso.
//!
//! # La domanda
//!
//! Una rotta privata del canale dati, `IndexQuery::Custom` con
//! `ns = "fub.tasks"`, con versione e campi chiusi come quelle della base e del
//! correttore ([`RemindersQuery`]): i promemoria con l'ora in un intervallo
//! (`after` escluso, `until` compreso, nella forma `AAAA-MM-GG HH:MM`), in
//! ordine d'ora, al più [`REMINDER_LIMIT`]. La usano due clienti: il
//! notificatore dell'app, che a ogni minuto chiede quelli arrivati dal minuto
//! prima, e l'elenco dei promemoria passati, che all'avvio chiede quelli fino
//! ad adesso.
//!
//! La stessa rotta risponde a una seconda domanda, che non legge l'indice:
//! [`RemindersQuery::NextOccurrence`], la riga del compito che nasce quando se
//! ne spunta uno ricorrente (`🔁`). La regola è quella di `note.task.toggle`
//! (`commands/recurrence.rs`), e la chiede l'editor quando si spunta la casella
//! nella nota: lì la spunta è una modifica del buffer della sessione, non una
//! scrittura del file, quindi l'editor scrive la riga nuova nella stessa
//! transazione della spunta invece di copiare la regola in TypeScript.
//!
//! L'indice non sa che ore sono, e non deve: un [`IndexProvider`] risponde da
//! ciò che ha già in mano, senza host. L'ora del muro la calcola chi chiede,
//! con l'offset **di adesso** ([`civil_now`]), così un cambio di fuso o l'ora
//! legale spostano il minuto di adesso e non quello del promemoria.
//!
//! # Quando suona
//!
//! [`ReminderWatch`] è la regola di chi notifica: un promemoria suona quando la
//! sua ora entra fra l'ultimo minuto guardato e quello di adesso. Il primo
//! sguardo dopo l'avvio non fa suonare niente: ciò che è passato mentre l'app
//! era chiusa va nell'elenco dei promemoria passati, non in una raffica di
//! notifiche. Un promemoria scritto nel passato non suona per la stessa
//! ragione. L'ultimo minuto guardato non torna mai indietro: se l'ora del muro
//! arretra (un viaggio verso ovest, l'ora legale che finisce) i promemoria di
//! quell'ora ripetuta non suonano una seconda volta.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::ops::Bound;
use std::sync::Mutex;

use fub_abi::edit::Revision;

use fub_abi::error::PluginError;
use fub_abi::locale::Locale;
use fub_abi::model::{Block, DocId, DocumentModel};
use fub_abi::rules::tasks::{
    civil_minute, reminder_minute, reminder_text, task_reminder, task_text,
};
use fub_abi::text::{Arg, Strings, Text};
use fub_abi::traits::{
    EntryKind, HostApi, IndexLoss, IndexProvider, IndexQuery, IndexResult, QueryKind, QueryRoute,
    ReadApi, VaultEntry,
};
use serde::{Deserialize, Serialize};

use super::TASKS_ID;

/// Quanti promemoria una risposta porta al più, i primi in ordine d'ora.
///
/// Un vault con mille promemoria è un vault vero (un'agenda di anni); una
/// risposta con diecimila righe è un elenco che nessuno scorre. Chi ne riceve
/// [`REMINDER_LIMIT`] con `more` sa che ce ne sono altri e restringe
/// l'intervallo.
pub const REMINDER_LIMIT: usize = 1_000;

/// La versione della domanda che questo indice capisce.
pub const REMINDERS_VERSION: u32 = 1;

/// La versione della domanda del compito successivo.
pub const NEXT_OCCURRENCE_VERSION: u32 = 1;

/// La riga più lunga che la domanda del compito successivo accetta, in byte.
///
/// Una riga di compito è una frase; una riga di 64 KiB è un file incollato su
/// una riga sola, e non vale un giro di IPC con dentro tutto il testo.
pub const NEXT_OCCURRENCE_MAX_LINE: usize = 64 * 1024;

/// La chiave d'errore di una domanda che non ha la forma della rotta: la
/// frase sta nel catalogo dei compiti.
pub(super) const E_QUERY: &str = "reminders_query";
const DETAIL: &str = "detail";
/// La chiave d'errore di una domanda arrivata a una rotta che l'indice non
/// serve, e quella di una risposta che non si è potuta scrivere.
pub(super) const E_ROUTE: &str = "reminders_route";
pub(super) const E_ANSWER: &str = "reminders_answer";
/// La chiave d'errore del file dei promemoria che non si è potuto comporre.
pub(super) const E_STORE: &str = "reminders_store";
/// La chiave del titolo della notifica.
pub(super) const REMINDER_TITLE: &str = "reminder_title";
/// La chiave dell'azione che apre la nota dalla notifica.
pub(super) const REMINDER_OPEN: &str = "reminder_open";
/// Le chiavi della notifica che conta i promemoria non mostrati uno per uno.
pub(super) const REMINDER_MORE: &str = "reminder_more";
pub(super) const REMINDER_MANY: &str = "reminder_many";
const COUNT: &str = "count";

/// La domanda della rotta dei promemoria.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum RemindersQuery {
    /// I promemoria con l'ora in `(after, until]`, in ordine d'ora.
    Reminders {
        version: u32,
        /// Escluso; senza, dall'inizio.
        #[serde(default)]
        after: Option<String>,
        /// Compreso; senza, fino in fondo.
        #[serde(default)]
        until: Option<String>,
        /// Al più quanti, e mai più di [`REMINDER_LIMIT`].
        #[serde(default)]
        limit: Option<usize>,
    },
    /// La riga del compito che nasce spuntando `line`, se `line` ricorre.
    NextOccurrence {
        version: u32,
        /// La riga del compito, ancora da spuntare e senza terminatore.
        line: String,
        /// Il giorno di chi spunta, `AAAA-MM-GG`: conta per `when done`.
        today: String,
    },
}

impl RemindersQuery {
    /// La domanda come la manda chi chiede: la versione di oggi.
    pub fn between(after: Option<i64>, until: Option<i64>) -> Self {
        RemindersQuery::Reminders {
            version: REMINDERS_VERSION,
            after: after.map(reminder_text),
            until: until.map(reminder_text),
            limit: None,
        }
    }

    /// La domanda del compito successivo, nella versione di oggi.
    pub fn next_occurrence(line: impl Into<String>, today: impl Into<String>) -> Self {
        RemindersQuery::NextOccurrence {
            version: NEXT_OCCURRENCE_VERSION,
            line: line.into(),
            today: today.into(),
        }
    }

    /// La domanda come `IndexQuery`, pronta per `query_index`.
    pub fn to_index_query(&self) -> IndexQuery {
        IndexQuery::Custom {
            ns: TASKS_ID.to_string(),
            query: serde_json::to_value(self).unwrap_or(serde_json::Value::Null),
        }
    }
}

/// La risposta della rotta dei promemoria.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReminderList {
    pub reminders: Vec<ReminderEntry>,
    /// Ce ne sono altri nell'intervallo, oltre quelli portati.
    pub more: bool,
}

impl ReminderList {
    /// La risposta di `query_index`, letta. Un errore se non ha la forma.
    pub fn from_index_result(result: IndexResult) -> Result<Self, PluginError> {
        match result {
            IndexResult::Custom(value) => {
                serde_json::from_value(value).map_err(|error| bad_query(&error.to_string()))
            }
            _ => Err(bad_query("not a custom answer")),
        }
    }
}

/// La risposta della domanda del compito successivo.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct NextOccurrence {
    /// La riga da scrivere sopra quella spuntata, senza terminatore; `None` se
    /// la riga non ricorre (nessuna regola, una regola che non si capisce,
    /// nessuna data da spostare).
    pub line: Option<String>,
}

/// Un promemoria come lo porta la risposta.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReminderEntry {
    /// La nota del compito.
    pub doc: DocId,
    /// Il byte del marcatore del compito nel file: è la posizione che
    /// `note.task.toggle` vuole, e quella su cui si apre la nota.
    pub at: usize,
    /// L'ora del muro, `AAAA-MM-GG HH:MM`.
    pub when: String,
    /// Il testo del compito senza il promemoria.
    pub text: String,
    /// Il titolo della sezione che contiene il compito, se ce n'è una: è il
    /// punto più vicino al compito che un collegamento `fub://open` sa
    /// nominare (`heading`), e quello su cui si apre la nota dalla notifica.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub heading: Option<String>,
}

/// Un promemoria tenuto dall'indice.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Reminder {
    minute: i64,
    at: usize,
    text: String,
    heading: Option<String>,
}

/// L'indice: i promemoria dei compiti aperti, per nota, e gli stessi in
/// ordine d'ora.
///
/// Il notificatore chiede un minuto alla volta, ogni minuto: la risposta
/// esce da `by_minute` con un `range` e costa i promemoria dell'intervallo,
/// non quelli del vault. Le due mappe dicono sempre la stessa cosa: ogni
/// voce di `by_minute` è un promemoria di `by_doc`, e lo cambia soltanto
/// [`ReminderIndex::put`] e [`ReminderIndex::drop_doc`].
#[derive(Debug, Default)]
pub struct ReminderIndex {
    /// I promemoria di ogni nota, in ordine di posizione nel file.
    by_doc: BTreeMap<DocId, Vec<Reminder>>,
    /// `(minuto, nota, posizione)` di ogni promemoria: l'ordine della
    /// risposta.
    by_minute: BTreeSet<(i64, DocId, usize)>,
    /// La revisione del sorgente da cui è ricavato ciò che l'indice tiene di
    /// ogni nota — **anche delle note senza promemoria**, che sono la
    /// maggioranza: «nessun promemoria» è una risposta, e va ricordata come le
    /// altre. Una nota che manca qui è una nota da rileggere.
    sources: HashMap<DocId, Revision>,
    /// Le revisioni che il kernel ha dichiarato rispondendo a
    /// [`IndexProvider::up_to_date`], in attesa della consegna di quelle
    /// note: la consegna se le prende ([`ReminderIndex::notes_source`]). È lo
    /// stesso giro della ricerca (`SearchIndex::up_to_date`), e per le stesse
    /// ragioni è per documento e non si azzera a ogni domanda.
    announced: Mutex<HashMap<DocId, Revision>>,
    /// Ciò che è in memoria è cambiato dall'ultima scrittura del file. Una
    /// riapertura di un vault fermo non consegna niente e quindi non scrive.
    dirty: bool,
}

impl ReminderIndex {
    pub fn new() -> Self {
        Self::default()
    }

    /// Quanti promemoria tiene, in tutto il vault.
    pub fn len(&self) -> usize {
        self.by_minute.len()
    }

    pub fn is_empty(&self) -> bool {
        self.by_doc.is_empty()
    }

    /// Prende i promemoria di una nota, al posto di quelli che aveva, e la
    /// revisione che il kernel aveva dichiarato per lei.
    fn take(&mut self, model: &DocumentModel) {
        self.put(model.id.clone(), reminders_of(model));
        self.notes_source(&model.id);
        self.dirty = true;
    }

    /// Prende nota di **che revisione** è la nota appena presa, consumando la
    /// dichiarazione del kernel. Senza dichiarazione — una consegna a sessione
    /// aperta, o una nota che l'indice aveva detto di avere e che arriva lo
    /// stesso perché un altro indice non ce l'aveva — si dimentica quella di
    /// prima: tenerla attribuirebbe al testo di adesso la revisione del testo
    /// di allora, e alla riapertura la nota salterebbe con i promemoria
    /// vecchi. Dimenticarla la fa rileggere una volta, il verso sicuro.
    fn notes_source(&mut self, doc: &DocId) {
        match self.announced.lock().expect("mutex").remove(doc) {
            Some(revision) => self.sources.insert(doc.clone(), revision),
            None => self.sources.remove(doc),
        };
    }

    /// Dimentica tutto di una nota: i promemoria, la revisione e la
    /// dichiarazione in volo. Le tre insieme: una revisione che sopravvivesse
    /// ai promemoria direbbe «ce l'ho» di una nota che l'indice non ha più.
    fn forget(&mut self, doc: &DocId) {
        self.drop_doc(doc);
        self.sources.remove(doc);
        self.announced.lock().expect("mutex").remove(doc);
        self.dirty = true;
    }

    /// Rilegge il file dei promemoria ([`stored`]). Un file che non c'è, che
    /// non si legge o che non è di questo schema lascia l'indice vuoto: le
    /// note arriveranno tutte, perché a `up_to_date` non risponderà niente.
    fn load(&mut self, host: &dyn HostApi) {
        self.by_doc.clear();
        self.by_minute.clear();
        self.sources.clear();
        self.announced.lock().expect("mutex").clear();
        // Partire vuoti scrive il file al primo `flush`: è così che un file
        // rotto o di prima viene sostituito.
        self.dirty = true;
        let raw = match host.data_read(stored::FILE) {
            Ok(Some(raw)) => raw,
            Ok(None) => return,
            Err(error) => {
                // Il supporto non ha risposto: il file può essere intatto, ma
                // un derivato non vale un'apertura bloccata. Si rilegge dalle
                // note, e lo si dice nel registro.
                tracing::warn!(target: "fub.tasks", "promemoria: {error:?}");
                return;
            }
        };
        let Some(loaded) = stored::decode(&raw) else {
            return;
        };
        for (doc, source, reminders) in loaded {
            self.put(doc.clone(), reminders);
            self.sources.insert(doc, source);
        }
        self.dirty = false;
    }

    /// Scrive il file dei promemoria, se qualcosa è cambiato dall'ultima
    /// volta. Se la scrittura fallisce resta da scrivere: il file di prima,
    /// intero, dice ancora il vero per le revisioni che nomina.
    fn persist(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        if !self.dirty {
            return Ok(());
        }
        const NONE: &[Reminder] = &[];
        let raw = stored::encode(self.sources.iter().map(|(doc, source)| {
            let reminders = self.by_doc.get(doc).map_or(NONE, Vec::as_slice);
            (doc, source, reminders)
        }))
        .map_err(|error| {
            PluginError::Internal(Text::message(
                E_STORE,
                vec![Arg::text(DETAIL, error.to_string())],
            ))
        })?;
        host.data_write(stored::FILE, &raw)?;
        self.dirty = false;
        Ok(())
    }

    /// I promemoria `found` della nota `doc`, al posto di quelli che aveva.
    fn put(&mut self, doc: DocId, found: Vec<Reminder>) {
        self.drop_doc(&doc);
        if found.is_empty() {
            return;
        }
        for reminder in &found {
            self.by_minute
                .insert((reminder.minute, doc.clone(), reminder.at));
        }
        self.by_doc.insert(doc, found);
    }

    /// Toglie i promemoria della nota `doc`, da tutte e due le mappe.
    fn drop_doc(&mut self, doc: &DocId) {
        if let Some(old) = self.by_doc.remove(doc) {
            for reminder in old {
                self.by_minute
                    .remove(&(reminder.minute, doc.clone(), reminder.at));
            }
        }
    }

    /// I promemoria in `(after, until]`, in ordine d'ora, nota e posizione.
    pub fn between(&self, after: Option<i64>, until: Option<i64>, limit: usize) -> ReminderList {
        // Gli estremi come chiavi di `by_minute`: la nota vuota è la più
        // piccola, quindi `(m, "", 0)` sta prima di ogni promemoria del minuto
        // `m`. Un estremo oltre l'ultimo minuto rappresentabile non limita.
        let first = |minute: i64| (minute, DocId::new(String::new()), 0);
        let low = match after {
            None => Bound::Unbounded,
            Some(a) => match a.checked_add(1) {
                Some(next) => Bound::Included(first(next)),
                None => return ReminderList::default(),
            },
        };
        let high = match until.and_then(|u| u.checked_add(1)) {
            None => Bound::Unbounded,
            Some(next) => Bound::Excluded(first(next)),
        };
        // `range` non accetta un intervallo rovesciato: è vuoto.
        if let (Some(a), Some(u)) = (after, until) {
            if a >= u {
                return ReminderList::default();
            }
        }
        let mut hits = self.by_minute.range((low, high));
        let mut reminders = Vec::new();
        for (minute, doc, at) in hits.by_ref().take(limit) {
            let Some(reminder) = self.by_doc.get(doc).and_then(|list| {
                list.binary_search_by_key(at, |r| r.at)
                    .ok()
                    .map(|found| &list[found])
            }) else {
                debug_assert!(false, "by_minute names a reminder that by_doc lacks");
                continue;
            };
            reminders.push(ReminderEntry {
                doc: doc.clone(),
                at: *at,
                when: reminder_text(*minute),
                text: reminder.text.clone(),
                heading: reminder.heading.clone(),
            });
        }
        ReminderList {
            reminders,
            more: hits.next().is_some(),
        }
    }

    fn answer(&self, query: serde_json::Value) -> Result<IndexResult, PluginError> {
        let query =
            RemindersQuery::deserialize(&query).map_err(|error| bad_query(&error.to_string()))?;
        let (version, after, until, limit) = match query {
            RemindersQuery::Reminders {
                version,
                after,
                until,
                limit,
            } => (version, after, until, limit),
            RemindersQuery::NextOccurrence {
                version,
                line,
                today,
            } => return next_occurrence(version, &line, &today),
        };
        if version != REMINDERS_VERSION {
            return Err(bad_query("unsupported version"));
        }
        let bound = |field: &str, text: Option<String>| match text {
            None => Ok(None),
            Some(text) => reminder_minute(&text)
                .map(Some)
                .ok_or_else(|| bad_query(&format!("`{field}` is not `YYYY-MM-DD HH:MM`"))),
        };
        let after = bound("after", after)?;
        let until = bound("until", until)?;
        let limit = limit.unwrap_or(REMINDER_LIMIT).min(REMINDER_LIMIT);
        serde_json::to_value(self.between(after, until, limit))
            .map(IndexResult::Custom)
            .map_err(|error| {
                PluginError::Internal(Text::message(
                    E_ANSWER,
                    vec![Arg::text(DETAIL, error.to_string())],
                ))
            })
    }
}

impl IndexProvider for ReminderIndex {
    fn routes(&self) -> Vec<QueryRoute> {
        vec![QueryRoute::Query(QueryKind::Custom(TASKS_ID.into()))]
    }

    /// Rilegge il file dei promemoria. Non fallisce mai: un file perso o
    /// rotto è un derivato da rifare, non un'apertura da fermare.
    fn activate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.load(host);
        Ok(())
    }

    fn on_documents_indexed(&mut self, docs: &[DocumentModel]) -> Vec<IndexLoss> {
        for model in docs {
            self.take(model);
        }
        Vec::new()
    }

    fn on_documents_removed(&mut self, ids: &[DocId]) -> Vec<IndexLoss> {
        for id in ids {
            self.forget(id);
        }
        Vec::new()
    }

    fn reconcile(&mut self, ids: &[DocId]) -> Vec<IndexLoss> {
        // Fine del giro d'apertura: ciò che resta dichiarato è di una nota che
        // non è arrivata (un parse fallito, un file sparito fra la scansione e
        // la lettura), e tenerlo vorrebbe dire darlo alla consegna dopo.
        self.announced.lock().expect("mutex").clear();
        let alive: HashSet<&DocId> = ids.iter().collect();
        let gone: BTreeSet<DocId> = self
            .by_doc
            .keys()
            .chain(self.sources.keys())
            .filter(|doc| !alive.contains(doc))
            .cloned()
            .collect();
        for doc in &gone {
            self.forget(doc);
        }
        Vec::new()
    }

    fn flush(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.persist(host)
    }

    /// Scrive ciò che resta, poi lascia andare la memoria. Il kernel ha già
    /// chiamato `flush`, e rifarlo non costa niente (`dirty` è spento): copre
    /// chi chiama `close` da solo.
    fn close(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        let persisted = self.persist(host);
        self.by_doc.clear();
        self.by_minute.clear();
        self.sources.clear();
        self.announced.lock().expect("mutex").clear();
        persisted
    }

    /// **Di queste note, quali ho già così come sono?** Quelle la cui
    /// revisione dichiarata dal kernel è la revisione da cui l'indice ha
    /// ricavato i promemoria che tiene. Le altre si dichiarano, perché la
    /// consegna che arriverà sappia di che revisione è.
    ///
    /// Le cautele sono quelle della ricerca, tutte nello stesso verso: senza
    /// impronta dichiarata non si risponde; ciò che non è un documento non è
    /// affar suo; ciò che si dice di avere non si dichiara, perché se arrivasse
    /// lo stesso deve restare senza revisione e farsi rileggere alla prossima
    /// apertura.
    fn up_to_date(&self, entries: &[VaultEntry]) -> Vec<DocId> {
        let mut announced = self.announced.lock().expect("mutex");
        let mut current = Vec::new();
        for entry in entries {
            announced.remove(&entry.id);
            let (EntryKind::Document, Some(revision)) = (entry.kind, entry.fingerprint.as_ref())
            else {
                continue;
            };
            if self.sources.get(&entry.id) == Some(revision) {
                current.push(entry.id.clone());
                continue;
            }
            announced.insert(entry.id.clone(), revision.clone());
        }
        current
    }

    fn query(&self, request: IndexQuery) -> Result<IndexResult, PluginError> {
        match request {
            IndexQuery::Custom { ns, query } if ns == TASKS_ID => self.answer(query),
            _ => Err(PluginError::Unserved(Text::key(E_ROUTE))),
        }
    }
}

/// La risposta della domanda del compito successivo: la regola di
/// `note.task.toggle`, applicata a una riga che arriva da fuori.
fn next_occurrence(version: u32, line: &str, today: &str) -> Result<IndexResult, PluginError> {
    use crate::commands::recurrence;
    if version != NEXT_OCCURRENCE_VERSION {
        return Err(bad_query("unsupported version"));
    }
    if line.len() > NEXT_OCCURRENCE_MAX_LINE {
        return Err(bad_query("`line` is too long"));
    }
    if line.contains(['\n', '\r']) {
        return Err(bad_query("`line` is one line"));
    }
    let today =
        recurrence::day_of(today).ok_or_else(|| bad_query("`today` is not `YYYY-MM-DD`"))?;
    let answer = NextOccurrence {
        line: recurrence::next_line(line, today),
    };
    serde_json::to_value(answer)
        .map(IndexResult::Custom)
        .map_err(|error| {
            PluginError::Internal(Text::message(
                E_ANSWER,
                vec![Arg::text(DETAIL, error.to_string())],
            ))
        })
}

/// I promemoria dei compiti **aperti** di un modello, in qualunque punto
/// dell'albero: lo stesso cammino della vista dei compiti.
fn reminders_of(model: &DocumentModel) -> Vec<Reminder> {
    let mut found = Vec::new();
    let mut pending: Vec<&Block> = model.body.iter().collect();
    while let Some(block) = pending.pop() {
        match block {
            Block::List { items, .. } => {
                for item in items {
                    if let Some(marker) = item.task.filter(|marker| !marker.checked()) {
                        let text = task_text(&item.blocks);
                        if let Some(reminder) = task_reminder(&text) {
                            if let Some(minute) = reminder.minute {
                                found.push(Reminder {
                                    minute,
                                    at: marker.span.start,
                                    text: without(&text, reminder.from, reminder.to),
                                    heading: None,
                                });
                            }
                        }
                    }
                    pending.extend(&item.blocks);
                }
            }
            Block::Quote { blocks, .. } | Block::Custom { blocks, .. } => pending.extend(blocks),
            _ => {}
        }
    }
    found.sort_by_key(|reminder| reminder.at);
    // La sezione di ogni compito: l'ultimo titolo che inizia prima del suo
    // marcatore, dall'indice dei titoli del modello (in ordine di file). I
    // compiti sono in ordine di file anche loro, quindi un cursore solo
    // cammina i titoli una volta per tutta la nota.
    let mut passed = 0;
    for reminder in &mut found {
        while model
            .outline
            .get(passed)
            .is_some_and(|heading| heading.span.start < reminder.at)
        {
            passed += 1;
        }
        reminder.heading = passed
            .checked_sub(1)
            .map(|last| model.outline[last].text.clone());
    }
    found
}

/// Il testo senza il tratto `from..to`, con un solo spazio dove stava.
fn without(text: &str, from: usize, to: usize) -> String {
    let before = text[..from].trim_end();
    let after = text[to..].trim_start();
    match (before.is_empty(), after.is_empty()) {
        (_, true) => before.to_string(),
        (true, false) => after.to_string(),
        (false, false) => format!("{before} {after}"),
    }
}

/// Una domanda che non ha la forma chiusa della rotta. Il dettaglio resta in
/// inglese come gli errori di serde da cui viene: lo legge chi scrive il
/// cliente, non chi scrive il testo.
fn bad_query(detail: &str) -> PluginError {
    PluginError::BadArgs(Text::message(E_QUERY, vec![Arg::text(DETAIL, detail)]))
}

/// Le parole della notifica di un promemoria, nella lingua di chi guarda.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NotificationWords {
    /// Il titolo: «Promemoria».
    pub title: String,
    /// L'azione del clic, dove il sistema la scrive: «Apri la nota».
    pub open: String,
}

/// Le parole della notifica, dal catalogo dei compiti come le altre frasi del
/// componente: chi mostra la notifica è fuori dal kernel, e le legge di qui
/// con la stessa scala delle lingue ([`Strings`]).
pub fn notification_words(locale: &Locale, default_locale: &str) -> NotificationWords {
    let catalogs = super::catalog();
    let strings = Strings::new(&catalogs, default_locale, locale);
    NotificationWords {
        title: strings.render(&Text::key(REMINDER_TITLE)),
        open: strings.render(&Text::key(REMINDER_OPEN)),
    }
}

/// Il corpo della notifica che conta i promemoria arrivati insieme e non
/// mostrati uno per uno: «Altri 12 promemoria…». Con `beyond` la risposta
/// dell'indice era tagliata ([`REMINDER_LIMIT`]) e `count` è un minimo.
pub fn notification_more(
    locale: &Locale,
    default_locale: &str,
    count: usize,
    beyond: bool,
) -> String {
    let catalogs = super::catalog();
    let key = if beyond { REMINDER_MANY } else { REMINDER_MORE };
    let count = i64::try_from(count).unwrap_or(i64::MAX);
    Strings::new(&catalogs, default_locale, locale)
        .render(&Text::message(key, vec![Arg::int(COUNT, count)]))
}

/// L'ora del muro di chi guarda, adesso: l'orologio dell'host spostato
/// dell'offset del suo locale di adesso.
pub fn civil_now(host: &dyn ReadApi) -> i64 {
    civil_minute(
        host.user_locale().utc_offset_minutes,
        host.now_unix_millis(),
    )
}

/// Quando suonano i promemoria: la regola di chi notifica.
///
/// Tiene una cosa sola, l'ultimo minuto guardato. Vedi il modulo per il perché
/// di ognuna delle sue tre risposte (l'avvio, il passato, l'ora che arretra).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ReminderWatch {
    seen: Option<i64>,
}

/// Cosa chiedere all'indice a questo sguardo.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WatchStep {
    /// Niente: è il primo sguardo, o l'ora del muro non è andata avanti.
    Nothing,
    /// I promemoria con l'ora in `(after, until]`.
    Ask { after: i64, until: i64 },
}

impl ReminderWatch {
    pub fn new() -> Self {
        Self::default()
    }

    /// L'ultimo minuto guardato, se c'è stato uno sguardo.
    pub fn seen(&self) -> Option<i64> {
        self.seen
    }

    /// Guarda l'ora del muro di adesso, e di' quali promemoria suonano.
    pub fn look(&mut self, now: i64) -> WatchStep {
        match self.seen {
            None => {
                self.seen = Some(now);
                WatchStep::Nothing
            }
            Some(seen) if now <= seen => WatchStep::Nothing,
            Some(seen) => {
                self.seen = Some(now);
                WatchStep::Ask {
                    after: seen,
                    until: now,
                }
            }
        }
    }
}

mod stored;

#[cfg(test)]
mod tests;
