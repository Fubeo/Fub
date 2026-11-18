//! Le note da un template e la nota del giorno: il contesto della data,
//! l'espansione dei segnaposto, date e ore valide.

use super::*;

pub(super) fn from_template(
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
    let title = args
        .text(NAME)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| file_name(&tpl));
    if title.is_empty() {
        return Err(PluginError::BadArgs(Text::message(
            E_EMPTY_TEMPLATE,
            vec![Arg::text("doc", tpl.as_str())],
        )));
    }
    let folder = folder_arg(args.text(FOLDER))?;
    // Un `name` con slash nomina già la cartella: `folder` la prepende solo
    // quando il nome è nudo. Mai una cartella inventata in silenzio.
    let wanted = match (folder, title.contains('/')) {
        (Some(folder), false) => format!("{folder}/{title}"),
        _ => title,
    };
    let id = host.free_name(&DocId::new(with_extension(host, &wanted)?));
    let summary = Text::message(P_FROM, vec![Arg::text(TEMPLATE, tpl.as_str())]);
    if mode.is_dry_run() {
        return Ok(plan(summary, id));
    }
    let grezzo = host.read_document(&tpl)?;
    let ctx = context(host)?;
    let body = expand_full(&grezzo, &file_name(&id), &ctx, host)?;
    host.create_document(&id, &body)?;
    Ok(created(
        Text::message(
            D_FROM,
            vec![
                Arg::text("doc", id.as_str()),
                Arg::text(TEMPLATE, tpl.as_str()),
            ],
        ),
        Text::message(U_FROM, vec![Arg::text("doc", id.as_str())]),
        id,
    ))
}

/// Una nota nuova da un tipo di nota: in testa `tipo` col link al tipo e le
/// proprietà del tipo, vuote (falso per una casella, `[]` per un elenco);
/// sotto, il testo del tipo con le variabili `{{…}}` sostituite. Nasce nella
/// cartella `folder` se chi chiede ne dà una, se no in quella del tipo, se no
/// alla radice; il nome, se manca, è «Senza titolo». Un tipo che manca, che è
/// di più o che non si legge non crea niente. `expected_revision` è la
/// revisione del file del tipo letta da chi chiede: se il tipo è cambiato, si
/// ferma. L'annulla porta la nota nel cestino, come per un template.
pub(super) fn from_type(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let raw = args.text(TYPE).unwrap_or_default();
    let found = crate::note_types::find_type(host, raw)?;
    crate::note_types::check_revision(host, &found, args.text(EXPECTED_REVISION))?;
    let title = args
        .text(NAME)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| super::names::untitled(host));
    let folder = folder_arg(args.text(FOLDER))?.or_else(|| found.folder.clone());
    // Come `note.from_template`: un nome con `/` nomina già la cartella.
    let wanted = match (folder, title.contains('/')) {
        (Some(folder), false) => format!("{folder}/{title}"),
        _ => title,
    };
    let id = host.free_name(&DocId::new(with_extension(host, &wanted)?));
    crate::formats::require(host, &id, syntax::FRONTMATTER)?;
    let name = found.reference.name.clone();
    let summary = Text::message(P_FROM_TYPE, vec![Arg::text(TYPE, &name)]);
    if mode.is_dry_run() {
        return Ok(plan(summary, id));
    }
    let ctx = context(host)?;
    let body = expand_full(&found.template, &file_name(&id), &ctx, host)?;
    let registry = registry(host);
    let mut head = String::from("---\n");
    head.push_str(&crate::note_types::frontmatter_line(
        crate::note_types::TYPE_KEY,
        &serde_json::Value::String(found.reference.wikilink()),
    ));
    head.push('\n');
    for property in &found.properties {
        if property.key == crate::note_types::TYPE_KEY {
            continue;
        }
        head.push_str(&crate::note_types::frontmatter_line(
            &property.key,
            &property.empty_value(&registry),
        ));
        head.push('\n');
    }
    head.push_str("---\n");
    host.create_document(&id, &format!("{head}{body}"))?;
    Ok(created(
        Text::message(
            D_FROM_TYPE,
            vec![Arg::text("doc", id.as_str()), Arg::text(TYPE, &name)],
        ),
        Text::message(
            U_FROM_TYPE,
            vec![Arg::text("doc", id.as_str()), Arg::text(TYPE, &name)],
        ),
        id,
    ))
}

/// Il registro dei tipi di proprietà del vault, per scegliere con che valore
/// nasce una proprietà. Illeggibile o assente vale vuoto: decide il tipo.
fn registry(host: &dyn ReadApi) -> fub_abi::model::PropertyTypes {
    match host.setting(PROPERTY_TYPES_KEY) {
        Ok(fub_abi::settings::SettingValue::Text(raw)) => {
            serde_json::from_str(&raw).unwrap_or_default()
        }
        _ => fub_abi::model::PropertyTypes::default(),
    }
}

pub(super) fn daily(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let date = match args.text(DATE).map(str::trim).filter(|s| !s.is_empty()) {
        Some(raw) => valid_date(raw)?,
        None => today(host)?,
    };
    let folder = args
        .text(FOLDER)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(valid_folder)
        .transpose()?
        .unwrap_or_else(|| daily_folder(host));
    let template = args
        .text(TEMPLATE)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| daily_template(host));
    let extension = crate::formats::new_note_extension(host)?;
    let name = daily_name(
        &daily_format(host),
        &date,
        host.user_locale().language_base(),
    );
    let path = format!("{folder}/{name}.{extension}");
    if check_name(&path, Naming::New).is_err() {
        return Err(PluginError::BadArgs(Text::message(
            E_BAD_DAILY_FORMAT,
            vec![Arg::text(A_VALUE, &name)],
        )));
    }
    let id = DocId::new(path);
    let title = name.rsplit('/').next().unwrap_or(&name).to_string();
    let summary = Text::message(P_DAILY, vec![Arg::text(DATE, &date)]);
    if mode.is_dry_run() {
        return Ok(plan(summary, id));
    }
    let exists = host.list_documents(None)?.items.iter().any(|d| d == &id);
    if exists {
        return Ok(CommandOutcome::notify(Text::message(
            D_DAILY_OPEN,
            vec![Arg::text(DATE, &date)],
        ))
        .with_effect(CommandEffect::Navigate { doc: id }));
    }
    let ctx = context_of(host, &date)?;
    let body = match host.read_document(&DocId::new(with_extension(host, &template)?)) {
        Ok(grezzo) => expand_full(&grezzo, &title, &ctx, host)?,
        Err(PluginError::NotFound(_)) => String::new(),
        Err(and) => return Err(and),
    };
    host.create_document(&id, &body)?;
    link_daily_property(host, &id, &date);
    Ok(created(
        Text::message(D_DAILY, vec![Arg::text(DATE, &date)]),
        Text::message(U_DAILY, vec![Arg::text(DATE, &date)]),
        id,
    ))
}

/// Collega la proprietà `date` alla nota giornaliera corrispondente (P05.1):
/// se la nota ha già una proprietà `date` col valore di oggi, resta; se non
/// ce l'ha, la si scrive via comando — mai YAML diretto, PropertiesOwner resta
/// proprietario. Best-effort: un vault senza quella chiave o un comando che
/// rifiuta non fa fallire la creazione della nota.
///
/// Soltanto per `note.daily`: una nota da template generico non ha un giorno
/// a cui legarsi, e ricevere una proprietà che il template non ha ne
/// cambierebbe i metadati (difetto I22).
fn link_daily_property(host: &mut dyn HostApi, id: &DocId, date: &str) {
    let model = match host.read_model(id) {
        Ok(model) => model,
        Err(_) => return,
    };
    if model.frontmatter.get(DATE).is_some() {
        return;
    }
    let _ = host.run_command(
        PROP_SET,
        serde_json::json!({ DOC: id.as_str(), "key": DATE, "value": date }),
    );
}

pub(super) fn created(notify: Text, undo: Text, id: DocId) -> CommandOutcome {
    CommandOutcome::notify(notify)
        .undoable(Undo::by_command(
            undo,
            TRASH,
            serde_json::json!({ "doc": id.as_str() }),
        ))
        .with_effect(CommandEffect::Navigate { doc: id })
}

pub(super) fn plan(summary: Text, id: DocId) -> CommandOutcome {
    CommandOutcome::done().with_effect(CommandEffect::Plan(
        CommandPlan::of_edits(summary, Vec::new()).with_doc(id),
    ))
}

/// Contesto per una data `YYYY-MM-DD` con l'ora di adesso: è ciò che una
/// giornaliera di un altro giorno vede come `{{date}}`.
fn context_of(host: &dyn ReadApi, date: &str) -> Result<Ctx, PluginError> {
    let locale = host.user_locale();
    let (_, _, _, hh, mm) = civil_parts(host.now_unix_millis(), &locale)?;
    let time = format_time(hh, mm, locale.hour_cycle);
    Ok(Ctx {
        date: date.to_string(),
        time: time.clone(),
        datetime: format!("{date} {time}"),
        year: date.get(..4).unwrap_or("").to_string(),
        month: date.get(5..7).unwrap_or("").to_string(),
        day: date.get(8..10).unwrap_or("").to_string(),
        hour: format!("{hh:02}"),
        minute: format!("{mm:02}"),
    })
}

/// Vocabolario **chiuso** delle variabili (P05.2): titolo, date/ore civili,
/// nome file e numero casuale per i nomi. Nessun callback, nessuno scripting:
/// ciò che non sta nel vocabolario resta testo identico, mai errore e mai
/// stringa vuota.
pub(super) fn expand_full(
    src: &str,
    title: &str,
    ctx: &Ctx,
    host: &dyn HostApi,
) -> Result<String, PluginError> {
    const KNOWN: &[&str] = &[
        "{{title}}",
        "{{name}}",
        "{{date}}",
        "{{time}}",
        "{{datetime}}",
        "{{year}}",
        "{{month}}",
        "{{day}}",
        "{{hour}}",
        "{{minute}}",
        "{{filename}}",
        "{{random}}",
    ];
    // A title can itself contain a placeholder expanded by the later pass.
    if !KNOWN.iter().any(|k| src.contains(*k)) {
        return Ok(src.to_string());
    }
    let random = if src.contains("{{random}}")
        || (title.contains("{{random}}")
            && (src.contains("{{title}}")
                || src.contains("{{name}}")
                || src.contains("{{filename}}")))
    {
        Some(random_suffix(host)?)
    } else {
        None
    };
    // Le `replace` a cascata restano per il caso pieno — una sostituzione può
    // contenere un segnaposto successivo, e una passata sola non lo
    // riprodurrebbe. Una variabile ignota resta testo: non si tocca.
    let named = src
        .replace("{{title}}", title)
        .replace("{{name}}", title)
        .replace("{{filename}}", title);
    // Le date e le ore sono del vocabolario condiviso con le ricette.
    Ok(expand_dates(&named, ctx).replace("{{random}}", random.as_deref().unwrap_or("{{random}}")))
}

/// Four readable hexadecimal digits from the host entropy capability. A
/// missing capability is an error, never a silently repeated identifier.
fn random_suffix(host: &dyn HostApi) -> Result<String, PluginError> {
    let bytes = host.random_bytes(2)?;
    Ok(format!("{:02X}{:02X}", bytes[0], bytes[1]))
}

pub(super) fn today(host: &dyn ReadApi) -> Result<String, PluginError> {
    Ok(context(host)?.date)
}

/// Il titolo di una nota: il nome del file senza l'estensione, qualunque sia.
pub(super) fn file_name(id: &DocId) -> String {
    id.page_name().to_string()
}

/// Un nome che non porta già un formato del vault riceve l'estensione delle
/// note nuove ([`crate::formats::with_extension`]).
pub(super) fn with_extension(
    host: &(impl fub_abi::traits::VaultRead + fub_abi::traits::SettingsRead + ?Sized),
    name: &str,
) -> Result<String, PluginError> {
    Ok(crate::formats::with_extension(
        host,
        name,
        &crate::formats::new_note_extension(host)?,
    ))
}

/// Una data `YYYY-MM-DD`, o il perché no. Il formato è stretto di proposito:
/// la giornaliera è un path, e un path tollerante (`5/7/2026`) è traversal o
/// ambiguità fra fusi — la lettura tollerante resta alle proprietà.
pub(super) fn valid_date(raw: &str) -> Result<String, PluginError> {
    let shaped = raw.len() == 10
        && raw.as_bytes()[4] == b'-'
        && raw.as_bytes()[7] == b'-'
        && raw[..4].chars().all(|c| c.is_ascii_digit())
        && raw[5..7].chars().all(|c| c.is_ascii_digit())
        && raw[8..].chars().all(|c| c.is_ascii_digit());
    let ok = shaped
        && valid_civil_date(
            raw[..4].parse::<i32>().unwrap_or_default(),
            raw[5..7].parse::<u8>().unwrap_or_default(),
            raw[8..].parse::<u8>().unwrap_or_default(),
        );
    if ok {
        Ok(raw.to_string())
    } else {
        Err(PluginError::BadArgs(Text::message(
            E_BAD_DATE,
            vec![Arg::text(A_VALUE, raw)],
        )))
    }
}

/// Un orario `HH:MM` 24h, o il perché no. Stretto come la data: un inserimento
/// tollerante scriverebbe nel testo ciò che nessuno ha chiesto.
pub(super) fn valid_time(raw: &str) -> Result<(u64, u64), PluginError> {
    let parts: Vec<&str> = raw.split(':').collect();
    let ok = parts.len() == 2
        && parts[0].len() == 2
        && parts[1].len() == 2
        && parts[0].chars().all(|c| c.is_ascii_digit())
        && parts[1].chars().all(|c| c.is_ascii_digit());
    let (h, m) = (
        parts
            .first()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(99),
        parts
            .get(1)
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(99),
    );
    if ok && h < 24 && m < 60 {
        Ok((h, m))
    } else {
        Err(PluginError::BadArgs(Text::message(
            E_BAD_TIME,
            vec![Arg::text(A_VALUE, raw)],
        )))
    }
}
