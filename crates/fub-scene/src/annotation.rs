//! Le annotazioni di un PDF: un file `.fubann`, cioè una scena con qualche
//! attributo `fub:*` in più.
//!
//! Il contratto è il [formato delle
//! annotazioni](../../../docs/reference/annotation-format.md), e in questo
//! modulo i `§` sono le sue sezioni. Il file è SVG come un disegno, e la
//! scena si legge con le regole di sempre: qui si aggiunge soltanto ciò che
//! lega le annotazioni al PDF, cioè il documento annotato, l'impronta e il
//! numero di pagine della radice (§2), i gruppi di pagina (§3) e il corpo delle
//! note (§4).
//!
//! Il lettore non confronta niente con il PDF: riceve solo la sorgente del
//! `.fubann`. Impronta e numero di pagine li verifica chi apre il PDF accanto,
//! e un valore fuori grammatica qui è soltanto assente.

use serde::Serialize;

use crate::analysis::paragraph;
use crate::text::{Span, Utf16Map};
use crate::values::{href, number_list, Href};
use crate::xml::{Document, Kind, NS_FUB, NS_SVG};
use crate::{read_then, ReadError, Scene};

/// Il prefisso dell'impronta: l'unico algoritmo della versione 1 (§2).
const DIGEST_PREFIX: &str = "sha256:";

/// Quante cifre esadecimali ha un'impronta SHA-256.
const DIGEST_HEX: usize = 64;

/// Le annotazioni lette da un `.fubann`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Annotations {
    /// La scena, letta come quella di un disegno: stato, voci, indice,
    /// riepilogo e diagnostica.
    pub scene: Scene,
    /// Il PDF annotato, da `fub:annotates`, se è un percorso del vault.
    pub annotates: Option<Annotated>,
    /// L'impronta del PDF da `fub:digest`, in minuscolo, se rispetta la
    /// grammatica di §2.
    pub digest: Option<String>,
    /// Il numero di pagine del PDF da `fub:pages`, se è un intero positivo.
    pub page_count: Option<u32>,
    /// I gruppi di pagina, in ordine di documento.
    pub pages: Vec<Page>,
    /// Le note, in ordine di documento.
    pub notes: Vec<Note>,
}

/// Il documento annotato.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Annotated {
    /// Il percorso com'è scritto, ripulito come lo legge un URL: relativo al
    /// `.fubann`, o dalla radice del vault se comincia con `/`. È la regola
    /// dell'`href` di un `a`.
    pub path: String,
    /// Il valore grezzo di `fub:annotates`, virgolette escluse: è ciò che si
    /// riscrive quando il PDF cambia nome.
    pub value: Span,
}

/// Un gruppo di pagina: un `g` figlio della radice con `fub:page` (§3).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Page {
    /// Il numero della pagina, da 1 come nel frammento `#page=k`.
    pub number: u32,
    /// Larghezza e altezza della pagina in punti PDF, da `fub:page-size`, se
    /// sono due numeri positivi.
    pub size: Option<[f64; 2]>,
    /// L'elemento `g`.
    #[serde(flatten)]
    pub span: Span,
}

/// Una nota: un `text` con il corpo esteso in `fub:note` (§4).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Note {
    /// Il testo disegnato, letto come quello di ogni `text` dell'indice;
    /// vuoto se la nota non ne mostra.
    pub text: String,
    /// Il corpo, con i terminatori di riga ridotti a `\n` e il resto com'è.
    pub body: String,
    /// L'elemento `text`.
    #[serde(flatten)]
    pub span: Span,
    /// Il contenuto fra i tag del `text`; `None` per un tag autochiuso.
    pub content: Option<Span>,
    /// Il valore grezzo di `fub:note`, virgolette escluse.
    pub value: Span,
}

/// Ciò che delle annotazioni non è la scena.
struct Parts {
    annotates: Option<Annotated>,
    digest: Option<String>,
    page_count: Option<u32>,
    pages: Vec<Page>,
    notes: Vec<Note>,
}

/// Legge le annotazioni da `source`, il testo intero del `.fubann`, BOM
/// compreso.
///
/// La scena è quella che darebbe [`read`](crate::read), dallo stesso
/// documento XML letto una volta sola, e gli errori sono gli stessi: un file
/// malformato, o con una radice che non è `svg` di SVG, non è nemmeno un
/// insieme di annotazioni. Di un file oltre [`MAX_EDIT_BYTES`](crate::MAX_EDIT_BYTES)
/// si legge la testa: gli attributi della radice ci sono, pagine e note no.
pub fn read_annotations(source: &str) -> Result<Annotations, ReadError> {
    let (scene, parts) = read_then(source, parts)?;
    Ok(Annotations {
        scene,
        annotates: parts.annotates,
        digest: parts.digest,
        page_count: parts.page_count,
        pages: parts.pages,
        notes: parts.notes,
    })
}

fn parts(doc: &Document<'_>, map: &Utf16Map<'_>) -> Parts {
    let root = doc.element(doc.root).expect("la radice è un elemento");
    let annotates = root.attr(NS_FUB, "annotates").and_then(|attr| {
        let Href::Vault(path) = href(&attr.value) else {
            return None;
        };
        Some(Annotated {
            path,
            value: map.span(attr.raw.0, attr.raw.1),
        })
    });
    let mut parts = Parts {
        annotates,
        digest: root.value(NS_FUB, "digest").and_then(digest),
        page_count: root.value(NS_FUB, "pages").and_then(positive),
        pages: Vec::new(),
        notes: Vec::new(),
    };
    // Di un file troncato c'è solo la testa, che non ha né pagine né note.
    if !doc.complete {
        return parts;
    }

    for &child in &root.children {
        let Some(group) = doc.element(child).filter(|e| e.is_svg("g")) else {
            continue;
        };
        // Un `fub:page` fuori grammatica non fa una pagina: il gruppo resta un
        // gruppo qualunque, e le sue annotazioni stanno fuori dalle pagine.
        let Some(number) = group.value(NS_FUB, "page").and_then(positive) else {
            continue;
        };
        let node = &doc.nodes[child];
        parts.pages.push(Page {
            number,
            size: group.value(NS_FUB, "page-size").and_then(page_size),
            span: map.span(node.start, node.end),
        });
    }

    // Le note in ordine di documento, che è l'ordine dell'arena. Come
    // nell'indice un `text` dentro un altro non si disegna, e non è una nota:
    // `inside` è la fine dell'ultimo letto.
    let mut inside = 0;
    for (id, node) in doc.nodes.iter().enumerate() {
        let Kind::Element(element) = &node.kind else {
            continue;
        };
        if element.ns != NS_SVG || element.local != "text" || node.start < inside {
            continue;
        }
        inside = node.end;
        let Some(attr) = element.attr(NS_FUB, "note") else {
            continue;
        };
        let body = lines(&attr.value);
        if body.chars().all(char::is_whitespace) {
            continue;
        }
        parts.notes.push(Note {
            text: paragraph(doc, id),
            body,
            span: map.span(node.start, node.end),
            content: element
                .close_start
                .map(|close| map.span(element.open_end, close)),
            value: map.span(attr.raw.0, attr.raw.1),
        });
    }
    parts
}

/// Un intero positivo scritto in cifre decimali, che sta in 32 bit: la
/// grammatica di `fub:version`, valida anche per `fub:pages` e `fub:page`.
fn positive(value: &str) -> Option<u32> {
    if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    value.parse().ok().filter(|&n| n > 0)
}

/// `sha256:` e 64 cifre esadecimali, restituite in minuscolo: due impronte
/// uguali sono la stessa stringa.
fn digest(value: &str) -> Option<String> {
    let hex = value.strip_prefix(DIGEST_PREFIX)?;
    (hex.len() == DIGEST_HEX && hex.bytes().all(|b| b.is_ascii_hexdigit()))
        .then(|| format!("{DIGEST_PREFIX}{}", hex.to_ascii_lowercase()))
}

/// Due numeri positivi: larghezza e altezza.
fn page_size(value: &str) -> Option<[f64; 2]> {
    match number_list(value)?.as_slice() {
        &[width, height] if width > 0.0 && height > 0.0 => Some([width, height]),
        _ => None,
    }
}

/// Il valore con `\r\n` e `\r` ridotti a `\n`. Un a capo letterale dentro un
/// attributo il parser XML l'ha già fatto diventare uno spazio: arrivano qui
/// solo quelli scritti come `&#10;` e `&#13;`.
fn lines(value: &str) -> String {
    if !value.contains('\r') {
        return value.to_owned();
    }
    value.replace("\r\n", "\n").replace('\r', "\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_count_is_a_positive_decimal_integer() {
        assert_eq!(positive("12"), Some(12));
        assert_eq!(positive("007"), Some(7));
        assert_eq!(positive("4294967295"), Some(u32::MAX));
        for wrong in ["", "0", "-1", "+1", "1.0", " 1", "1 ", "4294967296", "uno"] {
            assert_eq!(positive(wrong), None, "{wrong:?}");
        }
    }

    #[test]
    fn a_digest_is_sha256_and_64_hex_digits() {
        let hex = "0123456789abcdef".repeat(4);
        let digest_of = |value: String| digest(&value);
        assert_eq!(
            digest_of(format!("sha256:{hex}")),
            Some(format!("sha256:{hex}"))
        );
        assert_eq!(
            digest_of(format!("sha256:{}", hex.to_uppercase())),
            Some(format!("sha256:{hex}"))
        );
        for wrong in [
            format!("SHA256:{hex}"),
            format!("sha1:{hex}"),
            format!("sha256:{}", &hex[1..]),
            format!("sha256:{hex}0"),
            format!(" sha256:{hex}"),
            format!("sha256:{}g", &hex[1..]),
            "sha256:".to_owned(),
        ] {
            assert_eq!(digest(&wrong), None, "{wrong}");
        }
    }

    #[test]
    fn a_page_size_is_two_positive_numbers() {
        assert_eq!(page_size("595.28 841.89"), Some([595.28, 841.89]));
        assert_eq!(page_size(" 612,792 "), Some([612.0, 792.0]));
        for wrong in ["", "595", "595 842 1", "0 842", "595 -842", "a b"] {
            assert_eq!(page_size(wrong), None, "{wrong:?}");
        }
    }

    #[test]
    fn line_terminators_become_line_feeds() {
        assert_eq!(lines("a\r\nb\rc\nd"), "a\nb\nc\nd");
        assert_eq!(lines("una riga"), "una riga");
    }
}
