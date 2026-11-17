//! Test di «Sposta in…» sul doppio dell'host, coi modelli del provider
//! Markdown vero: le due scritture insieme, i conflitti, i link che seguono.

use super::*;

use fub_abi::format::ParseContext;
use fub_abi::traits::{VaultRead, VaultWrite};
use fub_abi::FormatProvider;
use fub_sdk::testing::MemoryHost;
use serde_json::json;

fn model(doc: &str, source: &str) -> DocumentModel {
    fub_format_markdown::MarkdownProvider::new()
        .parse(&source.into(), &ParseContext::obsidian(doc))
        .expect("si legge")
}

/// Un vault di note col loro modello vero.
fn vault(notes: &[(&str, &str)]) -> MemoryHost {
    notes.iter().fold(MemoryHost::new(), |host, (doc, source)| {
        host.with_document(doc, source)
            .with_model(doc, model(doc, source))
    })
}

fn text(host: &MemoryHost, doc: &str) -> String {
    host.read_document(&DocId::new(doc)).unwrap()
}

/// I byte `[inizio, fine]` della prima occorrenza di `block` in `source`.
fn at(source: &str, block: &str) -> serde_json::Value {
    let start = source.find(block).expect("il blocco c'è");
    json!([start, start + block.len()])
}

fn invoke(
    host: &mut MemoryHost,
    args: serde_json::Value,
    mode: InvokeMode,
) -> Result<CommandOutcome, PluginError> {
    let spec = CoreCommands::specs()
        .into_iter()
        .find(|s| s.id == NOTES_BLOCK_MOVE)
        .expect("comando dichiarato");
    spec.validate_args(&args)?;
    CoreCommands.invoke(NOTES_BLOCK_MOVE, args, mode, host)
}

fn apply(host: &mut MemoryHost, args: serde_json::Value) -> CommandOutcome {
    invoke(host, args, InvokeMode::Apply).expect("si sposta")
}

/// Esegue l'annullamento come il kernel: i passi in ordine, ognuno sulla sua
/// base.
fn undo(host: &mut MemoryHost, outcome: &CommandOutcome) {
    let undo = outcome.undo.as_ref().expect("si annulla");
    for step in &undo.steps {
        match step {
            UndoStep::Edit(edit) => {
                host.apply_edit(&edit.doc, edit.edit.clone())
                    .expect("si rimette");
            }
            other => panic!("passo inatteso {other:?}"),
        }
    }
}

fn notify_key(outcome: &CommandOutcome) -> String {
    match outcome.notify.as_ref().expect("una frase") {
        Text::Message(message) => message.key.clone(),
        other => panic!("una frase del catalogo, arrivata {other:?}"),
    }
}

const SOURCE: &str =
    "# Riunione\n\nPrimo punto.\n\nDa spostare, con **grassetto**.\n\nUltimo punto.\n";
const DEST: &str = "# Progetto\n\nIntro.\n\n## Idee\n\nUna idea.\n\n## Fine\n\nChiusa.\n";

#[test]
fn move_block_goes_to_the_end_and_leaves_a_link() {
    let mut host = vault(&[("Riunione.md", SOURCE), ("Progetto.md", DEST)]);
    let block = "Da spostare, con **grassetto**.";
    let outcome = apply(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(SOURCE, block), "text": block, "to": "Progetto.md" }),
    );
    assert_eq!(
        text(&host, "Progetto.md"),
        format!("{DEST}\n{block}\n"),
        "in fondo, dopo una riga vuota"
    );
    assert_eq!(
        text(&host, "Riunione.md"),
        "# Riunione\n\nPrimo punto.\n\n[[Progetto]]\n\nUltimo punto.\n"
    );
    assert_eq!(notify_key(&outcome), "done.block_move.end.link");

    undo(&mut host, &outcome);
    assert_eq!(
        text(&host, "Riunione.md"),
        SOURCE,
        "l'annulla rimette la partenza"
    );
    assert_eq!(text(&host, "Progetto.md"), DEST, "e l'arrivo, in un passo");
}

#[test]
fn move_block_lands_at_the_end_of_a_section() {
    let mut host = vault(&[("Riunione.md", SOURCE), ("Progetto.md", DEST)]);
    let block = "Primo punto.";
    apply(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(SOURCE, block), "to": "Progetto.md", "heading": "idee", "leave": "none" }),
    );
    assert_eq!(
        text(&host, "Progetto.md"),
        "# Progetto\n\nIntro.\n\n## Idee\n\nUna idea.\n\nPrimo punto.\n\n## Fine\n\nChiusa.\n"
    );
    assert_eq!(
        text(&host, "Riunione.md"),
        "# Riunione\n\nDa spostare, con **grassetto**.\n\nUltimo punto.\n",
        "niente al suo posto, e nessuna riga vuota doppia"
    );
}

#[test]
fn move_block_leaving_nothing_at_the_end_of_the_note_trims_the_blank_line() {
    let mut host = vault(&[("Riunione.md", SOURCE), ("Progetto.md", DEST)]);
    let block = "Ultimo punto.";
    apply(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(SOURCE, block), "to": "Progetto.md", "leave": "none" }),
    );
    assert_eq!(
        text(&host, "Riunione.md"),
        "# Riunione\n\nPrimo punto.\n\nDa spostare, con **grassetto**.\n"
    );
}

#[test]
fn move_block_embed_gives_the_block_an_id() {
    let mut host = vault(&[("Riunione.md", SOURCE), ("Progetto.md", DEST)]);
    let block = "Primo punto.";
    apply(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(SOURCE, block), "to": "Progetto.md", "leave": "embed" }),
    );
    let dest = text(&host, "Progetto.md");
    let line = dest.lines().last().unwrap();
    let id = line
        .strip_prefix("Primo punto. ^")
        .unwrap_or_else(|| panic!("l'id in coda alla riga: {line}"));
    assert_eq!(id.len(), 6);
    assert!(
        text(&host, "Riunione.md").contains(&format!("\n![[Progetto#^{id}]]\n")),
        "la trasclusione nomina l'id nuovo: {}",
        text(&host, "Riunione.md")
    );
}

#[test]
fn move_block_keeps_its_id_and_links_follow_the_new_note() {
    let source = "Testo con id. ^abc123\n\nRimanda a [[#^abc123]] e a [[Riunione#^abc123|qui]].\n";
    let other = "Vedi [[Riunione#^abc123]] e [[Riunione]].\n";
    let mut host = vault(&[
        ("Riunione.md", source),
        ("Progetto.md", DEST),
        ("Altro.md", other),
    ])
    .with_backlink("Riunione.md", &["Altro.md"]);
    let block = "Testo con id. ^abc123";
    let outcome = apply(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(source, block), "to": "Progetto.md" }),
    );
    assert!(text(&host, "Progetto.md").ends_with("\nTesto con id. ^abc123\n"));
    assert_eq!(
        text(&host, "Riunione.md"),
        "[[Progetto#^abc123]]\n\nRimanda a [[Progetto#^abc123]] e a [[Progetto#^abc123|qui]].\n",
        "il link lasciato nomina il blocco, e i link della nota lo seguono"
    );
    assert_eq!(
        text(&host, "Altro.md"),
        "Vedi [[Progetto#^abc123]] e [[Riunione]].\n",
        "un'altra nota segue il blocco; il link alla nota resta"
    );

    undo(&mut host, &outcome);
    assert_eq!(text(&host, "Riunione.md"), source);
    assert_eq!(text(&host, "Altro.md"), other);
    assert_eq!(text(&host, "Progetto.md"), DEST);
}

#[test]
fn move_block_a_heading_takes_its_links_along() {
    let source = "## Sezione\n\nRimanda a [[#Sezione]].\n";
    let mut host = vault(&[("Riunione.md", source), ("Progetto.md", DEST)]);
    apply(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(source, "## Sezione"), "to": "Progetto.md", "leave": "none" }),
    );
    assert_eq!(
        text(&host, "Riunione.md"),
        "Rimanda a [[Progetto#Sezione]].\n"
    );
}

#[test]
fn move_block_several_blocks_move_together() {
    let mut host = vault(&[("Riunione.md", SOURCE), ("Progetto.md", DEST)]);
    let block = "Primo punto.\n\nDa spostare, con **grassetto**.";
    let error = invoke(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(SOURCE, block), "to": "Progetto.md", "leave": "embed" }),
        InvokeMode::Apply,
    )
    .unwrap_err();
    assert!(
        matches!(error, PluginError::BadArgs(_)),
        "una trasclusione è di un blocco: {error:?}"
    );
    apply(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(SOURCE, block), "to": "Progetto.md" }),
    );
    assert!(text(&host, "Progetto.md").ends_with(&format!("\n\n{block}\n")));
    assert_eq!(
        text(&host, "Riunione.md"),
        "# Riunione\n\n[[Progetto]]\n\nUltimo punto.\n"
    );
}

#[test]
fn move_block_a_list_item_keeps_its_bullet_and_joins_the_list() {
    let source = "- uno\n- [ ] due\n  - figlio\n- tre\n";
    let dest = "Lista:\n\n- a\n- b\n";
    let mut host = vault(&[("Riunione.md", source), ("Progetto.md", dest)]);
    let block = "- [ ] due\n  - figlio";
    apply(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(source, block), "to": "Progetto.md" }),
    );
    assert_eq!(
        text(&host, "Progetto.md"),
        "Lista:\n\n- a\n- b\n- [ ] due\n  - figlio\n"
    );
    assert_eq!(text(&host, "Riunione.md"), "- uno\n- [[Progetto]]\n- tre\n");
}

#[test]
fn move_block_a_nested_item_loses_its_indent() {
    let source = "- uno\n  - figlio\n    con seguito\n";
    let mut host = vault(&[("Riunione.md", source), ("Progetto.md", "")]);
    let block = "  - figlio\n    con seguito";
    apply(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(source, block), "to": "Progetto.md", "leave": "none" }),
    );
    assert_eq!(text(&host, "Progetto.md"), "- figlio\n  con seguito\n");
    assert_eq!(text(&host, "Riunione.md"), "- uno\n");
}

#[test]
fn move_block_writes_the_target_line_endings() {
    let dest = "Uno.\r\n";
    let mut host = vault(&[("Riunione.md", SOURCE), ("Progetto.md", dest)]);
    let block = "Primo punto.";
    apply(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(SOURCE, block), "to": "Progetto.md" }),
    );
    assert_eq!(text(&host, "Progetto.md"), "Uno.\r\n\r\nPrimo punto.\r\n");
}

#[test]
fn move_block_inside_the_same_note() {
    let mut host = vault(&[("Riunione.md", SOURCE)]);
    let block = "Primo punto.";
    let outcome = apply(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(SOURCE, block), "to": "Riunione.md" }),
    );
    assert_eq!(
        text(&host, "Riunione.md"),
        "# Riunione\n\nDa spostare, con **grassetto**.\n\nUltimo punto.\n\nPrimo punto.\n"
    );
    assert_eq!(notify_key(&outcome), "done.block_move.here.end");
    undo(&mut host, &outcome);
    assert_eq!(text(&host, "Riunione.md"), SOURCE);
}

#[test]
fn move_block_inside_the_same_note_under_an_earlier_heading() {
    let mut host = vault(&[("Progetto.md", DEST)]);
    // Dallo spazio comandi si scrive il titolo com'è, non il suo slug.
    apply(
        &mut host,
        json!({ "doc": "Progetto.md", "at": at(DEST, "Chiusa."), "to": "Progetto.md", "heading": "Idee" }),
    );
    assert_eq!(
        text(&host, "Progetto.md"),
        "# Progetto\n\nIntro.\n\n## Idee\n\nUna idea.\n\nChiusa.\n\n## Fine\n"
    );
}

#[test]
fn move_block_a_heading_cannot_go_under_itself() {
    let mut host = vault(&[("Progetto.md", DEST)]);
    let error = invoke(
        &mut host,
        json!({ "doc": "Progetto.md", "at": at(DEST, "## Idee\n\nUna idea."), "to": "Progetto.md", "heading": "idee" }),
        InvokeMode::Apply,
    )
    .unwrap_err();
    assert!(matches!(error, PluginError::BadArgs(_)), "{error:?}");
    assert_eq!(text(&host, "Progetto.md"), DEST);
}

#[test]
fn move_block_a_changed_source_moves_nothing() {
    let mut host = vault(&[("Riunione.md", SOURCE), ("Progetto.md", DEST)]);
    let error = invoke(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(SOURCE, "Primo punto."), "text": "Primo punto, cambiato", "to": "Progetto.md" }),
        InvokeMode::Apply,
    )
    .unwrap_err();
    assert!(matches!(error, PluginError::Conflict(_)), "{error:?}");
    assert_eq!(text(&host, "Riunione.md"), SOURCE);
    assert_eq!(text(&host, "Progetto.md"), DEST);
}

#[test]
fn move_block_a_target_changed_from_outside_is_never_overwritten() {
    let host = vault(&[("Riunione.md", SOURCE), ("Progetto.md", DEST)]);
    let request = Request {
        doc: DocId::new("Riunione.md"),
        to: DocId::new("Progetto.md"),
        heading: None,
        leave: Leave::Link,
    };
    let from = read(&host, &request.doc).unwrap();
    let start = SOURCE.find("Primo punto.").unwrap();
    let planned = plan_move(&host, &request, from, (start, start + "Primo punto.".len())).unwrap();
    // Fra il piano e la scrittura qualcuno scrive l'arrivo.
    let changed = format!("{DEST}Scritto da fuori.\n");
    let mut host = host.with_document("Progetto.md", &changed);
    let failure = planned.plan.apply(&mut host).unwrap_err();
    assert!(matches!(
        PluginError::from(failure),
        PluginError::Conflict(_)
    ));
    assert_eq!(
        text(&host, "Progetto.md"),
        changed,
        "l'arrivo resta quello di fuori"
    );
    assert_eq!(
        text(&host, "Riunione.md"),
        SOURCE,
        "e la partenza non si tocca"
    );
}

#[test]
fn move_block_dry_run_writes_nothing() {
    let mut host = vault(&[("Riunione.md", SOURCE), ("Progetto.md", DEST)]);
    let outcome = invoke(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(SOURCE, "Primo punto."), "to": "Progetto.md" }),
        InvokeMode::DryRun,
    )
    .unwrap();
    let CommandEffect::Plan(plan) = outcome.effect else {
        panic!("un piano atteso")
    };
    assert_eq!(plan.edits.len(), 2, "due note, due modifiche");
    assert_eq!(text(&host, "Riunione.md"), SOURCE);
    assert_eq!(text(&host, "Progetto.md"), DEST);
}

#[test]
fn move_block_from_the_palette_takes_the_block_at_the_caret() {
    let mut host = vault(&[("Riunione.md", SOURCE), ("Progetto.md", DEST)]);
    host.set_active(Some("Riunione.md"));
    host.set_caret(Some(SOURCE.find("Primo").unwrap() + 3));
    apply(&mut host, json!({ "to": "Progetto.md", "leave": "none" }));
    assert!(text(&host, "Progetto.md").ends_with("\n\nPrimo punto.\n"));
    host.set_caret(None);
    let error = invoke(&mut host, json!({ "to": "Progetto.md" }), InvokeMode::Apply).unwrap_err();
    assert!(
        matches!(error, PluginError::BadArgs(_)),
        "buffer sporco: {error:?}"
    );
}

#[test]
fn move_block_refuses_a_range_that_is_not_whole_lines() {
    let mut host = vault(&[("Riunione.md", SOURCE), ("Progetto.md", DEST)]);
    let start = SOURCE.find("punto").unwrap();
    let error = invoke(
        &mut host,
        json!({ "doc": "Riunione.md", "at": [start, start + 5], "to": "Progetto.md" }),
        InvokeMode::Apply,
    )
    .unwrap_err();
    assert!(matches!(error, PluginError::BadArgs(_)), "{error:?}");
}

#[test]
fn move_block_rules_on_text() {
    assert_eq!(line_range("a\nbc\n", 2, 5), Some((2, 4)));
    assert_eq!(line_range("a\nbc\n", 3, 5), None);
    assert_eq!(item_prefix("  1. [ ] x"), Some("  1. "));
    assert_eq!(item_prefix("-x"), None);
    assert_eq!(insertion("", 0, "x"), "x\n");
    assert_eq!(insertion("a", 1, "x"), "\n\nx\n");
    assert_eq!(insertion("a\n\n", 3, "x"), "x\n");
    assert_eq!(insertion("a\n\n# b\n", 3, "x"), "x\n\n");
    assert_eq!(
        with_id("- a\n  b\n  - c", "id0001", IdPlace::Item),
        "- a\n  b ^id0001\n  - c"
    );
    assert_eq!(
        with_id("```\nx\n```", "id0001", IdPlace::OwnLine),
        "```\nx\n```\n\n^id0001"
    );
}
