//! **Lo stato per-documento che non è del kernel**: chi lo migra, e chi lo
//! raccoglie (§13.2).
//!
//! La convenzione — dove sta e come si legge al contrario — è del contratto
//! ([`fubmd_abi::rules::doc_data`]); qui c'è la sola parte che richiede di
//! conoscere il disco e l'anagrafe del vault, cioè le due cose che un plugin non
//! ha.
//!
//! # Perché è il kernel a farlo, e non ognuno per sé
//!
//! Prima di questa voce il rito del rename lo celebrava ognuno per conto
//! proprio: il versioning migrava la sua chiave ascoltando `DocumentRenamed`, il
//! sidecar dell'organizzazione la migrava in TypeScript, e le quattro feature
//! che FEATURES chiede dopo (annotazioni, task, commenti, database, flashcard)
//! l'avrebbero migrata una terza e una quarta volta. Ognuna col proprio buco,
//! **lo stesso buco**: chi ascolta un evento non sente il rename fatto ad app
//! chiusa, e chi non lo sente tiene una chiave morta per sempre.
//!
//! Passando di qui il buco si chiude per tutti insieme, compresi i due casi che
//! nessuno copriva: la rinomina fatta **da un'altra applicazione** mentre FubMD
//! è aperto (ci arriva `sync_renamed_path`, che finisce in `migrate_identity`
//! come le altre) e quella fatta **ad app chiusa**, che la raccolta non ripara
//! ma almeno non lascia crescere in silenzio.
//!
//! # La raccolta, e cosa la rende possibile
//!
//! Nessuno raccoglieva. Cancellata una nota per sempre, i dati che la nominavano
//! restavano sotto una chiave che nessuno visitava più: uno spazio che cresce e
//! non cala, invisibile perché non ha una superficie dove mostrarsi.
//!
//! La raccolta è un **sweep** e non un evento, e la differenza è la stessa di
//! sopra: un evento lo si perde, un giro sul disco no. Gira all'apertura del
//! vault, quando l'anagrafe è appena stata ricostruita ed è al suo massimo di
//! verità. Ciò che la rende scrivibile è che
//! [`doc_of`](fubmd_abi::rules::doc_data::doc_of) è **totale**: di ogni cartella
//! si sa quale nota nomina, quindi si sa se quella nota non c'è più.
//!
//! # Cosa conta come «non c'è più»
//!
//! Né nel vault **né nel cestino**. Il cestino è la ragione per cui la raccolta
//! non è «non è indicizzato»: una nota cestinata è recuperabile, e ripristinarla
//! senza i suoi dati sarebbe una perdita silenziosa fatta da chi doveva
//! impedirle.

use camino::{Utf8Path, Utf8PathBuf};
use fubmd_abi::model::DocId;
use fubmd_abi::rules::doc_data;

/// Sposta lo spazio per-documento di `from` sotto `to`, in **ogni** spazio dati
/// di plugin che ne ha uno. Restituisce ciò che non è riuscito, per plugin.
///
/// Gli errori non risalgono come fallimento dell'operazione, e la ragione è la
/// stessa dell'organizzazione (§11.3): il file è già stato spostato, e far
/// fallire una rinomina riuscita perché un plugin non ha potuto seguirla sarebbe
/// il verso sbagliato. La rinomina vale, i dati restano indietro, e qualcuno lo
/// dice.
pub(crate) fn migrate(roots: &[Utf8PathBuf], from: &DocId, to: &DocId) -> Vec<String> {
    let mut errori = Vec::new();
    for root in roots {
        let sorgente = space_dir(root, from);
        if !sorgente.is_dir() {
            continue;
        }
        let destinazione = space_dir(root, to);
        // Il path di destinazione era **libero** — il kernel rifiuta un rename
        // verso un documento che esiste — quindi una cartella già lì è di una
        // nota che non c'è più: la raccolta l'avrebbe tolta al prossimo giro, e
        // qui va tolta subito o la `rename` non ha dove atterrare.
        if destinazione.exists() {
            let _ = std::fs::remove_dir_all(&destinazione);
        }
        if let Some(parent) = destinazione.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Err(e) = std::fs::rename(&sorgente, &destinazione) {
            let plugin = root.file_name().unwrap_or(root.as_str());
            errori.push(format!("{plugin}: {e}"));
        }
    }
    errori
}

/// Toglie gli spazi per-documento delle note che non esistono più, in ogni
/// spazio dati di plugin. Restituisce quante ne ha tolte.
///
/// `esiste` risponde alla sola domanda che il disco non sa fare da sé: *questo
/// documento è ancora nell'anagrafe del vault, o nel suo cestino?*
pub(crate) fn collect(roots: &[Utf8PathBuf], esiste: &dyn Fn(&DocId) -> bool) -> usize {
    let mut tolti = 0usize;
    for root in roots {
        let base = root.join(doc_data::DOC_SPACE);
        let Ok(entries) = std::fs::read_dir(&base) else {
            continue;
        };
        for entry in entries.flatten() {
            let Some(nome) = entry.file_name().to_str().map(str::to_owned) else {
                // Un nome che non è UTF-8 non l'ha scritto questa convenzione, e
                // toglierlo sarebbe cancellare roba di qualcun altro.
                continue;
            };
            let doc = DocId::new(doc_data::decode(&nome));
            if esiste(&doc) {
                continue;
            }
            if std::fs::remove_dir_all(base.join(&nome)).is_ok() {
                tolti += 1;
            }
        }
    }
    tolti
}

/// La cartella di `doc` dentro lo spazio dati di **un** plugin.
fn space_dir(root: &Utf8Path, doc: &DocId) -> Utf8PathBuf {
    root.join(doc_data::DOC_SPACE)
        .join(doc_data::encode(doc.as_str()))
}
