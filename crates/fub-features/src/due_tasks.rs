//! I compiti aperti che scadono in un giorno, letti dal modello di una nota.
//!
//! La pagina del giorno (`template/view/day.rs`) e la Scrivania
//! (`dashboard/desk.rs`) fanno la stessa domanda: l'indice dice quali note
//! hanno un compito che scade quel giorno ([`QueryPredicate::TaskDue`]), e qui
//! si leggono i compiti di una di quelle note. La scadenza la legge la regola
//! del contratto ([`task_text`], [`task_due`]), la stessa della vista dei
//! compiti e della ricerca: questo modulo cammina l'albero e basta.
//!
//! [`QueryPredicate::TaskDue`]: fub_abi::query::QueryPredicate::TaskDue

use fub_abi::model::{Block, DocumentModel};
use fub_abi::rules::tasks::{task_due, task_text};
use fub_abi::DocId;

/// Un compito aperto che scade quel giorno: la nota, dove comincia la voce
/// (byte del sorgente) e il testo senza la scadenza.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct DueTask {
    pub(crate) doc: DocId,
    pub(crate) at: usize,
    pub(crate) text: String,
}

/// I compiti aperti di un modello che scadono il giorno `day` (giorni
/// dall'epoca), in qualunque punto dell'albero: liste annidate, citazioni e
/// blocchi custom, come li cammina la ricerca. In ordine di posizione.
pub(crate) fn due_on(model: &DocumentModel, doc: &DocId, day: i64) -> Vec<DueTask> {
    let mut found = Vec::new();
    let mut pending: Vec<&Block> = model.body.iter().rev().collect();
    while let Some(block) = pending.pop() {
        match block {
            Block::List { items, .. } => {
                for item in items.iter().rev() {
                    pending.extend(item.blocks.iter().rev());
                }
                for item in items {
                    let Some(marker) = item.task else { continue };
                    if marker.checked() {
                        continue;
                    }
                    let text = task_text(&item.blocks);
                    let Some(due) = task_due(&text) else { continue };
                    if due.day != Some(day) {
                        continue;
                    }
                    // Il testo senza la scadenza: chi lo mostra dice già il giorno.
                    let before = text[..due.from].trim_end();
                    let after = text[due.to..].trim_start();
                    let label = match (before.is_empty(), after.is_empty()) {
                        (_, true) => before.to_string(),
                        (true, false) => after.to_string(),
                        (false, false) => format!("{before} {after}"),
                    };
                    found.push(DueTask {
                        doc: doc.clone(),
                        at: marker.span.start,
                        text: label,
                    });
                }
            }
            Block::Quote { blocks, .. } | Block::Custom { blocks, .. } => {
                pending.extend(blocks.iter().rev())
            }
            _ => {}
        }
    }
    found.sort_by_key(|task| task.at);
    found
}
