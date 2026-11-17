//! **Il notificatore dei promemoria**: con l'app aperta, la notifica del
//! sistema all'ora scritta nel `⏰` di un compito, e il clic che apre la nota.
//!
//! # Chi decide cosa
//!
//! Cosa è un promemoria e quando suona non si decide qui: l'indice è del
//! componente dei compiti (`fub_features::tasks::reminders`), la regola dello
//! sguardo pure ([`ReminderWatch`]), e il permesso è del `Guard` del vault
//! (`fub:notifications`, dichiarato da `fub.tasks`). Qui c'è solo ciò che il
//! kernel non può fare: un filo che si sveglia a ogni minuto, la notifica del
//! sistema (`notify-rust`, la stessa libreria che usa il plugin delle notifiche
//! di Tauri) e il clic, che diventa un `fub://open` come quello che arriva da
//! fuori, nella stessa coda.
//!
//! Il permesso si chiede **a ogni minuto**, come lo chiede il cancello: un
//! interruttore spento nelle impostazioni vale dalla notifica dopo. Spento, lo
//! sguardo va avanti lo stesso, così riaccendendolo non arriva la raffica di
//! ciò che è suonato nel frattempo: quei promemoria restano nella nota e
//! nell'elenco all'avvio.
//!
//! # Il sistema che rifiuta
//!
//! Un sistema senza servizio di notifiche (Linux senza un demone che risponda
//! su D-Bus), o con le notifiche negate a Fub, rende un errore da `show`: va
//! nel log, una riga per sguardo e non una per promemoria, e l'app non si
//! ferma. Il promemoria resta nella nota.
//!
//! # Quanti fili
//!
//! Il clic si aspetta su un filo per notifica, perché l'attesa di
//! `notify-rust` è bloccante. Una notifica che nessuno chiude può restare nel
//! centro notifiche per giorni: i fili in attesa sono al più
//! [`WAITING_MAX`], e oltre quel numero la notifica si mostra senza aspettare
//! il clic, che è meglio di nessuna notifica e di un filo per promemoria.

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use camino::Utf8PathBuf;
use fub_abi::rules::tasks::civil_minute;
use fub_abi::Locale;
use fub_host::reminders::{
    notification_more, notification_words, NotificationWords, ReminderEntry, ReminderList,
    ReminderWatch, RemindersQuery, WatchStep, TASKS_ID,
};
use fub_host::Host;
use fub_kernel::Capability;
use tauri::{AppHandle, Manager};

/// Quanti fili aspettano al più il clic su una notifica.
const WAITING_MAX: usize = 16;

/// Quante notifiche si mostrano al più in uno sguardo. Mille promemoria alla
/// stessa ora sono mille righe nell'elenco, non mille notifiche: oltre questo
/// numero se ne mostra una che dice quante ne restano.
const SHOWN_MAX: usize = 5;

/// L'azione del clic sul corpo della notifica, quella che D-Bus chiama
/// `default`.
const OPEN_ACTION: &str = "default";

/// Avvia il notificatore, su un filo suo. Una volta per processo.
pub(crate) fn start(app: &AppHandle) {
    prepare_platform(app);
    let app = app.clone();
    let waiting = Arc::new(AtomicUsize::new(0));
    let started = std::thread::Builder::new()
        .name("fub-promemoria".into())
        .spawn(move || watch_forever(&app, &waiting));
    if let Err(error) = started {
        tracing::warn!(target: "fub.app", %error, "notificatore dei promemoria non avviato");
    }
}

/// macOS e Windows vogliono sapere a nome di quale applicazione si notifica:
/// l'identificativo del bundle, o in sviluppo quello del terminale, perché un
/// binario non installato non ha un'identità registrata presso il sistema.
fn prepare_platform(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let identifier = if tauri::is_dev() {
            "com.apple.Terminal".to_string()
        } else {
            app.config().identifier.clone()
        };
        if let Err(error) = notify_rust::set_application(&identifier) {
            tracing::warn!(target: "fub.app", %error, "identità delle notifiche non impostata");
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

fn watch_forever(app: &AppHandle, waiting: &Arc<AtomicUsize>) {
    let mut watches: HashMap<Utf8PathBuf, ReminderWatch> = HashMap::new();
    loop {
        let host = app.state::<Host>();
        let open = host.vaults();
        // Un vault chiuso perde il suo sguardo: riaperto, ricomincia come
        // all'avvio, e ciò che è passato va nell'elenco.
        watches.retain(|root, _| open.contains(root));
        for root in open {
            let watch = watches.entry(root.clone()).or_default();
            look(app, &host, &root, watch, waiting);
        }
        std::thread::sleep(until_next_minute());
    }
}

/// Fino al prossimo minuto intero, più un margine: lo sguardo cade appena
/// dopo che l'ora del muro è cambiata, non appena prima.
fn until_next_minute() -> Duration {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Duration::from_millis(60_000 - millis % 60_000 + 250)
}

/// Uno sguardo su un vault: l'ora del muro, i promemoria arrivati, il permesso
/// e le notifiche.
fn look(
    app: &AppHandle,
    host: &Host,
    root: &Utf8PathBuf,
    watch: &mut ReminderWatch,
    waiting: &Arc<AtomicUsize>,
) {
    let vault = Some(root.as_str());
    let Ok((now, locale)) = host.vault_clock(vault) else {
        return;
    };
    let WatchStep::Ask { after, until } = watch.look(civil_minute(locale.utc_offset_minutes, now))
    else {
        return;
    };
    match host.component_allows(vault, TASKS_ID, Capability::Notifications) {
        Ok(true) => {}
        // Spento, o il componente dei compiti non c'è: lo sguardo è già
        // andato avanti, e non si notifica niente.
        Ok(false) | Err(_) => return,
    }
    let due = host
        .query_index(
            vault,
            RemindersQuery::between(Some(after), Some(until)).to_index_query(),
        )
        .and_then(ReminderList::from_index_result);
    let due = match due {
        Ok(list) => list,
        Err(error) => {
            tracing::warn!(target: "fub.app", %error, "promemoria non letti");
            return;
        }
    };
    if due.reminders.is_empty() {
        return;
    }
    let words = notification_words(&locale, fub_host::settings::CORE_DEFAULT_LOCALE);
    let mut refused = None;
    for planned in plan(&due, SHOWN_MAX) {
        let notice = planned.notice(root, &locale);
        if let Err(error) = show(app, &words, notice, waiting) {
            refused = Some(error);
        }
    }
    if let Some(error) = refused {
        tracing::warn!(target: "fub.app", %error, "il sistema ha rifiutato una notifica");
    }
}

/// Una notifica da mostrare: il testo, e la nota che il clic apre.
#[derive(Debug, PartialEq, Eq)]
struct Notice {
    body: String,
    link: Option<String>,
}

/// Le notifiche di uno sguardo: una per promemoria fino a `max`, e oltre una
/// sola che li conta, senza collegamento (l'elenco è nella vista dei compiti).
fn plan(due: &ReminderList, max: usize) -> Vec<NoticeOf<'_>> {
    let total = due.reminders.len();
    if total <= max && !due.more {
        return due.reminders.iter().map(NoticeOf::One).collect();
    }
    let mut out: Vec<NoticeOf<'_>> = due
        .reminders
        .iter()
        .take(max - 1)
        .map(NoticeOf::One)
        .collect();
    out.push(NoticeOf::More {
        count: total - (max - 1),
        more: due.more,
    });
    out
}

/// Una notifica pianificata, prima di avere il vault e le parole.
#[derive(Debug, PartialEq, Eq)]
enum NoticeOf<'a> {
    One(&'a ReminderEntry),
    /// `count` promemoria in più (e altri ancora se `more`).
    More {
        count: usize,
        more: bool,
    },
}

impl NoticeOf<'_> {
    fn notice(&self, root: &Utf8PathBuf, locale: &Locale) -> Notice {
        match self {
            NoticeOf::One(entry) => Notice {
                body: format!("{}\n{}", entry.text, note_name(entry.doc.as_str())),
                link: Some(open_link(root, entry)),
            },
            NoticeOf::More { count, more } => Notice {
                body: notification_more(
                    locale,
                    fub_host::settings::CORE_DEFAULT_LOCALE,
                    *count,
                    *more,
                ),
                link: None,
            },
        }
    }
}

/// Il nome della nota come lo si legge: senza cartelle e senza `.md`.
fn note_name(doc: &str) -> &str {
    let name = doc.rsplit('/').next().unwrap_or(doc);
    name.strip_suffix(".md").unwrap_or(name)
}

/// Il collegamento che il clic manda nella coda dei `fub://`: la nota del
/// compito nel suo vault, sulla sezione che lo contiene.
fn open_link(root: &Utf8PathBuf, entry: &ReminderEntry) -> String {
    let mut link = format!(
        "fub://open?vault={}&note={}",
        query_encode(root.as_str()),
        query_encode(entry.doc.as_str())
    );
    if let Some(heading) = &entry.heading {
        link.push_str("&heading=");
        link.push_str(&query_encode(heading));
    }
    link
}

/// Un valore dentro la query di un `fub://`: tutto ciò che non è una lettera,
/// una cifra, `-._~` o `/` diventa `%XX`, così `&`, `=`, `#` e `+` di un
/// nome di nota non spezzano il collegamento.
fn query_encode(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~' | b'/') {
            out.push(byte as char);
        } else {
            out.push('%');
            out.push(HEX[(byte >> 4) as usize] as char);
            out.push(HEX[(byte & 0x0f) as usize] as char);
        }
    }
    out
}

/// Mostra una notifica, e se ha un collegamento aspetta il clic su un filo
/// suo (al più [`WAITING_MAX`]).
fn show(
    app: &AppHandle,
    words: &NotificationWords,
    notice: Notice,
    waiting: &Arc<AtomicUsize>,
) -> Result<(), notify_rust::error::Error> {
    let mut notification = notify_rust::Notification::new();
    notification
        .summary(&words.title)
        .body(&notice.body)
        .appname("Fub");
    #[cfg(windows)]
    if !tauri::is_dev() {
        notification.app_id(&app.config().identifier);
    }
    let Some(link) = notice.link else {
        notification.show()?;
        return Ok(());
    };
    notification.action(OPEN_ACTION, &words.open);
    let handle = notification.show()?;
    if waiting.fetch_add(1, Ordering::SeqCst) >= WAITING_MAX {
        waiting.fetch_sub(1, Ordering::SeqCst);
        return Ok(());
    }
    let app = app.clone();
    let waiting_now = Arc::clone(waiting);
    let spawned = std::thread::Builder::new()
        .name("fub-promemoria-clic".into())
        .spawn(move || {
            handle.wait_for_action(|action| {
                if action != "__closed" {
                    crate::forward_uri(&app, &link);
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            });
            waiting_now.fetch_sub(1, Ordering::SeqCst);
        });
    if spawned.is_err() {
        waiting.fetch_sub(1, Ordering::SeqCst);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::model::DocId;

    fn entry(doc: &str, text: &str, heading: Option<&str>) -> ReminderEntry {
        ReminderEntry {
            doc: DocId::new(doc),
            at: 3,
            when: "2026-11-13 09:00".into(),
            text: text.into(),
            heading: heading.map(str::to_string),
        }
    }

    #[test]
    fn the_click_opens_the_note_of_the_task_on_its_section() {
        let root = Utf8PathBuf::from("/home/me/Il mio vault");
        let link = open_link(
            &root,
            &entry(
                "Lavoro/Riunioni & note #1.md",
                "Chiamare",
                Some("Oggi + domani"),
            ),
        );
        match crate::uri::handle_fub_uri(&link).expect("a valid fub:// link") {
            crate::uri::UriOutcome::Navigate {
                vault,
                note,
                heading,
                block,
                ..
            } => {
                assert_eq!(vault.as_deref(), Some("/home/me/Il mio vault"));
                assert_eq!(note.as_deref(), Some("Lavoro/Riunioni & note #1.md"));
                assert_eq!(heading.as_deref(), Some("Oggi + domani"));
                assert_eq!(block, None);
            }
            other => panic!("not a navigation: {other:?}"),
        }
        let without = open_link(&root, &entry("a.md", "Chiamare", None));
        assert!(!without.contains("heading"), "{without}");
    }

    #[test]
    fn many_reminders_at_once_are_a_few_notifications() {
        let list = |n: usize, more: bool| ReminderList {
            reminders: (0..n)
                .map(|i| entry(&format!("{i}.md"), "x", None))
                .collect(),
            more,
        };
        let three = list(3, false);
        assert_eq!(plan(&three, 5).len(), 3);
        let thousand = list(1_000, true);
        let planned = plan(&thousand, 5);
        assert_eq!(planned.len(), 5);
        assert_eq!(
            planned[4],
            NoticeOf::More {
                count: 996,
                more: true
            }
        );
        let root = Utf8PathBuf::from("/v");
        let it = Locale {
            language: "it".into(),
            ..Locale::default()
        };
        let summary = planned[4].notice(&root, &it);
        assert_eq!(
            summary.body,
            "Più di 996 altri promemoria: sono nella vista dei compiti."
        );
        assert_eq!(summary.link, None, "the list is in the tasks view");
        assert_eq!(planned[0].notice(&root, &it).body, "x\n0");
    }

    #[test]
    fn the_note_name_is_read_without_folders_and_extension() {
        assert_eq!(note_name("Lavoro/Riunioni.md"), "Riunioni");
        assert_eq!(note_name("a.md"), "a");
        assert_eq!(note_name("Disegno.fubdraw"), "Disegno.fubdraw");
    }
}
