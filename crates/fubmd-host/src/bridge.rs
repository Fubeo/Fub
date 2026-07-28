//! **Il ponte degli eventi** (§10.2,
//! [decisione 0034](../../../docs/decisions/0034-il-freno-e-il-raggruppamento.md)):
//! da un capo il bus del kernel, dall'altro chi guarda — il webview, una CLI,
//! SSE.
//!
//! Prima era un thread scritto dentro [`Host::open`](crate::Host::open) che
//! faceva `recv()` e `emit` in un ciclo senza freno: **un messaggio per
//! evento**, e nessuna politica sua. Il costo non si vedeva perché la
//! [decisione 0011](../../../docs/decisions/0011-il-lotto.md) aveva già tolto i
//! *ridisegni* — dentro un lotto arriva un `batch-ended` solo — ma non i
//! **messaggi**: una rinomina con 200 backlink li faceva attraversare tutti e
//! 200, uno per uno.
//!
//! # La finestra è la velocità di chi consuma
//!
//! Il ponte non ha una finestra temporale, e questa è la decisione da non
//! rovesciare per comodità. Aspettare *n* millisecondi prima di consegnare
//! vorrebbe dire scegliere un numero — quanto? con che costo per il primo
//! evento, che è quasi sempre solo? — e pagarlo su **ogni** evento, anche
//! quando non c'è niente da raggruppare. Qui il ciclo aspetta il primo notice e
//! poi **drena ciò che c'è già**: se il vault è fermo, la raffica è di uno e la
//! latenza è zero; se il kernel sta correndo più veloce del webview, la raffica
//! è grande esattamente quanto il ritardo, e il raggruppamento serve proprio
//! lì. È auto-regolato per costruzione, e non c'è nessuna costante da
//! indovinare.
//!
//! # Le due riduzioni, in ordine
//!
//! 1. **Raggruppamento**: dentro una raffica, ciò che dice due volte la stessa
//!    cosa la dice una — e si tiene l'**ultima** occorrenza, non la prima,
//!    perché fra un `document-changed` e la rimozione dello stesso documento
//!    l'ordine è tutto (vedi [`coalesce`]).
//! 2. **Tetto**: se dopo il raggruppamento la raffica è ancora più lunga di
//!    [`BURST_CEILING`], consegnarla evento per evento costa più che dire
//!    «riconcilia»: ciò che si riscopre riguardando il vault diventa un
//!    [`Event::Overflow`] solo, e ciò che non si riscopre passa comunque, al
//!    proprio posto.
//!
//! Nessuna delle due riduzioni inventa una classificazione: cosa sia
//! sacrificabile lo dice il contratto, in un posto solo
//! ([`Event::is_recoverable`]).

use std::collections::HashSet;
use std::sync::Arc;

use fubmd_abi::model::DocId;
use fubmd_abi::{Actor, Event, Notice, Origin};
use fubmd_kernel::Subscription;

use crate::session::EventSink;

/// Oltre quanti eventi in una raffica il ponte smette di raccontarli uno per
/// uno e dice «riconcilia».
///
/// Non è il tetto del bus (`BACKLOG_CEILING`, che protegge la **memoria** di chi
/// è indietro): questo protegge il **canale**, ed è molto più basso perché
/// misura un'altra cosa — quante consegne separate valga la pena di fare. Sopra
/// il centinaio, chi riceve rifà comunque il giro completo per ognuna: un
/// `list_documents` e un ridisegno per messaggio è più lavoro della
/// riconciliazione che li sostituisce tutti.
const BURST_CEILING: usize = 128;

/// Accende il ponte: un thread che vive quanto il bus.
///
/// Va acceso **dopo** la scansione iniziale e **prima** che il rilevatore possa
/// emettere il primo evento: quel momento lo conosce solo chi apre, ed è il
/// motivo per cui il sink è un trait dell'host e non un abbonamento che il
/// chiamante si prende da sé.
pub(crate) fn spawn(rx: Subscription, sink: Arc<dyn EventSink>) {
    std::thread::spawn(move || {
        // `recv` blocca finché non c'è **almeno** un evento: è l'unico punto in
        // cui questo thread dorme, e non consuma niente mentre il vault è fermo.
        while let Ok(first) = rx.recv() {
            let mut burst = vec![first];
            // ...e poi si prende ciò che è già arrivato. `try_iter` finisce
            // quando la coda è vuota, quindi la raffica è **il ritardo**, non
            // una finestra scelta da noi.
            burst.extend(rx.try_iter());
            for notice in reduce(burst) {
                sink.emit(&notice);
            }
        }
    });
}

/// Le due riduzioni, in ordine: prima si raggruppa, poi — se ancora non basta —
/// si degrada.
fn reduce(burst: Vec<Notice>) -> Vec<Notice> {
    let grouped = coalesce(burst);
    if grouped.len() <= BURST_CEILING {
        return grouped;
    }
    degrade(grouped)
}

/// La chiave con cui due notice della stessa raffica sono **la stessa cosa
/// detta due volte**.
///
/// Solo quattro specie ce l'hanno, e nessuna delle quattro porta un fatto che le
/// altre copie non portino: `index-updated` non ha payload affatto, un
/// `document-changed` dice «rileggi questo» e due volte dice la stessa cosa, un
/// `view-invalidated` dice «ridisegna questa», e di un `job-progress` conta solo
/// **dove il job è arrivato** — venti passi avanti in un giro sono un passo
/// avanti (§10.3). Tutto il resto — rimozioni, rename, lotti, custom, avvii ed
/// esiti di job — resta uno per uno: sono **fatti distinti**, e fonderli vorrebbe
/// dire raccontare una storia diversa da quella che è successa.
#[derive(PartialEq, Eq, Hash)]
enum Grain {
    Index,
    Changed(DocId),
    View(String, Option<String>),
    /// Il progresso **di un job**: la grana è l'id, o due job che camminano
    /// insieme si mangerebbero i passi a vicenda.
    Progress(u64),
}

fn grain(event: &Event) -> Option<Grain> {
    match event {
        Event::IndexUpdated => Some(Grain::Index),
        Event::DocumentChanged { id } => Some(Grain::Changed(id.clone())),
        Event::ViewInvalidated { view, instance } => {
            Some(Grain::View(view.clone(), instance.clone()))
        }
        Event::JobProgress { id, .. } => Some(Grain::Progress(id.0)),
        _ => None,
    }
}

/// Dentro una raffica, ciò che dice due volte la stessa cosa la dice una.
///
/// **Si tiene l'ultima occorrenza, non la prima**, e non è un dettaglio: la
/// sequenza `changed(a)`, `removed(a)`, `changed(a)` è una nota riscritta,
/// cancellata e ricreata, e tenere la prima la racconterebbe al contrario —
/// chi riceve rileggerebbe *prima* di sapere che il file era sparito. Tenere
/// l'ultima e conservare l'**ordine relativo** di ciò che resta racconta la
/// stessa storia con meno parole.
///
/// L'unica assorbenza è quella che il contratto dichiara: un
/// `view-invalidated` senza `instance` vuol dire **tutte** le istanze di quella
/// view, quindi quelli che ne nominano una sola, nella stessa raffica, sono già
/// compresi.
fn coalesce(burst: Vec<Notice>) -> Vec<Notice> {
    let tutte: HashSet<String> = burst
        .iter()
        .filter_map(|n| match &n.event {
            Event::ViewInvalidated {
                view,
                instance: None,
            } => Some(view.clone()),
            _ => None,
        })
        .collect();
    let assorbito = |event: &Event| {
        matches!(
            event,
            Event::ViewInvalidated { view, instance: Some(_) } if tutte.contains(view)
        )
    };

    let mut visti: HashSet<Grain> = HashSet::new();
    let mut tenuti: Vec<Notice> = Vec::with_capacity(burst.len());
    // A rovescio, tenendo il primo che si incontra di ogni grana: è «l'ultimo»
    // letto nel verso giusto.
    for notice in burst.into_iter().rev() {
        if assorbito(&notice.event) {
            continue;
        }
        if let Some(g) = grain(&notice.event) {
            if !visti.insert(g) {
                continue;
            }
        }
        tenuti.push(notice);
    }
    tenuti.reverse();
    tenuti
}

/// Sopra il tetto: ciò che si riscopre riguardando il vault diventa **un**
/// invito a riconciliare, e ciò che non si riscopre passa al proprio posto.
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
fn degrade(burst: Vec<Notice>) -> Vec<Notice> {
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

/// Quanti eventi di ogni specie ci sono in una raffica: serve solo ai test, e
/// sta qui perché è la lettura con cui si controlla una riduzione.
#[cfg(test)]
fn per_specie(notices: &[Notice]) -> std::collections::HashMap<String, usize> {
    let mut out = std::collections::HashMap::new();
    for n in notices {
        *out.entry(format!("{:?}", n.kind())).or_insert(0) += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use fubmd_abi::traits::JobId;

    fn cambiato(id: &str) -> Notice {
        Notice::of(Event::DocumentChanged { id: DocId::new(id) })
    }

    #[test]
    fn a_burst_says_once_what_it_said_a_hundred_times() {
        let mut burst: Vec<Notice> = Vec::new();
        for _ in 0..100 {
            burst.push(cambiato("Alpha.md"));
            burst.push(Notice::of(Event::IndexUpdated));
        }
        let out = reduce(burst);
        assert_eq!(out.len(), 2, "duecento messaggi per due fatti: {out:?}");
        let specie = per_specie(&out);
        assert_eq!(specie.get("DocumentChanged"), Some(&1));
        assert_eq!(specie.get("IndexUpdated"), Some(&1));
    }

    #[test]
    fn the_last_one_wins_so_the_story_stays_in_order() {
        // Riscritta, cancellata, ricreata: tenere la **prima** occorrenza
        // farebbe rileggere il documento prima di sapere che era sparito.
        let out = reduce(vec![
            cambiato("Alpha.md"),
            Notice::of(Event::DocumentRemoved {
                id: DocId::new("Alpha.md"),
            }),
            cambiato("Alpha.md"),
        ]);
        let specie: Vec<String> = out.iter().map(|n| format!("{:?}", n.kind())).collect();
        assert_eq!(specie, vec!["DocumentRemoved", "DocumentChanged"]);
    }

    #[test]
    fn all_the_instances_absorb_the_single_ones() {
        let out = reduce(vec![
            Notice::of(Event::ViewInvalidated {
                view: "tags".into(),
                instance: Some("tags#2".into()),
            }),
            Notice::of(Event::ViewInvalidated {
                view: "tags".into(),
                instance: None,
            }),
            Notice::of(Event::ViewInvalidated {
                view: "tags".into(),
                instance: Some("tags#3".into()),
            }),
            // Un'altra view non c'entra niente e resta.
            Notice::of(Event::ViewInvalidated {
                view: "outline".into(),
                instance: Some("outline#1".into()),
            }),
        ]);
        assert_eq!(out.len(), 2, "{out:?}");
        assert!(matches!(
            &out[0].event,
            Event::ViewInvalidated { view, instance: None } if view == "tags"
        ));
    }

    /// Il canale più fitto del contratto (§10.3): mille passi di due job
    /// diventano **due**, l'ultimo di ciascuno, e l'avvio non si fonde con
    /// niente.
    #[test]
    fn a_job_walking_says_where_it_got_to_not_every_step() {
        let passo = |id: u64, done: u64| {
            Notice::of(Event::JobProgress {
                id: JobId(id),
                progress: fubmd_abi::traits::JobProgress {
                    done,
                    total: Some(500),
                    label: None,
                },
            })
        };
        let mut burst = vec![Notice::of(Event::JobStarted {
            id: JobId(1),
            job: "export".into(),
        })];
        for n in 0..500 {
            burst.push(passo(1, n));
            burst.push(passo(2, n));
        }

        let out = reduce(burst);
        assert_eq!(out.len(), 3, "l'avvio e l'ultimo passo di ognuno: {out:?}");
        assert!(matches!(out[0].event, Event::JobStarted { .. }));
        // I due job non si mangiano i passi a vicenda, e di ognuno resta dove è
        // arrivato davvero.
        for (n, atteso) in [(1, JobId(1)), (2, JobId(2))] {
            assert!(
                matches!(&out[n].event, Event::JobProgress { id, progress }
                    if *id == atteso && progress.done == 499),
                "{:?}",
                out[n].event
            );
        }
    }

    #[test]
    fn distinct_facts_are_not_merged() {
        // Due documenti diversi sono due fatti; due custom pure, anche con lo
        // stesso topic — il payload è di chi lo manda.
        let out = reduce(vec![
            cambiato("Alpha.md"),
            cambiato("Beta.md"),
            Notice::of(Event::Custom {
                topic: "acme:x".into(),
                payload: serde_json::json!(1),
            }),
            Notice::of(Event::Custom {
                topic: "acme:x".into(),
                payload: serde_json::json!(2),
            }),
        ]);
        assert_eq!(out.len(), 4, "{out:?}");
    }

    #[test]
    fn over_the_ceiling_it_says_reconcile_and_keeps_what_nobody_can_rediscover() {
        let mut burst: Vec<Notice> = (0..BURST_CEILING * 3)
            .map(|n| cambiato(&format!("nota-{n}.md")))
            .collect();
        let esito = Notice::of(Event::JobDone {
            id: JobId(7),
            job: "export".into(),
            result: Ok(serde_json::Value::Null),
        });
        burst.insert(0, esito);
        burst.push(Notice::of(Event::VaultClosed {
            root: "/vault".into(),
        }));

        let out = reduce(burst);
        assert_eq!(
            out.len(),
            3,
            "l'esito del job, un invito a riconciliare, la chiusura: {out:?}"
        );
        assert!(matches!(out[0].event, Event::JobDone { .. }));
        assert!(
            matches!(out[1].event, Event::Overflow { dropped } if dropped == (BURST_CEILING * 3) as u64)
        );
        assert!(
            matches!(out[2].event, Event::VaultClosed { .. }),
            "l'invito a riconciliare sta DOVE stava ciò che sostituisce: dopo la \
             chiusura direbbe di rileggere un vault che non c'è più"
        );
    }

    #[test]
    fn two_reconciles_in_a_row_are_one() {
        let mut burst: Vec<Notice> = vec![Notice::of(Event::Overflow { dropped: 40 })];
        burst.extend((0..BURST_CEILING * 2).map(|n| cambiato(&format!("nota-{n}.md"))));
        let out = reduce(burst);
        assert_eq!(out.len(), 1, "{out:?}");
        assert!(
            matches!(out[0].event, Event::Overflow { dropped } if dropped == 40 + (BURST_CEILING * 2) as u64)
        );
    }

    #[test]
    fn under_the_ceiling_nothing_is_thrown_away() {
        let burst: Vec<Notice> = (0..BURST_CEILING)
            .map(|n| cambiato(&format!("nota-{n}.md")))
            .collect();
        let out = reduce(burst);
        assert_eq!(out.len(), BURST_CEILING);
        assert!(out
            .iter()
            .all(|n| !matches!(n.event, Event::Overflow { .. })));
    }
}
