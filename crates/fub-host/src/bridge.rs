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
//! Nessuna delle due riduzioni inventa una classificazione, e la seconda non
//! inventa nemmeno la riduzione: cosa sia sacrificabile lo dice il contratto
//! ([`Event::is_recoverable`]) e cosa farne lo dice sempre lui
//! ([`fub_abi::rules::events::degrade`]), perché i freni che se lo chiedono
//! sono **tre** e il terzo — il budget del dispatch — rispondeva da sé (§20.5).

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use fub_abi::event::{Actor, Origin};
use fub_abi::model::DocId;
use fub_abi::rules::events::degrade;
use fub_abi::{Event, Notice};
use fub_kernel::Subscription;

use crate::session::{Delivery, EventSink};

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
        // Quanti notice l'uscita non ha preso, e nessuno ha ancora saputo. Il
        // conto sta **qui** e non dentro i sink: le uscite sono più d'una — il
        // webview, un giorno le SSE di un'API locale — e questo è il punto da
        // cui passano tutte.
        let mut debt = 0u64;
        // `recv` blocca finché non c'è **almeno** un evento: è l'unico punto in
        // cui questo thread dorme, e non consuma niente mentre il vault è fermo.
        while let Ok(first) = rx.recv() {
            let mut burst = vec![first];
            // ...e poi si prende ciò che è già arrivato. `try_iter` finisce
            // quando la coda è vuota, quindi la raffica è **il ritardo**, non
            // una finestra scelta da noi.
            burst.extend(rx.try_iter());
            for notice in reduce(burst) {
                debt = delivers(&*sink, &notice, debt);
            }
        }
        // **E qui il ponte finisce**, che prima non lo diceva nessuno.
        //
        // L'unica uscita da quel ciclo è un `RecvError`, cioè il bus caduto,
        // cioè il vault chiuso: da questo istante niente arriverà più al
        // webview, e per chi legge un log senza questa riga la differenza fra
        // «il vault è stato chiuso» e «il ponte è morto e l'app è ferma» non
        // esiste. Il debito residuo esce con lui perché è l'unico momento in cui
        // si sa che non sarà pagato: quegli eventi non li riconcilierà nessuno.
        if debt > 0 {
            tracing::error!(
                target: "fub.host",
                debt,
                "il ponte degli eventi ha chiuso con un debito: l'uscita non ha \
                 mai ripreso a consegnare, e chi riceve è rimasto indietro senza \
                 saperlo"
            );
        } else {
            tracing::debug!(
                target: "fub.host",
                "il ponte degli eventi ha chiuso: il bus non c'è più, il vault è chiuso"
            );
        }
    });
}

/// Consegna un notice **pagando prima il debito**, e rende il debito che resta.
///
/// È `Subscriber::deliver` del bus visto dall'altro capo del ponte, e la forma è
/// la stessa per la stessa ragione: l'`Overflow` viene **prima** di ciò che lo
/// ha sbloccato, perché è l'ordine in cui le due cose sono successe — «hai perso
/// N» e poi il fatto nuovo. Non c'è un tipo condiviso col bus e non lo si è
/// costruito: là il conto è di un canale e la porta è `mod intake`, qui è di un
/// thread e la porta è questa funzione. Ciò che si eredita è la regola — *una
/// consegna persa ha già la sua parola* — non il tipo.
///
/// Se nemmeno l'`Overflow` esce, il fatto nuovo **non si prova nemmeno**: il
/// debito cresce di uno e si riproverà al prossimo. Consegnarlo scavalcando un
/// «riconcilia» non consegnato vorrebbe dire raccontare un vault che non è
/// quello che chi riceve ha in mano.
fn delivers(sink: &dyn EventSink, notice: &Notice, debt: u64) -> u64 {
    if debt > 0 {
        let backlog = Notice::new(
            Event::Overflow { dropped: debt },
            Origin::by(Actor::Kernel),
        );
        if sink.emit(&backlog) == Delivery::Dropped {
            return debt + 1;
        }
    }
    match sink.emit(notice) {
        Delivery::Done => 0,
        Delivery::Dropped => 1,
    }
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
#[derive(Clone, PartialEq, Eq, Hash)]
enum Grain {
    Index,
    Changed(DocId),
    View(String, Option<String>),
    /// Il progresso **di un job**: la grana è l'id, o due job che camminano
    /// insieme si mangerebbero i passi a vicenda.
    Progress(u64),
}

/// Porta dentro `tenuto` ciò che `scartato` diceva e lui non dice.
///
/// Riguarda la sola specie che un fatto ce l'ha: un `document-changed`. Per le
/// altre tre grane la frase del doc qui sopra resta vera alla lettera — due
/// copie dicono la stessa cosa — e non c'è niente da portare dietro.
///
/// `None` vince su `Some`: se di una delle due copie non si sa cosa è cambiato,
/// dell'unione non si sa niente, e dirlo è l'unico modo di non far filtrare via
/// un evento su un diff che non è quello vero.
fn merge(held: &mut Event, discarded: Event) {
    let (Event::DocumentChanged { changes: here, .. }, Event::DocumentChanged { changes: the, .. }) =
        (held, discarded)
    else {
        return;
    };
    match (here.as_mut(), the) {
        (Some(here), Some(the)) => here.merge(the),
        _ => *here = None,
    }
}

fn grain(event: &Event) -> Option<Grain> {
    match event {
        Event::IndexUpdated => Some(Grain::Index),
        Event::DocumentChanged { id, .. } => Some(Grain::Changed(id.clone())),
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
///
/// **Un `document-changed` però non si butta: si fonde.** Dalla decisione 0069
/// porta il *cosa* ([`DocChanges`]), e due copie della stessa nota nella stessa
/// raffica dicono due cose diverse — la prima può aver cambiato un tag e la
/// seconda una proprietà. Tenere l'ultima e basta farebbe perdere metà del
/// racconto in silenzio, e lo farebbe perdere **solo** a chi si è abbonato
/// stretto, cioè a chi ha fatto la cosa giusta. È lo stesso argomento con cui la
/// decisione 0033 lascia passare ciò che non nomina nessun documento.
fn coalesce(burst: Vec<Notice>) -> Vec<Notice> {
    let all: HashSet<String> = burst
        .iter()
        .filter_map(|n| match &n.event {
            Event::ViewInvalidated {
                view,
                instance: None,
            } => Some(view.clone()),
            _ => None,
        })
        .collect();
    let absorbed = |event: &Event| {
        matches!(
            event,
            Event::ViewInvalidated { view, instance: Some(_) } if all.contains(view)
        )
    };

    let mut seen: HashMap<Grain, usize> = HashMap::new();
    let mut kept: Vec<Notice> = Vec::with_capacity(burst.len());
    // A rovescio, tenendo il primo che si incontra di ogni grana: è «l'ultimo»
    // letto nel verso giusto.
    for notice in burst.into_iter().rev() {
        if absorbed(&notice.event) {
            continue;
        }
        if let Some(g) = grain(&notice.event) {
            if let Some(&position) = seen.get(&g) {
                merge(&mut kept[position].event, notice.event);
                continue;
            }
            seen.insert(g, kept.len());
        }
        kept.push(notice);
    }
    kept.reverse();
    kept
}

/// Sopra il tetto la riduzione non è più del ponte: è la regola del contratto
/// ([`fub_abi::rules::events::degrade`]), la stessa che il budget del dispatch
/// applica quando tronca (§20.5). Qui resta il **quando** — cioè il tetto —
/// perché quello sì è del ponte: misura quante consegne separate valga la pena
/// di fare verso *questo* consumatore.
/// Quanti eventi di ogni specie ci sono in una raffica: serve solo ai test, e
/// sta qui perché è la lettura con cui si controlla una riduzione.
#[cfg(test)]
fn by_kind(notices: &[Notice]) -> std::collections::HashMap<String, usize> {
    let mut out = std::collections::HashMap::new();
    for n in notices {
        *out.entry(format!("{:?}", n.kind())).or_insert(0) += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::event::{DocChange, DocChanges};
    use fub_abi::traits::JobId;

    fn changed(id: &str) -> Notice {
        Notice::of(Event::DocumentChanged {
            id: DocId::new(id),
            changes: None,
        })
    }

    /// Lo stesso, ma con un diff dichiarato: serve alle prove che il
    /// raggruppamento **fonde** invece di buttare (decisione 0069).
    fn changed_with(id: &str, aspect: DocChange) -> Notice {
        Notice::of(Event::DocumentChanged {
            id: DocId::new(id),
            changes: Some(DocChanges {
                aspects: vec![aspect],
                ..DocChanges::default()
            }),
        })
    }

    /// Un'uscita che ha un interruttore: dice di sì o di no a comando, e
    /// registra ciò che le è passato. È l'`AppHandle` che non c'è ancora, e
    /// l'`emit` che torna con un errore, senza Tauri in mezzo.
    ///
    /// Registra con degli atomici e non con un `Vec` sotto lucchetto perché un
    /// lucchetto nudo qui dentro è la seconda risposta alla domanda della
    /// [decisione 0120] — `tests/un_lucchetto_solo.rs` lo dice, e conta anche i
    /// banchi. Ciò che serve provare sono due numeri e una posizione, e quelli
    /// si contano senza chiedere niente a nessuno.
    ///
    /// [decisione 0120]: ../../../docs/decisions/0120-un-lucchetto-avvelenato-si-dice-una-volta.md
    struct Exit {
        open: std::sync::atomic::AtomicBool,
        /// Quanti notice sono usciti davvero.
        seen: std::sync::atomic::AtomicUsize,
        /// In che posizione è uscito l'`Overflow`, e quanto valeva: [`NO_OVERFLOW`]
        /// finché non ne esce uno.
        overflow_at: std::sync::atomic::AtomicU64,
        overflow_for: std::sync::atomic::AtomicU64,
    }

    /// «Non è ancora successo», per i due conti dell'[`Uscita`].
    const NO_OVERFLOW: u64 = u64::MAX;

    impl Default for Exit {
        fn default() -> Self {
            use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize};
            Exit {
                open: AtomicBool::new(false),
                seen: AtomicUsize::new(0),
                overflow_at: AtomicU64::new(NO_OVERFLOW),
                overflow_for: AtomicU64::new(NO_OVERFLOW),
            }
        }
    }

    impl crate::session::EventSink for Exit {
        fn emit(&self, notice: &Notice) -> Delivery {
            use std::sync::atomic::Ordering::Relaxed;
            if !self.open.load(Relaxed) {
                return Delivery::Dropped;
            }
            let position = self.seen.fetch_add(1, Relaxed);
            if let Event::Overflow { dropped } = notice.event {
                self.overflow_at.store(position as u64, Relaxed);
                self.overflow_for.store(dropped, Relaxed);
            }
            Delivery::Done
        }
    }

    /// **Ciò che non è uscito si dice appena l'uscita si apre.**
    ///
    /// Le due strade per cui il webview non prende un evento — non c'è ancora,
    /// e la consegna torna con un errore — erano scritte tutte e due come
    /// niente: un `if let` senza `else` e un `let _ =`. Ciò che l'utente vedeva
    /// era una shell ferma su uno stato vecchio, e nessuno diceva perché.
    #[test]
    fn that_that_the_exit_not_has_taken_becomes_a_overflow_just_reopens() {
        use std::sync::atomic::Ordering::Relaxed;
        let output = Exit::default();

        // Chiusa: tre fatti non escono, e il debito li conta.
        let mut debt = 0;
        for id in ["a.md", "b.md", "c.md"] {
            debt = delivers(&output, &changed(id), debt);
        }
        assert_eq!(debt, 3, "il debito conta ciò che non è uscito");
        assert_eq!(output.seen.load(Relaxed), 0, "e niente è uscito");

        // Si apre: il primo fatto nuovo arriva **preceduto** dal conto.
        output.open.store(true, Relaxed);
        debt = delivers(&output, &changed("d.md"), debt);
        assert_eq!(debt, 0, "pagato");
        assert_eq!(
            output.overflow_for.load(Relaxed),
            3,
            "chi riceve non sa di essere indietro di tre fatti: resta su uno stato \
             vecchio e nessuno gli dice di riconciliare"
        );
        assert_eq!(
            output.overflow_at.load(Relaxed),
            0,
            "e il conto arriva **prima** del fatto nuovo, che è l'ordine in cui le \
             due cose sono successe"
        );
        assert_eq!(output.seen.load(Relaxed), 2, "il conto, e poi il fatto");
    }

    /// **Un guasto non si raggruppa, e non si perde in una raffica** (§20.2).
    ///
    /// La raffica coalizza ciò di cui N copie dicono quanto una — un documento
    /// riscritto cento volte è un documento cambiato — e un guasto non è di
    /// quella specie: due guasti sono due fatti, e uno solo in mezzo a cento
    /// eventi rumorosi è precisamente il caso in cui l'utente deve saperlo. È
    /// l'ultimo anello del percorso: kernel → bus → **ponte** → centro
    /// notifiche.
    #[test]
    fn a_fault_crosses_the_bridge_also_inside_a_burst() {
        let failure = |m: &str| {
            Notice::of(Event::Trouble {
                severity: fub_abi::Severity::Warning,
                subject: Some(DocId::new("Alpha.md")),
                error: fub_abi::PluginError::Internal(m.into()),
                gate: None,
            })
        };
        let mut burst: Vec<Notice> = Vec::new();
        for _ in 0..50 {
            burst.push(changed("Alpha.md"));
        }
        burst.push(failure("indice non allineato"));
        burst.push(failure("flush fallito"));

        let out = reduce(burst);
        let troubles: Vec<&Notice> = out
            .iter()
            .filter(|n| matches!(n.event, Event::Trouble { .. }))
            .collect();
        assert_eq!(
            troubles.len(),
            2,
            "i due guasti sono due fatti e devono passare tutti e due: {out:?}"
        );
    }

    /// **Raggruppare non deve perdere il *cosa*** (§22.2, decisione 0069).
    ///
    /// Prima di quella decisione due `document-changed` della stessa nota
    /// dicevano la stessa cosa due volte, e tenere l'ultima era gratis. Adesso
    /// portano un diff, e la prima può aver cambiato un tag dove la seconda ha
    /// cambiato una proprietà: buttarla vorrebbe dire far perdere un risveglio
    /// a chi si è abbonato ai tag — cioè a chi ha ristretto il proprio
    /// interesse, che è lo stesso danno che la 0033 ha evitato lasciando
    /// passare ciò che non nomina nessun documento.
    #[test]
    fn grouping_two_changes_of_the_same_notes_keeps_both_stories() {
        let out = reduce(vec![
            changed_with("Alpha.md", DocChange::Tags),
            changed_with("Alpha.md", DocChange::Frontmatter),
        ]);
        assert_eq!(out.len(), 1, "restano una: {out:?}");
        let Event::DocumentChanged { changes, .. } = &out[0].event else {
            panic!("non è un document-changed: {out:?}");
        };
        let changes = changes.as_ref().expect("il diff c'è");
        assert!(
            changes.aspects.contains(&DocChange::Tags)
                && changes.aspects.contains(&DocChange::Frontmatter),
            "l'unione dei due, non l'ultimo: {changes:?}"
        );
    }

    /// E se di **una** delle due copie non si sa cosa è cambiato, dell'unione
    /// non si sa niente: dirlo è l'unico modo di non far filtrare via un evento
    /// su un diff che non è quello vero.
    #[test]
    fn grouping_with_an_unknown_diff_makes_the_whole_thing_unknown() {
        for burst in [
            vec![
                changed("Alpha.md"),
                changed_with("Alpha.md", DocChange::Tags),
            ],
            vec![
                changed_with("Alpha.md", DocChange::Tags),
                changed("Alpha.md"),
            ],
        ] {
            let out = reduce(burst);
            let Event::DocumentChanged { changes, .. } = &out[0].event else {
                panic!("non è un document-changed: {out:?}");
            };
            assert!(changes.is_none(), "doveva restare *non lo so*: {changes:?}");
        }
    }

    #[test]
    fn a_burst_says_once_what_it_said_a_hundred_times() {
        let mut burst: Vec<Notice> = Vec::new();
        for _ in 0..100 {
            burst.push(changed("Alpha.md"));
            burst.push(Notice::of(Event::IndexUpdated));
        }
        let out = reduce(burst);
        assert_eq!(out.len(), 2, "duecento messaggi per due fatti: {out:?}");
        let kind = by_kind(&out);
        assert_eq!(kind.get("DocumentChanged"), Some(&1));
        assert_eq!(kind.get("IndexUpdated"), Some(&1));
    }

    #[test]
    fn the_last_one_wins_so_the_story_stays_in_order() {
        // Riscritta, cancellata, ricreata: tenere la **prima** occorrenza
        // farebbe rileggere il documento prima di sapere che era sparito.
        let out = reduce(vec![
            changed("Alpha.md"),
            Notice::of(Event::DocumentRemoved {
                id: DocId::new("Alpha.md"),
            }),
            changed("Alpha.md"),
        ]);
        let kind: Vec<String> = out.iter().map(|n| format!("{:?}", n.kind())).collect();
        assert_eq!(kind, vec!["DocumentRemoved", "DocumentChanged"]);
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
        let step = |id: u64, done: u64| {
            Notice::of(Event::JobProgress {
                id: JobId(id),
                progress: fub_abi::traits::JobProgress {
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
            burst.push(step(1, n));
            burst.push(step(2, n));
        }

        let out = reduce(burst);
        assert_eq!(out.len(), 3, "l'avvio e l'ultimo passo di ognuno: {out:?}");
        assert!(matches!(out[0].event, Event::JobStarted { .. }));
        // I due job non si mangiano i passi a vicenda, e di ognuno resta dove è
        // arrivato davvero.
        for (n, expected) in [(1, JobId(1)), (2, JobId(2))] {
            assert!(
                matches!(&out[n].event, Event::JobProgress { id, progress }
                    if *id == expected && progress.done == 499),
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
            changed("Alpha.md"),
            changed("Beta.md"),
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
            .map(|n| changed(&format!("nota-{n}.md")))
            .collect();
        let outcome = Notice::of(Event::JobDone {
            id: JobId(7),
            job: "export".into(),
            result: Ok(serde_json::Value::Null),
        });
        burst.insert(0, outcome);
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
        burst.extend((0..BURST_CEILING * 2).map(|n| changed(&format!("nota-{n}.md"))));
        let out = reduce(burst);
        assert_eq!(out.len(), 1, "{out:?}");
        assert!(
            matches!(out[0].event, Event::Overflow { dropped } if dropped == 40 + (BURST_CEILING * 2) as u64)
        );
    }

    #[test]
    fn under_the_ceiling_nothing_is_thrown_away() {
        let burst: Vec<Notice> = (0..BURST_CEILING)
            .map(|n| changed(&format!("nota-{n}.md")))
            .collect();
        let out = reduce(burst);
        assert_eq!(out.len(), BURST_CEILING);
        assert!(out
            .iter()
            .all(|n| !matches!(n.event, Event::Overflow { .. })));
    }
}
