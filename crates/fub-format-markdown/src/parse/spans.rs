//! Ancore e span: dove sta un nodo nel sorgente, i ritagli fra figlio e
//! padre, l'ancora `^id` in coda a un blocco.

use super::*;

/// Un paragrafo che è **soltanto** un'ancora: `^abc` su una riga sua.
pub(super) fn lone_anchor(block: &Block) -> Option<String> {
    match block {
        Block::Paragraph {
            inlines,
            anchor: Some(id),
            ..
        } if inlines.is_empty() => Some(id.clone()),
        _ => None,
    }
}

pub(super) fn set_anchor(block: &mut Block, id: String) {
    match block {
        Block::Heading { anchor, .. }
        | Block::Paragraph { anchor, .. }
        | Block::List { anchor, .. }
        | Block::CodeBlock { anchor, .. }
        | Block::Quote { anchor, .. }
        | Block::ThematicBreak { anchor, .. }
        | Block::Custom { anchor, .. }
        | Block::Table { anchor, .. }
        | Block::ReferenceDefinition { anchor, .. } => *anchor = Some(id),
    }
}

pub(super) fn span_of<'a>(node: &'a AstNode<'a>, offsets: &Offsets<'_>) -> Span {
    sourcepos_span(node.data.borrow().sourcepos, offsets)
}

/// Lo span di un figlio, ritagliato su quello del padre.
///
/// Serve dove il `sourcepos` di una dipendenza fa uscire un nodo dal nodo che lo
/// contiene: il modello promette che uno span nomini **quel** pezzo di documento,
/// e un figlio che esce dal padre rende indecidibile quale dei due mente.
pub(super) fn clipped_to_child(child: Span, parent: Span) -> Span {
    clipped_after_sibling(child, parent, parent.start)
}

/// Lo span di un figlio, ritagliato sul padre **e dopo il fratello che lo
/// precede**.
///
/// Due fratelli non possono rivendicare gli stessi byte: una patch chirurgica su
/// span che si intersecano non ha un risultato definito. Quando il `sourcepos` di
/// comrak lo fa — succede con un `\r` nudo in mezzo a una riga di tabella, che
/// spezza la riga e lascia due celle sullo stesso `|` — il figlio in eccesso
/// ricade su uno span a larghezza zero, che non è un valore inventato per
/// l'occasione: è già come il modello rappresenta una **cella vuota**
/// (`| a || b |` dà una cella `5..5`).
pub(super) fn clipped_after_sibling(child: Span, parent: Span, after: usize) -> Span {
    let minimum = after.max(parent.start).min(parent.end);
    let start = child.start.clamp(minimum, parent.end);
    let end = child.end.clamp(start, parent.end);
    Span::new(start, end)
}

/// Il `sourcepos` di comrak tradotto in uno [`Span`], e **mai invertito**.
///
/// L'inversione non è un'ipotesi: `> > ---\na: 1\n---\n\n# Corpo\n` — una
/// citazione annidata la cui prima riga è un delimitatore di frontmatter — dà a un
/// blocco una fine *prima* del suo inizio (`start: 4, end: 3`). Il fuzzer del
/// §17.1 l'ha trovato al caso 1 771 834.
///
/// Un `start > end` non è uno span sbagliato, è uno span **impossibile**: nessuna
/// `&source[a..b]` ci passa, quindi il primo che ritaglia va in panico. Qui
/// diventa uno span vuoto in `start`, che è la sola forma non ambigua di «di
/// questo nodo non so dire l'estensione» — e che il presidio della coerenza vede
/// come span vuoto, cioè non lo nasconde.
///
/// Sta qui, insieme all'ancoraggio al confine di carattere di [`Offsets::byte`],
/// perché queste due righe **non rendono giusto** un numero sbagliato: rendono
/// impossibile che un numero sbagliato diventi un panico. È la differenza che il
/// §17.1 chiede al fuzzing del parser.
///
/// [`Offsets::byte`]: crate::offsets::Offsets::byte
pub(super) fn sourcepos_span(sp: comrak::nodes::Sourcepos, offsets: &Offsets<'_>) -> Span {
    let start = offsets.byte(sp.start.line, sp.start.column);
    // la colonna di fine è inclusiva in comrak: +1 per l'estremo esclusivo.
    let end = offsets.byte(sp.end.line, sp.end.column + 1);
    Span::new(start, end.max(start))
}

/// L'ancora trovata in coda a un blocco: l'id canonico, quello **come era
/// scritto** (che è ciò che si toglie da testo e inline) e la forma cruda del
/// solo id (che per un heading è l'ancora esplicita da riscrivere verbatim).
pub(super) struct FoundAnchor {
    pub(super) id: String,
    pub(super) raw: String,
    pub(super) written: String,
}

/// `^abc123` in coda alla fetta di sorgente del blocco, preceduto da spazio (o
/// da nient'altro: è la forma su riga propria).
///
/// La registra anche nella tabella piatta del modello, con lo span del blocco e
/// quello del solo marcatore. Il `^` deve essere preceduto da spazio: senza
/// quella condizione `2^10` in fondo a un paragrafo diventerebbe un'ancora.
pub(super) fn trailing_anchor(source: &str, span: Span, acc: &mut Acc) -> Option<FoundAnchor> {
    let slice = source.get(span.start..span.end)?;
    let trimmed = slice.trim_end();
    let at = trimmed.rfind('^')?;
    let written = &trimmed[at..];
    let id_raw = &written[1..];
    if !valid_anchor(id_raw) {
        return None;
    }
    if trimmed[..at]
        .chars()
        .next_back()
        .is_some_and(|c| !c.is_whitespace())
    {
        return None;
    }
    let id = canonical_anchor(id_raw);
    acc.anchors.push(Anchor {
        id: id.clone(),
        span,
        marker: Span::new(span.start + at, span.start + trimmed.len()),
    });
    Some(FoundAnchor {
        id,
        raw: id_raw.to_string(),
        written: written.to_string(),
    })
}

/// Toglie il marcatore dell'ancora dal contenuto: `^abc` è indirizzo, e
/// mostrarlo a schermo o indicizzarlo come parola sarebbe un difetto visibile.
pub(super) fn strip_marker(inlines: &mut Vec<Inline>, text: &mut String, written: &str) {
    fn strip_last(inlines: &mut Vec<Inline>, written: &str) {
        let Some(last) = inlines.last_mut() else {
            return;
        };
        match last {
            Inline::Text(s) => {
                if let Some(rest) = s.trim_end().strip_suffix(written) {
                    *s = rest.trim_end().to_string();
                    if s.is_empty() {
                        inlines.pop();
                    }
                }
            }
            Inline::Emph(children)
            | Inline::Strong(children)
            | Inline::Superscript(children)
            | Inline::Subscript(children)
            | Inline::Strikethrough(children) => {
                strip_last(children, written);
                if children.is_empty() {
                    inlines.pop();
                }
            }
            Inline::Link {
                label: Some(children),
                ..
            } => {
                strip_last(children, written);
            }
            _ => {}
        }
    }

    strip_last(inlines, written);
    if let Some(rest) = text.trim_end().strip_suffix(written) {
        *text = rest.trim_end().to_string();
    }
}
