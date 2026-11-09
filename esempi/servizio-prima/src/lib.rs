//! Un plugin compilato contro l'interfaccia `servizio` «di prima» (#289).
//!
//! Conosce due colori e due forme, ed esporta due funzioni. L'host del test le
//! chiama per provare che il guest funziona, e poi cresce: un colore in più,
//! una forma in più, una funzione in più. Quello che succede allora è il
//! risultato che `docs/reference/abi-and-wit.md` riporta in «Compatibilità».

wit_bindgen::generate!({
    path: "wit",
    world: "servizio-prima",
});

use exports::esempio::servizio::servizio::{Colore, Forma, Guest};

struct Componente;

impl Guest for Componente {
    fn eco_colore(colore: Colore) -> Colore {
        colore
    }

    fn descrivi(forma: Forma) -> String {
        match forma {
            Forma::Punto => "punto".to_string(),
            Forma::Cerchio(raggio) => format!("cerchio di raggio {raggio}"),
        }
    }
}

export!(Componente);
