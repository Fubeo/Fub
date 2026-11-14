//! I colori che una scheda o un arco prendono nella forma breve: un nome della
//! tavola qui sotto, il numero del file (`"1"`…`"6"`), o `#rrggbb`.
//!
//! È la sola copia della tavola: `add_card`, `connect`, la lettura in forma
//! `code` (`describe`) e il controllo della forma (`spec`) la usano tutti. Un
//! colore che [`parse`] non legge è un errore di lettura, e non si scrive.

use std::borrow::Cow;

use serde::{de, Deserialize, Deserializer};
use serde_json::{Map, Value};

use super::{refuse, OpError};
use crate::model::{CanvasColor, PresetColor};

/// Il motivo di un colore che la tavola non legge, come lo dà ogni operazione
/// che lo scrive (`add_card`, `connect`, `color`, `set`).
pub(crate) const NOT_A_COLOR: &str = "the color is not a name, a number or #rrggbb";

/// Un colore della tavola: un preset di JSON Canvas, o un esadecimale fisso.
#[derive(Clone, Copy)]
enum Named {
    Preset(PresetColor),
    Hex(&'static str),
}

/// I nomi, col colore che scrivono nel file. Le schede e gli archi usano la
/// stessa tavola; i nomi `note-*` sono i nove colori delle note di N6.
const TABLE: &[(&str, Named)] = &[
    ("red", Named::Preset(PresetColor::Red)),
    ("orange", Named::Preset(PresetColor::Orange)),
    ("yellow", Named::Preset(PresetColor::Yellow)),
    ("green", Named::Preset(PresetColor::Green)),
    ("cyan", Named::Preset(PresetColor::Cyan)),
    ("purple", Named::Preset(PresetColor::Purple)),
    ("note-grey", Named::Hex("#5e626b")),
    ("note-brown", Named::Hex("#84573e")),
    ("note-orange", Named::Hex("#984b00")),
    ("note-yellow", Named::Hex("#795f00")),
    ("note-green", Named::Hex("#007231")),
    ("note-blue", Named::Hex("#0064b0")),
    ("note-purple", Named::Hex("#7847a6")),
    ("note-pink", Named::Hex("#9e366f")),
    ("note-red", Named::Hex("#b7191c")),
];

/// I nomi della tavola, per il suggerimento di un nome sbagliato.
pub(crate) fn names() -> impl Iterator<Item = &'static str> {
    TABLE.iter().map(|(name, _)| *name)
}

/// Il colore che un testo della forma breve vuol dire, o `None` se non si
/// legge. Accetta un nome della tavola, il numero del file (`"1"`…`"6"`), o un
/// `#rrggbb` in qualunque caso (che si scrive in minuscolo).
pub fn parse(text: &str) -> Option<CanvasColor> {
    if let Some((_, named)) = TABLE.iter().find(|(name, _)| *name == text) {
        return Some(match *named {
            Named::Preset(preset) => CanvasColor::Preset(preset),
            Named::Hex(hex) => CanvasColor::Hex(hex.to_owned()),
        });
    }
    let preset = match text {
        "1" => PresetColor::Red,
        "2" => PresetColor::Orange,
        "3" => PresetColor::Yellow,
        "4" => PresetColor::Green,
        "5" => PresetColor::Cyan,
        "6" => PresetColor::Purple,
        _ => return parse_hex(text),
    };
    Some(CanvasColor::Preset(preset))
}

/// `#rrggbb` in qualunque caso, come minuscolo.
fn parse_hex(text: &str) -> Option<CanvasColor> {
    let digits = text.strip_prefix('#')?;
    let well_formed = digits.len() == 6 && digits.bytes().all(|byte| byte.is_ascii_hexdigit());
    well_formed.then(|| CanvasColor::Hex(format!("#{}", digits.to_ascii_lowercase())))
}

/// Il testo con cui la forma breve scrive questo colore, se ce n'è uno che
/// [`parse`] riporta uguale: il nome del preset, o l'esadecimale se è già in
/// minuscolo. Un colore senza testo così (un `#abc`) si scrive nella forma
/// intera.
pub fn written(color: &CanvasColor) -> Option<String> {
    match color {
        CanvasColor::Preset(preset) => Some(preset_name(*preset).to_owned()),
        CanvasColor::Hex(hex) => match parse(hex) {
            Some(CanvasColor::Hex(canonical)) if canonical == *hex => Some(hex.clone()),
            _ => None,
        },
    }
}

fn preset_name(preset: PresetColor) -> &'static str {
    match preset {
        PresetColor::Red => "red",
        PresetColor::Orange => "orange",
        PresetColor::Yellow => "yellow",
        PresetColor::Green => "green",
        PresetColor::Cyan => "cyan",
        PresetColor::Purple => "purple",
    }
}

/// Il valore che il file scrive per un colore della tavola: `"1"`…`"6"`, o
/// `#rrggbb` in minuscolo. Un nome (`"cyan"`) diventa il suo valore (`"5"`).
pub(crate) fn file_value(text: &str) -> Option<String> {
    parse(text).map(|color| match color {
        CanvasColor::Preset(preset) => preset_number(preset).to_owned(),
        CanvasColor::Hex(hex) => hex,
    })
}

fn preset_number(preset: PresetColor) -> &'static str {
    match preset {
        PresetColor::Red => "1",
        PresetColor::Orange => "2",
        PresetColor::Yellow => "3",
        PresetColor::Green => "4",
        PresetColor::Cyan => "5",
        PresetColor::Purple => "6",
    }
}

/// I campi di un `set` con il colore scritto come il file lo vuole: un nome, un
/// numero o `#rrggbb` diventano il loro valore di JSON Canvas. Gli altri campi
/// non cambiano; un colore che la tavola non legge è `Invalid`; `null`, che toglie
/// il colore, passa com'è.
pub(crate) fn canonical_fields<'a>(
    index: usize,
    fields: &'a Map<String, Value>,
) -> Result<Cow<'a, Map<String, Value>>, OpError> {
    let Some(Value::String(text)) = fields.get("color") else {
        return Ok(Cow::Borrowed(fields));
    };
    let value = file_value(text).ok_or_else(|| refuse(index, NOT_A_COLOR))?;
    let mut canonical = fields.clone();
    canonical.insert("color".to_owned(), Value::String(value));
    Ok(Cow::Owned(canonical))
}

/// Il colore di una scheda o di un arco come testo: un colore che [`parse`]
/// legge, o `null`, che vuol dire nessun colore. Un altro testo non si legge.
pub(crate) fn deserialize<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    match Option::<String>::deserialize(deserializer)? {
        Some(text) if parse(&text).is_none() => {
            Err(de::Error::custom(format_args!("unknown color {text:?}")))
        }
        text => Ok(text),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn i_nomi_e_i_numeri_danno_il_colore_del_file() {
        assert_eq!(parse("red"), Some(CanvasColor::Preset(PresetColor::Red)));
        assert_eq!(parse("5"), Some(CanvasColor::Preset(PresetColor::Cyan)));
        assert_eq!(
            parse("note-grey"),
            Some(CanvasColor::Hex("#5e626b".to_owned()))
        );
    }

    #[test]
    fn un_esadecimale_si_legge_in_qualunque_caso_e_si_scrive_in_minuscolo() {
        assert_eq!(
            parse("#FF8800"),
            Some(CanvasColor::Hex("#ff8800".to_owned()))
        );
        assert_eq!(parse("#abc"), None);
        assert_eq!(parse("#ff88000"), None);
        assert_eq!(parse("ff8800"), None);
    }

    #[test]
    fn un_nome_sconosciuto_o_maiuscolo_non_si_legge() {
        assert_eq!(parse("gren"), None);
        assert_eq!(parse("Red"), None);
        assert_eq!(parse("7"), None);
        assert_eq!(parse(""), None);
    }

    #[test]
    fn il_colore_si_scrive_col_nome_se_c_e_un_nome_che_torna() {
        assert_eq!(
            written(&CanvasColor::Preset(PresetColor::Purple)),
            Some("purple".to_owned())
        );
        assert_eq!(
            written(&CanvasColor::Hex("#ff8800".to_owned())),
            Some("#ff8800".to_owned())
        );
        assert_eq!(written(&CanvasColor::Hex("#FF8800".to_owned())), None);
        assert_eq!(written(&CanvasColor::Hex("#abc".to_owned())), None);
    }
}
