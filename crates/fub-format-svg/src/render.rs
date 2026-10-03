//! L'anteprima di un disegno: un segnaposto, e nient'altro.
//!
//! Il disegno lo mette la shell, che sa caricare i media del vault con il
//! lease del kernel e servire l'SVG come immagine inerte. Qui non nasce né un
//! `<img>` né un URL di risorsa: un riferimento scritto da un provider
//! scavalcherebbe proprio quella risoluzione (ADR 0203).

use fub_abi::html;
use fub_abi::model::{Block, DocumentModel, Inline};

/// `<figure class="fub-scene" data-embed-kind="scene" data-embed-doc="…">`
/// con il titolo nella `<figcaption>` (§9).
///
/// Il titolo si cerca nel corpo, perché con dei renderer registrati il kernel
/// passa un frammento che ha solo i blocchi. Un disegno senza titolo prende il
/// nome del file: la didascalia è il nome accessibile della figura, e un
/// segnaposto muto non direbbe a chi usa un lettore di schermo che cosa c'è.
pub(crate) fn placeholder(model: &DocumentModel) -> String {
    let title = title_of(&model.body)
        .filter(|title| !title.trim().is_empty())
        .unwrap_or_else(|| model.id.page_name().to_owned());
    format!(
        "<figure class=\"fub-scene\" data-embed-kind=\"scene\"{}><figcaption>{}</figcaption></figure>",
        html::attr("data-embed-doc", model.id.as_str()),
        html::escape(&title)
    )
}

/// Il testo del primo heading di livello 1, cercato anche dentro i blocchi
/// custom: nel modello di una scena il titolo sta dentro il riepilogo.
pub(crate) fn title_of(blocks: &[Block]) -> Option<String> {
    blocks.iter().find_map(|block| match block {
        Block::Heading {
            level: 1, inlines, ..
        } => Some(
            inlines
                .iter()
                .filter_map(|inline| match inline {
                    Inline::Text(text) => Some(text.as_str()),
                    _ => None,
                })
                .collect::<String>(),
        ),
        Block::Custom { blocks, .. } => title_of(blocks),
        _ => None,
    })
}
