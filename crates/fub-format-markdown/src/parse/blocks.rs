//! I pezzi della conversione dei blocchi: termini, tabelle, figli, link e
//! gli inline di un blocco.

use super::*;

/// Lo span del termine di una definition list, che nella forma stretta
/// (`Termine\n: definizione`, senza riga vuota) comrak chiude dopo il primo
/// byte: il termine va fino alla definizione che lo segue, righe vuote in coda
/// escluse. Lo stesso confine vale per i paragrafi del termine che cominciano
/// dove comincia lui, che portavano lo stesso span di un byte.
pub(super) fn term_span<'a>(
    node: &'a AstNode<'a>,
    source: &str,
    offsets: &Offsets<'_>,
    span: Span,
    blocks: &mut [Block],
) -> Span {
    let Some(next) = node.next_sibling() else {
        return span;
    };
    let until = span_of(next, offsets).start;
    let Some(between) = source.get(span.start..until) else {
        return span;
    };
    let end = span.start + between.trim_end().len();
    if end <= span.end {
        return span;
    }
    for block in blocks.iter_mut() {
        if let Block::Paragraph { span: inner, .. } = block {
            if inner.start == span.start && inner.end < end {
                inner.end = end;
            }
        }
    }
    Span::new(span.start, end)
}

pub(super) fn custom(
    kind: &str,
    attrs: serde_json::Value,
    blocks: Vec<Block>,
    span: Span,
) -> Block {
    Block::Custom {
        custom_kind: kind.to_string(),
        attrs,
        blocks,
        anchor: None,
        span,
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn convert_table<'a>(
    node: &'a AstNode<'a>,
    alignments: &[TableAlignment],
    source: &str,
    offsets: &Offsets<'_>,
    ctx: &ParseContext,
    acc: &mut Acc,
    span: Span,
    depth: u32,
) -> Block {
    let align = alignments
        .iter()
        .map(|a| match a {
            TableAlignment::Left => ColumnAlign::Left,
            TableAlignment::Center => ColumnAlign::Center,
            TableAlignment::Right => ColumnAlign::Right,
            TableAlignment::None => ColumnAlign::None,
        })
        .collect();
    let mut head = None;
    let mut rows = Vec::new();
    // Scorre attraverso **tutte** le celle della tabella, non si azzera a ogni
    // riga: due celle non possono rivendicare gli stessi byte nemmeno se stanno
    // su righe diverse, e i due casi in cui comrak lo fa nascono proprio dove una
    // riga finisce — una riga di prosa che continua la tabella (in GFM una
    // tabella si chiude su una riga vuota o su un altro blocco, non su una riga
    // di testo) e un `\r` nudo che spezza una riga in due. Vedi
    // [`ritagliato_dopo`].
    let mut end = span.start;
    for r in node.children() {
        let is_header = matches!(r.data.borrow().value, NodeValue::TableRow(true));
        let mut cells = Vec::new();
        for c in r.children() {
            let mut text = String::new();
            let inlines = block_inlines(c, source, offsets, ctx, acc, None, &mut text, depth);
            acc.text.push_str(text.trim());
            acc.text.push(' ');
            let cell = clipped_after_sibling(span_of(c, offsets), span, end);
            end = cell.end;
            cells.push(TableCell {
                inlines,
                span: cell,
            });
        }
        let row = TableRow { cells };
        acc.text.push('\n');
        if is_header && head.is_none() {
            head = Some(row);
        } else {
            rows.push(row);
        }
    }
    Block::Table {
        head,
        rows,
        align,
        anchor: None,
        span,
    }
}

pub(super) fn convert_block_children<'a>(
    node: &'a AstNode<'a>,
    source: &str,
    offsets: &Offsets<'_>,
    ctx: &ParseContext,
    acc: &mut Acc,
    depth: u32,
) -> Vec<Block> {
    node.children()
        .filter_map(|c| convert_block(c, source, offsets, ctx, acc, depth))
        .collect()
}

/// Emette un link **e** lo registra nella tabella piatta: sono due gesti che
/// non devono poter divergere (l'immagine divergeva).
///
/// `nel_testo` è la posizione del link nel testo del blocco che lo contiene
/// (`[inizio, fine)` in byte, sul testo non ancora trimmato): è ciò che la
/// regola del contesto (`rules::snippet::window`) usa per ritagliare la
/// finestra attorno al link. Nasce qui perché è l'unico punto in cui la
/// lunghezza dell'etichetta è nota.
pub(super) fn push_link(
    acc: &mut Acc,
    out: &mut Vec<Inline>,
    target: LinkTarget,
    label: Option<Vec<Inline>>,
    embed: bool,
    span: Span,
    in_text: Range<usize>,
) {
    acc.links.push((
        Link {
            target: target.clone(),
            embed,
            span,
            context: None,
        },
        in_text,
    ));
    out.push(Inline::Link {
        target,
        label,
        embed,
        span,
    });
}

/// Gli inline di un **blocco**: il marcatore d'ancora tolto, e il **contesto**
/// assegnato ai link che ci stanno dentro.
///
/// È l'ingresso che ogni ramo di [`convert_block`] usa; [`convert_inlines`] —
/// quella che ricorre dentro un `Emph`, uno `Strong`, l'etichetta di un link —
/// non assegna niente, perché il contesto di un link è una **finestra** del
/// testo del blocco che lo contiene (la regola sta in `rules::snippet`), e
/// dentro un `Emph` non si sa quale sia.
///
/// La regola stava scritta dentro il ramo `Paragraph`, e valeva solo lì: un
/// link in un'intestazione o in una cella di tabella nasceva con `context:
/// None`, e il pannello dei backlink lo mostrava senza la riga che lo spiega.
/// Copiarla nei due rami mancanti sarebbe stata la risposta sbagliata due
/// volte: chi *vede* il sintomo non è chi lo produce, e una regola che vale per
/// tutti i chiamanti si scrive nel posto che tutti attraversano.
///
/// I link già scoperti da un blocco **più interno** non si sovrascrivono: il
/// contesto è quello del blocco più vicino che porti del testo, che è ciò che
/// faceva già un paragrafo dentro una citazione.
#[allow(clippy::too_many_arguments)]
pub(super) fn block_inlines<'a>(
    node: &'a AstNode<'a>,
    source: &str,
    offsets: &Offsets<'_>,
    ctx: &ParseContext,
    acc: &mut Acc,
    anchor: Option<&FoundAnchor>,
    text: &mut String,
    depth: u32,
) -> Vec<Inline> {
    let link_base = acc.links.len();
    let mut inlines = convert_inlines(node, source, offsets, ctx, acc, text, depth);
    if let Some(a) = anchor {
        strip_marker(&mut inlines, text, &a.written);
    }
    // Il contesto di un link è una **finestra** del testo del blocco che lo
    // contiene: la regola sta in `rules::snippet`, che ritaglia attorno al
    // link e aggiunge l'ellissi dove taglia. La finestra si calcola sul testo
    // **non trimmato** — le posizioni dei link sono state registrate durante
    // la costruzione, e un trim in testa le sposterebbe — e il trim lo fa la
    // regola, sulla finestra.
    //
    // Un contesto vuoto non è un contesto: `Some("")` occuperebbe il campo e
    // impedirebbe a chiunque altro di riempirlo, dicendo niente.
    for (link, in_text) in &mut acc.links[link_base..] {
        if link.context.is_none() {
            let c = snippet::window(text, in_text.clone());
            if !c.is_empty() {
                link.context = Some(c);
            }
        }
    }
    inlines
}

/// L'etichetta che comrak ha **sintetizzato dal bersaglio**, se è quella.
///
/// Un wikilink senza alias in comrak non è un nodo senza figli: è un nodo con
/// **un** figlio testo che ripete il bersaglio parola per parola. Non c'è un
/// campo che dica «questa l'ho messa io», e quindi la si riconosce dalla forma:
/// un figlio solo, di testo, uguale all'url del nodo. `None` per tutto il
/// resto, cioè per ogni etichetta che l'autore abbia scritto.
///
/// **La zona cieca che era dichiarata qui, e perché non c'è più**:
/// `[[Nota|Nota]]` — un alias battuto identico al bersaglio — risponde `Some`,
/// perché *dal nodo* i due casi sono indistinguibili, e la riga che stava qui
/// concludeva che distinguerli sarebbe costato una seconda grammatica del `|`
/// accanto a quella di comrak. La differenza osservabile però non era solo il
/// `#` di un alias: era **la riscrittura**, che toglieva dal file un `|Nota` che
/// l'utente aveva battuto a mano. E la seconda grammatica non serviva, perché
/// c'era già: [`scan::parse_wikilink_inner`] legge quel `|` per ricavare il
/// bersaglio e restituisce il campo `alias`, che il chiamante buttava. La
/// risposta di questa funzione resta quella che è — «il nodo da solo non lo sa»
/// — e chi la chiama la incrocia con l'alias del contratto.
/// L'autore ha scritto un `|` dentro queste due parentesi?
///
/// La domanda si fa **alla sorgente** perché il nodo di comrak non la sa
/// rispondere: `wl.url` porta il solo bersaglio, e l'etichetta è un figlio di
/// testo identico sia quando l'ha scritta l'autore sia quando l'ha sintetizzata
/// il parser. A leggere l'interno è [`scan::parse_wikilink_inner`], la stessa
/// funzione che ha già ricavato il bersaglio: qui la si applica ai byte giusti
/// invece che a un url in cui l'alias non c'è più.
pub(super) fn written_alias(source: &str, span: Span) -> bool {
    let Some(slice) = source.get(span.start..span.end) else {
        return false;
    };
    let Some(inner) = slice
        .trim_start_matches('!')
        .strip_prefix("[[")
        .and_then(|s| s.strip_suffix("]]"))
    else {
        return false;
    };
    scan::parse_wikilink_inner(inner).alias.is_some()
}

pub(super) fn synthetic_label<'a>(node: &'a AstNode<'a>, url: &str) -> Option<String> {
    let mut children = node.children();
    let only = children.next()?;
    if children.next().is_some() {
        return None;
    }
    let value = &only.data.borrow().value;
    let NodeValue::Text(text) = value else {
        return None;
    };
    (text == url).then(|| text.to_string())
}
