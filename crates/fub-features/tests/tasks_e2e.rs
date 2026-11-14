// Il banco di questa vista vive con lei: senza la cargo feature `tasks` il modulo
// non è compilato. Serve anche `search`, che è la sua sorgente di note, e
// `commands`, perché ciò che la vista prova a fare con la spunta è un comando del
// registro.
#![cfg(feature = "tasks")]
//! I compiti del vault **end-to-end attraverso il kernel vero**: note vere sul
//! disco, indice di ricerca vero, comando di spunta vero, e un orologio e un
//! locale che la prova sceglie.
//!
//! Prova ciò che la vista promette: i quattro gruppi, i casi limite (una scadenza
//! assente, una data che non esiste, un compito annidato o in una citazione, un
//! compito ricorrente, una nota in sola lettura), la spunta che rifiuta di
//! scrivere su un compito che la nota non ha più in quella posizione, il giorno
//! che cambia a mezzanotte del fuso dell'utente, la settimana che inizia dove dice
//! il locale, il tetto dei compiti, e il caso di un vault senza indice.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use camino::Utf8PathBuf;
use fub_abi::locale::{days_from_civil, Locale, Weekday};
use fub_abi::traits::{CommandProvider, PluginManifest, ViewInstance, ViewProvider, ViewSurface};
use fub_abi::ui::{ActionRef, UiAction, UiKind, UiNode, ViewUpdate};
use fub_features::{
    CoreCommands, SearchIndex, TasksView, COMMANDS_ID, SEARCH_ID, TASKS_ID, TASKS_VIEW,
};
use fub_format_markdown::MarkdownProvider;
use fub_kernel::time::Clock;
use fub_kernel::{FormatRegistry, SystemLocale, Trust, Workspace};

/// Un orologio che la prova sposta a mano.
#[derive(Clone)]
struct Fixed(Arc<AtomicU64>);

impl Clock for Fixed {
    fn now_unix_millis(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }
}

/// Un istante UTC, scritto come si scrive un orologio da parete.
fn utc(year: i64, month: u64, day: u64, hour: u64, minute: u64) -> u64 {
    let days = days_from_civil(year, month, day) as u64;
    days * 86_400_000 + (hour * 60 + minute) * 60_000
}

/// Un locale con il fuso e il primo giorno della settimana che la prova vuole.
fn locale(offset_minutes: i16, first: Weekday) -> Locale {
    Locale {
        language: "it".to_string(),
        utc_offset_minutes: offset_minutes,
        first_day_of_week: first,
        ..Locale::default()
    }
}

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        Vault { _dir: dir, root }
    }

    fn put(&self, rel: &str, body: &str) {
        std::fs::write(self.root.join(rel), body).unwrap();
    }

    fn read(&self, rel: &str) -> String {
        std::fs::read_to_string(self.root.join(rel)).unwrap()
    }

    /// Apre il vault con la ricerca accesa, e con l'orologio e il locale della prova.
    fn open(&self, clock: &Fixed, locale: Locale) -> Workspace {
        self.open_with(clock, locale, true)
    }

    fn open_with(&self, clock: &Fixed, locale: Locale, with_search: bool) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(MarkdownProvider::boxed())
            .expect("nessun conflitto di estensioni");
        let system = Arc::new(SystemLocale::default());
        assert!(system.publish(locale), "il locale di prova si pubblica");
        let mut ws = Workspace::new(&self.root, registry)
            .expect("l'apertura del vault riesce")
            .with_clock(Arc::new(clock.clone()))
            .with_system_locale(system);
        // Il comando di spunta e la vista, come li monta l'app.
        ws.register_plugin(
            PluginManifest::core(COMMANDS_ID, COMMANDS_ID)
                .speaking("it", fub_features::commands::catalog()),
            Trust::Core,
        )
        .expect("dichiarato");
        ws.register_command_provider(COMMANDS_ID, Box::new(CoreCommands))
            .expect("registrato");
        if with_search {
            ws.register_core_feature(SEARCH_ID, SEARCH_ID)
                .expect("dichiarato");
            let dir = ws.plugin_data_dir(SEARCH_ID).expect("spazio dati");
            let index = SearchIndex::open(&dir).expect("indice");
            ws.register_index_provider(SEARCH_ID, Box::new(index))
                .expect("attivazione dell'indice");
        }
        ws.register_plugin(
            PluginManifest::core(TASKS_ID, TASKS_ID).speaking("it", fub_features::tasks::catalog()),
            Trust::Core,
        )
        .expect("dichiarato");
        ws.register_view_provider(TASKS_ID, Box::new(TasksView))
            .expect("registrato");
        ws.reindex().expect("reindex");
        ws
    }
}

fn instance() -> ViewInstance {
    ViewInstance::only(TASKS_VIEW)
}

/// Un'intera giornata di lavoro di prova: venerdì 13 novembre 2026, alle 23:30 del
/// fuso di chi guarda (UTC+2).
fn friday_night(clock: &Fixed) {
    clock.0.store(utc(2026, 11, 13, 21, 30), Ordering::SeqCst);
}

/// Il vault della prova: un compito per gruppo, più i casi limite.
fn seeded_vault() -> Vault {
    let vault = Vault::new();
    vault.put("Oggi.md", "- [ ] Pagare la bolletta 📅 2026-11-13\n");
    vault.put("Ieri.md", "- [ ] Chiamare Anna 📅 2026-11-12\n");
    vault.put(
        "Lontano.md",
        "- [ ] Rinnovare il passaporto 📅 2026-11-20\n",
    );
    vault.put("Senza.md", "- [ ] Idea da sviluppare\n");
    vault.put("Fatto.md", "- [x] Già fatto 📅 2026-11-13\n");
    vault.put("Annidato.md", "- [ ] Padre\n  - [ ] Figlio 📅 2026-11-12\n");
    vault.put(
        "Citazione.md",
        "> - [ ] Dentro una citazione 📅 2026-11-13\n",
    );
    vault.put("Refuso.md", "- [ ] Data sbagliata 📅 2026-02-30\n");
    vault
}

/// I gruppi disegnati, in ordine: il titolo di ciascuno e le sue righe.
fn groups(tree: &UiNode) -> Vec<(String, Vec<String>)> {
    fn walk(node: &UiNode, out: &mut Vec<(String, Vec<String>)>) {
        if let UiKind::Section {
            title, children, ..
        } = &node.kind
        {
            let mut labels = Vec::new();
            for child in children {
                labels.extend(task_labels(child));
            }
            out.push((title.to_string(), labels));
        }
        for child in node.children() {
            walk(child, out);
        }
    }
    let mut out = Vec::new();
    walk(tree, &mut out);
    out
}

/// Il testo delle spunte in un nodo e nei suoi figli.
fn task_labels(node: &UiNode) -> Vec<String> {
    let mut out = Vec::new();
    if let UiKind::Checkbox { label, .. } = &node.kind {
        out.push(label.to_string());
    }
    for child in node.children() {
        out.extend(task_labels(child));
    }
    out
}

/// L'azione della spunta di un compito, per il suo testo.
fn toggle_of(tree: &UiNode, text: &str) -> ActionRef {
    fn walk(node: &UiNode, text: &str) -> Option<ActionRef> {
        if let UiKind::Checkbox {
            label,
            action: Some(action),
            ..
        } = &node.kind
        {
            let shown = label.to_string();
            if shown == text {
                return Some(action.clone());
            }
        }
        node.children()
            .into_iter()
            .find_map(|child| walk(child, text))
    }
    walk(tree, text).unwrap_or_else(|| panic!("nessuna spunta per «{text}»"))
}

/// Ogni messaggio che l'albero mostra, come lo consegna la vista.
///
/// Il kernel traduce i testi a chiave nella lingua di chi guarda prima di consegnare
/// l'albero: qui arrivano già in italiano, la lingua del locale della prova.
fn messages(tree: &UiNode) -> Vec<String> {
    fn walk(node: &UiNode, out: &mut Vec<String>) {
        match &node.kind {
            UiKind::Failed { message, .. } => out.push(message.to_string()),
            UiKind::Text { content } => out.push(content.to_string()),
            UiKind::Badge { label, .. } => out.push(label.to_string()),
            UiKind::EmptyState { title, .. } => out.push(title.to_string()),
            _ => {}
        }
        for child in node.children() {
            walk(child, out);
        }
    }
    let mut out = Vec::new();
    walk(tree, &mut out);
    out
}

/// I messaggi della vista, come il testo italiano che la prova si aspetta.
const UNREADABLE_DATE: &str = "Data non leggibile";
const EMPTY: &str = "Nessun compito aperto nel vault.";
const CHANGED: &str = "Il compito è cambiato nel frattempo: l'ho riletto, controlla e riprova.";
const READ_ONLY: &str = "Non posso spuntarlo: la nota è in sola lettura.";
const NO_INDEX: &str = "Il vault non ha un indice di ricerca attivo: i compiti non si leggono.";
const SHOWN_MANY: &str =
    "Mostro 300 compiti: il vault ne ha più di 10000. Restringi con la ricerca.";

/// Esegue la spunta di un compito come la farebbe il clic sulla sua riga.
fn click(ws: &mut Workspace, tree: &UiNode, text: &str) -> ViewUpdate {
    let action = toggle_of(tree, text);
    ws.view_action(
        &instance(),
        UiAction::new(action.action.0).with_payload(action.payload),
    )
    .expect("la spunta risponde")
}

#[test]
fn the_view_is_a_right_sidebar_view_closed_by_default() {
    let views = TasksView.views();
    assert_eq!(views.len(), 1);
    assert_eq!(views[0].id, TASKS_VIEW);
    assert_eq!(views[0].surface, ViewSurface::RightSidebar);
    assert!(!views[0].open_by_default, "l'ispettore non si apre da sé");
}

#[test]
fn the_check_is_a_command_of_the_registry() {
    let commands = CoreCommands.commands();
    assert!(
        commands.iter().any(|spec| spec.id == "note.task.toggle"),
        "la spunta chiama `note.task.toggle`, che il registro deve avere"
    );
}

#[test]
fn the_open_tasks_of_the_vault_fall_in_four_groups() {
    let vault = seeded_vault();
    let clock = Fixed(Arc::new(AtomicU64::new(0)));
    friday_night(&clock);
    let ws = vault.open(&clock, locale(120, Weekday::Monday));

    let tree = ws.render_view(&instance()).expect("la vista si disegna");
    assert_eq!(
        groups(&tree),
        vec![
            (
                "Scaduti".to_string(),
                vec![
                    "Figlio 📅 2026-11-12".to_string(),
                    "Chiamare Anna 📅 2026-11-12".to_string()
                ],
            ),
            (
                "Questa settimana".to_string(),
                vec![
                    "Dentro una citazione 📅 2026-11-13".to_string(),
                    "Pagare la bolletta 📅 2026-11-13".to_string(),
                ],
            ),
            (
                "Più avanti".to_string(),
                vec!["Rinnovare il passaporto 📅 2026-11-20".to_string()],
            ),
            (
                "Senza data".to_string(),
                vec![
                    "Padre".to_string(),
                    "Data sbagliata 📅 2026-02-30".to_string(),
                    "Idea da sviluppare".to_string(),
                ],
            ),
        ],
        "le spunte fatte non compaiono, e il compito annidato e quello in citazione sì"
    );
}

#[test]
fn a_wrong_date_is_shown_as_unreadable_and_a_missing_one_is_not() {
    let vault = seeded_vault();
    let clock = Fixed(Arc::new(AtomicU64::new(0)));
    friday_night(&clock);
    let ws = vault.open(&clock, locale(120, Weekday::Monday));
    let tree = ws.render_view(&instance()).unwrap();

    let shown = messages(&tree);
    assert!(
        shown.iter().any(|m| m == UNREADABLE_DATE),
        "la data che non esiste si vede come tale: {shown:?}"
    );
    let no_date = groups(&tree)
        .into_iter()
        .find(|(title, _)| title == "Senza data")
        .expect("il gruppo c'è");
    assert_eq!(
        no_date.1.len(),
        3,
        "un compito senza data, o con una data sbagliata, non sparisce"
    );
}

#[test]
fn an_empty_vault_says_so() {
    let vault = Vault::new();
    let clock = Fixed(Arc::new(AtomicU64::new(0)));
    friday_night(&clock);
    let ws = vault.open(&clock, locale(120, Weekday::Monday));
    let tree = ws.render_view(&instance()).unwrap();
    assert!(messages(&tree).iter().any(|m| m == EMPTY));
    assert!(groups(&tree).is_empty());
}

#[test]
fn checking_a_task_writes_the_note_and_it_leaves_the_list() {
    let vault = seeded_vault();
    let clock = Fixed(Arc::new(AtomicU64::new(0)));
    friday_night(&clock);
    let mut ws = vault.open(&clock, locale(120, Weekday::Monday));
    let tree = ws.render_view(&instance()).unwrap();

    let update = click(&mut ws, &tree, "Pagare la bolletta 📅 2026-11-13");
    assert_eq!(update, ViewUpdate::None, "la spunta si vede al ridisegno");
    assert_eq!(
        vault.read("Oggi.md"),
        "- [x] Pagare la bolletta 📅 2026-11-13\n",
        "il comando cambia un carattere, e nient'altro del compito"
    );

    let after = ws.render_view(&instance()).unwrap();
    assert!(
        !task_labels(&after).contains(&"Pagare la bolletta 📅 2026-11-13".to_string()),
        "il compito fatto esce dalla vista"
    );
}

#[test]
fn a_recurring_task_leaves_the_next_occurrence_open() {
    let vault = Vault::new();
    vault.put("Casa.md", "- [ ] Annaffia 🔁 every week 📅 2026-11-13\n");
    let clock = Fixed(Arc::new(AtomicU64::new(0)));
    friday_night(&clock);
    let mut ws = vault.open(&clock, locale(120, Weekday::Monday));
    let tree = ws.render_view(&instance()).unwrap();

    click(&mut ws, &tree, "Annaffia 🔁 every week 📅 2026-11-13");
    assert_eq!(
        vault.read("Casa.md"),
        "- [ ] Annaffia 🔁 every week 📅 2026-11-20\n- [x] Annaffia 🔁 every week 📅 2026-11-13\n",
        "la riga fatta resta dov'era, e la successiva le nasce sopra"
    );
    let after = ws.render_view(&instance()).unwrap();
    let later = groups(&after)
        .into_iter()
        .find(|(title, _)| title == "Più avanti")
        .expect("la prossima occorrenza è più avanti");
    assert_eq!(
        later.1,
        vec!["Annaffia 🔁 every week 📅 2026-11-20".to_string()]
    );
}

#[test]
fn a_task_that_moved_under_the_view_is_not_checked() {
    let vault = seeded_vault();
    let clock = Fixed(Arc::new(AtomicU64::new(0)));
    friday_night(&clock);
    let mut ws = vault.open(&clock, locale(120, Weekday::Monday));
    let tree = ws.render_view(&instance()).unwrap();

    // La nota cambia sotto la vista: una riga in testa sposta tutto di un carattere.
    vault.put(
        "Oggi.md",
        "Nuova riga in testa\n- [ ] Pagare la bolletta 📅 2026-11-13\n",
    );
    ws.reindex().unwrap();

    let update = click(&mut ws, &tree, "Pagare la bolletta 📅 2026-11-13");
    let ViewUpdate::Replace { root } = update else {
        panic!("una spunta su una posizione cambiata si ridisegna, e non scrive");
    };
    assert!(
        messages(&root).iter().any(|m| m == CHANGED),
        "la vista dice che il compito è cambiato"
    );
    assert_eq!(
        vault.read("Oggi.md"),
        "Nuova riga in testa\n- [ ] Pagare la bolletta 📅 2026-11-13\n",
        "nessuna riga è stata spuntata al posto di un'altra"
    );
}

#[test]
fn the_day_moves_at_midnight_of_the_users_zone() {
    let vault = Vault::new();
    vault.put("Oggi.md", "- [ ] Pagare la bolletta 📅 2026-11-13\n");
    let clock = Fixed(Arc::new(AtomicU64::new(0)));
    // 23:30 a UTC+2: il 13 è ancora oggi, e la scadenza del 13 è questa settimana.
    friday_night(&clock);
    let ws = vault.open(&clock, locale(120, Weekday::Monday));
    let before = ws.render_view(&instance()).unwrap();
    assert_eq!(groups(&before)[0].0, "Questa settimana");

    // Mezz'ora dopo sono le 00:00 del 14 a UTC+2: il giorno di chi guarda è
    // cambiato, e il compito del 13 è scaduto. Lo stesso workspace, con l'orologio
    // che si sposta: il disegno legge l'istante a ogni giro.
    clock.0.fetch_add(30 * 60_000, Ordering::SeqCst);
    let after = ws.render_view(&instance()).unwrap();
    assert_eq!(groups(&after)[0].0, "Scaduti");
}

/// Il gruppo in cui la vista mette la riga che contiene `label`.
fn group_showing(tree: &UiNode, label: &str) -> String {
    groups(tree)
        .into_iter()
        .find(|(_, rows)| rows.iter().any(|row| row == label))
        .map(|(title, _)| title)
        .unwrap_or_else(|| panic!("«{label}» non è nella vista"))
}

#[test]
fn the_week_starts_on_the_first_day_of_the_locale() {
    let vault = Vault::new();
    vault.put("Lunedi.md", "- [ ] Consegnare 📅 2026-11-16\n");
    let clock = Fixed(Arc::new(AtomicU64::new(0)));
    // Domenica 15 novembre 2026, a mezzogiorno del fuso di chi guarda: il compito è
    // di lunedì 16, il giorno dopo.
    clock.0.store(utc(2026, 11, 15, 10, 0), Ordering::SeqCst);

    // Con la settimana che inizia di lunedì, la domenica la chiude: lunedì è della
    // settimana dopo, cioè «Più avanti».
    {
        let monday = vault.open(&clock, locale(120, Weekday::Monday));
        let tree = monday.render_view(&instance()).unwrap();
        assert_eq!(
            group_showing(&tree, "Consegnare 📅 2026-11-16"),
            "Più avanti"
        );
    }
    // Con quella che inizia di domenica, la domenica apre una settimana nuova che
    // arriva a sabato 21: lunedì è di questa settimana. Si apre un workspace alla
    // volta, perché due indici sullo stesso vault si contendono il lock.
    {
        let sunday = vault.open(&clock, locale(120, Weekday::Sunday));
        let tree = sunday.render_view(&instance()).unwrap();
        assert_eq!(
            group_showing(&tree, "Consegnare 📅 2026-11-16"),
            "Questa settimana"
        );
    }
}

#[test]
fn a_read_only_note_is_not_written() {
    let vault = seeded_vault();
    let path = vault.root.join("Oggi.md");
    // `set_readonly` toglie i bit di scrittura su Unix e mette l'attributo su
    // Windows: la stessa prova sui tre sistemi della CI.
    set_read_only(&path, true);

    let clock = Fixed(Arc::new(AtomicU64::new(0)));
    friday_night(&clock);
    let mut ws = vault.open(&clock, locale(120, Weekday::Monday));
    let tree = ws.render_view(&instance()).unwrap();
    let update = click(&mut ws, &tree, "Pagare la bolletta 📅 2026-11-13");

    assert_eq!(
        vault.read("Oggi.md"),
        "- [ ] Pagare la bolletta 📅 2026-11-13\n",
        "una nota in sola lettura resta com'è"
    );
    let ViewUpdate::Replace { root } = update else {
        panic!("il rifiuto si dice nella vista");
    };
    // Una nota in sola lettura è un rifiuto di permesso, e la vista lo dice come tale.
    let shown = messages(&root);
    assert!(
        shown.iter().any(|m| m == READ_ONLY),
        "la vista dice che la nota è in sola lettura: {shown:?}"
    );
    // Su Windows la cartella temporanea non si cancella con un file in sola lettura.
    set_read_only(&path, false);
}

fn set_read_only(path: impl AsRef<std::path::Path>, read_only: bool) {
    let path = path.as_ref();
    let mut permissions = std::fs::metadata(path).unwrap().permissions();
    // Su Unix `set_readonly(false)` dà la scrittura a tutti: va bene per una
    // cartella temporanea che sta per essere cancellata.
    #[allow(clippy::permissions_set_readonly_false)]
    permissions.set_readonly(read_only);
    std::fs::set_permissions(path, permissions).unwrap();
}

#[test]
fn ten_thousand_tasks_are_read_up_to_a_limit_and_the_view_says_so() {
    let vault = Vault::new();
    // 503 note da 20 compiti: 10.060 compiti, più di quanti la vista ne legge.
    for note in 0..503 {
        let mut body = String::new();
        for task in 0..20 {
            body.push_str(&format!("- [ ] Compito {note}-{task} 📅 2026-11-13\n"));
        }
        vault.put(&format!("Note{note:03}.md"), &body);
    }
    let clock = Fixed(Arc::new(AtomicU64::new(0)));
    friday_night(&clock);
    let ws = vault.open(&clock, locale(120, Weekday::Monday));
    let tree = ws.render_view(&instance()).unwrap();

    let shown: usize = groups(&tree).iter().map(|(_, rows)| rows.len()).sum();
    assert_eq!(
        shown,
        fub_features::tasks::SHOW_LIMIT,
        "la vista disegna al più il suo tetto"
    );
    assert!(
        messages(&tree).iter().any(|m| m == SHOWN_MANY),
        "e dice che il vault ne ha di più"
    );
}

#[test]
fn without_a_search_index_the_view_says_it_cannot_read() {
    let vault = seeded_vault();
    let clock = Fixed(Arc::new(AtomicU64::new(0)));
    friday_night(&clock);
    let ws = vault.open_with(&clock, locale(120, Weekday::Monday), false);
    let tree = ws
        .render_view(&instance())
        .expect("la vista si disegna lo stesso");
    assert!(
        messages(&tree).iter().any(|m| m == NO_INDEX),
        "senza indice la vista lo dice invece di mostrare un elenco vuoto"
    );
    assert!(groups(&tree).is_empty());
}
