//! Inserire data, ora e template in una nota, con il frontmatter che si unisce.

use super::*;

/// Il documento e la posizione in cui inserire: `doc` detto, o quello aperto;
/// `at` detto, o il cursore del pannello attivo. Solo selezioni **placed**:
/// a buffer sporco le coordinate valgono per il buffer e non per il file, e
/// scriverci sopra taglierebbe i byte sbagliati mentre l'utente scrive
/// (decisione 0007). La shell fa flush prima della patch; il comando rifiuta
/// invece di indovinare.
pub(super) fn insert_target(
    args: Args<'_>,
    host: &dyn HostApi,
) -> Result<(DocId, usize), PluginError> {
    let context = host.active_context();
    let doc = args
        .document(DOC)
        .or_else(|| context.as_ref().and_then(|c| c.doc.clone()))
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_NO_DOC)))?;
    // Ciò che si inserisce è testo di una nota: in un canvas o in un `.base`
    // finirebbe dentro la struttura.
    crate::formats::require(host, &doc, fub_abi::options::source::PROSE)?;
    if let Some(ns) = args.numbers(AT) {
        let at = ns.first().copied().unwrap_or(0.0);
        return position(at).map(|at| (doc, at));
    }
    let Some(context) = context else {
        return Err(PluginError::BadArgs(Text::key(E_NO_DOC)));
    };
    if context.doc.as_ref() != Some(&doc) {
        return Err(PluginError::BadArgs(Text::message(
            E_NO_DOC,
            vec![Arg::text(A_DOC, doc.as_str())],
        )));
    }
    let selections = context
        .selections
        .as_ref()
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_DIRTY)))?;
    let placed = selections
        .placed()
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_DIRTY)))?;
    Ok((doc, placed.primary.span.start))
}

/// Un `at` JSON diventa un offset in byte, o si spiega. Come `position` in
/// `commands.rs`: `as usize` tradurrebbe `-1` in un numero enorme e `3.9` in
/// `3` — una posizione plausibile e sbagliata.
fn position(n: f64) -> Result<usize, PluginError> {
    if n.is_finite() && n >= 0.0 && n.fract() == 0.0 {
        Ok(n as usize)
    } else {
        Err(PluginError::BadArgs(Text::message(
            E_AT_NOT_OFFSET,
            vec![Arg::text(A_VALUE, n.to_string())],
        )))
    }
}

/// Inserisce data/ora di adesso al cursore (P05.3): `date`, `time` o `datetime`
/// nel fuso dell'utente, con l'orologio a 12/24 ore dalle impostazioni.
/// Scrittura chirurgica CAS (`EditRequest` + revisione): conflitto = `Conflict`,
/// mai sovrascrittura. Dry-run: piano con l'edit vero.
pub(super) fn insert_datetime(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let (doc, at) = insert_target(args, host)?;
    let format = args
        .text(FORMAT)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| insert_format(host));
    let value = datetime_now(host, &format)?;
    let source = host.read_document(&doc)?;
    let clamped = at.min(source.len());
    let at = snap_to_boundary(&source, clamped);
    let revision = host.document_revision(&doc)?;
    let request = EditRequest::new(revision, vec![TextEdit::insert(at, &value)]);
    if mode.is_dry_run() {
        return Ok(
            CommandOutcome::done().with_effect(CommandEffect::Plan(CommandPlan::of_edits(
                Text::message(
                    P_INSERT_DT,
                    vec![Arg::text(A_VALUE, &value), Arg::text(A_DOC, doc.as_str())],
                ),
                vec![PlannedEdit::new(doc, request)],
            ))),
        );
    }
    let report = host.apply_edit(&doc, request)?;
    let undo = Undo::of_edits(
        Text::message(
            U_INSERT_DT,
            vec![Arg::text(A_VALUE, &value), Arg::text(A_DOC, doc.as_str())],
        ),
        vec![PlannedEdit::new(doc.clone(), report.inverse())],
    );
    let done_msg = Text::message(
        D_INSERT_DT,
        vec![Arg::text(A_VALUE, &value), Arg::text(A_DOC, doc.as_str())],
    );
    let effect = match report.applied.first() {
        Some(applied) => CommandEffect::Reveal {
            doc,
            span: applied.span,
        },
        None => CommandEffect::Done,
    };
    Ok(CommandOutcome::notify(done_msg)
        .undoable(undo)
        .with_effect(effect))
}

/// Data/ora di adesso nel fuso dell'utente. `time` può essere `HH:MM` detto
/// (per i test e per chi compone): stretto come la data, mai tollerante.
pub(super) fn datetime_now(host: &dyn HostApi, format: &str) -> Result<String, PluginError> {
    let locale = host.user_locale();
    let (y, m, d, hh, mm) = civil_parts(host.now_unix_millis(), &locale)?;
    let date = format!("{y:04}-{m:02}-{d:02}");
    let time = match host.setting(TIME_FORMAT_KEY) {
        Ok(fub_abi::settings::SettingValue::Text(s)) if s.trim() == CLOCK_12 => {
            format_time(hh, mm, HourCycle::H12)
        }
        _ => format_time(hh, mm, HourCycle::H23),
    };
    match format {
        ISO_DATE => Ok(date),
        CLOCK_TIME => Ok(time),
        CLOCK_DATETIME => Ok(format!("{date} {time}")),
        other if other.contains(':') => {
            let (h, m) = valid_time(other)?;
            Ok(format_time(h, m, HourCycle::H23))
        }
        other => Err(PluginError::BadArgs(Text::message(
            E_BAD_TIME,
            vec![Arg::text(A_VALUE, other)],
        ))),
    }
}

/// Sposta un offset su un confine di carattere e fuori da un `\r\n`: mai un
/// taglio a metà carattere e mai un `\r` orfano. Il cursore della shell può
/// arrivare da coordinate di riga/colonna arrotondate; la disciplina
/// dell'edit la fa rispettare comunque l'host, qui si evita il rifiuto ovvio.
pub(super) fn snap_to_boundary(source: &str, at: usize) -> usize {
    let mut at = at.min(source.len());
    while at < source.len() && !source.is_char_boundary(at) {
        at += 1;
    }
    if text_policy::splits_newline(source, at) && at > 0 {
        at -= 1;
    }
    at
}

/// Inserisce un template al cursore e fonde le proprietà assenti (P05.2):
/// il corpo va nel testo via edit chirurgico CAS; ogni chiave del frontmatter
/// del template assente nel target si scrive via `run_command`
/// `note.property.set` — mai YAML diretto. Se una proprietà non si fonde, il
/// testo resta inserito e il guasto si conta e si dice (`Partial`), non si
/// butta il lavoro fatto. Template senza frontmatter = solo testo.
pub(super) fn insert_template(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let template = args
        .text(TEMPLATE)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_NO_TEMPLATE)))?;
    let tpl = DocId::new(with_extension(host, template)?);
    let (doc, at) = insert_target(args, host)?;
    let merge_props = args.flag(MERGE, true);
    let grezzo = host.read_document(&tpl)?;
    let ctx = context(host)?;
    let expanded = expand_full(&grezzo, &file_name(&doc), &ctx, host)?;
    // Il frontmatter si separa solo se il formato del template lo legge:
    // altrove le righe `---` in testa sono testo come le altre.
    let (props, body) = if crate::formats::understands(host, &tpl, syntax::FRONTMATTER) {
        split_frontmatter(&expanded)?
    } else {
        (Vec::new(), expanded)
    };
    let missing = if merge_props && !props.is_empty() {
        missing_properties(host, &doc, &props)?
    } else {
        Vec::new()
    };
    let source = host.read_document(&doc)?;
    let at = snap_to_boundary(&source, at.min(source.len()));
    let revision = host.document_revision(&doc)?;
    let request = EditRequest::new(revision, vec![TextEdit::insert(at, &body)]);
    let summary = Text::message(
        P_INSERT_TPL,
        vec![
            Arg::text(TEMPLATE, tpl.as_str()),
            Arg::text(A_DOC, doc.as_str()),
        ],
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
    let mut failed: Vec<Failure> = Vec::new();
    let mut property_undo: Vec<Vec<UndoStep>> = Vec::new();
    for (key, value) in missing {
        let expected = serde_json::json!({ "kind": "absent" }).to_string();
        match host.run_command(
            PROP_SET,
            serde_json::json!({ DOC: doc.as_str(), "key": key, "value": value, "expected": expected }),
        ) {
            Ok(outcome) => {
                if let Some(undo) = outcome.undo {
                    property_undo.push(undo.steps);
                }
            }
            Err(and) => failed.push(Failure::other(and)),
        }
    }
    let notify = if failed.is_empty() {
        Text::message(
            D_INSERT_TPL,
            vec![
                Arg::text(TEMPLATE, tpl.as_str()),
                Arg::text(A_DOC, doc.as_str()),
            ],
        )
    } else {
        Text::message(
            D_INSERT_TPL_PARTIAL,
            vec![
                Arg::text(TEMPLATE, tpl.as_str()),
                Arg::text(A_DOC, doc.as_str()),
                Arg::text(A_FAILED, why(&failed)),
            ],
        )
    };
    // Each property owner inverse expects the preceding revision. Replay them
    // backwards before the body inverse, which expects the post-insertion text.
    let mut steps: Vec<UndoStep> = property_undo.into_iter().rev().flatten().collect();
    steps.push(UndoStep::Edit(PlannedEdit::new(
        doc.clone(),
        report.inverse(),
    )));
    let undo = Undo {
        label: Text::message(
            U_INSERT_TPL,
            vec![
                Arg::text(TEMPLATE, tpl.as_str()),
                Arg::text(A_DOC, doc.as_str()),
            ],
        ),
        steps,
    };
    let effect = match report.applied.first() {
        Some(applied) => CommandEffect::Reveal {
            doc,
            span: applied.span,
        },
        None => CommandEffect::Done,
    };
    Ok(CommandOutcome::notify(notify)
        .undoable(undo)
        .partially(Partial::of(1, usize::from(failed.is_empty()), failed))
        .with_effect(effect))
}

/// Il frontmatter `---\n…\n---\n` in testa a `src`, dopo un eventuale BOM:
/// l'intervallo del YAML e l'offset dove comincia il corpo, dopo la riga che lo
/// chiude. `None` se la testa non apre un frontmatter o non lo chiude.
///
/// La regola è quella con cui il provider Markdown lo legge (il delimitatore
/// `---` di comrak): chiude soltanto una riga che è esattamente `---`, non
/// indentata, e la cerca prima seguita da CRLF, poi da LF, poi dalla fine del
/// file. Una regola più larga chiuderebbe su un `---` dentro un blocco YAML, e
/// le proprietà si spezzerebbero; una diversa farebbe di un testo un
/// frontmatter.
pub(super) fn frontmatter_bounds(src: &str) -> Option<(std::ops::Range<usize>, usize)> {
    let bom = text_policy::bom_len(src);
    let after_open = src[bom..].strip_prefix("---")?;
    let eol = if after_open.starts_with('\n') {
        1
    } else if after_open.starts_with("\r\n") {
        2
    } else {
        return None;
    };
    let open = bom + "---".len() + eol;
    let rest = &src[open..];
    let close = ["\n---\r\n", "\n---\n", "\n---"]
        .iter()
        .find_map(|delimiter| rest.find(delimiter))?;
    let after = open + close + "\n---".len();
    let tail = &src[after..];
    let body = if tail.is_empty() {
        after
    } else if tail.starts_with('\n') {
        after + 1
    } else if tail.starts_with("\r\n") {
        after + 2
    } else {
        return None;
    };
    Some((open..open + close, body))
}

/// Divide `---\n…\n---\n` dal corpo, per un template il cui formato dichiara
/// [`syntax::FRONTMATTER`]: il frontmatter si riconosce solo in testa
/// (dopo un eventuale BOM), il corpo resta byte-identico. Le proprietà sono
/// parse come una mappa YAML vera e serializzate una per una come YAML flow:
/// liste e strutture annidate restano strutture, mai chiavi piatte inventate.
pub(super) fn split_frontmatter(src: &str) -> Result<(Vec<(String, String)>, String), PluginError> {
    let Some((yaml, body_start)) = frontmatter_bounds(src) else {
        return Ok((Vec::new(), src.to_string()));
    };
    let yaml = src[yaml]
        .trim_start_matches(['\n', '\r'])
        .trim_end_matches(['\n', '\r']);
    let body = format!(
        "{}{}",
        &src[..text_policy::bom_len(src)],
        &src[body_start..]
    );
    let parsed = if yaml.is_empty() {
        serde_json::Value::Null
    } else if !yaml_rule::within_budget(yaml) {
        return Err(PluginError::BadArgs(Text::message(
            E_BAD_FRONTMATTER,
            vec![Arg::text("reason", yaml_rule::OVER_BUDGET)],
        )));
    } else {
        serde_yaml_ng::from_str::<serde_json::Value>(yaml).map_err(|and| {
            PluginError::BadArgs(Text::message(
                E_BAD_FRONTMATTER,
                vec![Arg::text("reason", and.to_string())],
            ))
        })?
    };
    let map = match parsed {
        serde_json::Value::Object(map) => map,
        serde_json::Value::Null => serde_json::Map::new(),
        _ => return Err(PluginError::BadArgs(Text::key(E_BAD_FRONTMATTER_MAP))),
    };
    let properties = map
        .into_iter()
        .map(|(key, value)| (key, serde_json::to_string(&value).expect("JSON value")))
        .collect();
    Ok((properties, body))
}

/// Le coppie del template la cui chiave manca nel target. Il target si legge
/// via `read_model` (il parse vero, di PropertiesOwner); se il modello è
/// illeggibile si rifiuta prima dell'inserimento, mai un merge inventato.
fn missing_properties(
    host: &dyn HostApi,
    doc: &DocId,
    props: &[(String, String)],
) -> Result<Vec<(String, String)>, PluginError> {
    let model = host.read_model(doc)?;
    Ok(props
        .iter()
        .filter(|(k, _)| model.frontmatter.get(k).is_none())
        .cloned()
        .collect())
}

pub(super) fn why(failures: &[Failure]) -> String {
    failures
        .iter()
        .map(|g| match &g.subject {
            Some(doc) => format!("«{doc}» ({})", g.error),
            None => g.error.to_string(),
        })
        .collect::<Vec<_>>()
        .join("; ")
}
