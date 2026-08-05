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
use std::borrow::Cow;
use std::panic::{catch_unwind, AssertUnwindSafe};

use fub_abi::PluginError;

#[cfg(panic = "abort")]
compile_error!(
    "`fub-kernel` regge i panici dei componenti con `catch_unwind` (§9.3, decisione 0032), e \
     `catch_unwind` presuppone che un panico srotoli. Con `panic = \"abort\"` la rete sparisce \
     senza che nessun test se ne accorga: un plugin che pania si porta via il processo, cioè il \
     vault dell'utente. Se questo profilo lo si vuole davvero, la risposta non è togliere questa \
     riga — è isolare i componenti fuori dal processo (§24.2, o il guest WASM di M5)."
);

/// **Le porte da cui si entra in codice di un terzo**, una per specie.
///
/// Esiste perché l'elenco c'era già e stava in prosa: la 0032 aveva scritto
/// *«otto porte, e sono tutte quelle da cui si entra in codice di un plugin»* —
/// un criterio dichiarato **esaustivo**, tenuto a mano, in un documento
/// immutabile. Le porte, misurate, sono quelle di questo enum: la 0046 ne ha
/// aggiunta una ([`Gate::IndexUpToDate`]) senza che nessuno tornasse a
/// correggere il conto, e altre erano semplicemente sfuggite al censimento.
/// Nessuno se n'era accorto perché **niente confrontava l'elenco col codice**:
/// è la forma che il §16.7 chiama *esaustivo a memoria, non per costruzione*, e
/// la stessa che la
/// [0104](../../../docs/decisions/0104-la-superficie-di-scrittura-si-presta.md)
/// ha risolto per le superfici delle view — *un conto non sa quante cose
/// esistano fuori di lui; il compilatore sì*.
///
/// Da qui in poi una porta nuova non si può aprire in silenzio: [`Gate::what`]
/// è un `match` esaustivo senza `_`, quindi chi ne aggiunge una **non compila**
/// finché non le dà un nome e una frase, e il banco `il_panico.rs` non compila
/// finché non dichiara se quella porta è provata o perché no.
///
/// L'ordine è quello della dichiarazione ed è anche quello di [`Gate::ALL`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Gate {
    /// Un comando invocato: `invoke_command`, tutti e due i rami.
    Command,
    /// Una view che **disegna**: `render_view`.
    ViewRender,
    /// Una view che **agisce**: `view_action`.
    ViewAction,
    /// Un servizio servito a un altro componente: `call_service`.
    Service,
    /// Un evento consegnato a un `EventHandler`.
    Event,
    /// Un indice che riceve un lotto di documenti.
    IndexFeed,
    /// Un indice a cui si tolgono dei documenti.
    IndexForget,
    /// Un indice che dice **cosa ha già** (§14.2): nata con la 0046, cioè
    /// **dopo** l'elenco della 0032, ed è la porta che dimostra il difetto.
    IndexUpToDate,
    /// Un indice che si riallinea a fine indicizzazione.
    IndexReconcile,
    /// Il `parse` di un provider di formato, che è dentro **ogni** scrittura.
    FormatParse,
    /// L'innesto di una `SyntaxRule` sul modello.
    SyntaxRule,
    /// Il disegno di un `CustomRenderer`.
    CustomRender,
    /// Un job che gira sul pool, dove non c'è nemmeno un chiamante a cui il
    /// panico possa arrivare.
    Job,
}

impl Gate {
    /// Ogni porta, una volta sola.
    ///
    /// Le varianti sono **nominate** una per una invece di derivate: toglierne
    /// una in coda non compila, che è il caso a cui la forma di
    /// `Capability::ALL` era cieca prima della 0104.
    pub const ALL: [Gate; 13] = [
        Gate::Command,
        Gate::ViewRender,
        Gate::ViewAction,
        Gate::Service,
        Gate::Event,
        Gate::IndexFeed,
        Gate::IndexForget,
        Gate::IndexUpToDate,
        Gate::IndexReconcile,
        Gate::FormatParse,
        Gate::SyntaxRule,
        Gate::CustomRender,
        Gate::Job,
    ];

    /// **Cosa si stava chiedendo**, per il messaggio che leggerà chi ha
    /// chiamato: la frase della porta, col dettaglio del sito dentro.
    ///
    /// Le tredici frasi stavano in tredici `format!` sparsi, che è il modo in
    /// cui l'elenco era diventato incensibile. Qui un `match` esaustivo le tiene
    /// insieme e le rende il posto in cui si vede, in una schermata, cosa
    /// l'utente legge quando un componente esplode.
    ///
    /// `detail` è ciò che il sito sa e la porta no — quale comando, quale view,
    /// quale documento. Le porte che non ne hanno uno lo ignorano, e il banco
    /// verifica che ognuna faccia l'una cosa o l'altra: una porta che accetta un
    /// dettaglio e lo butta è un messaggio che non dice quale.
    pub fn what(self, detail: &str) -> Cow<'static, str> {
        match self {
            Gate::Command => format!("eseguendo `{detail}`").into(),
            Gate::ViewRender => format!("disegnando `{detail}`").into(),
            Gate::ViewAction => format!("reagendo a un'azione di `{detail}`").into(),
            Gate::Service => format!("servendo `{detail}`").into(),
            Gate::Event => "ricevendo un evento".into(),
            Gate::IndexFeed => "indicizzando un lotto di documenti".into(),
            Gate::IndexForget => "togliendo un lotto di documenti".into(),
            Gate::IndexUpToDate => "dicendo cosa ha già".into(),
            Gate::IndexReconcile => "riconciliando".into(),
            Gate::FormatParse => format!("parsando `{detail}`").into(),
            Gate::SyntaxRule => "innestandosi sul documento".into(),
            Gate::CustomRender => format!("disegnando `{detail}`").into(),
            Gate::Job => format!("eseguendo il job `{detail}`").into(),
        }
    }

    /// Se la porta porta un dettaglio, cioè se [`Gate::what`] lo nomina.
    ///
    /// Serve al banco, non al kernel: è l'altra metà della frase, quella che
    /// permette di provare in rosso che nessuna porta accetta un dettaglio per
    /// poi buttarlo via.
    #[must_use]
    pub fn carries_detail(self) -> bool {
        self.what("\u{1}").contains('\u{1}')
    }
}

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
