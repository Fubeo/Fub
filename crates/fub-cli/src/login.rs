//! Login/config/account reali: token e password mai in argv, mai nei log.
//!
//! `login` parla agli endpoint reali `POST /v1/account/register|login`
//! (+ `code` TOTP quando serve) e stampa `{account_id, token}` una volta
//! sola: chi chiama lo salva in un file 0600 e lo riusa via
//! `FUB_SERVICES_TOKEN_FILE`. `mfa` arruola/verifica TOTP via
//! `POST /v1/mfa/verify`. `config` resta locale (Host settings).

use super::cli::{ConfigArgs, GlobalArgs, LoginArgs};
use super::commands::{Connection, Failure};
use super::output::{envelope_ok, redact_json_value, OutputFormat};
fn read_secret_file(path: &str) -> Result<String, Failure> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let meta = std::fs::symlink_metadata(path)
            .map_err(|e| Failure::new(4, "auth", format!("secret file: {e}")))?;
        if !meta.is_file()
            || meta.file_type().is_symlink()
            || meta.permissions().mode() & 0o077 != 0
        {
            return Err(Failure::new(
                4,
                "auth",
                "secret file richiede file regolare 0600",
            ));
        }
    }
    super::commands::read_file_text(path)
}

fn read_code(code_file: Option<&str>) -> Result<Option<String>, Failure> {
    let path = code_file.map(str::to_owned).or_else(|| {
        std::env::var("FUB_SERVICES_MFA_CODE_FILE")
            .ok()
            .filter(|s| !s.trim().is_empty())
    });
    path.map(|path| {
        let code = read_secret_file(&path)?.trim().to_string();
        if code.len() != 6 || !code.bytes().all(|b| b.is_ascii_digit()) {
            return Err(Failure::new(4, "auth", "codice MFA file non valido"));
        }
        Ok(code)
    })
    .transpose()
}
/// Segreti: token solo da env (`FUB_SERVICES_TOKEN_FILE` vince su
/// `FUB_SERVICES_TOKEN`); il valore non attraversa mai argv/log/output.
/// `explicit_file` resta per riuso interno (MFA legge dal token attivo).
pub fn read_token(explicit_file: Option<&str>) -> Result<Option<String>, Failure> {
    if let Some(path) = explicit_file {
        let raw = read_secret_file(path)?;
        let token = raw.trim().to_string();
        if token.is_empty() {
            return Err(Failure::new(4, "auth", "--token-file vuoto"));
        }
        return Ok(Some(token));
    }
    if let Ok(path) = std::env::var("FUB_SERVICES_TOKEN_FILE") {
        if !path.trim().is_empty() {
            let raw = read_secret_file(path.trim())?;
            let token = raw.trim().to_string();
            if token.is_empty() {
                return Err(Failure::new(4, "auth", "token file vuoto"));
            }
            return Ok(Some(token));
        }
    }
    if let Ok(token) = std::env::var("FUB_SERVICES_TOKEN") {
        if !token.trim().is_empty() {
            return Ok(Some(token.trim().to_string()));
        }
    }
    Ok(None)
}

/// Password account: solo `--password-file` o env dedicato. Mai argv, mai
/// stdin interattiva (niente prompt che restano nella history del terminale).
pub fn read_password(explicit_file: Option<&str>) -> Result<String, Failure> {
    if let Some(path) = explicit_file {
        let raw = read_secret_file(path)?;
        let password = raw.trim_end_matches(['\n', '\r']).to_string();
        if password.trim().is_empty() {
            return Err(Failure::new(4, "auth", "--password-file vuota"));
        }
        return Ok(password);
    }
    if let Ok(path) = std::env::var("FUB_SERVICES_PASSWORD_FILE") {
        if !path.trim().is_empty() {
            let raw = read_secret_file(path.trim())?;
            let password = raw.trim_end_matches(['\n', '\r']).to_string();
            if password.trim().is_empty() {
                return Err(Failure::new(4, "auth", "password file vuota"));
            }
            return Ok(password);
        }
    }
    if let Ok(password) = std::env::var("FUB_SERVICES_PASSWORD") {
        if !password.trim().is_empty() {
            return Ok(password);
        }
    }
    Err(Failure::new(
        4,
        "auth",
        "password assente: --password-file F o FUB_SERVICES_PASSWORD_FILE (mai in argv)",
    ))
}

fn account_base() -> Result<String, Failure> {
    let setting = String::new();
    fub_host::remote::resolve_base(&setting).map_err(|e| match e {
        fub_host::remote::RemoteError::MissingConfiguration => Failure::new(
            2,
            "bad_args",
            "endpoint non configurato: FUB_SERVICES_URL o setting sync.server_url",
        ),
        fub_host::remote::RemoteError::BadEndpoint(detail) => {
            Failure::new(2, "bad_args", format!("endpoint non valido: {detail}"))
        }
    })
}

fn post_account(path: &str, payload: &serde_json::Value) -> Result<serde_json::Value, Failure> {
    let (status, value) = account_response(path, payload)?;
    if (200..300).contains(&status) {
        return Ok(value);
    }
    Err(map_status(path, status, &value))
}

/// Lo status e il corpo di una risposta del servizio account, prima che un
/// rifiuto diventi [`Failure`]: chi deve distinguere un rifiuto dall'altro
/// decide su questi, non sul testo del messaggio.
fn account_response(
    path: &str,
    payload: &serde_json::Value,
) -> Result<(u16, serde_json::Value), Failure> {
    let base = account_base()?;
    let (status, body) = fub_host::remote::post_json(&base, path, None, payload)
        .map_err(|detail| Failure::new(3, "unavailable", detail))?;
    let value: serde_json::Value = serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null);
    Ok((status, value))
}

/// La registrazione è rifiutata perché l'account c'è già: `409`, oppure il
/// `422` con codice `account exists` dei server precedenti. Il codice è il
/// campo `error` del corpo, confrontato per intero: non contiene nomi.
fn account_exists(status: u16, value: &serde_json::Value) -> bool {
    status == 409
        || (status == 422
            && value.get("error").and_then(serde_json::Value::as_str) == Some("account exists"))
}

fn mfa_post(token: &str, payload: &serde_json::Value) -> Result<serde_json::Value, Failure> {
    let base = account_base()?;
    let (status, body) = fub_host::remote::post_json(&base, "/v1/mfa/verify", Some(token), payload)
        .map_err(|detail| Failure::new(3, "unavailable", detail))?;
    let value: serde_json::Value = serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null);
    if (200..300).contains(&status) {
        return Ok(value);
    }
    Err(map_status("/v1/mfa/verify", status, &value))
}

fn map_status(path: &str, status: u16, value: &serde_json::Value) -> Failure {
    let detail = value
        .get("error")
        .and_then(|v| v.as_str())
        .unwrap_or("rejected");
    match status {
        400 => Failure::new(2, "bad_args", format!("{path} -> 400 {detail}")),
        401 | 403 | 429 => Failure::new(4, "denied", format!("{path} -> {status} {detail}")),
        404 => Failure::new(1, "not_found", format!("{path} -> 404 {detail}")),
        409 => Failure::new(5, "conflict", format!("{path} -> 409 {detail}")),
        413 => Failure::new(5, "conflict", format!("{path} -> 413 {detail}")),
        _ => Failure::new(3, "unavailable", format!("{path} -> {status} {detail}")),
    }
}

pub fn login(
    _connection: &mut Connection,
    global: &GlobalArgs,
    _format: &OutputFormat,
    args: LoginArgs,
    print: impl Fn(&serde_json::Value),
) -> Result<(), Failure> {
    let user = args
        .user
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| Failure::bad_args("login vuole un user"))?;
    let password = read_password(args.password_file.as_deref())?;
    // 1. register best-effort: account già esistente -> login; altri errori reali.
    const REGISTER: &str = "/v1/account/register";
    let (status, value) = account_response(
        REGISTER,
        &serde_json::json!({ "name": user, "password": password }),
    )?;
    let registered: Option<serde_json::Value> = if (200..300).contains(&status) {
        Some(value)
    } else if account_exists(status, &value) {
        None
    } else {
        return Err(map_status(REGISTER, status, &value));
    };
    // 2. login (con code TOTP quando fornito).
    let mut payload = serde_json::json!({ "name": user, "password": password });
    if let Some(code) = read_code(args.code_file.as_deref())? {
        payload["code"] = serde_json::json!(code);
    }
    let value = post_account("/v1/account/login", &payload)?;
    let account_id = value
        .get("account_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let token = value
        .get("token")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if token.is_empty() {
        return Err(Failure::new(4, "protocol", "login senza token"));
    }
    // Persist before reporting success: neither token nor MFA seed reaches
    // process argv, REPL history, or the normal CLI output.
    let path = std::env::var("FUB_SERVICES_TOKEN_FILE")
        .ok()
        .filter(|p| !p.trim().is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or(super::local::config_path(global, "services-token")?);
    super::local::save_owner_file(&path, token.as_bytes())?;
    let mut result = serde_json::json!({
        "account_id": account_id,
        "registered": registered.is_some(),
        "token_file": path.to_string_lossy(),
    });
    if args.enroll {
        let enrolled = mfa_post(&token, &serde_json::json!({ "enroll": true }))?;
        let secret = enrolled
            .get("secret_b64")
            .and_then(|v| v.as_str())
            .ok_or_else(|| Failure::new(4, "protocol", "MFA enroll senza segreto"))?;
        let secret_path = super::local::config_path(global, "mfa-secret")?;
        super::local::save_owner_file(&secret_path, secret.as_bytes())?;
        result["mfa_secret_file"] = serde_json::json!(secret_path.to_string_lossy());
    }
    print(&envelope_ok(result));
    Ok(())
}

pub fn mfa_cmd(
    global: &GlobalArgs,
    code_file: Option<String>,
    enroll: bool,
    print: impl Fn(&serde_json::Value),
) -> Result<(), Failure> {
    let token = match read_token(None)? {
        Some(token) => token,
        None => {
            let path = super::local::config_path(global, "services-token")?;
            read_token(Some(path.to_string_lossy().as_ref()))?.ok_or_else(|| {
                Failure::new(4, "auth", "token assente: login o FUB_SERVICES_TOKEN_FILE")
            })?
        }
    };
    if enroll {
        let value = mfa_post(&token, &serde_json::json!({ "enroll": true }))?;
        let secret = value
            .get("secret_b64")
            .and_then(|v| v.as_str())
            .ok_or_else(|| Failure::new(4, "protocol", "MFA enroll senza segreto"))?;
        let secret_path = super::local::config_path(global, "mfa-secret")?;
        super::local::save_owner_file(&secret_path, secret.as_bytes())?;
        print(&envelope_ok(
            serde_json::json!({ "mfa_secret_file": secret_path.to_string_lossy() }),
        ));
        return Ok(());
    }
    let code = read_code(code_file.as_deref())?.ok_or_else(|| {
        Failure::bad_args("mfa verify vuole --code-file F o FUB_SERVICES_MFA_CODE_FILE")
    })?;
    let value = mfa_post(&token, &serde_json::json!({ "code": code }))?;
    print(&envelope_ok(serde_json::json!({
        "ok": value.get("ok").cloned().unwrap_or_default(),
    })));
    Ok(())
}

pub fn config(
    connection: &Connection,
    global: &GlobalArgs,
    format: &OutputFormat,
    args: ConfigArgs,
    print: impl Fn(&serde_json::Value),
) -> Result<(), Failure> {
    if !args.set.is_empty() {
        for pair in &args.set {
            let (key, value) = pair
                .split_once('=')
                .ok_or_else(|| Failure::bad_args("--set vuole chiave=valore"))?;
            if key.trim().is_empty() {
                return Err(Failure::bad_args("--set con chiave vuota"));
            }
            let parsed = parse_setting_value(value)?;
            if global.dry_run {
                print(&envelope_ok(
                    serde_json::json!({ "key": key.trim(), "would_set": parsed, "dry_run": true }),
                ));
                continue;
            }
            connection
                .host
                .set_setting_for_user(connection.vault_selector(), key.trim(), parsed)
                .map_err(|error| Failure::from_plugin(&error))?;
            print(&envelope_ok(
                serde_json::json!({ "key": key.trim(), "set": true }),
            ));
        }
        return Ok(());
    }
    if let Some(key) = args.reset.as_deref() {
        if global.dry_run {
            print(&envelope_ok(
                serde_json::json!({ "key": key, "would_reset": true, "dry_run": true }),
            ));
            return Ok(());
        }
        connection
            .host
            .reset_setting_for_user(connection.vault_selector(), key)
            .map_err(|error| Failure::from_plugin(&error))?;
        print(&envelope_ok(
            serde_json::json!({ "key": key, "reset": true }),
        ));
        return Ok(());
    }
    if let Some(key) = args.get.as_deref() {
        let entries = query_settings(connection)?;
        let found = entries.into_iter().find(|e| e.spec.key == key);
        match found {
            Some(entry) => {
                let value = redact_json_value(
                    &entry.spec.key,
                    serde_json::to_value(&entry.value).unwrap_or_default(),
                );
                print(&envelope_ok(
                    serde_json::json!({ "key": entry.spec.key, "value": value, "source": entry.source }),
                ));
                Ok(())
            }
            None => Err(Failure::new(
                1,
                "not_found",
                format!("chiave `{key}` non dichiarata"),
            )),
        }
    } else {
        // list (default): chiavi con valori redatti dove serve.
        let entries = query_settings(connection)?;
        let offset = global.offset.unwrap_or(0);
        let (page, total) = super::commands::paginate(entries, offset, global.limit);
        let items: Vec<serde_json::Value> = page
            .into_iter()
            .map(|e| {
                let value = redact_json_value(
                    &e.spec.key,
                    serde_json::to_value(&e.value).unwrap_or_default(),
                );
                serde_json::json!({ "key": e.spec.key, "value": value, "source": e.source })
            })
            .collect();
        print(&envelope_ok(
            serde_json::json!({ "items": items, "offset": offset, "total": total }),
        ));
        let _ = format;
        Ok(())
    }
}

fn query_settings(connection: &Connection) -> Result<Vec<fub_abi::SettingEntry>, Failure> {
    match connection.host.query_index(
        connection.vault_selector(),
        fub_abi::IndexQuery::Settings { plugin: None },
    ) {
        Ok(fub_abi::IndexResult::Settings(entries)) => Ok(entries),
        Ok(other) => Err(Failure::local(format!(
            "settings ha risposto {}",
            other.kind_name()
        ))),
        Err(e) => Err(Failure::from_plugin(&e)),
    }
}

fn parse_setting_value(raw: &str) -> Result<fub_abi::SettingValue, Failure> {
    let trimmed = raw.trim();
    if trimmed.eq_ignore_ascii_case("true") || trimmed.eq_ignore_ascii_case("on") || trimmed == "1"
    {
        // La specie vera la decide lo schema a scrittura; qui si indovina il
        // booleano solo per le forme ovvie, il resto resta testo.
        return Ok(fub_abi::SettingValue::Toggle(true));
    }
    if trimmed.eq_ignore_ascii_case("false")
        || trimmed.eq_ignore_ascii_case("off")
        || trimmed == "0"
    {
        return Ok(fub_abi::SettingValue::Toggle(false));
    }
    if let Ok(number) = trimmed.parse::<f64>() {
        if !trimmed.is_empty()
            && trimmed
                .chars()
                .all(|c| c.is_ascii_digit() || matches!(c, '.' | '-' | '+' | 'e' | 'E'))
        {
            return Ok(fub_abi::SettingValue::Number(number));
        }
    }
    if trimmed.contains(',') {
        return Ok(fub_abi::SettingValue::List(
            trimmed
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
        ));
    }
    Ok(fub_abi::SettingValue::Text(raw.to_string()))
}

#[cfg(test)]
mod tests {
    use super::account_exists;

    /// La registrazione di un account che c'è già porta al login; il ramo
    /// decide su status e codice, non sul testo (I73). Un `413`, che la CLI
    /// chiama "conflict" come il `409`, non è un account esistente.
    #[test]
    fn an_existing_account_is_told_by_status_and_code() {
        let exists = serde_json::json!({ "error": "account exists" });
        assert!(account_exists(409, &serde_json::Value::Null));
        assert!(account_exists(422, &exists));
        assert!(!account_exists(
            422,
            &serde_json::json!({ "error": "password too short (min 8)" })
        ));
        assert!(!account_exists(
            422,
            &serde_json::json!({ "error": "account exists: no, bad account name" })
        ));
        assert!(!account_exists(413, &exists));
        assert!(!account_exists(500, &exists));
    }
}
