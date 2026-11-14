//! I commenti nel testo: CriticMarkup, `{==passo==}{>>messaggio<<}`.
//!
//! Un commento è un passo evidenziato, `{==…==}`, seguito subito da uno o più
//! messaggi `{>>…<<}`; un messaggio senza passo davanti commenta il punto in
//! cui sta. Il formato su disco e le sue regole sono in
//! `docs/reference/note-conventions.md`.
//!
//! **Perché li legge il provider e non una `SyntaxRule`**, come `%%…%%` e
//! `==…==`: una regola prende il testo dopo il parse, e il testo di un
//! messaggio il parse l'ha già letto come Markdown — un `[[link]]` o un `#tag`
//! dentro un messaggio sarebbero già nell'indice, e la regola non può
//! toglierli. Il testo di un messaggio non è testo della nota: solo la
//! grammatica può non leggerlo, come per la formula fra dollari.
//!
//! # Come si legge
//!
//! Sui figli di **un** contenitore di inline (un paragrafo, un titolo, una
//! cella, un'enfasi): i segni si cercano nei soli nodi di testo, quindi dentro
//! codice, formule e HTML non ci sono, e un segno aperto in un contenitore si
//! chiude solo nello stesso — un commento non attraversa i paragrafi né la
//! formattazione. Il passo resta inline come gli altri: i suoi link, tag e
//! stili sono della nota. I nodi che cadono dentro un messaggio non si
//! convertono affatto, e il testo del messaggio non entra nel testo del blocco.
//!
//! Un segno che non si chiude resta testo. `\{==` e `\{>>` sono letterali.
//! Un `{==…==}` senza messaggio subito dopo non è un commento, e resta il testo
//! di oggi (con dentro l'evidenziato `==…==` di chi lo legge così).

use super::*;

/// I quattro segni, cercati nei nodi di testo.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mark {
    /// `{==`: apre il passo.
    RangeOpen,
    /// `==}`: chiude il passo.
    RangeClose,
    /// `{>>`: apre un messaggio.
    MessageOpen,
    /// `<<}`: chiude un messaggio.
    MessageClose,
}

/// Ogni segno è lungo tre byte.
const MARK_LEN: usize = 3;

/// Le parti di un contenitore che diventano un commento: span assoluti nella
/// sorgente, in ordine e disgiunti, ognuno col suo inline.
pub(super) struct CommentPlan {
    cuts: Vec<(Span, Inline)>,
    /// Il primo taglio che può ancora toccare il figlio che si sta
    /// convertendo: i figli arrivano in ordine di sorgente, e così il giro
    /// resta lineare anche su un paragrafo con migliaia di commenti.
    next: usize,
}

impl CommentPlan {
    /// I tagli che toccano `span`, dal primo utile in avanti.
    fn overlapping(&mut self, span: Span) -> &[(Span, Inline)] {
        while self.next < self.cuts.len() && self.cuts[self.next].0.end <= span.start {
            self.next += 1;
        }
        let from = self.next;
        let mut to = from;
        while to < self.cuts.len() && self.cuts[to].0.start < span.end.max(span.start + 1) {
            to += 1;
        }
        &self.cuts[from..to]
    }

    /// Il figlio non di testo `span` sta tutto dentro un messaggio: non si
    /// converte.
    pub(super) fn swallows(&mut self, span: Span) -> bool {
        self.overlapping(span)
            .iter()
            .any(|(cut, _)| cut.start <= span.start && span.end <= cut.end)
    }

    /// Il nodo di testo `span` ha un segno dentro, o sta dentro un messaggio:
    /// lo converte [`CommentPlan::split_text`].
    pub(super) fn touches(&mut self, span: Span) -> bool {
        !self.overlapping(span).is_empty()
    }

    /// I pezzi di un nodo di testo, in ordine: `Ok(range)` è testo della nota
    /// (byte assoluti), `Err(inline)` un segno o un messaggio che comincia qui.
    /// Ciò che sta dentro un taglio cominciato in un fratello precedente non
    /// c'è.
    pub(super) fn split_text(&mut self, span: Span) -> Vec<Result<Range<usize>, Inline>> {
        let mut pieces = Vec::new();
        let mut cursor = span.start;
        for (cut, inline) in self.overlapping(span) {
            if cut.start > cursor {
                pieces.push(Ok(cursor..cut.start.min(span.end)));
            }
            if cut.start >= span.start {
                pieces.push(Err(inline.clone()));
            }
            cursor = cursor.max(cut.end.min(span.end));
        }
        if cursor < span.end {
            pieces.push(Ok(cursor..span.end));
        }
        pieces
    }
}

/// I commenti fra i figli di `node`, o `None` se non ce n'è nessuno.
pub(super) fn plan<'a>(
    node: &'a AstNode<'a>,
    source: &str,
    offsets: &Offsets<'_>,
) -> Option<CommentPlan> {
    let marks = marks(node, source, offsets);
    if marks.is_empty() {
        return None;
    }
    let in_cell = node
        .ancestors()
        .any(|a| matches!(a.data.borrow().value, NodeValue::TableCell));
    let cuts = matched(&marks, source, in_cell);
    (!cuts.is_empty()).then_some(CommentPlan { cuts, next: 0 })
}

/// I segni nei figli di testo di `node`, in ordine di sorgente.
///
/// Un nodo di testo la cui fetta di sorgente non dice il suo testo (un
/// `sourcepos` che comrak tronca) non porta segni: tagliarlo a byte che non
/// sono i suoi sposterebbe il testo della nota.
fn marks<'a>(node: &'a AstNode<'a>, source: &str, offsets: &Offsets<'_>) -> Vec<(usize, Mark)> {
    let mut out = Vec::new();
    for child in node.children() {
        let NodeValue::Text(text) = &child.data.borrow().value else {
            continue;
        };
        let span = span_of(child, offsets);
        let Some(slice) = source.get(span.start..span.end) else {
            continue;
        };
        let bytes = slice.as_bytes();
        if !bytes
            .windows(MARK_LEN)
            .any(|w| w == b"{==" || w == b"==}" || w == b"{>>" || w == b"<<}")
        {
            continue;
        }
        if slice != &text[..] && decode_segment(source, slice, span.start) != text[..] {
            continue;
        }
        for (at, window) in bytes.windows(MARK_LEN).enumerate() {
            let abs = span.start + at;
            let mark = match window {
                b"{==" if !is_escaped(source, abs) => Mark::RangeOpen,
                b"{>>" if !is_escaped(source, abs) => Mark::MessageOpen,
                b"==}" => Mark::RangeClose,
                b"<<}" => Mark::MessageClose,
                _ => continue,
            };
            out.push((abs, mark));
        }
    }
    out
}

/// Accoppia i segni: i passi coi loro messaggi, e i messaggi da soli.
fn matched(marks: &[(usize, Mark)], source: &str, in_cell: bool) -> Vec<(Span, Inline)> {
    // Per ogni indice, il primo `<<}` da lì in avanti: trovare la chiusura di
    // un messaggio non deve scorrere tutti i segni che seguono.
    let mut next_close = vec![usize::MAX; marks.len() + 1];
    for at in (0..marks.len()).rev() {
        next_close[at] = if marks[at].1 == Mark::MessageClose {
            at
        } else {
            next_close[at + 1]
        };
    }
    // Gli a capo fra il primo segno e l'ultimo, cercati una volta sola: ogni
    // messaggio chiede se ne attraversa uno.
    let (lo, hi) = (marks[0].0, marks[marks.len() - 1].0);
    let breaks: Vec<usize> = source[lo..hi]
        .match_indices(['\n', '\r'])
        .map(|(at, _)| lo + at)
        .collect();
    let first_from = |pos: usize| marks.partition_point(|(at, _)| *at < pos);
    let opens_message_at = |pos: usize| {
        let at = first_from(pos);
        marks
            .get(at..)
            .unwrap_or_default()
            .iter()
            .take_while(|(p, _)| *p == pos)
            .any(|(_, m)| *m == Mark::MessageOpen)
    };
    // I messaggi in fila che cominciano a `pos`: ognuno si chiude sul primo
    // `<<}` dopo la sua apertura, e il seguente comincia subito dopo.
    let chain = |mut pos: usize| {
        let mut out = Vec::new();
        while opens_message_at(pos) {
            let close = next_close[first_from(pos + MARK_LEN)];
            let Some(&(close, _)) = marks.get(close) else {
                break;
            };
            // Un messaggio sta su una riga: in una citazione o in una voce la
            // riga dopo porta i segni del contenitore, che non sono del
            // messaggio.
            let line_break = breaks.get(breaks.partition_point(|&at| at < pos));
            if line_break.is_some_and(|&at| at < close) {
                break;
            }
            out.push(Span::new(pos, close + MARK_LEN));
            pos = close + MARK_LEN;
        }
        out
    };

    let mut cuts = Vec::new();
    let mut floor = 0;
    let mut at = 0;
    while at < marks.len() {
        let (pos, mark) = marks[at];
        at += 1;
        if pos < floor {
            continue;
        }
        let (range, messages) = match mark {
            Mark::RangeOpen => {
                // Il passo si chiude sul primo `==}`; un altro segno d'apertura
                // prima di lui vuol dire che questo `{==` non apre niente.
                let closing = marks[at..]
                    .iter()
                    .filter(|(p, _)| *p >= pos + MARK_LEN)
                    .find(|(_, m)| *m != Mark::MessageClose);
                let Some(&(close, Mark::RangeClose)) = closing else {
                    continue;
                };
                (Some((pos, close)), chain(close + MARK_LEN))
            }
            Mark::MessageOpen => (None, chain(pos)),
            Mark::RangeClose | Mark::MessageClose => continue,
        };
        let Some(last) = messages.last() else {
            continue;
        };
        floor = last.end;
        if let Some((open, close)) = range {
            let (start, end) = (
                Span::new(open, open + MARK_LEN),
                Span::new(close, close + MARK_LEN),
            );
            cuts.push((start, edge(start, "{==", "start")));
            cuts.push((end, edge(end, "==}", "end")));
        }
        for span in messages {
            cuts.push((span, message(source, span, range.is_some(), in_cell)));
        }
    }
    cuts
}

/// Un estremo del passo: `{==` (`start`) o `==}` (`end`).
fn edge(span: Span, source: &str, edge: &str) -> Inline {
    Inline::Custom {
        custom_kind: custom_kind::COMMENT_RANGE.to_string(),
        attrs: serde_json::json!({ "source": source, "edge": edge }),
        span,
    }
}

/// Un messaggio, `span` compresi i due segni.
///
/// In una cella la `\|` della cella è già sciolta, come per ogni inline della
/// cella (comrak la toglie prima di leggerli): chi riscrive la cella rimette
/// la barra a ogni `|`, e il messaggio torna com'era.
fn message(source: &str, span: Span, anchored: bool, in_cell: bool) -> Inline {
    let raw = &source[span.start..span.end];
    let raw = if in_cell {
        raw.replace("\\|", "|")
    } else {
        raw.to_string()
    };
    let body = &raw[MARK_LEN..raw.len() - MARK_LEN];
    let header = header(body);
    Inline::Custom {
        custom_kind: custom_kind::COMMENT_MESSAGE.to_string(),
        attrs: serde_json::json!({
            "source": raw,
            "author": header.author,
            "date": header.date,
            "text": header.text,
            "anchored": anchored,
        }),
        span,
    }
}

/// L'intestazione di un messaggio: `@Autore AAAA-MM-GG HH:MM: testo`.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Header<'a> {
    pub(crate) author: Option<&'a str>,
    pub(crate) date: Option<&'a str>,
    pub(crate) text: &'a str,
}

/// Legge l'intestazione di un messaggio.
///
/// Le forme: `@Autore AAAA-MM-GG HH:MM: testo`, con l'ora facoltativa;
/// `@Autore: testo`; `AAAA-MM-GG HH:MM: testo`, senza autore. Ciò che non ha
/// nessuna delle tre forme è tutto testo, senza autore né data: è il messaggio
/// scritto a mano o da un'app che non conosce la convenzione.
pub(crate) fn header(body: &str) -> Header<'_> {
    let none = Header {
        author: None,
        date: None,
        text: body.trim(),
    };
    if let Some(after) = body.strip_prefix('@') {
        // Il nome può avere spazi: finisce davanti alla prima data seguita dai
        // due punti, o ai primi due punti.
        for (at, _) in after.match_indices(' ') {
            if let Some((date, text)) = dated(&after[at + 1..]) {
                return Header {
                    author: non_empty(&after[..at]),
                    date: Some(date),
                    text,
                };
            }
        }
        return match after.split_once(':') {
            Some((author, text)) => Header {
                author: non_empty(author),
                date: None,
                text: text.trim(),
            },
            None => none,
        };
    }
    match dated(body) {
        Some((date, text)) => Header {
            author: None,
            date: Some(date),
            text,
        },
        None => none,
    }
}

fn non_empty(s: &str) -> Option<&str> {
    let s = s.trim();
    (!s.is_empty()).then_some(s)
}

/// `AAAA-MM-GG[ HH:MM]: testo` in testa a `s`: la data (con l'ora) e il testo.
fn dated(s: &str) -> Option<(&str, &str)> {
    // Si guarda byte per byte, e ogni byte voluto è ASCII: dove la forma
    // regge, i tagli cadono su confini di carattere.
    let shaped = |shape: &[u8]| {
        shape.len() <= s.len()
            && shape.iter().zip(s.bytes()).all(|(want, got)| match want {
                b'9' => got.is_ascii_digit(),
                other => *other == got,
            })
    };
    if !shaped(b"9999-99-99") {
        return None;
    }
    let end = if shaped(b"9999-99-99 99:99") { 16 } else { 10 };
    let rest = s[end..].strip_prefix(':')?;
    Some((&s[..end], rest.trim()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_header_has_three_forms_and_otherwise_is_text() {
        let h = header("@Anna Bianchi 2026-11-08 17:40: va bene così");
        assert_eq!(h.author, Some("Anna Bianchi"));
        assert_eq!(h.date, Some("2026-11-08 17:40"));
        assert_eq!(h.text, "va bene così");

        let h = header("@Anna 2026-11-08: senza ora");
        assert_eq!((h.author, h.date, h.text), (Some("Anna"), Some("2026-11-08"), "senza ora"));

        let h = header("@Anna: senza data");
        assert_eq!((h.author, h.date, h.text), (Some("Anna"), None, "senza data"));

        let h = header("2026-11-08 17:40: senza nome");
        assert_eq!((h.author, h.date, h.text), (None, Some("2026-11-08 17:40"), "senza nome"));

        let h = header("scritto a mano: 10:30");
        assert_eq!((h.author, h.date, h.text), (None, None, "scritto a mano: 10:30"));

        let h = header("@Anna");
        assert_eq!((h.author, h.date, h.text), (None, None, "@Anna"));
    }

    #[test]
    fn a_date_that_is_not_one_is_part_of_the_name() {
        let h = header("@Anna 2026-1-08: x");
        assert_eq!(h.author, Some("Anna 2026-1-08"));
        assert_eq!(h.date, None);
    }
}
