//! **I temi come bundle** (§29.4): una pelle dichiarata da un
//! [`ThemeManifest`], installata nella cartella di configurazione della
//! macchina e montata dalla stessa porta dei componenti — il
//! [`BundleRegistry`].
//!
//! Un tema non è un componente: non ha provider, non dichiara permessi e non
//! offre comandi. Ma è montato **dalla stessa porta**, e questa è la scelta:
//! il §9.3 dice che un bundle è «un plugin e i provider che registra», e un
//! tema è l'angolo estremo di quella definizione — un plugin **senza** provider
//! e senza permessi, che esiste per dare un proprietario dichiarato al foglio
//! che la shell disegna. La riga «cosa registri» è vuota, ma la strada — la
//! versione del contratto, la dichiarazione, l'attivazione, i provider — è la
//! stessa dei componenti, e con lei le due cose che il §29.4 chiede: il tema di
//! serie passa dalla stessa porta del tema di terzi (niente seconda porta), e
//! l'interruttore dei componenti (`plugins.disabled`) vale anche per lui.
//!
//! # Il contratto del manifest, e dove si applica
//!
//! Un tema dichiara la versione del contratto **per la pelle**, non per il
//! codice: uno dei [`ThemeEngine`] conosciuti. L'host li trasporta tutti; quale
//! la shell sappia vestire lo decide la shell, che è l'unica ad avere
//! un'anatomia. È l'analogo dell'`abi_version` di un plugin, e come
//! quello si verifica **prima** di qualunque altra cosa — prima di
//! `remember`, prima dell'inventario — e chi non la rispetta è respinto con la
//! stessa forma del [`BundleError::Abi`]: non è un difetto del tema, è un tema
//! che parla un contratto che questo host non serve.
//!
//! La seconda porta è **i permessi**: un tema non ne dichiara, e un manifest
//! che ne porta uno è rifiutato per nome. Un tema con permessi sarebbe un tema
//! che non è solo una pelle — e la pelle non può chiedere di leggere il vault
//! a nome suo.
//!
//! La terza è la **forma**: id che è anche una cartella (un solo componente di
//! path, senza `.`/`..`), almeno una luce, e un `asset_namespace` che sta
//! davvero sotto `theme://…`. I cancelli *CSS* veri — che il foglio non tocchi
//! fuori dalla propria pasta, che la sintassi regga — girano al montaggio nella
//! shell, che è l'unica che ha un renderer; qui si valida ciò che è valido
//! senza renderer: manifest, struttura e namespace.
//!
//! # Le impostazioni di un tema
//!
//! Da `theme-2` un tema può dichiarare delle impostazioni
//! ([`ThemeSetting`]): interruttori, numeri fra un minimo e un massimo, e
//! scelte, che il suo autore lascia a chi lo usa. Non hanno una porta loro. Il bundle le porta nel proprio
//! [`PluginManifest`] come [`SettingSpec`], e da lì sono impostazioni come le
//! altre: stesso registro, stessa lettura, stessa scrittura, stesso evento. Ciò
//! che l'autore non decide lo mette l'host — la chiave è `<id>:<nome>`, il
//! livello è la macchina (come il tema scelto), il gruppo è il nome del tema.
//!
//! # Un tema che eredita
//!
//! Da `theme-2` un manifest può dire da quale tema parte: `extends`, e l'unico
//! valore accettato è la serie ([`SERIES_ID`]). Un tema così porta solo ciò
//! che cambia: i fogli diventano facoltativi ([`read_theme`] dà `sheet: None`
//! per una luce senza foglio, e la shell usa quello di serie), ma `lights`
//! resta obbligatorio, perché dice quali luci il tema offre. Un tema che
//! eredita e non porta niente — né fogli, né pelle, né asset — è rifiutato.
//! Senza `extends` tutto resta com'era: un foglio per ogni luce offerta.
//!
//! # I caratteri di un tema
//!
//! Da `theme-2` un manifest può portare dei caratteri
//! ([`ThemeFont`](fub_abi::theme::ThemeFont)): una
//! famiglia, un file WOFF2 fra i suoi asset (`fonts/<nome>.woff2`), un peso e
//! uno stile. Il CSS di un tema resta senza `@font-face`: la regola la scrive
//! la shell, coi valori del manifest e l'URL `data:` del file, così nessun
//! `src:` scritto a mano può chiamare la rete. Qui (`check_fonts` e
//! `check_font_files`) si decide ciò che si decide senza renderer: la forma
//! di ogni voce, che la famiglia non sia una di serie, che il file ci sia e
//! cominci con la firma `wOF2`, e i limiti ([`MAX_THEME_FONTS`],
//! [`MAX_THEME_FONT_BYTES`], [`MAX_THEME_FONT_TOTAL_BYTES`]).
//!
//! # Le icone di un tema
//!
//! Da `theme-2` un manifest può nominare un set di icone (`icons`): un asset
//! JSON, `{ "<nome>": ["<d>", …] }`, che ridisegna per nome le icone della
//! shell. Il tema porta soltanto i `d` dei tracciati; il costrutto (griglia,
//! tratto, colore) resta quello della shell. Qui (`check_icons`) si legge il
//! file e si chiede ogni voce alla regola del contratto
//! ([`theme_icon_fault`](fub_abi::rules::theme_icons::theme_icon_fault), la
//! stessa che la shell rispecchia), coi limiti ([`MAX_THEME_ICONS`],
//! [`MAX_THEME_ICON_PATHS`], [`MAX_THEME_ICON_BYTES`],
//! [`MAX_THEME_ICONS_BYTES`]). Quali nomi la shell sa disegnare non lo sa
//! l'host: un nome che oggi nessuno disegna non rifiuta il tema.
//!
//! # L'installazione è una cartella, e atomica
//!
//! Un tema installato è `<config>/themes/<id>/` (vedi
//! [`themes_dir`](crate::config::themes_dir)): il manifest `manifest.json`
//! accanto al foglio, alla pelle e agli asset. Si installa **una cartella alla
//! volta** — l'archivio `.zip`/`.tar` non è nel grafo delle dipendenze
//! (decisione 0001) e un parser scritto a mano è peggio della feature che
//! risparmia — e si installa **atomica**: prima si valida tutto (manifest,
//! porte, id) e si copia in una cartella temporanea `themes/.tmp-…`, poi un
//! `rename` la pubblica con il nome giusto. Un errore in qualunque passo lascia
//! al più una cartella temporanea, che l'errore stesso rimuove; l'id della
//! destinazione non esiste mai «a metà». Le due difese di chi installa sono il
//! **traversal** (un file della cartella che punta fuori, o un link simbolico)
//! e la **collisione** (un id che c'è già: `AlreadyExists`, e non si tocca
//! niente).

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::rules::theme_font::{
    theme_font_fault, ThemeFontFault, MAX_THEME_FONT_FILE_NAME, THEME_FONT_WEIGHTS,
};
use fub_abi::rules::theme_icons::{
    theme_icon_fault, theme_icons_file_holds, ThemeIconFault, MAX_THEME_ICONS_FILE_NAME,
    MAX_THEME_ICON_NAME,
};
use fub_abi::settings::{SettingKind, SettingSpec};
use fub_abi::theme::{
    ThemeEngine, ThemeFontStyle, ThemeLight, ThemeManifest, ThemeSetting, MAX_THEME_FONTS,
    MAX_THEME_FONT_BYTES, MAX_THEME_FONT_FAMILY, MAX_THEME_FONT_TOTAL_BYTES, MAX_THEME_ICONS,
    MAX_THEME_ICONS_BYTES, MAX_THEME_ICON_BYTES, MAX_THEME_ICON_PATHS, MAX_THEME_SETTINGS,
    THEME_ENGINE,
};
use fub_abi::traits::{Plugin, PluginManifest};
use fub_abi::{PluginError, Text};

use crate::registry::{BundleKind, OnlyProviders};
use std::fs::{File, OpenOptions};
use std::io::{self, Read, Write};

mod assets;
mod bundle;
mod discover;
mod files;
mod install;
mod pointer;

use assets::{asset_inventory, validate_asset_limits, MAX_THEME_ASSET_BYTES};
pub use bundle::{series_manifest, ThemeBundle, ThemeError, ThemeInfo, ThemePayload};
use discover::selected_theme_dir;
pub use discover::{discover_themes, list_themes, read_theme};
use files::{
    canonical_theme_root, check_id, create_nofollow, open_regular, open_themes_root,
    read_theme_bytes, read_theme_text, verify_themes_root,
};
pub use install::{
    install_theme, install_theme_checked, set_theme_revoked, set_theme_revoked_with_provenance,
    theme_catalog_provenance, theme_revocation_provenance, theme_revoked, uninstall_theme,
    update_theme,
};
pub use pointer::theme_tree_digest;
use pointer::{
    publish_theme_pointer, read_theme_pointer, write_theme_pointer, ThemePointer, ThemeVersion,
    POINTER_FILE,
};

/// L'id del tema di serie. È l'unico id che l'host conosce per nome, per le
/// stesse ragioni per cui conosce [`CORE_ID`](crate::settings::CORE_ID): è
/// l'id di ciò che è **dell'host** e non può essere installato o disinstallato
/// da un tema di terze parti. Il manifest qui sotto è la costante del §29.4, ed
/// è il gemello di quello che il banco di `fub-abi` tiene fermo.
pub const SERIES_ID: &str = "fub.serie";

/// Il prefisso delle cartelle temporanee d'installazione dentro `themes/`
/// (vedi [`install_theme`]).
///
/// È una costante e non una stringa scritta due volte perché la scansione
/// ([`discover_themes`]) e l'installazione devono riconoscere la stessa cosa:
/// un prefisso in due punti è un prefisso che può divergere, e la divergenza
/// sarebbe un residuo di crash esposto come «tema rotto». Il nome è una
/// iniziale di nascosto, e `check_id` la respinge: un tema non può chiamarsi
/// così, quindi il prefisso è riservato all'installatore.
pub(crate) const STAGING_PREFIX: &str = ".tmp-";
/// Hard upper bound for the JSON manifest read from an installed theme.
pub const MAX_THEME_MANIFEST_BYTES: u64 = 64 * 1024;
/// Hard upper bound for each CSS sheet or optional skin.
pub const MAX_THEME_CSS_BYTES: u64 = 4 * 1024 * 1024;
/// Quanto può essere lungo il nome di un'impostazione di tema, o il valore di
/// una sua opzione: finiscono in un attributo della radice del documento.
pub const MAX_THEME_SETTING_NAME: usize = 48;
/// Quante opzioni può offrire una scelta di un tema.
pub const MAX_THEME_SETTING_OPTIONS: usize = 16;

/// La firma con cui comincia ogni file WOFF2.
const WOFF2_SIGNATURE: &[u8; 4] = b"wOF2";

/// Le impostazioni di un tema reggono come impostazioni del registro?
///
/// Si decide qui, alla lettura del manifest, e non al montaggio: un tema che
/// dichiara male non si installa e non compare, invece di installarsi e poi
/// restare spento per un rifiuto del registro che nessuno collegherebbe al
/// manifest.
fn check_settings(manifest: &ThemeManifest) -> Result<(), ThemeError> {
    let bad = |why: String| ThemeError::Malformed(why);
    if manifest.settings.is_empty() {
        return Ok(());
    }
    if manifest.engine == ThemeEngine::Theme1 {
        return Err(bad(format!(
            "settings need `{}`: `{THEME_ENGINE}` has none",
            ThemeEngine::Theme2.as_str()
        )));
    }
    if manifest.settings.len() > MAX_THEME_SETTINGS {
        return Err(bad(format!(
            "{} settings declared, at most {MAX_THEME_SETTINGS} are allowed",
            manifest.settings.len()
        )));
    }
    // La chiave è `<id>:<nome>`: un id che contiene già il separatore darebbe
    // una chiave che il registro legge come di qualcun altro.
    if manifest.id.contains(':') {
        return Err(bad(format!(
            "a theme whose id contains `:` cannot declare settings: `{}`",
            manifest.id
        )));
    }
    let mut seen = std::collections::BTreeSet::new();
    for setting in &manifest.settings {
        let name = setting.name.as_str();
        if !is_setting_token(name) {
            return Err(bad(format!(
                "setting name `{name}` must be 1 to {MAX_THEME_SETTING_NAME} characters \
                 of a-z, 0-9 or `-`, starting with a letter"
            )));
        }
        if !seen.insert(name) {
            return Err(bad(format!("setting `{name}` is declared twice")));
        }
        if setting.label.trim().is_empty() {
            return Err(bad(format!("setting `{name}` has no label")));
        }
        match &setting.kind {
            SettingKind::Toggle { .. } => {}
            SettingKind::Number { default, min, max } => {
                // I due estremi sono d'obbligo: chi usa il tema regola un
                // numero con un cursore, e un cursore ha un inizio e una fine.
                let (Some(min), Some(max)) = (min, max) else {
                    return Err(bad(format!("setting `{name}` needs both `min` and `max`")));
                };
                if !(default.is_finite() && min.is_finite() && max.is_finite() && min <= max) {
                    return Err(bad(format!("setting `{name}` has an invalid range")));
                }
            }
            SettingKind::Choice { options, .. } => {
                if options.is_empty() || options.len() > MAX_THEME_SETTING_OPTIONS {
                    return Err(bad(format!(
                        "setting `{name}` must offer 1 to {MAX_THEME_SETTING_OPTIONS} options"
                    )));
                }
                let mut values = std::collections::BTreeSet::new();
                for option in options {
                    if !is_setting_token(&option.value) {
                        return Err(bad(format!(
                            "setting `{name}` has an option `{}` that is not a-z, 0-9 or `-`",
                            option.value
                        )));
                    }
                    if !values.insert(option.value.as_str()) {
                        return Err(bad(format!(
                            "setting `{name}` offers `{}` twice",
                            option.value
                        )));
                    }
                    // Prosa, come l'etichetta dell'impostazione: un tema non
                    // ha un catalogo da cui risolvere una chiave.
                    if !matches!(&option.label, Text::Literal(label) if !label.trim().is_empty()) {
                        return Err(bad(format!(
                            "setting `{name}` has an option `{}` without a plain label",
                            option.value
                        )));
                    }
                }
            }
            SettingKind::Text { .. } | SettingKind::List { .. } => {
                return Err(bad(format!(
                    "setting `{name}` must be a toggle, a number or a choice"
                )));
            }
        }
        // Il default deve reggere il proprio schema: è il valore che vale
        // finché nessuno sceglie, e il registro non lo ricontrolla.
        if let Some(why) = setting.kind.rejects(&setting.kind.default_value()) {
            return Err(bad(format!(
                "setting `{name}` has an invalid default: {why}"
            )));
        }
    }
    Ok(())
}

/// Il tema da cui un manifest dichiara di partire regge?
///
/// L'unica base è la serie, e solo col motore `theme-2`: `theme-1` è congelato
/// (ADR 0206) e non impara a ereditare. Il valore si confronta così com'è,
/// senza togliere spazi: un id con uno spazio è un altro id.
fn check_extends(manifest: &ThemeManifest) -> Result<(), ThemeError> {
    let Some(base) = manifest.extends.as_deref() else {
        return Ok(());
    };
    if base != SERIES_ID {
        return Err(ThemeError::Malformed(format!(
            "`extends` must be `{SERIES_ID}`, the only theme a theme can start from, not `{base}`"
        )));
    }
    if manifest.engine == ThemeEngine::Theme1 {
        return Err(ThemeError::Malformed(format!(
            "`extends` needs `{}`: `{THEME_ENGINE}` cannot inherit",
            ThemeEngine::Theme2.as_str()
        )));
    }
    Ok(())
}

/// I caratteri del manifest reggono? Si decide sulla sola forma, prima di
/// toccare il disco: motore, quanti sono, ogni voce secondo la regola del
/// contratto ([`theme_font_fault`], la stessa che la shell rispecchia), e che
/// la stessa faccia non sia dichiarata due volte. I file li guarda
/// [`check_font_files`].
fn check_fonts(manifest: &ThemeManifest) -> Result<(), ThemeError> {
    let bad = |why: String| ThemeError::Malformed(why);
    if manifest.fonts.is_empty() {
        return Ok(());
    }
    if manifest.engine == ThemeEngine::Theme1 {
        return Err(bad(format!(
            "fonts need `{}`: `{THEME_ENGINE}` has none",
            ThemeEngine::Theme2.as_str()
        )));
    }
    if manifest.fonts.len() > MAX_THEME_FONTS {
        return Err(bad(format!(
            "{} fonts declared, at most {MAX_THEME_FONTS} are allowed",
            manifest.fonts.len()
        )));
    }
    let mut faces = std::collections::BTreeSet::new();
    for font in &manifest.fonts {
        let family = font.family.as_str();
        let style = match font.style {
            ThemeFontStyle::Normal => "normal",
            ThemeFontStyle::Italic => "italic",
        };
        if let Some(fault) = theme_font_fault(family, &font.file, f64::from(font.weight), style) {
            return Err(bad(font_fault_message(
                fault,
                family,
                &font.file,
                font.weight,
            )));
        }
        // La famiglia ha già l'alfabeto ASCII della regola, e il motore
        // confronta i nomi di `font-family` senza maiuscole: `Carta` e `carta`
        // sono la stessa faccia.
        if !faces.insert((family.to_ascii_lowercase(), font.weight, font.style)) {
            return Err(bad(format!(
                "font `{family}` declares weight {} and style {style} twice",
                font.weight
            )));
        }
    }
    Ok(())
}

/// La frase per l'autore di un guasto della regola dei caratteri.
fn font_fault_message(fault: ThemeFontFault, family: &str, file: &str, weight: u16) -> String {
    let (lightest, heaviest) = THEME_FONT_WEIGHTS;
    match fault {
        ThemeFontFault::Family => format!(
            "font family `{family}` must be 1 to {MAX_THEME_FONT_FAMILY} characters \
             of letters, digits, `-` and single spaces between words"
        ),
        ThemeFontFault::SeriesFamily => {
            format!("font family `{family}` is a series family: a theme names its own")
        }
        ThemeFontFault::ReservedFamily => {
            format!("font family `{family}` is a CSS keyword, not a family name")
        }
        ThemeFontFault::File => format!(
            "font file `{file}` is not a theme asset: it must be `fonts/<name>.woff2`, \
             with a name of 1 to {MAX_THEME_FONT_FILE_NAME} characters of \
             a-z, A-Z, 0-9, `-` or `_`"
        ),
        ThemeFontFault::Weight => format!(
            "font `{family}` declares weight {weight}, which is not between \
             {lightest} and {heaviest}"
        ),
        // Lo stile arriva già tipato da serde: un valore sconosciuto non
        // diventa mai un `ThemeFont`.
        ThemeFontFault::Style => format!("font `{family}` declares an unknown style"),
    }
}

/// I file dei caratteri ci sono, sono WOFF2 e stanno nei limiti? Un file
/// nominato da due voci si conta una volta.
fn check_font_files(root: &Utf8Path, manifest: &ThemeManifest) -> Result<(), ThemeError> {
    let files: std::collections::BTreeSet<&str> = manifest
        .fonts
        .iter()
        .map(|font| font.file.as_str())
        .collect();
    let mut total = 0_u64;
    for file in files {
        let path = root.join(file);
        // Il limite degli asset qui, quello dei caratteri subito sotto: così
        // l'autore legge che è il carattere a pesare troppo.
        let Some(handle) = open_regular(&path, root, &manifest.id, MAX_THEME_ASSET_BYTES, false)?
        else {
            return Err(ThemeError::Malformed(format!(
                "font file `{file}` is not among the theme assets"
            )));
        };
        let size = handle
            .metadata()
            .map_err(|error| ThemeError::Io(format!("{path}: {error}")))?
            .len();
        if size > MAX_THEME_FONT_BYTES {
            return Err(ThemeError::Malformed(format!(
                "font file `{file}` exceeds {MAX_THEME_FONT_BYTES} bytes"
            )));
        }
        let mut signature = Vec::with_capacity(WOFF2_SIGNATURE.len());
        handle
            .take(WOFF2_SIGNATURE.len() as u64)
            .read_to_end(&mut signature)
            .map_err(|error| ThemeError::Io(format!("{path}: {error}")))?;
        if signature.as_slice() != WOFF2_SIGNATURE {
            return Err(ThemeError::Malformed(format!(
                "font file `{file}` is not WOFF2: it does not start with `wOF2`"
            )));
        }
        total = total.saturating_add(size);
        if total > MAX_THEME_FONT_TOTAL_BYTES {
            return Err(ThemeError::Malformed(format!(
                "the theme fonts exceed {MAX_THEME_FONT_TOTAL_BYTES} bytes together"
            )));
        }
    }
    Ok(())
}

/// Il set di icone del manifest regge? Il motore, il nome del file, il file
/// fra gli asset entro [`MAX_THEME_ICONS_BYTES`], un oggetto JSON di al più
/// [`MAX_THEME_ICONS`] nomi, e ogni voce secondo la regola del contratto
/// ([`theme_icon_fault`], la stessa che la shell rispecchia).
fn check_icons(root: &Utf8Path, manifest: &ThemeManifest) -> Result<(), ThemeError> {
    let bad = |why: String| ThemeError::Malformed(why);
    let Some(file) = manifest.icons.as_deref() else {
        return Ok(());
    };
    if manifest.engine == ThemeEngine::Theme1 {
        return Err(bad(format!(
            "icons need `{}`: `{THEME_ENGINE}` has none",
            ThemeEngine::Theme2.as_str()
        )));
    }
    if !theme_icons_file_holds(file) {
        return Err(bad(format!(
            "icon set `{file}` is not a theme asset: it must be `<name>.json` beside the \
             manifest, with a name of 1 to {MAX_THEME_ICONS_FILE_NAME} characters of \
             lowercase ASCII letters, digits, `-` or `_`, and not `manifest`"
        )));
    }
    let path = root.join(file);
    // Il limite degli asset qui, quello del set subito sotto: così l'autore
    // legge che è il set a pesare troppo.
    let Some(handle) = open_regular(&path, root, &manifest.id, MAX_THEME_ASSET_BYTES, false)?
    else {
        return Err(bad(format!(
            "icon set `{file}` is not among the theme assets"
        )));
    };
    let mut raw = Vec::new();
    handle
        .take(MAX_THEME_ICONS_BYTES.saturating_add(1))
        .read_to_end(&mut raw)
        .map_err(|error| ThemeError::Io(format!("{path}: {error}")))?;
    if raw.len() as u64 > MAX_THEME_ICONS_BYTES {
        return Err(bad(format!(
            "icon set `{file}` exceeds {MAX_THEME_ICONS_BYTES} bytes"
        )));
    }
    let set: serde_json::Map<String, serde_json::Value> = serde_json::from_slice(&raw)
        .map_err(|error| bad(format!("icon set `{file}` is not a JSON object: {error}")))?;
    if set.len() > MAX_THEME_ICONS {
        return Err(bad(format!(
            "icon set `{file}` redraws {} icons, at most {MAX_THEME_ICONS} are allowed",
            set.len()
        )));
    }
    for (name, value) in &set {
        let paths: Vec<&str> = value
            .as_array()
            .and_then(|items| items.iter().map(serde_json::Value::as_str).collect())
            .ok_or_else(|| {
                bad(format!(
                    "icon `{name}` in `{file}` is not a list of path data"
                ))
            })?;
        if let Some(fault) = theme_icon_fault(name, &paths) {
            return Err(bad(icon_fault_message(fault, name, file)));
        }
    }
    Ok(())
}

fn icon_fault_message(fault: ThemeIconFault, name: &str, file: &str) -> String {
    match fault {
        ThemeIconFault::Name => format!(
            "icon name `{name}` in `{file}` must be 1 to {MAX_THEME_ICON_NAME} characters of \
             lowercase ASCII letters, digits and `-`, not starting with `-`"
        ),
        ThemeIconFault::Paths => {
            format!("icon `{name}` in `{file}` must have 1 to {MAX_THEME_ICON_PATHS} paths")
        }
        ThemeIconFault::PathData => format!(
            "icon `{name}` in `{file}` accepts only SVG path data: \
             commands, numbers, `.`, `,`, signs and spaces"
        ),
        ThemeIconFault::Bytes => {
            format!("icon `{name}` in `{file}` exceeds {MAX_THEME_ICON_BYTES} bytes of path data")
        }
    }
}

/// Un nome che può stare in un attributo della radice senza essere citato.
fn is_setting_token(token: &str) -> bool {
    token.len() <= MAX_THEME_SETTING_NAME
        && token.starts_with(|c: char| c.is_ascii_lowercase())
        && token
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// La chiave con cui il registro delle impostazioni conosce un'impostazione di
/// tema: dentro l'id del tema, come ogni nome di un componente.
pub fn theme_setting_key(theme: &str, name: &str) -> String {
    format!("{theme}:{name}")
}

/// Un'impostazione di tema come impostazione del registro.
fn setting_spec(manifest: &ThemeManifest, setting: &ThemeSetting) -> SettingSpec {
    SettingSpec::new(
        theme_setting_key(&manifest.id, &setting.name),
        Text::Literal(setting.label.clone()),
        setting.kind.clone(),
    )
    .describing(Text::Literal(setting.description.clone()))
    .grouped(Text::Literal(manifest.name.clone()))
    .for_machine()
}

fn sheet_path(dir: &Utf8Path, light: ThemeLight) -> Utf8PathBuf {
    let name = match light {
        ThemeLight::Dark => "sheet-dark.css",
        ThemeLight::Light => "sheet-light.css",
    };
    dir.join(name)
}
fn referenced_assets(
    sheet: Option<&str>,
    skin: Option<&str>,
    namespace: &str,
) -> std::collections::BTreeSet<String> {
    let mut urls = std::collections::BTreeSet::new();
    for css in [sheet, skin] {
        let Some(css) = css else { continue };
        let chars: Vec<char> = css.chars().collect();
        let mut index = 0;
        while index < chars.len() {
            if chars[index..].starts_with(&['/', '*']) {
                index = css_skip_comment(&chars, index);
                continue;
            }
            if chars[index] == '\'' || chars[index] == '"' {
                index = css_skip_quoted(&chars, index).unwrap_or(chars.len());
                continue;
            }
            let Some((name, next)) = css_identifier(&chars, index) else {
                index += 1;
                continue;
            };
            let open = css_skip_trivia(&chars, next, chars.len());
            let name = name.to_ascii_lowercase();
            if chars.get(open).copied() == Some('(') {
                if name == "url" {
                    if let Some((value, after)) = css_url_at(&chars, open) {
                        if value.starts_with(namespace) {
                            urls.insert(value);
                        }
                        index = after;
                        continue;
                    }
                } else if css_image_set_name(&name) {
                    css_collect_image_set(&chars, open, namespace, &mut urls);
                    if let Some(close) = css_function_close(&chars, open) {
                        index = close + 1;
                        continue;
                    }
                }
            }
            index = next;
        }
    }
    urls
}

fn css_skip_comment(chars: &[char], start: usize) -> usize {
    let mut index = start.saturating_add(2);
    while index + 1 < chars.len() {
        if chars[index] == '*' && chars[index + 1] == '/' {
            return index + 2;
        }
        index += 1;
    }
    chars.len()
}

fn css_decode_escape(chars: &[char], start: usize) -> (String, usize) {
    let mut index = start.saturating_add(1);
    if index >= chars.len() {
        return (String::new(), index);
    }
    let hex_start = index;
    while index < chars.len() && index - hex_start < 6 && chars[index].is_ascii_hexdigit() {
        index += 1;
    }
    if index > hex_start {
        let mut code = 0_u32;
        for character in &chars[hex_start..index] {
            code = code * 16
                + character
                    .to_digit(16)
                    .expect("is_ascii_hexdigit implies to_digit succeeds");
        }
        if index < chars.len() && chars[index].is_whitespace() {
            index += 1;
        }
        let value = if code == 0 || code > 0x10ffff {
            '\u{fffd}'
        } else {
            char::from_u32(code).unwrap_or('\u{fffd}')
        };
        return (value.to_string(), index);
    }
    if matches!(chars[index], '\n' | '\r' | '\u{000c}') {
        return (String::new(), index + 1);
    }
    (chars[index].to_string(), index + 1)
}

fn css_skip_quoted(chars: &[char], start: usize) -> Option<usize> {
    let quote = *chars.get(start)?;
    if quote != '\'' && quote != '"' {
        return None;
    }
    let mut index = start + 1;
    while index < chars.len() {
        if chars[index] == '\\' {
            index = css_decode_escape(chars, index).1;
        } else if chars[index] == quote {
            return Some(index + 1);
        } else {
            index += 1;
        }
    }
    None
}

fn css_identifier(chars: &[char], start: usize) -> Option<(String, usize)> {
    let mut value = String::new();
    let mut index = start;
    while index < chars.len() {
        let character = chars[index];
        if character == '\\' {
            let (decoded, next) = css_decode_escape(chars, index);
            value.push_str(&decoded);
            index = next;
        } else if character == '-'
            || character == '_'
            || character.is_ascii_alphanumeric()
            || !character.is_ascii()
        {
            value.push(character);
            index += 1;
        } else {
            break;
        }
    }
    (!value.is_empty()).then_some((value, index))
}

fn css_skip_trivia(chars: &[char], start: usize, end: usize) -> usize {
    let mut index = start;
    while index < end {
        if chars[index].is_whitespace() {
            index += 1;
        } else if index + 1 < end && chars[index] == '/' && chars[index + 1] == '*' {
            index = css_skip_comment(chars, index).min(end);
        } else {
            break;
        }
    }
    index
}

fn css_function_close(chars: &[char], open: usize) -> Option<usize> {
    let mut depth = 1_u32;
    let mut index = open + 1;
    while index < chars.len() {
        if index + 1 < chars.len() && chars[index] == '/' && chars[index + 1] == '*' {
            index = css_skip_comment(chars, index);
        } else if chars[index] == '\'' || chars[index] == '"' {
            index = css_skip_quoted(chars, index)?;
        } else if chars[index] == '\\' {
            index = css_decode_escape(chars, index).1;
        } else if chars[index] == '(' {
            depth += 1;
            index += 1;
        } else if chars[index] == ')' {
            depth -= 1;
            if depth == 0 {
                return Some(index);
            }
            index += 1;
        } else {
            index += 1;
        }
    }
    None
}

fn css_string(chars: &[char], start: usize, end: usize) -> String {
    chars[start..end].iter().collect()
}

fn css_trim_range(chars: &[char], start: usize, end: usize) -> (usize, usize) {
    let mut value_start = start;
    let mut value_end = end;
    while value_start < value_end && chars[value_start].is_whitespace() {
        value_start += 1;
    }
    while value_end > value_start && chars[value_end - 1].is_whitespace() {
        value_end -= 1;
    }
    (value_start, value_end)
}

fn css_url_at(chars: &[char], open: usize) -> Option<(String, usize)> {
    let close = css_function_close(chars, open)?;
    let mut cursor = css_skip_trivia(chars, open + 1, close);
    if cursor >= close {
        return Some((String::new(), close + 1));
    }
    if chars[cursor] == '\'' || chars[cursor] == '"' {
        let quote = chars[cursor];
        let quote_end = css_skip_quoted(chars, cursor)?;
        if quote_end > close || chars.get(quote_end.saturating_sub(1)) != Some(&quote) {
            return None;
        }
        let (value_start, value_end) = css_trim_range(chars, cursor + 1, quote_end - 1);
        let value = decode_css_escapes(&css_string(chars, value_start, value_end))
            .trim()
            .to_string();
        cursor = css_skip_trivia(chars, quote_end, close);
        return (cursor == close).then_some((value, close + 1));
    }
    let value_start = cursor;
    while cursor < close {
        if chars[cursor] == '\\' {
            cursor = css_decode_escape(chars, cursor).1;
        } else {
            cursor += 1;
        }
    }
    let (value_start, value_end) = css_trim_range(chars, value_start, cursor);
    let value = decode_css_escapes(&css_string(chars, value_start, value_end))
        .trim()
        .to_string();
    Some((value, close + 1))
}

fn css_image_set_name(name: &str) -> bool {
    matches!(name, "image-set" | "-webkit-image-set")
}

fn css_top_level_ranges(chars: &[char], start: usize, end: usize) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    let mut depth = 0_u32;
    let mut piece = start;
    let mut index = start;
    while index < end {
        if index + 1 < end && chars[index] == '/' && chars[index + 1] == '*' {
            index = css_skip_comment(chars, index).min(end);
        } else if chars[index] == '\'' || chars[index] == '"' {
            index = css_skip_quoted(chars, index).unwrap_or(end).min(end);
        } else if chars[index] == '\\' {
            index = css_decode_escape(chars, index).1.min(end);
        } else if chars[index] == '(' {
            depth += 1;
            index += 1;
        } else if chars[index] == ')' {
            depth = depth.saturating_sub(1);
            index += 1;
        } else if chars[index] == ',' && depth == 0 {
            ranges.push((piece, index));
            piece = index + 1;
            index += 1;
        } else {
            index += 1;
        }
    }
    ranges.push((piece, end));
    ranges
}

fn css_collect_image_set(
    chars: &[char],
    open: usize,
    namespace: &str,
    urls: &mut std::collections::BTreeSet<String>,
) {
    let Some(close) = css_function_close(chars, open) else {
        return;
    };
    for (start, end) in css_top_level_ranges(chars, open + 1, close) {
        let cursor = css_skip_trivia(chars, start, end);
        if cursor >= end {
            continue;
        }
        if chars[cursor] == '\'' || chars[cursor] == '"' {
            let quote = chars[cursor];
            let Some(quote_end) = css_skip_quoted(chars, cursor) else {
                continue;
            };
            if quote_end > end || chars.get(quote_end.saturating_sub(1)) != Some(&quote) {
                continue;
            }
            let (value_start, value_end) = css_trim_range(chars, cursor + 1, quote_end - 1);
            let value = decode_css_escapes(&css_string(chars, value_start, value_end))
                .trim()
                .to_string();
            if value.starts_with(namespace) {
                urls.insert(value);
            }
            continue;
        }
        let Some((name, next)) = css_identifier(chars, cursor) else {
            continue;
        };
        if !name.eq_ignore_ascii_case("url") {
            continue;
        }
        let image_open = css_skip_trivia(chars, next, end);
        if chars.get(image_open).copied() != Some('(') {
            continue;
        }
        let Some(image_close) = css_function_close(chars, image_open) else {
            continue;
        };
        if image_close >= end {
            continue;
        }
        if let Some((value, _)) = css_url_at(chars, image_open) {
            if value.starts_with(namespace) {
                urls.insert(value);
            }
        }
    }
}

fn decode_css_escapes(input: &str) -> String {
    let chars: Vec<char> = input.chars().collect();
    let mut output = String::with_capacity(input.len());
    let mut index = 0;
    while index < chars.len() {
        if chars[index] == '\\' {
            let (decoded, next) = css_decode_escape(&chars, index);
            output.push_str(&decoded);
            index = next;
        } else {
            output.push(chars[index]);
            index += 1;
        }
    }
    output
}

#[cfg(test)]
mod pointer_tests {
    use super::*;

    #[test]
    fn stale_publication_cannot_replace_visible_generation() {
        let temp = tempfile::tempdir().unwrap();
        let root = Utf8PathBuf::from_path_buf(temp.path().join("theme")).unwrap();
        std::fs::create_dir(&root).unwrap();
        // Come ogni chiamante: su macOS il tempdir passa da `/var`.
        let root = canonical_theme_root(&root, "theme").unwrap();
        let pointer = |generation: &str| ThemePointer {
            version: 1,
            generation: generation.into(),
            provenance: None,
            previous: None,
            revoked: false,
            revocation_generation: None,
            revocation_provenance: None,
        };
        let first = pointer("first");
        let second = pointer("second");
        publish_theme_pointer(&root, &first, None).unwrap();
        publish_theme_pointer(&root, &second, Some(&first)).unwrap();
        assert!(publish_theme_pointer(&root, &pointer("stale"), Some(&first)).is_err());
        assert_eq!(
            read_theme_pointer(&root, "theme")
                .unwrap()
                .unwrap()
                .generation,
            "second"
        );
    }
}

#[cfg(test)]
mod escape_tests {
    use super::*;

    /// Un escape che non nomina un valore scalare Unicode (surrogato, zero,
    /// oltre U+10FFFF) vale U+FFFD, come prescrive CSS Syntax, in ogni percorso
    /// che decodifica un url: virgolettato, nudo e dentro `image-set`.
    #[test]
    fn escapes_outside_unicode_scalars_become_the_replacement_character() {
        for code in ["D800", "DFFF", "0", "110000"] {
            let cases = [
                (format!(r#"a{{b:url("x/q\{code}")}}"#), vec!["x/q\u{fffd}"]),
                (format!(r"a{{b:url(x/n\{code})}}"), vec!["x/n\u{fffd}"]),
                (
                    format!(r#"a{{b:image-set("x/s\{code}" 1x, url(x/i\{code}) 2x)}}"#),
                    vec!["x/i\u{fffd}", "x/s\u{fffd}"],
                ),
            ];
            for (css, expected) in cases {
                let expected: std::collections::BTreeSet<String> =
                    expected.into_iter().map(String::from).collect();
                assert_eq!(referenced_assets(Some(&css), None, "x/"), expected, "{css}");
            }
        }
    }
}
