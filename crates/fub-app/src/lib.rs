//! Colla Tauri v2 di Fub: comandi IPC, ponte eventi verso il webview,
//! finestre e dialoghi.
//!
//! **Chi monta non è qui.** Registro dei formati, feature ufficiali, indice di
//! ricerca, versioning, view, comandi, sintassi, renderer, sessione e watcher
//! stanno in [`fub_host`], che non dipende da tauri: quel montaggio ha cinque
//! clienti previsti — CLI (27.1), API locale (27.2), e2e headless (17.2 e
//! 27.4), mobile (26.2) e PWA (26.3) — e finché viveva dentro
//! `#[tauri::command] open_vault` nessuno di loro poteva riusarlo (§8.2,
//! decisione 0023).
//!
//! Ciò che resta in questo crate è **solo** ciò che non esiste senza un
//! webview: le firme `#[tauri::command]` (tutte in `src/ipc/`, un file per
//! tema), il ponte che inoltra gli eventi del kernel a `fub://event`, e
//! `run()` in questo file. Se una riga del crate può essere spiegata senza
//! nominare Tauri, sta nel posto sbagliato.
//!
//! **Gli errori non si traducono più qui** (§12.2). Fino a questa seduta ogni
//! firma era `Result<_, String>` e dodici `map_err(|e| e.to_string())`
//! buttavano via il tipo sul confine: al frontend arrivava una frase italiana,
//! e l'unico modo di distinguere «esiste già» da «disco pieno» era cercarci
//! dentro una sottostringa — che `apps/client/src/panels/trash.ts` non faceva
//! nemmeno, intercettando con un `catch` nudo qualunque fallimento e chiedendo
//! sempre la stessa cosa. Adesso passa un [`PluginError`], che è serializzabile
//! e **discriminabile**: `{"kind": "already_exists", "message": …}`.

use std::sync::Arc;

use camino::Utf8Path;
use fub_abi::{Notice, PluginError};
use fub_host::Host;
use fub_wasm_host::managed::InstalledPluginManager;
use tauri::{Emitter, Manager};

// I tre record che attraversano l'IPC vivono nell'host — un'API locale
// risponderebbe con gli stessi — e l'app li ri-esporta, perché è lei a farli
// attraversare il confine: il mirror TS e la sua fixture
// (`tests/ts_mirror_app.rs`) restano legati al lato che li serializza.
pub use fub_host::{
    BundleInfo, EmbedContent, ThemeInfo, ThemePayload, UnreadDoc, VaultEntry, VaultInfo,
};
pub use fub_wasm_host::managed::InstalledPluginInfo;
/// I tipi degli appunti GTK senza proprietario, che fanno morire WebKitGTK:
/// il `gtk_clipboard_request_targets` che l'eseguibile esporta (`main.rs`)
/// chiama [`appunti_gtk::gtk_clipboard_request_targets`].
#[cfg(target_os = "linux")]
#[doc(hidden)]
pub mod appunti_gtk;
mod avvio;
#[cfg(feature = "bench-gc")]
mod bench_gc;
#[cfg(target_os = "linux")]
mod disegno;
mod document_windows;
mod domande;
mod frame_rate;
mod ipc;
mod live;
mod mobile;
/// L'orologio dei fotogrammi di GTK3 alla frequenza dello schermo nel modo
/// GL (`docs/architecture/desktop-webview.md`).
#[cfg(target_os = "linux")]
mod orologio;
mod print;
#[cfg(not(mobile))]
mod promemoria;
mod resources;
mod reveal;
mod riga_di_comando;
mod support;
mod tree_access;
mod web_viewer;
pub use ipc::*;
pub use live::{LiveAddress, LiveStart, LiveStarted};
pub use support::DemoClosed;

/// Adattatore OS per `fub://` (P13): thin sopra `fub_host::automation`.
pub mod uri;
/// Il vblank emulato di WebKitGTK (ADR 0246): il `drmWaitVBlank` che
/// l'eseguibile esporta (`main.rs`) chiama [`vblank::drm_wait_vblank`].
#[cfg(target_os = "linux")]
#[doc(hidden)]
pub mod vblank;

/// Legge `appearance.rendering` e la macchina, sceglie e scrive le variabili.
/// Va chiamata quando il processo ha ancora un thread solo
/// ([`disegno::applica`]). Il log non c'è ancora: chi chiama lo scrive dopo.
/// `webkit` è la versione della WebKitGTK caricata ([`declare_the_webview`]).
#[cfg(target_os = "linux")]
fn percorso_di_disegno(
    config_dir: Option<&Utf8Path>,
    webkit: Option<&str>,
) -> (disegno::Modo, disegno::Diagnosi, disegno::Scelta) {
    use fub_host::settings::{APPEARANCE_MOTION, APPEARANCE_RENDERING};
    let valori = fub_host::settings::startup_machine_texts(
        config_dir,
        &[APPEARANCE_RENDERING, APPEARANCE_MOTION],
    );
    let modo = disegno::Modo::da(valori.get(APPEARANCE_RENDERING).map_or("", String::as_str));
    let movimento_calmo = matches!(
        valori.get(APPEARANCE_MOTION).map(String::as_str),
        Some("calm" | "reduced")
    );
    let ambiente = |nome: &str| std::env::var_os(nome).map(|v| v.to_string_lossy().into_owned());
    let diagnosi = disegno::leggi(std::path::Path::new("/"), &ambiente);
    let webkit = webkit
        .and_then(fub_host::settings::Webview::webkitgtk)
        .map(|fub_host::settings::Webview::WebKitGtk(a, b, c)| (a, b, c));
    let gia_messa = |nome: &str| std::env::var_os(nome).is_some();
    let mut scelta = disegno::scegli(modo, &diagnosi, webkit, &gia_messa, movimento_calmo);
    disegno::barre_fisse(&mut scelta, &gia_messa);
    disegno::applica(&scelta);
    (modo, diagnosi, scelta)
}

/// Dice all'host su quale webview gira la shell, dove un default ne dipende
/// ([`fub_host::settings::motion_default`]).
///
/// Su Linux è WebKitGTK, e la versione è quella della libreria **caricata**:
/// `tauri::webview_version` chiama `webkit_get_{major,minor,micro}_version`
/// tramite wry. Le altre piattaforme non dichiarano niente e restano come
/// prima. Una versione illeggibile lascia la webview non dichiarata, cioè i
/// default di sempre.
///
/// Va chiamata prima di [`percorso_di_disegno`], che legge il valore effettivo
/// di `appearance.motion` e quindi il suo default, e prima che esista il log:
/// restituisce la versione letta, o il problema, e chi chiama lo scrive dopo
/// ([`log_the_webview`]).
fn declare_the_webview() -> Option<Result<String, String>> {
    #[cfg(target_os = "linux")]
    return Some(match tauri::webview_version() {
        Ok(version) => match fub_host::settings::Webview::webkitgtk(&version) {
            Some(webview) => {
                fub_host::settings::declare_webview(webview);
                Ok(version)
            }
            None => Err(format!("unreadable webkitgtk version {version}")),
        },
        Err(error) => Err(format!("webkitgtk version unavailable: {error}")),
    });
    #[cfg(not(target_os = "linux"))]
    None
}

/// Scrive nel log quello che [`declare_the_webview`] ha trovato.
fn log_the_webview(declared: Option<Result<String, String>>) {
    match declared {
        Some(Ok(version)) => tracing::info!(target: "fub.app", %version, "webkitgtk"),
        Some(Err(problem)) => tracing::warn!(target: "fub.app", %problem, "webkitgtk version"),
        None => {}
    }
}

pub fn run() {
    // `--version` e `--help` rispondono ed escono prima di tutto il resto:
    // niente finestra, niente Tauri, niente configurazione né log.
    if let Some(codice) = riga_di_comando::rispondi(std::env::args_os().skip(1)) {
        std::process::exit(codice);
    }
    // Il bootstrap sceglie la cartella canonica una volta sola. Log, host e
    // store installato ricevono lo stesso valore: nessun proprietario riapre
    // l'ambiente o deduce una seconda posizione.
    let config_dir = fub_host::config_dir();
    // Il percorso di disegno della webview **prima di ogni thread**: le
    // variabili di WebKitGTK contano solo se scritte prima che parta GTK, e
    // `set_var` è sicura solo finché il processo ha un thread solo — qui, e
    // non dopo `install_logging` (vedi `disegno::applica`). Prima ancora la
    // webview: il livello macchina riceve lo schema, e con lui il default delle
    // animazioni che il percorso di disegno legge, quando lo si apre.
    let webview = declare_the_webview();
    // Il vblank emulato si decide anche lui prima che parta GTK: WebKit crea
    // il suo monitor del vblank dopo, e la decisione non cambia più.
    #[cfg(target_os = "linux")]
    let vblank = vblank::prepara(
        webview
            .as_ref()
            .and_then(|letta| letta.as_ref().ok())
            .map(String::as_str),
        std::env::var_os(vblank::INTERRUTTORE).as_deref(),
    );
    #[cfg(target_os = "linux")]
    let orologio = orologio::prepara(std::env::var_os(orologio::INTERRUTTORE).as_deref());
    #[cfg(target_os = "linux")]
    let percorso = percorso_di_disegno(
        config_dir.as_deref(),
        webview
            .as_ref()
            .and_then(|letta| letta.as_ref().ok())
            .map(String::as_str),
    );
    let (levels, warning) = fub_host::install_logging(config_dir.as_deref());
    log_the_webview(webview);
    #[cfg(target_os = "linux")]
    vblank::scrivi_nel_log(&vblank);
    #[cfg(target_os = "linux")]
    appunti_gtk::scrivi_nel_log();
    #[cfg(target_os = "linux")]
    orologio::scrivi_nel_log(&orologio);
    let installed_availability = match config_dir.as_deref() {
        Some(dir) => {
            tracing::info!(
                target: "fub.app",
                config_dir = %dir,
                "opening installed plugin manager"
            );
            match InstalledPluginManager::open(dir) {
                Ok(manager) => InstalledAvailability::Ready(Arc::new(manager)),
                Err(error) => {
                    tracing::error!(
                        target: "fub.app",
                        config_dir = %dir,
                        error = %error,
                        "installed plugin manager unavailable"
                    );
                    InstalledAvailability::Failed(error)
                }
            }
        }
        None => InstalledAvailability::NotConfigured,
    };
    let limited = limited_startup(config_dir.as_deref());

    // Il sink è un parametro del montaggio, quindi l'host si costruisce qui e
    // non nel `setup`; l'handle che gli manca ce lo mette il `setup` (vedi
    // `WebviewEvents`).
    let sink = Arc::new(WebviewEvents::default());
    let bridge = sink.clone();
    // La webview è già dichiarata (in cima): il livello macchina dell'host
    // riceve lo schema, e con lui il default delle animazioni, nel costruttore.
    let mut host = Host::new();
    if let Some(dir) = config_dir.as_deref() {
        host = host.with_config_dir(dir);
    }
    host = host
        .with_session_notice(warning)
        .with_levels(levels)
        .with_sink(sink);
    #[cfg(target_os = "linux")]
    {
        let (modo, diagnosi, scelta) = percorso;
        tracing::info!(
            target: "fub.app",
            ?modo,
            ?diagnosi,
            software = diagnosi.disegno_software(),
            variabili = ?scelta.variabili,
            avvisi = ?scelta.avvisi,
            "rendering path chosen before GTK"
        );
        for avviso in scelta.avvisi {
            match serde_json::to_value(&avviso) {
                Ok(payload) => {
                    host = host.with_startup_notice(Notice::new(
                        fub_abi::Event::Custom {
                            topic: disegno::TOPIC.into(),
                            payload,
                        },
                        fub_abi::event::Origin::by(fub_abi::event::Actor::Kernel),
                    ));
                }
                Err(error) => tracing::warn!(target: "fub.app", %error, "rendering notice lost"),
            }
        }
    }
    // Keep the manager alive in `InstalledPlugins`; the startup source is the
    // sole host integration point and its snapshot also carries formats.
    if let InstalledAvailability::Ready(manager) = &installed_availability {
        let source: Arc<dyn fub_host::StartupSource> = if let Some(reason) = &limited.reason {
            manager.limited_startup(reason.clone())
        } else {
            manager.clone()
        };
        host = host.with_startup_source(source);
    }

    let mut builder = tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("fub-asset", |context, request, responder| {
            let app = context.app_handle().clone();
            let label = context.webview_label().to_string();
            std::thread::spawn(move || {
                let result = (|| {
                    let uri = request.uri();
                    let valid_host =
                        matches!(uri.host(), Some("localhost" | "fub-asset.localhost"));
                    // L'URL canonico resta quello costruito da `asset_url`: nessuna forma alternativa.
                    let _canonical = resources::asset_url(fub_host::resources::ResourceHandle(0));
                    if !valid_host || uri.query().is_some() {
                        return Err(PluginError::BadArgs("invalid asset URL authority".into()));
                    }
                    let window = app.get_webview_window(&label).ok_or_else(|| {
                        PluginError::PermissionDenied(
                            "asset requester has no trusted webview".into(),
                        )
                    })?;
                    let origin = window
                        .url()
                        .map_err(|error| PluginError::Internal(error.to_string().into()))?;
                    let range = request
                        .headers()
                        .get(tauri::http::header::RANGE)
                        .map(|header| {
                            header
                                .to_str()
                                .map_err(|_| PluginError::BadArgs("invalid Range header".into()))
                        })
                        .transpose()?;
                    let served = resources::handle_asset_request(
                        &*app.state::<Host>(),
                        &label,
                        origin.as_str(),
                        uri.path(),
                        range,
                    )?;
                    // `devUrl` vale soltanto nelle build di sviluppo.
                    let dev = if cfg!(debug_assertions) {
                        app.config()
                            .build
                            .dev_url
                            .as_ref()
                            .map(|url| url.origin().ascii_serialization())
                    } else {
                        None
                    };
                    let cors = resources::asset_cors_origin(
                        request.method().as_str(),
                        request
                            .headers()
                            .get(tauri::http::header::ORIGIN)
                            .and_then(|value| value.to_str().ok()),
                        dev.as_deref(),
                    );
                    resources::asset_http_response(served, cors)
                })();
                let response = result.unwrap_or_else(|error| {
                    let status = match error {
                        PluginError::PermissionDenied(_) => 403,
                        PluginError::NotFound(_) | PluginError::BadArgs(_) => 404,
                        _ => 500,
                    };
                    tauri::http::Response::builder()
                        .status(status)
                        .header("cache-control", "no-store")
                        .body(Vec::new())
                        .expect("static asset error response")
                });
                responder.respond(response);
            });
        })
        .manage(host)
        .manage(InstalledPlugins::new(installed_availability))
        .manage(ViewerConfig(config_dir.clone()))
        .manage(CatalogConfig(config_dir.clone()))
        .manage(limited)
        .manage(document_windows::DocumentWindows::default())
        .manage(domande::Corsie::default())
        .manage(live::LiveSessions::new())
        .on_window_event(|window, event| {
            document_windows::on_window_event(window, event);
            if let tauri::WindowEvent::Destroyed = event {
                let sessions = window.app_handle().state::<live::LiveSessions>();
                if let Some(closing) =
                    sessions.close_owned_by(window.label(), "the window was destroyed")
                {
                    tauri::async_runtime::spawn(closing);
                }
            }
            // La regola pura di sospensione/ripresa resta quella di `mobile::MobileLifecycle`;
            // il ramo nativo la applica solo dove gli eventi OS esistono (`cfg(mobile)`).
            let _lifecycle = [
                mobile::MobileLifecycle::Foreground.step(mobile::MobileLifecycle::Hidden),
                mobile::MobileLifecycle::Suspended.step(mobile::MobileLifecycle::Foreground),
            ];
            #[cfg(mobile)]
            if let Some(action) = mobile::window_event_action(event) {
                let name = match action {
                    mobile::MobileLifecycleAction::KeepOpen => "tauri://suspended",
                    mobile::MobileLifecycleAction::Rejoin => "tauri://resumed",
                };
                let _ = window.emit(name, ());
            }
        });

    #[cfg(not(mobile))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            for raw in args.iter().filter(|arg| arg.starts_with("fub://")) {
                forward_uri(app, raw);
            }
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.set_focus();
            }
        }));
    }
    // Il ponte nativo delle cartelle condivise: nessun comando suo, lo
    // raggiungono soltanto i comandi `mobile_*` qui sopra (`tree_access.rs`).
    #[cfg(mobile)]
    {
        builder = builder.plugin(tree_access::init());
    }
    builder = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init());

    builder
        // Ogni webview, anche le finestre aperte dopo, prende il tetto dei
        // fotogrammi prima di disegnare. Una pagina che si ricarica perde le
        // sue sessioni live: la pagina nuova non ha i loro canali.
        .on_page_load(|webview, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Started {
                let machine = webview.app_handle().state::<Host>().machine_settings();
                frame_rate::apply(webview, frame_rate::beyond_60(&machine));
                // L'orologio dei fotogrammi della finestra alla frequenza
                // dello schermo: una volta per finestra, anche se la pagina
                // si ricarica.
                #[cfg(target_os = "linux")]
                if let Err(error) =
                    webview.with_webview(|platform| orologio::aggancia(&platform.inner()))
                {
                    tracing::debug!(%error, "GTK frame clock not reached");
                }
                let sessions = webview.app_handle().state::<live::LiveSessions>();
                if let Some(closing) =
                    sessions.close_owned_by(webview.label(), "the page is reloading")
                {
                    tauri::async_runtime::spawn(closing);
                }
            }
        })
        .setup(move |app| {
            let _ = bridge.0.set(app.handle().clone());
            // Il tema collegato: gli eventi vanno solo alla finestra
            // principale, e l'osservatore parte se la chiave e la modalità
            // sviluppatore lo dicono (una cartella sparita non ferma l'avvio:
            // lo stato lo dice alla shell). `sync_theme_link` non si ferma qui:
            // legge il disco e monta su un thread del custode.
            {
                let events = app.handle().clone();
                let host = app.state::<Host>();
                host.set_theme_link_sink(std::sync::Arc::new(move |link| {
                    if let Err(error) = events.emit_to("main", THEME_CHANGED, link) {
                        tracing::warn!(target: "fub.app", %error, "the linked theme event did not cross the IPC");
                    }
                }));
                host.sync_theme_link();
            }
            let machine = app.state::<Host>().machine_settings();
            let zoom = machine.iter()
                .find(|entry| entry.spec.key == fub_host::settings::APPEARANCE_ZOOM)
                .and_then(|entry| entry.value.as_number())
                .unwrap_or(fub_host::settings::DEFAULT_ZOOM);
            #[cfg(not(mobile))]
            let system_frame = machine.iter()
                .find(|entry| entry.spec.key == fub_host::settings::CHROME_FRAME)
                .and_then(|entry| entry.value.as_text())
                == Some("system");
            for window in app.webview_windows().values() {
                // Il fondo nativo copre l'attimo prima del primo disegno della
                // pagina (`avvio.rs`). Un errore si ignora: la finestra resta
                // col fondo di serie, un lampo e non un guasto; su mobile il
                // fondo nativo non è supportato e non deve fermare l'avvio.
                let _ = window.set_background_color(Some(avvio::fondo_di_macchina(&machine, window)));
                window.set_zoom(zoom)?;
                #[cfg(not(mobile))]
                if window.label() == "main" {
                    window.set_decorations(system_frame)?;
                    // La `main` nasce nascosta (`tauri.conf.json`) perché si
                    // veda già col suo fondo: mostrarla non dipende dal colore,
                    // e una finestra che non si mostra è peggio di un lampo.
                    if let Err(error) = window.show() {
                        tracing::warn!(%error, "main window not shown");
                    }
                }
            }
            #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]
            for raw in std::env::args().filter(|arg| arg.starts_with("fub://")) {
                forward_uri(app.handle(), &raw);
            }
            #[cfg(not(mobile))]
            start_control(app);
            #[cfg(not(mobile))]
            promemoria::start(app.handle());
            // Il banco della memoria (R1) può chiedere la raccolta forzata
            // della WebView, ma soltanto in una build con `bench-gc`; senza
            // `FUB_BENCH_GC` non succede niente.
            #[cfg(feature = "bench-gc")]
            bench_gc::install(app);
            #[cfg(not(feature = "bench-gc"))]
            if std::env::var_os("FUB_BENCH_GC").is_some() {
                tracing::warn!(
                    target: "fub.app",
                    "FUB_BENCH_GC ignored: this build has no bench-gc feature"
                );
            }
            Ok(())
        })
        .invoke_handler(ipc::handler())
        .build(tauri::generate_context!())
        .expect("error during Fub startup")

        // **Chi chiude sa che sta chiudendo** (§9.5). Il kernel non può saperlo:
        // non sa quando finisce un lotto, e finché l'unico chiamante di
        // `flush_indexes` era il callback del watcher, la durabilità di un
        // indice dipendeva da un componente opzionale. Qui invece il fatto è
        // certo, ed è l'ultimo momento in cui si può dire a qualcuno di
        // chiudersi: `Host::close` fa il giro su ogni vault aperto.
        //
        // `Exit` e non `ExitRequested`: il secondo si può annullare, e chiudere
        // gli indici di un vault che poi resta aperto sarebbe peggio che non
        // chiuderli.
        .run(|app, event| {
            #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
            if let tauri::RunEvent::Opened { urls } = &event {
                for url in urls {
                    #[cfg(mobile)]
                    forward_mobile_opened(app, url.as_str());
                    #[cfg(not(mobile))]
                    if url.scheme() == uri::URI_SCHEME {
                        forward_uri(app, url.as_str());
                    }
                }
            }
            if let tauri::RunEvent::ExitRequested { api, .. } = &event {
                if let Some(main) = app.get_webview_window("main") {
                    // OS Quit skips the window's CloseRequested event. Redirect
                    // it through the main webview's drain/flush path instead.
                    api.prevent_exit();
                    if let Err(error) = main.close() {
                        tracing::error!(target: "fub.app", %error, "could not request main window drain");
                    }
                } else if app.state::<document_windows::DocumentWindows>().has_children() {
                    // A force-destroyed main cannot drain surviving children.
                    api.prevent_exit();
                    tracing::error!(target: "fub.app", "cannot exit with live document windows and no main window");
                }
            }
            if let tauri::RunEvent::Exit = event {
                // Il canale di controllo si chiude prima dei vault: nessuna
                // domanda della CLI arriva a una sessione che si sta chiudendo.
                #[cfg(not(mobile))]
                if let Some(control) = app.try_state::<ControlChannel>() {
                    if let Some(server) = control.0.lock().ok().and_then(|mut slot| slot.take()) {
                        server.close();
                    }
                }
                // Lo scrittore riceve `bye` prima che il runtime cada con il
                // processo; le sessioni non toccano i vault, che si chiudono
                // dopo.
                tauri::async_runtime::block_on(
                    app.state::<live::LiveSessions>().close_on_exit(),
                );
                // L'osservatore del tema collegato si smonta prima dei vault.
                app.state::<Host>().close_theme_link();
                let shutdown = app.state::<InstalledPlugins>().begin_shutdown();
                for and in app.state::<Host>().close() {
                    // L'app sta uscendo: il ponte verso la shell sta morendo e
                    // non c'è nessuno che disegna un evento. Resta il log, che è
                    // ciò che il bundle diagnostico (§15.2) raccoglierà — e il
                    // fatto che un indice non si sia chiuso pulito è una
                    // diagnosi per chi sviluppa, non una cosa che l'utente può
                    // ancora riparare a schermo spento (0062).
                    tracing::warn!(target: "fub.app", "vault closure: {and}");
                }
                // Il lease di scrittura fra processi è delle sessioni: l'host
                // l'ha lasciato chiudendo ciascuna, dopo il suo teardown.
                match shutdown {
                    Ok(Some(shutdown)) => {
                        if let Err(and) = shutdown.finish() {
                            tracing::error!(
                                target: "fub.app",
                                "installed plugin manager did not drain: {and}"
                            );
                        }
                    }
                    Ok(None) => {}
                    Err(and) => tracing::error!(
                        target: "fub.app",
                        "installed plugin manager did not begin shutdown; host closure completed: {and}"
                    ),
                }
            }
        });
}

#[cfg(test)]
mod drawing_ipc_tests;

/// Le porte uscite dal thread principale tengono l'ordine che lui dava: le
/// prove passano per le stesse funzioni dei comandi, con un host vero su un
/// vault temporaneo.
#[cfg(test)]
mod lane_ipc_tests;

#[cfg(test)]
mod installed_ipc_tests;
