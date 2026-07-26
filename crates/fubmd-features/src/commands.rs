//! I comandi ufficiali come `CommandProvider`: il dogfooding del registro
//! (decisione 0009) e della sua descrizione a una macchina (decisione 0010).
//!
//! Tre comandi, scelti perché insieme esercitano tutto ciò che la firma promette
//! e niente che non esista ancora:
//!
//! - `search.open` — nessuna scrittura, un parametro obbligatorio, un effetto
//!   che la shell deve eseguire. È l'azione «apri la ricerca» che finora era
//!   cablata nel frontend: adesso la dichiara il kernel e la palette la trova da
//!   sola.
//! - `selection.wikilink` — il comando che vive nel **contesto di sessione**
//!   (decisione 0007) e scrive con la **modifica chirurgica** (decisione 0008): trasforma il testo
//!   selezionato in un wikilink. È la prova che le tre firme si compongono, e
//!   che la regola dello span della decisione 0007 ha un cliente che ne dipende davvero —
//!   senza span non c'è nessun punto in cui scrivere, e il comando lo dice
//!   invece di indovinare.
//! - `vault.replace` — la sostituzione su N note: parametri di quattro specie,
//!   un piano che si guarda prima di applicarlo, e un raggio dichiarato che dice
//!   a chi invoca di chiedere conferma. È il caso di 7.2 (bulk fix con dry-run) e
//!   la forma che 22.4 chiede per ogni operazione in blocco.
//!
//! Dalla decisione 0013 ci sono anche i **comandi strutturali** — creare, rinominare,
//! cestinare, il giro del cestino — che fino al giro scorso restavano cablati
//! nella shell perché l'`HostApi` non aveva le capacità per farli. Adesso le
//! ha, e questi comandi le usano **dal di fuori**, esattamente come le userebbe
//! un plugin: è il dogfooding che il registro non aveva ancora potuto fare, ed
//! è ciò che ha permesso di togliere sei comandi Tauri dalla shell (§16.6: una
//! feature nuova non deve poter aggiungere un comando Tauri — regola che
//! finché quei sei erano lì valeva solo per le feature che non toccano il
//! vault).
//!
//! E c'è `vault.archive`, che non fa niente di suo: invoca `note.rename` una
//! volta per nota. È il cliente di `run_command`, e serve a provare le tre cose
//! che quella capacità decide — il modo che viaggia con l'host (simulare la
//! macro simula i passi, e il piano che ne esce è l'unione dei loro), l'attore
//! che non si riazzera, e il lotto che non si moltiplica.
//!
//! # Cosa NON c'è qui, e perché
//!
//! Non c'è un comando che **legge** il cestino: `HostApi::list_trash` è una
//! capacità, ma un elenco non è l'esito di un comando (`CommandOutcome` porta
//! un messaggio e un effetto, non dati). Chi deve mostrare il cestino lo legge
//! dal canale di lettura — la shell dal suo IPC, una view da `list_trash`.

use fubmd_abi::command::{
    Args, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope, CommandSpec,
    InvokeMode, ParamKind, ParamSpec, PlannedEdit,
};
use fubmd_abi::edit::{EditRequest, TextEdit};
use fubmd_abi::error::PluginError;
use fubmd_abi::model::{Block, DocId, DocumentModel, Span, TaskMarker};
use fubmd_abi::traits::{BacklinkRef, CommandProvider, HostApi, IndexQuery, IndexResult};

/// Id del provider: lo spazio dati e la registrazione, come per le view.
pub const COMMANDS_ID: &str = "fubmd.commands";

/// Cerca nel vault.
pub const SEARCH_OPEN: &str = "search.open";
/// Trasforma la selezione in un wikilink.
pub const SELECTION_WIKILINK: &str = "selection.wikilink";
/// Sostituisci in tutte le note.
pub const VAULT_REPLACE: &str = "vault.replace";
/// Crea una nota.
pub const NOTE_CREATE: &str = "note.create";
/// Rinomina/sposta una nota (e i wikilink che la nominano).
pub const NOTE_RENAME: &str = "note.rename";
/// Sposta una nota nel cestino.
pub const NOTE_TRASH: &str = "note.trash";
/// Ripristina una voce del cestino.
pub const TRASH_RESTORE: &str = "trash.restore";
/// Svuota il cestino.
pub const TRASH_EMPTY: &str = "trash.empty";
/// Sposta N note in una cartella, un `note.rename` alla volta.
pub const VAULT_ARCHIVE: &str = "vault.archive";
/// Spunta (o de-spunta) un task.
pub const NOTE_TASK_TOGGLE: &str = "note.task.toggle";

/// Il nome di una nota senza nome, e l'estensione che le si dà.
///
/// Vivono qui e non nel contratto perché *qual è il formato predefinito* è una
/// domanda del registro dei formati, che è del kernel e non è (ancora) una
/// capacità: finché non lo è, questo comando dichiara la propria convenzione
/// invece di indovinare quella di qualcun altro. Chi vuole un'altra estensione
/// la scrive nel nome.
const SENZA_TITOLO: &str = "Senza titolo";
const ESTENSIONE_PREDEFINITA: &str = "md";

/// I comandi ufficiali. Senza stato: tutto ciò che gli serve lo chiede
/// all'host, come farebbe un plugin.
#[derive(Default)]
pub struct CoreCommands;

impl CoreCommands {
    /// Le spec, anche fuori dal trait: chi disegna una palette nei test le
    /// legge senza montare un workspace.
    pub fn specs() -> Vec<CommandSpec> {
        vec![
            CommandSpec::new(SEARCH_OPEN, "Cerca nel vault")
                .describing(
                    "Esegue una ricerca full-text sul vault e mostra i risultati. \
                     Non modifica niente.",
                )
                .with_keybinding("Mod-Shift-f")
                .with_param(
                    ParamSpec::new("query", "Cerca", ParamKind::Text)
                        .describing(
                            "La query, nella stessa sintassi della barra di ricerca \
                             (`tags:nome` filtra per tag).",
                        )
                        .required(),
                ),
            CommandSpec::new(SELECTION_WIKILINK, "Trasforma la selezione in wikilink")
                .describing(
                    "Avvolge il testo selezionato nel pannello attivo fra doppie \
                     quadre, creando un riferimento a una nota con quel nome. \
                     Richiede una selezione e un buffer salvato.",
                )
                .with_scope(CommandScope::writing(CommandReach::Document)),
            CommandSpec::new(VAULT_REPLACE, "Sostituisci in tutte le note")
                .describing(
                    "Sostituisce ogni occorrenza di un testo con un altro, in tutte \
                     le note del vault o solo in quelle indicate. Simulandolo si \
                     ottiene l'elenco delle note impattate e le modifiche esatte, \
                     senza scrivere niente.",
                )
                .with_param(
                    ParamSpec::new("find", "Cerca", ParamKind::Text)
                        .describing("Il testo da sostituire. Non può essere vuoto.")
                        .required(),
                )
                .with_param(
                    ParamSpec::new("replace", "Sostituisci con", ParamKind::Text)
                        .describing("Il testo nuovo. Vuoto cancella le occorrenze.")
                        .required(),
                )
                .with_param(
                    ParamSpec::new("whole_word", "Solo parole intere", ParamKind::Bool).describing(
                        "Se vero, sostituisce solo le occorrenze che non sono \
                             parte di una parola più lunga. Default: falso.",
                    ),
                )
                .with_param(
                    ParamSpec::new("docs", "Solo in queste note", ParamKind::Documents).describing(
                        "Gli id delle note su cui operare. Assente = tutto il \
                             vault; elenco vuoto = nessuna nota.",
                    ),
                )
                .with_scope(CommandScope::writing(CommandReach::Documents)),
            // --- strutturali (decisione 0013) ---------------------------------------
            CommandSpec::new(NOTE_CREATE, "Nuova nota")
                .describing(
                    "Crea una nota vuota e la apre. Senza nome nasce «Senza \
                     titolo», e se quel nome è preso «Senza titolo 1», «2», … \
                     Un nome senza estensione diventa una nota markdown.",
                )
                .with_param(ParamSpec::new("name", "Nome", ParamKind::Text).describing(
                    "Il nome o il path della nota, estensione compresa se \
                         diversa da `.md`. Assente = «Senza titolo».",
                ))
                // Una nota sola, e il cestino la rende reversibile.
                .with_scope(CommandScope::writing(CommandReach::Document)),
            CommandSpec::new(NOTE_RENAME, "Rinomina nota")
                .describing(
                    "Rinomina o sposta una nota e riscrive i wikilink entranti \
                     che la nominavano, così i riferimenti non si rompono. I \
                     link per alias non vengono toccati.",
                )
                .with_param(
                    ParamSpec::new("doc", "Nota", ParamKind::Document)
                        .describing("La nota da rinominare.")
                        .required(),
                )
                .with_param(
                    ParamSpec::new("to", "Nuovo path", ParamKind::Text)
                        .describing(
                            "Il path nuovo, estensione compresa. Cambiare la \
                             cartella sposta la nota.",
                        )
                        .required(),
                )
                // `Documents` e non `Document`: una rinomina riscrive anche
                // ogni nota che linkava la vecchia. Dichiarare `Document`
                // sarebbe la bugia che il piano del dry-run smaschera.
                .with_scope(CommandScope::writing(CommandReach::Documents)),
            CommandSpec::new(NOTE_TRASH, "Sposta nel cestino")
                .describing(
                    "Sposta una nota nel cestino del vault. La nota esce dagli \
                     indici ma non è distrutta: si recupera con «Ripristina dal \
                     cestino».",
                )
                .with_param(
                    ParamSpec::new("doc", "Nota", ParamKind::Document)
                        .describing("La nota da cestinare. Assente = quella aperta."),
                )
                // Reversibile, e non per ottimismo: la reversibilità è
                // `trash.restore`, che sta in questo stesso registro.
                .with_scope(CommandScope::writing(CommandReach::Document)),
            CommandSpec::new(TRASH_RESTORE, "Ripristina dal cestino")
                .describing(
                    "Riporta nel vault una voce del cestino. Se il path \
                     d'origine è di nuovo occupato serve un nome nuovo: senza, \
                     il ripristino è rifiutato invece di sovrascrivere.",
                )
                .with_param(
                    ParamSpec::new("entry", "Voce del cestino", ParamKind::Text)
                        .describing("L'id della voce nel cestino (`.trash/…`).")
                        .required(),
                )
                .with_param(
                    ParamSpec::new("to", "Ripristina come", ParamKind::Text)
                        .describing("Path alternativo. Assente = il path d'origine."),
                )
                .with_scope(CommandScope::writing(CommandReach::Document)),
            CommandSpec::new(TRASH_EMPTY, "Svuota il cestino")
                .describing(
                    "Cancella definitivamente tutte le voci del cestino. Da qui \
                     non si torna indietro.",
                )
                .with_scope(CommandScope::writing(CommandReach::Vault).irreversible()),
            CommandSpec::new(VAULT_ARCHIVE, "Archivia le note")
                .describing(
                    "Sposta le note indicate in una cartella, una rinomina alla \
                     volta: i wikilink che le nominano vengono riscritti come \
                     per una rinomina singola. Simulandolo si ottiene l'elenco \
                     di dove finirebbe ciascuna.",
                )
                .with_param(
                    ParamSpec::new("docs", "Note da archiviare", ParamKind::Documents)
                        .describing("Gli id delle note da spostare.")
                        .required(),
                )
                .with_param(
                    ParamSpec::new("folder", "Cartella", ParamKind::Text)
                        .describing("Dove spostarle. Assente = «Archivio»."),
                )
                .with_scope(CommandScope::writing(CommandReach::Documents)),
            CommandSpec::new(NOTE_TASK_TOGGLE, "Spunta il task")
                .describing(
                    "Spunta o de-spunta la voce di task che si trova in una \
                     posizione del documento: `[ ]` diventa `[x]` e ogni altro \
                     stato torna `[ ]`. Senza argomenti agisce sul task sotto il \
                     cursore del pannello attivo. Scrive un carattere solo.",
                )
                // Nessuna scorciatoia, e in particolare **non** `Mod-Enter`:
                // quella la tiene l'editor, che spunta le todo delle righe
                // selezionate nel **buffer** (`editor-commands.ts`). Sono due
                // gesti su due oggetti diversi — il buffer e il file — e dare a
                // entrambi la stessa combinazione vorrebbe dire che l'accordo
                // fa due cose a seconda di chi vince la corsa. Chi la invoca
                // oggi è chi ha una posizione da dare: la palette, un altro
                // comando, un plugin.
                .with_param(
                    ParamSpec::new("doc", "Nota", ParamKind::Document)
                        .describing("La nota su cui agire. Assente = quella del pannello attivo."),
                )
                .with_param(
                    ParamSpec::new("at", "Posizione", ParamKind::Number).describing(
                        "Posizione in byte dentro il documento: si spunta il task \
                         che la contiene, il più interno se sono annidati. \
                         Assente = il cursore del pannello attivo.",
                    ),
                )
                .with_scope(CommandScope::writing(CommandReach::Document)),
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
            NOTE_CREATE => note_create(args, mode, host),
            NOTE_RENAME => note_rename(args, mode, host),
            NOTE_TRASH => note_trash(args, mode, host),
            TRASH_RESTORE => trash_restore(args, mode, host),
            TRASH_EMPTY => trash_empty(mode, host),
            VAULT_ARCHIVE => vault_archive(args, mode, host),
            NOTE_TASK_TOGGLE => note_task_toggle(args, mode, host),
            other => Err(PluginError::UnknownCommand(other.to_string())),
        }
    }
}

// ---------------------------------------------------------------------------
// selection.wikilink
// ---------------------------------------------------------------------------

/// Il testo selezionato diventa `[[testo]]`.
///
/// Lo stato in cui il comando non può agire — nessuna nota, nessuna selezione,
/// oppure una selezione senza span (buffer sporco: le coordinate non valgono per
/// il file) — è un [`PluginError::BadArgs`] con dentro la ragione. È il caso
/// che il §12.2 chiuderà bene (un errore *di precondizione* non è un errore di
/// argomenti): finché il confine ha questo vocabolario, un errore che si spiega
/// vale più di un successo che non ha fatto niente — chi invoca può non essere
/// una persona che guarda lo schermo.
fn selection_wikilink(
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let stato = |why: &str| PluginError::BadArgs(why.to_string());
    let context = host
        .active_context()
        .ok_or_else(|| stato("nessun pannello attivo"))?;
    let doc = context
        .doc
        .ok_or_else(|| stato("nessuna nota aperta nel pannello attivo"))?;
    let selection = context
        .selection
        .ok_or_else(|| stato("niente di selezionato"))?;
    if selection.is_empty() {
        return Err(stato("la selezione è vuota: non c'è testo da trasformare"));
    }
    // La regola dello span della decisione 0007: senza span la selezione ha coordinate che
    // valgono per il buffer e non per il file. Scrivere lì significa tagliare i
    // byte sbagliati proprio mentre l'utente scrive.
    let span = selection.span.ok_or_else(|| {
        stato("il buffer ha modifiche non salvate: salva prima di trasformare la selezione")
    })?;

    let source = host.read_document(&doc)?;
    // Il testo che verrà sostituito è quello del **file**, non quello del
    // buffer: sono lo stesso testo (lo span esiste solo a buffer pulito), e
    // prenderlo da qui lo rende vero per costruzione invece che per fiducia.
    let selected = source
        .get(span.start..span.end)
        .ok_or_else(|| stato("la selezione non sta dentro il documento"))?;
    if selected.contains("[[") || selected.contains(']') {
        return Err(stato("la selezione contiene già un riferimento"));
    }

    let request = EditRequest::new(
        host.document_revision(&doc)?,
        vec![TextEdit::replace(span, format!("[[{selected}]]"))],
    );

    if mode.is_dry_run() {
        return Ok(
            CommandOutcome::done().with_effect(CommandEffect::Plan(CommandPlan::of_edits(
                format!("«{selected}» diventa un riferimento in {doc}"),
                vec![PlannedEdit::new(doc, request)],
            ))),
        );
    }

    let report = host.apply_edit(&doc, request)?;
    // Dov'è finito il testo nuovo: è il rapporto a saperlo, nelle coordinate
    // del documento riscritto (decisione 0008). Senza, la shell dovrebbe ricalcolare uno
    // spostamento che l'host ha già calcolato.
    let effect = match report.applied.first() {
        Some(applied) => CommandEffect::Reveal {
            doc,
            span: applied.span,
        },
        None => CommandEffect::Done,
    };
    Ok(CommandOutcome::notify(format!("Creato il riferimento a «{selected}»")).with_effect(effect))
}

// ---------------------------------------------------------------------------
// vault.replace
// ---------------------------------------------------------------------------

fn vault_replace(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let find = args.text("find").unwrap_or_default();
    let replace = args.text("replace").unwrap_or_default();
    let whole_word = args.flag("whole_word", false);
    if find.is_empty() {
        // Lo schema dice "testo obbligatorio", non "testo non vuoto": la
        // stringa vuota è un argomento valido per la specie e senza senso per
        // questo comando. Il vocabolario dei parametri resta piccolo apposta —
        // ciò che una specie non esprime lo dice il comando, e lo dice qui.
        return Err(PluginError::BadArgs(
            "`find` non può essere vuoto: sostituirebbe il nulla ovunque".to_string(),
        ));
    }

    let targets = match args.documents("docs") {
        Some(docs) => docs,
        None => host.list_documents(None)?.items,
    };

    let mut planned = Vec::new();
    let mut occorrenze = 0usize;
    for doc in targets {
        let source = host.read_document(&doc)?;
        let spans = occurrences(&source, find, whole_word);
        if spans.is_empty() {
            continue;
        }
        occorrenze += spans.len();
        let edits = spans
            .into_iter()
            .map(|span| TextEdit::replace(span, replace))
            .collect();
        // La base è la revisione di **adesso**: se il documento cambia fra il
        // piano e l'approvazione, applicarlo fallisce con `Conflict` invece di
        // sovrascrivere il lavoro di qualcun altro. È la ragione per cui un
        // piano non è un'ipotesi vaga ma una promessa verificabile.
        planned.push(PlannedEdit::new(
            doc.clone(),
            EditRequest::new(host.document_revision(&doc)?, edits),
        ));
    }

    let summary = format!(
        "{} in {}",
        plurale(occorrenze, "sostituzione", "sostituzioni"),
        plurale(planned.len(), "nota", "note")
    );

    if mode.is_dry_run() {
        return Ok(CommandOutcome::done()
            .with_effect(CommandEffect::Plan(CommandPlan::of_edits(summary, planned))));
    }

    // Si applica tutto, anche se una nota fallisce: fermarsi a metà lascerebbe
    // il vault fra due stati senza dire quali note sono in quale. Ciò che non è
    // riuscito si nomina — un conflitto qui è la cosa che il piano esisteva per
    // rendere visibile, non un dettaglio da inghiottire.
    let mut fatte = 0usize;
    let mut falliti: Vec<String> = Vec::new();
    for PlannedEdit { doc, edit } in planned {
        match host.apply_edit(&doc, edit) {
            Ok(_) => fatte += 1,
            Err(e) => falliti.push(format!("{doc} ({e})")),
        }
    }
    let mut notify = format!("{}, {} aggiornate", summary, plurale(fatte, "nota", "note"));
    if !falliti.is_empty() {
        notify.push_str(&format!("; non modificate: {}", falliti.join(", ")));
    }
    Ok(CommandOutcome::notify(notify))
}

// ---------------------------------------------------------------------------
// I comandi strutturali (decisione 0013)
// ---------------------------------------------------------------------------
//
// Sono sottili apposta: tutto ciò che fanno lo fanno chiedendolo all'host. La
// validazione dei path, il recinto del vault, la riscrittura dei backlink e il
// lotto stanno dietro le capacità, dove stavano già — la novità è che adesso ci
// si arriva **dal di fuori**, con la stessa firma che avrà un plugin.

/// Il path di una nota a partire da come l'utente l'ha nominata: se l'ultimo
/// segmento non porta un punto, l'estensione predefinita.
///
/// «Progetti/Idee» è un path senza estensione, «note.2026» è un nome con un
/// punto in mezzo — e distinguerli guardando solo l'ultimo segmento è la stessa
/// regola che usa il vault per il cestino.
fn con_estensione(name: &str) -> String {
    let ultimo = name.rsplit('/').next().unwrap_or(name);
    if ultimo.contains('.') {
        name.to_string()
    } else {
        format!("{name}.{ESTENSIONE_PREDEFINITA}")
    }
}

fn piano(summary: String, docs: Vec<DocId>) -> CommandOutcome {
    let plan = docs
        .into_iter()
        .fold(CommandPlan::of_edits(summary, Vec::new()), |p, d| {
            p.with_doc(d)
        });
    CommandOutcome::done().with_effect(CommandEffect::Plan(plan))
}

fn note_create(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let richiesto = args.text("name").map(str::trim).filter(|n| !n.is_empty());
    let id = match richiesto {
        Some(name) => DocId::new(con_estensione(name)),
        // Il nome libero lo chiede all'host: la convenzione D3 è una sola, e
        // sta nel vault che è l'unico a sapere cosa è occupato.
        None => host.free_name(&DocId::new(format!(
            "{SENZA_TITOLO}.{ESTENSIONE_PREDEFINITA}"
        ))),
    };

    if mode.is_dry_run() {
        return Ok(piano(format!("Crea «{id}»"), vec![id]));
    }

    // `create_document` e non `write_document`: se il path è occupato questo
    // comando deve fallire, non sovrascrivere una nota dell'utente.
    host.create_document(&id, "")?;
    Ok(CommandOutcome::notify(format!("Creata «{id}»"))
        .with_effect(CommandEffect::Navigate { doc: id }))
}

fn note_rename(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let doc = args
        .document("doc")
        .expect("l'host ha convalidato un parametro obbligatorio");
    let to = args
        .text("to")
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .ok_or_else(|| PluginError::BadArgs("`to` non può essere vuoto".to_string()))?;
    let to = DocId::new(con_estensione(to));

    if mode.is_dry_run() {
        // L'insieme impattato di una rinomina non è «la nota»: sono anche tutte
        // quelle che la nominano, perché è lì che il kernel riscriverà i
        // wikilink. Il piano è ciò che l'utente approva, e approvare «rinomina
        // una nota» quando le note toccate sono quaranta è un consenso
        // strappato — quindi i backlink si chiedono all'indice.
        let mut docs = vec![doc.clone(), to.clone()];
        if let IndexResult::Backlinks(sorgenti) = host.query_index(IndexQuery::Backlinks {
            target: doc.clone(),
            page: None,
        })? {
            for BacklinkRef { source, .. } in sorgenti.items {
                if !docs.contains(&source) {
                    docs.push(source);
                }
            }
        }
        return Ok(piano(format!("«{doc}» diventa «{to}»"), docs));
    }

    host.rename_document(&doc, &to)?;
    // Nessun `Navigate`: chi guardava quella nota la segue attraverso
    // `document-renamed`, e chi ne guardava un'altra non deve essere spostato.
    Ok(CommandOutcome::notify(format!(
        "«{doc}» rinominata in «{to}»"
    )))
}

fn note_trash(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let doc = args
        .document("doc")
        .or_else(|| host.active_context().and_then(|c| c.doc))
        .ok_or_else(|| {
            PluginError::BadArgs(
                "nessuna nota indicata e nessuna nota aperta nel pannello attivo".to_string(),
            )
        })?;

    if mode.is_dry_run() {
        return Ok(piano(format!("«{doc}» va nel cestino"), vec![doc]));
    }

    host.trash_document(&doc)?;
    Ok(CommandOutcome::notify(format!(
        "«{doc}» spostata nel cestino"
    )))
}

fn trash_restore(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let entry = args
        .document("entry")
        .expect("l'host ha convalidato un parametro obbligatorio");
    let to = args
        .text("to")
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(|t| DocId::new(con_estensione(t)));

    if mode.is_dry_run() {
        // Dove tornerebbe lo sa il cestino, non chi invoca: si legge, così il
        // piano nomina il documento vero anche quando `to` non c'è.
        let voce = host
            .list_trash()?
            .into_iter()
            .find(|e| e.id == entry)
            .ok_or_else(|| PluginError::BadArgs(format!("`{entry}` non è nel cestino")))?;
        let target = to.unwrap_or(voce.original);
        return Ok(piano(
            format!("«{entry}» torna come «{target}»"),
            vec![target],
        ));
    }

    let target = host.restore_document(&entry, to)?;
    Ok(CommandOutcome::notify(format!("Ripristinata «{target}»"))
        .with_effect(CommandEffect::Navigate { doc: target }))
}

fn trash_empty(mode: InvokeMode, host: &mut dyn HostApi) -> Result<CommandOutcome, PluginError> {
    if mode.is_dry_run() {
        let voci = host.list_trash()?;
        return Ok(piano(
            format!(
                "Cancella definitivamente {}",
                plurale(voci.len(), "voce", "voci")
            ),
            voci.into_iter().map(|e| e.id).collect(),
        ));
    }

    let quante = host.empty_trash()?;
    Ok(CommandOutcome::notify(format!(
        "Cestino svuotato: {} cancellate per sempre",
        plurale(quante as usize, "voce", "voci")
    )))
}

// ---------------------------------------------------------------------------
// vault.archive — il cliente di `run_command`
// ---------------------------------------------------------------------------

/// La cartella in cui archiviare, quando non è stata detta.
const ARCHIVIO: &str = "Archivio";

/// Sposta N note in una cartella **invocando `note.rename`**, non rinominando.
///
/// È la forma che la decisione 0013 voleva provare: una macro non rifà ciò che un comando
/// già sa fare, lo chiama. Tre conseguenze che si vedono solo qui:
///
/// - la riscrittura dei wikilink arriva **gratis**, perché la fa il comando
///   invocato: questa funzione non nomina nemmeno un link;
/// - simulare la macro simula i passi, perché il modo viaggia con l'host e non
///   con la chiamata — e il piano che ne esce è l'unione dei loro;
/// - l'attore e il lotto restano quelli di chi ha chiesto: N rinomine, che sono
///   N riscritture di M sorgenti, sono **un** `batch-ended` e una riga sola
///   nella storia di chi guarda gli eventi.
fn vault_archive(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let docs = args
        .documents("docs")
        .expect("l'host ha convalidato un parametro obbligatorio");
    let folder = args
        .text("folder")
        .map(str::trim)
        .filter(|f| !f.is_empty())
        .unwrap_or(ARCHIVIO)
        .trim_end_matches('/')
        .to_string();

    let mut plans: Vec<CommandPlan> = Vec::new();
    let mut fatte = 0usize;
    let mut falliti: Vec<String> = Vec::new();

    for doc in &docs {
        let nome = doc.as_str().rsplit('/').next().unwrap_or(doc.as_str());
        let to = format!("{folder}/{nome}");
        if to == doc.as_str() {
            continue; // già archiviata: non è un errore, è niente da fare
        }
        let args = serde_json::json!({ "doc": doc.as_str(), "to": to });
        match host.run_command(NOTE_RENAME, args) {
            // In simulazione il comando invocato risponde col proprio piano —
            // non perché questa funzione glielo abbia chiesto, ma perché
            // l'host in cui gira è già quello di una simulazione.
            Ok(CommandOutcome {
                effect: CommandEffect::Plan(plan),
                ..
            }) => plans.push(plan),
            Ok(_) => fatte += 1,
            Err(e) => falliti.push(format!("{doc} ({e})")),
        }
    }

    if mode.is_dry_run() {
        // L'unione dei piani dei passi. `docs` prima di `edits` perché è
        // l'ordine in cui le cose succederebbero, e `complete()` dell'host
        // ricontrolla comunque che nessun edit nomini una nota assente.
        let mut docs_toccati: Vec<DocId> = Vec::new();
        let mut edits: Vec<PlannedEdit> = Vec::new();
        for plan in plans {
            for d in plan.docs {
                if !docs_toccati.contains(&d) {
                    docs_toccati.push(d);
                }
            }
            edits.extend(plan.edits);
        }
        let summary = format!(
            "{} in «{folder}»",
            plurale(docs.len(), "nota archiviata", "note archiviate")
        );
        let mut plan = CommandPlan::of_edits(summary, edits);
        for d in docs_toccati {
            plan = plan.with_doc(d);
        }
        return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(plan)));
    }

    let mut notify = format!(
        "{} in «{folder}»",
        plurale(fatte, "nota archiviata", "note archiviate")
    );
    if !falliti.is_empty() {
        notify.push_str(&format!("; non spostate: {}", falliti.join(", ")));
    }
    Ok(CommandOutcome::notify(notify))
}

// ---------------------------------------------------------------------------
// note.task.toggle
// ---------------------------------------------------------------------------

/// Spunta il task che sta sotto una posizione: il **primo cliente one-shot** del
/// modello parsato (§4.2, [decisione 0018](../../../docs/decisions/0018-chi-vede-il-modello-parsato.md)).
///
/// È il gesto quotidiano del capitolo 10, ed è anche la prova che la capacità
/// nuova serve a qualcosa che prima non si poteva scrivere. Le due strade di
/// prima erano entrambe storte: **riparsare** il markdown con un parser proprio
/// — una seconda grammatica dentro un comando, che è il §4.4 visto dal lato del
/// consumo — oppure registrare un `IndexProvider`-**specchio** che tiene una
/// copia dell'intero vault al solo scopo di aver visto passare *questa* nota.
/// Questa funzione non fa né l'una né l'altra: chiede il modello di una nota
/// sola, e non conosce un solo carattere della sintassi dei task.
///
/// Ciò che scrive è **un carattere**, ed è lo `span` del marcatore a dirle
/// quale: il modello porta la posizione del simbolo e non della voce
/// ([`TaskMarker`]), quindi spuntare non riscrive la riga, non tocca il testo
/// del task e non ha modo di sbagliare l'indentazione.
///
/// # La coppia che conosce
///
/// `[ ]` diventa `[x]`; **ogni altro simbolo torna `[ ]`**. Non è la lettura
/// binaria di [`TaskMarker::checked`], ed è deliberato: gli stati personalizzati
/// (`[/]` in corso, `[-]` cancellato, `[>]` rimandato) sono una famiglia che il
/// prodotto non ha ancora definito, e un toggle che li promuovesse a `[x]`
/// deciderebbe al posto suo che «in corso» è più vicino a «fatto» che a «da
/// fare». Toglierli è l'unica mossa reversibile: il simbolo che c'era lo sa
/// ancora l'undo, mentre una semantica inventata non la disfa nessuno.
fn note_task_toggle(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let stato = |why: String| PluginError::BadArgs(why);
    let context = host.active_context();

    let doc = args
        .document("doc")
        .or_else(|| context.as_ref().and_then(|c| c.doc.clone()))
        .ok_or_else(|| stato("nessuna nota: né in `doc`, né nel pannello attivo".into()))?;

    // La posizione: quella detta, o quella del cursore. Le due non si mescolano
    // — un `doc` detto e un `at` no vorrebbe dire spuntare in una nota il task
    // che sta sotto il cursore di **un'altra**, che è un modo silenzioso di
    // scrivere nel posto sbagliato.
    let at = match args.number("at") {
        Some(n) => posizione(n)?,
        None => {
            let context = context.as_ref().ok_or_else(|| {
                stato("nessuna posizione in `at`, e nessun pannello attivo da cui prenderla".into())
            })?;
            if context.doc.as_ref() != Some(&doc) {
                return Err(stato(format!(
                    "`at` non c'è e il cursore non è in {doc}: dire su quale nota \
                     agire senza dire dove non basta"
                )));
            }
            let selection = context
                .selection
                .as_ref()
                .ok_or_else(|| stato("nessun cursore nel pannello attivo".into()))?;
            // La regola dello span della decisione 0007, per la stessa ragione di
            // `selection.wikilink`: a buffer sporco le coordinate valgono per il
            // buffer, e il modello che si sta per chiedere è quello del **file**.
            selection
                .span
                .ok_or_else(|| {
                    stato(
                        "il buffer ha modifiche non salvate: salva prima di spuntare, \
                         o dì la posizione in `at`"
                            .into(),
                    )
                })?
                .start
        }
    };

    let model = host.read_model(&doc)?;
    let marker = task_at(&model, at)
        .ok_or_else(|| stato(format!("nessuna voce di task alla posizione {at} di {doc}")))?;

    let (simbolo, fatto) = match marker.symbol {
        None => ("x", true),
        Some(_) => (" ", false),
    };
    let request = EditRequest::new(
        host.document_revision(&doc)?,
        vec![TextEdit::replace(marker.span, simbolo)],
    );
    let summary = if fatto {
        format!("Task spuntata in {doc}")
    } else {
        format!("Task da fare in {doc}")
    };

    if mode.is_dry_run() {
        return Ok(
            CommandOutcome::done().with_effect(CommandEffect::Plan(CommandPlan::of_edits(
                summary,
                vec![PlannedEdit::new(doc, request)],
            ))),
        );
    }

    let report = host.apply_edit(&doc, request)?;
    let effect = match report.applied.first() {
        Some(applied) => CommandEffect::Reveal {
            doc,
            span: applied.span,
        },
        None => CommandEffect::Done,
    };
    Ok(CommandOutcome::notify(summary).with_effect(effect))
}

/// Un `at` che arriva come numero JSON diventa un offset in byte, o si spiega.
///
/// La specie [`ParamKind::Number`] è un `f64`, e ciò che non è un indice di byte
/// — un negativo, una frazione, un infinito — va rifiutato **qui**: `as usize`
/// lo tradurrebbe in una posizione plausibile e sbagliata (`-1` diventa un
/// numero enorme, `3.9` diventa `3`), e chi legge l'errore dopo avrebbe in mano
/// un task spuntato al posto di un rifiuto.
fn posizione(n: f64) -> Result<usize, PluginError> {
    if n.is_finite() && n >= 0.0 && n.fract() == 0.0 {
        Ok(n as usize)
    } else {
        Err(PluginError::BadArgs(format!(
            "`at` è una posizione in byte: {n} non lo è"
        )))
    }
}

/// Il marcatore del task che contiene `at`, **il più interno** se sono
/// annidati.
///
/// Il criterio è la voce più stretta fra quelle che contengono la posizione: le
/// voci annidate stanno dentro la loro, quindi il minimo è sempre la foglia — e
/// un cursore su una sottovoce spunta quella e non il task che la contiene, che
/// è ciò che si aspetta chi guarda lo schermo.
fn task_at(model: &DocumentModel, at: usize) -> Option<TaskMarker> {
    fn cerca(blocks: &[Block], at: usize, best: &mut Option<(usize, TaskMarker)>) {
        for block in blocks {
            match block {
                Block::List { items, .. } => {
                    for item in items {
                        // Fine inclusa: il cursore a fine riga è dentro la voce
                        // che si sta guardando, non fuori da tutto.
                        if at < item.span.start || at > item.span.end {
                            continue;
                        }
                        if let Some(task) = item.task {
                            let ampiezza = item.span.end - item.span.start;
                            if best.is_none_or(|(a, _)| ampiezza < a) {
                                *best = Some((ampiezza, task));
                            }
                        }
                        cerca(&item.blocks, at, best);
                    }
                }
                // Un task dentro una citazione o dentro un callout è un task, e
                // il modello lo tiene dove sta. Le altre varianti non portano
                // blocchi annidati.
                Block::Quote { blocks, .. } | Block::Custom { blocks, .. } => {
                    cerca(blocks, at, best)
                }
                _ => {}
            }
        }
    }

    let mut best = None;
    cerca(&model.body, at, &mut best);
    best.map(|(_, task)| task)
}

/// Le occorrenze di `needle` in `source`, in byte e non sovrapposte.
///
/// `whole_word` non è una raffinatezza: una sostituzione in blocco senza di essa
/// riscrive `nota` dentro `annotazione`, e chi se ne accorge lo fa dopo aver
/// toccato quaranta file.
pub fn occurrences(source: &str, needle: &str, whole_word: bool) -> Vec<Span> {
    let mut spans = Vec::new();
    if needle.is_empty() {
        return spans;
    }
    let mut from = 0usize;
    while let Some(rel) = source[from..].find(needle) {
        let start = from + rel;
        let end = start + needle.len();
        if !whole_word || is_whole_word(source, start, end) {
            spans.push(Span::new(start, end));
        }
        // Si riparte dalla fine del match: le occorrenze sono un insieme di
        // edit, e due edit non possono contendersi lo stesso punto (decisione 0008).
        from = end;
    }
    spans
}

/// Il match `[start, end)` è una parola intera? Confine = ciò che sta prima e
/// dopo non è alfanumerico né `_`.
fn is_whole_word(source: &str, start: usize, end: usize) -> bool {
    let prima = source[..start].chars().next_back();
    let dopo = source[end..].chars().next();
    let parte_di_parola = |c: Option<char>| c.is_some_and(|c| c.is_alphanumeric() || c == '_');
    !parte_di_parola(prima) && !parte_di_parola(dopo)
}

fn plurale(n: usize, uno: &str, molti: &str) -> String {
    format!("{n} {}", if n == 1 { uno } else { molti })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::MemoryHost;
    use fubmd_abi::model::{DocId, ListItem};
    use fubmd_abi::session::{Selection, ViewContext};
    use serde_json::json;

    fn invoke(
        host: &mut MemoryHost,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
    ) -> Result<CommandOutcome, PluginError> {
        // Come farebbe il kernel: prima la convalida contro la spec, poi la
        // chiamata. Un test che saltasse la convalida proverebbe un percorso
        // che non esiste.
        let spec = CoreCommands::specs()
            .into_iter()
            .find(|s| s.id == command)
            .expect("comando dichiarato");
        spec.validate_args(&args)?;
        CoreCommands.invoke(command, args, mode, host)
    }

    fn piano(outcome: &CommandOutcome) -> &CommandPlan {
        match &outcome.effect {
            CommandEffect::Plan(plan) => plan,
            other => panic!("un dry-run risponde con un piano, non con {other:?}"),
        }
    }

    #[test]
    fn every_command_declares_what_it_does_and_how_far_it_reaches() {
        for spec in CoreCommands::specs() {
            assert!(
                !spec.description.trim().is_empty(),
                "`{}` senza descrizione: è l'unico ingrediente su cui un \
                 chiamante non umano sceglie",
                spec.id
            );
            for param in &spec.params {
                assert!(
                    !param.description.trim().is_empty(),
                    "`{}.{}` senza descrizione",
                    spec.id,
                    param.name
                );
            }
            if spec.scope.writes {
                assert!(
                    spec.scope.reach >= CommandReach::Document,
                    "`{}` scrive ma dichiara di non toccare il vault",
                    spec.id
                );
            }
        }
    }

    #[test]
    fn opening_the_search_is_an_intent_for_the_shell_not_a_write() {
        let mut host = MemoryHost::new();
        let outcome = invoke(
            &mut host,
            SEARCH_OPEN,
            json!({ "query": "tags:rust" }),
            InvokeMode::Apply,
        )
        .expect("cerca");
        assert_eq!(
            outcome.effect,
            CommandEffect::RunSearch {
                query: "tags:rust".into()
            }
        );
    }

    #[test]
    fn the_wikilink_command_needs_a_selection_that_is_true_for_the_file() {
        let mut host = MemoryHost::new().con_documento("nota.md", "una nota di prova");
        host.set_active(Some("nota.md"));
        // Buffer sporco: c'è il testo, non lo span (decisione 0007).
        host.set_context(Some(
            ViewContext::new("main")
                .with_doc(Some(DocId::new("nota.md")))
                .with_selection(Some(Selection {
                    span: None,
                    text: "nota".into(),
                })),
        ));
        let err = invoke(&mut host, SELECTION_WIKILINK, json!({}), InvokeMode::Apply).unwrap_err();
        let PluginError::BadArgs(msg) = err else {
            panic!("uno stato che non permette l'operazione si spiega")
        };
        assert!(msg.contains("non salvate"), "{msg}");
        assert_eq!(
            host.read_document(&DocId::new("nota.md")).unwrap(),
            "una nota di prova",
            "e non ha scritto niente"
        );
    }

    #[test]
    fn the_wikilink_command_wraps_exactly_the_selected_bytes() {
        let mut host = MemoryHost::new().con_documento("nota.md", "parlo di Kant e di altro");
        host.set_active(Some("nota.md"));
        host.set_selection(9, "Kant");

        let piano_prima =
            invoke(&mut host, SELECTION_WIKILINK, json!({}), InvokeMode::DryRun).expect("simula");
        assert_eq!(
            piano(&piano_prima).docs,
            vec![DocId::new("nota.md")],
            "il piano nomina la nota che toccherebbe"
        );
        assert_eq!(
            host.read_document(&DocId::new("nota.md")).unwrap(),
            "parlo di Kant e di altro",
            "una simulazione non scrive"
        );

        let outcome =
            invoke(&mut host, SELECTION_WIKILINK, json!({}), InvokeMode::Apply).expect("applica");
        assert_eq!(
            host.read_document(&DocId::new("nota.md")).unwrap(),
            "parlo di [[Kant]] e di altro"
        );
        let CommandEffect::Reveal { span, .. } = outcome.effect else {
            panic!("dopo aver scritto, la shell deve sapere dove guardare")
        };
        assert_eq!(
            span,
            Span::new(9, 17),
            "le coordinate sono quelle del testo NUOVO: `[[Kant]]`"
        );
    }

    #[test]
    fn a_dry_run_of_a_bulk_replace_says_what_it_would_do_and_writes_nothing() {
        let mut host = MemoryHost::new()
            .con_documento("a.md", "il gatto e il gatto")
            .con_documento("b.md", "nessun felino")
            .con_documento("c.md", "un gatto solo");

        let outcome = invoke(
            &mut host,
            VAULT_REPLACE,
            json!({ "find": "gatto", "replace": "cane" }),
            InvokeMode::DryRun,
        )
        .expect("simula");
        let plan = piano(&outcome);
        assert_eq!(
            plan.docs,
            vec![DocId::new("a.md"), DocId::new("c.md")],
            "le note senza occorrenze non entrano nel piano"
        );
        assert_eq!(plan.edit_count(), 3);
        assert!(plan.summary.contains("3 sostituzioni"), "{}", plan.summary);
        assert_eq!(
            host.read_document(&DocId::new("a.md")).unwrap(),
            "il gatto e il gatto"
        );
    }

    #[test]
    fn a_bulk_replace_applies_to_the_documents_it_was_given() {
        let mut host = MemoryHost::new()
            .con_documento("a.md", "il gatto")
            .con_documento("b.md", "il gatto");
        invoke(
            &mut host,
            VAULT_REPLACE,
            json!({ "find": "gatto", "replace": "cane", "docs": ["b.md"] }),
            InvokeMode::Apply,
        )
        .expect("applica");
        assert_eq!(host.read_document(&DocId::new("a.md")).unwrap(), "il gatto");
        assert_eq!(host.read_document(&DocId::new("b.md")).unwrap(), "il cane");
    }

    #[test]
    fn whole_words_only_is_the_difference_between_a_fix_and_a_mess() {
        assert_eq!(
            occurrences("nota, annotazione, nota", "nota", false).len(),
            3,
            "senza il vincolo, `nota` si trova dentro `annotazione`"
        );
        let intere = occurrences("nota, annotazione, nota", "nota", true);
        assert_eq!(intere, vec![Span::new(0, 4), Span::new(19, 23)]);
        // Accentate: il confine è un carattere, non un byte.
        assert!(occurrences("però", "per", true).is_empty());
    }

    #[test]
    fn an_empty_needle_is_refused_even_though_the_schema_accepts_it() {
        let mut host = MemoryHost::new().con_documento("a.md", "x");
        let err = invoke(
            &mut host,
            VAULT_REPLACE,
            json!({ "find": "", "replace": "y" }),
            InvokeMode::DryRun,
        )
        .unwrap_err();
        assert!(matches!(err, PluginError::BadArgs(_)));
    }

    // -----------------------------------------------------------------------
    // note.task.toggle — il cliente one-shot del modello (decisione 0018)
    // -----------------------------------------------------------------------

    /// Il sorgente e il modello che gli corrisponde, con gli span contati a
    /// mano: due task, la seconda annidata nella prima.
    ///
    /// ```text
    /// - [ ] fare la spesa\n  - [x] pane\n
    /// 0  3               19  22 25     32
    /// ```
    ///
    /// L'host in memoria non parsa (e non deve: proverebbe la feature contro un
    /// provider invece che contro il contratto), quindi il modello lo si semina
    /// — ed è l'occasione per dire negli span esattamente cosa il comando si
    /// aspetta di ricevere.
    const TASK_SOURCE: &str = "- [ ] fare la spesa\n  - [x] pane\n";

    fn con_task(symbol_esterno: Option<char>) -> MemoryHost {
        let interna = ListItem {
            blocks: Vec::new(),
            task: Some(TaskMarker {
                symbol: Some('x'),
                span: Span::new(25, 26),
            }),
            span: Span::new(22, 32),
        };
        let esterna = ListItem {
            blocks: vec![Block::List {
                ordered: false,
                items: vec![interna],
                anchor: None,
                span: Span::new(22, 32),
            }],
            task: Some(TaskMarker {
                symbol: symbol_esterno,
                span: Span::new(3, 4),
            }),
            span: Span::new(0, 32),
        };
        let mut model = DocumentModel::empty(DocId::new("nota.md"));
        model.body = vec![Block::List {
            ordered: false,
            items: vec![esterna],
            anchor: None,
            span: Span::new(0, 32),
        }];
        let host = MemoryHost::new()
            .con_documento("nota.md", TASK_SOURCE)
            .con_modello("nota.md", model);
        host.set_active(Some("nota.md"));
        host
    }

    #[test]
    fn checking_a_task_writes_one_character_where_the_model_says() {
        let mut host = con_task(None);
        host.set_caret(Some(10)); // dentro il testo della voce esterna

        let outcome = invoke(&mut host, NOTE_TASK_TOGGLE, json!({}), InvokeMode::Apply)
            .expect("spunta il task sotto il cursore");

        assert_eq!(
            host.read_document(&DocId::new("nota.md")).unwrap(),
            "- [x] fare la spesa\n  - [x] pane\n",
            "un carattere solo: il testo del task, l'indentazione e la voce \
             annidata non si toccano"
        );
        let CommandEffect::Reveal { span, .. } = outcome.effect else {
            panic!("dopo aver scritto, la shell deve sapere dove guardare")
        };
        assert_eq!(span, Span::new(3, 4));
    }

    #[test]
    fn the_innermost_task_wins_when_they_are_nested() {
        let mut host = con_task(None);
        // Una posizione che sta dentro **entrambe** le voci: la annidata è la
        // più stretta, ed è quella che l'utente sta guardando.
        invoke(
            &mut host,
            NOTE_TASK_TOGGLE,
            json!({ "doc": "nota.md", "at": 29 }),
            InvokeMode::Apply,
        )
        .expect("spunta");
        assert_eq!(
            host.read_document(&DocId::new("nota.md")).unwrap(),
            "- [ ] fare la spesa\n  - [ ] pane\n"
        );
    }

    #[test]
    fn a_custom_state_goes_back_to_undone_and_is_not_promoted_to_done() {
        let mut host = con_task(Some('/'));
        host.set_caret(Some(0));
        invoke(&mut host, NOTE_TASK_TOGGLE, json!({}), InvokeMode::Apply).expect("de-spunta");
        assert_eq!(
            host.read_document(&DocId::new("nota.md")).unwrap(),
            "- [ ] fare la spesa\n  - [x] pane\n",
            "«in corso» non lo si promuove a «fatto»: quale sia il suo prossimo \
             stato è una domanda che il prodotto non ha ancora deciso"
        );
    }

    #[test]
    fn a_dirty_buffer_stops_it_because_the_model_is_the_one_of_the_file() {
        let mut host = con_task(None);
        host.set_caret(None); // buffer sporco: nessuno span è vero (decisione 0007)

        let err = invoke(&mut host, NOTE_TASK_TOGGLE, json!({}), InvokeMode::Apply).unwrap_err();
        let PluginError::BadArgs(msg) = err else {
            panic!("uno stato che non permette l'operazione si spiega")
        };
        assert!(msg.contains("non salvate"), "{msg}");
        assert_eq!(
            host.read_document(&DocId::new("nota.md")).unwrap(),
            TASK_SOURCE,
            "e non ha scritto niente"
        );
    }

    #[test]
    fn a_position_that_is_not_a_byte_offset_is_refused_before_the_write() {
        let mut host = con_task(None);
        for at in [json!(-1), json!(3.5), json!(9999)] {
            let err = invoke(
                &mut host,
                NOTE_TASK_TOGGLE,
                json!({ "doc": "nota.md", "at": at }),
                InvokeMode::Apply,
            )
            .unwrap_err();
            assert!(
                matches!(err, PluginError::BadArgs(_)),
                "`at` = {at}: una posizione che non nomina un task si dice, non \
                 si arrotonda a quello vicino"
            );
        }
        assert_eq!(
            host.read_document(&DocId::new("nota.md")).unwrap(),
            TASK_SOURCE
        );
    }

    #[test]
    fn naming_a_note_without_saying_where_does_not_take_the_caret_of_another() {
        let mut host = con_task(None);
        host.set_caret(Some(10));
        let err = invoke(
            &mut host,
            NOTE_TASK_TOGGLE,
            json!({ "doc": "altra.md" }),
            InvokeMode::Apply,
        )
        .unwrap_err();
        assert!(matches!(err, PluginError::BadArgs(_)));
        assert_eq!(
            host.read_document(&DocId::new("nota.md")).unwrap(),
            TASK_SOURCE,
            "il cursore di una nota non è una posizione in un'altra"
        );
    }

    #[test]
    fn simulating_the_toggle_says_which_note_it_would_touch_and_writes_nothing() {
        let mut host = con_task(None);
        host.set_caret(Some(10));
        let outcome =
            invoke(&mut host, NOTE_TASK_TOGGLE, json!({}), InvokeMode::DryRun).expect("simula");
        assert_eq!(piano(&outcome).docs, vec![DocId::new("nota.md")]);
        assert_eq!(piano(&outcome).edit_count(), 1);
        assert_eq!(
            host.read_document(&DocId::new("nota.md")).unwrap(),
            TASK_SOURCE
        );
    }

    #[test]
    fn an_empty_document_list_is_not_the_whole_vault() {
        let mut host = MemoryHost::new().con_documento("a.md", "il gatto");
        let outcome = invoke(
            &mut host,
            VAULT_REPLACE,
            json!({ "find": "gatto", "replace": "cane", "docs": [] }),
            InvokeMode::DryRun,
        )
        .expect("simula");
        assert!(
            piano(&outcome).is_empty(),
            "elenco vuoto = nessuna nota, non «tutte»: è ciò che la spec dichiara"
        );
    }
}
