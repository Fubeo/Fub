//! I file collegati di un documento Craft: una foto piazzata in un disegno è
//! un link del disegno, che il kernel risolve contro la sua cartella.
//!
//! I formati Craft non dicono con un nome solo dove sta un file piazzato, e
//! [`collect`] lo cerca in più campi ([`LINK_KEYS`]). Le regole sono quelle
//! dei riferimenti di un disegno SVG (`fub-format-svg`, `links.rs`), con una
//! differenza: in un file Craft un percorso che comincia con `/` è del disco,
//! non della radice del vault, e si scarta come gli altri assoluti.

use std::collections::HashSet;
use std::ops::ControlFlow;

use serde_json::Value;

/// I file collegati al massimo per documento.
pub const MAX_LINKS: usize = 1000;
/// I livelli al massimo di JSON che si attraversano.
pub const MAX_DEPTH: usize = 64;

/// I campi il cui valore stringa può essere un file collegato. Si confrontano
/// così come sono scritti.
pub const LINK_KEYS: [&str; 6] = ["href", "src", "path", "file", "uri", "link"];

/// I percorsi relativi dei file collegati che il documento nomina, senza
/// doppioni e nell'ordine in cui si trovano.
///
/// Si attraversano oggetti e array fino a [`MAX_DEPTH`] livelli: il documento
/// è il livello 1, ciò che sta dentro un suo campo il 2, e i campi di un
/// oggetto oltre il livello 64 non si guardano. Si prende il valore stringa
/// di ogni campo di [`LINK_KEYS`] che è un percorso relativo, fino a [`MAX_LINKS`]
/// percorsi.
pub fn collect(doc: &Value) -> Vec<String> {
    let mut found = Found::default();
    // `Break` vuol dire soltanto che il tetto è pieno.
    let _ = visit(doc, 1, &mut found);
    found.paths
}

/// Il percorso del vault che un valore `raw` nomina, relativo al documento,
/// o `None` se non è un file del vault.
///
/// Il valore si ripulisce come lo legge un URL (niente spazi e controlli
/// intorno, niente tabulazioni e a capo dentro), e perde la parte da `#` o da
/// `?` in poi. Si scartano il valore vuoto, ciò che comincia con `/` o `\`
/// (un percorso del disco, `//host`, `\\server`) e ciò che comincia con uno
/// schema `nome:` (`file:`, `data:`, `http:`, `https:`, e anche `C:`, che ha
/// la forma di uno schema di una lettera). Il resto si tiene com'è scritto,
/// `%20` compreso: il kernel lo decodifica quando risolve il link.
pub(crate) fn relative_path(raw: &str) -> Option<String> {
    let url: String = raw
        .trim_matches(|c: char| c <= ' ')
        .chars()
        .filter(|c| !matches!(c, '\t' | '\n' | '\r'))
        .collect();
    let path = match url.find(['#', '?']) {
        Some(cut) => &url[..cut],
        None => url.as_str(),
    };
    if path.is_empty() || path.starts_with(['/', '\\']) || has_scheme(path) {
        return None;
    }
    Some(path.to_owned())
}

/// Vero se `url` comincia con uno schema: una lettera, poi lettere, cifre,
/// `+`, `-` o `.`, fino al primo `:`.
fn has_scheme(url: &str) -> bool {
    let Some(colon) = url.find(':') else {
        return false;
    };
    let mut chars = url[..colon].chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
}

/// I percorsi trovati, nell'ordine, e quelli già visti.
#[derive(Default)]
pub(crate) struct Found {
    pub(crate) paths: Vec<String>,
    seen: HashSet<String>,
}

impl Found {
    /// Aggiunge `path` se è nuovo; `Break` quando il tetto è pieno.
    pub(crate) fn push(&mut self, path: String) -> ControlFlow<()> {
        if !self.seen.contains(&path) {
            self.seen.insert(path.clone());
            self.paths.push(path);
        }
        if self.paths.len() >= MAX_LINKS {
            ControlFlow::Break(())
        } else {
            ControlFlow::Continue(())
        }
    }
}

/// Attraversa `value`, che sta al livello `depth`. La ricorsione non va mai
/// oltre [`MAX_DEPTH`] chiamate, qualunque sia la profondità del documento.
fn visit(value: &Value, depth: usize, found: &mut Found) -> ControlFlow<()> {
    if depth > MAX_DEPTH {
        return ControlFlow::Continue(());
    }
    match value {
        Value::Object(fields) => {
            for (key, field) in fields {
                match field {
                    Value::String(raw) if LINK_KEYS.contains(&key.as_str()) => {
                        if let Some(path) = relative_path(raw) {
                            found.push(path)?;
                        }
                    }
                    _ => visit(field, depth + 1, found)?,
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                visit(item, depth + 1, found)?;
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {}
    }
    ControlFlow::Continue(())
}
