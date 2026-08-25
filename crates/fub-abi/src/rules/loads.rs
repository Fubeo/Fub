//! **Dove un `custom_kind` tiene i propri byte** — e la chiave che un kind di
//! terzi deve usare per dichiararlo.
//!
//! Un `Custom` senza figli (blocco o inline) porta i byte dell'utente in un
//! `attrs`, e chi rende deve sapere **sotto quale chiave**. Per i kind del
//! core la risposta è la tabella [`crate::model::custom_kind::PAYLOADS`]. Un
//! kind di terzi **non può entrare in quella tabella per costruzione**
//! (l'elenco è del core): finché il contratto non dava una risposta, il
//! renderer campionava tre chiavi del core (`html`, `source`, `text`) e
//! chiamava vuoto ciò che non trovava. La §25.7 ha scelto la **convenzione**,
//! non il campo — una riga dichiarata dove chi scrive un plugin la cerca,
//! invece di un tipo nuovo nel WIT.
//!
//! La convenzione è una riga: **la chiave del carico di un kind di terzi è
//! [`PAYLOAD_KEY`]**. Sta in `fub-abi::rules` (decisione 0020) perché la
//! risposta non dipende da chi la dà: la resa generica del provider markdown la
//! usa oggi, e il provider WASM di M5 la erediterà chiamando la stessa
//! funzione. Chi dichiara i propri byte sotto `source` si vede rendere da
//! entrambi.
//!
//! # Che cosa NON è
//!
//! - **Non è la tabella del core**: `PAYLOADS` dichiara i kind del core; la
//!   convenzione vale per chi non c'è.
//! - **Non è un campione**: un terzo che porta i byte sotto un'altra chiave si
//!   rende vuoto, e il silenzio è **dichiarato** (decisione 0122: «una
//!   proiezione degrada»).
//! - **Non è il serializzatore**: chi scrive rifiuta un kind non dichiarato
//!   comunque; la convenzione riguarda la resa.
//!
//! # Dove altro sta scritta
//!
//! La stessa riga è nel doc del WIT accanto a `block-custom` e in
//! `../../../../docs/architecture/plugin-runtime.md`: i tre posti in cui chi scrive un
//! plugin cerca la risposta.

use crate::model::custom_kind;
use serde_json::Value;

/// La chiave degli `attrs` sotto cui un `custom_kind` **di terzi** tiene i
/// propri byte.
///
/// La scelta della §25.7, forma (b): una convenzione dichiarata invece di un
/// campo nel WIT. Il core ha già la sua risposta (`PAYLOADS`); chi non è nella
/// tabella usa questa chiave, e chi la usa si vede rendere dalla resa
/// generica di qualunque provider.
pub const PAYLOAD_KEY: &str = "source";

/// Il testo che un `custom_kind` porta negli `attrs`, secondo il contratto.
///
/// Per un kind del core: la chiave che [`custom_kind::payload`] dichiara. Per
/// chi non è nella tabella: [`PAYLOAD_KEY`], la convenzione. `None` se
/// il testo non c'è o è vuoto — e per un kind di terzi `None` vuol dire che il
/// plugin non ha seguito la convenzione: la resa generica lo mostra vuoto, ed
/// è dichiarato in testa al modulo.
///
/// È la risposta che prima stava in `render.rs` come campione a tre chiavi
/// (`html`, `source`, `text`) — lo stesso elenco della tabella copiato in un
/// renderer, che nessuno teneva allineato e che «non rispondeva per il kind
/// che non c'era quando è stato scritto». Adesso la domanda la fa il
/// contratto, e il renderer la chiede a lui.
pub fn text_payload<'a>(kind: &str, attrs: &'a Value) -> Option<&'a str> {
    let text = |key: &str| attrs.get(key).and_then(|v| v.as_str());
    match custom_kind::payload(kind) {
        Some(load) => load.key().and_then(text).filter(|s| !s.is_empty()),
        None => text(PAYLOAD_KEY).filter(|s| !s.is_empty()),
    }
}
