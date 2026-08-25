//! Tipi d'errore del contratto. Tutti serializzabili così da poter
//! attraversare il confine WASM (M5) e l'IPC verso il frontend.
//!
//! # Un errore è testo che qualcuno legge (§12.2)
//!
//! Il payload di ogni variante è un [`Text`], non una `String`, ed è il gemello
//! dichiarato della [decisione 0040](../../../docs/decisions/0192-impostazioni-locale-e-temi.md):
//! *chi localizza le stringhe localizza anche gli errori, e un messaggio già
//! composto non si traduce.* Un errore era, fino a questa seduta, l'unica cosa
//! che attraversava il confine verso uno schermo senza poter essere tradotta.
//!
//! Resta però una cosa che le etichette di una UI non hanno, e va detta perché
//! è la ragione per cui `thiserror` è ancora qui:
//!
//! > **`Display` è per chi legge un log, `Text` è per chi legge uno schermo.**
//!
//! Le due forme convivono senza contendersi: `#[error(…)]` compone la riga che
//! finisce su `stderr` — dove un `Text::Message` si stampa come la sua chiave e
//! i suoi argomenti, che è esattamente ciò che serve a chi cerca — e il kernel
//! risolve lo stesso valore quando l'errore esce verso una persona.
//!
//! # Perché le varianti sono nove e non sei
//!
//! `KernelError` (`crates/fub-kernel/src/error.rs`) **non è nel contratto**, e
//! non ci deve stare: è la lingua dell'host, e un host diverso ne avrà un'altra.
//! Ma finché il contratto non sapeva dire *non trovato*, *esiste già* e *I/O*,
//! quei tre fallimenti attraversavano il confine come
//! [`Internal`](PluginError::Internal) — cioè come «errore interno del plugin»
//! scritto sotto un'azione che l'utente aveva appena chiesto — e chi li riceveva
//! poteva solo leggerne la prosa.
//!
//! Il costo lo pagava un cliente vero, ed è quello che il §12.2 nomina: il
//! ripristino dal cestino (`frontend/src/panels/trash.ts`) aveva un `catch` nudo
//! che intercettava **qualunque** errore e assumeva «il path è di nuovo
//! occupato». Un disco pieno o un permesso negato producevano quindi la domanda
//! sbagliata — *«esiste già: la ripristino con un altro nome?»* — e la risposta
//! «Ripristina» ritentava con un nome libero, che sul disco pieno falliva
//! di nuovo.

use serde::{Deserialize, Serialize};

use crate::format::SourceKind;
use crate::text::{Localize, Text};

/// Errore prodotto da un `FormatProvider`.
///
/// Le prime tre restano a `String` di proposito, e la differenza con
/// [`PluginError`] è chi legge: quelle le produce un parser su un sorgente,
/// dicono *dove* e *cosa* di un documento — un numero di riga, un delimitatore
/// non chiuso — e chi le consuma è il codice che le ha chiamate. Non sono la
/// frase che compare sotto un pulsante, e il kernel le porta a
/// [`Internal`](PluginError::Internal), cioè a un log.
///
/// [`Unsupported`](FormatError::Unsupported) **non è come le altre tre**, ed è
/// la ragione per cui è l'unica che non porta prosa. Non è una diagnosi su un
/// documento: è il **disaccordo fra due dati già dichiarati** — la forma che il
/// provider ha chiesto in [`FormatDescriptor::source`] e quella che ha ricevuto
/// —, il kernel la porta a [`Unserved`](PluginError::Unserved), cioè sotto gli
/// occhi di chi ha appena aperto un file, e la frase è **derivabile per intero**
/// da quei due dati. Un payload di prosa lì voleva dire una cosa sola: che a
/// scriverla fosse chi ha implementato il provider, nella lingua in cui gli
/// veniva, e che nessuno potesse più comporla diversamente.
///
/// [`FormatDescriptor::source`]: crate::format::FormatDescriptor::source
#[derive(Clone, Debug, PartialEq, thiserror::Error, Serialize, Deserialize)]
pub enum FormatError {
    #[error("parse failed: {0}")]
    Parse(String),
    #[error("render failed: {0}")]
    Render(String),
    #[error("serialize failed: {0}")]
    Serialize(String),
    /// **La sorgente non è la sua**: il provider aveva dichiarato di volere
    /// l'altra forma (§3.4).
    ///
    /// È una **variante di struct**, e non per gusto: senza `..` un campo nuovo
    /// qui dà `E0027` a chi la costruisce e a chi la legge — la forma di
    /// `Inline`/`Block` in `fub-format-markdown::serialize`. Chi la costruisce
    /// non può dimenticarsi di dire *chi* ha rifiutato e *cosa* ha ricevuto,
    /// perché sono i due dati con cui la frase si compone, e la frase la
    /// compone chi sta sulla via d'uscita — non lui.
    /// L'id del formato che ha detto di no — quello del suo
    #[error("format \"{format}\" cannot read a source of kind {got:?}")]
    Unsupported {
        /// [`FormatDescriptor::id`](crate::format::FormatDescriptor::id).
        /// La forma di sorgente che ha ricevuto, e che non è la sua.
        format: String,
        /// Errore prodotto da un plugin (nativo o WASM), e **la forma con cui ogni
        got: SourceKind,
    },
}

/// fallimento arriva a chi disegna**.
///
/// Sul filo è adiacentemente taggato — `{"kind": "bad_args", "message": …}` —
/// come [`UiValue`](crate::ui::UiValue) e
/// [`ArgValue`](crate::text::ArgValue). Prima serializzava nella forma di
/// default di serde (`{"BadArgs": …}`), che nessuno leggeva perché il confine
/// Tauri buttava via il tipo e mandava una stringa: la forma è stata scelta nel
/// momento in cui ha guadagnato il primo lettore.
/// Il sorgente su cui l'operazione era stata calcolata non è più quello
#[derive(Clone, Debug, PartialEq, thiserror::Error, Serialize, Deserialize)]
#[serde(tag = "kind", content = "message", rename_all = "snake_case")]
pub enum PluginError {
    #[error("unknown command: {0}")]
    UnknownCommand(Text),
    #[error("unknown view: {0}")]
    UnknownView(Text),
    #[error("unknown job: {0}")]
    UnknownJob(Text),
    #[error("invalid arguments: {0}")]
    BadArgs(Text),
    #[error("permission denied: {0}")]
    PermissionDenied(Text),
    #[error("internal plugin error: {0}")]
    Internal(Text),
    /// (vedi [`EditRequest::base`](crate::edit::EditRequest::base)).
    ///
    /// È un caso a sé e non un [`BadArgs`](PluginError::BadArgs) perché è
    /// l'unico errore del confine che **non è una colpa di chi chiama**: gli
    /// argomenti erano giusti quando li ha calcolati, e la risposta giusta è
    /// ricalcolare, non correggere. Chi non li distingue riprova all'infinito
    /// una richiesta malformata, o rinuncia a una che sarebbe riuscita.
    /// **Nessuno serve questa domanda**: nessun indice registrato ha dichiarato
    /// la rotta che servirebbe (vedi [`QueryRoute`](crate::traits::QueryRoute)).
    #[error("document changed in the meantime: {0}")]
    Conflict(Text),
    ///
    /// È un caso a sé, e distinguerlo è metà del valore del routing dichiarato:
    /// prima «nessuno la serve» e «chi la serve ha fallito» arrivavano al
    /// chiamante nella stessa forma — un `BadArgs`, per giunta quello
    /// dell'ultimo interpellato — e chi disegna non poteva sapere se mostrare
    /// «installa un indice» o «qualcosa è andato storto».
    /// **Annullato**: il lavoro non è fallito, è stato fermato — da chi l'ha
    /// chiesto, o dalla chiusura del vault.
    #[error("no index serves this query: {0}")]
    Unserved(Text),
    ///
    /// È un caso a sé perché è l'unico esito che **non è un difetto di
    /// nessuno**, e chi disegna deve poterlo dire diversamente: un job fallito
    /// si riprova e si segnala, un job annullato si è ottenuto ciò che si
    /// voleva. Senza, l'unica forma disponibile sarebbe `internal`, cioè
    /// «errore interno del plugin» scritto sotto un pulsante che l'utente ha
    /// appena premuto.
    ///
    /// Lo riceve chi chiama una capacità dell'host **dopo** che il proprio job è
    /// stato annullato (decisione 0032): la cancellazione non aggiunge una
    /// capacità al contratto, toglie le altre.
    /// **Non c'è**: il documento, la versione, la voce di cestino che si nomina
    /// non esiste.
    #[error("cancelled: {0}")]
    Cancelled(Text),
    ///
    /// Distinto da [`BadArgs`](PluginError::BadArgs) perché l'argomento *era*
    /// ben formato: `a/Uno.md` è un `DocId` valido, e chi lo ha chiesto non ha
    /// sbagliato a scriverlo — semmai qualcuno l'ha cancellato nel frattempo. Chi
    /// disegna deve poter dire «non esiste più» invece di «hai sbagliato a
    /// chiedere», e chi automatizza deve poter smettere invece di correggere.
    /// **C'è già**: il path che si vuole occupare è occupato.
    ///
    /// È la variante che il §12.2 nomina per nome, ed è l'unica che rende vero
    #[error("not found: {0}")]
    NotFound(Text),
    /// il ramo del ripristino dal cestino: solo qui la domanda *«lo ripristino
    /// con un altro nome?»* è quella giusta. Con un `Io` o un
    /// [`PermissionDenied`](PluginError::PermissionDenied) è la domanda
    /// sbagliata, e la risposta affermativa ritenta qualcosa che fallirà uguale.
    /// **Il supporto ha detto di no**: disco pieno, file in uso, cartella
    /// sparita sotto i piedi, path non UTF-8.
    ///
    #[error("already exists: {0}")]
    AlreadyExists(Text),
    /// Non è `Internal`, e la differenza è chi ha sbagliato: `Internal` è un
    /// difetto di chi ha scritto il codice, questo è il mondo. Chi disegna lo
    /// dice diversamente (*«riprova»*, non *«segnala un bug»*), e chi riprova ha
    /// ragione di farlo.
    /// Il payload, per chi deve leggerlo o risolverlo senza sapere quale
    /// variante ha in mano.
    ///
    #[error("I/O error: {0}")]
    Io(Text),
}

impl PluginError {
    /// Il `match` è esaustivo di proposito: una variante nuova deve rompere la
    /// compilazione qui, non arrivare a uno schermo con la propria chiave non
    /// tradotta.
    /// Come sopra, in scrittura: è ciò da cui passa la risoluzione.
    /// La forma sul filo è quella che il mirror TypeScript dichiara, ed è
    /// **discriminabile**: chi la riceve sceglie un ramo sul `kind`, non
    pub fn message(&self) -> &Text {
        match self {
            PluginError::UnknownCommand(t)
            | PluginError::UnknownView(t)
            | PluginError::UnknownJob(t)
            | PluginError::BadArgs(t)
            | PluginError::PermissionDenied(t)
            | PluginError::Internal(t)
            | PluginError::Conflict(t)
            | PluginError::Unserved(t)
            | PluginError::Cancelled(t)
            | PluginError::NotFound(t)
            | PluginError::AlreadyExists(t)
            | PluginError::Io(t) => t,
        }
    }

    /// cercando una sottostringa nella prosa.
    pub fn message_mut(&mut self) -> &mut Text {
        match self {
            PluginError::UnknownCommand(t)
            | PluginError::UnknownView(t)
            | PluginError::UnknownJob(t)
            | PluginError::BadArgs(t)
            | PluginError::PermissionDenied(t)
            | PluginError::Internal(t)
            | PluginError::Conflict(t)
            | PluginError::Unserved(t)
            | PluginError::Cancelled(t)
            | PluginError::NotFound(t)
            | PluginError::AlreadyExists(t)
            | PluginError::Io(t) => t,
        }
    }
}

impl Localize for PluginError {
    fn visit_texts(&mut self, visit: &mut dyn FnMut(&mut Text)) {
        visit(self.message_mut());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `Display` resta la forma per il log, e non pretende di essere quella per
    /// l'utente: una chiave non risolta si stampa come sé stessa.
    /// Il payload si legge e si risolve senza sapere quale variante si ha in
    #[test]
    fn the_wire_shape_is_discriminable() {
        let and = PluginError::AlreadyExists("a/Uno.md".into());
        let json = serde_json::to_value(&and).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"kind": "already_exists", "message": "a/Uno.md"})
        );
        let back: PluginError = serde_json::from_value(json).unwrap();
        assert_eq!(back, and);
    }

    /// mano: è ciò su cui poggia la risoluzione del kernel.
    /// l'utente: una chiave non risolta si stampa come sé stessa.
    #[test]
    fn display_is_still_for_logs() {
        assert_eq!(
            PluginError::NotFound("a/Uno.md".into()).to_string(),
            "not found: a/Uno.md"
        );
        assert_eq!(
            PluginError::Io(Text::key("disco.pieno")).to_string(),
            "I/O error: disco.pieno"
        );
    }

    /// Il payload si legge e si risolve senza sapere quale variante si ha in
    /// mano: è ciò su cui poggia la risoluzione del kernel.
    #[test]
    fn the_payload_is_reachable_whatever_the_variant() {
        use crate::text::{StringCatalog, Strings};
        use crate::Locale;

        let catalogs = vec![StringCatalog::new("en").with("disco.pieno", "The disk is full.")];
        let locale = Locale {
            language: "en".into(),
            ..Locale::default()
        };
        let mut and = PluginError::Io(Text::key("disco.pieno"));
        Strings::new(&catalogs, "en", &locale).localize(&mut and);
        assert_eq!(and, PluginError::Io("The disk is full.".into()));
        assert_eq!(and.message(), &Text::Literal("The disk is full.".into()));
    }
}
