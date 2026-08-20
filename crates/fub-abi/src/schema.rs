//! **La versione di uno schema su disco è un tipo**, non una costante che si è
//! chiamata bene (§15.3).
//!
//! Ogni file che Fub scrive dentro il vault sopravvive alla versione di Fub che
//! l'ha scritto, e ognuno porta il proprio numero di schema: quale formato sono
//! quei byte. Undici formati, undici numeri, e la
//! [0106](../../../docs/decisions/0106-un-formato-si-presenta.md) ha dato loro
//! tre presidi — un conto che li trova nei sorgenti, un conto che conta le
//! righe della tabella di `docs/versionamento.md`, e un banco che confronta le
//! due liste nei due versi.
//!
//! Restava un buco, e la 0106 l'ha dichiarato scrivendolo: il conto trovava i
//! numeri **cercando la parola `VERSION` nel nome**. Una versione che si
//! chiamasse `E_SCHEMA_REV` gli passava accanto, e il verbale lo diceva con la
//! frase che ha deciso questo modulo: *la porta è che una versione di schema si
//! chiama `VERSION`*.
//!
//! # Perché il nome non è diventato una regola
//!
//! Perché la stessa 0106 aveva già misurato che quella regola non regge, e
//! l'aveva scritto due paragrafi più su: `DIAGNOSTICS_VERSION` era sfuggita per
//! un anno a un conto che guardava il nome, e **chi l'aveva chiamata così non
//! aveva sbagliato niente**. Un nome è una consuetudine anche quando lo si
//! dichiara regola: chi lo viola lo viola in buona fede, il presidio che lo
//! pretende si accorge solo di chi si era già dichiarato, e il caso che conta —
//! *questa costante è una versione di schema e non lo si vede* — resta
//! esattamente dov'era.
//!
//! Chi la fa rispettare è quindi il **compilatore**, e ciò che fa rispettare
//! non è come si chiama la costante ma cosa è: un [`SchemaVersion`], che il
//! campo del record pretende e che un `u32` non soddisfa. Il conto passa dal
//! nome al tipo e diventa insensibile alle rinomine — `const E_SCHEMA_REV:
//! SchemaVersion` è contata come le altre — e chi legge un record vede nella
//! firma del campo che quel numero non è un numero qualunque.
//!
//! Undici siti erano il numero giusto per questa forma. Con tre, un tipo
//! sarebbe stato più cerimonia che regola; con quaranta, non sarebbe passato
//! nessuno e la porta non avrebbe agganciato. Che abbia agganciato lo verifica
//! il conto stesso: `schemi-su-disco` conta i `SchemaVersion` e
//! `schemi-in-tabella` le righe del documento, e se un sito fosse rimasto
//! indietro col `u32` i due numeri divergerebbero.
//!
//! # Cosa **non** chiude, e va detto
//!
//! Un formato che nasce senza costante e senza riga in tabella non lo prende
//! nessuno dei tre presidi, ed è il buco che la 0106 dichiara e che resta: a
//! prenderlo servirebbe un tipo che ogni scrittura durevole attraversi, e non
//! c'è perché **dalla stessa porta passano i file di Fub e i file dell'utente**
//! — il markdown di una nota un numero di schema non deve averlo.
//!
//! E un secondo, che è di questo modulo: una versione scritta **al volo** nel
//! record (`v: SchemaVersion::new(1)`, senza legarla a una costante) è di
//! tipo giusto e non è contata da nessuno. Il tipo rende impossibile scrivere
//! `v: 1`; non rende impossibile non dare un nome all'1.
use std::fmt;

use serde::{Deserialize, Serialize};

/// La versione di uno **schema su disco**: quale formato sono i byte di quel
/// file.
///
/// È `#[serde(transparent)]`, quindi su disco è e resta un intero nudo: questo
/// tipo non ha cambiato un byte di nessun file già scritto, e non poteva —
/// quei file sono sui dischi delle persone.
///
/// Il confronto è quello che serve leggendo: `==` per un formato che accetta
/// solo il proprio, `<=` e `>` per uno che accetta all'indietro e rifiuta in
/// avanti. Quale dei due sia giusto è del formato e non di questo tipo — la
/// 0106 ne ha scritta la regola («il rifiuto in avanti si dice quando tacere
/// farebbe perdere qualcosa»), e una regola del genere un tipo non la può
/// imporre a tutti.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Default,
)]
#[serde(transparent)]
pub struct SchemaVersion(u32);

impl SchemaVersion {
    /// La versione `n` di uno schema.
    pub const fn new(n: u32) -> Self {
        SchemaVersion(n)
    }

    /// Il numero nudo, per chi lo deve confrontare con qualcosa che questo tipo
    /// non conosce.
    pub const fn number(self) -> u32 {
        self.0
    }

    /// La versione dopo questa. Serve a chi presidia: scrivere un file di una
    /// versione che questa copia di Fub non conosce ancora è il modo di provare
    /// che il rifiuto in avanti c'è davvero.
    pub const fn next(self) -> Self {
        SchemaVersion(self.0 + 1)
    }
}

impl fmt::Display for SchemaVersion {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Su disco è un intero nudo, e questo è ciò che rende il tipo gratuito per
    /// i file che esistono già.
    #[test]
    fn on_disk_it_remains_a_number() {
        #[derive(Serialize, Deserialize, PartialEq, Debug)]
        struct Record {
            v: SchemaVersion,
        }
        let r = Record {
            v: SchemaVersion::new(3),
        };
        let json = serde_json::to_string(&r).expect("a record serializes");
        assert_eq!(json, r#"{"v":3}"#);
        let reloaded: Record = serde_json::from_str(r#"{"v":3}"#).expect("and it reads back");
        assert_eq!(reloaded, r);
    }

    #[test]
    fn it_compares_like_a_number() {
        assert!(SchemaVersion::new(1) < SchemaVersion::new(2));
        assert_eq!(SchemaVersion::new(1).next(), SchemaVersion::new(2));
        assert_eq!(format!("{}", SchemaVersion::new(5)), "5");
    }
}
