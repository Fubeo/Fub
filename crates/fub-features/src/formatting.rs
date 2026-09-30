//! La **barra di formattazione** come `CommandProvider`: i pulsanti con cui si
//! scrive il Markdown senza ricordarne la sintassi.
//!
//! # Chi fa cosa
//!
//! Il plugin dichiara la barra: **quali** pulsanti ci sono, in **che ordine**,
//! come si chiamano e cosa fanno, in ogni lingua del suo catalogo. Ogni
//! pulsante è un comando offerto in [`CommandSurface::Toolbar`], quindi sta
//! anche nella palette e si può legare a una scorciatoia dalle impostazioni,
//! per la stessa via di ogni altro comando. Spegnere il bundle toglie la barra
//! intera; riaccenderlo la rimette.
//!
//! La modifica del testo **non** è sua, e non potrebbe esserlo: cursore,
//! selezione e cronologia locale sono della superficie che scrive (0190), e
//! un giro sull'IPC per ogni pulsante sarebbe il costo sbagliato per mettere
//! una parola in grassetto. L'id di ogni comando è quindi un'**azione
//! dell'editor** (`markdown.bold`, `markdown.table.row.after`): la shell la
//! esegue sulla superficie del riquadro, e ne mostra lo stato — premuto dove
//! il cursore è già in grassetto, spento fuori da una tabella.
//!
//! Invocato dalla palette o da una scorciatoia, il comando risponde con
//! l'intento [`EDITOR_ACTION_NS`], che la shell esegue sulla superficie col
//! fuoco. È un intento privilegiato: soltanto il core chiede alla shell di
//! scrivere nella nota aperta, ed è anche il solo che nomina un id senza
//! namespace, cioè un'azione dell'editor.
//!
//! # Perché non dichiara accordi
//!
//! Le scorciatoie di queste azioni sono della keymap del profilo Markdown
//! (`Mod-b` è il grassetto dentro l'editor, dove l'editor vince). Dichiararle
//! anche qui le metterebbe due volte nel registro dei tasti; la barra le mostra
//! nel suggerimento, leggendole dalla superficie.

use fub_abi::command::{
    CommandEffect, CommandOutcome, CommandScope, CommandSpec, CommandSurface, InvokeMode,
};
use fub_abi::error::PluginError;
use fub_abi::text::{StringCatalog, Text};
use fub_abi::traits::{CommandProvider, HostApi};
use fub_abi::ui::EDITOR_ACTION_NS;

/// L'id del componente.
pub const FORMATTING_ID: &str = "fub.formatting";

/// Un pulsante: l'id dell'azione dell'editor, poi titolo e descrizione in
/// italiano e in inglese.
type Button = [&'static str; 5];

/// La barra, nell'ordine in cui la shell la disegna. I gruppi e i menu a
/// tendina li decide chi disegna, a partire dalle azioni: qui c'è la scelta di
/// cosa offrire e in che sequenza.
const BUTTONS: &[Button] = &[
    // La cronologia della superficie.
    [
        "text.undo",
        "Annulla modifica",
        "Annulla l'ultima modifica del testo in questo riquadro.",
        "Undo edit",
        "Undoes the last text edit in this pane.",
    ],
    [
        "text.redo",
        "Ripeti modifica",
        "Ripete la modifica del testo appena annullata.",
        "Redo edit",
        "Redoes the text edit that was just undone.",
    ],
    // Il tipo di paragrafo.
    [
        "markdown.paragraph",
        "Testo normale",
        "Toglie il titolo dalle righe selezionate.",
        "Normal text",
        "Turns the selected headings back into plain lines.",
    ],
    [
        "markdown.heading.1",
        "Titolo 1",
        "Fa delle righe selezionate un titolo di primo livello.",
        "Heading 1",
        "Turns the selected lines into a first-level heading.",
    ],
    [
        "markdown.heading.2",
        "Titolo 2",
        "Fa delle righe selezionate un titolo di secondo livello.",
        "Heading 2",
        "Turns the selected lines into a second-level heading.",
    ],
    [
        "markdown.heading.3",
        "Titolo 3",
        "Fa delle righe selezionate un titolo di terzo livello.",
        "Heading 3",
        "Turns the selected lines into a third-level heading.",
    ],
    [
        "markdown.heading.4",
        "Titolo 4",
        "Fa delle righe selezionate un titolo di quarto livello.",
        "Heading 4",
        "Turns the selected lines into a fourth-level heading.",
    ],
    [
        "markdown.heading.5",
        "Titolo 5",
        "Fa delle righe selezionate un titolo di quinto livello.",
        "Heading 5",
        "Turns the selected lines into a fifth-level heading.",
    ],
    [
        "markdown.heading.6",
        "Titolo 6",
        "Fa delle righe selezionate un titolo di sesto livello.",
        "Heading 6",
        "Turns the selected lines into a sixth-level heading.",
    ],
    // Il testo in riga.
    [
        "markdown.bold",
        "Grassetto",
        "Mette o toglie il grassetto sulla selezione o sulla parola.",
        "Bold",
        "Adds or removes bold on the selection or the word.",
    ],
    [
        "markdown.italic",
        "Corsivo",
        "Mette o toglie il corsivo sulla selezione o sulla parola.",
        "Italic",
        "Adds or removes italic on the selection or the word.",
    ],
    [
        "markdown.strikethrough",
        "Barrato",
        "Barra o toglie la barratura dalla selezione o dalla parola.",
        "Strikethrough",
        "Adds or removes strikethrough on the selection or the word.",
    ],
    [
        "markdown.highlight",
        "Evidenziato",
        "Evidenzia la selezione con `==`, o toglie l'evidenziatura.",
        "Highlight",
        "Highlights the selection with `==`, or removes the highlight.",
    ],
    [
        "markdown.code",
        "Codice in riga",
        "Scrive la selezione come codice in riga, o la riporta a testo.",
        "Inline code",
        "Marks the selection as inline code, or turns it back into text.",
    ],
    [
        "markdown.math",
        "Formula in riga",
        "Scrive la selezione come formula `$…$`, o la riporta a testo.",
        "Inline math",
        "Marks the selection as a `$…$` formula, or turns it back into text.",
    ],
    [
        "markdown.comment",
        "Commento",
        "Nasconde la selezione dalla resa con `%%`, o la rende di nuovo visibile.",
        "Comment",
        "Hides the selection from the rendering with `%%`, or shows it again.",
    ],
    [
        "markdown.clear",
        "Cancella formattazione",
        "Toglie grassetto, corsivo, barrato, evidenziato e codice dalla selezione.",
        "Clear formatting",
        "Removes bold, italic, strikethrough, highlight and code from the selection.",
    ],
    // Collegamenti e rimandi.
    [
        "markdown.link",
        "Link",
        "Fa della selezione un link, o toglie il link lasciandone il testo.",
        "Link",
        "Turns the selection into a link, or removes the link and keeps its text.",
    ],
    [
        "markdown.wikilink",
        "Link a una nota",
        "Fa della selezione un collegamento `[[…]]` a un'altra nota.",
        "Link to a note",
        "Turns the selection into a `[[…]]` link to another note.",
    ],
    [
        "markdown.image",
        "Immagine",
        "Inserisce un'immagine, con la selezione come testo alternativo.",
        "Image",
        "Inserts an image, with the selection as its alternative text.",
    ],
    [
        "markdown.footnote",
        "Nota a piè di pagina",
        "Inserisce un richiamo numerato e ne scrive la nota in fondo.",
        "Footnote",
        "Inserts a numbered reference and writes its note at the end.",
    ],
    // Liste.
    [
        "markdown.list.bullet",
        "Elenco puntato",
        "Fa delle righe selezionate un elenco puntato, o lo toglie.",
        "Bulleted list",
        "Turns the selected lines into a bulleted list, or removes it.",
    ],
    [
        "markdown.list.ordered",
        "Elenco numerato",
        "Fa delle righe selezionate un elenco numerato, o lo toglie.",
        "Numbered list",
        "Turns the selected lines into a numbered list, or removes it.",
    ],
    [
        "markdown.list.task",
        "Elenco di attività",
        "Fa delle righe selezionate attività da spuntare, o le riporta a voci.",
        "Task list",
        "Turns the selected lines into tasks to check, or back into items.",
    ],
    [
        "markdown.list.indent",
        "Aumenta rientro",
        "Porta le voci selezionate un livello più in dentro.",
        "Indent",
        "Moves the selected items one level in.",
    ],
    [
        "markdown.list.dedent",
        "Riduci rientro",
        "Porta le voci selezionate un livello più in fuori.",
        "Outdent",
        "Moves the selected items one level out.",
    ],
    // Blocchi.
    [
        "markdown.quote",
        "Citazione",
        "Fa delle righe selezionate una citazione, o toglie un livello di citazione.",
        "Quote",
        "Turns the selected lines into a quote, or removes one quote level.",
    ],
    [
        "markdown.callout",
        "Riquadro",
        "Racchiude le righe selezionate in un riquadro `> [!note]`.",
        "Callout",
        "Wraps the selected lines in a `> [!note]` callout.",
    ],
    [
        "markdown.codeblock",
        "Blocco di codice",
        "Racchiude le righe selezionate in un blocco di codice, o lo toglie.",
        "Code block",
        "Wraps the selected lines in a code block, or removes it.",
    ],
    [
        "markdown.mathblock",
        "Blocco di formula",
        "Racchiude le righe selezionate fra `$$`, o toglie il blocco.",
        "Math block",
        "Wraps the selected lines between `$$`, or removes the block.",
    ],
    [
        "markdown.rule",
        "Linea di separazione",
        "Inserisce una linea orizzontale dopo la riga corrente.",
        "Horizontal rule",
        "Inserts a horizontal rule after the current line.",
    ],
    // Tabelle.
    [
        "markdown.table",
        "Inserisci tabella",
        "Inserisce una tabella, o fa una tabella delle righe separate da tabulazioni.",
        "Insert table",
        "Inserts a table, or makes one out of lines separated by tabs.",
    ],
    [
        "markdown.table.row.before",
        "Riga sopra",
        "Aggiunge una riga vuota sopra quella del cursore.",
        "Row above",
        "Adds an empty row above the cursor's row.",
    ],
    [
        "markdown.table.row.after",
        "Riga sotto",
        "Aggiunge una riga vuota sotto quella del cursore.",
        "Row below",
        "Adds an empty row below the cursor's row.",
    ],
    [
        "markdown.table.row.up",
        "Sposta riga in su",
        "Scambia la riga del cursore con quella sopra.",
        "Move row up",
        "Swaps the cursor's row with the one above.",
    ],
    [
        "markdown.table.row.down",
        "Sposta riga in giù",
        "Scambia la riga del cursore con quella sotto.",
        "Move row down",
        "Swaps the cursor's row with the one below.",
    ],
    [
        "markdown.table.row.delete",
        "Elimina riga",
        "Toglie dalla tabella le righe selezionate.",
        "Delete row",
        "Removes the selected rows from the table.",
    ],
    [
        "markdown.table.column.before",
        "Colonna a sinistra",
        "Aggiunge una colonna vuota a sinistra di quella del cursore.",
        "Column to the left",
        "Adds an empty column to the left of the cursor's column.",
    ],
    [
        "markdown.table.column.after",
        "Colonna a destra",
        "Aggiunge una colonna vuota a destra di quella del cursore.",
        "Column to the right",
        "Adds an empty column to the right of the cursor's column.",
    ],
    [
        "markdown.table.column.left",
        "Sposta colonna a sinistra",
        "Scambia la colonna del cursore con quella a sinistra.",
        "Move column left",
        "Swaps the cursor's column with the one to its left.",
    ],
    [
        "markdown.table.column.right",
        "Sposta colonna a destra",
        "Scambia la colonna del cursore con quella a destra.",
        "Move column right",
        "Swaps the cursor's column with the one to its right.",
    ],
    [
        "markdown.table.column.delete",
        "Elimina colonna",
        "Toglie dalla tabella le colonne selezionate.",
        "Delete column",
        "Removes the selected columns from the table.",
    ],
    [
        "markdown.table.sort.ascending",
        "Ordina dalla A alla Z",
        "Ordina le righe della tabella secondo la colonna del cursore.",
        "Sort A to Z",
        "Sorts the table rows by the cursor's column.",
    ],
    [
        "markdown.table.sort.descending",
        "Ordina dalla Z alla A",
        "Ordina le righe della tabella secondo la colonna del cursore, al contrario.",
        "Sort Z to A",
        "Sorts the table rows by the cursor's column, in reverse.",
    ],
];

fn title_key(id: &str) -> String {
    format!("{id}.title")
}

fn desc_key(id: &str) -> String {
    format!("{id}.desc")
}

/// Le stringhe della barra, nel componente e non nella shell: sono sue, come
/// ogni catalogo di una feature ufficiale.
pub fn catalog() -> Vec<StringCatalog> {
    let mut it = StringCatalog::new("it");
    let mut en = StringCatalog::new("en");
    for [id, it_title, it_desc, en_title, en_desc] in BUTTONS {
        it = it.with(title_key(id), *it_title);
        it = it.with(desc_key(id), *it_desc);
        en = en.with(title_key(id), *en_title);
        en = en.with(desc_key(id), *en_desc);
    }
    vec![it, en]
}

/// La barra. Senza stato: cosa sia premuto lo sa la superficie, dove sta il
/// cursore.
pub struct FormattingCommands;

impl FormattingCommands {
    /// Le spec dichiarate, per chi le vuole senza un'istanza.
    pub fn specs() -> Vec<CommandSpec> {
        BUTTONS.iter().map(|[id, ..]| spec(id)).collect()
    }
}

/// Il comando di un pulsante. Di sola lettura perché non scrive nel vault: la
/// modifica è una battuta nella nota aperta, che la sessione salva come le
/// altre.
fn spec(id: &str) -> CommandSpec {
    CommandSpec::new(id, Text::key(title_key(id)))
        .describing(Text::key(desc_key(id)))
        .with_scope(CommandScope::read_only())
        .offered_in(CommandSurface::Toolbar)
}

impl CommandProvider for FormattingCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        Self::specs()
    }

    fn invoke(
        &self,
        command: &str,
        _args: serde_json::Value,
        mode: InvokeMode,
        _host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        if !BUTTONS.iter().any(|[id, ..]| *id == command) {
            return Err(PluginError::UnknownCommand(command.to_string().into()));
        }
        // A secco non c'è niente da pianificare: nessun documento del vault
        // cambia, cambia il testo aperto, e lo cambierà la shell.
        if mode.is_dry_run() {
            return Ok(CommandOutcome::done());
        }
        Ok(CommandOutcome::done().with_effect(CommandEffect::Custom {
            ns: EDITOR_ACTION_NS.to_string(),
            payload: serde_json::json!({ "action": command }),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_sdk::testing::MemoryHost;
    use std::collections::BTreeSet;

    #[test]
    fn every_button_is_a_toolbar_command_that_writes_nothing() {
        let specs = FormattingCommands::specs();
        assert_eq!(specs.len(), BUTTONS.len());
        for spec in &specs {
            assert_eq!(spec.surfaces, [CommandSurface::Toolbar], "{}", spec.id);
            assert!(!spec.scope.writes, "{} non scrive nel vault", spec.id);
            assert!(spec.params.is_empty(), "{} non chiede niente", spec.id);
            assert!(spec.keybinding.is_none(), "{}: niente accordi", spec.id);
        }
    }

    #[test]
    fn ids_are_unique_and_without_a_namespace() {
        let ids: BTreeSet<&str> = BUTTONS.iter().map(|[id, ..]| *id).collect();
        assert_eq!(ids.len(), BUTTONS.len(), "un id ripetuto: pulsante doppio");
        for id in ids {
            // Un'azione dell'editor si nomina nuda: è ciò che solo il core può
            // registrare, e ciò che la superficie riconosce.
            assert!(!id.contains(':'), "{id}");
            assert!(
                id.starts_with("markdown.") || id.starts_with("text."),
                "{id} non è nel vocabolario delle azioni dell'editor"
            );
        }
    }

    #[test]
    fn invoking_hands_the_same_action_to_the_shell() {
        let mut host = MemoryHost::new();
        for [id, ..] in BUTTONS {
            let outcome = FormattingCommands
                .invoke(id, serde_json::Value::Null, InvokeMode::Apply, &mut host)
                .unwrap();
            let CommandEffect::Custom { ns, payload } = outcome.effect else {
                panic!("{id}: un intento per la shell")
            };
            assert_eq!(ns, EDITOR_ACTION_NS);
            assert_eq!(payload, serde_json::json!({ "action": id }));
            assert!(outcome.undo.is_none(), "annulla della cronologia locale");
        }
    }

    #[test]
    fn a_dry_run_changes_nothing_and_an_unknown_id_is_refused() {
        let mut host = MemoryHost::new();
        let outcome = FormattingCommands
            .invoke(
                "markdown.bold",
                serde_json::Value::Null,
                InvokeMode::DryRun,
                &mut host,
            )
            .unwrap();
        assert!(matches!(outcome.effect, CommandEffect::Done));
        let err = FormattingCommands
            .invoke(
                "markdown.nope",
                serde_json::Value::Null,
                InvokeMode::Apply,
                &mut host,
            )
            .unwrap_err();
        assert!(matches!(err, PluginError::UnknownCommand(_)), "{err:?}");
    }
}
