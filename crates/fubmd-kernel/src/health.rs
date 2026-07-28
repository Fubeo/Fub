//! I controlli di salute del vault: link rotti e note orfane.
//!
//! Sono le prime due voci di 7.2 (che ne conta una trentina) e stanno qui,
//! dietro [`IndexQuery::VaultHealth`], invece che in un comando dell'app per la
//! ragione di sempre: chiedono **solo** al grafo e ai modelli che il kernel ha
//! già in memoria, e ognuna che diventasse un comando bespoke sarebbe una
//! superficie che un plugin non può avere.
//!
//! Qui c'è la **camminata**; il giudizio — cosa conta come link rotto e cosa no
//! — è [`fubmd_abi::rules::health`], perché è la stessa risposta per chiunque
//! rivendichi la famiglia. Il grafo lo presta come [`LinkResolver`]: chi ha
//! l'indice non è chi ha la regola.
//!
//! [`IndexQuery::VaultHealth`]: fubmd_abi::traits::IndexQuery::VaultHealth

use fubmd_abi::model::{DocId, Link, LinkTarget};
use fubmd_abi::rules::health::{broken_target, LinkResolver};
use fubmd_abi::traits::{HealthCheck, HealthIssue};

use std::collections::BTreeMap;

use fubmd_abi::traits::VaultEntry;

use crate::graph::LinkGraph;
use crate::index::core::resolve_entry_in;

/// Il vault **come lo vede un controllo di salute**: il grafo dei link e
/// l'anagrafe, insieme.
///
/// Sono due cose e non una perché rispondono a due domande diverse: dove arriva
/// un link fra note lo sa il grafo, se il PNG che una nota mostra esiste lo sa
/// l'anagrafe (§14.1). Finché il risolutore era il solo grafo la seconda domanda
/// non era rispondibile — un allegato nel kernel non esisteva — e l'unica cosa
/// onesta che si potesse fare era **tacere su ogni allegato**, che è ciò che il
/// modulo delle regole dichiarava di fare.
pub(crate) struct VaultView<'a> {
    pub(crate) graph: &'a LinkGraph,
    pub(crate) entries: &'a BTreeMap<DocId, VaultEntry>,
}

impl LinkResolver for VaultView<'_> {
    fn resolve_wiki(&self, page: &str) -> Option<DocId> {
        self.graph.resolve_wiki(page)
    }

    fn resolve_path(&self, source: &DocId, target: &str) -> Option<DocId> {
        self.graph.resolve_path(source, target)
    }

    fn resolve_entry(&self, source: &DocId, target: &LinkTarget) -> Option<DocId> {
        resolve_entry_in(self.entries, source, target)
    }
}

/// Esegue un controllo su tutto il vault.
///
/// `docs` sono i documenti indicizzati con i loro link (i metadati che il
/// workspace tiene in cache); `doc_extensions` sono le estensioni che un
/// `FormatProvider` rivendica — servono a distinguere un link a una nota da un
/// riferimento a un allegato. L'ordine della risposta è quello dei documenti,
/// poi quello dei link nel sorgente: deterministico, perché è paginato.
pub(crate) fn run<'a>(
    check: HealthCheck,
    docs: impl Iterator<Item = (&'a DocId, &'a [Link])>,
    view: &VaultView<'_>,
    doc_extensions: &[String],
) -> Vec<HealthIssue> {
    match check {
        HealthCheck::BrokenLinks => broken_links(docs, view, doc_extensions),
        HealthCheck::OrphanDocuments => orphans(docs.map(|(id, _)| id), view.graph),
    }
}

fn broken_links<'a>(
    docs: impl Iterator<Item = (&'a DocId, &'a [Link])>,
    graph: &VaultView<'_>,
    doc_extensions: &[String],
) -> Vec<HealthIssue> {
    let mut issues = Vec::new();
    for (id, links) in docs {
        for link in links {
            let Some(written) = broken_target(id, link, doc_extensions, graph) else {
                continue;
            };
            issues.push(HealthIssue {
                doc: id.clone(),
                check: HealthCheck::BrokenLinks,
                detail: Some(written),
                span: Some(link.span),
            });
        }
    }
    issues
}

fn orphans<'a>(docs: impl Iterator<Item = &'a DocId>, graph: &LinkGraph) -> Vec<HealthIssue> {
    docs.filter(|id| graph.backlinks(id).is_empty())
        .map(|id| HealthIssue {
            doc: id.clone(),
            check: HealthCheck::OrphanDocuments,
            // Il problema è il documento stesso: non c'è un punto da mostrare.
            detail: None,
            span: None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use fubmd_abi::model::{DocumentModel, Span};
    use fubmd_abi::traits::EntryKind;

    fn md() -> Vec<String> {
        vec!["md".to_string()]
    }

    fn doc(id: &str, links: Vec<Link>) -> DocumentModel {
        let mut m = DocumentModel::empty(DocId::new(id));
        m.links = links;
        m
    }

    fn wiki(page: &str) -> Link {
        Link {
            target: LinkTarget::wiki(page),
            embed: false,
            span: Span::new(0, 1),
            context: None,
        }
    }

    fn path(dest: &str) -> Link {
        Link {
            target: LinkTarget::Path(dest.to_string()),
            embed: false,
            span: Span::new(0, 1),
            context: None,
        }
    }

    /// Un'anagrafe con dentro questi file (specie irrilevante per il
    /// controllo: conta che ci **siano**).
    fn anagrafe(paths: &[&str]) -> BTreeMap<DocId, VaultEntry> {
        paths
            .iter()
            .map(|p| {
                let id = DocId::new(*p);
                (
                    id.clone(),
                    VaultEntry {
                        id,
                        kind: EntryKind::Asset,
                        size: 0,
                        mtime: 0,
                        fingerprint: None,
                    },
                )
            })
            .collect()
    }

    fn issues(check: HealthCheck, docs: &[DocumentModel], graph: &LinkGraph) -> Vec<HealthIssue> {
        issues_con(check, docs, graph, &anagrafe(&[]))
    }

    fn issues_con(
        check: HealthCheck,
        docs: &[DocumentModel],
        graph: &LinkGraph,
        entries: &BTreeMap<DocId, VaultEntry>,
    ) -> Vec<HealthIssue> {
        run(
            check,
            docs.iter().map(|d| (&d.id, d.links.as_slice())),
            &VaultView { graph, entries },
            &md(),
        )
    }

    #[test]
    fn a_link_to_nothing_is_reported_with_what_was_written() {
        let docs = vec![
            doc("a.md", vec![wiki("Esiste"), wiki("Non esiste")]),
            doc("Esiste.md", vec![]),
        ];
        let graph = LinkGraph::build(docs.iter());
        let found = issues(HealthCheck::BrokenLinks, &docs, &graph);
        assert_eq!(found.len(), 1, "solo il secondo link è rotto");
        assert_eq!(found[0].doc, DocId::new("a.md"));
        assert_eq!(
            found[0].detail.as_deref(),
            Some("Non esiste"),
            "il dettaglio è la destinazione com'era scritta: è ciò che si corregge"
        );
        assert!(found[0].span.is_some(), "un link rotto ha un punto");
    }

    #[test]
    fn un_allegato_che_ce_non_e_un_link_rotto() {
        // Prima del §14.1 questa asserzione era «il png resta **sempre**
        // fuori», e non poteva essere altrimenti: un PNG nel kernel non
        // esisteva, quindi «c'è» e «non c'è» erano la stessa risposta e
        // segnalarli tutti avrebbe riempito il rapporto di un falso positivo
        // per immagine.
        let docs = vec![doc(
            "a.md",
            vec![path("img/foto.png"), path("note/b.md"), path("note/c")],
        )];
        let graph = LinkGraph::build(docs.iter());
        let found = issues_con(
            HealthCheck::BrokenLinks,
            &docs,
            &graph,
            &anagrafe(&["img/foto.png"]),
        );
        let broken: Vec<&str> = found.iter().filter_map(|i| i.detail.as_deref()).collect();
        assert_eq!(
            broken,
            vec!["note/b.md", "note/c"],
            "il png c'è, i due path a documenti no"
        );
    }

    #[test]
    fn un_allegato_che_manca_e_un_link_rotto() {
        // Ed è il caso che l'utente vede davvero: un'immagine che non si
        // carica. È la metà della promessa che il vault non poteva mantenere
        // finché non sapeva cosa avesse dentro.
        let docs = vec![doc(
            "note/a.md",
            vec![path("../img/foto.png"), path("img/sparita.png")],
        )];
        let graph = LinkGraph::build(docs.iter());
        let found = issues_con(
            HealthCheck::BrokenLinks,
            &docs,
            &graph,
            &anagrafe(&["img/foto.png"]),
        );
        let broken: Vec<&str> = found.iter().filter_map(|i| i.detail.as_deref()).collect();
        assert_eq!(
            broken,
            vec!["img/sparita.png"],
            "il riferimento relativo risolve e non è rotto; quello che non \
             nomina niente sì"
        );
        assert!(
            found[0].span.is_some(),
            "un allegato mancante ha un punto nel sorgente, come ogni link rotto"
        );
    }

    #[test]
    fn lancora_non_fa_parte_del_nome_di_un_allegato() {
        // `documento.pdf#page=3` nomina il PDF: il frammento è per chi lo apre.
        let docs = vec![doc("a.md", vec![path("doc/manuale.pdf#page=3")])];
        let graph = LinkGraph::build(docs.iter());
        assert!(issues_con(
            HealthCheck::BrokenLinks,
            &docs,
            &graph,
            &anagrafe(&["doc/manuale.pdf"])
        )
        .is_empty());
    }

    #[test]
    fn a_url_never_breaks() {
        let docs = vec![doc(
            "a.md",
            vec![Link {
                target: LinkTarget::Url("https://example.invalid".to_string()),
                embed: false,
                span: Span::new(0, 1),
                context: None,
            }],
        )];
        let graph = LinkGraph::build(docs.iter());
        assert!(issues(HealthCheck::BrokenLinks, &docs, &graph).is_empty());
    }

    #[test]
    fn an_orphan_is_a_note_nobody_names() {
        let docs = vec![
            doc("hub.md", vec![wiki("Figlia")]),
            doc("Figlia.md", vec![]),
            doc("sola.md", vec![]),
        ];
        let graph = LinkGraph::build(docs.iter());
        let found = issues(HealthCheck::OrphanDocuments, &docs, &graph);
        let orphans: Vec<&str> = found.iter().map(|i| i.doc.as_str()).collect();
        assert_eq!(
            orphans,
            vec!["hub.md", "sola.md"],
            "orfana = zero riferimenti entranti; linkare non salva dall'orfanità"
        );
        assert!(found[0].detail.is_none() && found[0].span.is_none());
    }
}
