//! Le **stringhe attraverso il confine** (§12.1): chi le risolve, con quale
//! catalogo, e cosa vede chi sta fuori.
//!
//! Le regole di risoluzione — la scala di ripiego, la sostituzione, la chiave
//! nuda come ultimo gradino — stanno nei test di modulo di
//! `fub_abi::text`, dove si provano senza un workspace. Qui c'è ciò che si
//! vede **solo** attraverso il kernel, ed è la parte che il §12.1 decide
//! davvero:
//!
//! 1. che a risolvere sia **il kernel** e non la shell, cioè che ogni via
//!    d'uscita dal contratto passi da lì — l'albero di una view, un
//!    aggiornamento dopo un click, le spec di view e comandi, l'esito di
//!    un'invocazione, le impostazioni;
//! 2. che il catalogo scelto sia **quello del proprietario**, non uno solo per
//!    tutti: due componenti con la stessa chiave e cataloghi diversi devono
//!    leggersi diversi;
//! 3. che **cambiare lingua cambi ciò che si legge** senza rimontare niente;
//! 4. che dopo il kernel un `Text` sia sempre un `Literal`, cioè una stringa
//!    nuda sul filo — è la riga per cui il mirror TypeScript non ha dovuto
//!    imparare un tipo nuovo.

use std::sync::Arc;

use camino::Utf8PathBuf;
use fub_abi::command::{Choice, CommandOutcome, CommandSpec, InvokeMode};
use fub_abi::command::{ParamKind, ParamSpec};
use fub_abi::event::Actor;
use fub_abi::locale::Locale;
use fub_abi::settings::SettingSpec;
use fub_abi::text::{Arg, Localize, StringCatalog, Text};
use fub_abi::traits::{
    CommandProvider, HostApi, IndexQuery, IndexResult, PluginManifest, ReadApi, ViewInstance,
    ViewProvider, ViewSpec, ViewSurface,
};
use fub_abi::ui::{ActionRef, UiAction, UiKind, UiNode, ViewUpdate};
use fub_abi::PluginError;
use fub_kernel::locale::LANGUAGE;
use fub_kernel::{FormatRegistry, SystemLocale, Trust, Workspace};

// ---------------------------------------------------------------------------
// Due componenti che dicono la stessa chiave in due lingue diverse
// ---------------------------------------------------------------------------

const GREETING: &str = "saluto";
const WITH_ARGOMENTI: &str = "con_argomenti";

fn catalog_a() -> Vec<StringCatalog> {
    vec![
        StringCatalog::new("it")
            .with(GREETING, "il primo")
            .with(WITH_ARGOMENTI, "{n} note in «{where}»"),
        StringCatalog::new("en")
            .with(GREETING, "the first")
            .with(WITH_ARGOMENTI, "{n} notes in “{where}”"),
    ]
}

fn catalog_two() -> Vec<StringCatalog> {
    vec![StringCatalog::new("it").with(GREETING, "il secondo")]
}

/// Una view che disegna **solo chiavi**: ogni testo del suo albero è un
/// messaggio, quindi ciò che esce dal kernel dice esattamente chi ha risolto e
/// con cosa.
struct KeyView(&'static str);

impl ViewProvider for KeyView {
    /// La maschera è dell'**esemplare** (§22.3): si prende da *quella* spec,
    /// non dalla prima dell'elenco — un provider che ne dichiara due darebbe a
    /// tutte e due la maschera della prima.
    fn interests(
        &self,
        instance: &fub_abi::traits::ViewInstance,
    ) -> fub_abi::traits::ViewInterests {
        self.views()
            .into_iter()
            .find(|s| s.id == instance.view)
            .map(|s| fub_abi::traits::ViewInterests {
                refresh: s.refresh,
                follows: s.follows,
            })
            .unwrap_or_default()
    }

    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec::new(
            self.0,
            Text::key(GREETING),
            ViewSurface::RightSidebar,
        )]
    }

    fn render_view(
        &self,
        _instance: &ViewInstance,
        _host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        Ok(UiNode::column(
            0,
            vec![
                UiNode::text(Text::key(GREETING)),
                UiNode::new(UiKind::Section {
                    title: Text::message(
                        WITH_ARGOMENTI,
                        vec![Arg::int("n", 3), Arg::text("where", "Archivio")],
                    ),
                    collapsed: false,
                    // In fondo a un contenitore: la risoluzione deve scendere
                    // fino in fondo all'albero, non fermarsi alla radice.
                    children: vec![UiNode::empty_state(Text::key("mai_scritta"))],
                }),
            ],
        ))
    }

    fn on_action(
        &mut self,
        _instance: &ViewInstance,
        _action: UiAction,
        _host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        Ok(ViewUpdate::Replace {
            root: UiNode::text(Text::key(GREETING)),
        })
    }
}

/// Un provider di comandi le cui spec e il cui esito sono tutti chiavi.
struct KeyCommands;

impl CommandProvider for KeyCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![CommandSpec::new("uno.comando", Text::key(GREETING))
            .describing(Text::key(GREETING))
            .with_param(
                ParamSpec::new(
                    "scelta",
                    Text::key(GREETING),
                    ParamKind::Choice(vec![Choice::new("a", Text::key(GREETING))]),
                )
                .describing(Text::key(GREETING)),
            )]
    }

    fn invoke(
        &self,
        _command: &str,
        _args: serde_json::Value,
        _mode: InvokeMode,
        _host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        Ok(CommandOutcome::notify(Text::message(
            WITH_ARGOMENTI,
            vec![Arg::int("n", 7), Arg::text("where", "Bozze")],
        )))
    }
}

// ---------------------------------------------------------------------------
// Il montaggio
// ---------------------------------------------------------------------------

struct Fixture {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        Fixture { _dir: dir, root }
    }

    /// Due componenti dichiarati, con due cataloghi diversi, più le chiavi
    /// `locale.*` del core perché si possa cambiare lingua da un'impostazione.
    fn workspace(&self, system: Arc<SystemLocale>) -> Workspace {
        let mut ws = Workspace::new(&self.root, FormatRegistry::new())
            .expect("l'apertura del vault riesce")
            .with_system_locale(system);
        ws.register_plugin(
            PluginManifest::core("uno", "Uno")
                .speaking("it", catalog_a())
                .configuring(keys_locale()),
            Trust::Core,
        )
        .expect("dichiarato");
        ws.register_plugin(
            PluginManifest::core("due", "Due").speaking("it", catalog_two()),
            Trust::Core,
        )
        .expect("dichiarato");
        // Il terzo **non dichiara niente**: è il degrado garbato, e va provato
        // insieme agli altri due o resterebbe una promessa del doc.
        ws.register_plugin(PluginManifest::core("muto", "Muto"), Trust::Core)
            .expect("dichiarato");

        ws.register_view_provider("uno", Box::new(KeyView("vista.uno")))
            .expect("registrata");
        ws.register_view_provider("due", Box::new(KeyView("vista.due")))
            .expect("registrata");
        ws.register_view_provider("muto", Box::new(KeyView("vista.muta")))
            .expect("registrata");
        ws.register_command_provider("uno", Box::new(KeyCommands))
            .expect("registrato");
        ws
    }
}

fn keys_locale() -> Vec<SettingSpec> {
    fub_kernel::locale::locale_settings()
}

fn italian() -> Locale {
    Locale {
        language: "it-IT".into(),
        ..Locale::default()
    }
}

/// Ogni testo dell'albero, in ordine di lettura. Raccoglierli con lo stesso
/// `Localize` che il kernel usa è deliberato: se un giorno una variante nuova
/// sfuggisse alla visita, questo test smetterebbe di vederla **insieme** al
/// kernel — e il presidio vero resta il `match` esaustivo che non compila.
fn texts<T: Localize>(v: &mut T) -> Vec<String> {
    let mut out = Vec::new();
    v.visit_texts(&mut |t| out.push(t.to_string()));
    out
}

/// Nessun `Text` è rimasto un messaggio: è l'invariante che il kernel garantisce
/// a chi sta fuori dal contratto.
fn all_resolved<T: Localize>(v: &mut T) -> bool {
    let mut ok = true;
    v.visit_texts(&mut |t| ok &= t.is_literal());
    ok
}

// ---------------------------------------------------------------------------
// I test
// ---------------------------------------------------------------------------

/// **Il catalogo è quello del proprietario.** Due view che disegnano la stessa
/// identica chiave si leggono diverse, perché a risolverle sono due cataloghi
/// diversi — e la terza, di chi non ne ha, si legge come la chiave nuda.
#[test]
fn the_catalog_is_the_owners_one() {
    let fx = Fixture::new();
    let system = Arc::new(SystemLocale::default());
    assert!(system.publish(italian()));
    let ws = fx.workspace(system);

    let read = |view: &str| {
        let mut tree = ws
            .render_view(&ViewInstance::only(view))
            .expect("disegnata");
        assert!(all_resolved(&mut tree), "il kernel risolve tutto");
        texts(&mut tree)
    };

    assert_eq!(read("vista.uno")[0], "il primo");
    assert_eq!(read("vista.due")[0], "il secondo");
    // Chi non dichiara un catalogo scende all'ultimo gradino: la chiave nuda.
    // Brutto, e onesto — e soprattutto **cercabile**.
    assert_eq!(read("vista.muta")[0], GREETING);
}

/// La risoluzione **scende fino in fondo** all'albero e sostituisce gli
/// argomenti; una chiave che nessun catalogo contiene resta sé stessa anche
/// dentro un contenitore.
#[test]
fn resolution_reaches_the_bottom_of_the_tree() {
    let fx = Fixture::new();
    let system = Arc::new(SystemLocale::default());
    assert!(system.publish(italian()));
    let ws = fx.workspace(system);

    let mut tree = ws
        .render_view(&ViewInstance::only("vista.uno"))
        .expect("disegnata");
    assert_eq!(
        texts(&mut tree),
        vec!["il primo", "3 note in «Archivio»", "mai_scritta"]
    );
}

/// **Cambiare lingua cambia ciò che si legge**, e basta un'impostazione: niente
/// si rimonta, nessun provider si accorge di niente.
#[test]
fn changing_the_language_changes_what_one_reads() {
    let fx = Fixture::new();
    let system = Arc::new(SystemLocale::default());
    assert!(system.publish(italian()));
    let mut ws = fx.workspace(system);

    let mut tree = ws
        .render_view(&ViewInstance::only("vista.uno"))
        .expect("disegnata");
    assert_eq!(texts(&mut tree)[1], "3 note in «Archivio»");

    ws.set_setting(LANGUAGE, fub_abi::settings::SettingValue::Text("en".into()))
        .expect("scritta");

    let mut tree = ws
        .render_view(&ViewInstance::only("vista.uno"))
        .expect("disegnata");
    assert_eq!(texts(&mut tree)[0], "the first");
    assert_eq!(texts(&mut tree)[1], "3 notes in “Archivio”");
    // …e chi ha solo l'italiano non guadagna un inglese inventato: scende al
    // proprio ripiego dichiarato, che è il terzo gradino della scala.
    let mut tree = ws
        .render_view(&ViewInstance::only("vista.due"))
        .expect("disegnata");
    assert_eq!(texts(&mut tree)[0], "il secondo");
}

/// **Tutte** le vie d'uscita, non solo il render: le spec di view e comandi,
/// l'aggiornamento dopo un'azione, l'esito di un'invocazione.
#[test]
fn every_way_out_of_the_contract_passes_through_the_kernel() {
    let fx = Fixture::new();
    let system = Arc::new(SystemLocale::default());
    assert!(system.publish(italian()));
    let mut ws = fx.workspace(system);

    // Le spec di view: i titoli sono ciò che la shell mette su una scheda.
    let mut seen = ws.views();
    assert!(all_resolved(&mut seen));
    let title = |id: &str| {
        ws.views()
            .into_iter()
            .find(|v| v.id == id)
            .expect("registrata")
            .title
    };
    assert_eq!(title("vista.uno"), "il primo");
    assert_eq!(title("vista.due"), "il secondo");

    // Le spec dei comandi: titolo, descrizione, parametri e le loro scelte.
    let mut commands = ws.commands();
    assert!(all_resolved(&mut commands), "anche dentro i parametri");
    assert_eq!(commands[0].title, "il primo");
    assert_eq!(commands[0].params[0].title, "il primo");
    let ParamKind::Choice(choices) = &commands[0].params[0].kind else {
        panic!("il parametro è una scelta")
    };
    assert_eq!(choices[0].title, "il primo");

    // L'aggiornamento dopo un click: una `Replace` porta un albero come quello
    // del render, e passa dalla stessa risoluzione.
    let mut update = ws
        .view_action(&ViewInstance::only("vista.uno"), UiAction::new("qualunque"))
        .expect("azione");
    assert!(all_resolved(&mut update));
    let ViewUpdate::Replace { root } = &update else {
        panic!("questa view risponde con un Replace")
    };
    assert!(matches!(&root.kind, UiKind::Text { content } if content == "il primo"));

    // L'esito di un comando: la notifica è ciò che l'utente legge sotto il
    // pulsante che ha appena premuto.
    let mut outcome = ws
        .invoke_command(
            "uno.comando",
            serde_json::json!({}),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("eseguito");
    assert!(all_resolved(&mut outcome));
    assert_eq!(outcome.notify.unwrap(), "7 note in «Bozze»");
}

/// Le **impostazioni** escono risolte come tutto il resto: etichetta,
/// descrizione e intestazione di gruppo col catalogo di chi le ha dichiarate.
#[test]
fn settings_as_out_resolved_too() {
    let fx = Fixture::new();
    let system = Arc::new(SystemLocale::default());
    assert!(system.publish(italian()));
    let mut ws = fx.workspace(system);
    ws.register_plugin(
        PluginManifest::core("tre", "Tre")
            .speaking("it", catalog_a())
            .configuring(vec![SettingSpec::toggle(
                "tre.acceso",
                Text::key(GREETING),
                false,
            )
            .grouped(Text::key(GREETING))]),
        Trust::Core,
    )
    .expect("dichiarato");

    let mut rows = ws.settings_entries(Some("tre"));
    assert!(all_resolved(&mut rows));
    assert_eq!(rows[0].spec.label, "il primo");
    assert_eq!(rows[0].spec.group, "il primo");

    // La porta che usa il pannello è `query_index`, non `settings_entries`.
    // Senza questa asserzione il canale dati può restituire `Text` nudi e
    // la shell disegna `[object Object]` — etichetta, descrizione, gruppo.
    let IndexResult::Settings(mut from_the_channel) = ws
        .query_index(IndexQuery::Settings {
            plugin: Some("tre".into()),
        })
        .expect("servite")
    else {
        panic!("risposta fuori tema");
    };
    assert!(all_resolved(&mut from_the_channel));
    assert_eq!(from_the_channel[0].spec.label, "il primo");
    let json = serde_json::to_value(&from_the_channel).expect("serializzato");
    assert_eq!(json[0]["spec"]["label"], "il primo");
    assert!(
        json[0]["spec"]["label"].is_string(),
        "una stringa nuda, non un oggetto con una chiave dentro"
    );
}

/// **La riga che tiene fermo il mirror TypeScript**: risolto, un albero
/// serializza con le stringhe nude che la shell ha sempre letto. Se un giorno
/// un `Text` uscisse non risolto, sul filo comparirebbe un oggetto
/// `{"key": …}` dove la shell si aspetta una stringa — e questo test è il
/// posto in cui si vede prima che lo veda un utente.
#[test]
fn on_the_wire_a_resolved_text_is_a_bare_string() {
    let fx = Fixture::new();
    let system = Arc::new(SystemLocale::default());
    assert!(system.publish(italian()));
    let ws = fx.workspace(system);

    let tree = ws
        .render_view(&ViewInstance::only("vista.uno"))
        .expect("disegnata");
    let json = serde_json::to_value(&tree).expect("serializzato");
    assert_eq!(json["children"][0]["content"], "il primo");
    assert_eq!(json["children"][1]["title"], "3 note in «Archivio»");
    assert!(
        json["children"][0]["content"].is_string(),
        "una stringa nuda, non un oggetto con una chiave dentro"
    );
}

/// Il messaggio dentro un'azione **non** viene risolto in entrata: `Text` è un
/// tipo del contratto, e ciò che entra da un click è dato della shell.
///
/// È il verso che è facile dimenticare: chi risolvesse anche in ingresso
/// tradurrebbe ciò che l'utente ha digitato.
#[test]
fn nothing_is_resolved_on_the_way_in() {
    let fx = Fixture::new();
    let system = Arc::new(SystemLocale::default());
    assert!(system.publish(italian()));
    let mut ws = fx.workspace(system);

    // Un'azione il cui payload nomina una chiave del catalogo: torna al
    // provider intatta, perché il payload non è testo da leggere.
    let action = UiAction::new("qualunque").with_payload(serde_json::json!({ "k": GREETING }));
    let outcome = ws.view_action(&ViewInstance::only("vista.uno"), action);
    assert!(outcome.is_ok());
    // E un `ActionRef` non è mai stato un `Text`: l'id di un'azione è opaco.
    let _ = ActionRef::new(GREETING);
}
