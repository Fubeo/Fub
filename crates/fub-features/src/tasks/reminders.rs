//! **L'indice dei promemoria**: i compiti aperti che portano un `⏰`, con
//! l'ora del muro a cui suonano.
//!
//! # Un indice derivato, e soltanto in memoria
//!
//! Il kernel lo alimenta come ogni indice ([`IndexProvider`]): ogni nota che
//! entra o esce dal vault passa di qui con il suo modello, e il riallineamento
//! dopo la scansione toglie ciò che è sparito ad app chiusa. Non persiste
//! niente: alla riapertura del vault il kernel gli consegna tutte le note
//! (non dichiara di averne nessuna, [`IndexProvider::up_to_date`]), quindi si
//! ricostruisce da sé dall'indice delle note e non ha un formato su disco da
//! migrare. Un compito spuntato, un `⏰` cancellato o una nota cestinata
//! escono al primo salvataggio, perché la nota rientra con il modello nuovo.
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

use std::collections::BTreeMap;

use fub_abi::error::PluginError;
use fub_abi::locale::Locale;
use fub_abi::model::{Block, DocId, DocumentModel};
use fub_abi::rules::tasks::{
    civil_minute, reminder_minute, reminder_text, task_reminder, task_text,
};
use fub_abi::text::{Arg, Strings, Text};
use fub_abi::traits::{
    HostApi, IndexLoss, IndexProvider, IndexQuery, IndexResult, QueryKind, QueryRoute, ReadApi,
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

/// La chiave d'errore di una domanda che non ha la forma della rotta: la
/// frase sta nel catalogo dei compiti.
pub(super) const E_QUERY: &str = "reminders_query";
const DETAIL: &str = "detail";
/// La chiave d'errore di una domanda arrivata a una rotta che l'indice non
/// serve, e quella di una risposta che non si è potuta scrivere.
pub(super) const E_ROUTE: &str = "reminders_route";
pub(super) const E_ANSWER: &str = "reminders_answer";
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
struct Reminder {
    minute: i64,
    at: usize,
    text: String,
    heading: Option<String>,
}

/// L'indice: i promemoria dei compiti aperti, per nota.
#[derive(Debug, Default)]
pub struct ReminderIndex {
    by_doc: BTreeMap<DocId, Vec<Reminder>>,
}

impl ReminderIndex {
    pub fn new() -> Self {
        Self::default()
    }

    /// Quanti promemoria tiene, in tutto il vault.
    pub fn len(&self) -> usize {
        self.by_doc.values().map(Vec::len).sum()
    }

    pub fn is_empty(&self) -> bool {
        self.by_doc.is_empty()
    }

    /// Prende i promemoria di una nota, al posto di quelli che aveva.
    fn take(&mut self, model: &DocumentModel) {
        let found = reminders_of(model);
        if found.is_empty() {
            self.by_doc.remove(&model.id);
        } else {
            self.by_doc.insert(model.id.clone(), found);
        }
    }

    /// I promemoria in `(after, until]`, in ordine d'ora, nota e posizione.
    pub fn between(&self, after: Option<i64>, until: Option<i64>, limit: usize) -> ReminderList {
        let mut hits: Vec<(&DocId, &Reminder)> = self
            .by_doc
            .iter()
            .flat_map(|(doc, list)| list.iter().map(move |reminder| (doc, reminder)))
            .filter(|(_, r)| {
                after.is_none_or(|a| r.minute > a) && until.is_none_or(|u| r.minute <= u)
            })
            .collect();
        hits.sort_by(|(a_doc, a), (b_doc, b)| {
            (a.minute, a_doc.as_str(), a.at).cmp(&(b.minute, b_doc.as_str(), b.at))
        });
        let more = hits.len() > limit;
        hits.truncate(limit);
        ReminderList {
            reminders: hits
                .into_iter()
                .map(|(doc, r)| ReminderEntry {
                    doc: doc.clone(),
                    at: r.at,
                    when: reminder_text(r.minute),
                    text: r.text.clone(),
                    heading: r.heading.clone(),
                })
                .collect(),
            more,
        }
    }

    fn answer(&self, query: serde_json::Value) -> Result<IndexResult, PluginError> {
        let query =
            RemindersQuery::deserialize(&query).map_err(|error| bad_query(&error.to_string()))?;
        let RemindersQuery::Reminders {
            version,
            after,
            until,
            limit,
        } = query;
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

    fn activate(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
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
            self.by_doc.remove(id);
        }
        Vec::new()
    }

    fn reconcile(&mut self, ids: &[DocId]) -> Vec<IndexLoss> {
        let alive: std::collections::HashSet<&DocId> = ids.iter().collect();
        self.by_doc.retain(|doc, _| alive.contains(doc));
        Vec::new()
    }

    fn flush(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn close(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        self.by_doc.clear();
        Ok(())
    }

    fn query(&self, request: IndexQuery) -> Result<IndexResult, PluginError> {
        match request {
            IndexQuery::Custom { ns, query } if ns == TASKS_ID => self.answer(query),
            _ => Err(PluginError::Unserved(Text::key(E_ROUTE))),
        }
    }
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
    // marcatore, dall'indice dei titoli del modello (in ordine di file).
    for reminder in &mut found {
        reminder.heading = model
            .outline
            .iter()
            .take_while(|heading| heading.span.start < reminder.at)
            .last()
            .map(|heading| heading.text.clone());
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

#[cfg(test)]
mod tests;
