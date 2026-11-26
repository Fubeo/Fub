//! La relazione inversa: le note che legano questa con una Relazione
//! («Collegata da»), lette dall'indice, senza scrivere niente.
//!
//! I link del frontmatter non sono archi del corpo (il Markdown li estrae dal
//! corpo), quindi i backlink non bastano: il grafo del kernel li tiene a
//! parte, con la loro chiave, e la foglia
//! [`PROPERTY_LINK_PREDICATE_NS`](fub_abi::query::PROPERTY_LINK_PREDICATE_NS)
//! di `query_index` ne è la via inversa. «Collegata da» è quella domanda,
//! una per ogni chiave che il registro dichiara Relazione: costa i link che
//! arrivano alla nota, non il vault. Niente si scrive nelle altre note.

use fub_abi::query::PropertyLinkPredicate;

use super::*;

/// Una nota che lega `doc` con la Relazione `key`.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct LinkedFrom {
    pub doc: DocId,
    pub key: String,
}

/// Le note che legano `doc` con una Relazione, in ordine di documento e di
/// chiave.
///
/// Conta solo una chiave che il registro dichiara Relazione: lo stesso link
/// in una proprietà Testo non è una relazione. Un link rotto non lega niente;
/// una nota che lega sé stessa compare, perché è un fatto della nota. Una nota
/// che lega `doc` due volte con la stessa chiave compare una volta. Il
/// bersaglio non conta: restringe la scelta nell'editor, non il valore.
pub fn linked_from(host: &dyn ReadApi, doc: &DocId) -> Result<Vec<LinkedFrom>, PluginError> {
    let types = property_types(host);
    let mut out = Vec::new();
    for key in types.relations() {
        let leaf = PropertyLinkPredicate {
            targets: vec![doc.clone()],
            key: Some(key.to_string()),
        };
        let rows = match host.query_index(IndexQuery::Documents {
            matching: QueryExpr::of(leaf.into_predicate()),
            sort: None,
            select: PropertySelect::None,
            page: None,
            excerpts: Excerpts::Omit,
        })? {
            IndexResult::Documents(rows) => rows.items,
            other => {
                return Err(PluginError::Internal(Text::message(
                    E_LINKED_FROM,
                    vec![Arg::text("kind", other.kind_name())],
                )))
            }
        };
        out.extend(rows.into_iter().map(|row| LinkedFrom {
            doc: row.doc,
            key: key.to_string(),
        }));
    }
    out.sort();
    out.dedup();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::format::FormatProvider as _;
    use fub_abi::settings::SettingValue;
    use fub_abi::traits::VaultRead as _;
    use fub_sdk::testing::MemoryHost;

    fn host(registry: &str, notes: &[(&str, &str)]) -> MemoryHost {
        let spec = fub_kernel::properties::properties_settings()
            .into_iter()
            .find(|spec| spec.key == fub_kernel::properties::TYPES)
            .unwrap();
        let mut host = MemoryHost::new().with_value(spec, SettingValue::Text(registry.into()));
        for (id, source) in notes {
            let model = fub_format_markdown::MarkdownProvider::new()
                .parse(
                    &(*source).into(),
                    &fub_abi::format::ParseContext::obsidian(*id),
                )
                .unwrap();
            host = host.with_document(id, source).with_model(id, model);
        }
        host
    }

    fn froms(found: Vec<LinkedFrom>) -> Vec<(String, String)> {
        found
            .into_iter()
            .map(|f| (f.doc.as_str().to_string(), f.key))
            .collect()
    }

    /// «Collegata da» si legge dai link delle Relazioni, risolti con le
    /// regole del vault: un link rotto non lega, una nota che lega sé stessa
    /// sì, una proprietà che non è una Relazione no, e niente si scrive.
    #[test]
    fn the_inverse_relation_reads_the_relations_of_the_other_notes() {
        let host = host(
            r#"{"version":1,"types":{"autori":"relation","libri":"relation","nota":"text"}}"#,
            &[
                ("Persone/Asimov.md", "---\nlibri: [\"[[Fondazione]]\", \"[[Asimov]]\"]\n---\n"),
                ("Libri/Fondazione.md", "---\nautori: \"[[Asimov]]\"\n---\n"),
                (
                    "Scaffale.md",
                    "---\nlibri: [\"[[Libri/Fondazione]]\", \"[[Fondazione]]\", \"[[Rotto]]\"]\nnota: \"[[Fondazione]]\"\n---\n",
                ),
                ("Corpo.md", "Un link nel corpo: [[Fondazione]].\n"),
            ],
        );
        let before: Vec<String> = ["Persone/Asimov.md", "Libri/Fondazione.md", "Scaffale.md"]
            .iter()
            .map(|id| host.read_document(&DocId::new(*id)).unwrap())
            .collect();
        assert_eq!(
            froms(linked_from(&host, &DocId::new("Libri/Fondazione.md")).unwrap()),
            [
                ("Persone/Asimov.md".to_string(), "libri".to_string()),
                ("Scaffale.md".to_string(), "libri".to_string()),
            ]
        );
        // La nota che lega sé stessa compare fra chi la lega.
        assert_eq!(
            froms(linked_from(&host, &DocId::new("Persone/Asimov.md")).unwrap()),
            [
                ("Libri/Fondazione.md".to_string(), "autori".to_string()),
                ("Persone/Asimov.md".to_string(), "libri".to_string()),
            ]
        );
        assert!(linked_from(&host, &DocId::new("Corpo.md"))
            .unwrap()
            .is_empty());
        let after: Vec<String> = ["Persone/Asimov.md", "Libri/Fondazione.md", "Scaffale.md"]
            .iter()
            .map(|id| host.read_document(&DocId::new(*id)).unwrap())
            .collect();
        assert_eq!(before, after);
    }

    /// Senza Relazioni dichiarate, o con un registro che non si legge, non
    /// c'è relazione inversa: un link in una proprietà resta un valore.
    #[test]
    fn without_declared_relations_nothing_links_back() {
        for registry in [
            r#"{"version":1,"types":{}}"#,
            r#"{"version":2,"types":{"libri":"relation"}}"#,
        ] {
            let host = host(
                registry,
                &[
                    ("A.md", "---\nlibri: [\"[[B]]\"]\n---\n"),
                    ("B.md", "Corpo.\n"),
                ],
            );
            assert!(
                linked_from(&host, &DocId::new("B.md")).unwrap().is_empty(),
                "{registry}"
            );
        }
    }
}
