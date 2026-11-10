//! `note.task.toggle` e le occorrenze di un testo in una nota.

use super::*;

// ---------------------------------------------------------------------------
// note.task.toggle
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
/// Spunta il task che sta sotto una posizione: il **primo cliente one-shot** del
/// modello parsato (§4.2, [decisione 0018](../../../docs/decisions/0182-provider-e-porte-generiche.md)).
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
pub(super) fn notes_task_toggle(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let state = |text: Text| PluginError::BadArgs(text);
    let context = host.active_context();

    let doc = args
        .document("doc")
        .or_else(|| context.as_ref().and_then(|c| c.doc.clone()))
        .ok_or_else(|| state(Text::key(AND_TASK_NO_NOTES)))?;
    // Il simbolo che si scrive nel marcatore è testo del sorgente: vale solo
    // dove il sorgente è prosa.
    crate::formats::require(host, &doc, fub_abi::options::source::PROSE)?;

    // Le posizioni: quelle dette, o tutte quelle del contesto. Le due non si
    // mescolano — un `doc` detto e un `at` no vorrebbe dire spuntare in una
    // nota i task che stanno sotto i cursori di **un'altra**, che è un modo
    // silenzioso di scrivere nel posto sbagliato.
    //
    // `at` è una lista (decisione 0162): uno scalare non è accettato — la
    // convalida di `ParamKind::Numbers` lo rifiuta al confine. Se `at` è
    // assente, si spuntano **tutte** le selezioni placed del contesto e non
    // solo la primaria, che è il gesto per cui il multi-cursore esiste
    // (FEATURES 4.2, §23.4).
    let ats: Vec<usize> = match args.numbers("at") {
        Some(ns) => {
            let mut offsets: Vec<usize> =
                ns.iter().copied().map(position).collect::<Result<_, _>>()?;
            offsets.sort_unstable();
            offsets.dedup();
            offsets
        }
        None => {
            let context = context
                .as_ref()
                .ok_or_else(|| state(Text::key(AND_TASK_NO_POSITION)))?;
            if context.doc.as_ref() != Some(&doc) {
                return Err(state(one(AND_TASK_WRONG_PANE, A_DOC, doc.as_str())));
            }
            let selections = context
                .selections
                .as_ref()
                .ok_or_else(|| state(Text::key(AND_TASK_NO_CARET)))?;
            // La regola dello span della decisione 0007, per la stessa ragione di
            // `selection.wikilink`: a buffer sporco le coordinate valgono per il
            // buffer, e il modello che si sta per chiedere è quello del **file**.
            selections
                .placed()
                .ok_or_else(|| state(Text::key(AND_TASK_DIRTY_BUFFER)))?
                .all()
                .into_iter()
                .map(|s| s.span.start)
                .collect()
        }
    };

    let model = host.read_model(&doc)?;

    // Per ogni offset, il task che lo contiene. Se un offset non ha un task,
    // l'errore nomina **quello** — non l'insieme — perché chi legge sa quale
    // cursore spostare.
    let mut markers: Vec<TaskMarker> = Vec::with_capacity(ats.len());
    for at in &ats {
        let marker = task_at(&model, *at).ok_or_else(|| {
            state(Text::message(
                AND_TASK_NOT_FOUND,
                vec![Arg::int(A_AT, *at as i64), Arg::text(A_DOC, doc.as_str())],
            ))
        })?;
        markers.push(marker);
    }

    // Due cursori nello stesso task lo toggleerebbero due volte — un no-op
    // silenzioso. Si deduplica per span, tenendo il primo (ordine stabile).
    let mut seen: Vec<Span> = Vec::with_capacity(markers.len());
    markers.retain(|m| {
        if seen.contains(&m.span) {
            false
        } else {
            seen.push(m.span);
            true
        }
    });

    // Il simbolo lo scrive il formato: qui si decide soltanto la direzione.
    // Ogni risposta porta la revisione su cui è stata calcolata, e devono
    // essere tutte la stessa: un file cambiato fra due domande è un conflitto,
    // non una spunta scritta su due versioni diverse.
    let mut base: Option<Revision> = None;
    let mut edits = Vec::with_capacity(markers.len());
    let mut done = false;
    // Il sorgente serve solo se si spunta qualcosa: è lì che sta la regola di
    // una ricorrenza. Lo si legge una volta, e deve essere della revisione su
    // cui il formato ha calcolato le spunte.
    let recurring = if markers.iter().any(|m| m.symbol.is_none()) {
        let source = host.read_document(&doc)?;
        let locale = host.user_locale();
        let today = locale
            .to_civil_millis(host.now_unix_millis())
            .div_euclid(86_400_000);
        Some((source, today))
    } else {
        None
    };
    for marker in &markers {
        let to_done = marker.symbol.is_none();
        done |= to_done;
        let request = host
            .task_state_edit(&doc, marker, to_done)?
            .ok_or_else(|| crate::formats::unsupported(&doc))?;
        match &base {
            Some(base) if *base != request.base => {
                return Err(PluginError::Conflict(one(
                    AND_TASK_CHANGED,
                    A_DOC,
                    doc.as_str(),
                )));
            }
            Some(_) => {}
            None => base = Some(request.base),
        }
        // Un compito ricorrente che si spunta lascia sopra di sé il prossimo,
        // come fa Tasks: la riga fatta resta dov'era, con la sua storia.
        if let (true, Some((source, today))) = (to_done, &recurring) {
            if let Some(edit) = next_occurrence(source, marker.span.start, *today) {
                edits.push(edit);
            }
        }
        edits.extend(request.edits);
    }
    let revision = match base {
        Some(base) => base,
        None => host.document_revision(&doc)?,
    };
    if recurring.is_some() && host.document_revision(&doc)? != revision {
        return Err(PluginError::Conflict(one(
            AND_TASK_CHANGED,
            A_DOC,
            doc.as_str(),
        )));
    }
    let request = EditRequest::new(revision, edits);
    let summary = one(
        if done { P_TASK_DONE } else { P_TASK_TODO },
        A_DOC,
        doc.as_str(),
    );

    if mode.is_dry_run() {
        return Ok(
            CommandOutcome::done().with_effect(CommandEffect::Plan(CommandPlan::of_edits(
                summary,
                vec![PlannedEdit::new(doc, request)],
            ))),
        );
    }

    let report = host.apply_edit(&doc, request)?;
    let undo = Undo::of_edits(
        one(U_TASK, A_DOC, doc.as_str()),
        vec![PlannedEdit::new(doc.clone(), report.inverse())],
    );
    let effect = match report.applied.first() {
        Some(applied) => CommandEffect::Reveal {
            doc,
            span: applied.span,
        },
        None => CommandEffect::Done,
    };
    Ok(CommandOutcome::notify(summary)
        .undoable(undo)
        .with_effect(effect))
}

/// Il compito successivo di quello il cui marcatore sta in `at`, da scrivere
/// all'inizio della sua riga, o `None` se la riga non ricorre.
///
/// Si copia la riga e non la voce: le sottovoci appartengono a quella fatta,
/// e il terminatore è quello della riga, perché un file con `\r\n` non ne
/// riceva uno diverso.
fn next_occurrence(source: &str, at: usize, today: i64) -> Option<TextEdit> {
    let start = source.get(..at)?.rfind('\n').map_or(0, |i| i + 1);
    let end = source[at..].find('\n').map_or(source.len(), |i| at + i);
    let (line, eol) = match source[start..end].strip_suffix('\r') {
        Some(line) => (line, "\r\n"),
        None => (&source[start..end], "\n"),
    };
    let next = recurrence::next_line(line, today)?;
    Some(TextEdit::insert(start, format!("{next}{eol}")))
}

/// Un `at` che arriva come numero JSON diventa un offset in byte, o si spiega.
///
/// La specie [`ParamKind::Number`] è un `f64`, e ciò che non è un indice di byte
/// — un negativo, una frazione, un infinito — va rifiutato **qui**: `as usize`
/// lo tradurrebbe in una posizione plausibile e sbagliata (`-1` diventa un
/// numero enorme, `3.9` diventa `3`), e chi legge l'errore dopo avrebbe in mano
/// un task spuntato al posto di un rifiuto.
fn position(n: f64) -> Result<usize, PluginError> {
    if n.is_finite() && n >= 0.0 && n.fract() == 0.0 {
        Ok(n as usize)
    } else {
        Err(PluginError::BadArgs(
            format!("`at` è una posizione in byte: {n} non lo è").into(),
        ))
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
    fn find(blocks: &[Block], at: usize, best: &mut Option<(usize, TaskMarker)>) {
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
                            let width = item.span.end - item.span.start;
                            if best.is_none_or(|(a, _)| width < a) {
                                *best = Some((width, task));
                            }
                        }
                        find(&item.blocks, at, best);
                    }
                }
                // Un task dentro una citazione o dentro un callout è un task, e
                // il modello lo tiene dove sta. Le altre varianti non portano
                // blocchi annidati.
                Block::Quote { blocks, .. } | Block::Custom { blocks, .. } => {
                    find(blocks, at, best)
                }
                _ => {}
            }
        }
    }

    let mut best = None;
    find(&model.body, at, &mut best);
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
    let before = source[..start].chars().next_back();
    let after = source[end..].chars().next();
    let word_part = |c: Option<char>| c.is_some_and(|c| c.is_alphanumeric() || c == '_');
    !word_part(before) && !word_part(after)
}
