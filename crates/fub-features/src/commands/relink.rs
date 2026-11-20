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

/// I link di proprietà che arrivavano a `from`, cercati **dopo** che la nota è
/// già diventata `to`: la ripresa di un'archiviazione interrotta fra la
/// rinomina e la riscrittura, quando il nome vecchio non porta più da nessuna
/// parte e la via inversa del grafo non lo conosce.
///
/// Si guardano quindi le proprietà di tutte le note (succede solo dopo un
/// crollo): conta un link che arriva a `from` per nome o per percorso, come in
/// [`property_links_to`], e che oggi non porta da nessuna parte o porta già a
/// `to`. Uno che porta a un'altra nota resta suo. La riscrittura poi è la
/// stessa della rinomina, e un link già scritto col nome nuovo non cambia:
/// riprendere due volte non riscrive due volte.
///
/// Le chiavi della risposta sono `from`, come quelle di
/// [`property_links_to`], così [`rewrite_property_links`] la prende uguale.
pub(crate) fn property_links_left_behind(
    host: &dyn HostApi,
    from: &DocId,
    to: &DocId,
) -> Result<BTreeMap<DocId, Vec<PropertyLink>>, PluginError> {
    let mut found: BTreeMap<DocId, Vec<PropertyLink>> = BTreeMap::new();
    let answer = match host.query_index(IndexQuery::Documents {
        matching: QueryExpr::all(),
        sort: None,
        select: PropertySelect::All,
        page: None,
        excerpts: Excerpts::Omit,
    }) {
        Err(PluginError::Unserved(_)) => return Ok(found),
        answer => answer?,
    };
    for row in answer.documents()?.items {
        let mut pages = BTreeSet::new();
        for property in &row.properties {
            pages.extend(written_pages(&property.value));
        }
        for page in pages {
            if !reaches_by_name_or_path(&page, from) {
                continue;
            }
            match resolve(host, &page, &row.doc)? {
                None => {}
                Some(target) if target == *to => {}
                Some(_) => continue,
            }
            found.entry(from.clone()).or_default().push(PropertyLink {
                source: row.doc.clone(),
                page,
            });
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
/// link scritto come una delle chiavi di `pages` nel valore che le
/// corrisponde. Ogni edit porta la pagina che ha cambiato.
///
/// Si riscrive esattamente ciò che l'indice conta come link della proprietà
/// ([`fub_abi::rules::properties::links`]), così le pagine raccolte prima
/// della rinomina e gli edit coincidono: una stringa YAML che è **soltanto**
/// un `[[…]]`, come valore o come voce di un elenco. Un `[[…]]` dentro altro
/// testo, in un commento YAML o in una chiave non è un link della proprietà e
/// resta com'è; un `[[` letterale non chiuso non nasconde il link che segue.
fn frontmatter_link_edits(
    source: &str,
    pages: &BTreeMap<String, String>,
) -> Vec<(String, TextEdit)> {
    let Some(block) = frontmatter_block(source) else {
        return Vec::new();
    };
    let text = &source[block.clone()];
    let mut edits = Vec::new();
    for value in yaml_string_values(text) {
        let raw = &text[value.clone()];
        let lead = raw.len() - raw.trim_start().len();
        let Some(inner) = raw
            .trim()
            .strip_prefix("[[")
            .and_then(|rest| rest.strip_suffix("]]"))
        else {
            continue;
        };
        // La stessa regola di `lone_wikilink`; in più, un interno su più
        // righe non si riscrive (piegato dallo YAML non è più il testo).
        if inner.contains("[[") || inner.contains("]]") || inner.contains('\n') {
            continue;
        }
        let inner_start = value.start + lead + 2;
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

/// Gli intervalli di byte, nel frontmatter `text`, del contenuto grezzo di
/// ogni **valore** stringa che può essere un link solo: le stringhe fra
/// virgolette (`"…"`, `'…'`, anche su più righe) e i blocchi `|`/`>`.
/// Restano fuori i commenti, le chiavi e gli scalari senza virgolette: uno
/// scalare nudo non comincia con `[` in YAML (`a: [[X]]` è un elenco di
/// elenchi, non una stringa), quindi non è mai un link solo.
///
/// Non è un parser YAML: è il lessico che basta a dire dove sta una stringa.
/// Uno YAML che non si legge non ha link per l'indice, e un link che qui
/// sfuggisse fa fallire la nota in modo dichiarato (`E_RELINK_CHANGED`), mai
/// una riscrittura al posto sbagliato.
fn yaml_string_values(text: &str) -> Vec<std::ops::Range<usize>> {
    let b = text.as_bytes();
    let blank = |c: u8| matches!(c, b' ' | b'\t' | b'\r' | b'\n');
    let ends_token = |i: usize| i >= b.len() || blank(b[i]);
    let line_end = |from: usize| {
        b[from..]
            .iter()
            .position(|&c| c == b'\n')
            .map_or(b.len(), |n| from + n)
    };
    let mut out = Vec::new();
    let mut i = 0;
    // Quanti `[`/`{` aperti: dentro, `,` `]` `}` sono segni e non testo.
    let mut depth = 0usize;
    // Il prossimo segno apre un nodo (a inizio riga, dopo `: `, `- `, `[`…).
    let mut node = true;
    // Dentro uno scalare nudo, fino a `: `, a un commento o alla riga dopo.
    let mut plain = false;
    let mut line_start = true;
    let mut indent = 0;
    while i < b.len() {
        let c = b[i];
        if c == b'\n' {
            i += 1;
            line_start = true;
            node = true;
            plain = false;
            indent = b[i..].iter().take_while(|&&c| c == b' ').count();
            continue;
        }
        if matches!(c, b' ' | b'\t' | b'\r') {
            i += 1;
            continue;
        }
        let at_line_start = std::mem::replace(&mut line_start, false);
        // Un commento comincia con `#` dopo uno spazio, o a inizio riga.
        if c == b'#' && (i == 0 || blank(b[i - 1])) {
            i = line_end(i);
            continue;
        }
        if plain {
            let flow_end = depth > 0 && matches!(b.get(i + 1), Some(b',' | b']' | b'}'));
            match c {
                b':' if ends_token(i + 1) || flow_end => {
                    plain = false;
                    node = true;
                }
                b',' if depth > 0 => {
                    plain = false;
                    node = true;
                }
                b']' | b'}' if depth > 0 => {
                    plain = false;
                    depth -= 1;
                }
                _ => {}
            }
            i += 1;
            continue;
        }
        match c {
            b'"' | b'\'' if node => {
                let Some(close) = quoted_end(b, i) else {
                    break;
                };
                // Una stringa seguita da `:` è una chiave; una a inizio riga
                // fuori da `[…]` continua uno scalare nudo della riga sopra.
                let after = b[close + 1..]
                    .iter()
                    .find(|&&c| c != b' ' && c != b'\t')
                    .copied();
                if after != Some(b':') && !(at_line_start && depth == 0) {
                    out.push(i + 1..close);
                }
                i = close + 1;
                node = false;
            }
            b'|' | b'>' if node && depth == 0 => {
                // L'intestazione (`|-`, `>+2`, un commento) finisce la riga;
                // il contenuto sono le righe più rientrate di quella.
                let mut at = line_end(i);
                let first = (at + 1).min(b.len());
                let mut last = first;
                while at < b.len() {
                    let line = at + 1;
                    let end = line_end(line);
                    let row = &b[line..end];
                    let empty = row.iter().all(|&c| blank(c));
                    if !empty && row.iter().take_while(|&&c| c == b' ').count() <= indent {
                        break;
                    }
                    if !empty {
                        last = end;
                    }
                    at = end;
                }
                if last > first {
                    out.push(first..last);
                }
                // Riparte dal `\n` che chiude il blocco: la riga dopo
                // ricalcola il suo rientro.
                i = at;
                node = false;
            }
            b'[' | b'{' if node || depth > 0 => {
                depth += 1;
                node = true;
                i += 1;
            }
            b']' | b'}' if depth > 0 => {
                depth -= 1;
                node = false;
                i += 1;
            }
            b',' if depth > 0 => {
                node = true;
                i += 1;
            }
            b':' if ends_token(i + 1) || depth > 0 => {
                node = true;
                i += 1;
            }
            b'-' | b'?' if node && depth == 0 && ends_token(i + 1) => {
                node = true;
                i += 1;
            }
            _ => {
                plain = true;
                node = false;
                i += 1;
            }
        }
    }
    out
}

/// L'indice della virgoletta che chiude la stringa aperta in `open`: fra le
/// doppie `\` salta il carattere dopo, fra le singole `''` è un apostrofo.
/// `None` se non si chiude.
fn quoted_end(b: &[u8], open: usize) -> Option<usize> {
    let quote = b[open];
    let mut i = open + 1;
    while i < b.len() {
        match b[i] {
            b'\\' if quote == b'"' => i += 2,
            c if c == quote => {
                if quote == b'\'' && b.get(i + 1) == Some(&b'\'') {
                    i += 2;
                } else {
                    return Some(i);
                }
            }
            _ => i += 1,
        }
    }
    None
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

    /// Quante volte l'indice conta `page` fra i link del frontmatter: lo
    /// YAML letto come lo legge il provider Markdown, poi la regola unica
    /// `fub_abi::rules::properties::links`.
    fn counted_by_index(source: &str, page: &str) -> usize {
        let block = frontmatter_block(source).expect("un frontmatter");
        let serde_json::Value::Object(map) =
            serde_yaml_ng::from_str::<serde_json::Value>(&source[block]).expect("YAML valido")
        else {
            panic!("il frontmatter non è una mappa");
        };
        let fm = fub_abi::model::Frontmatter(map);
        fub_abi::rules::properties::links(&fm)
            .into_iter()
            .filter(|(_, target)| matches!(target, LinkTarget::Wiki { page: p, .. } if p == page))
            .count()
    }

    fn vecchio() -> BTreeMap<String, String> {
        BTreeMap::from([("Vecchio".to_string(), "Nuovo".to_string())])
    }

    /// Un `[[` non chiuso (in una stringa o in un commento) non fa saltare
    /// il link valido che lo segue: altrimenti la nota fallisce con
    /// `E_RELINK_CHANGED` e il link resta col nome vecchio.
    #[test]
    fn an_unclosed_bracket_does_not_hide_the_next_link() {
        let pages = vecchio();
        for (source, expected) in [
            (
                "---\ntitolo: \"Appunti [[ bozza\"\nprogetto: \"[[Vecchio]]\"\n---\n",
                "---\ntitolo: \"Appunti [[ bozza\"\nprogetto: \"[[Nuovo]]\"\n---\n",
            ),
            (
                "---\n# [[ in corso\nprogetto: \"[[Vecchio]]\"\n---\n",
                "---\n# [[ in corso\nprogetto: \"[[Nuovo]]\"\n---\n",
            ),
            (
                "---\ntitolo: Appunti [[ bozza\nlibri: [\"[[Vecchio]]\", '[[Vecchio|V]]']\n---\n",
                "---\ntitolo: Appunti [[ bozza\nlibri: [\"[[Nuovo]]\", '[[Nuovo|V]]']\n---\n",
            ),
        ] {
            let edits = frontmatter_link_edits(source, &pages);
            assert_eq!(edits.len(), counted_by_index(source, "Vecchio"), "{source}");
            assert_eq!(apply(source, edits), expected, "{source}");
        }
    }

    /// Si riscrive esattamente ciò che l'indice conta come link della
    /// proprietà (`fub_abi::rules::properties::links`): una stringa che è
    /// soltanto un `[[…]]`, come valore o voce di un elenco. Un commento
    /// YAML, un `[[…]]` dentro altro testo, una chiave restano come sono.
    #[test]
    fn only_what_the_index_counts_is_rewritten() {
        let source = "---\n\
            # vedi [[Vecchio]]\n\
            progetto: \"[[Vecchio]]\" # era \"[[Vecchio]]\"\n\
            nota: \"vedi [[Vecchio]] e altro\"\n\
            due: \"[[Vecchio]] e [[Vecchio]]\"\n\
            \"[[Vecchio]]\": chiave\n\
            frase: l'amico [[Vecchio]]\n\
            elenco:\n  - \"[[Vecchio]]\"\n  - testo [[Vecchio]]\n  # - \"[[Vecchio]]\"\n\
            citato: 'l''amico \"[[Vecchio]]\"'\n\
            ---\n";
        let expected = source
            .replacen("progetto: \"[[Vecchio]]\"", "progetto: \"[[Nuovo]]\"", 1)
            .replacen("  - \"[[Vecchio]]\"", "  - \"[[Nuovo]]\"", 1);
        let edits = frontmatter_link_edits(source, &vecchio());
        assert_eq!(counted_by_index(source, "Vecchio"), 2);
        assert_eq!(edits.len(), 2);
        assert_eq!(apply(source, edits), expected);
    }

    /// Il controllo del chiamante: ogni pagina raccolta dall'indice ha il suo
    /// edit, anche dopo un `[[` letterale dentro una stringa.
    #[test]
    fn every_page_the_index_found_gets_an_edit() {
        let source = "---\na: \"[[ x\"\nb: \"[[Vecchio]]\"\nc: [\"[[Altro]]\"]\n---\n";
        let pages = BTreeMap::from([
            ("Vecchio".to_string(), "Nuovo".to_string()),
            ("Altro".to_string(), "Diverso".to_string()),
        ]);
        let seen: BTreeSet<String> = frontmatter_link_edits(source, &pages)
            .into_iter()
            .map(|(page, _)| page)
            .collect();
        assert_eq!(seen.len(), pages.len());
    }

    /// Una stringa su più righe, o un blocco `|`/`>`, che è soltanto un link
    /// è un link per l'indice: si riscrive anche lei.
    #[test]
    fn a_multiline_scalar_that_is_only_a_link_is_rewritten() {
        let source = "---\na: \"\n  [[Vecchio]]\n  \"\nb: >-\n  [[Vecchio#Fasi]]\nc: |\n  vedi [[Vecchio]]\nd: 1\n---\n";
        assert_eq!(counted_by_index(source, "Vecchio"), 2);
        let expected = "---\na: \"\n  [[Nuovo]]\n  \"\nb: >-\n  [[Nuovo#Fasi]]\nc: |\n  vedi [[Vecchio]]\nd: 1\n---\n";
        assert_eq!(
            apply(source, frontmatter_link_edits(source, &vecchio())),
            expected
        );
    }

    /// Uno YAML troncato in ogni punto (virgolette aperte, `\` in fondo, un
    /// blocco senza righe) non fa mai cadere la lettura.
    #[test]
    fn a_truncated_frontmatter_never_panics() {
        let full = "a: \"x\\\" [[Vecchio]]\"\nb: 'l''è [[Vecchio]]'\nc: [ \"[[Vecchio]]\", {d: '[[Vecchio]]'} ]\ne: |-\n  [[Vecchio]]\n# è [[\nf: ►\n";
        for (cut, _) in full.char_indices() {
            let source = format!("---\n{}\n---\n", &full[..cut]);
            let _ = frontmatter_link_edits(&source, &vecchio());
        }
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
