//! **Il confine contro i panici**: un provider che pania costa la *chiamata*,
//! non il vault (§9.3,
//! [decisione 0032](../../../docs/decisions/0032-il-runner-dei-job.md)).
//!
//! # Cosa costava prima
//!
//! `view_action` e `invoke_command` girano sotto il prestito **esclusivo** del
//! workspace, e `write_document` ci fa passare il parse del formato e
//! l'alimentazione degli indici. Un panico lì dentro attraversa il
//! `RwLockWriteGuard` di chi ha chiamato, e da quel momento il lock è
//! **avvelenato**: i `.write().unwrap()` di chi monta lo traducono in un panico
//! su *ogni* comando successivo, cioè in un vault irraggiungibile fino al
//! riavvio. La [decisione 0024](../../../docs/decisions/0024-chi-legge-non-aspetta-chi-legge.md)
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
//! ([decisione 0052](../../../docs/decisions/0052-cio-che-va-storto-e-un-evento.md)).

use std::any::Any;
use std::panic::{catch_unwind, AssertUnwindSafe};

use fub_abi::PluginError;

/// Il messaggio di un panico, per chi deve raccontarlo.
fn why(payload: Box<dyn Any + Send>) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() {
        return (*s).to_string();
    }
    if let Some(s) = payload.downcast_ref::<String>() {
        return s.clone();
    }
    "panico senza messaggio".to_string()
}

/// Chiama codice di un provider che può **rispondere di no**: un panico diventa
/// il suo `Err`, e nomina chi e cosa.
///
/// `who` è l'id del plugin e `what` è ciò che gli si stava chiedendo, perché un
/// «qualcosa è andato storto» che non dice quale plugin è la stessa cosa di non
/// dirlo affatto.
pub fn calling<R>(
    who: &str,
    what: &str,
    f: impl FnOnce() -> Result<R, PluginError>,
) -> Result<R, PluginError> {
    caught(who, what, |m| PluginError::Internal(m.into()), f)
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
    what: &str,
    wrap: impl FnOnce(String) -> E,
    f: impl FnOnce() -> Result<R, E>,
) -> Result<R, E> {
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(out) => out,
        Err(payload) => Err(wrap(format!(
            "`{who}` è andato in panico {what}: {}",
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
/// ([decisione 0052](../../../docs/decisions/0052-cio-che-va-storto-e-un-evento.md)),
/// e questa funzione ha smesso di decidere da sé dove va a finire un panico:
/// lo **restituisce**, e chi chiama — che è dentro il kernel e ha l'event bus —
/// lo emette come `Event::Trouble`.
///
/// La forma è quella della [decisione 0030](../../../docs/decisions/0030-il-rilevamento-si-puo-chiedere.md)
/// letta al contrario: là l'esito si è messo al sicuro **dentro** chi lo
/// produce, perché dipendeva dall'attenzione di chi lo riceveva; qui chi
/// produce non ha un canale (è una funzione libera, senza workspace) e allora
/// il minimo è che non lo butti via da solo. Un `Option` che si ignora si vede
/// in review; un `eprintln!` no.
#[must_use = "un panico che nessuno emette è tornato a essere una perdita silenziosa (§20.2)"]
pub fn reporting(who: &str, what: &str, f: impl FnOnce()) -> Option<PluginError> {
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(()) => None,
        Err(payload) => Some(PluginError::Internal(
            format!("`{who}` è andato in panico {what}: {}", why(payload)).into(),
        )),
    }
}
