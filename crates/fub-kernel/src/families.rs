//! **Le famiglie del kernel che si dichiarano al montaggio**, come un dato.
//!
//! Il kernel non monta niente: chi monta è `fub_host::mount`, che al bundle di
//! core somma le stringhe e le impostazioni che alcune famiglie del kernel
//! dichiarano accanto a chi le legge (§11.1). Fino a qui quell'elenco era
//! **scritto a mano in tre posti** — la riga `.speaking(…)` del montaggio,
//! l'`extend` di `core_settings`, e il banco `fub-host/tests/i_cataloghi.rs`
//! che li ricostruiva per confrontarli — e tre copie di un elenco sono tre
//! elenchi che nessuno confronta.
//!
//! Ciò che quel difetto costa non è teorico: `maintenance` è rimasta fuori dal
//! montaggio a lungo, e non è diventato rosso niente. **Un elenco scritto a
//! mano si accorge di una chiave che manca, mai di un catalogo che manca**,
//! perché ogni presidio delle stringhe guarda dalle chiavi verso le frasi: se
//! le chiavi di una famiglia non le nomina nessuno, le sue frasi non le
//! pretende nessuno, e la famiglia sparisce in silenzio.
//!
//! Qui l'elenco diventa **uno**, ed è un tipo. Le tre copie diventano tre
//! letture di [`Family::ALL`].
//!
//! # Chi si accorge se torna a rompersi
//!
//! Tre attori, come vuole la
//! [0105](../../../docs/decisions/0105-una-porta-si-nomina-e-un-presupposto-si-compila.md):
//!
//! 1. **il compilatore** prende la variante che non vuol dire niente: ogni
//!    `match` su `Family` è esaustivo, quindi una famiglia nuova non compila
//!    finché non dice il proprio catalogo e le proprie impostazioni;
//! 2. **un test** prende [`Family::ALL`] che dimentica una variante —
//!    l'unica cosa che l'esaustività non copre, perché un array è un valore e
//!    non un `match` (vedi `all_families_are_in_all`);
//! 3. **un conto** prende la famiglia che nasce nel kernel e qui non entra:
//!    `famiglie-del-kernel` conta le varianti, `all_catalogs-del-kernel` conta i
//!    `pub fn catalog()` dei sorgenti, e i due numeri stanno nella stessa
//!    frase. Un `pub fn catalog()` nuovo senza la sua variante li fa divergere,
//!    ed è precisamente il caso che nessun `assert` dentro Rust può vedere.
use fub_abi::settings::SettingSpec;
use fub_abi::text::StringCatalog;

/// Una famiglia del kernel che porta stringhe, impostazioni, o tutte e due.
///
/// **Non** è l'elenco dei moduli del kernel: è l'elenco di quelli che hanno
/// qualcosa da dire a chi monta. Un modulo che non dichiara né un catalogo né
/// uno schema qui non entra, e non entrandoci non perde niente.
/// uno schema qui non entra, e non entrandoci non perde niente.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Family {
    /// Lingua, fuso, formati: `locale.*`.
    Locale,
    /// Il bundle diagnostico e le sue voci. **Non dichiara impostazioni**, ed è
    /// la famiglia che era rimasta fuori dal montaggio senza che niente
    /// diventasse rosso.
    Maintenance,
    /// Il registro delle mutazioni: `journal.*`.
    Journal,
    /// Il frontmatter e il formato delle date che ci si legge: `properties.*`.
    Properties,
    /// Quali file sono di questo vault: `ignore.*`.
    Ignore,
}

impl Family {
    /// Quante sono. Il numero è **legato all'array**: cambiarlo senza cambiare
    /// [`Family::ALL`] non compila, in tutte e due le direzioni.
    pub const COUNT: usize = 5;

    /// Tutte, nell'ordine in cui il montaggio le somma.
    ///
    /// L'ordine non è alfabetico: è quello in cui le chiavi finiscono nel
    /// pannello, e cambiarlo cambia cosa vede chi legge.
    pub const ALL: [Family; Self::COUNT] = [
        Family::Locale,
        Family::Maintenance,
        Family::Journal,
        Family::Properties,
        Family::Ignore,
    ];

    /// Il posto di questa famiglia dentro [`Family::ALL`].
    ///
    /// Esiste per una ragione sola, ed è la ragione per cui è un `match` e non
    /// una ricerca dentro l'array: **una variante nuova non compila finché
    /// qualcuno non le dà un posto**, e il posto che le si dà o è nuovo — e
    /// allora `COUNT` deve crescere, e allora `ALL` deve guadagnare la sua
    /// riga — oppure è già preso, e lo dice `all_families_are_in_all`.
    pub const fn place(self) -> usize {
        match self {
            Family::Locale => 0,
            Family::Maintenance => 1,
            Family::Journal => 2,
            Family::Properties => 3,
            Family::Ignore => 4,
        }
    }

    /// Il nome con cui questa famiglia si nomina in un messaggio d'errore.
    /// Non è una stringa da tradurre: la legge chi ripara un presidio, non
    pub const fn name(self) -> &'static str {
        match self {
            Family::Locale => "locale",
            Family::Maintenance => "maintenance",
            Family::Journal => "journal",
            Family::Properties => "properties",
            Family::Ignore => "ignore",
        }
    }

    /// Il catalogo di stringhe di questa famiglia, in tutte le lingue che
    pub fn catalog(self) -> Vec<StringCatalog> {
        match self {
            Family::Locale => crate::locale::catalog(),
            Family::Maintenance => crate::maintenance::catalog(),
            Family::Journal => crate::journal::catalog(),
            Family::Properties => crate::properties::catalog(),
            Family::Ignore => crate::ignore::catalog(),
        }
    }

    /// Le impostazioni di questa famiglia, se ne ha.
    ///
    /// Il vuoto è un caso vero e non un buco: `maintenance` parla — il bundle
    /// diagnostico ha delle etichette — e non si configura.
    pub fn settings(self) -> Vec<SettingSpec> {
        match self {
            Family::Locale => crate::locale::locale_settings(),
            Family::Maintenance => Vec::new(),
            Family::Journal => crate::journal::journal_settings(),
            Family::Properties => crate::properties::properties_settings(),
            Family::Ignore => crate::ignore::ignore_settings(),
        }
    }

    /// I cataloghi di tutte, sommati come li somma il montaggio.
    pub fn all_catalogs() -> Vec<StringCatalog> {
        Self::ALL.iter().flat_map(|f| f.catalog()).collect()
    }

    /// Le impostazioni di tutte, nell'ordine di [`Family::ALL`].
    pub fn all_settings() -> Vec<SettingSpec> {
        Self::ALL.iter().flat_map(|f| f.settings()).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// L'unico buco che l'esaustività del `match` non copre: `ALL` è un
    /// valore, e un valore può dimenticare una variante mentre ogni `match`
    /// resta verde. Il `place` di ognuna è distinto e sta dentro l'array,
    /// quindi `ALL` le contiene tutte esattamente una volta.
    #[test]
    fn all_families_are_in_all() {
        let mut seen = [None; Family::COUNT];
        for f in Family::ALL {
            let place = f.place();
            assert!(
                seen[place].is_none(),
                "\"{}\" and \"{}\" occupy the same slot ({place}) in `ALL`: \
                 one of them is not mounted by anyone",
                f.name(),
                seen[place].map(Family::name).unwrap_or("?"),
            );
            seen[place] = Some(f);
        }
        let missing: Vec<usize> = seen
            .iter()
            .enumerate()
            .filter(|(_, v)| v.is_none())
            .map(|(the, _)| the)
            .collect();
        assert!(
            missing.is_empty(),
            "`Family::ALL` does not name slots {missing:?}: a kernel family \
             exists, has a `catalog()`, and the mount does not see it"
        );
    }

    /// Una famiglia senza catalogo non è una famiglia: è un modulo che non
    /// aveva bisogno di stare in questo elenco.
    #[test]
    fn every_family_declares_something() {
        for f in Family::ALL {
            assert!(
                !f.catalog().is_empty(),
                "\"{}\" carries no catalog: if it has no strings to declare, \
                 it should not be here",
                f.name()
            );
        }
    }
}
