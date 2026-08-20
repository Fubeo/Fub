//! **Quando un componente parla senza che gli si parli.**
//!
//! `host-events` è la famiglia con cui un plugin dice qualcosa di propria
//! iniziativa: `emit` per un avviso, `report_progress` per un lavoro lungo,
//! `spawn_job` per chiederne un altro. Al primo passo di M5 non era linkata, e
//! la 0164 lo dichiara: «un componente parla quando gli si parla». Questo
//! modulo è dove smette di essere vero.
//!
//! Sta separato da `guest.rs` perché è l'unica famiglia in cui la chiamata va
//! nel verso opposto a tutte le altre — dal guest verso l'host **mentre**
//! l'host lo sta chiamando — e quel verso ha regole sue.
//!
//! # La rientranza, e perché oggi non si chiude su sé stessa
//!
//! Le tre funzioni girano **dentro** [`crate::borrow::with_guest`], cioè con
//! il `Mutex` dell'istanza già in mano a chi ci ha chiamati
//! ([`WasmPlugin::chiamata`](crate::WasmPlugin)). Un `Mutex` di `std` non è
//! rientrante: qualunque strada che da qui tornasse *nella stessa istanza* non
//! sarebbe una ricorsione, sarebbe un blocco definitivo. Le tre strade sono
//! state percorse una per una, e questo è ciò che si è trovato.
//!
//! * `spawn_job` **accoda e non esegue**: `Workspace::enqueue_job` mette la
//!   richiesta nella coda del dispatcher, suona il campanello e torna con
//!   l'identità. Il corpo del job lo prenderà un thread del pool più tardi, e
//!   se è dello stesso plugin quel thread aspetterà il `Mutex` — un'attesa, non
//!   un blocco, perché chi lo tiene lo lascia tornando da `run-job` e non
//!   aspetta niente da chi ha lanciato. È la ragione per cui la firma è una
//!   *richiesta* e non una chiamata: quel che il lanciatore non può dare è il
//!   tempo. Che sia davvero così si vede dal banco e non solo dal codice: in
//!   `un_componente_che_parla` il `job-started` del figlio arriva **prima** del
//!   `job-done` del padre, cioè il lavoro è stato accettato mentre il padre
//!   teneva ancora l'istanza, e il corpo è girato dopo. L'ordine inverso
//!   sarebbe il primo segno che qualcuno ha cominciato a eseguire lì dentro.
//! * `emit` finisce in `Dispatcher::emit`, che scrive sul bus e **accoda** agli
//!   handler senza drenare. Nessun codice di terzi gira dentro la nostra
//!   chiamata.
//! * `report_progress` è l'unica delle tre che drena: `note_job_progress`
//!   chiama `dispatch_pending()`, cioè consegna agli `EventHandler` registrati
//!   **prima** di tornare. Oggi non c'è modo che uno di quelli sia servito da
//!   questa istanza: `WasmBundle::register` registra i comandi del componente e
//!   nient'altro, e un `CommandProvider` non è un `EventHandler` — nessun
//!   handler di questa istanza sta nel registro, quindi il giro si chiude fuori
//!   da noi. È la casella da riguardare il giorno in cui un
//!   `EventHandler` attraverserà: quel giorno un job che si racconta
//!   sveglierebbe l'handler del proprio plugin passando dal `Mutex` che il job
//!   sta tenendo. Il posto in cui difendersi non è questo modulo — è il
//!   `Mutex`, che dovrà saper dire «sono già dentro» con un `plugin-error`
//!   invece di fermarsi, come `trappable_imports` spento dice ogni altro
//!   rifiuto.
//!
//! # Chi può cosa non si decide qui
//!
//! L'`HostApi` che arriva è già incappucciato dal `Guard` del kernel
//! (decisione 0021): `Capability::Events` è concessa senza permesso dichiarato,
//! e ciò che invece si nega — un topic di `custom` che è di un altro plugin, un
//! job su un vault che sta chiudendo — lo nega chi ha il registro davanti.
//! Rileggerlo di qua sarebbe il secondo punto di enforcement che quel verbale
//! esiste per non avere.
//! enforcement point that decision record exists not to have.

use fub_abi::event::{BatchId, DocChange, DocChanges, Event, Severity};
use fub_abi::gate::Gate;
use fub_abi::model::DocId;
use fub_abi::settings::SettingScope;
use fub_abi::traits::{EntryKind, JobId, JobProgress, JobSpec};
use fub_abi::PluginError;

use crate::contract::fub::abi::{
    errors as w_errors, events as w_events, host_events, jobs as w_jobs, model as w_model,
    settings as w_settings,
};
use crate::borrow::State;
use crate::translate as tr;

// ---------------------------------------------------------------------------
// host-events: le tre porte che si aprono dall'altra parte (§7.3)
// ---------------------------------------------------------------------------

impl host_events::Host for State {
    /// **Senza esito, e quindi senza modo di rifiutare**: il contratto dà
    /// `emit` come `func(event)` nudo, e la conseguenza è scritta nel WIT — un
    /// host che non la concede può solo non emettere, il silenzio è il no.
    ///
    /// Da qui i due silenzi di questo corpo. Senza host prestato non c'è
    /// nessun bus su cui emettere e non c'è dove dirlo: si tace, che è la
    /// stessa risposta che il componente riceverebbe da un `Guard` che gli
    /// nega la famiglia. Ma un evento **perso perché noi non lo sappiamo
    /// tradurre** è un'altra cosa, e tacere lì vorrebbe dire perdere in
    /// silenzio: l'unico campo di questa famiglia che può non attraversare è il
    /// `payload` di un `custom`, che il contratto dà come stringa JSON e che un
    /// componente può riempire di spazzatura. Per quel caso il canale c'è già
    /// (decisione 0052) e ci passiamo: un `trouble` a nome del plugin, emesso
    /// dallo stesso host, che dice cosa non è uscito e perché.
    /// dallo stesso host, che dice cosa non è uscito e perché.
    /// dallo stesso host, che dice cosa non è uscito e perché.
    fn emit(&mut self, event: w_events::Event) {
        let Ok(guest) = self.guest() else {
            return;
        };
        match from_event(event) {
            Ok(event) => guest.emit(event),
            Err(why) => guest.emit(Event::Trouble {
                // Ciò che si è perso non si ricostruisce riaprendo il vault —
                // era il racconto di un componente, e non c'è nessun posto da
                // cui rileggerlo: per il criterio della 0048 è un `failure`.
                severity: Severity::Failure,
                subject: None,
                error: PluginError::BadArgs(
                    format!("event not emitted by a WASM component: {why}").into(),
                ),
                // Da quale porta il kernel stia chiamando il componente, di qui
                // non si sa: il prestito porta le capacità, non il varco da cui
                // sono entrate. Nominarne una a caso sarebbe una bugia in un
                // campo che esiste per non doverne dire.
                gate: None,
            }),
        }
    }

    /// **Accoda un lavoro, non lo esegue** — vedi la rientranza nel doc del
    /// modulo. L'identità torna subito; l'esito arriverà come `job-done`.
    ///
    /// L'unica traduzione che può fallire è il `payload`, e il rifiuto è
    /// `bad-args` e non `internal` per la ragione di `translate::from_json`: a
    /// scrivere quella stringa è stato il componente.
    /// scrivere quella stringa è stato il componente.
    /// scrivere quella stringa è stato il componente.
    fn spawn_job(&mut self, spec: w_jobs::JobSpec) -> Result<w_jobs::JobId, w_errors::PluginError> {
        let payload = tr::from_json(&spec.payload).map_err(|and| tr::to_error(&and))?;
        let guest = match self.guest() {
            Ok(h) => h,
            Err(and) => return Err(tr::to_error(&and)),
        };
        guest
            .spawn_job(JobSpec {
                job: spec.job,
                payload,
            })
            .map(|id| id.0)
            .map_err(|and| tr::to_error(&and))
    }

    /// **Il timbro del job, che il job non può mettersi da sé** (§10.3): l'id
    /// non è un parametro perché `run-job` non lo riceve, e chi ce l'ha è
    /// l'host che sta eseguendo. Di qua non c'è niente da aggiungere e niente
    /// da controllare: si passa il progresso a chi sa di chi è.
    ///
    /// Senza esito come `emit`, e per la stessa ragione anche fuori da un job:
    /// il default del contratto è un no-op, quindi un componente che si
    /// racconta durante un `activate` non riceve un errore — non succede
    /// niente, ed è ciò che il trait dichiara.
    fn report_progress(&mut self, progress: w_jobs::JobProgress) {
        let Ok(guest) = self.guest() else {
            return;
        };
        guest.report_progress(from_progress(progress));
    }
}

// ---------------------------------------------------------------------------
// La traduzione che serve solo qui
// ---------------------------------------------------------------------------

/// L'evento che il componente vuole emettere.
///
/// Il `match` è **esaustivo di proposito**, come ogni conversione di
/// `translate`: una variante nuova nel WIT non compila finché qualcuno non ha
/// detto in che cosa diventa. Ed è esaustivo anche in un secondo senso, che
/// vale la pena dire: si traducono **tutte** e diciannove, comprese quelle che
/// un plugin non ha nessuna ragione di emettere (`vault-opened`,
/// `batch-ended`, `overflow`). Non è ingenuità — è la 0021 applicata al verso
/// di ritorno: se un giorno si dovrà decidere che un componente non può
/// firmarsi un `vault-closed`, quella decisione è del `Guard`, che ha davanti
/// il manifest e il registro; un filtro scritto qui sarebbe la stessa regola
/// detta due volte, e il primo giorno in cui le due divergono nessuno se ne
fn from_event(and: w_events::Event) -> Result<Event, PluginError> {
    use w_events::Event as W;
    Ok(match and {
        W::VaultOpened(and) => Event::VaultOpened { root: and.root },
        W::DocumentChanged(and) => Event::DocumentChanged {
            id: DocId::new(and.id),
            changes: and.changes.map(from_changes),
        },
        W::DocumentRemoved(and) => Event::DocumentRemoved {
            id: DocId::new(and.id),
        },
        W::DocumentRenamed(and) => Event::DocumentRenamed {
            from: DocId::new(and.from),
            to: DocId::new(and.to),
        },
        W::IndexUpdated => Event::IndexUpdated,
        W::JobDone(and) => Event::JobDone {
            id: JobId(and.id),
            job: and.job,
            result: match and.result {
                Ok(json) => Ok(tr::from_json(&json)?),
                Err(error) => Err(tr::from_error(error)),
            },
        },
        W::Overflow(and) => Event::Overflow { dropped: and.dropped },
        W::Custom(and) => Event::Custom {
            topic: and.topic,
            payload: tr::from_json(&and.payload)?,
        },
        W::BatchEnded(and) => Event::BatchEnded {
            batch: BatchId(and.batch),
            changed: and.changed.into_iter().map(DocId::new).collect(),
        },
        W::ViewInvalidated(and) => Event::ViewInvalidated {
            view: and.view,
            instance: and.instance,
        },
        W::VaultClosed(and) => Event::VaultClosed { root: and.root },
        W::JobStarted(and) => Event::JobStarted {
            id: JobId(and.id),
            job: and.job,
        },
        W::JobProgress(and) => Event::JobProgress {
            id: JobId(and.id),
            progress: from_progress(and.progress),
        },
        W::SettingChanged(and) => Event::SettingChanged {
            key: and.key,
            scope: from_scope(and.scope),
        },
        W::EntryChanged(and) => Event::EntryChanged {
            id: DocId::new(and.id),
            kind: from_kind(and.kind),
        },
        W::EntryRemoved(and) => Event::EntryRemoved {
            id: DocId::new(and.id),
            kind: from_kind(and.kind),
        },
        W::EntryRenamed(and) => Event::EntryRenamed {
            from: DocId::new(and.from),
            to: DocId::new(and.to),
            kind: from_kind(and.kind),
        },
        W::Trouble(and) => Event::Trouble {
            severity: from_severity(and.severity),
            subject: and.subject.map(DocId::new),
            error: tr::from_error(and.error),
            gate: and.gate.map(from_gate),
        },
        W::TimerFired(and) => Event::TimerFired {
            owner: and.owner,
            timer: and.timer,
        },
    })
}

/// `total` assente resta assente: è *indeterminato*, che è un fatto — un
/// scaricamento senza `content-length` — e non un dato mancante da riempire con
/// uno zero che chi disegna leggerebbe come una barra piena all'inizio.
fn from_progress(p: w_jobs::JobProgress) -> JobProgress {
    JobProgress {
        done: p.done,
        total: p.total,
        label: p.label,
    }
}

/// `changes` assente vuol dire *non lo so* e passa qualunque filtro; presente e
/// vuoto è un fatto — niente è cambiato — e non passa. La differenza è di chi
/// filtra: qui basta non confonderle, cioè non fabbricare un record vuoto al
/// posto di un `None`.
fn from_changes(c: w_events::DocChanges) -> DocChanges {
    DocChanges {
        aspects: c.aspects.into_iter().map(from_aspect).collect(),
        properties: c.properties,
        tags_added: c.tags_added,
        tags_removed: c.tags_removed,
    }
}

fn from_aspect(a: w_events::DocChange) -> DocChange {
    match a {
        w_events::DocChange::Body => DocChange::Body,
        w_events::DocChange::Frontmatter => DocChange::Frontmatter,
        w_events::DocChange::Tags => DocChange::Tags,
        w_events::DocChange::Links => DocChange::Links,
        w_events::DocChange::Outline => DocChange::Outline,
        w_events::DocChange::Anchors => DocChange::Anchors,
    }
}

fn from_kind(k: w_model::EntryKind) -> EntryKind {
    match k {
        w_model::EntryKind::Document => EntryKind::Document,
        w_model::EntryKind::Asset => EntryKind::Asset,
        w_model::EntryKind::Unknown => EntryKind::Unknown,
    }
}

fn from_scope(s: w_settings::SettingScope) -> SettingScope {
    match s {
        w_settings::SettingScope::Vault => SettingScope::Vault,
        w_settings::SettingScope::Machine => SettingScope::Machine,
    }
}

fn from_severity(s: w_events::Severity) -> Severity {
    match s {
        w_events::Severity::Warning => Severity::Warning,
        w_events::Severity::Failure => Severity::Failure,
    }
}

/// Le porte del panico (§17.3): l'elenco è chiuso e l'ordine è quello della
/// dichiarazione nei due file. Un componente che nomina una porta sta
/// raccontando un guasto **suo**, non uno che il kernel ha visto entrare — e il
/// campo resta lo stesso, perché la porta è il luogo e non chi lo attraversa.
/// campo resta lo stesso, perché la porta è il luogo e non chi lo attraversa.
fn from_gate(g: w_events::Gate) -> Gate {
    match g {
        w_events::Gate::Command => Gate::Command,
        w_events::Gate::ViewRender => Gate::ViewRender,
        w_events::Gate::ViewAction => Gate::ViewAction,
        w_events::Gate::Service => Gate::Service,
        w_events::Gate::Event => Gate::Event,
        w_events::Gate::IndexFeed => Gate::IndexFeed,
        w_events::Gate::IndexForget => Gate::IndexForget,
        w_events::Gate::IndexUpToDate => Gate::IndexUpToDate,
        w_events::Gate::IndexReconcile => Gate::IndexReconcile,
        w_events::Gate::FormatParse => Gate::FormatParse,
        w_events::Gate::SyntaxRule => Gate::SyntaxRule,
        w_events::Gate::CustomRender => Gate::CustomRender,
        w_events::Gate::Job => Gate::Job,
    }
}
