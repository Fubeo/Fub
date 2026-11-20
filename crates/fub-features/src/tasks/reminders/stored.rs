//! **Il file dei promemoria**: ciò che l'indice ha ricavato dalle note, con la
//! revisione del sorgente da cui l'ha ricavato (`reminders.json` nella cache
//! di `fub.tasks`, `.fub/data/plugins/fub.tasks/`).
//!
//! # Un derivato, e qui è tutto
//!
//! Il file non dice niente che le note non dicano già: esiste perché la
//! riapertura di un vault non debba rileggere e rianalizzare ogni nota per
//! ritrovare i promemoria che aveva un minuto prima della chiusura
//! (`docs/misure/2026-11-20-riapertura-tiepida.md`). Quindi:
//!
//! - **sta nella cache e non nello spazio dati.** Lo spazio dati
//!   (`.fub/plugins/<id>/`) è dell'utente: un backup o una sincronizzazione lo
//!   portano con sé. Questo file si rifà dalle note, e portarlo in giro
//!   vorrebbe dire trattare un derivato come un dato.
//! - **illeggibile, di un altro schema o di un'altra regola di lettura → si
//!   butta**, senza un errore e senza bloccare l'apertura: l'indice parte
//!   vuoto, risponde a [`up_to_date`](fub_abi::traits::IndexProvider::up_to_date)
//!   che non ha niente, e il kernel gli consegna ogni nota. Nessuna
//!   migrazione: un derivato si rifà.
//! - **la regola di lettura conta quanto lo schema** ([`RULE`]). Lo stesso
//!   testo dà promemoria diversi se cambia chi lo legge: il parser Markdown,
//!   la regola del contratto
//!   ([`task_reminder`](fub_abi::rules::tasks::task_reminder)), il cammino
//!   dei compiti nel modello. Un file scritto con la lettura di prima
//!   porterebbe promemoria che la nuova non leggerebbe più così, e la nota
//!   salterebbe con quelli finché non cambia. La versione del programma non
//!   basta: è quella del workspace, ferma per mesi mentre il parser cambia.
//!   Per questo la regola è un numero alzato a mano e **legato a ciò che
//!   legge** da un test (`the_reading_rule_is_bound_to_what_it_reads`), che
//!   passa un corpus di compiti dal parser vero e fallisce se i promemoria
//!   cambiano senza che la regola salga.
//! - **la configurazione di lettura non entra nella chiave, e il perché è
//!   scritto.** Le opzioni del parser sono fisse (`ParseContext::obsidian`,
//!   le stesse per ogni nota del kernel) e nessuna impostazione cambia come si
//!   legge un compito: non c'è niente da impronta. Le regole di sintassi
//!   montate invece cambiano il modello (un `%%…%%` attorno a un `⏰` lo
//!   nasconde), ma il contratto non le fa vedere a un indice in modo
//!   affidabile: l'indice si attiva quando si registra, prima dei plugin che
//!   vengono dopo, e `up_to_date` non ha un host. È lo stesso limite
//!   dell'anagrafe del kernel e del manifest della ricerca, che conservano
//!   ciò che hanno ricavato dal modello alla stessa maniera: la chiusura sta
//!   nel kernel, che conosce il registro, non qui.
//! - **una nota senza revisione non si scrive.** Ciò che l'indice ha preso a
//!   sessione aperta (un salvataggio) gli arriva senza che nessuno gli abbia
//!   detto di che revisione fosse: scriverlo con una revisione indovinata
//!   farebbe saltare la nota alla riapertura con i promemoria sbagliati.
//!   Lasciarlo fuori la fa rileggere, che è il verso sicuro dello sbaglio.
//! - **la scrittura è atomica** come ogni `cache_write` (file temporaneo e
//!   rinomina): un crash lascia il file di prima, intero, le cui coppie
//!   revisione → promemoria restano vere per il contenuto che nominano.

use std::collections::BTreeMap;

use fub_abi::edit::Revision;
use fub_abi::model::DocId;
use serde::{Deserialize, Serialize};

use super::Reminder;

/// Il nome del file nella cache di `fub.tasks`.
pub(super) const FILE: &str = "reminders.json";

/// La versione di schema del file: si alza quando cambia la **forma** di ciò
/// che c'è dentro.
pub(super) const SCHEMA: u32 = 1;

/// La regola di lettura: si alza quando lo stesso testo darebbe promemoria
/// diversi (vedi il modulo). Il test che la lega alla lettura tiene la storia
/// delle regole, una riga per numero: un'uscita nuova vuole una riga nuova.
pub(super) const RULE: u32 = 1;

/// Il file come sta sul disco.
#[derive(Debug, Serialize, Deserialize)]
pub(super) struct StoredFile {
    pub(super) schema: u32,
    pub(super) rule: u32,
    /// Per ogni nota di cui si conosce la revisione: la revisione e i suoi
    /// promemoria, anche nessuno. Una nota senza promemoria **c'è**, perché
    /// è ciò che permette di rispondere «ce l'ho» anche per lei.
    pub(super) docs: BTreeMap<String, StoredDoc>,
}

/// Una nota del file.
#[derive(Debug, Serialize, Deserialize)]
pub(super) struct StoredDoc {
    /// La revisione del sorgente da cui i promemoria sono stati ricavati.
    pub(super) source: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) reminders: Vec<StoredReminder>,
}

/// Un promemoria del file: gli stessi campi di quello in memoria.
#[derive(Debug, Serialize, Deserialize)]
pub(super) struct StoredReminder {
    pub(super) minute: i64,
    pub(super) at: usize,
    pub(super) text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) heading: Option<String>,
}

/// Ciò che il file restituisce: per ogni nota la revisione e i promemoria, in
/// ordine di posizione e senza doppioni di posizione.
pub(super) type Loaded = Vec<(DocId, Revision, Vec<Reminder>)>;

/// Legge il file. `None` per tutto ciò che non è «un file nostro, di questo
/// schema e di questa regola»: è sempre «riparti dalle note».
pub(super) fn decode(raw: &[u8]) -> Option<Loaded> {
    let file: StoredFile = serde_json::from_slice(raw).ok()?;
    if file.schema != SCHEMA || file.rule != RULE {
        return None;
    }
    let mut loaded = Vec::with_capacity(file.docs.len());
    for (doc, stored) in file.docs {
        if doc.is_empty() || stored.source.is_empty() {
            // Una riga che nessuna versione di questo codice scrive: il file
            // non è nostro, o è stato toccato. Tutto o niente, come il
            // manifest della ricerca.
            return None;
        }
        let mut reminders: Vec<Reminder> = stored
            .reminders
            .into_iter()
            .map(|r| Reminder {
                minute: r.minute,
                at: r.at,
                text: r.text,
                heading: r.heading,
            })
            .collect();
        // La risposta cerca un promemoria per posizione (`binary_search`):
        // l'ordine è un invariante dell'indice, e non si affida al file.
        reminders.sort_by_key(|r| r.at);
        reminders.dedup_by_key(|r| r.at);
        loaded.push((DocId::new(doc), Revision::new(stored.source), reminders));
    }
    Some(loaded)
}

/// Scrive il file: le note di cui si conosce la revisione, con i loro
/// promemoria.
pub(super) fn encode<'a>(
    docs: impl Iterator<Item = (&'a DocId, &'a Revision, &'a [Reminder])>,
) -> serde_json::Result<Vec<u8>> {
    let file = StoredFile {
        schema: SCHEMA,
        rule: RULE,
        docs: docs
            .map(|(doc, source, reminders)| {
                (
                    doc.as_str().to_string(),
                    StoredDoc {
                        source: source.0.clone(),
                        reminders: reminders
                            .iter()
                            .map(|r| StoredReminder {
                                minute: r.minute,
                                at: r.at,
                                text: r.text.clone(),
                                heading: r.heading.clone(),
                            })
                            .collect(),
                    },
                )
            })
            .collect(),
    };
    serde_json::to_vec(&file)
}
