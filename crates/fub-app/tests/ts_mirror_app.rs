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
//! in `frontend/src/host/mirror.test.ts`. Rigenerazione: `UPDATE_MIRROR=1 cargo
//! test -p fub-app --test ts_mirror_app`.

use fub_abi::error::PluginError;
use fub_abi::options::permission;
use fub_abi::traits::PluginPermissions;
use fub_abi::ui::UiNode;
use fub_app_lib::{BundleInfo, EmbedContent, OpenVaults, UnreadDoc, VaultEntry, VaultInfo};
use fub_kernel::{
    PluginInfo, Registration, RegistrationKind, RenderedDocument, RenderedPart, Trust,
};
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
                trust: Trust::Core,
                permissions: PluginPermissions::core().granted,
            }),
            to_value(BundleInfo {
                id: "fub.stats".into(),
                name: "Statistiche".into(),
                mounted: false,
                trust: Trust::Community,
                permissions: fub_abi::options::OptionMap::new()
                    .on(permission::READ_VAULT)
                    .with(permission::NETWORK, json!(["api.acme.com"])),
            }),
        ],
        // Il registro dei vault (§11.1): quello appuntato con la sua icona e un
        // recente nudo, perché i campi opzionali hanno due forme e il mirror
        // deve reggerle entrambe.
        "VaultEntry": [
            to_value(VaultEntry {
                root: "/vault".into(),
                name: "Diario".into(),
                icon: Some("📓".into()),
                favorite: true,
                last_opened: 1_700_000_000_000,
            }),
            to_value(VaultEntry {
                root: "/altro".into(),
                name: String::new(),
                icon: None,
                favorite: false,
                last_opened: 1_699_000_000_000,
            }),
        ],
    })
}

fn fixture_path() -> std::path::PathBuf {
    std::path::PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../frontend/src/__fixtures__/mirror-samples-app.json"
    ))
}

#[test]
fn the_app_side_ts_mirror_fixture_is_in_sync_with_the_rust_types() {
    let expected = expected();
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

    let committed = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "fixture dei mirror dell'app mancante ({}): {e}. Rigenerala con \
             `UPDATE_MIRROR=1 cargo test -p fub-app --test ts_mirror_app`.",
            path.display()
        )
    });
    let committed: Value = serde_json::from_str(&committed).expect("fixture JSON valida");

    assert_eq!(
        committed, expected,
        "la fixture dei mirror dell'app è stantia: un tipo è cambiato senza \
         rigenerarla (`UPDATE_MIRROR=1 cargo test -p fub-app --test \
         ts_mirror_app`), poi riallinea `frontend/src/host/contract.ts` finché \
         `mirror.test.ts` non torna verde."
    );
}
