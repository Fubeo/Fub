//! `Selection`: le foglie di una query che il doppio sa verificare con le
//! regole condivise, e il rifiuto di chi chiede un frontmatter non seminato.

use super::*;

/// Le foglie che il doppio sa verificare **con le regole condivise**, sui
/// documenti che ha in memoria: un elenco di id, una cartella
/// ([`in_folder`]), un link sugli archi seminati, una proprietà sul
/// frontmatter dei modelli seminati ([`properties::test`]). La struttura —
/// OR, AND, negazione — è quella di [`QueryEvaluator`], la stessa del kernel.
///
/// Il resto (testo, tag, regex, task, glob, estensione, predicati di terzi)
/// vuole un indice o una regola che vive nel kernel, e la risposta è
/// `unserved`: ignorare il filtro farebbe passare per il motivo sbagliato
/// ogni prova che se ne fidasse.
pub(super) struct Selection<'a> {
    host: &'a MemoryHost,
    documents: Vec<DocId>,
}

impl<'a> Selection<'a> {
    pub(super) fn of(host: &'a MemoryHost) -> Self {
        Selection {
            host,
            documents: host.documents(),
        }
    }

    fn keep(&self, test: impl Fn(&DocId) -> bool) -> Matches {
        Matches::of_docs(self.documents.iter().filter(|id| test(id)).cloned())
    }
}

impl QueryEvaluator for Selection<'_> {
    fn universe(&self) -> Result<Matches, PluginError> {
        Ok(Matches::of_docs(self.documents.iter().cloned()))
    }

    fn predicate(&self, predicate: &QueryPredicate) -> Result<Matches, PluginError> {
        match predicate {
            QueryPredicate::Docs { docs } => Ok(self.keep(|id| docs.contains(id))),
            QueryPredicate::Folder { path, descendants } => {
                Ok(self.keep(|id| in_folder(id, path, *descendants)))
            }
            QueryPredicate::Linked { doc, direction } => {
                let linked = self.host.linked(doc, *direction);
                Ok(self.keep(|id| linked.contains(id)))
            }
            QueryPredicate::Property { filter } => {
                let models = self.host.models.lock().unwrap();
                let mut found = Vec::new();
                for id in &self.documents {
                    let model = models.get(id.as_str()).ok_or_else(|| unseeded(id))?;
                    if properties::test(&model.frontmatter, filter, &DateFormats::ISO) {
                        found.push(id.clone());
                    }
                }
                Ok(Matches::of_docs(found))
            }
            other => Err(PluginError::Unserved(
                format!(
                    "MemoryHost non valuta questa foglia senza un indice: {other:?}; \
                     usa un Workspace vero"
                )
                .into(),
            )),
        }
    }
}

/// Il frontmatter di `id` serve e nessuno ha seminato il suo modello: il
/// doppio non parsa, e rispondere come se il documento non avesse proprietà
/// sarebbe inventare.
pub(super) fn unseeded(id: &DocId) -> PluginError {
    PluginError::Unserved(
        format!(
            "MemoryHost non conosce il frontmatter di `{id}`: seminane il modello \
             con `with_model`, o usa un Workspace vero"
        )
        .into(),
    )
}
