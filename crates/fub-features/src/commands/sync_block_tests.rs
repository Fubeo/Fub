//! Test del blocco sincronizzato sul doppio dell'host, coi modelli del
//! provider Markdown vero: l'id e la trasclusione insieme, i conflitti, l'id
//! che c'è già, l'id soltanto.

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

fn vault(notes: &[(&str, &str)]) -> MemoryHost {
    notes.iter().fold(MemoryHost::new(), |host, (doc, source)| {
        host.with_document(doc, source)
            .with_model(doc, model(doc, source))
    })
}

fn text(host: &MemoryHost, doc: &str) -> String {
    host.read_document(&DocId::new(doc)).unwrap()
}

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
        .find(|s| s.id == NOTES_BLOCK_SYNC)
        .expect("comando dichiarato");
    spec.validate_args(&args)?;
    CoreCommands.invoke(NOTES_BLOCK_SYNC, args, mode, host)
}

fn apply(host: &mut MemoryHost, args: serde_json::Value) -> CommandOutcome {
    invoke(host, args, InvokeMode::Apply).expect("si sincronizza")
}

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

/// Il doppio dell'host dà sempre gli stessi byte a caso: l'id che ne viene.
fn the_fresh_id(host: &MemoryHost, sources: &[&str]) -> String {
    super::super::move_block::fresh_id(host, sources).expect("un id")
}

const SOURCE: &str = "# Riunione\n\nPrimo punto.\n\nDa tenere uguale, con **grassetto**.\n\n- Una voce\n  - figlia\n\n```\ncodice\n```\n";
const DEST: &str = "# Progetto\n\nIntro.\n";

#[test]
fn sync_gives_the_id_and_writes_the_embed_at_the_end_then_one_undo_puts_both_back() {
    // Il doppio tira gli stessi byte in ogni vault nuovo: l'id è il primo.
    let id = the_fresh_id(&vault(&[]), &[SOURCE, DEST]);
    let mut host = vault(&[("Riunione.md", SOURCE), ("Progetto.md", DEST)]);
    let block = "Da tenere uguale, con **grassetto**.";
    let outcome = apply(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(SOURCE, block), "text": block, "to": "Progetto.md" }),
    );
    assert_eq!(
        text(&host, "Riunione.md"),
        SOURCE.replace(block, &format!("{block} ^{id}")),
        "l'id in coda al paragrafo, il resto com'era"
    );
    assert_eq!(
        text(&host, "Progetto.md"),
        format!("{DEST}\n![[Riunione#^{id}]]\n"),
        "la trasclusione in fondo, dopo una riga vuota"
    );
    assert_eq!(notify_key(&outcome), sync_block::D_BLOCK_SYNC);

    undo(&mut host, &outcome);
    assert_eq!(text(&host, "Riunione.md"), SOURCE, "l'annulla toglie l'id");
    assert_eq!(text(&host, "Progetto.md"), DEST, "e la trasclusione");
}

#[test]
fn an_id_that_is_already_there_is_kept_and_only_the_target_is_written() {
    let source = "# Riunione\n\nGià segnato. ^abc123\n";
    let mut host = vault(&[("Riunione.md", source), ("Progetto.md", DEST)]);
    let block = "Già segnato. ^abc123";
    let outcome = apply(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(source, block), "text": block, "to": "Progetto.md" }),
    );
    assert_eq!(text(&host, "Riunione.md"), source);
    assert_eq!(
        text(&host, "Progetto.md"),
        format!("{DEST}\n![[Riunione#^abc123]]\n")
    );
    let undo = outcome.undo.expect("si annulla");
    assert_eq!(undo.steps.len(), 1, "una nota sola da rimettere");
}

#[test]
fn the_same_id_in_the_target_note_is_not_reused() {
    // L'id che esiste già in un'altra nota: quella d'arrivo ha un suo `^…`
    // che il generatore darebbe per primo; il blocco ne riceve un altro.
    let host = vault(&[("Riunione.md", SOURCE), ("Progetto.md", DEST)]);
    let first = the_fresh_id(&host, &[SOURCE, DEST]);
    let dest = format!("# Progetto\n\nSuo. ^{first}\n");
    let mut host = vault(&[("Riunione.md", SOURCE), ("Progetto.md", &dest)]);
    let block = "Primo punto.";
    apply(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(SOURCE, block), "text": block, "to": "Progetto.md" }),
    );
    let written = text(&host, "Riunione.md");
    assert!(!written.contains(&format!("^{first}")), "{written}");
    assert!(written.contains("Primo punto. ^"), "{written}");
}

#[test]
fn an_item_takes_the_id_before_its_children_and_a_fence_on_its_own_line() {
    let mut host = vault(&[("Riunione.md", SOURCE), ("Progetto.md", DEST)]);
    let item = "- Una voce\n  - figlia";
    apply(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(SOURCE, item), "text": item, "id": "voce" }),
    );
    assert_eq!(
        text(&host, "Riunione.md"),
        SOURCE.replace(item, "- Una voce ^voce\n  - figlia")
    );

    let mut host = vault(&[("Riunione.md", SOURCE), ("Progetto.md", DEST)]);
    let fence = "```\ncodice\n```";
    apply(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(SOURCE, fence), "text": fence, "id": "cod" }),
    );
    assert_eq!(
        text(&host, "Riunione.md"),
        SOURCE.replace(fence, "```\ncodice\n```\n\n^cod")
    );
}

#[test]
fn crlf_notes_keep_their_line_breaks() {
    let source = "# R\r\n\r\n| a |\r\n|---|\r\n| 1 |\r\n";
    let mut host = vault(&[("Riunione.md", source)]);
    let table = "| a |\r\n|---|\r\n| 1 |";
    apply(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(source, table), "text": table, "id": "tab" }),
    );
    assert_eq!(
        text(&host, "Riunione.md"),
        "# R\r\n\r\n| a |\r\n|---|\r\n| 1 |\r\n\r\n^tab\r\n"
    );
}

#[test]
fn without_a_target_only_the_id_is_written_with_the_one_asked() {
    let mut host = vault(&[("Riunione.md", SOURCE)]);
    let block = "Primo punto.";
    let outcome = apply(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(SOURCE, block), "text": block, "id": "^Scelto-1" }),
    );
    assert_eq!(
        text(&host, "Riunione.md"),
        SOURCE.replace(block, "Primo punto. ^Scelto-1")
    );
    assert_eq!(notify_key(&outcome), sync_block::D_BLOCK_ID);
    undo(&mut host, &outcome);
    assert_eq!(text(&host, "Riunione.md"), SOURCE);
}

#[test]
fn asking_the_id_the_block_already_has_writes_nothing() {
    let source = "Già segnato. ^abc123\n";
    let mut host = vault(&[("Riunione.md", source)]);
    let block = "Già segnato. ^abc123";
    let outcome = apply(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(source, block), "text": block, "id": "abc123" }),
    );
    assert!(outcome.undo.is_none(), "niente da annullare");
    assert!(outcome.notify.is_none());
    assert_eq!(text(&host, "Riunione.md"), source);
}

#[test]
fn a_block_with_another_id_or_an_id_taken_is_a_conflict() {
    let source = "Già segnato. ^abc123\n\nAltro. ^preso\n\nLibero.\n";
    let mut host = vault(&[("Riunione.md", source)]);
    let block = "Già segnato. ^abc123";
    let error = invoke(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(source, block), "text": block, "id": "altro" }),
        InvokeMode::Apply,
    )
    .expect_err("il blocco ha già un altro id");
    assert!(matches!(error, PluginError::Conflict(_)), "{error:?}");

    let free = "Libero.";
    let error = invoke(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(source, free), "text": free, "id": "preso" }),
        InvokeMode::Apply,
    )
    .expect_err("l'id è di un altro blocco");
    assert!(matches!(error, PluginError::Conflict(_)), "{error:?}");
    assert_eq!(
        text(&host, "Riunione.md"),
        source,
        "non si è scritto niente"
    );

    let error = invoke(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(source, free), "text": free, "id": "non va" }),
        InvokeMode::Apply,
    )
    .expect_err("non è un id");
    assert!(matches!(error, PluginError::BadArgs(_)), "{error:?}");
}

#[test]
fn a_block_whose_note_changed_writes_nothing() {
    let mut host = vault(&[("Riunione.md", SOURCE), ("Progetto.md", DEST)]);
    let error = invoke(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(SOURCE, "Primo punto."), "text": "Un altro testo", "to": "Progetto.md" }),
        InvokeMode::Apply,
    )
    .expect_err("il testo letto non c'è più");
    assert!(matches!(error, PluginError::Conflict(_)), "{error:?}");
    assert_eq!(text(&host, "Riunione.md"), SOURCE);
    assert_eq!(text(&host, "Progetto.md"), DEST);
}

#[test]
fn the_same_note_or_more_blocks_are_refused() {
    let mut host = vault(&[("Riunione.md", SOURCE)]);
    let error = invoke(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(SOURCE, "Primo punto."), "to": "Riunione.md" }),
        InvokeMode::Apply,
    )
    .expect_err("la stessa nota");
    assert!(matches!(error, PluginError::BadArgs(_)), "{error:?}");

    let two = "Primo punto.\n\nDa tenere uguale, con **grassetto**.";
    let error = invoke(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(SOURCE, two), "text": two, "id": "due" }),
        InvokeMode::Apply,
    )
    .expect_err("due blocchi");
    assert!(matches!(error, PluginError::BadArgs(_)), "{error:?}");
    assert_eq!(text(&host, "Riunione.md"), SOURCE);
}

#[test]
fn the_dry_run_shows_the_plan_and_writes_nothing() {
    let mut host = vault(&[("Riunione.md", SOURCE), ("Progetto.md", DEST)]);
    let block = "Primo punto.";
    let outcome = invoke(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(SOURCE, block), "text": block, "to": "Progetto.md" }),
        InvokeMode::DryRun,
    )
    .expect("si simula");
    let CommandEffect::Plan(plan) = outcome.effect else {
        panic!("un piano");
    };
    assert_eq!(plan.edits.len(), 2, "le due note");
    assert_eq!(text(&host, "Riunione.md"), SOURCE);
    assert_eq!(text(&host, "Progetto.md"), DEST);
}

#[test]
fn a_fence_with_its_id_on_a_line_of_its_own_keeps_it() {
    // Il blocco come lo prendono i Blocchi del client: il recinto e la riga
    // del suo `^id`, che il modello attacca al blocco.
    let source = "# R\n\n```\ncodice\n```\n\n^cod\n\nDopo.\n";
    let mut host = vault(&[("Riunione.md", source), ("Progetto.md", DEST)]);
    let block = "```\ncodice\n```\n\n^cod";
    apply(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(source, block), "text": block, "to": "Progetto.md", "id": "cod" }),
    );
    assert_eq!(text(&host, "Riunione.md"), source);
    assert_eq!(
        text(&host, "Progetto.md"),
        format!("{DEST}\n![[Riunione#^cod]]\n")
    );
}

/// **L'id chiesto si confronta come il kernel confronta le ancore.** Si
/// confrontava alla lettera: `Preso` passava accanto a `^preso` e la nota si
/// trovava con due blocchi dallo stesso id.
#[test]
fn an_id_taken_in_another_case_is_a_conflict() {
    let source = "Altro. ^preso\n\nLibero.\n";
    let mut host = vault(&[("Riunione.md", source)]);
    let free = "Libero.";
    let error = invoke(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(source, free), "text": free, "id": "Preso" }),
        InvokeMode::Apply,
    )
    .expect_err("l'id è di un altro blocco, in un'altra forma");
    assert!(matches!(error, PluginError::Conflict(_)), "{error:?}");
    assert_eq!(text(&host, "Riunione.md"), source);
}

/// **Gli id validi sono quelli del contratto** (`valid_anchor`): anche `_` e
/// le lettere non ASCII. E `^ab_c` non prende `ab`: il segno arriva fino in
/// fondo all'id.
#[test]
fn ids_follow_the_contract_rule_underscore_and_unicode_included() {
    let source = "Altro. ^ab_c\n\nLibero.\n\nAncora.\n";
    let mut host = vault(&[("Riunione.md", source)]);
    let free = "Libero.";
    apply(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(source, free), "text": free, "id": "ab" }),
    );
    let after = text(&host, "Riunione.md");
    assert_eq!(after, source.replace(free, "Libero. ^ab"));

    let other = "Ancora.";
    let mut host = vault(&[("Riunione.md", after.as_str())]);
    apply(
        &mut host,
        json!({ "doc": "Riunione.md", "at": at(&after, other), "text": other, "id": "città_2" }),
    );
    assert_eq!(
        text(&host, "Riunione.md"),
        after.replace(other, "Ancora. ^città_2")
    );
}
