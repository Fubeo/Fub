//! `CoreCommands`: le spec dei comandi ufficiali e il `CommandProvider` che
//! le smista alle funzioni dei singoli comandi.

use super::*;

/// I comandi ufficiali. Senza stato: tutto ciò che gli serve lo chiede
/// all'host, come farebbe un plugin.
#[derive(Default)]
pub struct CoreCommands;

impl CoreCommands {
    /// Le spec, anche fuori dal trait: chi disegna una palette nei test le
    /// legge senza montare un workspace.
    pub fn specs() -> Vec<CommandSpec> {
        vec![
            // Senza accordo, e non per distrazione: `Mod-Shift-f` è della shell,
            // che con quel tasto porta il pannello della ricerca sotto gli occhi
            // — la cosa che fa Obsidian e che le dita hanno già imparato. Questo
            // comando vuole una `query` **obbligatoria**: premere un tasto per
            // farsi aprire un modulo da compilare è il gesto sbagliato, mentre
            // dalla palette — che i parametri li sa chiedere — è esattamente il
            // gesto giusto. Il perché sta nella 0081.
            command(SEARCH_OPEN)
                .with_param(parameter(SEARCH_OPEN, "query", ParamKind::Text).required()),
            // Nel menu `/` soltanto con una selezione: è lei che diventa il link.
            command(SELECTION_WIKILINK)
                .offered_in(CommandSurface::SlashSelection)
                .with_scope(CommandScope::writing(CommandReach::Document)),
            // Nel menu `/` con una selezione, che riempie `find`.
            command(VAULT_REPLACE)
                .offered_in(CommandSurface::SlashSelection)
                .with_param(parameter(VAULT_REPLACE, "find", ParamKind::Text).required())
                .with_param(parameter(VAULT_REPLACE, "replace", ParamKind::Text).required())
                .with_param(parameter(VAULT_REPLACE, "whole_word", ParamKind::Bool))
                .with_param(parameter(VAULT_REPLACE, "docs", ParamKind::Documents))
                .with_scope(CommandScope::writing(CommandReach::Documents)),
            // --- strutturali (decisione 0013) ---------------------------------------
            command(NOTES_CREATE)
                .with_param(parameter(NOTES_CREATE, "name", ParamKind::Text))
                .with_param(parameter(NOTES_CREATE, "properties", ParamKind::Text))
                .with_param(parameter(NOTES_CREATE, "folder", ParamKind::Text))
                // Una nota sola, e il cestino la rende reversibile.
                .with_scope(CommandScope::writing(CommandReach::Document)),
            command(NOTES_DUPLICATE)
                .with_param(parameter(NOTES_DUPLICATE, "doc", ParamKind::Document).required())
                .with_param(parameter(NOTES_DUPLICATE, "folder", ParamKind::Text))
                .with_scope(CommandScope::writing(CommandReach::Document)),
            command(NOTES_RENAME)
                .with_param(parameter(NOTES_RENAME, "doc", ParamKind::Document).required())
                .with_param(parameter(NOTES_RENAME, "to", ParamKind::Text).required())
                // `Documents` e non `Document`: una rinomina riscrive anche
                // ogni nota che linkava la vecchia. Dichiarare `Document`
                // sarebbe la bugia che il piano del dry-run smaschera.
                .with_scope(CommandScope::writing(CommandReach::Documents)),
            command(NOTES_TRASH)
                .with_param(parameter(NOTES_TRASH, "doc", ParamKind::Document))
                // Reversibile, e non per ottimismo: la reversibilità è
                // `trash.restore`, che sta in questo stesso registro.
                .with_scope(CommandScope::writing(CommandReach::Document)),
            command(TRASH_RESTORE)
                .with_param(parameter(TRASH_RESTORE, "entry", ParamKind::Text).required())
                .with_param(parameter(TRASH_RESTORE, "to", ParamKind::Text))
                .with_scope(CommandScope::writing(CommandReach::Document)),
            command(TRASH_EMPTY)
                .with_scope(CommandScope::writing(CommandReach::Vault).irreversible()),
            command(VAULT_ARCHIVE)
                .with_param(parameter(VAULT_ARCHIVE, "docs", ParamKind::Documents).required())
                .with_param(parameter(VAULT_ARCHIVE, "folder", ParamKind::Text))
                .with_scope(CommandScope::writing(CommandReach::Documents)),
            // Una cartella è le sue voci: si spostano e si cestinano una alla
            // volta coi verbi di una nota sola, e il raggio è quello di una
            // rinomina — le voci e chi le linka.
            command(FOLDER_RENAME)
                .with_param(parameter(FOLDER_RENAME, "folder", ParamKind::Text).required())
                .with_param(parameter(FOLDER_RENAME, "to", ParamKind::Text).required())
                .with_scope(CommandScope::writing(CommandReach::Documents)),
            command(FOLDER_TRASH)
                .with_param(parameter(FOLDER_TRASH, "folder", ParamKind::Text).required())
                .with_scope(CommandScope::writing(CommandReach::Documents)),
            // Una rinomina: riscrive anche chi linkava la nota.
            command(NOTES_FOLDER_PAGE)
                .with_param(parameter(NOTES_FOLDER_PAGE, "doc", ParamKind::Document))
                .with_scope(CommandScope::writing(CommandReach::Documents)),
            // Una rinomina, se serve, e una creazione.
            command(NOTES_SUBPAGE)
                .offered_in(CommandSurface::Slash)
                .with_param(parameter(NOTES_SUBPAGE, "doc", ParamKind::Document))
                .with_param(parameter(NOTES_SUBPAGE, "name", ParamKind::Text).required())
                .with_scope(CommandScope::writing(CommandReach::Documents)),
            // Nessuna scorciatoia, e in particolare **non** `Mod-Enter`:
            // quella la tiene l'editor, che spunta le todo delle righe
            // selezionate nel **buffer** tramite i comandi Markdown dell'editor.
            // Sono due gesti su due oggetti diversi — il buffer e il file — e dare a
            // entrambi la stessa combinazione vorrebbe dire che l'accordo
            // fa due cose a seconda di chi vince la corsa. Chi la invoca
            // oggi è chi ha una posizione da dare: la palette, un altro
            // comando, un plugin.
            command(NOTES_TASK_TOGGLE)
                .offered_in(CommandSurface::Slash)
                .with_param(parameter(NOTES_TASK_TOGGLE, "doc", ParamKind::Document))
                .with_param(parameter(NOTES_TASK_TOGGLE, "at", ParamKind::Numbers))
                .with_scope(CommandScope::writing(CommandReach::Document)),
            // --- le impostazioni (§11.1) --------------------------------
            //
            // Sono comandi e non codice dell'app per la ragione della
            // decisione 0009 letta al contrario: import, export e reset sono
            // esattamente le tre azioni che ogni app finisce per cablare in un
            // pulsante, e cablarle vorrebbe dire che una CLI (27.1), una macro
            // (16.2) e un centro di comando (22.4) non le hanno.
            //
            // Il **raggio** è `CommandReach::Settings`, che era vocabolario
            // senza clienti dalla decisione 0010: questi sono i suoi primi
            // quattro, e chi invoca sa da lì che sta per toccare la
            // configurazione e non delle note.
            command(SETTINGS_SET)
                .with_param(parameter(SETTINGS_SET, "key", ParamKind::Text).required())
                .with_param(parameter(SETTINGS_SET, "value", ParamKind::Text).required())
                .with_scope(CommandScope::writing(CommandReach::Settings)),
            command(SETTINGS_RESET)
                .with_param(parameter(SETTINGS_RESET, "key", ParamKind::Text).required())
                .with_scope(CommandScope::writing(CommandReach::Settings)),
            command(SETTINGS_EXPORT).with_scope(CommandScope {
                writes: false,
                reach: CommandReach::Settings,
                reversible: true,
            }),
            command(SETTINGS_IMPORT)
                .with_param(parameter(SETTINGS_IMPORT, "json", ParamKind::Text).required())
                .with_scope(CommandScope::writing(CommandReach::Settings)),
            // --- l'annullamento (§13.3) ---------------------------------
            //
            // La scorciatoia **non** è `Mod-z`: quella è dell'editor, che
            // annulla il testo del buffer. Sono due pile con due soggetti
            // diversi (`Undo`), e a decidere quale risponde è il fuoco — dare a
            // entrambe lo stesso accordo vorrebbe dire che Ctrl-Z fa due cose a
            // seconda di chi vince la corsa, che è la stessa ragione per cui
            // `note.task.toggle` non prende `Mod-Enter`.
            //
            // Il raggio è `Vault` e non `Documents`: cosa toccherà lo sa la
            // voce in cima alla pila, non la spec — e dichiarare il raggio
            // stretto sarebbe la bugia che il piano smaschera. Reversibile no:
            // il redo è un'altra pila, e oggi non c'è.
            command(VAULT_UNDO)
                .with_keybinding("Mod-Alt-z")
                .with_scope(CommandScope::writing(CommandReach::Vault).irreversible()),
        ]
    }
}

impl CommandProvider for CoreCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        CoreCommands::specs()
    }

    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        let args = Args::new(&args);
        match command {
            SEARCH_OPEN => {
                let query = args
                    .text("query")
                    .expect("l'host ha convalidato un parametro obbligatorio");
                Ok(
                    CommandOutcome::done().with_effect(CommandEffect::RunSearch {
                        query: query.to_string(),
                    }),
                )
            }
            SELECTION_WIKILINK => selection_wikilink(mode, host),
            VAULT_REPLACE => vault_replace(args, mode, host),
            NOTES_CREATE => notes_create(args, mode, host),
            NOTES_DUPLICATE => notes_duplicate(args, mode, host),
            NOTES_RENAME => notes_rename(args, mode, host),
            NOTES_TRASH => notes_trash(args, mode, host),
            TRASH_RESTORE => trash_restore(args, mode, host),
            TRASH_EMPTY => trash_empty(mode, host),
            VAULT_ARCHIVE => vault_archive(args, mode, host),
            FOLDER_RENAME => folder_rename(args, mode, host),
            FOLDER_TRASH => folder_trash(args, mode, host),
            NOTES_FOLDER_PAGE => notes_folder_page(args, mode, host),
            NOTES_SUBPAGE => notes_subpage(args, mode, host),
            NOTES_TASK_TOGGLE => notes_task_toggle(args, mode, host),
            VAULT_UNDO => vault_undo(mode, host),
            SETTINGS_SET => settings_set(args, mode, host),
            SETTINGS_RESET => settings_reset(args, mode, host),
            SETTINGS_EXPORT => settings_export(host),
            SETTINGS_IMPORT => settings_import(args, mode, host),
            other => Err(PluginError::UnknownCommand(other.to_string().into())),
        }
    }
}
