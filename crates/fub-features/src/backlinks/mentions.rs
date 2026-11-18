//! **Che cos'è una menzione**, e il comando che la collega.
//!
//! Una menzione è il nome di una nota (o un suo alias) scritto **in prosa**: in
//! un paragrafo, un titolo, una cella, come parola intera. Non lo è il testo che
//! sta già dentro un collegamento (`[[Progetti/Alpha|Alfa]]`), dentro il codice
//! (`` `_index` ``, un blocco recintato), in un tag, in una formula o nel
//! frontmatter: collegarlo vorrebbe dire scrivere un link dentro un link o
//! dentro il codice, e il documento si rovina (`_[[[[index]]]]`).
//!
//! La regola sta qui una volta sola, e la usano tutti quelli che ne hanno
//! bisogno: le due liste del pannello (menzioni entranti e uscenti) e il
//! comando [`MENTION_LINK`], che la ricontrolla sul testo attuale prima di
//! scrivere. La struttura viene dal modello del formato (blocchi, link, tag
//! con i loro span); l'unico pezzo di sintassi letto dal sorgente è il codice
//! in linea, che il modello porta senza posizione: le coppie di apici inversi
//! della stessa lunghezza, come le legge CommonMark.
//!
//! Il collegamento è un comando, e non una scrittura della vista, perché un
//! comando dichiara il proprio inverso: la conversione è **una** voce della
//! pila delle operazioni, e «Annulla l'ultima operazione» la disfa in un passo.

use fub_abi::command::{
    Args, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope, CommandSpec,
    InvokeMode, ParamKind, ParamSpec, PlannedEdit, Undo,
};
use fub_abi::edit::{EditRequest, Revision, TextEdit};
use fub_abi::error::PluginError;
use fub_abi::model::{Block, DocumentModel, Inline, Span};
use fub_abi::options::source::PROSE;
use fub_abi::text::{Arg, Text};
use fub_abi::traits::{CommandProvider, HostApi};

/// Collega una menzione non collegata: la parola resta, diventa un link.
pub const MENTION_LINK: &str = "mention.link";

pub(super) const A_DOC: &str = "doc";
pub(super) const A_TARGET: &str = "target";
pub(super) const A_MENTION: &str = "mention";
pub(super) const A_START: &str = "start";
pub(super) const A_END: &str = "end";
pub(super) const A_REVISION: &str = "revision";

pub(super) const N_LINKED: &str = "mention.n_linked";
pub(super) const P_LINK: &str = "mention.p_link";
pub(super) const U_LINK: &str = "mention.u_link";
pub(super) const E_CHANGED: &str = "mention.e_changed";
pub(super) const E_NOT_A_MENTION: &str = "mention.e_not_a_mention";
pub(super) const E_ARGS: &str = "mention.e_args";

/// Le parti di un sorgente in cui una parola è prosa, in byte, ordinate e
/// disgiunte.
#[derive(Debug, Default)]
pub(super) struct Prose {
    ranges: Vec<(usize, usize)>,
}

impl Prose {
    /// La prosa di `source`, il testo da cui `model` è stato letto.
    ///
    /// Le foglie sono i blocchi che portano testo in linea (paragrafi, titoli,
    /// celle), dentro liste, citazioni e blocchi personalizzati che ne hanno;
    /// da ciascuna si tolgono i link, i tag, i nodi in linea personalizzati
    /// (le formule) e il codice in linea. Il frontmatter, i blocchi di codice e
    /// ciò che il modello non porta come testo restano fuori da sé. Uno span
    /// del modello che non cade in `source` non è prosa: il modello non è di
    /// questo testo, e meglio nessuna menzione che una sbagliata.
    pub(super) fn of(model: &DocumentModel, source: &str) -> Self {
        let mut leaves = Vec::new();
        let mut excluded: Vec<Span> = model.links.iter().map(|link| link.span).collect();
        for block in &model.body {
            walk_block(block, &mut leaves, &mut excluded);
        }
        let mut ranges = Vec::new();
        for leaf in leaves {
            let Some(text) = source.get(leaf.start..leaf.end) else {
                continue;
            };
            let mut cuts: Vec<(usize, usize)> = excluded
                .iter()
                .filter(|span| span.start < leaf.end && span.end > leaf.start)
                .map(|span| (span.start.max(leaf.start), span.end.min(leaf.end)))
                .collect();
            cuts.extend(code_spans(text, leaf.start));
            cuts.sort_unstable();
            let mut at = leaf.start;
            for (start, end) in cuts {
                if start > at {
                    ranges.push((at, start));
                }
                at = at.max(end);
            }
            if at < leaf.end {
                ranges.push((at, leaf.end));
            }
        }
        ranges.sort_unstable();
        Prose { ranges }
    }

    /// `source[start..end]` è una menzione: sta tutta nella prosa ed è una
    /// parola intera (prima e dopo, niente lettere né cifre).
    pub(super) fn is_mention(&self, source: &str, start: usize, end: usize) -> bool {
        if start >= end || source.get(start..end).is_none() {
            return false;
        }
        let inside = match self.ranges.partition_point(|&(s, _)| s <= start) {
            0 => false,
            i => end <= self.ranges[i - 1].1,
        };
        let word = |c: Option<char>| c.is_some_and(char::is_alphanumeric);
        inside && !word(source[..start].chars().next_back()) && !word(source[end..].chars().next())
    }

    /// Le menzioni di `name` in `source`, come span in byte.
    pub(super) fn mentions<'a>(
        &'a self,
        source: &'a str,
        name: &'a str,
    ) -> impl Iterator<Item = (usize, usize)> + 'a {
        source
            .match_indices(name)
            .map(move |(start, _)| (start, start + name.len()))
            .filter(move |&(start, end)| self.is_mention(source, start, end))
    }
}

fn walk_block(block: &Block, leaves: &mut Vec<Span>, excluded: &mut Vec<Span>) {
    match block {
        Block::Heading { inlines, span, .. } | Block::Paragraph { inlines, span, .. } => {
            leaves.push(*span);
            walk_inlines(inlines, excluded);
        }
        Block::List { items, .. } => {
            for item in items {
                for block in &item.blocks {
                    walk_block(block, leaves, excluded);
                }
            }
        }
        Block::Quote { blocks, .. } | Block::Custom { blocks, .. } => {
            for block in blocks {
                walk_block(block, leaves, excluded);
            }
        }
        Block::Table { head, rows, .. } => {
            for cell in head.iter().chain(rows).flat_map(|row| &row.cells) {
                leaves.push(cell.span);
                walk_inlines(&cell.inlines, excluded);
            }
        }
        Block::CodeBlock { .. }
        | Block::ThematicBreak { .. }
        | Block::ReferenceDefinition { .. } => {}
    }
}

fn walk_inlines(inlines: &[Inline], excluded: &mut Vec<Span>) {
    for inline in inlines {
        match inline {
            Inline::Link { span, .. }
            | Inline::TagRef { span, .. }
            | Inline::Custom { span, .. } => excluded.push(*span),
            Inline::Emph(children)
            | Inline::Strong(children)
            | Inline::Superscript(children)
            | Inline::Strikethrough(children)
            | Inline::Subscript(children) => walk_inlines(children, excluded),
            Inline::Text(_) | Inline::Code(_) | Inline::HardBreak | Inline::SoftBreak => {}
        }
    }
}

/// Il codice in linea di `text` (che comincia al byte `base` del sorgente):
/// una fila di N apici inversi apre, la prima fila di esattamente N chiude, e
/// una fila senza chiusura è testo. Fuori dal codice una barra rovescia toglie
/// il significato al carattere dopo; dentro no.
fn code_spans(text: &str, base: usize) -> Vec<(usize, usize)> {
    let bytes = text.as_bytes();
    let run = |from: usize| bytes[from..].iter().take_while(|&&b| b == b'`').count();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 2,
            b'`' => {
                let open = run(i);
                let mut j = i + open;
                let mut close = None;
                while j < bytes.len() {
                    if bytes[j] == b'`' {
                        let n = run(j);
                        if n == open {
                            close = Some(j + n);
                            break;
                        }
                        j += n;
                    } else {
                        j += 1;
                    }
                }
                match close {
                    Some(end) => {
                        out.push((base + i, base + end));
                        i = end;
                    }
                    None => i += open,
                }
            }
            _ => i += 1,
        }
    }
    out
}

/// Il comando che collega una menzione.
pub struct MentionCommands;

impl CommandProvider for MentionCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![
            CommandSpec::new(MENTION_LINK, Text::key(format!("{MENTION_LINK}.title")))
                .describing(Text::key(format!("{MENTION_LINK}.desc")))
                .with_param(parameter(A_DOC, ParamKind::Document).required())
                .with_param(parameter(A_TARGET, ParamKind::Document).required())
                .with_param(parameter(A_MENTION, ParamKind::Text).required())
                .with_param(parameter(A_START, ParamKind::Number).required())
                .with_param(parameter(A_END, ParamKind::Number).required())
                .with_param(parameter(A_REVISION, ParamKind::Text).required())
                .with_scope(CommandScope::writing(CommandReach::Document)),
        ]
    }

    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        match command {
            MENTION_LINK => link_mention(Args::new(&args), mode, host),
            other => Err(PluginError::UnknownCommand(other.to_string().into())),
        }
    }
}

fn parameter(name: &str, kind: ParamKind) -> ParamSpec {
    ParamSpec::new(
        name,
        Text::key(format!("{MENTION_LINK}.{name}.title")),
        kind,
    )
    .describing(Text::key(format!("{MENTION_LINK}.{name}.desc")))
}

/// Un offset in byte da un numero JSON: intero e non negativo, o niente.
fn offset(value: Option<f64>) -> Option<usize> {
    value
        .filter(|n| n.is_finite() && *n >= 0.0 && n.fract() == 0.0 && *n <= usize::MAX as f64)
        .map(|n| n as usize)
}

/// Collega la menzione `mention` che sta in `doc` fra `start` e `end`, letta
/// alla revisione `revision`, alla nota `target`.
///
/// Non scrive niente se la nota non è più quella letta, se in quel punto non
/// c'è più quel testo, o se quel testo non è (più) una menzione: già dentro un
/// collegamento, nel codice, a metà di una parola. Il controllo e la scrittura
/// stanno nello stesso passo: l'edit porta la revisione letta, e l'host lo
/// rifiuta se il file cambia ancora nel mezzo.
fn link_mention(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let bad = || PluginError::BadArgs(Text::key(E_ARGS));
    let doc = args.document(A_DOC).ok_or_else(bad)?;
    let target = args.document(A_TARGET).ok_or_else(bad)?;
    let mention = args
        .text(A_MENTION)
        .filter(|m| !m.is_empty())
        .ok_or_else(bad)?;
    let start = offset(args.number(A_START)).ok_or_else(bad)?;
    let end = offset(args.number(A_END)).ok_or_else(bad)?;
    let expected = Revision::new(args.text(A_REVISION).ok_or_else(bad)?);
    // Si sostituisce una parola: ha senso solo in un sorgente in prosa. Come
    // si scrive il link lo decide il formato della nota.
    crate::formats::require(host, &doc, PROSE)?;
    let changed = || {
        PluginError::Conflict(Text::message(
            E_CHANGED,
            vec![Arg::text(A_DOC, doc.as_str())],
        ))
    };
    if host.document_revision(&doc)? != expected {
        return Err(changed());
    }
    let source = host.read_document(&doc)?;
    let model = host.read_model(&doc)?;
    // Testo e modello devono essere della revisione letta: uno dei due più
    // nuovo direbbe che la menzione c'è dove non c'è più.
    if host.document_revision(&doc)? != expected || source.get(start..end) != Some(mention) {
        return Err(changed());
    }
    if !Prose::of(&model, &source).is_mention(&source, start, end) {
        return Err(PluginError::Conflict(Text::message(
            E_NOT_A_MENTION,
            vec![Arg::text(A_MENTION, mention)],
        )));
    }
    // La parola resta quella che si leggeva: si collega, non si riscrive. Il
    // riferimento è il più corto che porta davvero alla nota, e se la parola
    // è scritta altrimenti (un alias) resta come testo del link.
    let reference = crate::formats::link_reference(host, &target)?;
    let link = crate::formats::link_text(
        host,
        &doc,
        &crate::formats::wikilink(&reference, Some(mention), false),
    )?;
    let request = EditRequest::new(
        expected,
        vec![TextEdit::replace(Span::new(start, end), link)],
    );
    let about = |key: &str| {
        Text::message(
            key,
            vec![
                Arg::text(A_MENTION, mention),
                Arg::text(A_DOC, doc.as_str()),
            ],
        )
    };
    if mode.is_dry_run() {
        return Ok(
            CommandOutcome::done().with_effect(CommandEffect::Plan(CommandPlan::of_edits(
                about(P_LINK),
                vec![PlannedEdit::new(doc, request)],
            ))),
        );
    }
    let report = host.apply_edit(&doc, request)?;
    let undo = Undo::of_edits(
        about(U_LINK),
        vec![PlannedEdit::new(doc.clone(), report.inverse())],
    );
    Ok(CommandOutcome::notify(about(N_LINKED)).undoable(undo))
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::command::UndoStep;
    use fub_abi::format::ParseContext;
    use fub_abi::model::DocId;
    use fub_abi::traits::{VaultRead, VaultWrite};
    use fub_abi::FormatProvider;
    use fub_sdk::testing::MemoryHost;

    fn prose(source: &str) -> Prose {
        let model = fub_format_markdown::MarkdownProvider::new()
            .parse(&source.into(), &ParseContext::obsidian("nota.md"))
            .expect("si legge");
        Prose::of(&model, source)
    }

    fn found(source: &str, name: &str) -> Vec<String> {
        let prose = prose(source);
        prose
            .mentions(source, name)
            .map(|(start, end)| format!("{start}:{}", &source[start..end]))
            .collect()
    }

    /// IMP-102: il testo dentro un collegamento non è una menzione, né il
    /// percorso né l'alias; quello fuori sì.
    #[test]
    fn the_text_inside_a_link_is_not_a_mention() {
        let source = "Collegamenti: [[Progetti/Alpha|Alfa]] e Alfa, poi [Alpha](Alpha.md).\n";
        assert_eq!(found(source, "Alfa"), ["40:Alfa"]);
        assert!(found(source, "Alpha").is_empty());
    }

    /// IMP-104: una menzione già convertita non lo è più, e non si riconverte.
    #[test]
    fn a_converted_mention_is_no_longer_a_mention() {
        assert_eq!(found("vedi index qui\n", "index"), ["5:index"]);
        assert!(found("vedi [[index]] qui\n", "index").is_empty());
        assert!(found("vedi [[index|index]] qui\n", "index").is_empty());
    }

    /// IMP-105: il codice, in linea o recintato, non è prosa.
    #[test]
    fn the_text_inside_code_is_not_a_mention() {
        let source =
            "# La pagina è `_index`\n\nUn `` doppio `index` `` e index.\n\n```\nindex\n```\n";
        let at = source.rfind("index.").unwrap();
        assert_eq!(found(source, "index"), [format!("{at}:index")]);
        // Un apice senza chiusura è testo, e la parola dopo resta prosa.
        assert_eq!(found("un ` solo e index\n", "index"), ["12:index"]);
        // Un apice scritto con la barra non apre il codice.
        assert_eq!(found("\\`index`\n", "index"), ["2:index"]);
    }

    /// Una parola dentro un'altra non è una menzione; frontmatter, tag e
    /// formule nemmeno.
    #[test]
    fn a_mention_is_a_whole_word_in_the_body() {
        assert!(found("reindexing\n", "index").is_empty());
        assert_eq!(
            found("l'index, e (index)\n", "index"),
            ["2:index", "12:index"]
        );
        let source = "---\naliases: [Alfa]\n---\n#Alfa e $Alfa$ e Alfa\n";
        let at = source.rfind("Alfa").unwrap();
        assert_eq!(found(source, "Alfa"), [format!("{at}:Alfa")]);
    }

    /// Le liste, le citazioni e le tabelle sono prosa.
    #[test]
    fn lists_quotes_and_tables_are_prose() {
        let source = "- Alpha\n\n> Alpha\n\n| a |\n|---|\n| Alpha |\n";
        assert_eq!(found(source, "Alpha").len(), 3);
    }

    fn note(source: &str) -> MemoryHost {
        let model = fub_format_markdown::MarkdownProvider::new()
            .parse(&source.into(), &ParseContext::obsidian("nota.md"))
            .expect("si legge");
        MemoryHost::new()
            .with_document("nota.md", source)
            .with_model("nota.md", model)
    }

    fn revision(host: &MemoryHost) -> String {
        host.document_revision(&DocId::new("nota.md"))
            .expect("revisione")
            .as_str()
            .to_string()
    }

    fn link(
        host: &mut MemoryHost,
        mention: &str,
        start: usize,
        revision: &str,
        mode: InvokeMode,
    ) -> Result<CommandOutcome, PluginError> {
        MentionCommands.invoke(
            MENTION_LINK,
            serde_json::json!({
                A_DOC: "nota.md",
                A_TARGET: "people/Rossi.md",
                A_MENTION: mention,
                A_START: start,
                A_END: start + mention.len(),
                A_REVISION: revision,
            }),
            mode,
            host,
        )
    }

    fn source(host: &MemoryHost) -> String {
        host.read_document(&DocId::new("nota.md"))
            .expect("si legge")
    }

    /// IMP-104 (b): la conversione scrive il link e dichiara l'inverso, e un
    /// passo solo la disfa, byte per byte. In prova a vuoto non scrive.
    #[test]
    fn linking_a_mention_is_one_undoable_edit() {
        let before = "si parla di Mario Rossi qui";
        let mut host = note(before);
        let read = revision(&host);
        let plan = link(&mut host, "Mario Rossi", 12, &read, InvokeMode::DryRun).expect("piano");
        assert!(matches!(plan.effect, CommandEffect::Plan(_)));
        assert_eq!(source(&host), before);

        let outcome =
            link(&mut host, "Mario Rossi", 12, &read, InvokeMode::Apply).expect("collega");
        // Senza chi risolve, il percorso intero; la parola resta quella letta.
        assert_eq!(
            source(&host),
            "si parla di [[people/Rossi.md|Mario Rossi]] qui"
        );
        let undo = outcome.undo.expect("si annulla");
        let [UndoStep::Edit(step)] = undo.steps.as_slice() else {
            panic!("un passo solo: {:?}", undo.steps);
        };
        host.apply_edit(&step.doc, step.edit.clone())
            .expect("annulla");
        assert_eq!(source(&host), before);
    }

    /// IMP-104 (a), IMP-105: un testo già collegato, nel codice o a metà di
    /// una parola non si collega; il comando rifiuta e la nota resta com'era.
    #[test]
    fn a_link_or_code_is_never_linked_again() {
        for (text, at) in [
            ("vedi [[index]] qui", 7),
            ("vedi [[index|index]] qui", 13),
            ("vedi `_index` qui", 7),
            ("reindex qui", 2),
        ] {
            let mut host = note(text);
            let read = revision(&host);
            let err = link(&mut host, "index", at, &read, InvokeMode::Apply).expect_err(text);
            assert!(matches!(err, PluginError::Conflict(_)), "{text}: {err:?}");
            assert_eq!(source(&host), text);
        }
    }

    /// Una revisione che non è più quella, o un testo che non è più lì: niente
    /// si scrive.
    #[test]
    fn a_changed_note_is_not_written() {
        let mut host = note("vedi index qui");
        let read = revision(&host);
        let stale = link(&mut host, "index", 5, "vecchia", InvokeMode::Apply);
        assert!(matches!(stale, Err(PluginError::Conflict(_))));
        let moved = link(&mut host, "index", 4, &read, InvokeMode::Apply);
        assert!(matches!(moved, Err(PluginError::Conflict(_))));
        assert_eq!(source(&host), "vedi index qui");
    }
}
