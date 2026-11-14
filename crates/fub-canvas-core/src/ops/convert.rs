//! `convert`: una scheda di testo diventa una scheda di file, come «Trasforma
//! in nota» della GUI. Tiene id, posto, misure, colore e i campi sconosciuti,
//! così gli archi restano; il testo esce dalla scheda. Il file col testo lo
//! scrive un'altra porta (`fub_create`, la GUI) prima dell'operazione. Le regole
//! stanno in `docs/reference/canvas-code.md`, «Le operazioni».

use serde::{Deserialize, Serialize};

use super::{check_node, refuse, Compiler, OpError};
use crate::model::CanvasNodeType;
use crate::patch::{upsert_node_patch, CanvasPatch};

/// Gli argomenti di `convert`: la scheda di testo `id` diventa la scheda del
/// file `file`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConvertArgs {
    /// La scheda di testo. Un id che non è una scheda è `UnknownNode`.
    pub id: String,
    /// Il percorso del file nel vault, non vuoto.
    pub file: String,
}

impl Compiler {
    /// `convert`: la stessa scheda, al suo posto nell'ordine, col tipo `file`.
    pub(super) fn convert(
        &mut self,
        index: usize,
        args: &ConvertArgs,
    ) -> Result<Vec<CanvasPatch>, OpError> {
        let node = self.node(index, &args.id)?;
        if node.node_type != CanvasNodeType::Text {
            return Err(refuse(
                index,
                format!(
                    "`convert` turns a text card into a file card: {:?} is not a text card",
                    args.id
                ),
            ));
        }
        if args.file.is_empty() {
            return Err(refuse(index, "`file` is empty: give the path of the note"));
        }
        let mut changed = node.clone();
        changed.node_type = CanvasNodeType::File;
        changed.text = None;
        changed.file = Some(args.file.clone());
        check_node(index, &changed)?;
        Ok(upsert_node_patch(&self.working, &changed)
            .into_iter()
            .collect())
    }
}
