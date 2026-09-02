//! Gli host: **chi presta le capacità**, e con quale disciplina.
//!
//! Erano tre `impl HostApi` dentro `workspace.rs`, novantasei corpi di metodo
//! (col doppio in memoria delle feature) di cui ventidue non facevano altro
//! che dire di no. Il §7.1 li ha divisi in tre cose che sono davvero tre:
//!
//! - `KernelHost` (interno) — l'unica implementazione **vera**. Presta
//!   `&mut Workspace`, fa le cose, e le dieci famiglie di capacità le
//!   implementa perché le sa fare.
//! - `ReadHost` (interno) — il percorso di **lettura**, che presta `&Workspace` e non
//!   `&mut`. Implementa le quattro famiglie di lettura e **non le altre**: non
//!   è un host mutilato con dodici `unreachable!()`, è un tipo che non
//!   soddisfa [`HostApi`](fub_abi::traits::HostApi) e soddisfa
//!   [`ReadApi`](fub_abi::traits::ReadApi). Chi lo riceve — `render_view`,
//!   `export` — ha nella firma ciò che prima era una riga di prosa.
//! - [`Guard`] — il **rifiuto**, scritto una volta sola. Avvolge un host e una
//!   [`Policy`], delega ciò che la politica concede e nega il resto con un
//!   messaggio che dice perché.
//!
//! # Perché il rifiuto è un wrapper e non una impl gemella
//!
//! `ReadOnlyHost` esisteva per dire «no» a dieci metodi, e per dirlo ne aveva
//! riscritti ventiquattro — dodici dei quali delegavano a `ReadHost` riga per
//! riga. Con una politica in più (un comando simulato, un plugin senza
//! `write_vault`, un plugin senza rete, e le loro **combinazioni**) sarebbe
//! stata un'altra impl da ventiquattro metodi a testa: è il moltiplicatore che
//! il sesto giro cercava, e che non si paga aggiungendo la politica ma a ogni
//! politica successiva.
//!
//! Adesso una politica è un `impl Policy` — dieci righe — e comporne due è una
//! tupla ([`Policy` per `(A, B)`](Policy#impl-Policy-for-(A,+B))).
//!
//! # Le capacità senza esito
//!
//! Sei capacità non restituiscono un `Result`: `emit`, `free_name`,
//! `format_of`, `now_unix_millis`, `user_locale`, `active_context`. Una
//! politica che le nega non ha modo di **dirlo** — può solo dare la risposta
//! nulla (nessun evento, nessun formato, nessun contesto, il tempo a zero, il
//! locale del contratto, il nome che le è stato passato). Per `active_context`
//! la risposta nulla è anche **parziale**, da quando i cancelli sono due: vedi
//! [`Guard`]. Non è una scappatoia dell'implementazione: è ciò che quelle firme
//! dicono, ed è la ragione per cui una capacità nuova del contratto dovrebbe
//! portare un esito anche quando "non può fallire" — non potendo fallire, non
//! può nemmeno essere negata.

mod guard;
mod kernel;
mod read;

pub use guard::{
    authorize_query, filter_query_result, Capability, CapabilitySet, Granted, Guard, Policy,
    ReadOnly,
};
pub(crate) use kernel::KernelHost;
pub(crate) use read::ReadHost;
