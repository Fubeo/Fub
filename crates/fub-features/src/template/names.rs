//! I nomi delle note nuove: cartella, formato e template della nota del
//! giorno, note uniche e note a caso (`daily_name` sta nella radice).

use super::*;

pub(super) fn folder_arg(raw: Option<&str>) -> Result<Option<String>, PluginError> {
    raw.map(str::trim)
        .filter(|s| !s.is_empty())
        .map(valid_folder)
        .transpose()
}

/// La cartella delle giornaliere decisa nelle impostazioni, o il default. Una
/// parola illeggibile nel file vale il default — come `date_formats` del
/// kernel — invece di rendere il vault illeggibile.
pub(super) fn daily_folder(host: &dyn ReadApi) -> String {
    match host.setting(DAILY_FOLDER_KEY) {
        Ok(fub_abi::settings::SettingValue::Text(s)) => {
            valid_folder(&s).unwrap_or_else(|_| FOLDER_DAILY.into())
        }
        _ => FOLDER_DAILY.into(),
    }
}

pub(super) fn daily_format(host: &dyn ReadApi) -> String {
    match host.setting(DAILY_FORMAT_KEY) {
        Ok(fub_abi::settings::SettingValue::Text(s)) if !s.trim().is_empty() => {
            s.trim().to_string()
        }
        _ => DAILY_FORMAT_DEFAULT.into(),
    }
}

pub(super) fn daily_template(host: &dyn HostApi) -> String {
    match host.setting(DAILY_TEMPLATE_KEY) {
        Ok(fub_abi::settings::SettingValue::Text(s)) => {
            let s = s.trim();
            if s.is_empty() {
                DAILY_TEMPLATE.into()
            } else {
                s.to_string()
            }
        }
        _ => DAILY_TEMPLATE.into(),
    }
}

pub(super) fn insert_format(host: &dyn HostApi) -> String {
    match host.setting(DATE_FORMAT_KEY) {
        Ok(fub_abi::settings::SettingValue::Text(s)) => match s.trim() {
            CLOCK_TIME | CLOCK_DATETIME | ISO_DATE => s.trim().to_string(),
            _ => ISO_DATE.into(),
        },
        _ => ISO_DATE.into(),
    }
}

/// Crea una nota senza sovrascrivere mai (P05.3): `name`, poi `name 1`, …
/// via `free_name` + `create_document` (che rifiuta se il nome è occupato).
/// Con `random: true` il nome nasce dal caso dell'host (`random_bytes`:
/// negato = `PermissionDenied`, mai zeri). Dry-run: piano col nome libero.
pub(super) fn unique(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let template = args
        .text(TEMPLATE)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    if mode.is_dry_run() {
        let id = unique_name(args, host)?;
        return Ok(plan(
            Text::message(P_UNIQUE, vec![Arg::text(A_DOC, id.as_str())]),
            id,
        ));
    }
    let id = unique_name(args, host)?;
    let body = match template {
        Some(tpl) => {
            let grezzo = host.read_document(&DocId::new(with_extension(host, &tpl)?))?;
            let ctx = context(host)?;
            expand_full(&grezzo, &file_name(&id), &ctx, host)?
        }
        None => String::new(),
    };
    host.create_document(&id, &body)?;
    Ok(created(
        Text::message(D_UNIQUE, vec![Arg::text(A_DOC, id.as_str())]),
        Text::message(U_UNIQUE, vec![Arg::text(A_DOC, id.as_str())]),
        id,
    ))
}

/// La chiave del nome di una nota unica senza nome né prefisso, nella lingua
/// di chi la crea. È la stessa parola di `note.create`, ma con una voce sua:
/// i moduli di feature non si nominano fra loro.
pub(super) const N_UNTITLED: &str = "note.unique.untitled";

fn untitled(host: &dyn HostApi) -> String {
    Strings::new(&catalog(), "it", &host.user_locale()).render(&Text::key(N_UNTITLED))
}

pub(super) fn unique_name(args: Args<'_>, host: &dyn HostApi) -> Result<DocId, PluginError> {
    if args.flag(RANDOM, false) {
        return random_name(host);
    }
    let wanted = args.text(NAME).map(str::trim).filter(|s| !s.is_empty());
    let prefix = unique_prefix(host)?;
    let name = match (prefix.as_deref(), wanted) {
        (Some(prefix), Some(name)) => format!("{prefix} {name}"),
        (Some(prefix), None) => prefix.to_string(),
        (None, Some(name)) => name.to_string(),
        (None, None) => untitled(host),
    };
    Ok(host.free_name(&DocId::new(with_extension(host, &name)?)))
}

/// Il prefisso di adesso nel formato dichiarato, o `None` se il formato è
/// vuoto. L'ora è quella dell'host, nel suo fuso: la stessa di `{{date}}`.
fn unique_prefix(host: &dyn HostApi) -> Result<Option<String>, PluginError> {
    let format = match host.setting(UNIQUE_PREFIX_KEY) {
        Ok(fub_abi::settings::SettingValue::Text(s)) => s.trim().to_string(),
        _ => UNIQUE_PREFIX_DEFAULT.to_string(),
    };
    if format.is_empty() {
        return Ok(None);
    }
    let ctx = context(host)?;
    Ok(Some(format_moment(&format, &ctx)))
}

/// I token `YYYY`, `MM`, `DD`, `HH`, `mm` nel contesto; il resto resta
/// com'è. `MM` (mese) e `mm` (minuti) si distinguono per maiuscole, come
/// nella convenzione diffusa che chi scrive un formato si aspetta.
pub(super) fn format_moment(format: &str, ctx: &Ctx) -> String {
    let mut out = String::new();
    let mut rest = format;
    while !rest.is_empty() {
        let (token, value) = [
            ("YYYY", &ctx.year),
            ("MM", &ctx.month),
            ("DD", &ctx.day),
            ("HH", &ctx.hour),
            ("mm", &ctx.minute),
        ]
        .into_iter()
        .find(|(token, _)| rest.starts_with(token))
        .map_or((None, None), |(t, v)| (Some(t), Some(v)));
        match (token, value) {
            (Some(token), Some(value)) => {
                out.push_str(value);
                rest = &rest[token.len()..];
            }
            _ => {
                let c = rest.chars().next().expect("rest non vuoto");
                out.push(c);
                rest = &rest[c.len_utf8()..];
            }
        }
    }
    out
}

/// Un nome casuale leggibile: `Nota-<base32>` da 48 bit di entropia dell'host.
/// Mai `SystemTime` diretto (non testabile, morto sotto sandbox): l'orologio
/// e il caso sono capacità dell'host. Senza entropia si rifiuta nominando il
/// permesso — un id di zeri collide con ogni altro id non generato.
pub(super) fn random_name(host: &dyn HostApi) -> Result<DocId, PluginError> {
    const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    let bytes = host.random_bytes(6)?;
    let mut n: u64 = 0;
    for (i, b) in bytes.iter().take(6).enumerate() {
        n |= (*b as u64) << (8 * i);
    }
    let mut out = String::with_capacity(10);
    let mut v = n;
    for _ in 0..10 {
        out.push(ALPHABET[(v & 31) as usize] as char);
        v >>= 5;
    }
    let extension = crate::formats::new_note_extension(host)?;
    Ok(host.free_name(&DocId::new(format!("Nota-{out}.{extension}"))))
}

/// Apre una nota a caso fra quelle del vault (P05.3). Sola lettura: niente
/// scritture, niente undo, effetto `Navigate`. Scelta uniforme via
/// `random_bytes` dell'host; vault vuoto = errore detto, non panico.
pub(super) fn random(
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let mut ids: Vec<DocId> = host
        .list_documents(None)?
        .items
        .into_iter()
        // Una nota è un documento in prosa, con qualunque estensione il suo
        // formato dichiari (`.md`, `.markdown`, o quella di un plugin).
        .filter(|d| crate::formats::understands(host, d, fub_abi::options::source::PROSE))
        .collect();
    ids.sort_by(|a, b| a.as_str().cmp(b.as_str()));
    if ids.is_empty() {
        return Err(PluginError::BadArgs(Text::key(E_NO_NOTES)));
    }
    // Il modo non cambia la risposta: leggere a caso non scrive comunque.
    let _ = mode;
    let bytes = host.random_bytes(8)?;
    let mut n: u64 = 0;
    for (i, b) in bytes.iter().take(8).enumerate() {
        n |= (*b as u64) << (8 * i);
    }
    let pick = ids[(n % ids.len() as u64) as usize].clone();
    Ok(CommandOutcome::notify(Text::message(
        D_RANDOM,
        vec![Arg::text(A_DOC, pick.as_str())],
    ))
    .with_effect(CommandEffect::Navigate { doc: pick }))
}
