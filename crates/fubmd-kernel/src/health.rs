//! I controlli di salute del vault: link rotti e note orfane.
//!
//! Sono le prime due voci di 7.2 (che ne conta una trentina) e stanno qui,
//! dietro [`IndexQuery::VaultHealth`], invece che in un comando dell'app per la
//! ragione di sempre: chiedono **solo** al grafo e ai modelli che il kernel ha
//! già in memoria, e ognuna che diventasse un comando bespoke sarebbe una
//! superficie che un plugin non può avere.
//!
//! # Cosa NON è un link rotto (e perché è dichiarato qui)
//!
//! - Un **URL** non punta al vault: non risolvere è la sua condizione normale.
//! - Un **allegato** — `![](img/foto.png)`, cioè un path con un'estensione che
//!   nessun `FormatProvider` rivendica — oggi nel kernel *non esiste*
//!   (`Vault::list_documents` filtra per estensione: un PNG non è un
//!   documento). Segnalarlo come rotto vorrebbe dire riempire il rapporto di
//!   falsi positivi, uno per immagine; ignorarlo in silenzio vorrebbe dire
//!   mentire. Si ignora **dichiarandolo**: gli allegati orfani e i riferimenti
//!   rotti agli allegati sono 13.1, e nascono col modello degli asset (§2.2).
//!
//! Restano rotti: i wikilink che non risolvono a nessuna nota e i link markdown
//! a documenti (path senza estensione, o con un'estensione di documento) che
//! non esistono. È la promessa che il vault può mantenere oggi, per intero.
//!
//! [`IndexQuery::VaultHealth`]: fubmd_abi::traits::IndexQuery::VaultHealth

use fubmd_abi::model::{DocId, Link, LinkTarget};
use fubmd_abi::traits::{HealthCheck, HealthIssue};

use crate::graph::LinkGraph;

/// Esegue un controllo su tutto il vault.
///
/// `docs` sono i documenti indicizzati con i loro link (i metadati che il
/// workspace tiene in cache); `doc_extensions` sono le estensioni che un
/// `FormatProvider` rivendica — servono a distinguere un link a una nota da un
/// riferimento a un allegato. L'ordine della risposta è quello dei documenti,
/// poi quello dei link nel sorgente: deterministico, perché è paginato.
pub fn run<'a>(
    check: HealthCheck,
    docs: impl Iterator<Item = (&'a DocId, &'a [Link])>,
    graph: &LinkGraph,
    doc_extensions: &[String],
) -> Vec<HealthIssue> {
    match check {
        HealthCheck::BrokenLinks => broken_links(docs, graph, doc_extensions),
        HealthCheck::OrphanDocuments => orphans(docs.map(|(id, _)| id), graph),
    }
}

fn broken_links<'a>(
    docs: impl Iterator<Item = (&'a DocId, &'a [Link])>,
    graph: &LinkGraph,
    doc_extensions: &[String],
) -> Vec<HealthIssue> {
    let mut issues = Vec::new();
    for (id, links) in docs {
        for link in links {
            let Some(written) = broken_target(id, link, graph, doc_extensions) else {
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

/// La destinazione **come era scritta** se il link non risolve, `None` se
/// risolve o se non è un link a un documento del vault.
fn broken_target(
    source: &DocId,
    link: &Link,
    graph: &LinkGraph,
    doc_extensions: &[String],
) -> Option<String> {
    match &link.target {
        // Un URL non punta al vault.
        LinkTarget::Url(_) => None,
        LinkTarget::Wiki { page, .. } => {
            // L'ancora (`#titolo`, `#^blocco`) non entra nel giudizio: risolverla
            // contro heading e ancore del bersaglio è la voce dichiarata in coda
            // al §1.5, e un link a una nota che esiste non è rotto perché punta a
            // un titolo che non c'è più — è un'altra diagnosi.
            graph.resolve_wiki(page).is_none().then(|| page.clone())
        }
        LinkTarget::Path(path) => {
            if is_attachment(path, doc_extensions) {
                return None;
            }
            graph
                .resolve_path(source, path)
                .is_none()
                .then(|| path.clone())
        }
    }
}

/// Il path punta a qualcosa che non è un documento? (vedi il § in testa)
fn is_attachment(path: &str, doc_extensions: &[String]) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    // Il frammento (`file.md#titolo`) non fa parte del nome del file.
    let name = name.split(['#', '?']).next().unwrap_or(name);
    match name.rsplit_once('.') {
        // Senza estensione è un documento: è la forma dei link fra note.
        None => false,
        Some((_, ext)) => !doc_extensions.iter().any(|e| e.eq_ignore_ascii_case(ext)),
    }
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

    fn issues(check: HealthCheck, docs: &[DocumentModel], graph: &LinkGraph) -> Vec<HealthIssue> {
        run(
            check,
            docs.iter().map(|d| (&d.id, d.links.as_slice())),
            graph,
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
    fn an_attachment_is_not_a_broken_link() {
        // Un PNG nel kernel non esiste (§2.2): segnalarlo riempirebbe il
        // rapporto di falsi positivi, uno per immagine.
        let docs = vec![doc(
            "a.md",
            vec![path("img/foto.png"), path("note/b.md"), path("note/c")],
        )];
        let graph = LinkGraph::build(docs.iter());
        let found = issues(HealthCheck::BrokenLinks, &docs, &graph);
        let broken: Vec<&str> = found.iter().filter_map(|i| i.detail.as_deref()).collect();
        assert_eq!(
            broken,
            vec!["note/b.md", "note/c"],
            "il png resta fuori, i due path a documenti no"
        );
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
