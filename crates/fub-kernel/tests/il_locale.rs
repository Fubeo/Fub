//! Il **locale** attraverso il contratto (§12.3): chi lo riporta, chi lo
//! decide, e cosa vede chi sta dentro il confine.
//!
//! Le regole di composizione — una chiave vuota vuol dire «come il sistema», un
//! valore illeggibile cade sul sistema, scegliere un fuso diverso lascia cadere
//! l'offset di quello vecchio — stanno nei test di modulo di `locale.rs`, dove
//! si provano senza un workspace. Qui c'è ciò che si vede **solo** attraverso il
//! contratto: che un provider riceva la stessa risposta che il kernel compone,
//! che due vault aperti insieme ne vedano una sola, e che il caso arrivi fin
//! dentro un `render_view`.

use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fub_abi::locale::{HourCycle, Locale, Weekday};
use fub_abi::settings::{SettingKind, SettingSpec, SettingValue};
use fub_abi::traits::{
    HostApi, PluginManifest, ReadApi, ViewInstance, ViewProvider, ViewSpec, ViewSurface,
};
use fub_abi::ui::{UiAction, UiNode, ViewUpdate};
use fub_abi::PluginError;
use fub_kernel::locale::{FIRST_DAY, HOUR_CYCLE, LANGUAGE};
use fub_kernel::{FormatRegistry, SystemLocale, Trust, Workspace};

/// Una view che, invece di disegnare, **riporta cosa l'host le ha detto**: il
/// locale che ha visto e i byte di caso che ha ricevuto. È il solo modo di
/// provare che ciò che il kernel compone è ciò che attraversa il confine, e non
/// una risposta che il test si costruisce da sé chiamando il workspace.
#[derive(Clone, Default)]
struct Spia {
    visto: Arc<Mutex<Option<Locale>>>,
    caso: Arc<Mutex<Vec<u8>>>,
}

impl ViewProvider for Spia {
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
        vec![ViewSpec::new("spia", "Spia", ViewSurface::RightSidebar)]
    }

    fn render_view(
        &self,
        _instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        *self.visto.lock().unwrap() = Some(host.user_locale());
        *self.caso.lock().unwrap() = host.random_bytes(16);
        Ok(UiNode::text(""))
    }

    fn on_action(
        &mut self,
        _instance: &ViewInstance,
        _action: UiAction,
        _host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        Ok(ViewUpdate::None)
    }
}

/// Le quattro chiavi `locale.*`, dichiarate come le dichiara il core.
fn chiavi() -> Vec<SettingSpec> {
    fub_kernel::locale::locale_settings()
}

fn sistema() -> Locale {
    Locale {
        language: "en-US".into(),
        timezone: "America/New_York".into(),
        utc_offset_minutes: -300,
        first_day_of_week: Weekday::Sunday,
        hour_cycle: HourCycle::H12,
    }
}

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

    /// Un workspace con la spia registrata e le chiavi `locale.*` dichiarate.
    fn workspace(&self, system: Arc<SystemLocale>) -> (Workspace, Spia) {
        let mut ws = Workspace::new(&self.root, FormatRegistry::new()).with_system_locale(system);
        ws.register_plugin(
            PluginManifest::core("test.spia", "Spia").configuring(chiavi()),
            Trust::Core,
        )
        .expect("dichiarato");
        let spia = Spia::default();
        ws.register_view_provider("test.spia", Box::new(spia.clone()))
            .expect("registrato");
        (ws, spia)
    }
}

/// Il locale che una view vede è quello che il kernel compone — non il default
/// del contratto, e non il valore grezzo che la shell ha riportato.
#[test]
fn a_view_sees_what_the_kernel_composed() {
    let fx = Fixture::new();
    let system = Arc::new(SystemLocale::default());
    let (mut ws, spia) = fx.workspace(Arc::clone(&system));

    // Prima che la shell parli: il default del contratto, e non un italiano
    // qualsiasi cablato da qualche parte.
    ws.render_view(&ViewInstance::only("spia")).expect("render");
    assert_eq!(
        spia.visto.lock().unwrap().clone().unwrap(),
        Locale::default()
    );

    // La shell riporta il sistema.
    assert!(system.publish(sistema()));
    ws.render_view(&ViewInstance::only("spia")).expect("render");
    assert_eq!(spia.visto.lock().unwrap().clone().unwrap(), sistema());

    // L'utente sceglie: la lingua si muove, l'orologio del sistema resta.
    ws.set_setting(LANGUAGE, SettingValue::Text("it-IT".into()))
        .expect("scritta");
    ws.render_view(&ViewInstance::only("spia")).expect("render");
    let visto = spia.visto.lock().unwrap().clone().unwrap();
    assert_eq!(visto.language, "it-IT");
    assert_eq!(visto.utc_offset_minutes, -300, "il fuso non l'ha toccato");
    assert_eq!(visto.hour_cycle, HourCycle::H12);
}

/// Il locale **non è del vault**: due workspace aperti insieme sullo stesso
/// host ne vedono uno solo, e la shell lo pubblica una volta.
#[test]
fn two_open_vaults_share_one_locale() {
    let uno = Fixture::new();
    let due = Fixture::new();
    let system = Arc::new(SystemLocale::default());
    let (a, spia_a) = uno.workspace(Arc::clone(&system));
    let (b, spia_b) = due.workspace(Arc::clone(&system));

    system.publish(sistema());
    a.render_view(&ViewInstance::only("spia")).expect("render");
    b.render_view(&ViewInstance::only("spia")).expect("render");
    assert_eq!(
        spia_a.visto.lock().unwrap().clone(),
        spia_b.visto.lock().unwrap().clone(),
        "due vault aperti insieme hanno due idee di che ore sono"
    );
}

/// Le chiavi sono quattro e non una proprio per questo: il fuso si sceglie senza
/// toccare la lingua, e il calendario senza toccare nessuno dei due.
#[test]
fn each_key_moves_only_its_own_field() {
    let fx = Fixture::new();
    let system = Arc::new(SystemLocale::default());
    let (mut ws, spia) = fx.workspace(Arc::clone(&system));
    system.publish(sistema());

    ws.set_setting(FIRST_DAY, SettingValue::Text("monday".into()))
        .expect("scritta");
    ws.set_setting(HOUR_CYCLE, SettingValue::Text("h23".into()))
        .expect("scritta");
    ws.render_view(&ViewInstance::only("spia")).expect("render");
    let visto = spia.visto.lock().unwrap().clone().unwrap();
    assert_eq!(visto.first_day_of_week, Weekday::Monday);
    assert_eq!(visto.hour_cycle, HourCycle::H23);
    assert_eq!(
        visto.language, "en-US",
        "la lingua non l'ha toccata nessuno"
    );
    assert_eq!(visto.timezone, "America/New_York");
}

/// Una chiave svuotata **torna al sistema**, e non a vuoto: è la differenza fra
/// «non decidere tu» e «nessuna lingua».
#[test]
fn clearing_a_key_returns_to_the_system_and_not_to_nothing() {
    let fx = Fixture::new();
    let system = Arc::new(SystemLocale::default());
    let (mut ws, spia) = fx.workspace(Arc::clone(&system));
    system.publish(sistema());

    ws.set_setting(LANGUAGE, SettingValue::Text("it-IT".into()))
        .expect("scritta");
    ws.set_setting(LANGUAGE, SettingValue::Text(String::new()))
        .expect("svuotata");
    ws.render_view(&ViewInstance::only("spia")).expect("render");
    assert_eq!(
        spia.visto.lock().unwrap().clone().unwrap().language,
        "en-US"
    );

    // E anche il reset, che è l'altra strada per lo stesso posto.
    ws.set_setting(LANGUAGE, SettingValue::Text("it-IT".into()))
        .expect("scritta");
    ws.reset_setting(LANGUAGE).expect("resettata");
    ws.render_view(&ViewInstance::only("spia")).expect("render");
    assert_eq!(
        spia.visto.lock().unwrap().clone().unwrap().language,
        "en-US"
    );
}

/// Il caso arriva fin dentro un `render_view`, e due giri non danno gli stessi
/// byte: è tutto ciò che la capacità promette, ed è ciò che serve a un'identità.
#[test]
fn randomness_crosses_the_boundary_and_never_repeats() {
    let fx = Fixture::new();
    let (ws, spia) = fx.workspace(Arc::new(SystemLocale::default()));

    ws.render_view(&ViewInstance::only("spia")).expect("render");
    let primo = spia.caso.lock().unwrap().clone();
    assert_eq!(primo.len(), 16);
    ws.render_view(&ViewInstance::only("spia")).expect("render");
    let secondo = spia.caso.lock().unwrap().clone();
    assert_ne!(primo, secondo, "due chiamate hanno dato gli stessi byte");
    assert!(
        primo.iter().any(|b| *b != 0),
        "byte tutti a zero: l'entropia non è arrivata"
    );
}

/// Nessuna chiave del locale è scrivibile da un programma: in che lingua legge
/// l'utente è dell'utente, e un componente che potesse cambiarla avrebbe il modo
/// di rendere l'app illeggibile a chi lo ha installato.
#[test]
fn a_component_cannot_change_the_language_of_who_reads() {
    for spec in chiavi() {
        assert!(
            !spec.program_writable,
            "`{}` è scrivibile da un programma",
            spec.key
        );
        assert!(
            matches!(
                spec.kind,
                SettingKind::Text { .. } | SettingKind::Choice { .. }
            ),
            "`{}` non ha una specie che il pannello sappia disegnare",
            spec.key
        );
    }
}
