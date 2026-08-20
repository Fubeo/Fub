//! I controlli di salute del vault: link rotti, note orfane, path che collidono.
//!
//! Sono le prime tre voci di 7.2 (che ne conta una trentina) e stanno qui,
//! dietro [`IndexQuery::VaultHealth`], invece che in un comando dell'app per la
//! ragione di sempre: chiedono **solo** al grafo e ai modelli che il kernel ha
//! già in memoria, e ognuna che diventasse un comando bespoke sarebbe una
//! superficie che un plugin non può avere.
//!
//! Qui c'è la **camminata**; il giudizio — cosa conta come link rotto e cosa no
//! — è [`fub_abi::rules::health`], perché è la stessa risposta per chiunque
//! rivendichi la famiglia. Il grafo lo presta come [`LinkResolver`]: chi ha
//! l'indice non è chi ha la regola.
//!
//! [`IndexQuery::VaultHealth`]: fub_abi::traits::IndexQuery::VaultHealth

use fub_abi::model::{DateFormats, DocId, Frontmatter, Link, LinkTarget};
use fub_abi::rules::health::{broken_target, unrecognized_dates, LinkResolver};
use fub_abi::rules::path::resolution_key;
use fub_abi::traits::{HealthCheck, HealthIssue};

use std::collections::{BTreeMap, HashMap};

use fub_abi::traits::VaultEntry;

use crate::graph::LinkGraph;
use crate::index::core::{resolve_entry_in, EntryNames};

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
    /// Le chiavi dell'anagrafe, che rispondono senza scandirla (difetto 0115).
    ///
    /// Un controllo di salute chiede una volta per ogni link di ogni documento,
    /// quindi è il secondo posto — dopo la riscrittura dei riferimenti — dove
    /// una scansione per domanda diventava il vault moltiplicato per sé stesso.
    /// Chi ha l'indice presta le sue, ed è la via di ogni chiamante vero; un
    /// banco che si costruisce un'anagrafe a mano le fa con
    /// [`EntryNames::of`], che costa una passata sola.
    pub(crate) names: &'a EntryNames,
}

impl LinkResolver for VaultView<'_> {
    fn resolve_wiki(&self, page: &str) -> Option<DocId> {
        self.graph.resolve_wiki(page)
    }

    fn resolve_path(&self, source: &DocId, target: &str) -> Option<DocId> {
        self.graph.resolve_path(source, target)
    }

    fn resolve_entry(&self, source: &DocId, target: &LinkTarget) -> Option<DocId> {
        resolve_entry_in(self.entries, self.names, source, target)
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
    docs: impl Iterator<Item = (&'a DocId, &'a [Link], &'a Frontmatter)>,
    view: &VaultView<'_>,
    doc_extensions: &[String],
    formats: &DateFormats,
) -> Vec<HealthIssue> {
    match check {
        HealthCheck::BrokenLinks => broken_links(docs, view, doc_extensions),
        HealthCheck::OrphanDocuments => orphans(docs.map(|(id, _, _)| id), view.graph),
        // Non `docs` ma `view.entries`: i documenti sono le note, e due file
        // che collidono possono essere due allegati (`foto.PNG` e `foto.png`
        // collidono esattamente come due note). L'anagrafe è l'unico elenco che
        // li contiene tutti, ed è la ragione per cui questo controllo non
        // esisteva prima del §14.1.
        HealthCheck::CollidingPaths => collisions(view.entries),
        // Il frontmatter e non l'anagrafe: una proprietà sta in una nota, e le
        // note sono i documenti. È la simmetria opposta a quella qui sopra, ed
        // è la ragione per cui questi due controlli non condividono l'elenco su
        // cui camminano.
        HealthCheck::UnrecognizedDates => dates(docs.map(|(id, _, fm)| (id, fm)), formats),
    }
}

fn broken_links<'a>(
    docs: impl Iterator<Item = (&'a DocId, &'a [Link], &'a Frontmatter)>,
    graph: &VaultView<'_>,
    doc_extensions: &[String],
) -> Vec<HealthIssue> {
    let mut issues = Vec::new();
    for (id, links, _) in docs {
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
    docs.filter(|id| !graph.has_backlinks(id))
        .map(|id| HealthIssue {
            doc: id.clone(),
            check: HealthCheck::OrphanDocuments,
            // Il problema è il documento stesso: non c'è un punto da mostrare.
            detail: None,
            span: None,
        })
        .collect()
}

/// I file che condividono una chiave di risoluzione: uno per ciascun membro del
/// gruppo, col dettaglio che nomina gli **altri**.
///
/// La chiave è quella del path **intero, con estensione**, e non quella senza:
/// `nota.md` e `nota.txt` sono due file diversi che si distinguono benissimo, e
/// segnalarli sarebbe rumore. Ciò che qui è un problema è il gruppo che il
/// filesystem distingue e la chiave no — cioè maiuscole e composizione Unicode,
/// che è esattamente quel che [`resolution_key`] toglie.
///
/// Una issue per **ogni** membro e non una per gruppo perché `HealthIssue` ha
/// un solo `doc`: dire la collisione una volta sola vorrebbe dire scegliere a
/// quale dei due file appenderla, e non c'è nessuna ragione per preferirne uno
/// — è la stessa asimmetria arbitraria che questa voce è venuta a togliere.
fn collisions(entries: &BTreeMap<DocId, VaultEntry>) -> Vec<HealthIssue> {
    let mut by_key: BTreeMap<String, Vec<&DocId>> = BTreeMap::new();
    for id in entries.keys() {
        by_key
            .entry(resolution_key(id.as_str()))
            .or_default()
            .push(id);
    }
    // La chiave si calcola una volta sola per voce: la seconda passata guarda
    // il gruppo per riferimento invece di rifare il calcolo che l'ha costruito.
    let group_of: HashMap<&DocId, &Vec<&DocId>> = by_key
        .values()
        .flat_map(|g| g.iter().map(move |id| (*id, g)))
        .collect();
    // L'ordine è quello dell'anagrafe, come per gli altri controlli: la
    // risposta è paginata e un ordine per gruppo non sarebbe quello che il
    // chiamante si aspetta.
    entries
        .keys()
        .filter_map(|id| {
            let gruppo = group_of.get(id)?;
            if gruppo.len() < 2 {
                return None;
            }
            let other: Vec<&str> = gruppo
                .iter()
                .filter(|or| **or != id)
                .map(|or| or.as_str())
                .collect();
            Some(HealthIssue {
                doc: id.clone(),
                check: HealthCheck::CollidingPaths,
                detail: Some(other.join(", ")),
                // Il problema non sta in un punto del sorgente: sta nel nome.
                span: None,
            })
        })
        .collect()
}

/// Le proprietà che sembrano una data e non lo sono: una issue per documento,
/// col dettaglio che nomina le chiavi e come sono scritte.
///
/// Una per documento e non una per proprietà — al contrario delle collisioni —
/// perché qui il gesto che ripara è **uno**: una nota scritta con `5/7/2026`
/// ha quasi sempre tutte le sue date in quel formato, e tre righe per tre
/// proprietà della stessa nota direbbero tre volte la stessa cosa.
fn dates<'a>(
    docs: impl Iterator<Item = (&'a DocId, &'a Frontmatter)>,
    formats: &DateFormats,
) -> Vec<HealthIssue> {
    docs.filter_map(|(id, fm)| {
        let sospette = unrecognized_dates(fm, formats);
        if sospette.is_empty() {
            return None;
        }
        let detail = sospette
            .iter()
            .map(|(key, text)| format!("{key}: {text}"))
            .collect::<Vec<_>>()
            .join(", ");
        Some(HealthIssue {
            doc: id.clone(),
            check: HealthCheck::UnrecognizedDates,
            detail: Some(detail),
            // Il frontmatter non ha span nel modello: ciò che si nomina è la
            // chiave, ed è ciò che serve per trovarla.
            span: None,
        })
    })
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::model::{DocumentModel, Span};
    use fub_abi::traits::EntryKind;

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
    fn entries_of(paths: &[&str]) -> BTreeMap<DocId, VaultEntry> {
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
        issues_with(check, docs, graph, &entries_of(&[]))
    }

    fn issues_with(
        check: HealthCheck,
        docs: &[DocumentModel],
        graph: &LinkGraph,
        entries: &BTreeMap<DocId, VaultEntry>,
    ) -> Vec<HealthIssue> {
        issues_with_formats(check, docs, graph, entries, &DateFormats::ISO)
    }

    fn issues_with_formats(
        check: HealthCheck,
        docs: &[DocumentModel],
        graph: &LinkGraph,
        entries: &BTreeMap<DocId, VaultEntry>,
        formats: &DateFormats,
    ) -> Vec<HealthIssue> {
        run(
            check,
            docs.iter()
                .map(|d| (&d.id, d.links.as_slice(), &d.frontmatter)),
            &VaultView {
                graph,
                entries,
                names: &EntryNames::of(entries),
            },
            &md(),
            formats,
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
        assert_eq!(found.len(), 1, "only the second link is broken");
        assert_eq!(found[0].doc, DocId::new("a.md"));
        assert_eq!(
            found[0].detail.as_deref(),
            Some("Non esiste"),
            "the detail is the destination as written: this is what gets corrected"
        );
        assert!(found[0].span.is_some(), "a broken link has a span");
    }

    #[test]
    fn an_attachment_that_exists_is_not_a_broken_link() {
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
        let found = issues_with(
            HealthCheck::BrokenLinks,
            &docs,
            &graph,
            &entries_of(&["img/foto.png"]),
        );
        let broken: Vec<&str> = found.iter().filter_map(|the| the.detail.as_deref()).collect();
        assert_eq!(
            broken,
            vec!["note/b.md", "note/c"],
            "the png is there, the two path-to-document references are not"
        );
    }

    #[test]
    fn a_missing_attachment_is_a_broken_link() {
        // Ed è il caso che l'utente vede davvero: un'immagine che non si
        // carica. È la metà della promessa che il vault non poteva mantenere
        // finché non sapeva cosa avesse dentro.
        let docs = vec![doc(
            "note/a.md",
            vec![path("../img/foto.png"), path("img/sparita.png")],
        )];
        let graph = LinkGraph::build(docs.iter());
        let found = issues_with(
            HealthCheck::BrokenLinks,
            &docs,
            &graph,
            &entries_of(&["img/foto.png"]),
        );
        let broken: Vec<&str> = found.iter().filter_map(|the| the.detail.as_deref()).collect();
        assert_eq!(
            broken,
            vec!["img/sparita.png"],
            "the relative reference resolves and is not broken; the one that \
             names nothing is"
        );
        assert!(
            found[0].span.is_some(),
            "a missing attachment has a span in the source, like every broken link"
        );
    }

    #[test]
    fn the_anchor_is_not_part_of_an_attachment_name() {
        // `documento.pdf#page=3` nomina il PDF: il frammento è per chi lo apre.
        let docs = vec![doc("a.md", vec![path("doc/manuale.pdf#page=3")])];
        let graph = LinkGraph::build(docs.iter());
        assert!(issues_with(
            HealthCheck::BrokenLinks,
            &docs,
            &graph,
            &entries_of(&["doc/manuale.pdf"])
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
    fn an_orphan_is_a_notes_nobody_names() {
        let docs = vec![
            doc("hub.md", vec![wiki("Figlia")]),
            doc("Figlia.md", vec![]),
            doc("sola.md", vec![]),
        ];
        let graph = LinkGraph::build(docs.iter());
        let found = issues(HealthCheck::OrphanDocuments, &docs, &graph);
        let orphans: Vec<&str> = found.iter().map(|the| the.doc.as_str()).collect();
        assert_eq!(
            orphans,
            vec!["hub.md", "sola.md"],
            "orphan = zero incoming references; linking does not save from orphanhood"
        );
        assert!(found[0].detail.is_none() && found[0].span.is_none());
    }

    #[test]
    fn two_files_differing_in_case_are_a_collision() {
        // E il caso che vale il controllo è questo: in **radice**, dove nessun
        // wikilink può disambiguare perché la risoluzione per nome passa da una
        // chiave che il caso l'ha già collassato.
        let entries = entries_of(&["Nota.md", "nota.md", "sola.md"]);
        let graph = LinkGraph::build(std::iter::empty::<&DocumentModel>());
        let found = issues_with(HealthCheck::CollidingPaths, &[], &graph, &entries);
        let colliding: Vec<(&str, &str)> = found
            .iter()
            .map(|the| (the.doc.as_str(), the.detail.as_deref().unwrap_or("")))
            .collect();
        assert_eq!(
            colliding,
            vec![("Nota.md", "nota.md"), ("nota.md", "Nota.md")],
            "one issue per each of the two, each naming the other: there is no \
             reason to append the collision to only one of them"
        );
        assert!(
            found[0].span.is_none(),
            "the problem is the name, not a span"
        );
    }

    #[test]
    fn an_attachment_collides_like_a_notes() {
        // L'anagrafe e non i documenti: se l'elenco fossero le note, `foto.PNG`
        // e `foto.png` — che è come nasce il caso più comune, due export dallo
        // stesso strumento — non li vedrebbe nessuno.
        let entries = entries_of(&["img/foto.PNG", "img/foto.png"]);
        let graph = LinkGraph::build(std::iter::empty::<&DocumentModel>());
        let found = issues_with(HealthCheck::CollidingPaths, &[], &graph, &entries);
        assert_eq!(found.len(), 2);
    }

    #[test]
    fn two_different_extensions_are_not_a_collision() {
        // La chiave è quella del path **intero**: `nota.md` e `nota.txt` sono
        // due file che il filesystem distingue e la chiave pure. Segnalarli
        // sarebbe rumore, ed è il modo più facile di rendere inutile un
        // controllo di salute.
        let entries = entries_of(&["nota.md", "nota.txt", "note/nota.md"]);
        let graph = LinkGraph::build(std::iter::empty::<&DocumentModel>());
        assert!(issues_with(HealthCheck::CollidingPaths, &[], &graph, &entries).is_empty());
    }

    #[test]
    fn unicode_compositions_collide_too() {
        // L'altra metà di `resolution_key`, e la meno visibile: `é` come code
        // point solo (NFC, come lo scrive Linux) e come `e` + accento
        // combinante (NFD, come lo scrive macOS). Sul disco di un vault
        // sincronizzato sono due file, e a occhio sono lo stesso nome.
        let entries = entries_of(&["Caf\u{e9}.md", "Cafe\u{301}.md"]);
        let graph = LinkGraph::build(std::iter::empty::<&DocumentModel>());
        assert_eq!(
            issues_with(HealthCheck::CollidingPaths, &[], &graph, &entries).len(),
            2,
            "two names that look identical on screen: this is the case nobody sees"
        );
    }

    /// Un documento col frontmatter dato, per i controlli sulle proprietà.
    fn with_properties(id: &str, json: serde_json::Value) -> DocumentModel {
        let mut m = DocumentModel::empty(DocId::new(id));
        m.frontmatter = Frontmatter(json.as_object().expect("un oggetto").clone());
        m
    }

    #[test]
    fn a_property_that_looks_like_a_date_is_stated() {
        let docs = vec![
            with_properties("a.md", serde_json::json!({"scadenza": "5/7/2026"})),
            // Già ISO: non c'è niente da dire.
            with_properties("b.md", serde_json::json!({"scadenza": "2026-07-05"})),
            // Un testo che non somiglia a nessuna data non è rumore da fare.
            with_properties("c.md", serde_json::json!({"titolo": "capitolo 3"})),
        ];
        let graph = LinkGraph::build(docs.iter());
        let found = issues(HealthCheck::UnrecognizedDates, &docs, &graph);
        let said: Vec<(&str, &str)> = found
            .iter()
            .map(|the| (the.doc.as_str(), the.detail.as_deref().unwrap_or("")))
            .collect();
        assert_eq!(
            said,
            vec![("a.md", "scadenza: 5/7/2026")],
            "the detail names the key and how it is written: this is what is \
             needed to decide which format to declare"
        );
    }

    #[test]
    fn whoever_declared_the_format_is_not_told_again() {
        let docs = vec![
            with_properties("a.md", serde_json::json!({"scadenza": "5/7/2026"})),
            // Questa resta illeggibile anche con `dmy`: il mese non esiste.
            with_properties("b.md", serde_json::json!({"scadenza": "2026/13/40"})),
        ];
        let graph = LinkGraph::build(docs.iter());
        let entries = entries_of(&[]);
        let found = issues_with_formats(
            HealthCheck::UnrecognizedDates,
            &docs,
            &graph,
            &entries,
            &DateFormats::declaring(fub_abi::model::DateOrder::Dmy),
        );
        assert!(
            found.is_empty(),
            "a declared date **is** a date, and `2026/13/40` does not resemble \
             any: asking the same thing twice makes the check useless, and a \
             noisy check is a dead check"
        );
    }

    #[test]
    fn a_date_inside_a_list_is_stated_too() {
        // Le proprietà a elenco sono la forma normale di 8.2 (`autore: [a, b]`),
        // e una data ci sta dentro come ci sta da sola: guardare solo gli
        // scalari nudi vorrebbe dire tacere su metà del frontmatter di un vault
        // vero.
        let docs = vec![with_properties(
            "a.md",
            serde_json::json!({"tappe": ["2026-07-05", "6/7/2026"]}),
        )];
        let graph = LinkGraph::build(docs.iter());
        let found = issues(HealthCheck::UnrecognizedDates, &docs, &graph);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].detail.as_deref(), Some("tappe: 6/7/2026"));
    }
}
