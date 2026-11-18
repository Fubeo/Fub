//! **Il censimento delle porte è vero** (`docs/reference/censimento-delle-porte.md`).
//!
//! La pagina dice, per ogni riga della mappa dei componenti, quali porte usa e
//! se un componente di terzi la può rifare. È una tabella scritta a mano, e una
//! tabella a mano invecchia in silenzio: una riga nuova nella mappa, un campo in
//! più nell'inventario, e la pagina promette una cosa che il codice non fa più.
//! Questo test la legge e la confronta con il codice, nei due versi.
//!
//! # Che cosa confronta
//!
//! - ogni id di [`righe`] ha una riga sola nella tabella;
//! - ogni riga della tabella ha un id di [`righe`], oppure una cargo feature
//!   dichiarata in `[features]`: è la riga di una feature che questa build non
//!   compila (`draw` fuori dal default, o tutto con `--no-default-features`);
//! - la colonna `cargo feature` è quella della riga della mappa;
//! - la colonna `porte` coincide con i campi pieni della riga d'inventario,
//!   nell'ordine dei campi di `OfficialFeature`, e vale `—` senza inventario;
//! - la colonna `da fuori` è nel vocabolario, ed è quella che il codice
//!   implica: un `HostWiring` diverso da `None` è `solo host`; sintassi,
//!   renderer o export senza collegamento sono `solo nativa`; gli id di
//!   [`NUCLEO`] sono `nucleo`.
//!
//! Ogni errore nomina la riga e che cosa scrivere. Il legame con la pagina è
//! `include_str!`, come in `crates/fub-app/tests/schemas_on_disk.rs`: una pagina
//! che sparisce è un errore di compilazione, non un test che salta.

use std::collections::{BTreeMap, BTreeSet};

use fub_features::componenti::{righe, Riga, NUCLEO};
use fub_features::{every_official_feature, HostWiring, OfficialFeature};

const PAGINA: &str = include_str!("../../../docs/reference/censimento-delle-porte.md");
const INIZIO: &str = "<!-- censimento:funzioni:inizio -->";
const FINE: &str = "<!-- censimento:funzioni:fine -->";
const INTESTAZIONE: [&str; 4] = ["id", "cargo feature", "porte", "da fuori"];
/// La cella di chi non ha niente da dire: niente cargo feature, niente porte.
const NIENTE: &str = "—";

const SI: &str = "sì";
const SOLO_NATIVA: &str = "solo nativa";
const SOLO_HOST: &str = "solo host";
const NUCLEO_: &str = "nucleo";
const CLIENT: &str = "client";
const VOCABOLARIO: [&str; 5] = [SI, SOLO_NATIVA, SOLO_HOST, NUCLEO_, CLIENT];

/// Una riga della tabella 1, con il numero di riga del file per i messaggi.
#[derive(Debug)]
struct RigaTabella {
    linea: usize,
    id: String,
    cargo_feature: String,
    porte: Vec<String>,
    da_fuori: String,
}

/// Una cella senza gli spazi e i backtick che la pagina usa per i nomi.
fn pulita(cella: &str) -> String {
    cella.trim().trim_matches('`').trim().to_string()
}

/// Le celle di una riga Markdown `| a | b |`, quale che sia l'allineamento.
fn celle(riga: &str) -> Vec<String> {
    let riga = riga.trim();
    let riga = riga.strip_prefix('|').unwrap_or(riga);
    let riga = riga.strip_suffix('|').unwrap_or(riga);
    riga.split('|').map(pulita).collect()
}

/// La riga che separa l'intestazione dal corpo: `|---|:--:|`.
fn separatore(celle: &[String]) -> bool {
    celle
        .iter()
        .all(|c| !c.is_empty() && c.chars().all(|ch| matches!(ch, '-' | ':' | ' ')))
}

/// La tabella 1, letta fra i suoi due commenti.
fn tabella() -> Vec<RigaTabella> {
    let inizio = PAGINA
        .find(INIZIO)
        .unwrap_or_else(|| panic!("la pagina del censimento non ha il commento «{INIZIO}»"));
    let fine = PAGINA
        .find(FINE)
        .unwrap_or_else(|| panic!("la pagina del censimento non ha il commento «{FINE}»"));
    assert!(inizio < fine, "«{INIZIO}» deve stare prima di «{FINE}»");
    let prima = PAGINA[..inizio].lines().count();

    let mut righe_tabella = Vec::new();
    let mut intestazione = false;
    for (n, riga) in PAGINA[inizio + INIZIO.len()..fine].lines().enumerate() {
        let linea = prima + n;
        if !riga.trim_start().starts_with('|') {
            continue;
        }
        let celle = celle(riga);
        if !intestazione {
            assert_eq!(
                celle, INTESTAZIONE,
                "riga {linea} della pagina: l'intestazione della tabella 1 deve essere \
                 «| id | cargo feature | porte | da fuori |»"
            );
            intestazione = true;
            continue;
        }
        if separatore(&celle) {
            continue;
        }
        assert_eq!(
            celle.len(),
            INTESTAZIONE.len(),
            "riga {linea} della pagina («{}»): servono quattro celle, id, cargo feature, \
             porte e da fuori",
            riga.trim()
        );
        let porte = if celle[2] == NIENTE {
            Vec::new()
        } else {
            celle[2].split(',').map(pulita).collect()
        };
        righe_tabella.push(RigaTabella {
            linea,
            id: celle[0].clone(),
            cargo_feature: celle[1].clone(),
            porte,
            da_fuori: celle[3].clone(),
        });
    }
    assert!(
        intestazione,
        "la tabella 1 della pagina del censimento è vuota"
    );
    righe_tabella
}

/// Le cargo feature dichiarate in `[features]`.
///
/// È la copia del lettore di `declared()` in `tests/cargo_features.rs` (i test
/// non si importano): si legge il `Cargo.toml` come testo, una chiave per
/// riga, e `default` come lista su più righe, che qui si salta.
fn dichiarate() -> BTreeSet<String> {
    let manifest =
        std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/Cargo.toml")).unwrap();
    let section = manifest
        .split("\n[features]\n")
        .nth(1)
        .expect("il Cargo.toml ha una sezione [features]");
    let section = section.split("\n[").next().unwrap();

    let mut feature = BTreeSet::new();
    let mut inside_default = false;
    for row in section.lines() {
        let row = row.trim();
        if row.is_empty() || row.starts_with('#') {
            continue;
        }
        if inside_default {
            if row.starts_with(']') {
                inside_default = false;
            }
            continue;
        }
        let Some((name, rest)) = row.split_once('=') else {
            continue;
        };
        let name = name.trim();
        if name == "default" {
            inside_default = rest.trim() == "[";
            continue;
        }
        feature.insert(name.to_string());
    }
    feature
}

/// `SearchIndex` → `search-index`, dal nome della variante: una variante nuova
/// ha il suo nome senza che nessuno aggiorni una tabella qui.
fn kebab(wiring: HostWiring) -> String {
    let mut out = String::new();
    for (i, ch) in format!("{wiring:?}").chars().enumerate() {
        if ch.is_ascii_uppercase() {
            if i > 0 {
                out.push('-');
            }
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

/// I campi pieni della riga d'inventario, nell'ordine dei campi.
fn porte_di(feature: &OfficialFeature) -> Vec<String> {
    let mut porte = Vec::new();
    let mut se = |pieno: bool, nome: &str| {
        if pieno {
            porte.push(nome.to_string());
        }
    };
    se(feature.view.is_some(), "vista");
    se(feature.commands.is_some(), "comandi");
    se(feature.index.is_some(), "indice");
    se(feature.syntax.is_some(), "sintassi");
    se(feature.renderers.is_some(), "renderer");
    se(feature.exports.is_some(), "export");
    se(feature.settings.is_some(), "impostazioni");
    if feature.wiring != HostWiring::None {
        porte.push(format!("collegamento:{}", kebab(feature.wiring)));
    }
    porte
}

/// Che cosa dice `da fuori`, ricavato dal codice.
fn da_fuori_di(riga: &Riga, feature: Option<&OfficialFeature>) -> &'static str {
    if NUCLEO.contains(&riga.id) {
        return NUCLEO_;
    }
    match feature {
        Some(f) if f.wiring != HostWiring::None => SOLO_HOST,
        Some(f) if f.syntax.is_some() || f.renderers.is_some() || f.exports.is_some() => {
            SOLO_NATIVA
        }
        Some(_) => SI,
        None if !riga.bundle && !riga.ui.is_empty() => CLIENT,
        None => SOLO_HOST,
    }
}

fn cella_porte(porte: &[String]) -> String {
    if porte.is_empty() {
        NIENTE.to_string()
    } else {
        porte.join(", ")
    }
}

fn riga_attesa(riga: &Riga, feature: Option<&OfficialFeature>) -> String {
    let porte = feature.map(porte_di).unwrap_or_default();
    format!(
        "| `{}` | {} | {} | {} |",
        riga.id,
        riga.cargo_feature
            .map(|f| format!("`{f}`"))
            .unwrap_or_else(|| NIENTE.to_string()),
        cella_porte(&porte),
        da_fuori_di(riga, feature)
    )
}

#[test]
fn la_tabella_delle_funzioni_ufficiali_dice_il_codice() {
    let tabella = tabella();
    let mappa = righe();
    let dichiarate = dichiarate();
    let inventario: BTreeMap<&str, &OfficialFeature> =
        every_official_feature().iter().map(|f| (f.id, f)).collect();
    let mut errori = Vec::new();

    // Una riga d'inventario che non registra niente la rifiuta già `mount.rs`:
    // qui avrebbe porte vuote e un `sì` che non vuol dire niente.
    for feature in every_official_feature() {
        if feature.registers_nothing() {
            errori.push(format!(
                "la riga d'inventario «{}» non registra niente: `fub_host::mount` la \
                 rifiuta, e il censimento non ha porte da dire",
                feature.id
            ));
        }
    }

    // Ogni id della mappa, una riga sola.
    for riga in &mappa {
        let feature = inventario.get(riga.id).copied();
        let trovate: Vec<&RigaTabella> = tabella.iter().filter(|t| t.id == riga.id).collect();
        match trovate.as_slice() {
            [] => errori.push(format!(
                "la riga «{}» della mappa dei componenti manca dalla tabella 1 del \
                 censimento: aggiungi «{}»",
                riga.id,
                riga_attesa(riga, feature)
            )),
            [t] => {
                let feature_attesa = riga.cargo_feature.unwrap_or(NIENTE);
                if t.cargo_feature != feature_attesa {
                    errori.push(format!(
                        "riga {} della pagina («{}»): la cargo feature è «{feature_attesa}», \
                         non «{}»",
                        t.linea, t.id, t.cargo_feature
                    ));
                }
                let porte_attese = feature.map(porte_di).unwrap_or_default();
                if t.porte != porte_attese {
                    errori.push(format!(
                        "riga {} della pagina («{}»): la colonna porte deve essere «{}», \
                         non «{}»",
                        t.linea,
                        t.id,
                        cella_porte(&porte_attese),
                        cella_porte(&t.porte)
                    ));
                }
                let attesa = da_fuori_di(riga, feature);
                if t.da_fuori != attesa {
                    errori.push(format!(
                        "riga {} della pagina («{}»): la colonna da fuori deve essere \
                         «{attesa}», non «{}»",
                        t.linea, t.id, t.da_fuori
                    ));
                }
            }
            doppie => errori.push(format!(
                "la riga «{}» compare {} volte nella tabella 1 (righe {}): tienine una",
                riga.id,
                doppie.len(),
                doppie
                    .iter()
                    .map(|t| t.linea.to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            )),
        }
    }

    // Ogni riga della tabella, nel vocabolario e di qualcuno.
    for t in &tabella {
        if !VOCABOLARIO.contains(&t.da_fuori.as_str()) {
            errori.push(format!(
                "riga {} della pagina («{}»): «{}» non è nel vocabolario di da fuori, \
                 scrivi una di {}",
                t.linea,
                t.id,
                t.da_fuori,
                VOCABOLARIO.join(", ")
            ));
        }
        if mappa.iter().any(|r| r.id == t.id) {
            continue;
        }
        if !dichiarate.contains(&t.cargo_feature) {
            errori.push(format!(
                "riga {} della pagina («{}»): l'id non è nella mappa dei componenti e la \
                 cargo feature «{}» non è dichiarata in [features] di \
                 crates/fub-features/Cargo.toml: togli la riga, o correggi l'id",
                t.linea, t.id, t.cargo_feature
            ));
        }
    }

    assert!(
        errori.is_empty(),
        "il censimento delle porte (docs/reference/censimento-delle-porte.md) non dice il \
         codice:\n- {}",
        errori.join("\n- ")
    );
}

/// Il lettore regge spazi e allineamenti diversi da quelli della pagina.
#[test]
fn il_lettore_regge_spazi_e_allineamenti() {
    assert_eq!(
        celle("|  `fub.x`|`x` |vista,comandi|  sì  |"),
        ["fub.x", "x", "vista,comandi", "sì"]
    );
    assert_eq!(celle("| a | b "), ["a", "b"]);
    assert!(separatore(&celle("|:---|---:| :-: |---|")));
    assert!(!separatore(&celle("| — | — | — | nucleo |")));
}

/// Il nome della variante è quello della pagina.
#[test]
fn il_collegamento_si_scrive_in_kebab_case() {
    assert_eq!(kebab(HostWiring::SearchIndex), "search-index");
    assert_eq!(kebab(HostWiring::VersionStore), "version-store");
    assert_eq!(
        kebab(HostWiring::MachineDictionaries),
        "machine-dictionaries"
    );
}
