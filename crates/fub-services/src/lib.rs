//! # fub-services — backend locale reale per account/sync/publish (P16/P17)
//!
//! Servizio self-hostable separato da kernel/host/app: vive in questo crate e
//! parla HTTP+JSON su loopback in sviluppo esplicito (`127.0.0.1`), HTTPS in
//! produzione (prerequisito esterno: certificati/DNS, vedi sotto). Nessun
//! endpoint cloud hardcoded, nessuna credenziale inventata.
//!
//! # Struttura
//!
//! Il parent (ServicesOwner) possiede questi moduli comuni:
//! - [`auth`]: account, password (PBKDF2 versionato), session token opachi,
//!   dispositivi, cancellazione account (conserva la copia locale).
//! - [`mfa`]: TOTP RFC6238 con anti-replay e rate limiting sui login.
//! - [`acl`]: ruoli Owner/Admin/Writer/Reader, share ACL, inviti con scadenza.
//! - [`schema`]: quote/retention/regioni, config, helper fs (id, clock, atomic
//!   write, directory), separazione device-vs-condiviso.
//! - [`routing`]: versioni di protocollo `fub-sync/1` + `fub-publish/1`,
//!   route tipizzate, `GET /v1/hello`.
//! - [`crypto`]: AEAD AES-256-GCM via `ring`, KDF PBKDF2 versionata, wrap della
//!   chiave vault (VDK) — MAI derivata dalla password account.
//! - [`server`]: stato del servizio, risposte HTTP tipizzate, bearer helper.
//!
//! I discendenti possiedono `sync/` (P16) e `publish/` (P17) e chiamano questi
//! hook senza ridefinirli. `main.rs` instrada `/v1/sync/*` a `sync::handle` e
//! `/v1/publish/*` + `/s/*` a `publish::handle`.
//!
//! # Blocchi esterni esatti (non sostituiti con stub)
//!
//! - TLS di produzione + DNS/domini custom: il binario serve HTTP solo su
//!   loopback; l'operatore termina TLS davanti (reverse proxy) o fornisce i
//!   certificati. Senza, niente deployment pubblico.
//! - Distribuzione della VDK avvolta agli invitati: il server conserva il wrap
//!   ma la consegna fuori banda resta decisione operativa documentata.
//!
//! # Credenziali
//!
//! Mai in argv/log/history: token via `Authorization: Bearer` letto da
//! env-file (`FUB_SERVICES_TOKEN_FILE`) o stdin dal client; qui i log
//! redigono sempre (`server::redact`).

pub mod acl;
pub mod auth;
pub mod crypto;
pub mod mfa;
pub mod routing;
pub mod schema;
pub mod server;
pub mod site_isolation;
/// Wire `u64`-come-stringhe (P16/P17): contatori/versioni/cursori come stringhe
/// decimali sul JSON, compat lettura numero, spazzatura = errore. Nessuna
/// dipendenza da `fub-abi` (conformità byte-identica per costruzione).
pub mod wire;

/// Endpoint sync P16, implementati dal discendente SyncSlice.
pub mod sync;

/// Endpoint publish P17, implementati dal discendente PublishSlice.
pub mod publish;

/// Versione wire del protocollo sync (P16.4). Mismatch = errore duro.
pub const SYNC_PROTOCOL: &str = routing::SYNC_PROTOCOL;
/// Versione wire del protocollo publish (P17.8). Mismatch = errore duro.
pub const PUBLISH_PROTOCOL: &str = routing::PUBLISH_PROTOCOL;
/// Identità server riportata da `GET /v1/hello`.
pub const SERVER_IDENT: &str = routing::SERVER_IDENT;
