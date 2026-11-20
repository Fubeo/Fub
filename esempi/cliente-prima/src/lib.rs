//! Un plugin compilato contro l'interfaccia importata `fornitore` «di prima»
//! (PA T58).
//!
//! Conosce due stati e due eventi, e li riceve dall'host. Il test lo fa
//! girare davanti a un host uguale, poi davanti a un host cresciuto: uno stato
//! in più, un evento in più, una funzione in più. Quello che succede allora è
//! il risultato che `docs/reference/abi-and-wit.md` riporta in
//! «Compatibilità».

wit_bindgen::generate!({
    path: "wit",
    world: "cliente-prima",
});

use esempio::fornitore::fornitore::{prossimo_evento, stato_attuale, Evento, Stato};
use exports::esempio::fornitore::cliente::Guest;

struct Componente;

impl Guest for Componente {
    fn leggi_stato() -> String {
        match stato_attuale() {
            Stato::Pronto => "pronto".to_string(),
            Stato::Occupato => "occupato".to_string(),
        }
    }

    fn leggi_evento() -> String {
        match prossimo_evento() {
            Evento::Vuoto => "vuoto".to_string(),
            Evento::Testo(testo) => format!("testo: {testo}"),
        }
    }
}

export!(Componente);
