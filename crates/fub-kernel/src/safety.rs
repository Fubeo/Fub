//! **Il confine contro i panici**: un provider che pania costa la *chiamata*,
//! non il vault (§9.3,
//! [decisione 0032](../../../docs/decisions/0183-composizione-host-kernel.md)).
//!
//! # Cosa costava prima
//!
//! `view_action` e `invoke_command` girano sotto il prestito **esclusivo** del
//! workspace, e `write_document` ci fa passare il parse del formato e
//! l'alimentazione degli indici. Un panico lì dentro attraversa il
//! `RwLockWriteGuard` di chi ha chiamato, e da quel momento il lock è
//! **avvelenato**: i `.write().unwrap()` di chi monta lo traducono in un panico
//! su *ogni* comando successivo, cioè in un vault irraggiungibile fino al
//! riavvio. La [decisione 0024](../../../docs/decisions/README.md)
//! ne aveva tolto una metà — un `RwLock` si avvelena solo se a paniare è chi
//! tiene il prestito esclusivo, quindi un provider che **disegna** non se lo
//! portava più via — e questa è l'altra metà, quella di chi **agisce**.
//!
//! # Dove sta la rete, e perché sta lì
//!
//! **Attorno alla chiamata del provider, e a niente di più.** È la parte da non
//! spostare "più in alto per comodità": il kernel, intorno a quella chiamata, ha
//! invarianti da rimettere a posto — la tabella dei provider prestata
//! (`lend`), la pila dei comandi e quella dei servizi, la bandiera
//! `in_provider_call`, l'attore corrente, il lotto aperto. Tutto quel codice
//! sta **fuori** dalla rete e gira normalmente sul ramo dell'errore, perché era
//! già scritto per gestirlo (il `pop` prima del `?`). Catturare più in alto
//! salterebbe quei ripristini e lascerebbe il vault con la tabella delle view
//! vuota o un comando per sempre "in giro": si sarebbe salvato il lock e perso
//! il kernel.
//!
//! # Cosa questa rete NON è
//!
//! Non è un `Result` in più nel contratto: un panico resta un **difetto**, non
//! una condizione. Il plugin che lo produce non lo vede mai — lo vede chi lo ha
//! chiamato, sotto forma di [`PluginError::Internal`] che lo **nomina**. E non è
//! una disattivazione: dopo un panico lo stato di quel provider è ignoto, ma
//! spegnerlo da soli senza poterlo **riaccendere** (§11.1) farebbe di un
//! difetto passeggero una perdita permanente. Dirlo invece adesso si può, ed è
//! ciò che [`reporting`] serve a fare: il canale del §20.2 esiste
//! ([decisione 0052](../../../docs/decisions/0184-eventi-accodati-e-job.md)).
//!
//! # Il presupposto della rete, e chi lo verifica
//!
//! Tutto questo modulo presuppone una cosa sola: **che un panico srotoli**. La
//! 0032 l'aveva scritto, e l'aveva scritto *nel verbale* — «un profilo con
//! `panic = "abort"` farebbe sparire questa rete in silenzio; […] se un giorno
//! lo facesse questa è la riga da rileggere». Un verbale è immutabile e non si
//! rilegge: chiedeva a chi aggiunge un `[profile.release]` di ricordarsi di una
//! frase scritta anni prima, cioè nel momento esatto in cui non la sta leggendo
//! (§23.15).
//!
//! Adesso il presupposto sta **accanto al codice che lo usa** e lo verifica il
//! compilatore: il [`compile_error!`] qui sotto. Non è un divieto per sempre —
//! è un divieto finché la risposta a un componente che pania è *catturare*. Il
//! giorno che si vuole `panic = "abort"` per davvero (è la prima cosa che si
//! aggiunge guardando la dimensione del binario), la risposta non è togliere
//! questa riga: è che un componente che pania va isolato **altrove**, nel
//! processo separato o nel guest WASM di M5, che quella proprietà ce l'ha per
//! costruzione. La riga da cambiare, allora, è questo modulo intero.
//!
//! Perché un `cfg` e non un test: un test **non può** vederlo. Cargo ignora
//! `panic` per i profili `test` e `bench` — il suo harness ha bisogno dello
//! srotolamento — quindi un `[profile.release] panic = "abort"` non arriva
//! nemmeno a `cargo test --release`. La 0032 temeva che
//! `crates/fub-kernel/tests/il_panico.rs` **abortisse** il processo; il fatto
//! misurato è peggiore: resterebbe **verde**, a testimoniare una rete che nel
//! binario spedito non c'è più. Un `cfg` invece è del *crate che si compila*, e
//! prende anche `RUSTFLAGS=-Cpanic=abort`, che nessuna lettura del
//! `Cargo.toml` vedrebbe.

use std::any::Any;
use std::panic::{catch_unwind, AssertUnwindSafe};

use fub_abi::PluginError;

#[cfg(panic = "abort")]
compile_error!(
    "`fub-kernel` catches component panics with `catch_unwind` (§9.3, decision 0032), and \
     `catch_unwind` presupposes that a panic unwinds. With `panic = \"abort\"` the net \
     disappears without any test noticing: a panicking plugin takes out the process, i.e. the \
     user's vault. If this profile is truly desired, the response is not to remove this \
     line — it is to isolate components outside the process (§24.2, or M5's WASM guest)."
);

/// Le porte da cui si entra in codice di un terzo vivono nel **contratto**,
/// perché [`Event::Trouble`](fub_abi::event::Event::Trouble) le nomina: un
/// guasto consegnato a chi ascolta deve dire da quale porta si è entrati, e il
/// tipo di un evento è un tipo del contratto (decisione 0161). Questo modulo le
/// riusa per i suoi `match` esaustivi — [`Gate::ALL`], [`Gate::what`] — e per
/// il banco `il_panico.rs`, che prova porta per porta che un panico arriva
/// dove deve.
pub use fub_abi::Gate;

/// Il messaggio di un panico, per chi deve raccontarlo.
fn why(payload: Box<dyn Any + Send>) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() {
        return (*s).to_string();
    }
    if let Some(s) = payload.downcast_ref::<String>() {
        return s.clone();
    }
    "panic without message".to_string()
}

/// Chiama codice di un provider che può **rispondere di no**: un panico diventa
/// il suo `Err`, e nomina chi e cosa.
///
/// `who` è l'id del plugin, `gate` la porta da cui gli si è entrati e `detail`
/// ciò che la porta non sa (quale comando, quale view), perché un «qualcosa è
/// andato storto» che non dice quale plugin è la stessa cosa di non dirlo
/// affatto.
pub fn calling<R>(
    who: &str,
    gate: Gate,
    detail: &str,
    f: impl FnOnce() -> Result<R, PluginError>,
) -> Result<R, PluginError> {
    caught(who, gate, detail, |m| PluginError::Internal(m.into()), f)
}

/// Isola una callback esterna che non appartiene a una porta dell'ABI.
///
/// [`Gate`] censisce le chiamate del kernel ai provider del contratto. Alcuni
/// adattatori dell'host — per esempio la fabbrica del watcher — sono comunque
/// codice esterno e possono paniare, ma non producono un `Event::Trouble`
/// perché vengono eseguiti prima che il vault e il suo bus esistano. Questa è
/// la stessa rete di [`caught`], senza inventare una porta ABI che nessun
/// evento può osservare.
///
/// `context` deve descrivere la callback completa. Il chiamante mantiene la
/// rete stretta attorno alla sola invocazione esterna, così i ripristini che la
/// circondano continuano a essere eseguiti sul ramo d'errore.
pub fn external<R, E>(
    context: &str,
    wrap: impl FnOnce(String) -> E,
    f: impl FnOnce() -> Result<R, E>,
) -> Result<R, E> {
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(out) => out,
        Err(payload) => Err(wrap(format!("{context}: {}", why(payload)))),
    }
}

/// Come [`calling`], per chi risponde di no in un'altra lingua: `wrap` è la
/// variante d'errore in cui il panico si traduce.
///
/// Ne servono due, e sono le due che il contratto ha: un provider di formato e
/// un renderer parlano [`FormatError`](fub_abi::error::FormatError), tutti gli
/// altri [`PluginError`]. Tradurre un panico nell'errore **di casa** invece che
/// in uno generico è ciò che permette a chi chiama di trattarlo come tratta già
/// il fallimento: il renderer che degrada al provider degrada anche qui, senza
/// un ramo nuovo.
pub fn caught<R, E>(
    who: &str,
    gate: Gate,
    detail: &str,
    wrap: impl FnOnce(String) -> E,
    f: impl FnOnce() -> Result<R, E>,
) -> Result<R, E> {
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(out) => out,
        Err(payload) => Err(wrap(format!(
            "`{who}` è andato in panico {}: {}",
            gate.what(detail),
            why(payload)
        ))),
    }
}

/// Chiama codice di un provider a cui **non si può restituire niente** — un
/// handler di eventi, un innesto sulla resa — e riporta a chi chiama ciò che è
/// andato storto, invece di stamparlo.
///
/// Qui c'era un `eprintln!` e un commento che diceva «il canale giusto per dirlo
/// è il §20.2, e non esiste ancora». Adesso esiste
/// ([decisione 0052](../../../docs/decisions/0184-eventi-accodati-e-job.md)),
/// e questa funzione ha smesso di decidere da sé dove va a finire un panico:
/// lo **restituisce**, e chi chiama — che è dentro il kernel e ha l'event bus —
/// lo emette come `Event::Trouble`.
///
/// La forma è quella della [decisione 0030](../../../docs/decisions/0183-composizione-host-kernel.md)
/// letta al contrario: là l'esito si è messo al sicuro **dentro** chi lo
/// produce, perché dipendeva dall'attenzione di chi lo riceveva; qui chi
/// produce non ha un canale (è una funzione libera, senza workspace) e allora
/// il minimo è che non lo butti via da solo. Un `Option` che si ignora si vede
/// in review; un `eprintln!` no.
#[must_use = "a panic that nobody emits has become a silent loss again (§20.2)"]
pub fn reporting(who: &str, gate: Gate, detail: &str, f: impl FnOnce()) -> Option<PluginError> {
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(()) => None,
        Err(payload) => Some(PluginError::Internal(
            format!(
                "`{who}` è andato in panico {}: {}",
                gate.what(detail),
                why(payload)
            )
            .into(),
        )),
    }
}
