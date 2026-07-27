//! Il registro dei [`CustomRenderer`] e la **composizione** di un'anteprima —
//! l'innesto del §3.2, e la strada per cui la UI di un plugin entra nella shell
//! (§3.3).
//!
//! # Perché la composizione sta qui e non nel provider
//!
//! `FormatProvider::render_html` è una funzione pura per-documento: non ha
//! l'`HostApi`, non conosce i renderer registrati e non deve conoscerli — se li
//! conoscesse, aggiungere un renderer vorrebbe dire toccare ogni provider. Il
//! kernel quindi **spezza il corpo**: rende con il provider le corse di blocchi
//! che nessuno rivendica, e i blocchi custom rivendicati li rende col loro
//! renderer. Non c'è nessun segnaposto da riconoscere in una stringa e nessuna
//! chirurgia sull'HTML: è la stessa cosa che `render_embed` fa già da sempre
//! rendendo un sottomodello.
//!
//! # Il limite dichiarato
//!
//! Si delegano i blocchi custom **di primo livello**. Uno annidato dentro una
//! citazione o una voce di elenco resta al provider, che lo degrada come prima.
//! È il prezzo di non fare chirurgia sulla stringa, e cade dove fa meno male: un
//! diagramma, una formula a display, un chart o un embed di query si scrivono in
//! cima a un blocco, non dentro il terzo livello di un elenco puntato.

use std::collections::{BTreeSet, HashMap};

use fubmd_abi::custom::{CustomBlock, CustomRenderer, CustomRendererSpec, CustomRendering};
use fubmd_abi::format::{FormatProvider, RenderOptions};
use fubmd_abi::model::{Block, DocumentModel};
use fubmd_abi::options::OptionMap;
use fubmd_abi::ui::UiNode;
use serde::{Deserialize, Serialize};

use crate::workspace::Trust;

/// Perché un renderer non si è registrato. Stesse ragioni del
/// [`SyntaxConflict`](crate::syntax::SyntaxConflict), e non è un caso: sono lo
/// stesso spazio di nomi visto dai due lati.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RendererConflict {
    UnnamespacedId(String),
    DuplicateId(String),
    /// Un renderer che non rivendica nessun kind.
    NoKinds(String),
    /// Due renderer per lo stesso `custom_kind`.
    Claimed {
        kind: String,
        incumbent: String,
        challenger: String,
    },
}

impl std::fmt::Display for RendererConflict {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RendererConflict::UnnamespacedId(id) => {
                write!(
                    f,
                    "il renderer `{id}` non ha un namespace (serve `ns:nome`)"
                )
            }
            RendererConflict::DuplicateId(id) => write!(f, "il renderer `{id}` è già registrato"),
            RendererConflict::NoKinds(id) => {
                write!(f, "il renderer `{id}` non rivendica nessun custom_kind")
            }
            RendererConflict::Claimed {
                kind,
                incumbent,
                challenger,
            } => write!(
                f,
                "`{challenger}` rivendica `{kind}`, che è già di `{incumbent}`"
            ),
        }
    }
}

struct Registered {
    spec: CustomRendererSpec,
    trust: Trust,
    renderer: Box<dyn CustomRenderer>,
}

/// Chi disegna quale `custom_kind`.
#[derive(Default)]
pub struct RendererRegistry {
    renderers: Vec<Registered>,
    /// `custom_kind` → indice in `renderers`.
    by_kind: HashMap<String, usize>,
}

impl RendererRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(
        &mut self,
        trust: Trust,
        renderer: Box<dyn CustomRenderer>,
    ) -> Result<(), RendererConflict> {
        let spec = renderer.spec();
        if OptionMap::ns_of(&spec.id).is_none() {
            return Err(RendererConflict::UnnamespacedId(spec.id));
        }
        if self.renderers.iter().any(|r| r.spec.id == spec.id) {
            return Err(RendererConflict::DuplicateId(spec.id));
        }
        if spec.kinds.is_empty() {
            return Err(RendererConflict::NoKinds(spec.id));
        }
        for kind in &spec.kinds {
            if let Some(&at) = self.by_kind.get(kind) {
                return Err(RendererConflict::Claimed {
                    kind: kind.clone(),
                    incumbent: self.renderers[at].spec.id.clone(),
                    challenger: spec.id,
                });
            }
        }
        let at = self.renderers.len();
        for kind in &spec.kinds {
            self.by_kind.insert(kind.clone(), at);
        }
        self.renderers.push(Registered {
            spec,
            trust,
            renderer,
        });
        Ok(())
    }

    /// Toglie un renderer per id, coi `custom_kind` che rivendicava (§9.4).
    /// `false` = non era registrato.
    ///
    /// La mappa `kind → posizione` si **rifà**, non si aggiusta: togliere il
    /// terzo di cinque sposta il quarto e il quinto, e una mappa aggiustata a
    /// mano è il modo in cui un blocco finisce disegnato dal renderer sbagliato.
    pub fn remove(&mut self, id: &str) -> bool {
        let Some(at) = self.renderers.iter().position(|r| r.spec.id == id) else {
            return false;
        };
        self.renderers.remove(at);
        self.by_kind.clear();
        for (at, registered) in self.renderers.iter().enumerate() {
            for kind in &registered.spec.kinds {
                self.by_kind.insert(kind.clone(), at);
            }
        }
        true
    }

    pub fn is_empty(&self) -> bool {
        self.renderers.is_empty()
    }

    pub fn specs(&self) -> impl Iterator<Item = &CustomRendererSpec> {
        self.renderers.iter().map(|r| &r.spec)
    }

    /// I `custom_kind` che qualcuno sa disegnare.
    pub fn rendered_kinds(&self) -> BTreeSet<String> {
        self.by_kind.keys().cloned().collect()
    }

    fn for_kind(&self, kind: &str) -> Option<&Registered> {
        self.by_kind.get(kind).map(|&at| &self.renderers[at])
    }
}

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

/// Il segnaposto in cui la shell monta una parte dichiarativa.
///
/// Lo scrive **il kernel**, non il provider: se lo scrivesse il provider, il suo
/// formato esatto diventerebbe contratto e ogni provider dovrebbe conoscerlo.
fn slot_html(slot: u32, kind: &str) -> String {
    format!(
        "<div class=\"ui-slot\" data-ui-slot=\"{slot}\" data-custom-kind=\"{}\"></div>",
        kind.replace('&', "&amp;")
            .replace('"', "&quot;")
            .replace('<', "&lt;")
    )
}

/// Rende un modello componendo provider e renderer registrati.
///
/// `trust_of_ui` è la validazione del confine: un albero che arriva da un
/// renderer non fidato non può contenere `Html`/`WebView`, esattamente come
/// quello di una view. Il punto di applicazione è **uno**, ed è qui.
pub(crate) fn compose(
    model: &DocumentModel,
    provider: &dyn FormatProvider,
    renderers: &RendererRegistry,
    opts: &RenderOptions,
) -> Result<RenderedDocument, fubmd_abi::FormatError> {
    if renderers.is_empty() {
        return Ok(RenderedDocument::html(provider.render_html(model, opts)?));
    }

    let mut out = RenderedDocument::default();
    let mut run: Vec<Block> = Vec::new();
    let mut slot = 0u32;

    // Rende con il provider i blocchi accumulati finora.
    fn flush(
        run: &mut Vec<Block>,
        model: &DocumentModel,
        provider: &dyn FormatProvider,
        opts: &RenderOptions,
        out: &mut String,
    ) -> Result<(), fubmd_abi::FormatError> {
        if run.is_empty() {
            return Ok(());
        }
        let mut piece = DocumentModel::empty(model.id.clone());
        piece.body = std::mem::take(run);
        out.push_str(&provider.render_html(&piece, opts)?);
        Ok(())
    }

    for block in &model.body {
        let Block::Custom {
            custom_kind,
            attrs,
            blocks,
            anchor,
            span,
        } = block
        else {
            run.push(block.clone());
            continue;
        };
        let Some(registered) = renderers.for_kind(custom_kind) else {
            run.push(block.clone());
            continue;
        };
        let custom = CustomBlock {
            custom_kind: custom_kind.clone(),
            attrs: attrs.clone(),
            blocks: blocks.clone(),
            anchor: anchor.clone(),
            span: *span,
        };
        // Un renderer che fallisce degrada al provider: un'estensione rotta
        // rende un documento meno ricco, non illeggibile.
        let rendering = registered
            .renderer
            .render(&custom, opts)
            .unwrap_or(CustomRendering::Fallback);
        match rendering {
            CustomRendering::Fallback => run.push(block.clone()),
            CustomRendering::Html(html) => {
                flush(&mut run, model, provider, opts, &mut out.html)?;
                out.html.push_str(&html);
            }
            CustomRendering::Ui(node) => {
                // Stessa regola delle view: da chi non è il core, niente
                // contenuto attivo, a qualunque profondità dell'albero.
                if !registered.trust.allows_active_content() && node.validate_untrusted().is_err() {
                    run.push(block.clone());
                    continue;
                }
                flush(&mut run, model, provider, opts, &mut out.html)?;
                out.html.push_str(&slot_html(slot, custom_kind));
                out.parts.push(RenderedPart {
                    slot,
                    kind: custom_kind.clone(),
                    node: *node,
                });
                slot += 1;
            }
        }
    }
    flush(&mut run, model, provider, opts, &mut out.html)?;
    Ok(out)
}
