//! I comandi che riscrivono testo: `selection.wikilink` e `vault.replace`.

use super::*;

// ---------------------------------------------------------------------------
// selection.wikilink
// ---------------------------------------------------------------------------

/// Il testo selezionato diventa un collegamento alla pagina con quel nome,
/// scritto dal formato della nota (`[[testo]]` in Markdown) — **in ogni punto
/// selezionato**.
///
/// Con più cursori le selezioni sono N e l'azione è una sola (decisione 0093):
/// applicarla alla sola primaria vorrebbe dire lasciare all'utente due dei tre
/// punti che ha appena scelto, che è il gesto per cui il multi-cursore esiste.
/// Gli edit sono **tutti o nessuno**, perché è la garanzia che
/// [`EditRequest`] porta già.
///
/// I cursori senza testo dentro non hanno niente da avvolgere e restano fuori:
/// non in silenzio, però — il messaggio dice **quante** selezioni sono state
/// trasformate, e la prova a vuoto (`mode.is_dry_run()`) elenca gli edit veri.
/// Se nessuna delle N ha del testo, il comando non fa niente e lo dice.
///
/// Lo stato in cui il comando non può agire — nessuna nota, nessuna selezione,
/// oppure un insieme fluttuante (buffer sporco: le coordinate non valgono per
/// il file) — è un [`PluginError::BadArgs`] con dentro la ragione. È il caso
/// che il §12.2 chiuderà bene (un errore *di precondizione* non è un errore di
/// argomenti): finché il confine ha questo vocabolario, un errore che si spiega
/// vale più di un successo che non ha fatto niente — chi invoca può non essere
/// una persona che guarda lo schermo.
pub(super) fn selection_wikilink(
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let state = |key: &str| PluginError::BadArgs(Text::key(key));
    let context = host
        .active_context()
        .ok_or_else(|| state(E_NO_ACTIVE_PANE))?;
    let doc = context.doc.ok_or_else(|| state(AND_NO_OPEN_NOTES))?;
    // Si sostituisce del testo: nel JSON di un canvas sarebbe una scrittura
    // nella struttura. Come si scrive il link lo decide poi il formato. Si
    // chiede prima delle coordinate: le carte scelte in una tela arrivano
    // senza, e il motivo vero è il formato, non il buffer.
    crate::formats::require(host, &doc, fub_abi::options::source::PROSE)?;
    let selections = context
        .selections
        .ok_or_else(|| state(AND_NOTHING_SELECTED))?;
    // La regola dello span della decisione 0007, nel posto in cui la 0093 l'ha
    // messa: senza ancoraggio le coordinate valgono per il buffer e non per il
    // file, e non ne vale **nessuna** — il buffer è uno. Scrivere lì
    // significa tagliare i byte sbagliati proprio mentre l'utente scrive.
    let anchored = selections
        .placed()
        .ok_or_else(|| state(E_DIRTY_SELECTION))?;

    let source = host.read_document(&doc)?;
    // Il testo che verrà sostituito è quello del **file**, non quello del
    // buffer: sono lo stesso testo (uno span esiste solo a buffer pulito), e
    // prenderlo da qui lo rende vero per costruzione invece che per fiducia.
    let mut wrap = Vec::new();
    for selection in anchored.all() {
        if selection.is_empty() {
            continue;
        }
        let selected = source
            .get(selection.span.start..selection.span.end)
            .ok_or_else(|| state(E_SELECTION_OUTSIDE))?;
        if selected.contains('[') || selected.contains(']') {
            return Err(state(AND_SELECTION_HAS_LINK));
        }
        wrap.push((selection.span, selected));
    }
    // Nessuna delle N ha del testo: sono tutti cursori, e un cursore non si
    // avvolge. È lo stesso rifiuto di prima, contato su tutte invece che su una.
    let (_, first_text) = *wrap.first().ok_or_else(|| state(E_EMPTY_SELECTION))?;
    let count = wrap.len();

    let mut edits = Vec::with_capacity(wrap.len());
    for (span, selected) in &wrap {
        let link = crate::formats::wikilink(selected, None, false);
        edits.push(TextEdit::replace(
            *span,
            crate::formats::link_text(host, &doc, &link)?,
        ));
    }
    let request = EditRequest::new(host.document_revision(&doc)?, edits);
    // Una selezione sola si racconta col testo che ha dentro; N si raccontano
    // col numero, perché elencarli non aiuterebbe nessuno a capire cosa sta per
    // succedere.
    let message = |one: &str, many: &str| {
        if count == 1 {
            Text::message(one, vec![Arg::text(A_TEXT, first_text)])
        } else {
            Text::message(many, vec![Arg::int(A_COUNT, count as i64)])
        }
    };
    if mode.is_dry_run() {
        let what = if count == 1 {
            Text::message(
                P_WIKILINK,
                vec![
                    Arg::text(A_TEXT, first_text),
                    Arg::text(A_DOC, doc.as_str()),
                ],
            )
        } else {
            Text::message(
                P_WIKILINK_MANY,
                vec![
                    Arg::int(A_COUNT, count as i64),
                    Arg::text(A_DOC, doc.as_str()),
                ],
            )
        };
        return Ok(
            CommandOutcome::done().with_effect(CommandEffect::Plan(CommandPlan::of_edits(
                what,
                vec![PlannedEdit::new(doc, request)],
            ))),
        );
    }

    let report = host.apply_edit(&doc, request)?;
    let undo = Undo::of_edits(
        message(U_WIKILINK, U_WIKILINK_MANY),
        vec![PlannedEdit::new(doc.clone(), report.inverse())],
    );
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
    Ok(CommandOutcome::notify(message(D_WIKILINK, D_WIKILINK_MANY))
        .undoable(undo)
        .with_effect(effect))
}

// ---------------------------------------------------------------------------
// vault.replace
// ---------------------------------------------------------------------------

pub(super) fn vault_replace(
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
        return Err(PluginError::BadArgs(Text::key(E_EMPTY_FIND)));
    }

    // Senza `docs` si scandisce il vault intero, una lettura per nota. Sembra il
    // posto dove chiedere all'indice quali note contengono l'ago, e non lo è:
    // l'indice tiene la **proiezione a testo piano** del documento (niente
    // frontmatter, niente marcatori, i wikilink ridotti all'etichetta — vedi
    // `fub-kernel/src/occurrences.rs`), mentre `occurrences` cerca byte in un
    // file. Un prefiltro non renderebbe questo comando più rapido: lo
    // renderebbe incompleto, in silenzio. Il conto e la prova stanno in
    // `tests/chi_risponde_apre_i_byte.rs`.
    let explicit = args.documents("docs");
    let named = explicit.is_some();
    let targets = match explicit {
        Some(docs) => docs,
        None => host.list_documents(None)?.items,
    };

    let mut planned = Vec::new();
    let mut counts = Vec::new();
    let mut skipped: Vec<Failure> = Vec::new();
    for doc in targets {
        // Sostituire nei byte ha senso solo dove il sorgente è prosa: nel JSON
        // di un canvas o nello YAML di un `.base` cambia chiavi e struttura.
        // Chi scandisce il vault salta quei documenti; chi li ha nominati
        // riceve il rifiuto come esito parziale.
        if !crate::formats::understands(host, &doc, fub_abi::options::source::PROSE) {
            if named {
                skipped.push(Failure::of(doc.clone(), crate::formats::unsupported(&doc)));
            }
            continue;
        }
        let source = host.read_document(&doc)?;
        let spans = occurrences(&source, find, whole_word);
        if spans.is_empty() {
            continue;
        }
        counts.push(spans.len());
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

    let occorrenze: usize = counts.iter().sum();
    let summary = count_pair(P_REPLACE, A_OCCURRENCES, occorrenze, A_NOTES, planned.len());

    if mode.is_dry_run() {
        let attempted = planned.len() + skipped.len();
        let mut outcome = CommandOutcome::done()
            .with_effect(CommandEffect::Plan(CommandPlan::of_edits(summary, planned)));
        if !skipped.is_empty() {
            outcome = outcome.partially(Partial::of(attempted, attempted - skipped.len(), skipped));
        }
        return Ok(outcome);
    }

    // Si applica tutto, anche se una nota fallisce: fermarsi a metà lascerebbe
    // il vault fra due stati senza dire quali note sono in quale. Ciò che non è
    // riuscito si nomina — un conflitto qui è la cosa che il piano esisteva per
    // rendere visibile, non un dettaglio da inghiottire.
    let mut made = 0usize;
    // Le occorrenze contano solo nelle note scritte davvero.
    let mut replaced = 0usize;
    let mut failed: Vec<Failure> = skipped;
    // L'inverso si raccoglie **mentre si scrive**, non ricalcolandolo dopo: il
    // rapporto di ogni modifica porta le coordinate nuove e il testo tolto, e
    // `EditReport::inverse` ne fa una richiesta come le altre (decisione 0008).
    // Ricalcolarlo dopo vorrebbe dire rileggere N documenti e cercarci dentro
    // il testo sostituito — cioè indovinare quali occorrenze erano le nostre.
    let mut back: Vec<PlannedEdit> = Vec::new();
    let before = planned.len() + failed.len();
    for (PlannedEdit { doc, edit }, count) in planned.into_iter().zip(counts) {
        match host.apply_edit(&doc, edit) {
            Ok(report) => {
                made += 1;
                replaced += count;
                back.push(PlannedEdit::new(doc, report.inverse()));
            }
            Err(and) => failed.push(Failure::of(doc, and)),
        }
    }
    let notify = if failed.is_empty() {
        count_pair(D_REPLACE, A_OCCURRENCES, replaced, A_NOTES, made)
    } else {
        Text::message(
            D_REPLACE_PARTIAL,
            vec![
                Arg::int(A_OCCURRENCES, replaced as i64),
                Arg::int(A_NOTES, made as i64),
                Arg::text(A_FAILED, why(&failed)),
            ],
        )
    };
    // Lo stesso conto, come **dato**: la frase qui sopra la legge un umano, e
    // fino alla §23.14 era l'unica forma in cui questa notizia esisteva —
    // un'automazione che invocava `vault.replace` non aveva modo di sapere che
    // undici note su dodici erano cambiate, se non leggendo italiano.
    let count = Partial::of(before, made, failed);
    // Anche una sostituzione **parziale** è annullabile, e per ciò che è
    // riuscito: è il verso giusto, perché è proprio quando qualcosa è andato
    // storto che si vuole tornare indietro. Le note fallite non hanno un
    // inverso da fare — non è successo niente, su di loro.
    let undo = Undo::of_edits(
        count_pair(U_REPLACE, A_OCCURRENCES, replaced, A_NOTES, made),
        back,
    );
    Ok(CommandOutcome::notify(notify)
        .undoable(undo)
        .partially(count))
}
