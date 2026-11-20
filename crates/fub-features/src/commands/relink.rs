//! I link delle proprietà seguono la nota che si rinomina (IMP-2805).
//!
//! La rinomina del kernel riscrive i link del **corpo**: sono archi del grafo,
//! e il provider li ha misurati. Un link scritto in una proprietà
//! (`progetto: "[[Progetto Gestione Scorte]]"`) non è un arco: lo legge questa
//! feature delle proprietà, come fa per «Collegata da». Lo riscrivono quindi
//! i comandi che spostano note, accanto alla rinomina che chiamano
//! (`note.rename`, `folder.rename`) raccolgono **prima** i link che arrivano
//! alla nota, quando il nome vecchio porta ancora da lei, e li riscrivono
//! **dopo**, col nome nuovo.
//!
//! Le regole sono quelle della rinomina del kernel: si riscrive un link che
//! arrivava per nome o per percorso, mai per alias; il nome resta un nome e il
//! percorso un percorso; e se il nome nuovo è ambiguo si scrive il percorso.
//! Si tocca soltanto la pagina dentro `[[…]]`: titolo, blocco, alias, le
//! virgolette e il resto dello YAML restano come sono. Ogni nota si scrive col
//! suo CAS: una cambiata nel frattempo è un fallimento dichiarato, e così una
//! il cui frontmatter non porta più il link che si era visto.

use std::collections::{BTreeMap, BTreeSet};

use fub_abi::model::{parse_wikilink_inner, LinkTarget, PropertyScalar, PropertyValue};
use fub_abi::query::{PropertyLinkPredicate, QueryExpr};
use fub_abi::rules::path::{resolution_key, strip_ext};
use fub_abi::rules::properties::lone_wikilink;
use fub_abi::traits::{Excerpts, PropertySelect};

use super::*;

/// Un link di proprietà che arriva a una nota: chi lo scrive, e la pagina
/// com'è scritta dentro `[[…]]`.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct PropertyLink {
    pub(crate) source: DocId,
    pub(crate) page: String,
}

/// I link di proprietà che arrivano, per nome o per percorso, a ognuna delle
/// note `targets`. Va chiesto **prima** di rinominarle: dopo, il nome vecchio
/// non porta più da nessuna parte.
pub(crate) fn property_links_to(
    host: &dyn HostApi,
    targets: &[DocId],
) -> Result<BTreeMap<DocId, Vec<PropertyLink>>, PluginError> {
    let mut found: BTreeMap<DocId, Vec<PropertyLink>> = BTreeMap::new();
    if targets.is_empty() {
        return Ok(found);
    }
    let wanted: BTreeSet<&DocId> = targets.iter().collect();
    // Solo le note che nominano uno dei bersagli in una proprietà, dalla via
    // inversa che il grafo del kernel tiene (#503): la domanda costa i link
    // che arrivano, non le proprietà di tutto il vault. Nessun indice che la
    // serva (un host ridotto): non c'è niente che si possa sapere, e quindi
    // niente da riscrivere. Ogni altro errore ferma il comando prima che
    // rinomini.
    let leaf = PropertyLinkPredicate {
        targets: targets.to_vec(),
        key: None,
    };
    let answer = match host.query_index(IndexQuery::Documents {
        matching: QueryExpr::of(leaf.into_predicate()),
        sort: None,
        select: PropertySelect::All,
        page: None,
        excerpts: Excerpts::Omit,
    }) {
        Err(PluginError::Unserved(_)) => return Ok(found),
        answer => answer?,
    };
    let rows = answer.documents()?.items;
    // Un wikilink si risolve allo stesso modo da ogni nota: una domanda per
    // pagina scritta basta.
    let mut resolved: BTreeMap<String, Option<DocId>> = BTreeMap::new();
    for row in rows {
        let mut pages = BTreeSet::new();
        for property in &row.properties {
            pages.extend(written_pages(&property.value));
        }
        for page in pages {
            let target = match resolved.get(&page) {
                Some(target) => target.clone(),
                None => {
                    let target = resolve(host, &page, &row.doc)?;
                    resolved.insert(page.clone(), target.clone());
                    target
                }
            };
            let Some(target) = target.filter(|target| wanted.contains(target)) else {
                continue;
            };
            if reaches_by_name_or_path(&page, &target) {
                found.entry(target).or_default().push(PropertyLink {
                    source: row.doc.clone(),
                    page,
                });
            }
        }
    }
    Ok(found)
}

/// Riscrive, dopo le rinomine `moved` (da → a), i link raccolti prima da
/// [`property_links_to`]. Torna le note che non si sono lasciate riscrivere,
/// ognuna col suo motivo; le altre sono già scritte.
pub(crate) fn rewrite_property_links(
    host: &mut dyn HostApi,
    found: &BTreeMap<DocId, Vec<PropertyLink>>,
    moved: &[(DocId, DocId)],
) -> Vec<Failure> {
    // Una sorgente spostata anche lei (la nota stessa, una cartella intera)
    // si scrive al suo posto nuovo.
    let now: BTreeMap<&DocId, &DocId> = moved.iter().map(|(from, to)| (from, to)).collect();
    let mut per_source: BTreeMap<DocId, BTreeMap<String, String>> = BTreeMap::new();
    let mut failures = Vec::new();
    for (from, to) in moved {
        let Some(links) = found.get(from) else {
            continue;
        };
        for link in links {
            let source = now.get(&link.source).map_or(&link.source, |to| *to).clone();
            match replacement(&*host, &link.page, from, to, &source) {
                Ok(Some(next)) => {
                    per_source
                        .entry(source)
                        .or_default()
                        .insert(link.page.clone(), next);
                }
                Ok(None) => {}
                Err(error) => failures.push(Failure::of(source, error)),
            }
        }
    }
    for (source, pages) in per_source {
        if failures.iter().any(|f| f.subject.as_ref() == Some(&source)) {
            continue;
        }
        let written = (|| -> Result<(), PluginError> {
            let revision = host.document_revision(&source)?;
            let text = host.read_document(&source)?;
            let edits = frontmatter_link_edits(&text, &pages);
            let seen: BTreeSet<&str> = edits.iter().map(|(page, _)| page.as_str()).collect();
            if seen.len() != pages.len() {
                return Err(PluginError::Conflict(Text::message(
                    E_RELINK_CHANGED,
                    vec![Arg::text("doc", source.as_str())],
                )));
            }
            let edits = edits.into_iter().map(|(_, edit)| edit).collect();
            host.apply_edit(&source, EditRequest::new(revision, edits))?;
            Ok(())
        })();
        if let Err(error) = written {
            failures.push(Failure::of(source, error));
        }
    }
    failures
}

/// Le note che i link raccolti toccherebbero, per il piano di una prova a
/// vuoto.
pub(crate) fn property_link_sources(found: &BTreeMap<DocId, Vec<PropertyLink>>) -> Vec<DocId> {
    let sources: BTreeSet<&DocId> = found.values().flatten().map(|link| &link.source).collect();
    sources.into_iter().cloned().collect()
}

/// Le pagine dei wikilink di un valore: il link solo, una lista di link, e
/// una stringa che è soltanto un `[[…]]` (una proprietà Testo nel registro
/// che porta comunque un link).
fn written_pages(value: &PropertyValue) -> Vec<String> {
    let page = |target: &LinkTarget| match target {
        LinkTarget::Wiki { page, .. } if !page.is_empty() => Some(page.clone()),
        _ => None,
    };
    let text = |s: &str| lone_wikilink(s).and_then(|target| page(&target));
    match value {
        PropertyValue::Link(target) => page(target).into_iter().collect(),
        PropertyValue::Text(s) => text(s).into_iter().collect(),
        PropertyValue::List(items) => items
            .iter()
            .filter_map(|item| match item {
                PropertyScalar::Link(target) => page(target),
                PropertyScalar::Text(s) => text(s),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn resolve(host: &dyn HostApi, page: &str, from: &DocId) -> Result<Option<DocId>, PluginError> {
    match host.query_index(IndexQuery::Resolve {
        target: LinkTarget::wiki(page),
        from: Some(from.clone()),
    })? {
        IndexResult::Resolved(found) => Ok(found.map(|found| found.doc)),
        other => Err(PluginError::Internal(Text::message(
            E_RELINK_INDEX,
            vec![Arg::text("kind", other.kind_name())],
        ))),
    }
}

/// Il link arriva a `target` per nome o per percorso (anche parziale, a
/// confine di cartella), con o senza estensione, e non per alias: un alias
/// resta valido dopo la rinomina, e riscriverlo cambierebbe ciò che l'utente
/// ha scelto di scrivere.
fn reaches_by_name_or_path(page: &str, target: &DocId) -> bool {
    let key = resolution_key(page);
    let stem = strip_ext(&key);
    let path = resolution_key(&strip_ext(target.as_str()));
    let name = resolution_key(target.page_name());
    let file = resolution_key(
        target
            .as_str()
            .rsplit('/')
            .next()
            .unwrap_or(target.as_str()),
    );
    stem == name
        || key == file
        || stem == path
        || key == resolution_key(target.as_str())
        || (stem.contains('/') && path.ends_with(&format!("/{stem}")))
}

/// La pagina nuova per un link scritto `page` che arrivava a `from`, ora `to`:
/// lo stesso stile (nome o percorso, con o senza estensione), e il percorso
/// se il nome nuovo da `source` porterebbe altrove. `None` se non cambia.
fn replacement(
    host: &dyn HostApi,
    page: &str,
    from: &DocId,
    to: &DocId,
    source: &DocId,
) -> Result<Option<String>, PluginError> {
    let key = resolution_key(page);
    let with_extension = strip_ext(&key) != key
        && (key == resolution_key(from.as_str())
            || key == resolution_key(from.as_str().rsplit('/').next().unwrap_or(from.as_str())));
    let by_path = strip_ext(&key).contains('/');
    let file = to.as_str().rsplit('/').next().unwrap_or(to.as_str());
    let path = if with_extension {
        to.as_str().to_string()
    } else {
        strip_ext(to.as_str())
    };
    let first = match (by_path, with_extension) {
        (true, _) => path.clone(),
        (false, true) => file.to_string(),
        (false, false) => to.page_name().to_string(),
    };
    let next = if resolve(host, &first, source)?.as_ref() == Some(to) {
        first
    } else if resolve(host, &path, source)?.as_ref() == Some(to) {
        path
    } else {
        return Err(PluginError::Conflict(Text::message(
            E_RELINK_UNREACHABLE,
            vec![Arg::text("doc", to.as_str())],
        )));
    };
    if next == page {
        return Ok(None);
    }
    // Il link sta dentro uno YAML, spesso fra virgolette: un nome che le
    // chiuderebbe, o che cambierebbe il senso del link, non si scrive.
    if next.contains(['"', '\'', '\\', '\n', '\r', '|', '#', '^', '[', ']']) {
        return Err(PluginError::Conflict(Text::message(
            E_RELINK_UNWRITABLE,
            vec![Arg::text("doc", to.as_str())],
        )));
    }
    Ok(Some(next))
}

/// Le righe fra i due delimitatori `---` in testa al file (un BOM a parte),
/// come intervallo di byte. `None` senza un frontmatter chiuso: un `---` solo
/// in cima non apre niente da riscrivere.
fn frontmatter_block(source: &str) -> Option<std::ops::Range<usize>> {
    let start = if source.starts_with('\u{FEFF}') {
        '\u{FEFF}'.len_utf8()
    } else {
        0
    };
    let mut at = start;
    let mut first = true;
    let mut body = start;
    while at < source.len() {
        let end = source[at..].find('\n').map_or(source.len(), |i| at + i);
        let line = source[at..end].trim_end();
        if first {
            if line != "---" {
                return None;
            }
            first = false;
            body = (end + 1).min(source.len());
        } else if line == "---" || line == "..." {
            return Some(body..at);
        }
        at = end + 1;
    }
    None
}

/// Gli edit che, nel frontmatter di `source`, cambiano la pagina di ogni
/// `[[…]]` scritto come una delle chiavi di `pages` nel valore che le
/// corrisponde. Ogni edit porta la pagina che ha cambiato.
fn frontmatter_link_edits(
    source: &str,
    pages: &BTreeMap<String, String>,
) -> Vec<(String, TextEdit)> {
    let Some(block) = frontmatter_block(source) else {
        return Vec::new();
    };
    let text = &source[block.clone()];
    let mut edits = Vec::new();
    let mut at = 0;
    while let Some(open) = text[at..].find("[[") {
        let inner_start = at + open + 2;
        let Some(close) = text[inner_start..].find("]]") else {
            break;
        };
        let inner_end = inner_start + close;
        at = inner_end + 2;
        let inner = &text[inner_start..inner_end];
        if inner.contains('\n') || inner.contains("[[") {
            continue;
        }
        let LinkTarget::Wiki { page, .. } = parse_wikilink_inner(inner).target else {
            continue;
        };
        let Some(next) = pages.get(&page) else {
            continue;
        };
        // La pagina è ciò che viene prima di `#`, `^` o `|`, senza gli spazi
        // ai bordi: il resto dell'interno resta com'è.
        let cut = inner.find(['#', '^', '|']).unwrap_or(inner.len());
        let raw = &inner[..cut];
        let lead = raw.len() - raw.trim_start().len();
        let start = block.start + inner_start + lead;
        let end = start + raw.trim().len();
        edits.push((page, TextEdit::replace(Span::new(start, end), next.clone())));
    }
    edits
}

#[cfg(test)]
mod tests {
    use super::*;

    fn apply(source: &str, mut edits: Vec<(String, TextEdit)>) -> String {
        edits.sort_by_key(|(_, edit)| std::cmp::Reverse(edit.span.start));
        let mut out = source.to_string();
        for (_, edit) in edits {
            out.replace_range(edit.span.start..edit.span.end, &edit.text);
        }
        out
    }

    #[test]
    fn only_the_page_inside_the_frontmatter_changes() {
        let source = "---\nprogetto: \"[[Vecchio|Il progetto]]\"\naltri: [\"[[ Vecchio#Fasi ]]\", \"[[Altro]]\"]\n---\n\nNel testo [[Vecchio]] resta al kernel.\n";
        let pages = BTreeMap::from([("Vecchio".to_string(), "Nuovo".to_string())]);
        assert_eq!(
            apply(source, frontmatter_link_edits(source, &pages)),
            "---\nprogetto: \"[[Nuovo|Il progetto]]\"\naltri: [\"[[ Nuovo#Fasi ]]\", \"[[Altro]]\"]\n---\n\nNel testo [[Vecchio]] resta al kernel.\n"
        );
    }

    #[test]
    fn a_note_without_frontmatter_has_nothing_to_rewrite() {
        let source = "[[Vecchio]]\n";
        let pages = BTreeMap::from([("Vecchio".to_string(), "Nuovo".to_string())]);
        assert!(frontmatter_link_edits(source, &pages).is_empty());
    }

    #[test]
    fn name_path_and_extension_reach_but_an_alias_does_not() {
        let target = DocId::new("Progetti/Scorte.md");
        for page in [
            "Scorte",
            "scorte",
            "Scorte.md",
            "Progetti/Scorte",
            "Progetti/Scorte.md",
        ] {
            assert!(reaches_by_name_or_path(page, &target), "{page}");
        }
        assert!(!reaches_by_name_or_path("Magazzino", &target));
        assert!(!reaches_by_name_or_path("tti/Scorte", &target));
    }
}
