//! `note.block.move`: «Sposta in…» (E13). Un blocco, o una tratta di blocchi
//! fratelli, va in fondo a un'altra nota o in fondo alla sezione di un suo
//! titolo; al suo posto resta niente, un link o una trasclusione.
//!
//! Sono due scritture — la nota d'arrivo e quella di partenza — più quelle dei
//! link che seguono il blocco, e vanno **tutte o nessuna**: il comando le
//! consegna in un [`WritePlan`] (A-10), che controlla ogni revisione prima di
//! scrivere e disfa all'indietro se un passo cade. L'annullamento è una voce
//! sola ([`AppliedPlan::undo`]): rimette tutte le note in un passo, oppure, se
//! una è cambiata dopo, non tocca niente e lo dice.
//!
//! # Che cosa decide il comando e che cosa chi lo chiama
//!
//! Che cosa sia «un blocco» lo sa l'editor, che ha il suo modello: chi chiama
//! dice i byte (`at`, inizio e fine) e, se vuole, il testo che ci ha letto
//! (`text`). Il comando controlla che i byte stiano su confini di riga e che il
//! testo sia ancora quello: se la nota è cambiata, non si muove niente. Senza
//! `at` il blocco è quello del cursore, letto dal modello della nota (la voce
//! di elenco, se il cursore sta in un elenco): è la strada dello spazio
//! comandi.
//!
//! # I link seguono il blocco
//!
//! Un id (`^abc`) resta col blocco, e un titolo resta il titolo: i riferimenti
//! che li nominano nella nota di partenza (`[[Nota#^abc]]`, `[[#^abc]]`,
//! `[[Nota#Titolo]]`) si riscrivono verso la nota d'arrivo, nello stesso piano.
//! Si riscrive soltanto la pagina del link wiki, alias e frammento restano
//! com'erano; un link Markdown (`[testo](Nota.md#^abc)`) resta com'è e lo dice
//! la documentazione. Chi linka lo dice l'indice (i backlink della nota di
//! partenza), e che il link porti davvero lì lo dice la risoluzione del vault.

use super::*;

use fub_abi::command::{AppliedPlan, Choice, Reversal, WritePlan, WriteStep};
use fub_abi::format::LinkInsert;
use fub_abi::model::{canonical_anchor, heading_slug, Heading, LinkTarget};
use fub_abi::traits::{Page, ResolvedRef};

/// Il blocco non lascia niente al suo posto.
pub(super) const LEAVE_NONE: &str = "none";
/// Al suo posto resta un link alla nota d'arrivo (il gesto di serie, come nel
/// prototipo).
pub(super) const LEAVE_LINK: &str = "link";
/// Al suo posto resta la trasclusione del blocco, che riceve un id se non ce
/// l'ha.
pub(super) const LEAVE_EMBED: &str = "embed";

/// Le scelte di `leave`, nella spec: chi compila il modulo le vede.
pub(super) fn leave_choices() -> Vec<Choice> {
    [LEAVE_LINK, LEAVE_NONE, LEAVE_EMBED]
        .into_iter()
        .map(|value| {
            Choice::new(
                value,
                Text::key(format!("{NOTES_BLOCK_MOVE}.leave.{value}")),
            )
        })
        .collect()
}

pub(super) const E_BLOCK_NO_CARET: &str = "err.block_move.no_caret";
pub(super) const E_BLOCK_DIRTY: &str = "err.block_move.dirty";
pub(super) const E_BLOCK_NOT_FOUND: &str = "err.block_move.not_found";
pub(super) const E_BLOCK_RANGE: &str = "err.block_move.range";
pub(super) const E_BLOCK_CHANGED: &str = "err.block_move.changed";
pub(super) const E_BLOCK_HEADING: &str = "err.block_move.heading";
pub(super) const E_BLOCK_INSIDE: &str = "err.block_move.inside";
pub(super) const E_BLOCK_THERE: &str = "err.block_move.there";
pub(super) const E_BLOCK_EMBED_MANY: &str = "err.block_move.embed_many";
pub(super) const E_BLOCK_LEAVE: &str = "err.block_move.leave";
pub(super) const P_BLOCK_MOVE: &str = "plan.block_move";
pub(super) const U_BLOCK_MOVE: &str = "undo.block_move";
/// `done.block_move.<dove>.<che cosa resta>`: `end` o `under`, e `none`,
/// `link`, `embed`; `here.end` e `here.under` per uno spostamento dentro la
/// stessa nota, che non lascia niente.
const D_BLOCK_MOVE: &str = "done.block_move";
const A_HEADING: &str = "heading";

/// Quante volte si tira a sorte un id prima di arrendersi: sei caratteri in
/// base 36 sono due miliardi di nomi, e una nota ne usa qualche decina.
const ID_TRIES: usize = 16;

/// Ciò che chi invoca ha chiesto, letto e controllato.
struct Request {
    doc: DocId,
    to: DocId,
    /// Lo slug del titolo d'arrivo, se il blocco va in fondo a una sezione.
    heading: Option<String>,
    leave: Leave,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Leave {
    None,
    Link,
    Embed,
}

/// Una nota letta per il piano: la revisione su cui si calcola, il testo e il
/// modello.
struct Read {
    revision: Revision,
    source: String,
    model: DocumentModel,
}

fn read(host: &dyn HostApi, doc: &DocId) -> Result<Read, PluginError> {
    // Prima la revisione, poi il testo: se la nota cambia in mezzo, la
    // modifica ha una base vecchia e la scrittura è un conflitto, non un
    // taglio nei byte sbagliati.
    let revision = host.document_revision(doc)?;
    let source = host.read_document(doc)?;
    let model = host.read_model(doc)?;
    Ok(Read {
        revision,
        source,
        model,
    })
}

pub(super) fn notes_block_move(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let context = host.active_context();
    let doc = args
        .document("doc")
        .or_else(|| context.as_ref().and_then(|c| c.doc.clone()))
        .ok_or_else(|| PluginError::BadArgs(Text::key(AND_NO_OPEN_NOTES)))?;
    let to = args
        .document("to")
        .ok_or_else(|| PluginError::BadArgs(Text::key(AND_NO_NOTES_GIVEN)))?;
    let leave = match args.text("leave").map(str::trim).unwrap_or(LEAVE_LINK) {
        LEAVE_NONE => Leave::None,
        LEAVE_LINK | "" => Leave::Link,
        LEAVE_EMBED => Leave::Embed,
        other => return Err(PluginError::BadArgs(one(E_BLOCK_LEAVE, A_VALUE, other))),
    };
    let heading = args
        .text(A_HEADING)
        .map(str::trim)
        .filter(|slug| !slug.is_empty())
        .map(str::to_string);
    // Si taglia e si incolla testo: vale per due sorgenti in prosa.
    crate::formats::require(host, &doc, fub_abi::options::source::PROSE)?;
    crate::formats::require(host, &to, fub_abi::options::source::PROSE)?;
    let request = Request {
        doc,
        to,
        heading,
        leave,
    };

    let from = read(host, &request.doc)?;
    let range = match args.numbers("at") {
        Some(at) => {
            let (start, end) = given_bytes(&at)?;
            // Il testo letto da chi chiama, prima di ogni altra domanda: se fra
            // quei byte c'è altro, la nota è cambiata e non si muove niente.
            if let Some(expected) = args.text(A_TEXT) {
                if from.source.get(start..end) != Some(expected) {
                    return Err(PluginError::Conflict(one(
                        E_BLOCK_CHANGED,
                        A_DOC,
                        request.doc.page_name(),
                    )));
                }
            }
            line_range(&from.source, start, end)
                .ok_or_else(|| PluginError::BadArgs(Text::key(E_BLOCK_RANGE)))?
        }
        None => caret_range(context.as_ref(), &request.doc, &from)?,
    };
    let planned = plan_move(host, &request, from, range)?;

    if mode.is_dry_run() {
        let edits = planned
            .plan
            .steps
            .iter()
            .filter_map(|step| match step {
                WriteStep::Edit(edit) => Some(edit.clone()),
                _ => None,
            })
            .collect();
        return Ok(
            CommandOutcome::done().with_effect(CommandEffect::Plan(CommandPlan::of_edits(
                one(P_BLOCK_MOVE, A_TO, request.to.page_name()),
                edits,
            ))),
        );
    }

    let applied = planned.plan.apply(host).map_err(PluginError::from)?;
    let undo = undo_of(&applied, &request.to);
    Ok(CommandOutcome::notify(planned.done).undoable(undo))
}

/// L'annullamento del piano: per ogni nota l'inverso della sua modifica, in un
/// passo solo. Un piano di sole modifiche non ha passi strutturali; se un
/// giorno ne avesse, sarebbero il cestino e la rinomina di questo registro.
fn undo_of(applied: &AppliedPlan, to: &DocId) -> Undo {
    applied.undo(
        one(U_BLOCK_MOVE, A_TO, to.page_name()),
        |reversal| match reversal {
            Reversal::Trash { doc } => UndoStep::Command {
                command: NOTES_TRASH.to_string(),
                args: serde_json::json!({ "doc": doc.as_str() }),
            },
            Reversal::Rename { from, to } => UndoStep::Command {
                command: NOTES_RENAME.to_string(),
                args: serde_json::json!({ "doc": from.as_str(), "to": to.as_str() }),
            },
        },
    )
}

/// Un piano pronto, e la frase di quando sarà fatto.
struct Planned {
    plan: WritePlan,
    done: Text,
}

/// `at` come intervallo di byte: due numeri interi, inizio e fine.
fn given_bytes(at: &[f64]) -> Result<(usize, usize), PluginError> {
    let bad = || PluginError::BadArgs(Text::key(E_BLOCK_RANGE));
    let [start, end] = at else { return Err(bad()) };
    let whole = |n: f64| (n.is_finite() && n >= 0.0 && n.fract() == 0.0).then_some(n as usize);
    whole(*start).zip(whole(*end)).ok_or_else(bad)
}

/// L'intervallo `start..end` portato su righe intere: comincia all'inizio di
/// una riga, finisce alla fine di una (gli a capo in coda restano fuori), sta
/// su confini di carattere e non è vuoto. `None` se non è così.
fn line_range(source: &str, start: usize, end: usize) -> Option<(usize, usize)> {
    if start >= end || end > source.len() {
        return None;
    }
    if !source.is_char_boundary(start) || !source.is_char_boundary(end) {
        return None;
    }
    let bytes = source.as_bytes();
    if start > 0 && bytes[start - 1] != b'\n' {
        return None;
    }
    let mut end = end;
    while end > start && matches!(bytes[end - 1], b'\n' | b'\r') {
        end -= 1;
    }
    if end < source.len() && !matches!(bytes[end], b'\n' | b'\r') {
        return None;
    }
    (end > start && !source[start..end].trim().is_empty()).then_some((start, end))
}

/// Il blocco del cursore: quello di primo livello che lo contiene, o la voce
/// di elenco di primo livello se è un elenco.
fn caret_range(
    context: Option<&fub_abi::session::ViewContext>,
    doc: &DocId,
    from: &Read,
) -> Result<(usize, usize), PluginError> {
    let context = context
        .filter(|context| context.doc.as_ref() == Some(doc))
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_BLOCK_NO_CARET)))?;
    let selections = context
        .selections
        .as_ref()
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_BLOCK_NO_CARET)))?;
    // Le coordinate valgono per il file soltanto a buffer pulito (decisione
    // 0007): con un buffer sporco il blocco detto non è quello del disco.
    let caret = selections
        .placed()
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_BLOCK_DIRTY)))?
        .all()
        .first()
        .map(|selection| selection.span.start)
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_BLOCK_NO_CARET)))?;
    let span = block_at(&from.model.body, caret)
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_BLOCK_NOT_FOUND)))?;
    line_range(&from.source, span.start, span.end)
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_BLOCK_NOT_FOUND)))
}

/// Lo span del blocco di primo livello che contiene `at` (la voce, in un
/// elenco).
fn block_at(body: &[Block], at: usize) -> Option<Span> {
    let block = body.iter().find(|block| {
        let span = block.span();
        span.start <= at && at <= span.end
    })?;
    if let Block::List { items, .. } = block {
        if let Some(item) = items
            .iter()
            .find(|item| item.span.start <= at && at <= item.span.end)
        {
            return Some(item.span);
        }
    }
    Some(block.span())
}

/// Quanti blocchi di primo livello (o voci di primo livello di un elenco)
/// l'intervallo tocca, e di che specie è il primo: serve alla trasclusione, che
/// porta un blocco solo, e a dove scriverne l'id.
fn blocks_in(body: &[Block], start: usize, end: usize) -> (usize, Option<IdPlace>) {
    let mut count = 0;
    let mut place = None;
    for block in body {
        let span = block.span();
        if span.end <= start || span.start >= end {
            continue;
        }
        match block {
            Block::List { items, .. } => {
                for item in items {
                    if item.span.end <= start || item.span.start >= end {
                        continue;
                    }
                    count += 1;
                    place.get_or_insert(IdPlace::Item);
                }
            }
            Block::Paragraph { .. } | Block::Heading { .. } => {
                count += 1;
                place.get_or_insert(IdPlace::Tail);
            }
            _ => {
                count += 1;
                place.get_or_insert(IdPlace::OwnLine);
            }
        }
    }
    (count, place)
}

/// Dove si scrive l'id di un blocco che non ce l'ha: in coda all'ultima riga
/// (testo, titolo), in coda alla prima frase di una voce (prima dei figli), o
/// su una riga sua dopo una riga vuota (codice, tabella, citazione…). È la
/// stessa regola di `blocks/anchor.ts` nel client.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum IdPlace {
    Tail,
    Item,
    OwnLine,
}

/// Gli a capo di una nota: CRLF se ne ha uno, altrimenti LF.
fn eol_of(source: &str) -> &'static str {
    if source.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

/// Il testo del blocco come va scritto altrove: a capo LF, e senza il rientro
/// che aveva dentro un elenco (la prima riga lo dice, e tutte le righe non
/// vuote devono averlo).
fn moved_body(text: &str) -> String {
    let lf = text.replace("\r\n", "\n");
    let first = lf.lines().next().unwrap_or("");
    let indent: String = first
        .chars()
        .take_while(|c| *c == ' ' || *c == '\t')
        .collect();
    if indent.is_empty()
        || !lf
            .lines()
            .all(|line| line.trim().is_empty() || line.starts_with(&indent))
    {
        return lf;
    }
    lf.lines()
        .map(|line| line.strip_prefix(indent.as_str()).unwrap_or(""))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Il segno di voce in testa alla prima riga (`- `, `  1. `), senza la
/// casella: ciò che si tiene davanti al link lasciato al posto di una voce,
/// perché l'elenco resti un elenco.
fn item_prefix(line: &str) -> Option<&str> {
    let indent = line.len() - line.trim_start_matches([' ', '\t']).len();
    let rest = &line[indent..];
    let marker = if rest.starts_with(['-', '*', '+']) {
        1
    } else {
        let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
        if digits == 0 || !rest[digits..].starts_with(['.', ')']) {
            return None;
        }
        digits + 1
    };
    let after = &rest[marker..];
    let gap = after.len() - after.trim_start_matches([' ', '\t']).len();
    (gap > 0).then(|| &line[..indent + marker + gap])
}

fn is_item(line: &str) -> bool {
    item_prefix(line).is_some()
}

/// L'ultima riga non vuota di `text`.
fn last_line(text: &str) -> Option<&str> {
    text.lines().rev().find(|line| !line.trim().is_empty())
}

/// Che cosa si scrive in `target` alla posizione `at` (un inizio di riga, o
/// la fine) per metterci `body`: una riga vuota prima e dopo, se servono, e gli
/// a capo della nota. Due voci di elenco una dopo l'altra restano attaccate, così
/// la voce entra nell'elenco che c'è.
fn insertion(target: &str, at: usize, body: &str) -> String {
    let eol = eol_of(target);
    let before = &target[..at];
    let after = &target[at..];
    let joins = last_line(before).is_some_and(is_item) && body.lines().next().is_some_and(is_item);
    let lead = if before.trim().is_empty() {
        ""
    } else if !before.ends_with('\n') {
        if joins {
            eol
        } else {
            // Due a capo: la riga in corso si chiude, e una vuota separa.
            if eol == "\r\n" {
                "\r\n\r\n"
            } else {
                "\n\n"
            }
        }
    } else if joins || before.ends_with("\n\n") || before.ends_with("\n\r\n") {
        ""
    } else {
        eol
    };
    let tail = if after.is_empty() {
        eol.to_string()
    } else {
        format!("{eol}{eol}")
    };
    let body = body.replace('\n', eol);
    // Una nota vuota che comincia con righe vuote non ne prende altre.
    let lead = if before.is_empty() { "" } else { lead };
    format!("{lead}{body}{tail}")
}

/// Che cosa si toglie dalla nota di partenza quando al posto del blocco non
/// resta niente: le sue righe con l'a capo, e una delle due righe vuote che
/// resterebbero attaccate. In fondo alla nota anche le righe vuote prima.
fn removal(source: &str, start: usize, end: usize) -> (usize, usize) {
    let mut to = end;
    if source[to..].starts_with("\r\n") {
        to += 2;
    } else if source[to..].starts_with('\n') {
        to += 1;
    }
    let blank_before =
        start == 0 || source[..start].ends_with("\n\n") || source[..start].ends_with("\n\r\n");
    if to >= source.len() {
        // In fondo: via anche le righe vuote che lo precedevano, tenendo l'a
        // capo che chiude la riga prima.
        let mut from = start;
        while from > 0 {
            let line_start = source[..from - 1].rfind('\n').map_or(0, |i| i + 1);
            if line_start == 0 || !source[line_start..from].trim().is_empty() {
                break;
            }
            from = line_start;
        }
        return (from, source.len());
    }
    if blank_before {
        // Una riga vuota dopo il blocco si unirebbe a quella prima.
        let next_end = source[to..].find('\n').map_or(source.len(), |i| to + i + 1);
        if source[to..next_end].trim().is_empty() {
            to = next_end;
        }
    }
    (start, to)
}

/// La fine della sezione del titolo con lo slug `slug`: l'inizio del primo
/// titolo dopo di lui dello stesso livello o più alto, o la fine della nota.
fn section_end(outline: &[Heading], slug: &str, len: usize) -> Option<(usize, usize)> {
    let index = outline.iter().position(|heading| heading.slug == slug)?;
    let level = outline[index].level;
    let end = outline[index + 1..]
        .iter()
        .find(|heading| heading.level <= level)
        .map_or(len, |heading| heading.span.start);
    Some((outline[index].span.start, end))
}

/// Il punto d'arrivo in `to`: in fondo alla nota, o in fondo alla sezione del
/// titolo chiesto (con l'inizio del titolo, per sapere se sta dentro ciò che si
/// sposta).
fn landing(request: &Request, to: &Read) -> Result<(usize, Option<usize>), PluginError> {
    match &request.heading {
        None => Ok((to.source.len(), None)),
        Some(slug) => {
            let (start, end) =
                section_end(&to.model.outline, slug, to.source.len()).ok_or_else(|| {
                    PluginError::BadArgs(Text::message(
                        E_BLOCK_HEADING,
                        vec![
                            Arg::text(A_TO, request.to.page_name()),
                            Arg::text(A_HEADING, slug.as_str()),
                        ],
                    ))
                })?;
            // L'inizio di una riga: lo span del titolo comincia lì, ma un
            // modello che lo desse a metà riga non deve far tagliare una riga.
            let end = if end < to.source.len() {
                to.source[..end].rfind('\n').map_or(0, |i| i + 1)
            } else {
                end
            };
            Ok((end, Some(start)))
        }
    }
}

/// Il nome con cui la nota d'arrivo è nominata dai link: il più corto che il
/// vault risolve davvero a lei.
fn reference(host: &dyn HostApi, doc: &DocId) -> Result<String, PluginError> {
    crate::formats::link_reference(host, doc)
}

/// Il link wiki `page` scritto in `from` porta a `doc`? Una pagina vuota è la
/// nota stessa.
fn resolves_to(
    host: &dyn HostApi,
    page: &str,
    from: &DocId,
    doc: &DocId,
) -> Result<bool, PluginError> {
    if page.trim().is_empty() {
        return Ok(from == doc);
    }
    match host.query_index(IndexQuery::Resolve {
        target: LinkTarget::wiki(page),
        from: Some(from.clone()),
    }) {
        Ok(IndexResult::Resolved(Some(ResolvedRef { doc: found, .. }))) => Ok(found == *doc),
        Ok(_) => Ok(false),
        // Un host che non sa risolvere: il nome della pagina basta, com'è
        // scritto o col percorso senza estensione.
        Err(PluginError::Unserved(_)) => Ok(page == doc.page_name()
            || doc
                .as_str()
                .rsplit_once('.')
                .is_some_and(|(stem, _)| stem == page)),
        Err(error) => Err(error),
    }
}

/// Ciò che il blocco si porta dietro e per cui un link lo può nominare: gli id
/// (`^abc`, canonici) e gli slug dei titoli.
#[derive(Default)]
struct Names {
    ids: Vec<String>,
    slugs: Vec<String>,
}

impl Names {
    fn of(model: &DocumentModel, start: usize, end: usize) -> Self {
        let mut names = Names::default();
        for anchor in &model.anchors {
            if anchor.marker.start >= start && anchor.marker.end <= end {
                names.ids.push(anchor.id.clone());
            }
        }
        for heading in &model.outline {
            if heading.span.start < start || heading.span.start >= end {
                continue;
            }
            if heading.explicit_anchor.is_some() {
                names.ids.push(heading.slug.clone());
            }
            names.slugs.push(heading.slug.clone());
        }
        names
    }

    fn is_empty(&self) -> bool {
        self.ids.is_empty() && self.slugs.is_empty()
    }

    /// Il link nomina qualcosa che si sposta?
    fn named(&self, heading: Option<&str>, block: Option<&str>) -> bool {
        match (block, heading) {
            (Some(block), _) => self.ids.contains(&canonical_anchor(block)),
            (None, Some(heading)) => self.slugs.contains(&heading_slug(heading)),
            (None, None) => false,
        }
    }
}

/// Le modifiche che portano verso `reference` i link di `doc` che nominano ciò
/// che si sposta da `from`, fuori da `skip` (il blocco stesso, che si porta
/// dietro i suoi). Si riscrive soltanto la pagina dentro `[[…]]`.
fn retarget(
    host: &dyn HostApi,
    doc: &DocId,
    read: &Read,
    from: &DocId,
    names: &Names,
    reference: &str,
    skip: Option<(usize, usize)>,
) -> Result<Vec<TextEdit>, PluginError> {
    let mut edits = Vec::new();
    for link in &read.model.links {
        let LinkTarget::Wiki {
            page,
            heading,
            block,
        } = &link.target
        else {
            continue;
        };
        if !names.named(heading.as_deref(), block.as_deref()) {
            continue;
        }
        if skip.is_some_and(|(start, end)| link.span.start >= start && link.span.end <= end) {
            continue;
        }
        if !resolves_to(host, page, doc, from)? {
            continue;
        }
        let Some(written) = read.source.get(link.span.start..link.span.end) else {
            continue;
        };
        let open = if written.starts_with("![[") {
            3
        } else if written.starts_with("[[") {
            2
        } else {
            continue;
        };
        let inner = &written[open..];
        let page_len = inner.find(['#', '|', ']']).unwrap_or(inner.len());
        let at = link.span.start + open;
        edits.push(TextEdit::replace(Span::new(at, at + page_len), reference));
    }
    Ok(edits)
}

/// Un id nuovo per il blocco, che non c'è né nella nota di partenza né in
/// quella d'arrivo: sei caratteri in base 36, come quelli dell'editor.
fn fresh_id(host: &dyn HostApi, sources: &[&str]) -> Result<String, PluginError> {
    for _ in 0..ID_TRIES {
        let bytes = host.random_bytes(4)?;
        let n = bytes
            .iter()
            .fold(0u64, |n, byte| (n << 8) | u64::from(*byte))
            % 36u64.pow(6);
        let id = base36(n);
        let marker = format!("^{id}");
        if sources.iter().all(|source| !source.contains(&marker)) {
            return Ok(id);
        }
    }
    Err(PluginError::Internal(
        "nessun id libero per il blocco".into(),
    ))
}

fn base36(mut n: u64) -> String {
    const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out = [b'0'; 6];
    for slot in out.iter_mut().rev() {
        *slot = DIGITS[(n % 36) as usize];
        n /= 36;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Il blocco con l'id scritto dove il kernel lo legge.
fn with_id(body: &str, id: &str, place: IdPlace) -> String {
    let marker = format!("^{id}");
    match place {
        IdPlace::OwnLine => format!("{body}\n\n{marker}"),
        IdPlace::Tail => {
            let trimmed = body.trim_end();
            format!("{trimmed} {marker}")
        }
        IdPlace::Item => {
            // La prima frase della voce: le righe fino a una vuota o a una voce
            // figlia. L'id va in coda all'ultima, prima dei figli.
            let mut end = 0;
            for (n, line) in body.split('\n').enumerate() {
                if n > 0 && (line.trim().is_empty() || is_item(line)) {
                    break;
                }
                end = if n == 0 {
                    line.len()
                } else {
                    end + 1 + line.len()
                };
            }
            let (head, rest) = body.split_at(end);
            format!("{} {marker}{rest}", head.trim_end())
        }
    }
}

fn plan_move(
    host: &dyn HostApi,
    request: &Request,
    from: Read,
    (start, end): (usize, usize),
) -> Result<Planned, PluginError> {
    let heading_text = |target: &Read| {
        target
            .model
            .outline
            .iter()
            .find(|heading| Some(&heading.slug) == request.heading.as_ref())
            .map(|heading| heading.text.clone())
            .unwrap_or_default()
    };
    if request.to == request.doc {
        let (at, heading_start) = landing(request, &from)?;
        let heading = heading_text(&from);
        return plan_within(request, from, (start, end), at, heading_start, heading);
    }
    let to = read(host, &request.to)?;
    let (at, _) = landing(request, &to)?;
    let heading_arg = || heading_text(&to);

    let (count, place) = blocks_in(&from.model.body, start, end);
    let names = Names::of(&from.model, start, end);
    let mut body = moved_body(&from.source[start..end]);
    // Il link e la trasclusione nominano il blocco col suo id, se ne ha uno;
    // la trasclusione glielo dà se non ce l'ha.
    let own_id = (count == 1)
        .then(|| {
            from.model
                .anchors
                .iter()
                .find(|anchor| anchor.marker.start >= start && anchor.marker.end <= end)
                .map(|anchor| anchor.id.clone())
        })
        .flatten();
    let block_id = match request.leave {
        Leave::Embed => {
            if count != 1 {
                return Err(PluginError::BadArgs(Text::key(E_BLOCK_EMBED_MANY)));
            }
            match own_id {
                Some(id) => Some(id),
                None => {
                    let id = fresh_id(host, &[&from.source, &to.source])?;
                    body = with_id(&body, &id, place.unwrap_or(IdPlace::OwnLine));
                    Some(id)
                }
            }
        }
        _ => own_id,
    };
    let target_reference = reference(host, &request.to)?;

    // La nota d'arrivo: il blocco al suo posto, e i link che lei stessa aveva
    // verso ciò che arriva.
    let mut target_edits = vec![TextEdit::insert(at, insertion(&to.source, at, &body))];
    if !names.is_empty() {
        target_edits.extend(retarget(
            host,
            &request.to,
            &to,
            &request.doc,
            &names,
            &target_reference,
            None,
        )?);
    }

    // La nota di partenza: ciò che resta al posto del blocco, e i suoi link al
    // blocco che se ne va.
    let leave_text = match request.leave {
        Leave::None => None,
        Leave::Link | Leave::Embed => {
            let link = LinkInsert {
                target: LinkTarget::Wiki {
                    page: target_reference.clone(),
                    heading: None,
                    block: block_id.clone(),
                },
                label: None,
                embed: request.leave == Leave::Embed,
            };
            let written = crate::formats::link_text(host, &request.doc, &link)?;
            let first = from.source[start..end].lines().next().unwrap_or("");
            // Il segno della voce resta, la casella del compito no.
            let prefix = item_prefix(first).unwrap_or_default();
            Some(format!("{prefix}{written}"))
        }
    };
    let mut source_edits = vec![match leave_text {
        None => {
            let (from_byte, to_byte) = removal(&from.source, start, end);
            TextEdit::delete(Span::new(from_byte, to_byte))
        }
        Some(text) => TextEdit::replace(Span::new(start, end), text),
    }];
    if !names.is_empty() {
        source_edits.extend(retarget(
            host,
            &request.doc,
            &from,
            &request.doc,
            &names,
            &target_reference,
            Some((start, end)),
        )?);
    }

    let mut plan = WritePlan::new()
        .edit(
            request.to.clone(),
            request_of(to.revision.clone(), target_edits),
        )
        .edit(
            request.doc.clone(),
            request_of(from.revision.clone(), source_edits),
        );

    // Le altre note che linkano ciò che si sposta.
    if !names.is_empty() {
        for linking in backlinkers(host, &request.doc)? {
            if linking == request.doc || linking == request.to {
                continue;
            }
            if !crate::formats::understands(host, &linking, fub_abi::options::source::PROSE) {
                continue;
            }
            let read = read(host, &linking)?;
            let edits = retarget(
                host,
                &linking,
                &read,
                &request.doc,
                &names,
                &target_reference,
                None,
            )?;
            if !edits.is_empty() {
                plan = plan.edit(linking, request_of(read.revision, edits));
            }
        }
    }

    let where_key = if request.heading.is_some() {
        "under"
    } else {
        "end"
    };
    let what_key = match request.leave {
        Leave::None => LEAVE_NONE,
        Leave::Link => LEAVE_LINK,
        Leave::Embed => LEAVE_EMBED,
    };
    let done = Text::message(
        format!("{D_BLOCK_MOVE}.{where_key}.{what_key}"),
        vec![
            Arg::text(A_TO, request.to.page_name()),
            Arg::text(A_HEADING, heading_arg()),
        ],
    );
    Ok(Planned { plan, done })
}

/// Lo spostamento dentro la stessa nota: una modifica sola, che toglie il
/// blocco e lo rimette in fondo (alla nota o alla sezione). Non lascia niente:
/// un link a sé stessa al posto del blocco non serve a nessuno.
fn plan_within(
    request: &Request,
    from: Read,
    (start, end): (usize, usize),
    at: usize,
    heading_start: Option<usize>,
    heading: String,
) -> Result<Planned, PluginError> {
    let source = &from.source;
    if heading_start.is_some_and(|h| h >= start && h < end) {
        return Err(PluginError::BadArgs(Text::key(E_BLOCK_INSIDE)));
    }
    let (cut_from, cut_to) = removal(source, start, end);
    if at >= start && at <= cut_to {
        return Err(PluginError::BadArgs(Text::key(E_BLOCK_THERE)));
    }
    let body = moved_body(&source[start..end]);
    // Si toglie prima, poi si inserisce sul testo senza il blocco: le righe
    // vuote attorno al punto d'arrivo si contano su ciò che resterà.
    let mut without = String::with_capacity(source.len());
    without.push_str(&source[..cut_from]);
    without.push_str(&source[cut_to..]);
    let landing = if at > cut_from {
        at - (cut_to - cut_from)
    } else {
        at
    };
    let insert = insertion(&without, landing, &body);
    let mut after = String::with_capacity(without.len() + insert.len());
    after.push_str(&without[..landing]);
    after.push_str(&insert);
    after.push_str(&without[landing..]);
    // Una modifica sola, sul tratto che cambia: prefisso e coda restano.
    let lo = cut_from.min(at);
    let hi = cut_to.max(at);
    let tail = source.len() - hi;
    let middle = after[lo..after.len() - tail].to_string();
    let plan = WritePlan::new().edit(
        request.doc.clone(),
        request_of(
            from.revision,
            vec![TextEdit::replace(Span::new(lo, hi), middle)],
        ),
    );
    let where_key = if request.heading.is_some() {
        "under"
    } else {
        "end"
    };
    let done = Text::message(
        format!("{D_BLOCK_MOVE}.here.{where_key}"),
        vec![
            Arg::text(A_TO, request.to.page_name()),
            Arg::text(A_HEADING, heading),
        ],
    );
    Ok(Planned { plan, done })
}

fn request_of(revision: Revision, mut edits: Vec<TextEdit>) -> EditRequest {
    edits.sort_by_key(|edit| (edit.span.start, edit.span.end));
    EditRequest::new(revision, edits)
}

/// Le note che linkano `doc`, tutte, pagina per pagina.
fn backlinkers(host: &dyn HostApi, doc: &DocId) -> Result<Vec<DocId>, PluginError> {
    const WINDOW: u32 = 200;
    let mut out: Vec<DocId> = Vec::new();
    let mut offset = 0u32;
    loop {
        let page = match host.query_index(IndexQuery::Backlinks {
            target: doc.clone(),
            page: Some(Page {
                offset,
                limit: WINDOW,
            }),
        }) {
            Ok(result) => result.backlinks()?,
            // Senza indice dei backlink i link delle altre note restano com'erano.
            Err(PluginError::Unserved(_)) => return Ok(out),
            Err(error) => return Err(error),
        };
        let got = page.items.len() as u32;
        for found in page.items {
            if !out.contains(&found.source) {
                out.push(found.source);
            }
        }
        offset += got;
        if got == 0 || offset >= page.total {
            return Ok(out);
        }
    }
}

#[cfg(test)]
#[path = "move_block_tests.rs"]
mod tests;
