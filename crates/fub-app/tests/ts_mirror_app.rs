//! Il gemello di `crates/fub-features/tests/ts_mirror.rs` per i tipi che il
//! webview riceve dall'**app** e non dal contratto: `VaultInfo`, `EmbedContent`.
//! Erano il caso peggiore del confine — mirror TS di struct dell'app che nessun
//! test legava.
//!
//! `WorkspaceMeta` stava qui, e non ci sta più: col §11.3 è diventata
//! `Organization` ed è **salita nel contratto** (`fub_abi::organization`),
//! quindi il suo campione è nel mirror gemello — quello delle risposte del
//! canale dati, dove ora la si chiede.
//!
//! Stesso meccanismo: la fixture è generata da serde (la stessa
//! serializzazione che attraversa l'IPC), committata, e verificata dal lato TS
//! in `apps/client/src/host/mirror.test.ts`. Rigenerazione:
//! `UPDATE_MIRROR=1 cargo test -p fub-app --test ts_mirror_app`.

use fub_abi::error::PluginError;
use fub_abi::format::SourceKind;
use fub_abi::options::permission;
use fub_abi::theme::ThemeLight;
use fub_abi::traits::PluginPermissions;
use fub_abi::ui::UiNode;
use fub_app_lib::{
    BundleInfo, DemoClosed, DocumentSource, EmbedContent, InstalledPluginInfo, LiveAddress,
    LiveStart, LiveStarted, OpenVaults, ThemeInfo, ThemePayload, UnreadDoc, VaultEntry, VaultInfo,
};
use fub_host::registry::BundleKind;
use fub_host::support::{
    ConfigFileKind, ConfigReport, ConfigStatus, DemoOpened, DiagnosticSummary, ExportConsent,
    MachineSummary, RecoverAction, RecoverOutcome, SupportPreview, VaultSummary,
};
use fub_kernel::{
    PluginInfo, Registration, RegistrationKind, RenderedDocument, RenderedPart, Trust,
};
use fub_live::clock::ClockEstimate;
use fub_live::counter::{Counter, WriterId};
use fub_live::host::{
    EndReason, LeaveReason, LiveEvent, LiveStatus, Pairing, PendingCommit, ReleaseReason,
    SessionInfo, ShellMessage, Stats, StopReport, WriterStatus,
};
use fub_live::protocol::{
    Caps, Device, InkBegin, InkPoints, NackReason, Ops, StrokeId, Tool, View,
};
use fub_live::token::{Fingerprint, SessionId};
use fub_wasm_host::installed::Consent;
use serde_json::{json, Value};

fn to_value<T: serde::Serialize>(v: T) -> Value {
    serde_json::to_value(v).expect("serializza")
}

fn expected() -> Value {
    // La costruzione con TUTTI i campi è la guardia di esaustività: un campo
    // aggiunto a una struct non compila finché non è anche qui.
    json!({
        "VaultInfo": [to_value(VaultInfo {
            root: "/vault".into(),
            extensions: vec!["md".into()],
            // Il campione porta un plugin con una registrazione: un inventario
            // vuoto sarebbe una lista, non l'inventario del §7.6, e non
            // proverebbe la forma di ciò che la shell deve saper leggere.
            plugins: vec![PluginInfo {
                id: "fub.versioning".into(),
                name: "Versioning".into(),
                version: "0.1.0".into(),
                abi_version: "0.1.0".into(),
                trust: Trust::Core,
                permissions: PluginPermissions::core().granted,
                registrations: vec![Registration {
                    kind: RegistrationKind::EventHandler,
                    id: "fub.versioning".into(),
                }],
            }],
            // Il campione porta uno scarto, e non una lista vuota: `unread`
            // vuoto è il caso normale ma non prova **niente** della forma di
            // ciò che la shell dovrà saper leggere il giorno del §20.4.
            unread: vec![UnreadDoc {
                doc_id: "rotta.md".into(),
                why: PluginError::Io("permission denied".into()),
            }],
        })],
        // L'inventario del §7.6 ha un campione **suo** e non solo quello
        // annidato in `VaultInfo`: il lato TS pretende che ogni tipo della
        // tabella dei mirror abbia dei casi, e un tipo che vive solo dentro un
        // altro non verrebbe controllato campo per campo.
        "PluginInfo": [to_value(PluginInfo {
            id: "com.acme.tasks".into(),
            name: "Tasks".into(),
            version: "2.1.0".into(),
            abi_version: "0.1.0".into(),
            trust: Trust::Community,
            // Un permesso che porta un PARAMETRO: è la forma che un booleano
            // non poteva avere (decisione 0017), e il mirror deve vederla.
            permissions: PluginPermissions::of(&[permission::READ_VAULT])
                .granted
                .with(permission::NETWORK, serde_json::json!(["api.acme.com"])),
            registrations: vec![
                Registration {
                    kind: RegistrationKind::View,
                    id: "com.acme.tasks:board".into(),
                },
                Registration {
                    kind: RegistrationKind::Command,
                    id: "com.acme.tasks:archive".into(),
                },
            ],
        })],
        // `UnreadDoc` ha un campione **suo** per la stessa ragione di
        // `PluginInfo`: vive solo dentro `VaultInfo`, e un tipo annidato che
        // non compare nella tabella dei mirror non viene controllato campo per
        // campo.
        "UnreadDoc": [to_value(UnreadDoc {
            doc_id: "rotta.md".into(),
            why: PluginError::Io("permission denied".into()),
        })],
        "EmbedContent": [to_value(EmbedContent {
            doc_id: "a.md".into(),
            content: RenderedDocument::html("<p>x</p>"),
        })],
        // Il campione ha una parte: una `RenderedDocument` senza parti è
        // esattamente la stringa di prima, e non proverebbe il canale che
        // questa seduta apre (§3.2, §3.3).
        "RenderedDocument": [to_value(RenderedDocument {
            html: "<p>a</p><div class=\"ui-slot\" data-ui-slot=\"0\" data-custom-kind=\"fub:diagram\"></div>".into(),
            parts: vec![RenderedPart {
                slot: 0,
                kind: "fub:diagram".into(),
                node: UiNode::text("graph TD;"),
            }],
        })],
        // `GraphData` non c'è più: il grafo non ha un tipo dell'app perché non
        // ha più un comando dell'app (§5.4). I nodi sono una `index-query`
        // `documents`, gli archi una `neighbors` con i semi su tutto il vault,
        // e le due risposte sono tipi del **contratto** — quindi stanno nella
        // fixture gemella, non qui.
        // I vault aperti (§9.6): il campione ne ha due e uno corrente, perché
        // con uno solo la forma non direbbe niente di ciò che il record esiste
        // per dire — che «corrente» è uno dei tanti, non l'unico possibile.
        "OpenVaults": [to_value(OpenVaults {
            roots: vec!["/vault".into(), "/altro".into()],
            current: Some("/vault".into()),
        })],
        "DocumentSource": [to_value(DocumentSource {
            text: "# Nota".into(),
            revision: "sha256:abc".into(),
            format_id: Some("markdown".into()),
            source_kind: SourceKind::Text,
        })],
        // I componenti che questo host sa montare (§11.1): il campione ne ha
        // uno acceso e uno spento, perché con uno solo il record non direbbe
        // ciò per cui esiste — che «spento» è uno stato, non un'assenza.
        //
        // I due permessi (§23.17) sono anche loro una coppia scelta: uno
        // **senza** parametro e uno **con**, perché la differenza fra le due
        // forme è precisamente la frase che l'utente legge accettando — «può
        // connettersi a qualunque host» non è «può connettersi ad api.acme.com»
        // — e un campione con la sola forma nuda non proverebbe che la seconda
        // attraversa l'IPC.
        "BundleInfo": [
            to_value(BundleInfo {
                id: "fub.versioning".into(),
                name: "Versioning".into(),
                mounted: true,
                kind: BundleKind::Component,
                trust: Trust::Core,
                permissions: PluginPermissions::core().granted,
            }),
            to_value(BundleInfo {
                id: "fub.stats".into(),
                name: "Statistiche".into(),
                mounted: false,
                kind: BundleKind::Component,
                trust: Trust::Community,
                permissions: fub_abi::options::OptionMap::new()
                    .on(permission::READ_VAULT)
                    .with(permission::NETWORK, json!(["api.acme.com"])),
            }),
        ],
        "ThemeInfo": [to_value(ThemeInfo {
            manifest: fub_abi::theme::ThemeManifest {
                id: "acme.paper".into(),
                name: "Paper".into(),
                version: "1.0.0".into(),
                engine: fub_abi::theme::ThemeEngine::Theme1,
                lights: vec![ThemeLight::Light, ThemeLight::Dark],
                asset_namespace: "theme://acme.paper/".into(),
                motion: vec![
                    fub_abi::theme::ThemeMotion::Opacity,
                    fub_abi::theme::ThemeMotion::Transform,
                ],
            },
            trust: "community",
        })],
        "ThemePayload": [to_value(ThemePayload {
            manifest: fub_abi::theme::ThemeManifest {
                id: "acme.paper".into(),
                name: "Paper".into(),
                version: "1.0.0".into(),
                engine: fub_abi::theme::ThemeEngine::Theme1,
                lights: vec![ThemeLight::Light, ThemeLight::Dark],
                asset_namespace: "theme://acme.paper/".into(),
                motion: vec![
                    fub_abi::theme::ThemeMotion::Opacity,
                    fub_abi::theme::ThemeMotion::Transform,
                ],
            },
            light: ThemeLight::Light,
            sheet: ":root { --paper: #fff; }".into(),
            skin: Some(".paper { color: var(--paper); }".into()),
            assets: [("theme://acme.paper/fonts/paper.woff2".into(), vec![1_u8, 2, 3])]
                .into_iter()
                .collect(),
        })],
        "InstalledPluginInfo": [to_value(InstalledPluginInfo {
            bundle: BundleInfo {
                id: "com.acme.tasks".into(),
                name: "Tasks".into(),
                mounted: true,
                kind: BundleKind::Component,
                trust: Trust::Community,
                permissions: PluginPermissions::of(&[permission::READ_VAULT]).granted,
            },
            installation: u64::MAX,
            version: "2.1.0".into(),
            enabled: true,
            consent: Consent::Granted,
            catalog: None,
            revoked: false,
            revocation: None,
            runtime_known: true,
        })],
        // Il registro dei vault (§11.1): quello appuntato con la sua icona e un
        // recente nudo, perché i campi opzionali hanno due forme e il mirror
        // deve reggerle entrambe. Il primo porta anche una scorciatoia già
        // guardata (§23.13), che è l'unico campo del registro a non descrivere
        // il vault ma cosa questa macchina ha visto di lui.
        "VaultEntry": [
            to_value(VaultEntry {
                root: "/vault".into(),
                name: "Diario".into(),
                icon: Some("📓".into()),
                favorite: true,
                last_opened: 1_700_000_000_000,
                keys_seen: [("keys.note.create".to_string(), "Mod-Alt-k".to_string())]
                    .into_iter()
                    .collect(),
            }),
            to_value(VaultEntry {
                root: "/altro".into(),
                name: String::new(),
                icon: None,
                favorite: false,
                last_opened: 1_699_000_000_000,
                keys_seen: Default::default(),
            }),
        ],
        // Comandi locali dell'app: serializzazione reale dei record di supporto,
        // compresa la versione futura che supera il limite esatto di JS Number.
        "DemoOpened": [
            to_value(DemoOpened { root: "/config/demo-vault".into(), previous: Some("/vault".into()) }),
            to_value(DemoOpened { root: "/config/demo-vault".into(), previous: None }),
        ],
        "DemoClosed": [
            to_value(DemoClosed { errors: vec![PluginError::Io("flush failed".into())], current: Some("/vault".into()) }),
            to_value(DemoClosed { errors: vec![], current: None }),
        ],
        "DiagnosticSummary": [to_value(DiagnosticSummary {
            kind: "cancelled".into(), help: "help.cancelled".into(),
        })],
        "VaultSummary": [to_value(VaultSummary {
            root: "/config/demo-vault".into(),
            watching: true,
            startup_diagnostics: vec![DiagnosticSummary {
                kind: "cancelled".into(), help: "help.cancelled".into(),
            }],
        })],
        "MachineSummary": [to_value(MachineSummary {
            settings_keys: vec!["locale.language".into()],
            known_vaults: 2,
            log_path: None,
        })],
        "SupportPreview": [to_value(SupportPreview {
            v: 1,
            at: 1_700_000_000_000,
            fub: "1.0".into(),
            vault: Some(VaultSummary {
                root: "/config/demo-vault".into(),
                watching: true,
                startup_diagnostics: vec![DiagnosticSummary {
                    kind: "cancelled".into(), help: "help.cancelled".into(),
                }],
            }),
            machine: MachineSummary {
                settings_keys: vec!["locale.language".into()],
                known_vaults: 2,
                log_path: None,
            },
            log_tail: vec![],
            note: "redacted".into(),
        })],
        "ExportConsent": [to_value(ExportConsent {
            acknowledged_preview: true, include_log: false,
            destination: "/outside/support.json".into(),
        })],
        "ConfigFileKind": [
            to_value(ConfigFileKind::MachineSettings),
            to_value(ConfigFileKind::VaultRegistry),
            to_value(ConfigFileKind::ViewState),
        ],
        "ConfigStatus": [
            to_value(ConfigStatus::Healthy),
            to_value(ConfigStatus::Missing),
            to_value(ConfigStatus::Unreadable { reason: "invalid JSON".into() }),
            to_value(ConfigStatus::FutureVersion { found: "9007199254740993".into(), supported: 1 }),
        ],
        "ConfigReport": [to_value(ConfigReport {
            kind: ConfigFileKind::MachineSettings,
            path: "/config/settings.json".into(),
            status: ConfigStatus::FutureVersion { found: "9007199254740993".into(), supported: 1 },
        })],
        "RecoverAction": [
            to_value(RecoverAction::BackupOnly),
            to_value(RecoverAction::ResetEmpty),
            to_value(RecoverAction::RestoreBackup { backup: "/config/settings.json.bak".into() }),
        ],
        "RecoverOutcome": [
            to_value(RecoverOutcome { backup: Some("/config/settings.json.bak".into()),
                detail: "restored".into(), restart_required: true }),
            to_value(RecoverOutcome { backup: None,
                detail: "nothing to back up".into(), restart_required: false }),
        ],
    })
}

/// La sessione live (ADR 0204): ciò che `live_*` restituisce e ciò che il
/// canale porta. `u64` come stringhe decimali, come nel protocollo.
fn live_samples() -> serde_json::Map<String, Value> {
    let ops = || Ops::from_values(&[json!({ "op": "add", "parent": "l1a2b3c4d" })], 16).unwrap();
    let stroke = || StrokeId::parse("o7k2m9x4q").unwrap();
    let device = || Device {
        name: "Tablet".into(),
        kind: "tablet".into(),
    };
    let caps = || Caps {
        pressure: true,
        tilt: false,
        coalesced: true,
        predicted: false,
    };
    let clock = || ClockEstimate {
        offset_ms: -12.5,
        rtt_ms: Some(8.0),
    };
    let info = |host_name: Option<&str>| SessionInfo {
        session: SessionId::parse("AAAAAAAAAAA").unwrap(),
        addr: "192.168.1.20:52114".parse().unwrap(),
        fingerprint: Fingerprint::of_certificate(b"certificate"),
        host_name: host_name.map(Into::into),
    };
    let pairing = || Pairing {
        payload: String::from("fubdraw://live?v=1").into(),
        qr_svg: "<svg xmlns=\"http://www.w3.org/2000/svg\"/>".into(),
        expires_in_ms: 300_000,
    };
    let address = |addr: &str, default_route| LiveAddress {
        addr: addr.into(),
        interface: "wlan0".into(),
        default_route,
    };
    let pending = || PendingCommit {
        writer: WriterId(1),
        c: Counter(4),
        ops: ops(),
    };
    let writer = |connected, resume_expires_in_ms, clock| WriterStatus {
        writer: WriterId(1),
        device: device(),
        caps: caps(),
        connected,
        resume_expires_in_ms,
        last_c: Counter(3),
        clock,
    };
    let stats = Stats {
        accepted: 3,
        refused: 0,
        admitted: 2,
        rejected: 1,
        commits: 4,
        answered: 3,
    };

    let events = vec![
        LiveEvent::WriterConnected {
            writer: WriterId(1),
            device: device(),
            caps: caps(),
            resumed: false,
        },
        LiveEvent::WriterDisconnected {
            writer: WriterId(1),
            reason: LeaveReason::Lost,
            resumable: true,
        },
        LiveEvent::WriterReleased {
            writer: WriterId(1),
            reason: ReleaseReason::ResumeExpired,
        },
        LiveEvent::InkBegin(InkBegin {
            s: stroke(),
            layer: "l1a2b3c4d".into(),
            tool: Tool::Pen,
            fill: "#0072b2".into(),
            fill_opacity: 1.0,
            brush: "pf1 size=4".into(),
        }),
        LiveEvent::InkPoints(InkPoints {
            s: stroke(),
            pts: vec![[10.0, 20.0, 0.5, 1000.0], [11.5, 21.25, 0.55, 1008.0]],
        }),
        LiveEvent::InkEnd { s: stroke() },
        LiveEvent::InkCancel { s: stroke() },
        LiveEvent::InkGap {
            strokes: vec![stroke()],
        },
        LiveEvent::View(View {
            x: -40.0,
            y: 12.5,
            scale: 1.5,
            w: 1280.0,
            h: 800.0,
        }),
        LiveEvent::Commit {
            writer: WriterId(1),
            c: Counter(4),
            ops: ops(),
        },
        LiveEvent::Clock(clock()),
        LiveEvent::PairingExpired,
        LiveEvent::SnapshotWanted,
        LiveEvent::Ended {
            reason: EndReason::ReadOnly,
        },
    ];
    // Ogni variante ha un campione: una nuova non compila finché non è nella
    // `match`, e la `match` non passa finché non ha il suo campione.
    let variant = |event: &LiveEvent| match event {
        LiveEvent::WriterConnected { .. } => 0,
        LiveEvent::WriterDisconnected { .. } => 1,
        LiveEvent::WriterReleased { .. } => 2,
        LiveEvent::InkBegin(_) => 3,
        LiveEvent::InkPoints(_) => 4,
        LiveEvent::InkEnd { .. } => 5,
        LiveEvent::InkCancel { .. } => 6,
        LiveEvent::InkGap { .. } => 7,
        LiveEvent::View(_) => 8,
        LiveEvent::Commit { .. } => 9,
        LiveEvent::Clock(_) => 10,
        LiveEvent::PairingExpired => 11,
        LiveEvent::SnapshotWanted => 12,
        LiveEvent::Ended { .. } => 13,
    };
    let covered: std::collections::BTreeSet<usize> = events.iter().map(variant).collect();
    assert_eq!(
        covered,
        (0..14).collect(),
        "a LiveEvent variant has no sample"
    );

    // La richiesta di `live_start` la scrive la shell: il campione è quello che
    // Rust accetta, con e senza l'indirizzo.
    let starts = [
        json!({
            "document": { "id": "disegni/schizzo.svg", "title": "Schizzo" },
            "snapshot": { "seq": "0", "text": "<svg/>" },
            "address": "192.168.1.20",
        }),
        json!({
            "document": { "id": "disegni/schizzo.svg", "title": "Schizzo" },
            "snapshot": { "seq": "0", "text": "<svg/>" },
        }),
    ];
    for start in &starts {
        serde_json::from_value::<LiveStart>(start.clone()).expect("live_start accepts the sample");
    }
    // Anche i messaggi verso lo scrittore li scrive la shell, e Rust li rilegge.
    let messages = vec![
        ShellMessage::Ack {
            writer: WriterId(1),
            c: Counter(4),
            seq: Counter(9),
            echo: ops(),
            duplicate: false,
        },
        ShellMessage::Nack {
            writer: WriterId(1),
            c: Counter(5),
            reason: NackReason::MissingParent,
            detail: "the parent does not exist".into(),
            index: Some(0),
        },
        ShellMessage::Nack {
            writer: WriterId(1),
            c: Counter(6),
            reason: NackReason::Limit,
            detail: String::new(),
            index: None,
        },
        ShellMessage::Ops {
            seq: Counter(10),
            ops: ops(),
        },
        ShellMessage::Snapshot {
            seq: Counter(11),
            text: "<svg/>".into(),
        },
    ];
    for message in &messages {
        let value = to_value(message);
        let read: ShellMessage =
            serde_json::from_value(value).expect("the shell message reads back");
        assert_eq!(&read, message);
    }

    let mut samples = serde_json::Map::new();
    let mut put = |name: &str, values: Vec<Value>| {
        samples.insert(name.into(), Value::Array(values));
    };
    put("LiveStart", starts.to_vec());
    put(
        "LiveStarted",
        vec![to_value(LiveStarted {
            session: info(Some("Studio")),
            pairing: pairing(),
            addresses: vec![address("192.168.1.20", true), address("10.0.0.5", false)],
        })],
    );
    put(
        "SessionInfo",
        vec![to_value(info(Some("Studio"))), to_value(info(None))],
    );
    put("Pairing", vec![to_value(pairing())]);
    put("LiveAddress", vec![to_value(address("192.168.1.20", true))]);
    put("LiveEvent", events.iter().map(to_value).collect());
    put(
        "LeaveReason",
        [
            LeaveReason::Lost,
            LeaveReason::Heartbeat,
            LeaveReason::WriterBye,
            LeaveReason::SessionEnded,
            LeaveReason::Congested,
            LeaveReason::TooMuchTraffic,
            LeaveReason::Violation { code: 4002 },
        ]
        .into_iter()
        .map(to_value)
        .collect(),
    );
    put(
        "ReleaseReason",
        vec![
            to_value(ReleaseReason::ResumeExpired),
            to_value(ReleaseReason::PairingRenewed),
        ],
    );
    put(
        "EndReason",
        [
            EndReason::HostClosing,
            EndReason::Terminated,
            EndReason::DocumentClosed,
            EndReason::ReadOnly,
        ]
        .into_iter()
        .map(to_value)
        .collect(),
    );
    put(
        "LiveStatus",
        vec![
            to_value(LiveStatus {
                ended: false,
                seq: Counter(9),
                pairing_expires_in_ms: None,
                writer: Some(writer(true, None, Some(clock()))),
                pending: vec![pending()],
                stats,
            }),
            to_value(LiveStatus {
                ended: false,
                seq: Counter(0),
                pairing_expires_in_ms: Some(300_000),
                writer: None,
                pending: vec![],
                stats: Stats::default(),
            }),
        ],
    );
    put(
        "WriterStatus",
        vec![
            to_value(writer(true, None, Some(clock()))),
            to_value(writer(false, Some(120_000), None)),
        ],
    );
    put(
        "ClockEstimate",
        vec![
            to_value(clock()),
            to_value(ClockEstimate {
                offset_ms: 0.0,
                rtt_ms: None,
            }),
        ],
    );
    put("PendingCommit", vec![to_value(pending())]);
    put("Stats", vec![to_value(stats)]);
    put(
        "StopReport",
        vec![
            to_value(StopReport {
                pending: vec![pending()],
            }),
            to_value(StopReport { pending: vec![] }),
        ],
    );
    put("ShellMessage", messages.iter().map(to_value).collect());
    put(
        "NackReason",
        [
            NackReason::MissingTarget,
            NackReason::MissingParent,
            NackReason::MissingAnchor,
            NackReason::DuplicateId,
            NackReason::InvalidElem,
            NackReason::Locked,
            NackReason::Foreign,
            NackReason::Cycle,
            NackReason::Limit,
            NackReason::ReadOnly,
        ]
        .into_iter()
        .map(to_value)
        .collect(),
    );
    samples
}

fn fixture_path() -> std::path::PathBuf {
    std::path::PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/client/src/__fixtures__/mirror-samples-app.json"
    ))
}

#[test]
fn the_app_side_ts_mirror_fixture_is_in_sync_with_the_rust_types() {
    let mut expected = expected();
    expected
        .as_object_mut()
        .expect("the samples are an object")
        .extend(live_samples());
    let path = fixture_path();

    if std::env::var_os("UPDATE_MIRROR").is_some() {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).expect("crea la cartella delle fixture");
        }
        let mut json = serde_json::to_string_pretty(&expected).expect("pretty");
        json.push('\n');
        std::fs::write(&path, json).expect("scrive la fixture");
        return;
    }

    let committed = std::fs::read_to_string(&path).unwrap_or_else(|and| {
        panic!(
            "fixture dei mirror dell'app mancante ({}): {and}. Rigenerala con \
             `UPDATE_MIRROR=1 cargo test -p fub-app --test ts_mirror_app`.",
            path.display()
        )
    });
    let committed: Value = serde_json::from_str(&committed).expect("fixture JSON valida");

    assert_eq!(
        committed, expected,
        "la fixture dei mirror dell'app è stantia: un tipo è cambiato senza \
         rigenerarla (`UPDATE_MIRROR=1 cargo test -p fub-app --test \
         ts_mirror_app`), poi riallinea `apps/client/src/host/contract.ts` finché \
         `mirror.test.ts` non torna verde."
    );
}
