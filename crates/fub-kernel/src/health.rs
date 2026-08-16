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
use crate::index::core::{resolve_entry_in, NomiDellAnagrafe};

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
    /// [`NomiDellAnagrafe::di`], che costa una passata sola.
    pub(crate) nomi: &'a NomiDellAnagrafe,
}

impl LinkResolver for VaultView<'_> {
    fn resolve_wiki(&self, page: &str) -> Option<DocId> {
        self.graph.resolve_wiki(page)
    }

    fn resolve_path(&self, source: &DocId, target: &str) -> Option<DocId> {
        self.graph.resolve_path(source, target)
    }

    fn resolve_entry(&self, source: &DocId, target: &LinkTarget) -> Option<DocId> {
        resolve_entry_in(self.entries, self.nomi, source, target)
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
    let mut per_chiave: BTreeMap<String, Vec<&DocId>> = BTreeMap::new();
    for id in entries.keys() {
        per_chiave
            .entry(resolution_key(id.as_str()))
            .or_default()
            .push(id);
    }
    // La chiave si calcola una volta sola per voce: la seconda passata guarda
    // il gruppo per riferimento invece di rifare il calcolo che l'ha costruito.
    let gruppo_di: HashMap<&DocId, &Vec<&DocId>> = per_chiave
        .values()
        .flat_map(|g| g.iter().map(move |id| (*id, g)))
        .collect();
    // L'ordine è quello dell'anagrafe, come per gli altri controlli: la
    // risposta è paginata e un ordine per gruppo non sarebbe quello che il
    // chiamante si aspetta.
    entries
        .keys()
        .filter_map(|id| {
            let gruppo = gruppo_di.get(id)?;
            if gruppo.len() < 2 {
                return None;
            }
            let altri: Vec<&str> = gruppo
                .iter()
                .filter(|o| **o != id)
                .map(|o| o.as_str())
                .collect();
            Some(HealthIssue {
                doc: id.clone(),
                check: HealthCheck::CollidingPaths,
                detail: Some(altri.join(", ")),
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
            .map(|(key, testo)| format!("{key}: {testo}"))
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
        issues_con_formati(check, docs, graph, entries, &DateFormats::ISO)
    }

    fn issues_con_formati(
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
                nomi: &NomiDellAnagrafe::di(entries),
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

    #[test]
    fn due_file_che_differiscono_per_una_maiuscola_sono_una_collisione() {
        // E il caso che vale il controllo è questo: in **radice**, dove nessun
        // wikilink può disambiguare perché la risoluzione per nome passa da una
        // chiave che il caso l'ha già collassato.
        let entries = anagrafe(&["Nota.md", "nota.md", "sola.md"]);
        let graph = LinkGraph::build(std::iter::empty::<&DocumentModel>());
        let found = issues_con(HealthCheck::CollidingPaths, &[], &graph, &entries);
        let colliding: Vec<(&str, &str)> = found
            .iter()
            .map(|i| (i.doc.as_str(), i.detail.as_deref().unwrap_or("")))
            .collect();
        assert_eq!(
            colliding,
            vec![("Nota.md", "nota.md"), ("nota.md", "Nota.md")],
            "una issue per ciascuno dei due, e ognuna nomina l'altro: non c'è \
             ragione di appendere la collisione a uno dei due"
        );
        assert!(
            found[0].span.is_none(),
            "il problema è il nome, non un punto"
        );
    }

    #[test]
    fn un_allegato_collide_come_una_nota() {
        // L'anagrafe e non i documenti: se l'elenco fossero le note, `foto.PNG`
        // e `foto.png` — che è come nasce il caso più comune, due export dallo
        // stesso strumento — non li vedrebbe nessuno.
        let entries = anagrafe(&["img/foto.PNG", "img/foto.png"]);
        let graph = LinkGraph::build(std::iter::empty::<&DocumentModel>());
        let found = issues_con(HealthCheck::CollidingPaths, &[], &graph, &entries);
        assert_eq!(found.len(), 2);
    }

    #[test]
    fn due_estensioni_diverse_non_sono_una_collisione() {
        // La chiave è quella del path **intero**: `nota.md` e `nota.txt` sono
        // due file che il filesystem distingue e la chiave pure. Segnalarli
        // sarebbe rumore, ed è il modo più facile di rendere inutile un
        // controllo di salute.
        let entries = anagrafe(&["nota.md", "nota.txt", "note/nota.md"]);
        let graph = LinkGraph::build(std::iter::empty::<&DocumentModel>());
        assert!(issues_con(HealthCheck::CollidingPaths, &[], &graph, &entries).is_empty());
    }

    #[test]
    fn anche_due_composizioni_unicode_collidono() {
        // L'altra metà di `resolution_key`, e la meno visibile: `é` come code
        // point solo (NFC, come lo scrive Linux) e come `e` + accento
        // combinante (NFD, come lo scrive macOS). Sul disco di un vault
        // sincronizzato sono due file, e a occhio sono lo stesso nome.
        let entries = anagrafe(&["Caf\u{e9}.md", "Cafe\u{301}.md"]);
        let graph = LinkGraph::build(std::iter::empty::<&DocumentModel>());
        assert_eq!(
            issues_con(HealthCheck::CollidingPaths, &[], &graph, &entries).len(),
            2,
            "due nomi che a schermo sono identici: è il caso che nessuno vede"
        );
    }

    /// Un documento col frontmatter dato, per i controlli sulle proprietà.
    fn con_proprieta(id: &str, json: serde_json::Value) -> DocumentModel {
        let mut m = DocumentModel::empty(DocId::new(id));
        m.frontmatter = Frontmatter(json.as_object().expect("un oggetto").clone());
        m
    }

    #[test]
    fn una_proprieta_che_sembra_una_data_si_dice() {
        let docs = vec![
            con_proprieta("a.md", serde_json::json!({"scadenza": "5/7/2026"})),
            // Già ISO: non c'è niente da dire.
            con_proprieta("b.md", serde_json::json!({"scadenza": "2026-07-05"})),
            // Un testo che non somiglia a nessuna data non è rumore da fare.
            con_proprieta("c.md", serde_json::json!({"titolo": "capitolo 3"})),
        ];
        let graph = LinkGraph::build(docs.iter());
        let found = issues(HealthCheck::UnrecognizedDates, &docs, &graph);
        let detto: Vec<(&str, &str)> = found
            .iter()
            .map(|i| (i.doc.as_str(), i.detail.as_deref().unwrap_or("")))
            .collect();
        assert_eq!(
            detto,
            vec![("a.md", "scadenza: 5/7/2026")],
            "il dettaglio nomina la chiave e come è scritta: è ciò che serve \
             per decidere quale formato dichiarare"
        );
    }

    #[test]
    fn chi_ha_dichiarato_il_formato_non_se_lo_sente_ripetere() {
        let docs = vec![
            con_proprieta("a.md", serde_json::json!({"scadenza": "5/7/2026"})),
            // Questa resta illeggibile anche con `dmy`: il mese non esiste.
            con_proprieta("b.md", serde_json::json!({"scadenza": "2026/13/40"})),
        ];
        let graph = LinkGraph::build(docs.iter());
        let entries = anagrafe(&[]);
        let found = issues_con_formati(
            HealthCheck::UnrecognizedDates,
            &docs,
            &graph,
            &entries,
            &DateFormats::declaring(fub_abi::model::DateOrder::Dmy),
        );
        assert!(
            found.is_empty(),
            "una data dichiarata **è** una data, e `2026/13/40` non somiglia a \
             nessuna: chiedere due volte la stessa cosa rende il controllo \
             inutile, e un controllo rumoroso è un controllo spento"
        );
    }

    #[test]
    fn anche_una_data_dentro_un_elenco_si_dice() {
        // Le proprietà a elenco sono la forma normale di 8.2 (`autore: [a, b]`),
        // e una data ci sta dentro come ci sta da sola: guardare solo gli
        // scalari nudi vorrebbe dire tacere su metà del frontmatter di un vault
        // vero.
        let docs = vec![con_proprieta(
            "a.md",
            serde_json::json!({"tappe": ["2026-07-05", "6/7/2026"]}),
        )];
        let graph = LinkGraph::build(docs.iter());
        let found = issues(HealthCheck::UnrecognizedDates, &docs, &graph);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].detail.as_deref(), Some("tappe: 6/7/2026"));
    }
}
