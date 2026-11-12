//! La conversione degli inline: testo, link, embed, tag e note.

use super::*;

pub(super) fn convert_inlines<'a>(
    node: &'a AstNode<'a>,
    source: &str,
    offsets: &Offsets<'_>,
    ctx: &ParseContext,
    acc: &mut Acc,
    text_out: &mut String,
    depth: u32,
) -> Vec<Inline> {
    if depth > MAX_DEPTH {
        acc.depth_error = true;
        return Vec::new();
    }
    let down = depth.saturating_add(1);
    let mut out = Vec::new();
    // Una nota in linea con dentro della formattazione (`^[**ricca**]`) per
    // comrak è testo, un nodo, testo: la si riconosce sul testo che la apre e
    // si chiude sul testo che contiene la `]`. I nodi in mezzo si convertono
    // come sempre, perché testo piatto, link e tag restino quelli di prima,
    // e i loro inline si tolgono: li rappresenta la nota.
    let node_end = span_of(node, offsets).end;
    let mut inside_note: Option<usize> = None;
    let mut swallowed: Option<usize> = None;
    for child in node.children() {
        if let Some(mark) = swallowed.take() {
            out.truncate(mark);
        }
        let span = span_of(child, offsets);
        if inside_note.is_some_and(|close| span.start >= close) {
            inside_note = None;
        }
        if inside_note.is_some_and(|close| span.end <= close) {
            swallowed = Some(out.len());
        }
        let value = child.data.borrow().value.clone();
        match value {
            NodeValue::Text(s) => {
                let text_base = text_out.len();
                text_out.push_str(&s);
                if let Some(slice) = source.get(span.start..span.end) {
                    if let Some(close) =
                        inside_note.filter(|close| span.start < *close && *close < span.end)
                    {
                        inside_note = None;
                        let cut = close - span.start;
                        let head = decode_segment(source, &slice[..cut], span.start);
                        let mut inside = Vec::new();
                        let head_slice = &slice[..cut];
                        let projected = push_text_features(
                            source,
                            head_slice,
                            &head,
                            span.start,
                            text_base,
                            ctx,
                            acc,
                            &mut inside,
                        );
                        let head_len = project(text_out, text_base, head.len(), projected);
                        let tail = &slice[cut..];
                        let decoded = decode_segment(source, tail, close);
                        let projected = push_text_features(
                            source,
                            tail,
                            &decoded,
                            close,
                            text_base + head_len,
                            ctx,
                            acc,
                            &mut out,
                        );
                        project(text_out, text_base + head_len, decoded.len(), projected);
                        continue;
                    }
                    if ctx.enabled(syntax::FOOTNOTES) {
                        if let Some((open, close)) =
                            rich_inline_note(child, source, offsets, slice, span, node_end)
                        {
                            let head_slice = &slice[..open];
                            let head = decode_segment(source, head_slice, span.start);
                            let projected = push_text_features(
                                source, head_slice, &head, span.start, text_base, ctx, acc,
                                &mut out,
                            );
                            let head_len = project(text_out, text_base, head.len(), projected);
                            let rest = &slice[open..];
                            let decoded = decode_segment(source, rest, span.start + open);
                            let mut inside = Vec::new();
                            let projected = push_text_features(
                                source,
                                rest,
                                &decoded,
                                span.start + open,
                                text_base + head_len,
                                ctx,
                                acc,
                                &mut inside,
                            );
                            project(text_out, text_base + head_len, decoded.len(), projected);
                            let start = span.start + open;
                            let body = &source[start + 2..close - 1];
                            out.push(Inline::Custom {
                                custom_kind: custom_kind::FOOTNOTE_REFERENCE.to_string(),
                                attrs: serde_json::json!({
                                    "label": body,
                                    "source": body,
                                    "inline": true,
                                }),
                                span: Span::new(start, close),
                            });
                            inside_note = Some(close);
                            continue;
                        }
                    }
                }
                // Tag ed embed si scandiscono sulla FETTA DI SORGENTE del
                // nodo, non sul testo decodificato: comrak scioglie escape ed
                // entità (`\#` → `#`, `&amp;` → `&`) ma la base dello span è
                // il `sourcepos` nel sorgente — su `pre \# poi #tag` lo span
                // del tag punterebbe una fetta spostata di un byte per ogni
                // carattere decodificato prima di lui. Sul sorgente, inoltre,
                // gli escape sono ancora visibili: `\#nontag` non diventa un
                // tag (Obsidian lo neutralizza).
                //
                // Se la fetta non è quella del sorgente (`sourcepos` fuori
                // confine) il testo di comrak è **già** decodificato: si
                // emette tale e quale, perché il decoder lineare applicato al
                // già decodificato raddoppierebbe le entità (`&amp;lt;` →
                // `&lt;` → `<`), e gli span delle feature vivono nel sorgente
                // che qui non c'è.
                let Some(slice) = source.get(span.start..span.end) else {
                    if !s.is_empty() {
                        out.push(Inline::Text(s.into()));
                    }
                    continue;
                };
                let projected = push_text_features(
                    source, slice, &s, span.start, text_base, ctx, acc, &mut out,
                );
                project(text_out, text_base, s.len(), projected);
            }
            NodeValue::SoftBreak => {
                // Un a-capo morbido: la riga continua, e nella resa è uno
                // spazio. Nel testo piatto è uno spazio come prima.
                text_out.push(' ');
                out.push(Inline::SoftBreak);
            }
            NodeValue::LineBreak => {
                // Un a-capo duro (`  ` o `\` a fine riga): nella resa cambia
                // riga. È un nodo a sé — prima produceva lo stesso `Text(" ")`
                // del soft break, e il salto spariva alla prima riscrittura
                // (due righe tornavano una). Nel testo piatto resta uno spazio,
                // che è come si legge.
                text_out.push(' ');
                out.push(Inline::HardBreak);
            }
            NodeValue::Emph => {
                out.push(Inline::Emph(convert_inlines(
                    child, source, offsets, ctx, acc, text_out, down,
                )));
            }
            NodeValue::Strong => {
                out.push(Inline::Strong(convert_inlines(
                    child, source, offsets, ctx, acc, text_out, down,
                )));
            }
            // L'apice (`^…^`) e il barrato (`~~…~~`) sono costrutti del
            // dialetto con un nodo comrak loro: prima finivano nel catch-all e
            // ne restava solo il testo — il costrutto spariva dal modello, e
            // alla prima riscrittura anche dal file. Adesso hanno una variante
            // loro, distinta l'una dall'altra e dall'enfasi.
            NodeValue::Superscript => {
                out.push(Inline::Superscript(convert_inlines(
                    child, source, offsets, ctx, acc, text_out, down,
                )));
            }
            NodeValue::Subscript => {
                out.push(Inline::Subscript(convert_inlines(
                    child, source, offsets, ctx, acc, text_out, down,
                )));
            }
            NodeValue::Strikethrough => {
                out.push(Inline::Strikethrough(convert_inlines(
                    child, source, offsets, ctx, acc, text_out, down,
                )));
            }
            NodeValue::Code(code) => {
                text_out.push_str(&code.literal);
                out.push(Inline::Code(code.literal));
            }
            // La formula porta il sorgente TeX come comrak l'ha letto, senza i
            // dollari: è la forma che `custom_kind::MATH` registra, la stessa del
            // recinto `math`. Nel testo cercabile entra come il codice inline.
            NodeValue::Math(math) => {
                text_out.push_str(&math.literal);
                out.push(Inline::Custom {
                    custom_kind: custom_kind::MATH.to_string(),
                    attrs: serde_json::json!({
                        "source": math.literal,
                        "display": math.display_math,
                    }),
                    span,
                });
            }
            NodeValue::Link(link) => {
                let mut label_text = String::new();
                let label =
                    convert_inlines(child, source, offsets, ctx, acc, &mut label_text, down);
                let start = text_out.len();
                text_out.push_str(&label_text);
                push_link(
                    acc,
                    &mut out,
                    LinkTarget::classify(&link.url),
                    Some(label),
                    false,
                    span,
                    start..text_out.len(),
                );
            }
            NodeValue::WikiLink(wl) => {
                let (embed, span) = embed_before(source, span);
                let parsed = scan::parse_wikilink_inner(&wl.url);
                // **L'etichetta che nessuno ha scritto non è prosa.** Senza
                // alias comrak sintetizza l'etichetta dal bersaglio, e
                // scandirla come si scandisce una frase faceva nascere dei tag
                // dal nome della nota: `[[#Sezione]]` — un link a un heading di
                // questa stessa nota — dichiarava un tag `Sezione` che
                // nell'indice stava accanto a quelli veri, con lo span
                // **dentro** quello del link, cioè sugli stessi byte che una
                // rinomina della nota riscrive.
                //
                // Il `#` di un bersaglio non è il `#` di un tag: introduce un
                // heading, e a dirlo è già `parse_wikilink_inner`, che di
                // quello stesso `#` fa il campo `heading`. Il difetto era che
                // gli stessi byte venivano letti due volte da due regole
                // diverse.
                //
                // **Un alias resta prosa**: `[[Nota|alias con #tag]]` è testo
                // che l'autore ha scritto, e il suo `#tag` è un tag suo. È la
                // metà da non rovesciare, ed è la ragione per cui la
                // distinzione sta qui e non in `push_text_features`.
                //
                // **E un'etichetta che nessuno ha scritto non è un'etichetta**:
                // `label` è un `Option` da sempre, e riempirlo col testo che
                // comrak sintetizza dal bersaglio rendeva `[[Nota]]` e
                // `[[Nota|Nota]]` lo stesso modello — quindi la riscrittura
                // toglieva il `|Nota` che l'utente aveva battuto a mano. Chi
                // legge l'etichetta per mostrarla ha il bersaglio accanto e ci
                // ricade da sé ([`LinkTarget::wiki_inner`]); chi la legge per
                // riscriverla non aveva nient'altro con cui distinguere i due
                // casi.
                //
                // A dire se l'alias c'era è `parse_wikilink_inner`, cioè **la
                // stessa regola** che ha appena letto il bersaglio: non è una
                // seconda grammatica del `|` accanto a quella di comrak — che
                // era il costo per cui la distinzione era stata dichiarata
                // troppo cara — è il campo `alias` che quella funzione
                // restituiva già e che qui si buttava.
                //
                // Il terzo caso è quello che tiene ferma la promessa già
                // presidiata da `a_reference_is_rewrites_com_was`: quando la
                // forma scritta dal bersaglio **non è quella canonica**
                // (`[[Nota^blocco]]`, che il nostro lettore accetta per
                // indulgenza), l'etichetta sintetica dice qualcosa che il
                // bersaglio canonico non direbbe più — «Nota^blocco» contro
                // «Nota#^blocco» — e allora è contenuto da conservare, non da
                // ricalcolare. Riparare dove un riferimento *punta* non è titolo
                // per cambiare ciò che si *legge*.
                let synthetic = synthetic_label(child, &wl.url);
                let hand_written = written_alias(source, span)
                    || synthetic.as_deref() != parsed.target.wiki_inner().as_deref();
                let (label, in_text) = if hand_written {
                    let mut label_text = String::new();
                    let the =
                        convert_inlines(child, source, offsets, ctx, acc, &mut label_text, down);
                    let start = text_out.len();
                    text_out.push_str(&label_text);
                    (Some(the), start..text_out.len())
                } else {
                    // Il testo mostrato entra nel testo del blocco lo stesso —
                    // è ciò che si legge a schermo, e la finestra di contesto di
                    // un backlink si centra lì — ma senza passare per la
                    // scansione dei tag, che è il difetto qui sopra.
                    let start = text_out.len();
                    text_out.push_str(&wl.url);
                    (None, start..text_out.len())
                };
                push_link(acc, &mut out, parsed.target, label, embed, span, in_text);
            }
            NodeValue::Image(img) => {
                let mut label_text = String::new();
                let label =
                    convert_inlines(child, source, offsets, ctx, acc, &mut label_text, down);
                // Un'immagine È un riferimento incorporato, e finché non entrava
                // in `links` nessun riferimento ad allegato veniva aggiornato al
                // rename, né risultava fra gli orfani (13.1): non perché il path
                // non fosse un arco, ma perché quell'arco non veniva raccolto.
                // L'`alt` entra nel testo del blocco come l'etichetta di un
                // link: è testo che l'autore ha scritto, e chi cerca la
                // didascalia la trova. La posizione del link nel testo è la sua.
                let start = text_out.len();
                text_out.push_str(&label_text);
                push_link(
                    acc,
                    &mut out,
                    LinkTarget::classify(&img.url),
                    Some(label),
                    true,
                    span,
                    start..text_out.len(),
                );
            }
            NodeValue::HtmlInline(literal) => {
                // **Il gemello inline di `NodeValue::HtmlBlock`**, e prima non
                // c'era: senza un ramo suo un `<b>`, un `<br>` o un `<kbd>`
                // finiva nel catch-all, che ricorre sui figli — e un
                // `HtmlInline` di figli non ne ha, perché il markup lo porta
                // tutto nel proprio `literal`. Non degradava: **spariva**, e
                // spariva prima di ogni altro lato, cioè dal modello. La resa
                // era la metà che si vedeva meno; quella che costava era la
                // **riscrittura**, perché `serialize` scrive ciò che il modello
                // ha: `un <b>grassetto</b> inline` tornava sul disco come `un
                // grassetto inline`, e i tag dell'utente erano cancellati dal
                // suo file.
                //
                // Che i byte restino **dato** e non tornino markup è la stessa
                // scelta del blocco, presa nello stesso posto: `custom_kind::
                // HTML` è `Carico::Sorgente("html")`, quindi `serialize` li
                // ricopia identici e `render` li mostra escapati. Cosa sia
                // lecito eseguire lo decide la sanitizzazione (5.3), non il
                // provider che ha letto il file.
                //
                // In `text_out` **non ci vanno**, e qui il blocco non fa da
                // esempio: un `HtmlBlock` è tutto il contenuto del proprio
                // blocco, e se non entrasse nel testo indicizzato quel blocco
                // non sarebbe cercabile affatto; un `<b>` sta in mezzo a una
                // frase che il suo testo ce l'ha già nei nodi accanto, e
                // metterci dentro il markup significherebbe scrivere `un <b>
                // grassetto </b> inline` nel contesto di un backlink e nel
                // testo su cui si cerca.
                out.push(Inline::Custom {
                    custom_kind: custom_kind::HTML.to_string(),
                    attrs: serde_json::json!({ "html": literal }),
                    span,
                });
            }
            NodeValue::FootnoteReference(f) => {
                out.push(Inline::Custom {
                    custom_kind: custom_kind::FOOTNOTE_REFERENCE.to_string(),
                    attrs: serde_json::json!({ "label": f.name }),
                    span,
                });
            }
            _ => {
                // Sotto-inline sconosciuti: recupera almeno il testo.
                let nested = convert_inlines(child, source, offsets, ctx, acc, text_out, down);
                out.extend(nested);
            }
        }
    }
    if let Some(mark) = swallowed {
        out.truncate(mark);
    }
    out
}

/// Una nota in linea `^[…]` che comincia in questo testo e si chiude più
/// avanti nello stesso blocco, su un testo fratello: `(apertura nella fetta,
/// fine assoluta)`. Una nota che si chiude nella fetta stessa la legge
/// [`push_plain_or_tags`]; una `]` che cade dentro un altro costrutto (un
/// grassetto aperto nella nota e chiuso dopo) non chiude niente.
fn rich_inline_note<'a>(
    child: &'a AstNode<'a>,
    source: &str,
    offsets: &Offsets<'_>,
    slice: &str,
    span: Span,
    node_end: usize,
) -> Option<(usize, usize)> {
    let bytes = slice.as_bytes();
    let mut at = 0;
    while at + 1 < bytes.len() {
        if bytes[at] == b'^' && bytes[at + 1] == b'[' && !is_escaped(source, span.start + at) {
            let from = span.start + at + 2;
            if let Some(end) = footnote_close(source, from, span.end) {
                at = end - span.start;
                continue;
            }
            let close = footnote_close(source, from, node_end)?;
            let closing = child
                .following_siblings()
                .map(|sibling| (sibling, span_of(sibling, offsets)))
                .find(|(_, sibling)| sibling.start < close && close <= sibling.end)?;
            let is_text = matches!(closing.0.data.borrow().value, NodeValue::Text(_));
            return (is_text && close > from + 1).then_some((at, close));
        }
        at += 1;
    }
    None
}

/// Divide un frammento di testo in `Text`/`TagRef`, registrando i tag in `acc`.
/// Elabora un frammento estraendo, nell'ordine, gli embed `![[...]]` (che
/// comrak non riconosce) e poi i `#tag` dai segmenti restanti.
///
/// `slice` è la fetta di **sorgente** del nodo, `base` il suo offset in byte:
/// la scansione avviene lì, perché gli `Span` prodotti sono offset nel
/// sorgente e lì gli escape sono ancora visibili. Il testo emesso è quello che
/// comrak avrebbe consegnato — escape ed entità sciolti, così la resa mostra
/// `#` e `&`, non `\#` e `&amp;` — e lo produce [`decodifica_segmento`]
/// **dalla sorgente**, segmento per segmento: nessun allineamento fra i due
/// testi, e un'entità resta sciolta in ogni ramo, non ri-codificata dal
/// render.
// Otto argomenti, e il limite di clippy è sette. Raggrupparli in una struct
// darebbe un tipo a cinque valori che non escono da qui — il chiamante è
// **uno**, `convert_inline` poco sopra — e la scusa dichiarata è la stessa
// che `convert_table` porta qualche riga più su: i cinque `&str`/`usize`
// sono la fetta e i suoi offset, cioè un argomento solo spezzato in ciò che
// il chiamante ha già in mano.
#[allow(clippy::too_many_arguments)]
fn push_text_features(
    source: &str,
    slice: &str,
    decoded: &str,
    base: usize,
    text_base: usize,
    ctx: &ParseContext,
    acc: &mut Acc,
    out: &mut Vec<Inline>,
) -> Option<String> {
    let embeds = if ctx.enabled(syntax::WIKILINKS) {
        find_embeds(slice)
    } else {
        Vec::new()
    };
    if embeds.is_empty() {
        // `sourcepos` di comrak può troncare la fetta: una tabulazione nel
        // testo, per esempio, sposta le colonne che conta, e la fetta di `T`,
        // tab, `termine` finisce due byte prima. Senza feature da localizzare,
        // il testo del parser è l'unica proiezione completa e ha già sciolto
        // escape ed entità correttamente.
        let full_slice = slice == decoded || decode_segment(source, slice, base) == decoded;
        if full_slice {
            push_plain_or_tags(source, slice, base, ctx, acc, out);
        } else if !decoded.is_empty() {
            out.push(Inline::Text(decoded.to_string()));
        }
        return None;
    }
    let mut cursor = 0;
    let mut in_text = text_base;
    // Il testo del blocco porta di un embed ciò che si legge, non la sintassi:
    // l'alias o il bersaglio, come per un `[[…]]`. Prima ci restava `![[`.
    let mut projected = String::new();
    for (parentheses, inner) in embeds {
        // Il `!` lo aggiunge allo span [`embed_before`], che è la stessa
        // funzione da cui passa il ramo comrak: qui `find_embeds` consegna le
        // sole parentesi, e chi decide dove comincia un embed è uno solo.
        let (embed, abs) = embed_before(
            source,
            Span::new(base + parentheses.start, base + parentheses.end),
        );
        let start = abs.start - base;
        if start > cursor {
            let seg = &slice[cursor..start];
            projected.push_str(&decode_segment(source, seg, base + cursor));
            in_text += push_plain_or_tags(source, seg, base + cursor, ctx, acc, out);
        }
        let parsed = scan::parse_wikilink_inner(&inner);
        // L'embed testuale sta DENTRO il testo pushato (comrak non l'ha
        // riconosciuto, quindi i suoi byte sono testo). La sua posizione vive
        // nel testo del blocco, non nella fetta di sorgente: somma la base del
        // nodo e le lunghezze già decodificate, perché markup precedente,
        // escape ed entità rendono i due sistemi di coordinate diversi.
        // L'alias di un embed è dell'autore quanto quello di un link, e finché
        // questa strada passava `None` senza guardarlo un `![[Nota|Alias]]`
        // rientrava dal giro come `![[Nota]]`.
        let shown = parsed
            .alias
            .clone()
            .unwrap_or_else(|| inner.split('|').next().unwrap_or_default().to_string());
        let label = parsed.alias.map(|a| vec![Inline::Text(a)]);
        push_link(
            acc,
            out,
            parsed.target,
            label,
            embed,
            abs,
            in_text..in_text + shown.len(),
        );
        in_text += shown.len();
        projected.push_str(&shown);
        cursor = abs.end - base;
    }
    if cursor < slice.len() {
        let seg = &slice[cursor..];
        projected.push_str(&decode_segment(source, seg, base + cursor));
        push_plain_or_tags(source, seg, base + cursor, ctx, acc, out);
    }
    Some(projected)
}

/// Mette nel testo del blocco, al posto del segmento decodificato lungo `len`
/// che comincia in `at`, la sua proiezione, se ne ha una. Torna la lunghezza
/// che il segmento ha adesso.
fn project(text_out: &mut String, at: usize, len: usize, projected: Option<String>) -> usize {
    match projected {
        Some(text) if text_out.get(at..at + len).is_some() => {
            text_out.replace_range(at..at + len, &text);
            text.len()
        }
        _ => len,
    }
}

/// Il `!` che precede un `[[…]]` lo rende un **embed**, e allora lo span
/// comincia da lì.
///
/// Il `!` è parte del riferimento, non del testo che lo precede: chi cancella o
/// riscrive un embed guidato dal suo span deve portarsi via anche quello, o
/// resta un punto esclamativo orfano. Sotto escape (`\![[…]]`) è un punto
/// esclamativo letterale: niente embed, e lo span resta quello delle parentesi.
///
/// **Sta in una funzione sola perché le strade che leggono un `[[…]]` sono
/// due**: il nodo `WikiLink` di comrak e il ripiego testuale di [`find_embeds`]
/// — che esiste perché comrak un `![[` non lo riconosce affatto. Le due
/// rispondevano in modi diversi sullo stesso `!`: la seconda lo teneva dentro
/// lo span, la prima lo guardava per decidere `embed` e poi lo lasciava fuori.
/// Oggi la prima un `!` non escapato non lo vede mai — è per questo che il
/// disaccordo non si vede da nessuna parte — ed è esattamente la forma in cui
/// una divergenza aspetta l'aggiornamento di una dipendenza per diventare vera.
/// A confrontare le due strade adesso c'è
/// `tests/il_corpus.rs::un_embed_comincia_dal_suo_punto_esclamativo`, e il
/// contorno che ne dipende è dichiarato nel corpus della shell
/// (`apps/client/src/editor/corpus.test.ts`: «lo span del modello comprende il `!`
/// dell'embed»).
fn embed_before(source: &str, parentheses: Span) -> (bool, Span) {
    if parentheses.start > 0
        && source.as_bytes()[parentheses.start - 1] == b'!'
        && !is_escaped(source, parentheses.start - 1)
    {
        (true, Span::new(parentheses.start - 1, parentheses.end))
    } else {
        (false, parentheses)
    }
}

/// Trova gli embed `![[...]]`, restituendo (span **delle sole parentesi** nel
/// frammento, contenuto interno). Il `!` lo aggiunge [`embed_before`], che è
/// dove quella decisione sta per tutt'e due le strade.
///
/// Il frammento è sorgente: un `!` sotto escape (`\![[...]]`) non apre un
/// embed.
fn find_embeds(text: &str) -> Vec<(Span, String)> {
    let mut res = Vec::new();
    let mut the = 0;
    while the < text.len() {
        if !text.is_char_boundary(the) {
            the += 1;
            continue;
        }
        if text[the..].starts_with("![[") && !is_escaped(text, the) {
            let rest = &text[the + 3..];
            if let Some(rel) = rest.find("]]") {
                let line_end = rest
                    .find('\n')
                    .into_iter()
                    .chain(rest.find('\r'))
                    .min()
                    .unwrap_or(rest.len());
                if rel < line_end {
                    let inner = rest[..rel].to_string();
                    let end = the + 3 + rel + 2;
                    res.push((Span::new(the + 1, end), inner));
                    the = end;
                    continue;
                }
            }
        }
        the += 1;
    }
    res
}

/// Il carattere a `idx` è sotto escape? Conta i backslash contigui che lo
/// precedono: una sequenza dispari escapa (`\#`), una pari no (`\\#`: il primo
/// `\` escapa il secondo, il `#` è libero).
pub(super) fn is_escaped(text: &str, idx: usize) -> bool {
    text[..idx]
        .bytes()
        .rev()
        .take_while(|b| *b == b'\\')
        .count()
        % 2
        == 1
}

/// Il `#` a `idx` è il cuore di un riferimento a carattere numerico (`&#65;`,
/// `&#x27;`)? Nel testo decodificato quel `#` non esiste: un tag estratto da
/// lì sarebbe un'invenzione (la forma esadecimale ha un nome di tag valido,
/// es. `x27`).
fn is_entity_hash(text: &str, idx: usize) -> bool {
    if !text[..idx].ends_with('&') {
        return false;
    }
    let rest = &text[idx + 1..];
    let (digits, is_hex) = match rest.strip_prefix(['x', 'X']) {
        Some(hex) => (hex, true),
        None => (rest, false),
    };
    match digits.find(';') {
        Some(n) if n > 0 => digits[..n].chars().all(|c| {
            if is_hex {
                c.is_ascii_hexdigit()
            } else {
                c.is_ascii_digit()
            }
        }),
        _ => false,
    }
}

/// Segmento senza embed: estrae i `#tag` (se abilitati) o emette testo piatto.
///
/// `slice`/`base` come in [`push_text_features`]. Il testo fra i tag è
/// **decodificato** — non il sorgente — e lo produce [`decodifica_segmento`]
/// sulla fetta di sorgente: così un'entità non viene ri-codificata dal render,
/// e il ramo con i tag fa lo stesso del ramo senza.
fn push_plain_or_tags(
    source: &str,
    slice: &str,
    base: usize,
    ctx: &ParseContext,
    acc: &mut Acc,
    out: &mut Vec<Inline>,
) -> usize {
    // Inline Obsidian footnotes are text to comrak. Interpret only a complete
    // parser text slice, never code/HTML/link nodes, and retain the source span.
    //
    // Lo stesso vale per un richiamo `[^etichetta]` senza definizione: comrak
    // lo lascia testo, e la resa lo mostra com'è scritto. Nel modello resta un
    // richiamo, marcato `unresolved`, perché chi elenca le note del documento
    // (la vista delle note a piè di pagina) deve poter dire «questo richiamo
    // non porta a niente» senza rileggere la sorgente con una grammatica sua.
    if !ctx.enabled(syntax::FOOTNOTES) {
        return push_tags(source, slice, base, ctx, acc, out);
    }
    // Un giro solo, non una ricorsione per richiamo: ventimila richiami in un
    // paragrafo erano ventimila frame, e lo stack non li reggeva.
    let bytes = slice.as_bytes();
    let closes = footnote_closes(source, slice, base);
    let mut written = 0;
    let mut cursor = 0;
    let mut at = 0;
    while at + 2 < bytes.len() {
        let inline = bytes[at] == b'^' && bytes[at + 1] == b'[';
        let dangling = bytes[at] == b'[' && bytes[at + 1] == b'^';
        if (inline || dangling) && !is_escaped(source, base + at) {
            let opener = if inline { at + 1 } else { at };
            if let Some(&end) = closes.get(&opener) {
                let body = &slice[at + 2..end - 1];
                let fits = end > at + 3 && (inline || !body.contains(['[', ']']));
                if fits {
                    written += push_tags(source, &slice[cursor..at], base + cursor, ctx, acc, out);
                    let attrs = if inline {
                        serde_json::json!({
                            "label": decode_segment(source, body, base + at + 2),
                            "source": body,
                            "inline": true,
                        })
                    } else {
                        serde_json::json!({ "label": body, "unresolved": true })
                    };
                    out.push(Inline::Custom {
                        custom_kind: custom_kind::FOOTNOTE_REFERENCE.to_string(),
                        attrs,
                        span: Span::new(base + at, base + end),
                    });
                    written += decode_segment(source, &slice[at..end], base + at).len();
                    cursor = end;
                    at = end;
                    continue;
                }
            }
        }
        at += 1;
    }
    written + push_tags(source, &slice[cursor..], base + cursor, ctx, acc, out)
}

/// Per ogni `[` della fetta che apre un richiamo (`[^` o `^[`), il byte dopo
/// la `]` che la chiude sulla stessa riga: la stessa risposta di
/// [`footnote_close`], per tutti i richiami in un giro. Chiamata richiamo per
/// richiamo, una riga lunga di `[^` senza chiusura costava il quadrato della
/// riga.
fn footnote_closes(source: &str, slice: &str, base: usize) -> HashMap<usize, usize> {
    let bytes = slice.as_bytes();
    let mut closes = HashMap::new();
    if !bytes.windows(2).any(|pair| pair == b"[^" || pair == b"^[") {
        return closes;
    }
    // Le `[` aperte, ciascuna con il sì/no «apre un richiamo».
    let mut open: Vec<(usize, bool)> = Vec::new();
    let mut run = backslashes_before(source.as_bytes(), base);
    for (at, &byte) in bytes.iter().enumerate() {
        let escaped = !run.is_multiple_of(2);
        run = if byte == b'\\' { run + 1 } else { 0 };
        match byte {
            b'\r' | b'\n' => open.clear(),
            b'[' if !escaped => {
                let opens_note =
                    bytes.get(at + 1) == Some(&b'^') || (at > 0 && bytes[at - 1] == b'^');
                open.push((at, opens_note));
            }
            b']' if !escaped => {
                if let Some((opener, true)) = open.pop() {
                    closes.insert(opener, at + 1);
                }
            }
            _ => {}
        }
    }
    closes
}

/// Segmento senza richiami: estrae i `#tag` (se abilitati) o emette testo
/// piatto. Restituisce la lunghezza decodificata, come [`push_plain_or_tags`].
fn push_tags(
    source: &str,
    slice: &str,
    base: usize,
    ctx: &ParseContext,
    acc: &mut Acc,
    out: &mut Vec<Inline>,
) -> usize {
    let tags: Vec<Tag> = if ctx.enabled(syntax::TAGS) {
        scan::scan_tags(slice)
            .into_iter()
            // Sul sorgente gli pseudo-tag si riconoscono: `\#` è sotto escape,
            // `&#x27;` è un'entità — nessuno dei due è un tag per Obsidian.
            .filter(|t| {
                !under_escape(source, slice, base, t.span.start)
                    && !is_entity_hash(slice, t.span.start)
            })
            .collect()
    } else {
        Vec::new()
    };
    if tags.is_empty() {
        if !slice.is_empty() {
            let text = decode_segment(source, slice, base);
            let n = text.len();
            out.push(Inline::Text(text));
            return n;
        }
        return 0;
    }
    // I tag si misurano sul **sorgente** (gli `Span` sono offset di sorgente);
    // il testo fra l'uno e l'altro si emette **decodificato**, dallo stesso
    // decoder del ramo senza feature. Il valore restituito è la lunghezza
    // decodificata di tutto il segmento (testo + tag): è ciò che il chiamante
    // somma a `nel_testo`, e il testo di un tag (`#nome`) si decodifica in sé
    // stesso — i caratteri di un nome di tag non hanno escape né entità.
    let mut cursor = 0;
    let mut written = 0;
    for tag in tags {
        if tag.span.start > cursor {
            let text = decode_segment(source, &slice[cursor..tag.span.start], base + cursor);
            written += text.len();
            out.push(Inline::Text(text));
        }
        let abs = Span::new(base + tag.span.start, base + tag.span.end);
        out.push(Inline::TagRef {
            name: tag.name.clone(),
            span: abs,
        });
        acc.tags.push(Tag {
            name: tag.name,
            span: abs,
        });
        written += tag.span.end - tag.span.start;
        cursor = tag.span.end;
    }
    if cursor < slice.len() {
        let text = decode_segment(source, &slice[cursor..], base + cursor);
        written += text.len();
        out.push(Inline::Text(text));
    }
    written
}
