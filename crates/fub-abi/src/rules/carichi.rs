//! **Dove un `custom_kind` tiene i propri byte** — e la chiave che un kind di
//! terzi deve usare per dichiararlo.
//!
//! Un `Custom` senza figli (blocco o inline) porta i byte dell'utente in un
//! `attrs`, e chi rende deve sapere **sotto quale chiave**. Per i kind del
//! core la risposta è la tabella [`crate::model::custom_kind::CARICHI`] —
//! *tutti e soli*, contata da `ogni_kind_dichiara_cosa_porta` nei due versi.
//! Un kind di terzi **non può entrare in quella tabella per costruzione**
//! (l'elenco è del core, e il conto rifiuta la riga che non nomina una
//! `const`): finché il contratto non gli dava una risposta, il renderer
//! campionava tre chiavi del core (`html`, `source`, `text`) e chiamava vuoto
//! ciò che non trovava. La §25.7 ha scelto la forma (b): la **convenzione**,
//! non il campo — una riga dichiarata dove chi scrive un plugin la cerca,
//! invece di un tipo nuovo nel WIT.
//!
//! La convenzione è una riga: **la chiave del carico di un kind di terzi è
//! [`CHIAVE_DEL_CARICO`]**. Sta in `fub-abi::rules` (decisione 0020) perché è
//! una parte della risposta che non dipende da chi la dà: la resa generica del
//! provider markdown la usa oggi, e il provider WASM di M5 la erediterà
//! chiamando la stessa funzione. Chi dichiara i propri byte sotto `source` si
//! vede rendere da entrambi.
//!
//! # Che cosa NON è
//!
//! - **Non è la tabella del core**: `CARICHI` dichiara *tutti e soli* i kind
//!   del core; la convenzione vale per chi non c'è.
//! - **Non è un campione**: un terzo che porta i byte sotto un'altra chiave —
//!   `corpo`, `body`, una scelta sua — si rende vuoto, e il silenzio è
//!   **dichiarato**: la resa generica è il degrado che la decisione 0122
//!   sanziona («una proiezione degrada»), e la porta degli eventi non arriva
//!   a questo strato (decisione 0052: chi vede il guasto non ha il bus fra le
//!   mani).
//! - **Non è il serializzatore**: chi scrive rifiuta un kind non dichiarato
//!   comunque, `Carico::Corpo(_) | None` nello stesso braccio di
//!   `serialize.rs`; la convenzione riguarda la resa.
//!
//! # Dove altro sta scritta
//!
//! La stessa riga è nel doc del WIT accanto a `block-custom` — gli `attrs`
//! sono `json` libero, la chiave sta dentro il JSON e non nella forma del
//! contratto, quindi non tocca l'additività — e in
//! `docs/architecture/plugin-boundary.md`: i tre posti in cui chi scrive un
//! plugin cerca la risposta.

use crate::model::custom_kind;
use serde_json::Value;

/// La chiave degli `attrs` sotto cui un `custom_kind` **di terzi** tiene i
/// propri byte.
///
/// La scelta della §25.7, forma (b): una convenzione dichiarata invece di un
/// campo nel WIT. Il core ha già la sua risposta (`CARICHI`); chi non è nella
/// tabella usa questa chiave, e chi la usa si vede rendere dalla resa
/// generica di qualunque provider.
pub const CHIAVE_DEL_CARICO: &str = "source";

/// Il testo che un `custom_kind` porta negli `attrs`, secondo il contratto.
///
/// Per un kind del core: la chiave che [`custom_kind::carico`] dichiara. Per
/// chi non è nella tabella: [`CHIAVE_DEL_CARICO`], la convenzione. `None` se
/// il testo non c'è o è vuoto — e per un kind di terzi `None` vuol dire che il
/// plugin non ha seguito la convenzione: la resa generica lo mostra vuoto, ed
/// è dichiarato in testa al modulo.
///
/// È la risposta che prima stava in `render.rs` come campione a tre chiavi
/// (`html`, `source`, `text`) — lo stesso elenco della tabella copiato in un
/// renderer, che nessuno teneva allineato e che «non rispondeva per il kind
/// che non c'era quando è stato scritto». Adesso la domanda la fa il
/// contratto, e il renderer la chiede a lui.
pub fn carico_testuale<'a>(kind: &str, attrs: &'a Value) -> Option<&'a str> {
    let testo = |chiave: &str| attrs.get(chiave).and_then(|v| v.as_str());
    match custom_kind::carico(kind) {
        Some(carico) => carico.chiave().and_then(testo).filter(|s| !s.is_empty()),
        None => testo(CHIAVE_DEL_CARICO).filter(|s| !s.is_empty()),
    }
}
