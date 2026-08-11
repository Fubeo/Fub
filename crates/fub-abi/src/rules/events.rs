//! **Chi riceve cosa** — la regola di un abbonamento agli eventi (§10.1,
//! decisione 0033) — e **cosa passa quando non può passare tutto**, che è la
//! stessa domanda posta da un canale pieno ([`degrade`], §20.5).
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

use crate::event::{Actor, Event, EventMask, Notice, Origin};

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
/// vault; gli slash ai due capi non cambiano niente, perché due modi di
/// scrivere la stessa cartella che filtrano diversamente sono un difetto che si
/// vede una volta su venti.
///
/// Il corpo è quello dei predicati d'indice, ed è lo stesso apposta: chi si
/// abbona a una cartella e chi la interroga devono parlare della stessa
/// cartella (difetto 0141).
pub fn folder_contains(folder: &str, id: &str) -> bool {
    super::cartelle::contiene(folder, id)
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
    if !mask.changes.is_empty() {
        // Il quarto asse vale per i soli eventi che un cambiamento lo
        // **raccontano**. `None` è *non lo so* — un `document-changed`
        // costruito a mano, o che non viene dalla coda di una scrittura — e
        // passa: è la stessa regola del soggetto, e per la stessa ragione.
        // `Some(vuoto)` invece è un fatto, ed è *niente è cambiato*: quello non
        // passa, o il filtro non toglierebbe niente proprio nel caso in cui ha
        // la risposta più precisa.
        if let Some(changes) = event.changes() {
            if !changes.touches(&mask.changes) {
                return false;
            }
        }
    }
    true
}

/// **Sopra il tetto**: ciò che si riscopre riguardando il vault diventa un
/// invito a riconciliare, e ciò che non si riscopre passa al proprio posto.
///
/// È la seconda regola di questo modulo, e sta qui per la ragione della prima:
/// chi la applica non è uno solo. La applicano **tre** freni — il budget del
/// dispatch (`Dispatcher::next_to_deliver`), il tetto della raffica del ponte
/// verso la shell, e in forma di singolo evento il tetto degli arretrati di un
/// abbonato del bus, che non ha una raffica sotto gli occhi ma la stessa
/// domanda: *questo si può buttare?* Finché la risposta viveva in due copie —
/// una scritta nel ponte, e nel dispatch nessuna — il terzo freno buttava ciò
/// che gli altri due tenevano, e a nessun test risultava.
///
/// L'`Overflow` non va in coda né in testa ma **dove stava l'ultimo evento che
/// sostituisce**: è l'unico punto in cui dice la verità sull'ordine — tutto ciò
/// che lo precede è successo prima, tutto ciò che lo segue dopo. In coda
/// direbbe a chi ha appena ricevuto un `vault-closed` di andare a rileggere un
/// vault che non c'è più.
///
/// Se nella raffica c'era già un `Overflow` (il tetto del bus, o il budget del
/// dispatch) il suo conto **si somma** a questo invece di aggiungere un secondo
/// invito: due riconciliazioni di fila sono una riconciliazione e mezzo lavoro
/// buttato.
///
/// Se non c'è niente da buttare — cioè se nella raffica è tutto insostituibile
/// — **non nasce nessun `Overflow`**: un invito a riconciliare che non
/// corrisponde a nessuna perdita è una riconciliazione chiesta per niente.
pub fn degrade(burst: Vec<Notice>) -> Vec<Notice> {
    let mut tenuti: Vec<Notice> = Vec::new();
    let mut dropped: u64 = 0;
    let mut dove: Option<usize> = None;
    for notice in burst {
        match &notice.event {
            Event::Overflow { dropped: gia } => {
                dropped += gia;
                dove = Some(tenuti.len());
            }
            event if event.is_recoverable() => {
                dropped += 1;
                dove = Some(tenuti.len());
            }
            _ => tenuti.push(notice),
        }
    }
    if let Some(dove) = dove {
        tenuti.insert(
            dove,
            Notice::new(Event::Overflow { dropped }, Origin::by(Actor::Kernel)),
        );
    }
    tenuti
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::PluginError;
    use crate::event::{BatchId, DocChange, DocChanges, EventKind, Severity, Subject};
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
            changes: None,
        }));
    }

    /// *Non lo so* non è *niente*, e i due vanno da parti opposte del filtro
    /// (§22.2, decisione 0069).
    ///
    /// È la coppia che questa regola non può sbagliare: `None` è un evento che
    /// non viene dalla coda di una scrittura del kernel, e filtrarlo via
    /// vorrebbe dire perdere in silenzio su un diff che non è quello vero;
    /// `Some(vuoto)` è un fatto — niente è cambiato — e lasciarlo passare
    /// vorrebbe dire non filtrare proprio dove la risposta è più precisa.
    #[test]
    fn not_knowing_passes_and_knowing_nothing_does_not() {
        let sui_tag = EventMask::of([EventKind::DocumentChanged]).on_changes([DocChange::Tags]);
        assert!(sui_tag.wants(&Event::DocumentChanged {
            id: DocId::new("a.md"),
            changes: None,
        }));
        assert!(!sui_tag.wants(&Event::DocumentChanged {
            id: DocId::new("a.md"),
            changes: Some(DocChanges::default()),
        }));
        assert!(sui_tag.wants(&Event::DocumentChanged {
            id: DocId::new("a.md"),
            changes: Some(DocChanges {
                aspects: vec![DocChange::Tags],
                ..DocChanges::default()
            }),
        }));
        // E un evento che un cambiamento non lo racconta affatto passa comunque:
        // il quarto asse non è un modo di filtrare via le altre specie.
        let anche_i_lotti = EventMask::of([EventKind::DocumentChanged, EventKind::BatchEnded])
            .on_changes([DocChange::Tags]);
        assert!(anche_i_lotti.wants(&Event::BatchEnded {
            batch: BatchId(1),
            changed: vec![DocId::new("a.md")],
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

    fn guasto() -> Notice {
        Notice::of(Event::Trouble {
            severity: Severity::Failure,
            subject: Some(DocId::new("a.md")),
            error: PluginError::Io("disco pieno".into()),
        })
    }

    /// Sopra il tetto si butta ciò che si riscopre, **e nient'altro**: il
    /// guasto resta, e resta al proprio posto rispetto a ciò che è passato.
    #[test]
    fn what_cannot_be_rediscovered_survives_a_ceiling() {
        let burst = vec![
            Notice::of(Event::IndexUpdated),
            guasto(),
            Notice::of(Event::DocumentChanged {
                id: DocId::new("b.md"),
                changes: None,
            }),
        ];
        let out = degrade(burst);
        assert_eq!(out.len(), 2, "il guasto e un invito solo: {out:?}");
        assert!(matches!(out[0].event, Event::Trouble { .. }));
        // I due buttati diventano un invito solo, e l'invito sta **dove stava
        // l'ultimo di loro**: dopo il guasto, perché dopo il guasto è successo.
        assert!(matches!(out[1].event, Event::Overflow { dropped: 2 }));

        // E dall'altro verso, che è l'argomento per cui l'invito non va in
        // coda: chi ha appena ricevuto un `vault-closed` non deve sentirsi
        // dire di andare a rileggere un vault che non c'è più.
        let out = degrade(vec![
            Notice::of(Event::IndexUpdated),
            Notice::of(Event::VaultClosed { root: "/v".into() }),
        ]);
        assert!(
            matches!(out[0].event, Event::Overflow { dropped: 1 }),
            "l'invito sta dove stava il buttato, cioè PRIMA della chiusura: {out:?}"
        );
        assert!(matches!(out[1].event, Event::VaultClosed { .. }));
    }

    /// Due riconciliazioni di fila sono una riconciliazione e mezzo lavoro
    /// buttato: un `Overflow` che arriva già nella raffica si **somma**.
    #[test]
    fn an_overflow_in_the_burst_adds_up_instead_of_doubling() {
        let out = degrade(vec![
            Notice::of(Event::Overflow { dropped: 40 }),
            Notice::of(Event::IndexUpdated),
        ]);
        assert_eq!(out.len(), 1);
        assert!(matches!(out[0].event, Event::Overflow { dropped: 41 }));
    }

    /// Il caso che il budget del dispatch incontra per primo, e che il ponte
    /// non aveva mai incontrato: **una raffica in cui non c'è niente da
    /// buttare**. Un invito a riconciliare senza una perdita è lavoro chiesto
    /// per niente.
    #[test]
    fn nothing_to_drop_is_no_invitation() {
        let out = degrade(vec![guasto(), guasto()]);
        assert_eq!(out.len(), 2);
        assert!(out
            .iter()
            .all(|n| !matches!(n.event, Event::Overflow { .. })));
    }
}
