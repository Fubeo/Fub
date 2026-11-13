//! Le rotte del binario: lo smistamento di una richiesta già letta e gli
//! handler di account, MFA, sync, publish e isolamento. Il servizio statico
//! resta in `main.rs`, accanto al front-end HTTP.

use std::path::Path;
use std::sync::Arc;

use parking_lot::Mutex;

use fub_services::auth::AccountStore;
use fub_services::routing::{Hello, Route};
use fub_services::server::{parse_credentials, HttpResponse, ServiceState};

use super::{handle_static, header_get, Parsed};

/// Chi paga una KDF senza essere autenticato: i presìdi del processo e
/// l'origine della richiesta secondo la politica dei proxy fidati (lock breve).
fn kdf_caller(state: &Arc<Mutex<ServiceState>>, parsed: &Parsed) -> KdfCaller {
    let state = state.lock();
    KdfCaller {
        abuse: Arc::clone(&state.abuse),
        origin: fub_services::abuse::client_origin(
            parsed.peer,
            header_get(&parsed.headers, "x-forwarded-for"),
            &state.config.trusted_proxies,
        ),
    }
}

pub(super) struct KdfCaller {
    abuse: Arc<fub_services::abuse::Abuse>,
    origin: String,
}

impl KdfCaller {
    /// Gettone e posto nel semaforo prima della KDF, o la risposta che rifiuta.
    pub(super) fn enter(&self) -> Result<fub_services::abuse::KdfPermit<'_>, HttpResponse> {
        self.abuse
            .enter(&self.origin, fub_services::schema::now_ms())
            .map_err(|refusal| HttpResponse::err(refusal.status(), refusal.code()))
    }
}

pub(super) fn dispatch(
    parsed: Parsed,
    state: &Arc<Mutex<ServiceState>>,
    data_dir: &Path,
) -> HttpResponse {
    let route = fub_services::routing::route(&parsed.method, &parsed.path);
    let auth = header_get(&parsed.headers, "authorization");
    let response = match route {
        Route::Hello => HttpResponse::json(200, &Hello::current()),
        Route::AccountRegister => handle_register(state, &kdf_caller(state, &parsed), &parsed.body),
        Route::AccountLogin => handle_login(state, &kdf_caller(state, &parsed), &parsed.body),
        Route::MfaVerify => {
            let mut state = state.lock();
            handle_mfa(&mut state, auth, &parsed.body)
        }
        Route::SyncPush
        | Route::SyncPull
        | Route::SyncAck
        | Route::SyncStatus
        | Route::SyncVersions
        | Route::SyncTrash
        | Route::SyncRestore
        | Route::SyncInvite
        | Route::SyncInviteAccept
        | Route::SyncRevoke
        | Route::SyncVaultKeyStore
        | Route::SyncVaultKeyGet => handle_sync(state, &parsed, auth),
        Route::PublishDryRun => {
            let mut state = state.lock();
            fub_services::publish::handle(
                &mut state,
                &parsed.method,
                &parsed.path,
                auth,
                &parsed.body,
            )
        }
        Route::PublishUnpublish | Route::PublishRollback => {
            // Prima il lock del sito, poi quello globale (ordine fisso).
            let site = site_lock(state, &parsed.body);
            let _site = site.as_ref().map(|lock| lock.lock());
            let mut state = state.lock();
            fub_services::publish::handle(
                &mut state,
                &parsed.method,
                &parsed.path,
                auth,
                &parsed.body,
            )
        }
        Route::PublishCommit => {
            // Preflight custom-JS fuori dal lock (solo file I/O, mai KDF).
            if let Err(r) = fub_services::site_isolation::preflight_commit(data_dir, &parsed.body) {
                r
            } else {
                handle_commit(state, auth, &parsed.body)
            }
        }
        Route::PublishStatus => {
            let mut state = state.lock();
            fub_services::publish::handle(
                &mut state,
                &parsed.method,
                &parsed.path,
                auth,
                &parsed.body,
            )
        }
        Route::PublishSiteAdmin => {
            handle_site_admin(state, &kdf_caller(state, &parsed), auth, &parsed.body)
        }
        Route::PublishIsolation => handle_isolation(state, data_dir, auth, &parsed.body),
        Route::StaticSite { site, rest } => handle_static(
            state,
            &kdf_caller(state, &parsed),
            data_dir,
            auth,
            &site,
            &rest,
            &parsed.query,
            header_get(&parsed.headers, "x-fub-site-password"),
            parsed.req_host.as_deref(),
        ),
        Route::Unknown => HttpResponse::err(404, "unknown route"),
    };
    eprintln!(
        "{}",
        fub_services::server::log_line(&parsed.method, &parsed.path, response.status)
    );
    response
}

/// Il lock del sito nominato dal corpo, se ne nomina uno valido.
/// Sync in due tempi (STR-05): sessione e ACL sotto il lock globale breve,
/// poi code, ripiegamento e fsync tenendo soltanto il lock del vault. Il lock
/// del vault si prende per primo e copre anche revoche e chiavi dello stesso
/// vault, così il lavoro autorizzato non scavalca una revoca.
fn handle_sync(
    state: &Arc<Mutex<ServiceState>>,
    parsed: &Parsed,
    auth: Option<&str>,
) -> HttpResponse {
    let vault = fub_services::sync::vault_of_request(&parsed.method, &parsed.path, &parsed.body)
        .map(|vault_id| {
            let locks = Arc::clone(&state.lock().vault_locks);
            (locks.of(&vault_id), vault_id)
        });
    let _vault = vault.as_ref().map(|(lock, _)| lock.lock());
    let admission = {
        let mut state = state.lock();
        fub_services::sync::admit(&mut state, &parsed.method, &parsed.path, auth, &parsed.body)
    };
    match admission {
        fub_services::sync::Admission::Done(response) => response,
        // Il vault ammesso è quello di cui si tiene il lock, o niente lavoro.
        fub_services::sync::Admission::Vault(work)
            if vault.as_ref().is_some_and(|(_, id)| id == work.vault_id()) =>
        {
            work.run()
        }
        fub_services::sync::Admission::Vault(_) => {
            HttpResponse::err(400, "ambiguous sync vault scope")
        }
    }
}

fn site_lock(state: &Arc<Mutex<ServiceState>>, body: &[u8]) -> Option<Arc<Mutex<()>>> {
    let site_id = fub_services::publish::peek_site_id(body)?;
    let locks = Arc::clone(&state.lock().site_locks);
    Some(locks.of(&site_id))
}

/// Commit in tre tempi (STR-05): autorizzazione e quota sotto il lock
/// globale breve; staging, scrittura, copia, fsync e rename tenendo soltanto
/// il lock del sito; proprietario e grant di nuovo sotto il lock globale
/// breve. Un publish grande non ferma sync, login né gli altri siti.
fn handle_commit(
    state: &Arc<Mutex<ServiceState>>,
    auth: Option<&str>,
    body: &[u8],
) -> HttpResponse {
    let site = site_lock(state, body);
    let _site = site.as_ref().map(|lock| lock.lock());
    let plan = {
        let mut state = state.lock();
        match fub_services::publish::plan_commit(&mut state, auth, body) {
            Err(r) => return r,
            Ok(plan) => plan,
        }
    };
    let outcome = fub_services::publish::run_commit(&plan);
    let mut state = state.lock();
    fub_services::publish::finish_commit(&mut state, plan, outcome)
}

/// Amministrazione del sito con la PBKDF2 della password nuova fuori dal lock
/// globale: prima il bearer (lock breve), poi la KDF dietro i limiti, infine
/// lock del sito e lock globale per applicare.
fn handle_site_admin(
    state: &Arc<Mutex<ServiceState>>,
    caller: &KdfCaller,
    auth: Option<&str>,
    body: &[u8],
) -> HttpResponse {
    let prehashed = match fub_services::publish::site_admin_password(body) {
        None => None,
        Some(password) => {
            if let Err(r) = state.lock().bearer(auth) {
                return r;
            }
            let _permit = match caller.enter() {
                Err(r) => return r,
                Ok(permit) => permit,
            };
            Some(fub_services::publish::guard::hash_site_password(&password))
        }
    };
    let site = site_lock(state, body);
    let _site = site.as_ref().map(|lock| lock.lock());
    let mut state = state.lock();
    fub_services::publish::handle_site_admin_prehashed(&mut state, auth, body, prehashed)
}

/// Register con KDF fuori dal lock: validazione + hash sul worker, solo
/// lookup/inserimento sotto lock breve.
fn handle_register(
    state: &Arc<Mutex<ServiceState>>,
    caller: &KdfCaller,
    body: &[u8],
) -> HttpResponse {
    let creds = match parse_credentials(body) {
        Err(r) => return r,
        Ok(creds) => creds,
    };
    let name = creds.name.trim().to_string();
    if name.is_empty() || name.len() > fub_services::auth::MAX_ACCOUNT_NAME {
        return HttpResponse::err(422, "bad account name");
    }
    if creds.password.len() < 8 {
        return HttpResponse::err(422, "password too short (min 8)");
    }
    {
        let state = state.lock();
        if let Err(r) = registration_open(&state) {
            return r;
        }
        if state.accounts.by_name.contains_key(&name) {
            return HttpResponse::err(409, "account exists");
        }
    }
    // 210k round PBKDF2 senza lock: sync/publish non si fermano. Prima i
    // limiti per origine e globale, poi un posto fra le KDF concorrenti.
    let pw = {
        let _permit = match caller.enter() {
            Err(r) => return r,
            Ok(permit) => permit,
        };
        match AccountStore::prepare_hash(&creds.password) {
            Err(e) => return HttpResponse::err(500, &e),
            Ok(pw) => pw,
        }
    };
    let mut state = state.lock();
    // Un register concorrente può aver preso il nome (o l'ultimo posto)
    // mentre girava la KDF.
    if let Err(r) = registration_open(&state) {
        return r;
    }
    if state.accounts.by_name.contains_key(&name) {
        return HttpResponse::err(409, "account exists");
    }
    let id = match state.accounts.insert_prepared(&name, pw) {
        Err(e) => return HttpResponse::err(422, &e),
        Ok(id) => id,
    };
    match state.accounts.issue_session_token(&id) {
        Err(e) => HttpResponse::err(500, &e),
        Ok(token) => HttpResponse::json(
            201,
            &serde_json::json!({ "account_id": id, "token": token }),
        ),
    }
}

/// La politica di registrazione e il tetto globale degli account (STR-04).
/// `closed` lascia passare soltanto il primo account di una data dir vuota.
fn registration_open(state: &ServiceState) -> Result<(), HttpResponse> {
    let count = state.accounts.accounts.len();
    if state.config.registration == fub_services::schema::Registration::Closed && count > 0 {
        return Err(HttpResponse::err(403, "registration closed"));
    }
    if count >= state.config.quotas.max_accounts as usize {
        return Err(HttpResponse::err(403, "account quota exceeded"));
    }
    Ok(())
}

/// Login con KDF fuori dal lock: snapshot hash sotto lock breve, verifica
/// fuori, emissione token sotto lock breve. MFA (HMAC veloce) sotto lock.
fn handle_login(state: &Arc<Mutex<ServiceState>>, caller: &KdfCaller, body: &[u8]) -> HttpResponse {
    #[derive(serde::Deserialize)]
    struct Login {
        name: String,
        password: String,
        code: Option<String>,
    }
    let login: Login = match serde_json::from_slice(body) {
        Err(_) => return HttpResponse::err(400, "bad login body"),
        Ok(login) => login,
    };
    let key = login.name.trim().to_string();
    // Un nome che nessun account può portare non si verifica e non si ricorda:
    // la chiave del limite peserebbe quanto il corpo della richiesta.
    if key.is_empty() || key.len() > fub_services::auth::MAX_ACCOUNT_NAME {
        return HttpResponse::err(401, "bad credentials");
    }
    let now = fub_services::schema::now_ms();
    // Il limite per nome lo sceglie chi chiama: davanti c'è quello per origine
    // e globale, che nessun nome nuovo azzera, e il semaforo delle KDF.
    let _permit = match caller.enter() {
        Err(r) => return r,
        Ok(permit) => permit,
    };
    let snapshot = {
        let mut state = state.lock();
        if state.logins.blocked(&key, now) {
            return HttpResponse::err(429, "rate limited");
        }
        // Il tentativo conta **prima** della verifica, che gira fuori dal
        // lock: login paralleli sullo stesso nome non passano tutti il
        // controllo prima che il primo fallisca. Una password giusta lo
        // restituisce.
        state.logins.note_fail(&key, now);
        state.accounts.password_hash_of(&login.name)
    };
    let (account_id, pw) = match snapshot {
        Err(_) => {
            // Hash fittizio per pari tempo di risposta (no user enumeration
            // temporale), poi 401 generico.
            let _ = AccountStore::prepare_hash(&login.password);
            return HttpResponse::err(401, "bad credentials");
        }
        Ok(snapshot) => snapshot,
    };
    let ok = AccountStore::check_hash(&login.password, &pw).unwrap_or(false);
    let mut state = state.lock();
    if !ok {
        return HttpResponse::err(401, "bad credentials");
    }
    state.logins.forgive(&key);
    // Step-up TOTP: record clonato, `check_totp` su borrow locali (HMAC veloce
    // sotto lock breve, mai KDF). Il contatore usato si scrive prima di
    // emettere il token: se non si riesce a scriverlo, il codice resterebbe
    // rigiocabile dopo un riavvio, e il login non passa.
    if let Some(mut record) = state.accounts.totp(&account_id).active {
        let code = match login.code.as_deref() {
            Some(code) if !code.trim().is_empty() => code.to_string(),
            _ => return HttpResponse::err(401, "mfa required"),
        };
        match state
            .totp_attempts
            .check_totp(&mut record, &account_id, &code)
        {
            Ok(true) => {
                if let Err(e) = state
                    .accounts
                    .update_totp(&account_id, |totp| totp.active = Some(record))
                {
                    return HttpResponse::err(500, &e);
                }
            }
            Ok(false) => return HttpResponse::err(401, "bad totp"),
            Err(e) => return HttpResponse::err(429, &e),
        }
    }
    state.logins.note_success(&key);
    match state.accounts.issue_session_token(&account_id) {
        Err(e) => HttpResponse::err(500, &e),
        Ok(token) => HttpResponse::json(
            200,
            &serde_json::json!({ "account_id": account_id, "token": token }),
        ),
    }
}

/// MFA enroll/verify: solo HMAC veloci sotto lock breve, mai KDF.
///
/// `enroll` prepara un segreto in attesa; il primo `code` che lo prova lo
/// rende attivo. Un secondo fattore già attivo si sostituisce soltanto
/// mostrando un suo codice: altrimenti un token di sessione rubato basterebbe
/// a rimpiazzarlo, e con lui lo step-up che protegge inviti e revoche.
fn handle_mfa(state: &mut ServiceState, auth: Option<&str>, body: &[u8]) -> HttpResponse {
    let account_id = match state.bearer(auth) {
        Ok(id) => id,
        Err(r) => return r,
    };
    #[derive(serde::Deserialize)]
    struct MfaBody {
        code: Option<String>,
        enroll: Option<bool>,
    }
    let parsed: MfaBody = match serde_json::from_slice(body) {
        Err(_) => return HttpResponse::err(400, "bad mfa body"),
        Ok(parsed) => parsed,
    };
    let code = parsed
        .code
        .as_deref()
        .filter(|code| !code.trim().is_empty());
    let mut totp = state.accounts.totp(&account_id);
    if parsed.enroll == Some(true) {
        if let Some(active) = totp.active.as_mut() {
            let Some(code) = code else {
                return HttpResponse::err(401, "mfa required");
            };
            match state.totp_attempts.check_totp(active, &account_id, code) {
                Ok(true) => {}
                Ok(false) => return HttpResponse::err(401, "bad totp"),
                Err(e) => return HttpResponse::err(429, &e),
            }
        }
        let secret = match fub_services::mfa::generate_secret() {
            Err(e) => return HttpResponse::err(500, &e),
            Ok(secret) => secret,
        };
        totp.pending = Some(fub_services::mfa::TotpRecord {
            secret_b64: secret.secret_b64.clone(),
            last_counter: None,
        });
        return match state.accounts.update_totp(&account_id, |t| *t = totp) {
            Err(e) => HttpResponse::err(500, &e),
            Ok(()) => {
                HttpResponse::json(201, &serde_json::json!({ "secret_b64": secret.secret_b64 }))
            }
        };
    }
    let Some(code) = code else {
        return HttpResponse::err(400, "mfa not enrolled or code missing");
    };
    // Un segreto in attesa si conferma: è lui che il codice deve provare.
    let confirming = totp.pending.is_some();
    let Some(record) = totp.pending.as_mut().or(totp.active.as_mut()) else {
        return HttpResponse::err(400, "mfa not enrolled or code missing");
    };
    match state.totp_attempts.check_totp(record, &account_id, code) {
        Ok(true) => {}
        Ok(false) => return HttpResponse::err(401, "bad totp"),
        Err(e) => return HttpResponse::err(429, &e),
    }
    if confirming {
        totp.active = totp.pending.take();
    }
    match state.accounts.update_totp(&account_id, |t| *t = totp) {
        Err(e) => HttpResponse::err(500, &e),
        Ok(()) => HttpResponse::json(200, &serde_json::json!({ "ok": true })),
    }
}

/// Configurazione isolamento custom-JS: bearer + owner/Admin sotto lock breve,
/// scrittura sidecar fuori dal lock.
fn handle_isolation(
    state: &Arc<Mutex<ServiceState>>,
    data_dir: &Path,
    auth: Option<&str>,
    body: &[u8],
) -> HttpResponse {
    #[derive(serde::Deserialize)]
    struct IsolationBody {
        site_id: String,
        mode: String,
        origin: Option<String>,
    }
    let parsed: IsolationBody = match serde_json::from_slice(body) {
        Err(_) => return HttpResponse::err(400, "bad isolation body"),
        Ok(parsed) => parsed,
    };
    if parsed.site_id.is_empty() || parsed.site_id.len() > 64 {
        return HttpResponse::err(400, "bad site id");
    }
    let account = {
        let state = state.lock();
        match state.bearer(auth) {
            Err(r) => return r,
            Ok(account) => account,
        }
    };
    // Autorizzazione: la stessa regola di ogni amministrazione del sito
    // (`publish::authorize_administer`, lock breve, mai KDF). Un sito che non
    // c'è, un record illeggibile o corrotto negano: niente sidecar per un
    // `site_id` che nessuno possiede ancora.
    {
        let state = state.lock();
        if let Err(response) =
            fub_services::publish::authorize_administer(&state, &parsed.site_id, &account)
        {
            return response;
        }
    }
    match fub_services::site_isolation::save_mode(
        data_dir,
        &parsed.site_id,
        &parsed.mode,
        parsed.origin.as_deref(),
    ) {
        Err(e) => HttpResponse::err(400, &e),
        Ok(config) => HttpResponse::json(
            200,
            &serde_json::json!({ "site_id": parsed.site_id, "mode": config.mode, "origin": config.origin }),
        ),
    }
}
