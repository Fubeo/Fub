//! La regola di classificazione del formato della scena (§4), una regola alla
//! volta, nei due versi: che cosa resta modificabile e che cosa diventa
//! estraneo.

mod common;

use common::{at, doc, elements, findings, first, foreign, load, role, text};
use fub_scene::repeat::Repeat;
use fub_scene::{Code, Item, Lifecycle, ReadOnly, Role, StyleFacts, StyleKind, Tool, MAX_DEPTH};

#[path = "classify/attributes.rs"]
mod attributes;
#[path = "classify/repeats.rs"]
mod repeats;
#[path = "classify/resources.rs"]
mod resources;
#[path = "classify/structure.rs"]
mod structure;
#[path = "classify/styles.rs"]
mod styles;
#[path = "classify/symbols.rs"]
mod symbols;
#[path = "classify/text_elements.rs"]
mod text_elements;

/// Il ruolo del primo figlio della `defs` di `doc(<defs>body</defs>)`.
fn resource(body: &str) -> Option<Role> {
    role(&load(&doc(&format!("<defs>{body}</defs>"))), &[0, 0])
}

/// Un simbolo `id` con `body` dentro e gli attributi `attrs` in più.
fn symbol(id: &str, body: &str, attrs: &str) -> String {
    format!(r#"<symbol id="{id}" overflow="visible"{attrs}>{body}</symbol>"#)
}

const RECT: &str = r##"<rect width="10" height="10" fill="#000000"/>"##;

/// Il riquadro del riepilogo di `doc(body)`, come `x y w h`.
fn bbox(body: &str) -> Option<[f64; 4]> {
    load(&doc(body))
        .summary
        .bbox
        .map(|b| [b.x, b.y, b.width, b.height])
}
