//! Come **questo vault** scrive le date nel frontmatter (§8.2).
//!
//! Una riga sola di impostazione, e il perché è tutto nella riga: la
//! [0003](../../../docs/decisions/0181-modello-documento-e-arene.md) ha deciso che
//! *solo l'ISO-8601 a larghezza fissa è una data*, con l'argomento giusto — un
//! parser tollerante trasformerebbe in date le stringhe dell'utente. Quella
//! regola resta. Ciò che cambia è **chi dichiara il formato**: un vault che
//! porta `5/7/2026` da dieci anni non chiede al parser di indovinare, chiede di
//! poterglielo dire.
//!
//! # Perché non è una chiave `locale.*`
//!
//! Perché la famiglia del locale è definita da una cosa sola: il **sistema ha
//! una risposta**, ed è il default di ognuna delle sue quattro chiavi
//! ([`AS_SYSTEM`](crate::locale::AS_SYSTEM)). Qui la risposta del sistema
//! sarebbe sbagliata per costruzione. `05/07/2026` letto su una macchina
//! italiana è il cinque luglio e su una americana è il sette maggio: un vault
//! sincronizzato fra due macchine porterebbe **due date diverse per lo stesso
//! byte**, che è precisamente il difetto che la
//! [0004](../../../docs/decisions/README.md) ha
//! rifiutato per i link — *il vault sincronizzato fra macOS e Linux è lo stesso
//! vault*. Il formato è un fatto **dei file**, non di chi guarda, e per questo
//! il suo default non è «come il sistema»: è «solo ISO», cioè nessuna lettura in
//! più finché qualcuno non se ne prende la responsabilità.

use fub_abi::model::{DateFormats, DateOrder};
use fub_abi::settings::{SettingKind, SettingSpec};
use fub_abi::text::{StringCatalog, Text};
use fub_abi::ui::UiOption;

/// L'ordine dei campi delle date non-ISO di questo vault. Vuoto = solo ISO.
pub const DATE_FORMAT: &str = "properties.date-format";

/// Il valore che vuol dire **«solo ISO-8601»**, cioè nessuna dichiarazione.
///
/// È la stringa vuota per la ragione di [`AS_SYSTEM`](crate::locale::AS_SYSTEM):
/// è ciò che si ottiene *non scegliendo*, quindi è anche il default naturale
/// dello schema e le due cose non possono divergere.
pub const ONLY_ISO: &str = "";

/// Le impostazioni che il core dichiara per le proprietà.
///
/// Di livello **vault** e non di macchina, e qui non è per inerzia della 0076:
/// il formato descrive i file che stanno *in questo vault*, quindi è l'unica
/// cosa che deve viaggiare con loro. Metterla di macchina vorrebbe dire che lo
/// stesso vault, aperto su due computer, ha due significati.
///
/// **Non** `program_writable`: un componente che potesse dichiarare il formato
/// del vault cambierebbe il valore di ogni proprietà data di ogni nota, in
/// silenzio e senza toccare un file.
pub fn properties_settings() -> Vec<SettingSpec> {
    vec![SettingSpec::new(
        DATE_FORMAT,
        Text::key(P_DATE_FORMAT),
        SettingKind::Choice {
            default: ONLY_ISO.into(),
            options: [
                UiOption::new(ONLY_ISO, Text::key(P_ONLY_ISO)),
                UiOption::new(DateOrder::Dmy.as_key(), Text::key(P_DMY)),
                UiOption::new(DateOrder::Mdy.as_key(), Text::key(P_MDY)),
                UiOption::new(DateOrder::Ymd.as_key(), Text::key(P_YMD)),
            ]
            .into(),
        },
    )
    .describing(Text::key(P_DATE_FORMAT_DESC))
    .grouped(Text::key(P_GROUP))]
}

/// I formati che valgono **adesso**, dal valore dell'impostazione.
///
/// Una parola che nessuno sa leggere vale «solo ISO» invece di far fallire la
/// lettura del vault: è la stessa scelta di
/// [`locale::resolve`](crate::locale::resolve), e per la stessa ragione — un
/// file di impostazioni scritto a mano non deve poter rendere un vault
/// illeggibile.
pub fn date_formats(declared: Option<&str>) -> DateFormats {
    declared
        .and_then(DateOrder::from_key)
        .map(DateFormats::declaring)
        .unwrap_or(DateFormats::ISO)
}

const P_GROUP: &str = "properties.group";
const P_DATE_FORMAT: &str = "properties.date_format";
const P_DATE_FORMAT_DESC: &str = "properties.date_format.desc";
const P_ONLY_ISO: &str = "properties.date_format.only_iso";
const P_DMY: &str = "properties.date_format.dmy";
const P_MDY: &str = "properties.date_format.mdy";
const P_YMD: &str = "properties.date_format.ymd";

/// Le frasi di questa impostazione, nel catalogo di chi le ha scritte (0040).
///
/// La descrizione dice cosa succede a **non** dichiarare niente, perché è lo
/// stato in cui si trova chiunque apra un vault esistente e la sola cosa che
/// spieghi perché un filtro per data non trova nulla.
pub fn catalog() -> Vec<StringCatalog> {
    vec![
        StringCatalog::new("it")
            .with(P_GROUP, "Proprietà")
            .with(P_DATE_FORMAT, "Formato delle date")
            .with(
                P_DATE_FORMAT_DESC,
                "Come sono scritte in questo vault le date che non sono in \
                 ISO-8601 (`2026-07-05`). L'ISO si legge sempre; questa scelta \
                 aggiunge una seconda lettura per le altre. Senza dichiararne \
                 una, `5/7/2026` resta un testo: si può cercare come testo, ma \
                 non si filtra né si ordina come una data. Il controllo di \
                 salute «Proprietà che sembrano date» elenca quelle che questa \
                 scelta non copre.",
            )
            .with(P_ONLY_ISO, "Solo ISO-8601")
            .with(P_DMY, "Giorno/mese/anno (5/7/2026)")
            .with(P_MDY, "Mese/giorno/anno (7/5/2026)")
            .with(P_YMD, "Anno/mese/giorno (2026/7/5)"),
        StringCatalog::new("en")
            .with(P_GROUP, "Properties")
            .with(P_DATE_FORMAT, "Date format")
            .with(
                P_DATE_FORMAT_DESC,
                "How this vault writes the dates that are not ISO-8601 \
                 (`2026-07-05`). ISO is always read; this choice adds a second \
                 reading for the others. With none declared, `5/7/2026` stays \
                 text: you can search it as text, but you cannot filter or sort \
                 it as a date. The «Properties that look like dates» health \
                 check lists the ones this choice does not cover.",
            )
            .with(P_ONLY_ISO, "ISO-8601 only")
            .with(P_DMY, "Day/month/year (5/7/2026)")
            .with(P_MDY, "Month/day/year (7/5/2026)")
            .with(P_YMD, "Year/month/day (2026/7/5)"),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_vault_that_declares_nothing_reads_like_yesterday() {
        assert_eq!(date_formats(None), DateFormats::ISO);
        assert_eq!(date_formats(Some(ONLY_ISO)), DateFormats::ISO);
        // Una parola che nessuno sa leggere non rende il vault illeggibile.
        assert_eq!(date_formats(Some("giorno-mese-anno")), DateFormats::ISO);
        assert_eq!(
            date_formats(Some("dmy")),
            DateFormats::declaring(DateOrder::Dmy)
        );
    }

    /// Ogni opzione della tendina è un ordine che il parser sa applicare: la
    /// tabella è **una**, e le due metà non possono divergere.
    #[test]
    fn every_choice_in_the_menu_is_an_order_the_parser_knows() {
        let SettingKind::Choice { options, default } = &properties_settings()[0].kind else {
            panic!("the date format is a choice");
        };
        assert_eq!(default, ONLY_ISO);
        let decl: Vec<&str> = options
            .iter()
            .map(|or| or.value.as_str())
            .filter(|v| *v != ONLY_ISO)
            .collect();
        assert_eq!(decl.len(), DateOrder::ALL.len());
        for v in decl {
            assert!(
                DateOrder::from_key(v).is_some(),
                "«{v}» is in the menu and the parser does not know how to read it"
            );
        }
    }

    /// Il formato viaggia col vault e nessun programma lo cambia: dichiararlo
    /// cambia il valore di ogni proprietà data di ogni nota, senza toccare un
    /// file.
    #[test]
    fn the_format_travels_with_the_vault_and_no_program_writes_it() {
        for spec in properties_settings() {
            assert_eq!(spec.scope, fub_abi::settings::SettingScope::Vault);
            assert!(!spec.program_writable, "{} is writable", spec.key);
        }
    }
}
