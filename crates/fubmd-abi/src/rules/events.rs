//! **Chi riceve cosa** — la regola di un abbonamento agli eventi (§10.1,
//! decisione 0033).
//!
//! Una [`EventMask`] dice tre cose — le specie, il topic dei custom, il
//! soggetto — e questo modulo è il posto in cui quelle tre diventano un sì o un
//! no. Sta qui e non nel kernel per la ragione di tutto
//! [`crate::rules`](super): chi applica la maschera non è uno solo. La applica
//! il kernel per consegnare a un [`EventHandler`](crate::traits::EventHandler),
//! e la applica **la shell** per decidere quando ridisegnare una view
//! dichiarata — che è il secondo lettore, quello che senza una regola scritta
//! una volta la restringerebbe a modo suo, in silenzio e solo per certi topic.
//!
//! # I due prefissi, e perché non sono `starts_with`
//!
//! Un prefisso di **topic** e un prefisso di **cartella** si assomigliano e
//! sbagliano allo stesso modo: `acme` è un prefisso di caratteri di
//! `acmecorp:x` come `Progetti` lo è di `Progetti-vecchi/nota.md`. Filtrare
//! così non toglierebbe il difetto che questa voce esiste per togliere — un
//! handler che si sveglia per roba di qualcun altro — lo cambierebbe di
//! vittima. Quindi il confronto è **per segmento**: il carattere che segue il
//! prefisso deve essere un separatore del contratto, `:` o `.` per i nomi
//! ([`ids`](super::ids)) e `/` per i path.

use crate::event::{Event, EventMask};

/// Questo topic sta sotto questo prefisso?
///
/// I separatori sono i due della regola dei nomi (§7.4): `:` fra namespace e
/// nome, `.` dentro l'uno e dentro l'altro. Ne segue la lettura che serve —
/// `com.acme` prende tutti i plugin di acme, `com.acme.tasks` prende quel
/// plugin, `com.acme.tasks:board` prende una famiglia di topic — e ne segue
/// quella che non deve valere: `com.acme` non prende `com.acmecorp:x`.
///
/// Un prefisso vuoto vale «qualunque»: è la stessa lettura della lista vuota,
/// scritta con un elemento invece che con zero.
pub fn topic_matches(prefix: &str, topic: &str) -> bool {
    if prefix.is_empty() {
        return true;
    }
    if !topic.starts_with(prefix) {
        return false;
    }
    match topic.as_bytes().get(prefix.len()) {
        None => true,
        Some(b':' | b'.') => true,
        Some(_) => false,
    }
}

/// Questo documento sta dentro questa cartella, a qualunque profondità?
///
/// La cartella è un **prefisso di path** e non un tipo perché nel kernel una
/// cartella non esiste ancora (§14.3): esistono i `DocId`, che sono path. La
/// stringa vuota — e quella fatta di soli `/` — è la radice, cioè tutto il
/// vault; un `/` in coda non cambia niente, perché due modi di scrivere la
/// stessa cartella che filtrano diversamente sarebbero un difetto che si vede
/// una volta su venti.
pub fn folder_contains(folder: &str, id: &str) -> bool {
    let folder = folder.trim_end_matches('/');
    if folder.is_empty() {
        return true;
    }
    id.len() > folder.len()
        && id.starts_with(folder)
        && id.as_bytes().get(folder.len()) == Some(&b'/')
}

/// Questo evento va consegnato a chi ha dichiarato questa maschera?
///
/// I tre filtri sono in **and**, e ognuno vuoto vuol dire *non filtro* — una
/// maschera scritta prima che i tre campi esistessero riceve esattamente ciò
/// che riceveva.
///
/// Il filtro di soggetto si applica ai soli eventi che un documento lo nominano
/// ([`Event::names`]): `overflow`, `vault-closed` e i tre del ciclo di un job
/// passano anche a chi si è abbonato a una cartella sola — un lavoro lungo non
/// è di una cartella, e filtrarlo via lascerebbe un centro attività che non
/// vede niente proprio quando qualcuno ha ristretto il proprio interesse.
pub fn mask_wants(mask: &EventMask, event: &Event) -> bool {
    if !mask.contains(event.kind()) {
        return false;
    }
    if let Event::Custom { topic, .. } = event {
        if !mask.topics.is_empty() && !mask.topics.iter().any(|p| topic_matches(p, topic)) {
            return false;
        }
    }
    if !mask.subjects.is_empty() {
        let named = event.names();
        if !named.is_empty()
            && !named
                .iter()
                .any(|doc| mask.subjects.iter().any(|s| s.holds(doc)))
        {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::{BatchId, EventKind, Subject};
    use crate::model::DocId;

    #[test]
    fn a_topic_prefix_stops_at_a_separator() {
        assert!(topic_matches("com.acme", "com.acme:done"));
        assert!(topic_matches("com.acme", "com.acme.tasks:done"));
        assert!(topic_matches(
            "com.acme.tasks:board",
            "com.acme.tasks:board.moved"
        ));
        assert!(topic_matches("com.acme.tasks:done", "com.acme.tasks:done"));
        // Il caso per cui la regola non è `starts_with`: un altro plugin, con
        // un nome che comincia uguale.
        assert!(!topic_matches("com.acme", "com.acmecorp:done"));
        assert!(!topic_matches(
            "com.acme.tasks:board",
            "com.acme.tasks:boards"
        ));
        // Vuoto = qualunque: la lista vuota scritta con un elemento.
        assert!(topic_matches("", "chiunque:qualunque"));
    }

    #[test]
    fn a_folder_holds_what_is_under_it_and_not_what_looks_like_it() {
        assert!(folder_contains("Progetti", "Progetti/Alpha.md"));
        assert!(folder_contains("Progetti", "Progetti/2026/Alpha.md"));
        assert!(folder_contains("Progetti/", "Progetti/Alpha.md"));
        assert!(!folder_contains("Progetti", "Progetti-vecchi/Alpha.md"));
        // La cartella non contiene sé stessa come documento: `Progetti` è un
        // path, non una nota.
        assert!(!folder_contains("Progetti", "Progetti"));
        // La radice è tutto il vault.
        assert!(folder_contains("", "Alpha.md"));
        assert!(folder_contains("/", "Progetti/Alpha.md"));
    }

    #[test]
    fn an_empty_filter_is_not_a_filter() {
        let tutto = EventMask::all();
        assert!(tutto.wants(&Event::Custom {
            topic: "chiunque:qualunque".into(),
            payload: serde_json::Value::Null,
        }));
        assert!(tutto.wants(&Event::DocumentChanged {
            id: DocId::new("ovunque/nota.md"),
        }));
    }

    #[test]
    fn a_rename_out_of_a_folder_is_news_for_that_folder() {
        let mask = EventMask::of([EventKind::DocumentRenamed]).about([Subject::folder("Progetti")]);
        let uscita = Event::DocumentRenamed {
            from: DocId::new("Progetti/Alpha.md"),
            to: DocId::new("Archivio/Alpha.md"),
        };
        assert!(
            mask.wants(&uscita),
            "chi guarda una cartella deve sapere che una nota se n'è andata: \
             è l'unico modo che ha di smettere di tenerne lo stato"
        );
        assert!(mask.wants(&Event::DocumentRenamed {
            from: DocId::new("Archivio/Alpha.md"),
            to: DocId::new("Progetti/Alpha.md"),
        }));
        assert!(!mask.wants(&Event::DocumentRenamed {
            from: DocId::new("Archivio/Alpha.md"),
            to: DocId::new("Altro/Alpha.md"),
        }));
    }

    #[test]
    fn a_batch_arrives_if_it_touched_the_subject() {
        let mask = EventMask::of([EventKind::BatchEnded]).about([Subject::folder("Progetti")]);
        assert!(mask.wants(&Event::BatchEnded {
            batch: BatchId(1),
            changed: vec![DocId::new("Altro/a.md"), DocId::new("Progetti/b.md")],
        }));
        assert!(!mask.wants(&Event::BatchEnded {
            batch: BatchId(1),
            changed: vec![DocId::new("Altro/a.md")],
        }));
        // Un lotto che ha toccato il solo indice non nomina niente: passa,
        // perché «riconcilia» vale per chiunque.
        assert!(mask.wants(&Event::BatchEnded {
            batch: BatchId(1),
            changed: vec![],
        }));
    }

    #[test]
    fn what_cannot_be_rediscovered_passes_any_subject() {
        let mask = EventMask::all().about([Subject::document("Progetti/Alpha.md")]);
        for event in [
            Event::Overflow { dropped: 3 },
            Event::VaultClosed { root: "/v".into() },
            Event::IndexUpdated,
        ] {
            assert!(
                mask.wants(&event),
                "{event:?} non nomina un documento: filtrarlo via vorrebbe dire \
                 perderlo in silenzio proprio a chi si è abbonato a poco"
            );
        }
    }
}
