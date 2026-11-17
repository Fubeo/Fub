//! Il confronto riga per riga fra una versione e il testo attuale, come lo
//! disegna il pannello.

use super::*;

/// Oltre questo prodotto di righe diverse il confronto riga per riga non si
/// calcola: la tabella costerebbe più di quanto un pannello laterale possa
/// mostrare, e il pannello si ridisegna a ogni scrittura.
const DIFF_CELLS: usize = 4_000_000;
/// Righe uguali mostrate attorno a ogni cambiamento.
const DIFF_CONTEXT: usize = 2;
/// Righe disegnate al massimo: il resto si conta, non si tace.
pub(super) const DIFF_MAX_LINES: usize = 400;

/// Una riga del confronto fra una versione (`Removed`) e la nota attuale
/// (`Added`).
#[derive(Debug, PartialEq, Eq)]
pub(super) enum Change<'a> {
    Same(&'a str),
    Removed(&'a str),
    Added(&'a str),
}

/// Il confronto riga per riga, o `None` quando la parte diversa è troppo grande
/// per [`DIFF_CELLS`].
///
/// Prefisso e suffisso comuni si tolgono prima: una modifica in una nota lunga
/// tocca di solito poche righe, e la tabella si costruisce solo su quelle.
/// Il resto è la sottosequenza comune più lunga, che tiene le righe uguali
/// nel loro ordine.
pub(super) fn line_diff<'a>(old: &'a str, new: &'a str) -> Option<Vec<Change<'a>>> {
    let a: Vec<&str> = old.lines().collect();
    let b: Vec<&str> = new.lines().collect();
    let prefix = a.iter().zip(&b).take_while(|(x, y)| x == y).count();
    let suffix = a[prefix..]
        .iter()
        .rev()
        .zip(b[prefix..].iter().rev())
        .take_while(|(x, y)| x == y)
        .count();
    let (ma, mb) = (&a[prefix..a.len() - suffix], &b[prefix..b.len() - suffix]);
    if ma.len().saturating_mul(mb.len()) > DIFF_CELLS {
        return None;
    }
    // `lcs[i][j]`: la sottosequenza comune più lunga fra `ma[i..]` e `mb[j..]`.
    let width = mb.len() + 1;
    let mut lcs = vec![0u32; (ma.len() + 1) * width];
    for i in (0..ma.len()).rev() {
        for j in (0..mb.len()).rev() {
            lcs[i * width + j] = if ma[i] == mb[j] {
                lcs[(i + 1) * width + j + 1] + 1
            } else {
                lcs[(i + 1) * width + j].max(lcs[i * width + j + 1])
            };
        }
    }
    let mut out: Vec<Change<'a>> = a[..prefix].iter().map(|l| Change::Same(l)).collect();
    let (mut i, mut j) = (0, 0);
    while i < ma.len() || j < mb.len() {
        if i < ma.len() && j < mb.len() && ma[i] == mb[j] {
            out.push(Change::Same(ma[i]));
            i += 1;
            j += 1;
        } else if i < ma.len()
            && (j == mb.len() || lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])
        {
            out.push(Change::Removed(ma[i]));
            i += 1;
        } else {
            out.push(Change::Added(mb[j]));
            j += 1;
        }
    }
    out.extend(a[a.len() - suffix..].iter().map(|l| Change::Same(l)));
    Some(out)
}

/// Il confronto fra i byte di una versione e quelli attuali, come albero.
///
/// Resta testo e badge, mai HTML: le righe arrivano da un file dell'utente.
/// Le righe uguali lontane da un cambiamento si riassumono in un conto, e oltre
/// [`DIFF_MAX_LINES`] righe disegnate il resto si dice con un numero.
pub(super) fn comparison(version: &[u8], current: &[u8]) -> UiNode {
    if version == current {
        return UiNode::text(Text::key(DIFF_SAME));
    }
    let (Ok(old), Ok(new)) = (std::str::from_utf8(version), std::str::from_utf8(current)) else {
        return UiNode::text(Text::key(DIFF_BINARY));
    };
    let Some(changes) = line_diff(old, new) else {
        let lines = old.lines().count().max(new.lines().count());
        return UiNode::text(Text::message(
            DIFF_TOO_LARGE,
            vec![Arg::int("lines", lines as i64)],
        ));
    };
    let added = changes
        .iter()
        .filter(|c| matches!(c, Change::Added(_)))
        .count();
    let removed = changes
        .iter()
        .filter(|c| matches!(c, Change::Removed(_)))
        .count();
    if added == 0 && removed == 0 {
        return UiNode::text(Text::key(DIFF_ENDINGS));
    }
    // Una riga uguale si mostra se sta entro il contesto di un cambiamento.
    let near: Vec<bool> = (0..changes.len())
        .map(|at| {
            let from = at.saturating_sub(DIFF_CONTEXT);
            let to = (at + DIFF_CONTEXT + 1).min(changes.len());
            changes[from..to]
                .iter()
                .any(|c| !matches!(c, Change::Same(_)))
        })
        .collect();
    let mut lines = Vec::new();
    let mut shown = 0usize;
    let mut skipped = 0usize;
    let mut hidden = 0usize;
    for (at, change) in changes.iter().enumerate() {
        if shown == DIFF_MAX_LINES {
            hidden += usize::from(near[at]);
            continue;
        }
        if !near[at] {
            skipped += 1;
            continue;
        }
        if skipped > 0 {
            lines.push(UiNode::text(Text::message(
                DIFF_SKIPPED,
                vec![Arg::int("count", skipped as i64)],
            )));
            skipped = 0;
        }
        shown += 1;
        lines.push(match change {
            Change::Same(line) => UiNode::text(format!("  {line}")),
            Change::Removed(line) => UiNode::row(
                1,
                vec![
                    UiNode::badge("−", Intent::Danger),
                    UiNode::text(line.to_string()),
                ],
            ),
            Change::Added(line) => UiNode::row(
                1,
                vec![
                    UiNode::badge("+", Intent::Primary),
                    UiNode::text(line.to_string()),
                ],
            ),
        });
    }
    if skipped > 0 && hidden == 0 {
        lines.push(UiNode::text(Text::message(
            DIFF_SKIPPED,
            vec![Arg::int("count", skipped as i64)],
        )));
    }
    if hidden > 0 {
        lines.push(UiNode::text(Text::message(
            DIFF_TRUNCATED,
            vec![Arg::int("count", hidden as i64)],
        )));
    }
    let mut children = vec![UiNode::text(Text::message(
        DIFF_SUMMARY,
        vec![
            Arg::int("added", added as i64),
            Arg::int("removed", removed as i64),
        ],
    ))];
    children.extend(lines);
    UiNode::column(0, children)
}

/// Una versione: quando e quanto è cambiata rispetto alla precedente.
///
/// La riga è leggera — l'ora e una variazione — e si sceglie col click: i gesti
/// (ripristina, confronta, copia) stanno nell'anteprima della versione scelta.
/// Con un bottone «Ripristina» per riga il pannello era una colonna di azioni
/// distruttive uguali, e il gesto più pericoloso era il più facile da fare.
/// La più recente è la versione attuale.
///
/// La nota viaggia nel payload accanto all'istante, e non perché serva a chi
/// agisce — `version.restore` la vuole, ma la si potrebbe rileggere —: serve a
/// dire **su quale nota questa riga è stata disegnata**, che è l'unico modo di
/// accorgersi che nel frattempo è cambiata. Vedi [`same_notes`].
pub(super) fn row(
    v: &VersionRef,
    current: bool,
    older: Option<&VersionRef>,
    selected: bool,
    doc: &str,
) -> UiNode {
    let when = Text::message(WHEN, vec![Arg::timestamp(WHEN, v.ts)]);
    let change = if current {
        Text::key(CURRENT)
    } else {
        match older {
            None => Text::message(FIRST_VERSION, vec![Arg::int("size", v.size as i64)]),
            Some(older) if v.size > older.size => {
                Text::message(GREW, vec![Arg::int("size", (v.size - older.size) as i64)])
            }
            Some(older) if v.size < older.size => {
                Text::message(SHRANK, vec![Arg::int("size", (older.size - v.size) as i64)])
            }
            Some(_) => Text::key(SAME_SIZE),
        }
    };
    let mut item = UiNode::list_item(
        when,
        Some(change),
        Some(ActionRef::with(
            A_PREVIEW,
            serde_json::json!({ DOC: doc, TS: v.ts }),
        )),
    );
    if let UiKind::ListItem { selected: at, .. } = &mut item.kind {
        *at = selected;
    }
    item.with_key(v.ts.to_string())
}
