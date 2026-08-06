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
//! letture di [`Famiglia::TUTTE`].
//!
//! # Chi si accorge se torna a rompersi
//!
//! Tre attori, come vuole la
//! [0105](../../../docs/decisions/0105-una-porta-si-nomina-e-un-presupposto-si-compila.md):
//!
//! 1. **il compilatore** prende la variante che non vuol dire niente: ogni
//!    `match` su `Famiglia` è esaustivo, quindi una famiglia nuova non compila
//!    finché non dice il proprio catalogo e le proprie impostazioni;
//! 2. **un test** prende [`Famiglia::TUTTE`] che dimentica una variante —
//!    l'unica cosa che l'esaustività non copre, perché un array è un valore e
//!    non un `match` (vedi `tutte_le_famiglie_sono_in_tutte`);
//! 3. **un conto** prende la famiglia che nasce nel kernel e qui non entra:
//!    `famiglie-del-kernel` conta le varianti, `cataloghi-del-kernel` conta i
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Famiglia {
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

impl Famiglia {
    /// Quante sono. Il numero è **legato all'array**: cambiarlo senza cambiare
    /// [`Famiglia::TUTTE`] non compila, in tutte e due le direzioni.
    pub const QUANTE: usize = 5;

    /// Tutte, nell'ordine in cui il montaggio le somma.
    ///
    /// L'ordine non è alfabetico: è quello in cui le chiavi finiscono nel
    /// pannello, e cambiarlo cambia cosa vede chi legge.
    pub const TUTTE: [Famiglia; Self::QUANTE] = [
        Famiglia::Locale,
        Famiglia::Maintenance,
        Famiglia::Journal,
        Famiglia::Properties,
        Famiglia::Ignore,
    ];

    /// Il posto di questa famiglia dentro [`Famiglia::TUTTE`].
    ///
    /// Esiste per una ragione sola, ed è la ragione per cui è un `match` e non
    /// una ricerca dentro l'array: **una variante nuova non compila finché
    /// qualcuno non le dà un posto**, e il posto che le si dà o è nuovo — e
    /// allora `QUANTE` deve crescere, e allora `TUTTE` deve guadagnare la sua
    /// riga — oppure è già preso, e lo dice `tutte_le_famiglie_sono_in_tutte`.
    pub const fn posto(self) -> usize {
        match self {
            Famiglia::Locale => 0,
            Famiglia::Maintenance => 1,
            Famiglia::Journal => 2,
            Famiglia::Properties => 3,
            Famiglia::Ignore => 4,
        }
    }

    /// Il nome con cui questa famiglia si nomina in un messaggio d'errore.
    /// Non è una stringa da tradurre: la legge chi ripara un presidio, non
    /// chi usa Fub.
    pub const fn nome(self) -> &'static str {
        match self {
            Famiglia::Locale => "locale",
            Famiglia::Maintenance => "maintenance",
            Famiglia::Journal => "journal",
            Famiglia::Properties => "properties",
            Famiglia::Ignore => "ignore",
        }
    }

    /// Il catalogo di stringhe di questa famiglia, in tutte le lingue che
    /// dichiara.
    pub fn catalog(self) -> Vec<StringCatalog> {
        match self {
            Famiglia::Locale => crate::locale::catalog(),
            Famiglia::Maintenance => crate::maintenance::catalog(),
            Famiglia::Journal => crate::journal::catalog(),
            Famiglia::Properties => crate::properties::catalog(),
            Famiglia::Ignore => crate::ignore::catalog(),
        }
    }

    /// Le impostazioni di questa famiglia, se ne ha.
    ///
    /// Il vuoto è un caso vero e non un buco: `maintenance` parla — il bundle
    /// diagnostico ha delle etichette — e non si configura.
    pub fn settings(self) -> Vec<SettingSpec> {
        match self {
            Famiglia::Locale => crate::locale::locale_settings(),
            Famiglia::Maintenance => Vec::new(),
            Famiglia::Journal => crate::journal::journal_settings(),
            Famiglia::Properties => crate::properties::properties_settings(),
            Famiglia::Ignore => crate::ignore::ignore_settings(),
        }
    }

    /// I cataloghi di tutte, sommati come li somma il montaggio.
    pub fn cataloghi() -> Vec<StringCatalog> {
        Self::TUTTE.iter().flat_map(|f| f.catalog()).collect()
    }

    /// Le impostazioni di tutte, nell'ordine di [`Famiglia::TUTTE`].
    pub fn impostazioni() -> Vec<SettingSpec> {
        Self::TUTTE.iter().flat_map(|f| f.settings()).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// L'unico buco che l'esaustività del `match` non copre: `TUTTE` è un
    /// valore, e un valore può dimenticare una variante mentre ogni `match`
    /// resta verde. Il `posto` di ognuna è distinto e sta dentro l'array,
    /// quindi `TUTTE` le contiene tutte esattamente una volta.
    #[test]
    fn tutte_le_famiglie_sono_in_tutte() {
        let mut visti = [None; Famiglia::QUANTE];
        for f in Famiglia::TUTTE {
            let posto = f.posto();
            assert!(
                visti[posto].is_none(),
                "«{}» e «{}» occupano lo stesso posto ({posto}) in `TUTTE`: \
                 una delle due non è montata da nessuno",
                f.nome(),
                visti[posto].map(Famiglia::nome).unwrap_or("?"),
            );
            visti[posto] = Some(f);
        }
        let mancanti: Vec<usize> = visti
            .iter()
            .enumerate()
            .filter(|(_, v)| v.is_none())
            .map(|(i, _)| i)
            .collect();
        assert!(
            mancanti.is_empty(),
            "`Famiglia::TUTTE` non nomina i posti {mancanti:?}: una famiglia \
             del kernel esiste, ha un `catalog()`, e il montaggio non la vede"
        );
    }

    /// Una famiglia senza catalogo non è una famiglia: è un modulo che non
    /// aveva bisogno di stare in questo elenco.
    #[test]
    fn ogni_famiglia_dice_qualcosa() {
        for f in Famiglia::TUTTE {
            assert!(
                !f.catalog().is_empty(),
                "«{}» non porta nessun catalogo: se non ha stringhe da \
                 dichiarare, non deve stare qui",
                f.nome()
            );
        }
    }
}
