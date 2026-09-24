//! Come **questo vault** interpreta le proprietà del frontmatter (§8.2).
//!
//! Il formato delle date resta una dichiarazione separata: la
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

use fub_abi::model::{DateFormats, DateOrder, PropertyTypes};
use fub_abi::settings::{SettingKind, SettingSpec};
use fub_abi::text::{StringCatalog, Text};
use fub_abi::ui::UiOption;

/// L'ordine dei campi delle date non-ISO di questo vault. Vuoto = solo ISO.
pub const DATE_FORMAT: &str = "properties.date-format";

/// La dichiarazione dei tipi delle proprietà di questo vault.
pub const TYPES: &str = "properties.types";
/// Schema iniziale senza dichiarazioni esplicite; le chiavi convenzionali
/// continuano a essere interpretate da `PropertyTypes::resolve`.
pub const DEFAULT_TYPES: &str = r#"{"version":1,"types":{}}"#;

/// Il valore che vuol dire **«solo ISO-8601»**, cioè nessuna dichiarazione.
///
/// È la stringa vuota per la ragione di [`AS_SYSTEM`](crate::locale::AS_SYSTEM):
/// è ciò che si ottiene *non scegliendo*, quindi è anche il default naturale
/// dello schema e le due cose non possono divergere.
pub const ONLY_ISO: &str = "";

/// Le impostazioni che il core dichiara per le proprietà.
///
/// Di livello **vault** e non di macchina: queste dichiarazioni descrivono i
/// file che stanno *in questo vault*. Metterle sulla macchina vorrebbe dire che
/// lo stesso vault, aperto su due computer, ha due significati.
///
/// La dichiarazione dei tipi, a differenza del formato delle date, è anche
/// scrivibile dal programma: l'editor delle proprietà aggiorna questo stesso
/// valore tramite il normale store delle impostazioni.
pub fn properties_settings() -> Vec<SettingSpec> {
    vec![
        SettingSpec::new(
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
        .grouped(Text::key(P_GROUP)),
        SettingSpec::new(
            TYPES,
            Text::key(P_TYPES),
            SettingKind::Text {
                default: DEFAULT_TYPES.into(),
            },
        )
        .describing(Text::key(P_TYPES_DESC))
        .grouped(Text::key(P_GROUP))
        .program_writable(),
    ]
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

/// La dichiarazione valida dei tipi, o l'interpretazione convenzionale quando
/// manca, è vuota o usa uno schema che questo kernel non sa leggere.
pub fn property_types(declared: Option<&str>) -> PropertyTypes {
    declared
        .filter(|value| !value.trim().is_empty())
        .and_then(|value| serde_json::from_str(value).ok())
        .unwrap_or_default()
}

const P_GROUP: &str = "properties.group";
const P_TYPES: &str = "properties.types";
const P_TYPES_DESC: &str = "properties.types.desc";
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
            .with(P_TYPES, "Tipi delle proprietà")
            .with(
                P_TYPES_DESC,
                "Dichiarazioni dei tipi per questo vault in JSON versionato. \
                 Senza dichiarazioni le proprietà conservano il loro valore \
                 originale e le chiavi convenzionali mantengono il loro significato.",
            )
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
            .with(P_TYPES, "Property types")
            .with(
                P_TYPES_DESC,
                "Versioned JSON declarations of property types for this vault. \
                 Without declarations properties keep their original values, \
                 and conventional keys retain their meaning.",
            )
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

    /// Il formato delle date resta dell'utente; la dichiarazione dei tipi è
    /// aggiornabile dall'editor attraverso il normale store del vault.
    #[test]
    fn property_settings_have_their_respective_write_permissions() {
        let specs = properties_settings();
        assert!(specs
            .iter()
            .all(|spec| spec.scope == fub_abi::settings::SettingScope::Vault));
        assert!(!specs[0].program_writable);
        assert_eq!(specs[1].key, TYPES);
        assert!(specs[1].program_writable);
        assert_eq!(
            specs[1].kind,
            SettingKind::Text {
                default: DEFAULT_TYPES.into(),
            }
        );
        assert_eq!(
            property_types(Some(DEFAULT_TYPES)),
            PropertyTypes::default()
        );
        assert_eq!(
            serde_json::to_string(&PropertyTypes::default()).unwrap(),
            DEFAULT_TYPES
        );
    }

    #[test]
    fn types_declaration_falls_back_only_for_invalid_or_unsupported_schema() {
        use fub_abi::model::PropertyType;
        for invalid in [
            None,
            Some(""),
            Some("  "),
            Some("{"),
            Some(r#"{"version":2,"types":{"rating":"number"}}"#),
        ] {
            assert_eq!(property_types(invalid), PropertyTypes::default());
        }
        let declared = property_types(Some(r#"{"version":1,"types":{"rating":"number"}}"#));
        assert_eq!(declared.resolve("rating"), Some(PropertyType::Number));
    }
}
