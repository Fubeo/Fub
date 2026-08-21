//! **Le porte del panico** (§17.3): l'elenco chiuso dei punti in cui il kernel
//! entra nel codice di un provider.
//!
//! Questo enum vive nel contratto e non nel kernel perché [`Event::Trouble`]
//! lo nomina: un guasto consegnato a chi ascolta deve dire **da quale porta**
//! si è entrati, e il tipo di un evento è un tipo del contratto. Il kernel lo
//! riusa per i suoi `match` esaustivi — [`Gate::ALL`], [`Gate::what`] — e per
//! il banco `il_panico.rs`, che prova porta per porta che un panico arriva
//! dove deve.
//!
//! L'ordine è quello della dichiarazione ed è anche quello di [`Gate::ALL`].

use std::borrow::Cow;

use serde::{Deserialize, Serialize};

/// Una porta del panico: il punto in cui il kernel chiama codice di un
/// provider che può esplodere.
///
/// La 0105 diceva che il Gate non arriva nell'evento e restava una casella
/// della seduta 17; la 0161 la chiude: il campo `gate` di
/// [`Event::Trouble`](crate::event::Event::Trouble) dice a chi ascolta da
/// quale porta è entrato il guasto.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
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
