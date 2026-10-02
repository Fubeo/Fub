//! I riferimenti di un disegno: la riscrittura al rename e la scrittura di un
//! riferimento nuovo.
//!
//! Un riferimento è il valore di un `href` (o di un `xlink:href`) su un `a` o
//! su un `image`: un percorso del vault relativo al disegno, o dalla radice se
//! comincia con `/` (§4). La riscrittura tocca **solo i byte del valore**,
//! virgolette escluse: il resto del tag, gli altri attributi, i terminatori di
//! riga e il BOM restano identici (§7, punto 7).
//!
//! Ogni valore scritto si rilegge con `fub-scene` prima di uscire da qui: deve
//! dare esattamente il percorso chiesto. È l'unico modo di non avere due idee
//! di che cosa sia un riferimento del vault, quella di chi scrive e quella di
//! chi legge.

use fub_abi::format::{LinkInsert, LinkRewrite, ParseContext};
use fub_abi::model::{DocId, LinkTarget, Span};
use fub_abi::rules::path::{relative_ref, resolve_against, split_fragment};
use fub_abi::{FormatError, TextEdit};
use fub_scene::{Reference, SVG_NS};

/// Le patch che portano ogni riferimento chiesto alla destinazione nuova.
///
/// Una richiesta nomina l'elemento con lo span che il modello gli ha dato, e
/// il percorso che ci ha letto. Deve corrispondere a un riferimento della
/// sorgente com'è adesso: uno span che non è più quello di un `a` o di un
/// `image`, o un percorso cambiato nel frattempo, sono un errore e non una
/// patch scritta altrove. Un `xlink:href` che ripete lo stesso URL accanto a
/// `href` si riscrive insieme: un lettore SVG 1.1 legge quello.
pub(crate) fn rewrite(
    source: &str,
    rewrites: &[LinkRewrite],
) -> Result<Vec<TextEdit>, FormatError> {
    if rewrites.is_empty() {
        return Ok(Vec::new());
    }
    let scene = fub_scene::read(source).map_err(|error| FormatError::Parse(error.to_string()))?;
    let references: Vec<&Reference> = scene
        .index
        .links
        .iter()
        .chain(&scene.index.embeds)
        .collect();
    let mut edits = Vec::with_capacity(rewrites.len());
    for rewrite in rewrites {
        let LinkTarget::Path(expected) = &rewrite.target else {
            return Err(FormatError::Parse(format!(
                "un disegno ha solo riferimenti per percorso, non {:?}",
                rewrite.target
            )));
        };
        let reference = references
            .iter()
            .find(|reference| {
                reference.span.bytes == [rewrite.span.start, rewrite.span.end]
                    && &reference.path == expected
            })
            .ok_or_else(|| {
                FormatError::Parse(format!(
                    "nessun collegamento del disegno in {}..{} porta a «{expected}»",
                    rewrite.span.start, rewrite.span.end
                ))
            })?;
        for raw in std::iter::once(reference.href).chain(reference.shadowed) {
            let span = Span::new(raw.bytes[0], raw.bytes[1]);
            let quote = quote_before(source, span.start)?;
            edits.push(TextEdit::replace(
                span,
                attribute_value(&rewrite.replacement, quote)?,
            ));
        }
    }
    // Come vuole `EditRequest`: in ordine, e senza sovrapporsi. Due richieste
    // sullo stesso elemento sono un errore, non una scelta fra le due.
    edits.sort_by_key(|edit| (edit.span.start, edit.span.end));
    if let Some(pair) = edits
        .windows(2)
        .find(|pair| pair[1].span.start < pair[0].span.end)
    {
        return Err(FormatError::Parse(format!(
            "due riscritture sullo stesso valore in {}..{}",
            pair[1].span.start, pair[1].span.end
        )));
    }
    Ok(edits)
}

/// Il valore di `href` con cui il disegno `ctx.doc_id` punta `link`.
///
/// Il bersaglio `Path` si legge con la regola dei link del vault, relativo al
/// disegno o dalla radice se comincia con `/`, e si scrive **relativo** alla
/// cartella del disegno, col frammento così com'è. Il risultato è il valore
/// dell'attributo già escapato per stare fra virgolette doppie, che è come
/// FubDraw scrive gli attributi (§7). Un bersaglio fuori dal vault è un
/// errore; un wikilink o un URL non si scrivono in un disegno (§4), e la
/// risposta è `None`. L'etichetta non c'entra: ciò che un `a` mostra è il suo
/// contenuto disegnato, e un `image` si scrive come un `a`.
pub(crate) fn format(ctx: &ParseContext, link: &LinkInsert) -> Result<Option<String>, FormatError> {
    let LinkTarget::Path(written) = &link.target else {
        return Ok(None);
    };
    let doc = DocId::new(ctx.doc_id.clone());
    let resolved = resolve_against(&doc, written).ok_or_else(|| {
        FormatError::Serialize(format!("«{written}» non porta a un documento del vault"))
    })?;
    let (_, fragment) = split_fragment(written);
    let target = format!("{}{fragment}", relative_ref(&doc, &DocId::new(resolved)));
    attribute_value(&target, '"').map(Some)
}

/// Le virgolette che aprono il valore che comincia a `start`.
fn quote_before(source: &str, start: usize) -> Result<char, FormatError> {
    match source
        .get(..start)
        .and_then(|head| head.chars().next_back())
    {
        Some(quote @ ('"' | '\'')) => Ok(quote),
        _ => Err(FormatError::Parse(format!(
            "il valore in {start} non è fra virgolette"
        ))),
    }
}

/// Il valore grezzo che, fra le virgolette `quote`, si rilegge come `target`.
///
/// Prima così com'è; se il lettore non lo prende per un percorso del vault,
/// perché il primo segmento sembra uno schema (`nota:1.md`), con `./` davanti,
/// che non cambia la destinazione. Se nemmeno così si rilegge, è un errore.
fn attribute_value(target: &str, quote: char) -> Result<String, FormatError> {
    if !target.trim().is_empty() {
        let candidates = [
            Some(target.to_owned()),
            (!target.starts_with('/')).then(|| format!("./{target}")),
        ];
        for url in candidates.into_iter().flatten() {
            let value = escape_attribute(&url, quote);
            if read_back(&value, quote).as_deref() == Some(url.as_str()) {
                return Ok(value);
            }
        }
    }
    Err(FormatError::Serialize(format!(
        "«{target}» non si scrive come percorso del vault in un `href`"
    )))
}

/// Il percorso che il lettore delle scene legge in `<a href=…>` con quel
/// valore grezzo, se è un riferimento del vault.
fn read_back(value: &str, quote: char) -> Option<String> {
    let probe = format!("<svg xmlns=\"{SVG_NS}\"><a href={quote}{value}{quote}/></svg>");
    let scene = fub_scene::read(&probe).ok()?;
    match scene.index.links.as_slice() {
        [only] => Some(only.path.clone()),
        _ => None,
    }
}

/// Un valore d'attributo con gli escape di §7: `&amp;`, `&lt;`, `&gt;`,
/// `&quot;`, e `&#9;`, `&#10;`, `&#13;` per tabulazioni e a capo, che il parser
/// altrimenti trasformerebbe in spazi. Fra apici singoli anche `&apos;`.
fn escape_attribute(value: &str, quote: char) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' if quote == '\'' => out.push_str("&apos;"),
            '\t' => out.push_str("&#9;"),
            '\n' => out.push_str("&#10;"),
            '\r' => out.push_str("&#13;"),
            c => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_attribute_is_escaped_for_its_quotes() {
        assert_eq!(
            escape_attribute("a&b<c>\"d'e\tf\ng\rh", '"'),
            "a&amp;b&lt;c&gt;&quot;d'e&#9;f&#10;g&#13;h"
        );
        assert_eq!(escape_attribute("l'acqua", '\''), "l&apos;acqua");
    }

    #[test]
    fn a_name_that_looks_like_a_scheme_takes_a_dot_slash() {
        assert_eq!(attribute_value("nota:1.md", '"').unwrap(), "./nota:1.md");
        assert_eq!(
            attribute_value("cartella/nota:1.md", '"').unwrap(),
            "cartella/nota:1.md"
        );
        assert_eq!(
            attribute_value("/nota.md#Titolo", '"').unwrap(),
            "/nota.md#Titolo"
        );
        assert_eq!(attribute_value("a&b.md", '\'').unwrap(), "a&amp;b.md");
        // Niente che si rilegga come un percorso del vault.
        assert!(attribute_value("", '"').is_err());
        assert!(attribute_value("  ", '"').is_err());
        assert!(attribute_value("//host/x.md", '"').is_err());
    }
}
