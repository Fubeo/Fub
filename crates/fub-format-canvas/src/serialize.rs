//! Serializzazione modello → `.canvas`: **generazione, non round-trip**
//! (stesso contratto di `FormatProvider::serialize` per il markdown).
//!
//! La fonte di verità di una tela esistente è la sua sorgente sul disco: il
//! modello comune è lossy (niente z-order oltre l'ordine dei blocchi, niente
//! geometria oltre l'ancora-id, niente `extra`), quindi la fedeltà integrale è
//! irraggiungibile e non è l'obiettivo. Questo serializer genera tele **nuove**
//! (template, "crea canvas") e frammenti; le modifiche a una tela esistente
//! sono operazioni chirurgiche sulla sorgente (frontend) o commit con preimmagini.

use fub_abi::format::ParseContext;
use fub_abi::model::{Block, DocumentModel};
use fub_abi::FormatError;

use super::model::Canvas;

/// Genera una tela minima dal modello: un nodo testo per blocco di codice
/// `canvas-*`, un gruppo per heading. Tutto il resto (geometria, archi, extra)
/// non è nel modello e non si inventa: layout a griglia deterministico.
pub fn serialize(model: &DocumentModel) -> Result<String, FormatError> {
    serialize_with_ctx(model, &ParseContext::bare(model.id.to_string()))
}

fn serialize_with_ctx(model: &DocumentModel, _ctx: &ParseContext) -> Result<String, FormatError> {
    let mut canvas = Canvas::default();
    let mut x = 0i64;
    let mut y = 0i64;
    let mut n = 0u32;
    for block in &model.body {
        n += 1;
        let id = format!("node-{n}");
        match block {
            Block::CodeBlock { lang, code, .. } => match lang.as_deref() {
                Some("canvas-file") => {
                    let (file, subpath) = split_subpath(code);
                    canvas.nodes.push(super::model::CanvasNode {
                        id,
                        node_type: super::model::CanvasNodeType::File,
                        x,
                        y,
                        width: 320,
                        height: 200,
                        color: None,
                        text: None,
                        file: Some(file),
                        subpath,
                        url: None,
                        label: None,
                        background: None,
                        background_style: None,
                        extra: Default::default(),
                    });
                }
                Some("canvas-url") => {
                    canvas.nodes.push(super::model::CanvasNode {
                        id,
                        node_type: super::model::CanvasNodeType::Link,
                        x,
                        y,
                        width: 320,
                        height: 120,
                        color: None,
                        text: None,
                        file: None,
                        subpath: None,
                        url: Some(code.clone()),
                        label: None,
                        background: None,
                        background_style: None,
                        extra: Default::default(),
                    });
                }
                Some("canvas-group") => {
                    canvas.nodes.push(super::model::CanvasNode {
                        id,
                        node_type: super::model::CanvasNodeType::Group,
                        x,
                        y,
                        width: 480,
                        height: 320,
                        color: None,
                        text: None,
                        file: None,
                        subpath: None,
                        url: None,
                        label: Some(code.clone()),
                        background: None,
                        background_style: None,
                        extra: Default::default(),
                    });
                }
                _ => {
                    canvas.nodes.push(super::model::CanvasNode {
                        id,
                        node_type: super::model::CanvasNodeType::Text,
                        x,
                        y,
                        width: 320,
                        height: 160,
                        color: None,
                        text: Some(code.clone()),
                        file: None,
                        subpath: None,
                        url: None,
                        label: None,
                        background: None,
                        background_style: None,
                        extra: Default::default(),
                    });
                }
            },
            Block::Heading { inlines, .. } => {
                let text = inlines
                    .iter()
                    .filter_map(|i| match i {
                        fub_abi::model::Inline::Text(s) => Some(s.as_str()),
                        _ => None,
                    })
                    .collect::<String>();
                canvas.nodes.push(super::model::CanvasNode {
                    id,
                    node_type: super::model::CanvasNodeType::Group,
                    x,
                    y,
                    width: 480,
                    height: 320,
                    color: None,
                    text: None,
                    file: None,
                    subpath: None,
                    url: None,
                    label: Some(text),
                    background: None,
                    background_style: None,
                    extra: Default::default(),
                });
            }
            _ => {
                // Altri blocchi non hanno una card: si rifiuta invece di
                // inventare byte che l'utente non ha scritto.
                return Err(FormatError::Serialize(format!(
                    "canvas cannot express block {block:?}"
                )));
            }
        }
        x += 360;
        if x > 1440 {
            x = 0;
            y += 360;
        }
    }
    canvas
        .validate()
        .map_err(|e| FormatError::Serialize(e.to_string()))?;
    let mut out =
        serde_json::to_string_pretty(&canvas).map_err(|e| FormatError::Serialize(e.to_string()))?;
    out.push('\n');
    Ok(out)
}

fn split_subpath(code: &str) -> (String, Option<String>) {
    match code.find('#') {
        Some(at) => (code[..at].to_string(), Some(code[at..].to_string())),
        None => (code.to_string(), None),
    }
}
