//! L'anteprima di un disegno: un segnaposto, e nient'altro.
//!
//! Il disegno lo mette la shell, che sa caricare i media del vault con il
//! lease del kernel e servire l'SVG come immagine inerte. Qui non nasce né un
//! `<img>` né un URL di risorsa: un riferimento scritto da un provider
//! scavalcherebbe proprio quella risoluzione (ADR 0203).

use fub_abi::custom::SECTION_ATTR;
use fub_abi::html;
use fub_abi::model::{Block, DocumentModel, Inline};

use crate::parse::SUMMARY_KIND;

/// `<figure class="fub-scene" data-embed-kind="scene" data-embed-doc="…">`
/// con il titolo nella `<figcaption>` (§9).
///
/// Il titolo si cerca nel corpo, perché con dei renderer registrati il kernel
/// passa un frammento che ha solo i blocchi. Un disegno senza titolo prende il
/// nome del file: la didascalia è il nome accessibile della figura, e un
/// segnaposto muto non direbbe a chi usa un lettore di schermo che cosa c'è.
///
/// L'embed di una tavola, `![[disegno#Copertina]]`, porta la sezione che il
/// kernel ha scelto. La figura la dice in `data-embed-section`, perché la shell
/// mostri la sola tavola, e la didascalia è `titolo · Copertina`: il nome della
/// tavola da solo non direbbe di quale disegno è. La sezione che è il titolo è
/// il disegno intero, e la figura resta quella di sempre.
pub(crate) fn placeholder(model: &DocumentModel) -> String {
    let title = title_of(&model.body).filter(|title| !title.trim().is_empty());
    let section = section_of(&model.body).filter(|section| title.as_deref() != Some(*section));
    let title = title.unwrap_or_else(|| model.id.page_name().to_owned());
    let (named, caption) = match section {
        Some(section) => (
            html::attr("data-embed-section", section),
            format!("{title} · {section}"),
        ),
        None => (String::new(), title),
    };
    format!(
        "<figure class=\"fub-scene\" data-embed-kind=\"scene\"{}{named}><figcaption>{}</figcaption></figure>",
        html::attr("data-embed-doc", model.id.as_str()),
        html::escape(&caption)
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

/// La sezione che il kernel ha scelto per un embed, scritta nel riepilogo; il
/// modello letto da un file non ne ha.
fn section_of(blocks: &[Block]) -> Option<&str> {
    blocks.iter().find_map(|block| match block {
        Block::Custom {
            custom_kind, attrs, ..
        } if custom_kind == SUMMARY_KIND => attrs.get(SECTION_ATTR)?.as_str(),
        _ => None,
    })
}
