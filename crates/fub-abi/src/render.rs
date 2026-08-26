//! **La resa di un documento** (§16.6): l'anteprima composta e l'embed.
//!
//! Questi tipi vivono nel contratto e non nel kernel perché sono la risposta
//! di [`IndexQuery::RenderPreview`](crate::traits::IndexQuery::RenderPreview) e
//! [`IndexQuery::RenderEmbed`](crate::traits::IndexQuery::RenderEmbed): un
//! `ViewProvider` deve poter chiedere un documento reso come lo chiede la
//! shell, e la forma della risposta è un tipo del contratto. Prima della 0163
//! erano due comandi IPC bespoke della shell (`render_preview`/`render_embed`)
//! e i tipi stavano nel kernel e nell'host — la stessa asimmetria che il canale
//! dati esiste per non avere (difetto 0130).

use serde::{Deserialize, Serialize};

use crate::ui::UiNode;

/// Un'anteprima composta: l'HTML, e le parti **dichiarative** che la shell
/// monta da sé.
///
/// Non è una stringa sola perché `CustomRendering::Ui` non è una stringa: è un
/// albero `UiNode` che attraversa il confine come tutti gli altri e che la shell
/// disegna con lo stesso `mountTree` delle view. È così che il blocco di un
/// plugin arriva a schermo **senza codice nel bundle della shell** — e senza che
/// nessuno debba fidarsi del suo markup, perché un `UiNode` è sicuro per
/// costruzione.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct RenderedDocument {
    pub html: String,
    pub parts: Vec<RenderedPart>,
}

/// Una parte dichiarativa e il buco in cui va.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RenderedPart {
    /// Il numero che compare in `data-ui-slot` nell'HTML.
    pub slot: u32,
    /// Il `custom_kind` che l'ha prodotta: serve alla shell per il CSS e a chi
    /// legge un log per sapere di chi è la parte.
    pub kind: String,
    pub node: UiNode,
}

impl RenderedDocument {
    /// L'anteprima di prima di questa seduta: solo HTML, nessuna parte.
    pub fn html(html: impl Into<String>) -> Self {
        RenderedDocument {
            html: html.into(),
            parts: Vec::new(),
        }
    }
}

/// Un documento reso che la shell monta dentro un'altra pagina (una
/// transclusione, un embed).
///
/// Porta un [`RenderedDocument`] e non una stringa perché un embed passa dai
/// renderer registrati come l'anteprima: un diagramma dentro una nota trasclusa
/// resta un diagramma, e le sue parti dichiarative vanno montate dal frontend
/// dentro il segnaposto che ha appena idratato.
///
/// Rispecchiato da `EmbedContent` in `apps/client/src/host/contract.ts` (fixture di
/// `crates/fub-app/tests/ts_mirror_app.rs`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct EmbedContent {
    pub doc_id: String,
    #[serde(flatten)]
    pub content: RenderedDocument,
}
