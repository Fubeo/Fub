//! Riscrittura provider-owned dei riferimenti `.canvas`.
//!
//! Contratto (Main, `FormatProvider::rewrite_links`): batch di [`LinkRewrite`]
//! → `Some(Vec<TextEdit>)` che copre **tutte** le richieste, o errore. Mai
//! omissioni silenziose, mai fallback raw del kernel, mai riserializzazione
//! dell'intero documento: ogni edit tocca solo i byte dello span richiesto,
//! il resto dei byte resta identico — escape e campi unknown compresi.
//!
//! Due famiglie, stessa chirurgia sullo span esatto emesso dal parse:
//! - `Path` (card file `file`): lo span copre il contenuto del literale; il
//!   `replacement` è il nuovo path URI-like deciso dal kernel: il prefisso
//!   `/` del grafo si omette nel JSON Canvas, poi si scrive JSON-escapato.
//! - `Wiki` (wikilink dentro card `text`): lo span copre `[[..]]`/`![[..]]`
//!   nei byte grezzi; si converte in coordinate decodificate via mappa esatta,
//!   si riscrive il solo interno (page sostituita, heading/blocco/alias
//!   invariati), si rimappa in byte grezzi e si sostituisce solo quello.
//!
//! Mai interi valori, mai prima occorrenza per contenuto: con escape prima o
//! dentro il target, Unicode, o due link identici, lo span identifica
//! l'occorrenza e la mappa le coordinate. Span fuori da ogni literale, a metà
//! escape/char, o su un interno che non parsa al target → errore Parse.
//!
//! Lo span è risolto contro il **percorso** del literale (`nodes[i].file`,
//! `nodes[i].text`), mai cercato per chiave+valore: uno span dentro `extra` o
//! in un'altra card non corrisponde a nessun percorso e viene rifiutato, anche
//! se il testo coincide.

use fub_abi::format::{LinkRewrite, ParseContext};
use fub_abi::model::Span;
use fub_abi::model::{parse_wikilink_inner, LinkTarget};
use fub_abi::{FormatError, TextEdit};

use super::json_map::{
    canvas_literals, decoded_to_raw, raw_to_decoded, LiteralPath, MappedLiteral,
};
use super::parse::vault_path_target_for_rewrite;

/// Riscrittura batch reale, consumata dal trait `FormatProvider::rewrite_links`.
pub fn rewrite_links(
    source: &str,
    ctx: &ParseContext,
    rewrites: &[LinkRewrite],
) -> Result<Vec<TextEdit>, FormatError> {
    let _ = ctx;
    let literals = canvas_literals(source).map_err(FormatError::Parse)?;
    let mut edits = Vec::with_capacity(rewrites.len());
    for rewrite in rewrites {
        edits.push(rewrite_one(&literals, rewrite)?);
    }
    // Ordine stabile per span, come EditRequest vuole un insieme non
    // sovrapposto: due rewrite sullo stesso punto = errore, non merge.
    edits.sort_by_key(|e: &TextEdit| (e.span.start, e.span.end));
    for pair in edits.windows(2) {
        if pair[1].span.start < pair[0].span.end {
            return Err(FormatError::Parse(
                "canvas link rewrites overlap; refusing a partial rename".to_string(),
            ));
        }
    }
    Ok(edits)
}

pub fn rewrite_canvas_links(
    source: &str,
    rewrites: &[LinkRewrite],
) -> Result<Vec<TextEdit>, FormatError> {
    rewrite_links(source, &ParseContext::bare("canvas-rewrite"), rewrites)
}

fn rewrite_one(literals: &[MappedLiteral], rewrite: &LinkRewrite) -> Result<TextEdit, FormatError> {
    match &rewrite.target {
        LinkTarget::Path(_) => rewrite_file_literal(literals, rewrite),
        LinkTarget::Wiki { .. } => rewrite_wiki_in_text(literals, rewrite),
        LinkTarget::Url(_) => Err(FormatError::Parse(
            "canvas rewrite of a remote URL is not a vault rename".to_string(),
        )),
    }
}

/// Card file: lo span copre il contenuto del literale `file` del nodo il cui
/// path normalizzato corrisponde al target atteso. Si verifica sul decodificato
/// che il valore logico corrisponda, poi si sostituiscono solo i byte dello
/// span con il replacement JSON-escapato. Il `replacement` è già il path
/// URI-like deciso dal kernel; si toglie l'eventuale `/` di radice del grafo
/// perché nel JSON Canvas il path della card resta relativo al vault.
fn rewrite_file_literal(
    literals: &[MappedLiteral],
    rewrite: &LinkRewrite,
) -> Result<TextEdit, FormatError> {
    let LinkTarget::Path(expected) = &rewrite.target else {
        return Err(FormatError::Parse(
            "canvas file rewrite carries a non-path target".to_string(),
        ));
    };
    // Il nodo si trova per target: il percorso è deciso dal contenuto logico,
    // non dallo span — ma lo span deve stare dentro quel percorso.
    let mut found: Option<&MappedLiteral> = None;
    for lit in literals.iter().filter(|lit| {
        matches!(
            lit.path,
            LiteralPath::Node {
                field: super::json_map::CanvasField::File,
                ..
            }
        ) && lit.content_start <= rewrite.span.start
            && rewrite.span.end <= lit.content_end
    }) {
        let normalized = match vault_path_target_for_rewrite(&lit.decoded) {
            LinkTarget::Path(p) => p,
            _ => unreachable!("vault normalizer returns Path"),
        };
        if &normalized == expected || path_matches(&normalized, expected) {
            if found.is_some() {
                return Err(FormatError::Parse(
                    "canvas rewrite span is ambiguous between file cards".to_string(),
                ));
            }
            found = Some(lit);
        }
    }
    let lit = found.ok_or_else(|| {
        FormatError::Parse("canvas rewrite span is not inside a matching file literal".to_string())
    })?;
    let rel_start = rewrite.span.start - lit.content_start;
    let rel_end = rewrite.span.end - lit.content_start;
    let raw_len = lit.content_end - lit.content_start;
    let Some((ds, de)) = raw_to_decoded(&lit.map, raw_len, rel_start, rel_end) else {
        return Err(FormatError::Parse(
            "canvas rewrite span splits a JSON escape or character".to_string(),
        ));
    };
    let current = lit.decoded.get(ds..de).ok_or_else(|| {
        FormatError::Parse("canvas rewrite span is not on a char boundary".to_string())
    })?;
    let current_normalized = match vault_path_target_for_rewrite(current) {
        LinkTarget::Path(p) => p,
        _ => unreachable!("vault normalizer returns Path"),
    };
    if &current_normalized != expected && !path_matches(&current_normalized, expected) {
        return Err(FormatError::Parse(format!(
            "canvas rewrite target changed under us: expected {expected:?}, found {current:?}"
        )));
    }
    Ok(TextEdit::replace(
        rewrite.span,
        json_escape(
            rewrite
                .replacement
                .strip_prefix('/')
                .unwrap_or(&rewrite.replacement),
        ),
    ))
}

/// Confronto tollerante solo per fragment assente da un lato. Non tollera path
/// diversi: quello è un conflitto vero.
fn path_matches(current_normalized: &str, expected: &str) -> bool {
    if current_normalized == expected {
        return true;
    }
    let (c_path, c_frag) = fub_abi::rules::path::split_fragment(current_normalized);
    let (e_path, e_frag) = fub_abi::rules::path::split_fragment(expected);
    if c_frag.is_empty() || e_frag.is_empty() {
        return c_path == e_path;
    }
    false
}

/// Wikilink dentro una card `text`: lo span copre `[[..]]`/`![[..]]` nei byte
/// grezzi del literale `text` del nodo corrispondente. Si converte in
/// coordinate decodificate, si verifica che l'interno parsi al target atteso,
/// si riscrive il solo interno e si rimappa in grezzo.
fn rewrite_wiki_in_text(
    literals: &[MappedLiteral],
    rewrite: &LinkRewrite,
) -> Result<TextEdit, FormatError> {
    let LinkTarget::Wiki { .. } = &rewrite.target else {
        return Err(FormatError::Parse(
            "canvas text rewrite carries a non-wiki target".to_string(),
        ));
    };
    // Il nodo si trova per contenuto: lo span deve stare dentro un literale
    // `text` il cui interno, alle coordinate decodificate dello span, parsa al
    // target atteso. Il primo percorso che verifica vince; ambiguità fra due
    // card identiche con lo span dentro entrambe è impossibile perché gli
    // intervalli dei literali sono disgiunti.
    let mut found: Option<(
        &MappedLiteral,
        std::ops::Range<usize>,
        fub_abi::model::ParsedWikilink,
    )> = None;
    for lit in literals.iter().filter(|lit| {
        matches!(
            lit.path,
            LiteralPath::Node {
                field: super::json_map::CanvasField::Text,
                ..
            }
        ) && lit.content_start <= rewrite.span.start
            && rewrite.span.end <= lit.content_end
    }) {
        let rel_start = rewrite.span.start - lit.content_start;
        let rel_end = rewrite.span.end - lit.content_start;
        let raw_len = lit.content_end - lit.content_start;
        let Some((ds, de)) = raw_to_decoded(&lit.map, raw_len, rel_start, rel_end) else {
            continue;
        };
        let Some(slice) = lit.decoded.get(ds..de) else {
            continue;
        };
        let Some(inner_span) = strip_brackets(slice) else {
            continue;
        };
        let inner = &slice[inner_span.clone()];
        let parsed = parse_wikilink_inner(inner);
        if parsed.target != rewrite.target {
            continue;
        }
        if found.is_some() {
            return Err(FormatError::Parse(
                "canvas rewrite span is ambiguous between text cards".to_string(),
            ));
        }
        found = Some((lit, inner_span, parsed));
    }
    let (lit, inner_span, parsed) = found.ok_or_else(|| {
        FormatError::Parse(
            "canvas rewrite span does not cover a matching wikilink in any text card".to_string(),
        )
    })?;
    // `found` garantisce già percorso + target + interno verificato: si rimappa
    // il solo interno in byte grezzi, senza rileggere lo span.
    let raw_len = lit.content_end - lit.content_start;
    let new_inner = rewrite_wiki_inner(&rewrite.replacement, &parsed);
    let rel_start = rewrite.span.start - lit.content_start;
    let rel_end = rewrite.span.end - lit.content_start;
    let Some((ds, _)) = raw_to_decoded(&lit.map, raw_len, rel_start, rel_end) else {
        return Err(FormatError::Parse(
            "canvas rewrite span splits a JSON escape or character".to_string(),
        ));
    };
    let inner_ds = ds + inner_span.start;
    let inner_de = ds + inner_span.end;
    let Some((inner_rs, inner_re)) = decoded_to_raw(&lit.map, raw_len, inner_ds, inner_de) else {
        return Err(FormatError::Parse(
            "canvas wikilink inner does not map to JSON bytes".to_string(),
        ));
    };
    Ok(TextEdit::replace(
        Span::new(lit.content_start + inner_rs, lit.content_start + inner_re),
        json_escape_inner(&new_inner),
    ))
}

fn rewrite_wiki_inner(replacement: &str, parsed: &fub_abi::model::ParsedWikilink) -> String {
    let base = match &parsed.target {
        LinkTarget::Wiki { heading, block, .. } => {
            let mut out = String::from(replacement);
            if let Some(h) = heading {
                out.push('#');
                out.push_str(h);
            }
            if let Some(b) = block {
                if heading.is_none() {
                    out.push('#');
                }
                out.push('^');
                out.push_str(b);
            }
            out
        }
        _ => replacement.to_string(),
    };
    match &parsed.alias {
        Some(alias) => format!("{base}|{alias}"),
        None => base,
    }
}

/// Interno di `[[..]]`/`![[..]]` senza parentesi, su una fetta già verificata.
/// `None` se la fetta non è un wikilink intero.
fn strip_brackets(slice: &str) -> Option<std::ops::Range<usize>> {
    let (inner_start, inner_end) = if let Some(rest) = slice.strip_prefix("![[") {
        if !rest.ends_with("]]") {
            return None;
        }
        (3, slice.len() - 2)
    } else if let Some(rest) = slice.strip_prefix("[[") {
        if !rest.ends_with("]]") {
            return None;
        }
        (2, slice.len() - 2)
    } else {
        return None;
    };
    (slice.is_char_boundary(inner_start) && slice.is_char_boundary(inner_end))
        .then_some(inner_start..inner_end)
}

/// Escaping JSON canonico di un frammento (virgolette escluse dal chiamante —
/// l'edit copre solo i byte dello span, mai i delimitatori del literale).
fn json_escape_inner(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{0008}' => out.push_str("\\b"),
            '\u{000C}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out
}

/// Escaping JSON del replacement Path (stessa tabella; lo slash resta nudo
/// come in ogni encoder standard — `\/` in ingresso si rilegge uguale).
fn json_escape(value: &str) -> String {
    json_escape_inner(value)
}
