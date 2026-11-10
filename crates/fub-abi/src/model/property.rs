//! Le proprietà del frontmatter: tipi dichiarati, valori, date e ore, e i
//! formati di data.

use super::*;

/// The vault's declared interpretation of a frontmatter key. The JSON source
/// remains authoritative even when its value cannot be interpreted as this type.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PropertyType {
    Text,
    List,
    Number,
    Checkbox,
    Date,
    DateTime,
    Tags,
}

/// Versioned, per-vault property declarations. Unrecognized schema versions
/// cannot be silently interpreted as the current schema.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct PropertyTypes {
    pub version: u32,
    pub types: std::collections::BTreeMap<String, PropertyType>,
}

impl Default for PropertyTypes {
    fn default() -> Self {
        Self {
            version: Self::VERSION,
            types: Default::default(),
        }
    }
}

impl<'de> Deserialize<'de> for PropertyTypes {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Wire {
            version: u32,
            types: std::collections::BTreeMap<String, PropertyType>,
        }
        let wire = Wire::deserialize(deserializer)?;
        if wire.version != PropertyTypes::VERSION {
            return Err(serde::de::Error::custom(
                "unsupported property types version",
            ));
        }
        Ok(Self {
            version: wire.version,
            types: wire.types,
        })
    }
}

impl PropertyTypes {
    pub const VERSION: u32 = 1;

    /// Explicit declarations win over conventional frontmatter field names.
    pub fn resolve(&self, key: &str) -> Option<PropertyType> {
        self.types.get(key).copied().or(match key {
            "tags" => Some(PropertyType::Tags),
            "aliases" | "alias" | "cssclasses" | "cssclass" => Some(PropertyType::List),
            _ => None,
        })
    }
}

/// Il valore di una proprietà del frontmatter, **normalizzato**.
///
/// Il frontmatter grezzo è JSON piatto, e va benissimo per attraversare il
/// confine; non va bene come *risposta* alla domanda che tutti gli consumatori
/// fanno. 8.2 chiede proprietà tipizzate (data, rating, relazione, formula),
/// 10.2 chiede scadenze, 10.4 un calendario: senza una forma normalizzata nel
/// contratto, ognuno di loro reinventa il parsing delle date — e due plugin
/// danno due risposte diverse sullo stesso file.
///
/// Cosa **non** fa: non indovina. Un URL scritto in una proprietà resta
/// [`PropertyValue::Text`], perché distinguerlo da una stringa che *sembra* un
/// URL è una scelta di prodotto (8.2 ha "proprietà URL" *e* "proprietà testo")
/// e `Text` non perde niente. La sola stringa che cambia specie è il wikilink,
/// `[[Nota]]`, perché quella è la relazione di 8.2 ed è l'unica forma che nel
/// vocabolario di questo modello ha già un significato non ambiguo.
/// **Perché l'elenco porta uno `PropertyScalar` e non un `PropertyValue`**: il
/// confine non ammette tipi ricorsivi (è la stessa ragione per cui gli alberi
/// del documento ci attraversano come arena, vedi [`crate::arena`]), e per una
/// lista di proprietà l'arena sarebbe una macchina sproporzionata al problema.
/// La lista di liste — che nel frontmatter di una nota non si scrive — cade in
/// [`PropertyScalar::Unknown`], che è JSON e quindi non perde niente.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
// Tag adiacente: alcune varianti portano uno scalare, e col tag interno
// `serde_json` fallirebbe a serializzarle (vedi il § in testa al modulo).
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum PropertyValue {
    /// `chiave:` senza valore (YAML `null`). Diverso da chiave assente.
    Empty,
    Text(String),
    Number(f64),
    Bool(bool),
    /// Data ISO-8601, con o senza orario.
    Date(PropertyDate),
    /// Una relazione: `autore: "[[Mario Rossi]]"`.
    Link(LinkTarget),
    List(Vec<PropertyScalar>),
    /// Ciò che non si normalizza (oggetti annidati): il JSON com'è. L'escape
    /// hatch delle proprietà, gemello di `Block::Custom`.
    Unknown(serde_json::Value),
}

/// Il valore di una **voce di elenco**: [`PropertyValue`] meno la lista.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
// Tag adiacente: alcune varianti portano uno scalare, e col tag interno
// `serde_json` fallirebbe a serializzarle (vedi il § in testa al modulo).
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum PropertyScalar {
    Empty,
    Text(String),
    Number(f64),
    Bool(bool),
    Date(PropertyDate),
    Link(LinkTarget),
    Unknown(serde_json::Value),
}

/// Una data ISO-8601, già scomposta.
///
/// Scomposta e non stringa perché il primo cliente (10.4, calendario e agenda)
/// deve raggruppare per giorno e per mese, e una stringa lo costringerebbe a
/// riparsare — che è esattamente ciò che questa voce esiste per evitare. Il
/// contratto non dipende da `chrono`: qui non si fa aritmetica sulle date, si
/// dichiara *cosa c'era scritto*.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PropertyDate {
    pub year: i32,
    pub month: u8,
    pub day: u8,
    pub time: Option<PropertyTime>,
}

/// L'ordine dei campi in una data che **non** è ISO-8601: ciò che un vault può
/// dichiarare di sé.
///
/// Tre ordini e non un formato con dei segnaposto (`%d/%m/%Y`) perché il
/// separatore non è mai stato l'ambiguità: `05/07/2026` e `05-07-2026` sono la
/// stessa scrittura, mentre `05/07/2026` e `07/05/2026` sono la **stessa
/// stringa** letta da due parti del mondo come due giorni diversi. È
/// esattamente questo che nessun parser può dedurre e che solo chi possiede il
/// vault può dire.
///
/// Serializzabile e in `snake_case` non per attraversare il contratto — non lo
/// attraversa — ma perché la parola con cui il vault lo dichiara *è* il suo
/// nome in minuscolo, e le due forme devono restare la stessa: che
/// [`as_key`](DateOrder::as_key) e serde dicano `dmy` tutte e due lo prova
/// `the_word_of_the_setting_is_the_word_of_the_wire`.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DateOrder {
    /// `05/07/2026`, `5-7-2026`: giorno, mese, anno.
    Dmy,
    /// `07/05/2026`: mese, giorno, anno.
    Mdy,
    /// `2026/07/05`, `2026-7-5`: anno, mese, giorno.
    Ymd,
}

impl DateOrder {
    /// Tutti gli ordini, in ordine di dichiarazione.
    pub const ALL: [DateOrder; 3] = [DateOrder::Dmy, DateOrder::Mdy, DateOrder::Ymd];

    /// La parola con cui il vault lo dichiara.
    ///
    /// Sta qui e non accanto all'impostazione che la scrive: la stringa che
    /// l'utente sceglie e l'ordine che il parser applica sono **una tabella
    /// sola**, e due copie sarebbero due tendine che promettono cose diverse.
    pub fn as_key(self) -> &'static str {
        match self {
            DateOrder::Dmy => "dmy",
            DateOrder::Mdy => "mdy",
            DateOrder::Ymd => "ymd",
        }
    }

    /// L'ordine che quella parola nomina, o `None` se non ne nomina nessuno.
    pub fn from_key(s: &str) -> Option<DateOrder> {
        DateOrder::ALL.into_iter().find(|or| or.as_key() == s)
    }

    /// Legge `s` in quest'ordine, o `None`.
    ///
    /// Rigido quanto [`parse_iso_date`], su un insieme diverso: tre campi
    /// numerici separati dallo **stesso** segno fra `/`, `-` e `.`, l'anno a
    /// quattro cifre, mese e giorno a una o due. Le due cifre dell'anno non si
    /// accettano — `05/07/26` chiederebbe di indovinare il secolo, e indovinare
    /// è la cosa che la 0003 ha rifiutato.
    fn read(self, s: &str) -> Option<PropertyDate> {
        let sep = s.chars().find(|c| matches!(c, '/' | '-' | '.'))?;
        let mut parts = s.split(sep);
        let (a, b, c) = (parts.next()?, parts.next()?, parts.next()?);
        if parts.next().is_some() {
            return None;
        }
        let (year, month, day) = match self {
            DateOrder::Dmy => (c, b, a),
            DateOrder::Mdy => (c, a, b),
            DateOrder::Ymd => (a, b, c),
        };
        if year.len() != 4 {
            return None;
        }
        let year = i32::try_from(digits(year, 4)?).ok()?;
        let month = u8::try_from(digits(month, 2)?).ok()?;
        let day = u8::try_from(digits(day, 2)?).ok()?;
        if !valid_civil_date(year, month, day) {
            return None;
        }
        Some(PropertyDate {
            year,
            month,
            day,
            time: None,
        })
    }
}

/// I formati di data che **questo vault dichiara**, oltre all'ISO-8601.
///
/// La [decisione 0003](../../../docs/decisions/0181-modello-documento-e-arene.md)
/// ha rifiutato il parser tollerante con l'argomento giusto — *un parser
/// tollerante trasformerebbe in date le stringhe dell'utente* — e quell'argomento
/// resta intero. Ciò che cambia non è la **tolleranza**: è **chi dichiara il
/// formato**. Un formato dichiarato non è un indovinello, ed è la differenza
/// esatta fra questo tipo e la cosa che la 0003 ha rifiutato.
///
/// Il default è [`DateFormats::ISO`], cioè nessuna dichiarazione e la regola di
/// prima parola per parola: un vault che non dice niente si legge oggi come si
/// leggeva ieri.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct DateFormats {
    declared: Option<DateOrder>,
}

impl DateFormats {
    /// Nessuna dichiarazione: **solo** l'ISO-8601.
    pub const ISO: DateFormats = DateFormats { declared: None };

    /// I formati di un vault che ne dichiara uno.
    pub fn declaring(order: DateOrder) -> DateFormats {
        DateFormats {
            declared: Some(order),
        }
    }

    /// L'ordine dichiarato, se c'è.
    pub fn declared(&self) -> Option<DateOrder> {
        self.declared
    }

    /// Legge `s` coi soli formati dichiarati. Senza dichiarazione non legge
    /// niente, ed è il punto.
    fn read(&self, s: &str) -> Option<PropertyDate> {
        self.declared.and_then(|or| or.read(s))
    }

    /// `s` **sembra** una data a qualcuno?
    ///
    /// È il rilevatore del controllo di salute, e non è una seconda regola: è
    /// lo **stesso** parser con tutti gli ordini insieme. Ciò che due
    /// dichiarazioni diverse leggerebbero in due modi è esattamente ciò su cui
    /// vale la pena chiedere all'utente — e siccome la risposta è una domanda e
    /// non un valore, qui la larghezza è legittima dove nel parser non lo era.
    pub fn looks_like_a_date(s: &str) -> bool {
        let t = s.trim();
        DateOrder::ALL.iter().any(|or| or.read(t).is_some())
    }
}

/// L'orario di una [`PropertyDate`], col fuso **come era scritto**.
///
/// `offset_minutes` è `None` per un orario locale-senza-fuso: convertirlo
/// richiederebbe sapere il fuso dell'utente, che è una capacità dell'host
/// (decisione 0013) e non un fatto del documento. Il modello non indovina.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PropertyTime {
    pub hour: u8,
    pub minute: u8,
    pub second: u8,
    /// Minuti rispetto a UTC (`Z` → `0`, `+02:00` → `120`).
    pub offset_minutes: Option<i16>,
}

impl PropertyValue {
    /// Normalizza un valore JSON del frontmatter, coi formati di data che il
    /// vault dichiara ([`DateFormats`]). Il tipo si deduce dal valore: è la
    /// strada delle chiavi non dichiarate, che resta per i consumatori esistenti.
    pub fn normalize(v: &serde_json::Value, formats: &DateFormats) -> PropertyValue {
        Self::normalize_as(v, formats, None)
    }

    /// A declaration changes interpretation, never the underlying JSON.
    pub fn normalize_as(
        v: &serde_json::Value,
        formats: &DateFormats,
        kind: Option<PropertyType>,
    ) -> PropertyValue {
        use serde_json::Value as J;
        use PropertyType as T;
        if v.is_null() {
            return PropertyValue::Empty;
        }
        match kind {
            None => match v {
                J::Array(items) => PropertyValue::List(
                    items
                        .iter()
                        .map(|item| PropertyScalar::normalize(item, formats))
                        .collect(),
                ),
                scalar => PropertyScalar::normalize(scalar, formats).into(),
            },
            Some(T::Text) => match v {
                J::String(s) => PropertyValue::Text(s.clone()),
                _ => PropertyValue::Unknown(v.clone()),
            },
            Some(T::Number) => match v {
                J::Number(n) => n
                    .as_f64()
                    .filter(|n| n.is_finite())
                    .map(PropertyValue::Number)
                    .unwrap_or_else(|| PropertyValue::Unknown(v.clone())),
                J::String(s) => s
                    .trim()
                    .parse::<f64>()
                    .ok()
                    .filter(|n| n.is_finite())
                    .map(PropertyValue::Number)
                    .unwrap_or_else(|| PropertyValue::Unknown(v.clone())),
                _ => PropertyValue::Unknown(v.clone()),
            },
            Some(T::Checkbox) => match v {
                J::Bool(b) => PropertyValue::Bool(*b),
                J::String(s) => match s.as_str() {
                    "true" => PropertyValue::Bool(true),
                    "false" => PropertyValue::Bool(false),
                    _ => PropertyValue::Unknown(v.clone()),
                },
                _ => PropertyValue::Unknown(v.clone()),
            },
            Some(T::Date | T::DateTime) => match v {
                J::String(s) => {
                    let date = parse_iso_date(s.trim()).or_else(|| formats.read(s.trim()));
                    match date {
                        Some(date) if date.time.is_some() == (kind == Some(T::DateTime)) => {
                            PropertyValue::Date(date)
                        }
                        _ => PropertyValue::Unknown(v.clone()),
                    }
                }
                _ => PropertyValue::Unknown(v.clone()),
            },
            Some(T::List) => match v {
                J::Array(items) => PropertyValue::List(
                    items
                        .iter()
                        .map(|item| PropertyScalar::normalize(item, formats))
                        .collect(),
                ),
                J::String(s) => PropertyValue::List(vec![PropertyScalar::Text(s.clone())]),
                _ => PropertyValue::Unknown(v.clone()),
            },
            Some(T::Tags) => match v {
                J::Array(items) => PropertyValue::List(
                    items
                        .iter()
                        .map(|item| match item {
                            J::String(s) => PropertyScalar::Text(s.clone()),
                            _ => PropertyScalar::Unknown(item.clone()),
                        })
                        .collect(),
                ),
                J::String(s) => PropertyValue::List(vec![PropertyScalar::Text(s.clone())]),
                _ => PropertyValue::Unknown(v.clone()),
            },
        }
    }
}

impl PropertyScalar {
    /// Normalizza un valore JSON che **non** può essere una lista: una lista
    /// annidata resta JSON.
    pub fn normalize(v: &serde_json::Value, formats: &DateFormats) -> PropertyScalar {
        match v {
            serde_json::Value::Null => PropertyScalar::Empty,
            serde_json::Value::Bool(b) => PropertyScalar::Bool(*b),
            serde_json::Value::Number(n) => match n.as_f64() {
                Some(f) => PropertyScalar::Number(f),
                // Un intero più grande di quanto un f64 rappresenti senza
                // perdite non è un numero da fare i conti: è un'identità.
                None => PropertyScalar::Text(n.to_string()),
            },
            serde_json::Value::String(s) => PropertyScalar::from_text(s, formats),
            serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
                PropertyScalar::Unknown(v.clone())
            }
        }
    }

    /// La normalizzazione di una stringa: wikilink, poi data ISO, poi il
    /// formato che il vault **dichiara**, poi testo.
    ///
    /// L'ordine non è un dettaglio: l'ISO-8601 si legge sempre e per primo,
    /// quindi una dichiarazione non può cambiare come si legge una data già
    /// scritta bene. Ciò che una dichiarazione fa è **aggiungere** una lettura
    /// a stringhe che oggi restano [`PropertyScalar::Text`].
    fn from_text(s: &str, formats: &DateFormats) -> PropertyScalar {
        let t = s.trim();
        if let Some(inner) = t.strip_prefix("[[").and_then(|r| r.strip_suffix("]]")) {
            return PropertyScalar::Link(parse_wikilink_inner(inner).target);
        }
        if let Some(d) = parse_iso_date(t).or_else(|| formats.read(t)) {
            return PropertyScalar::Date(d);
        }
        PropertyScalar::Text(s.to_string())
    }
}

impl From<PropertyScalar> for PropertyValue {
    fn from(s: PropertyScalar) -> Self {
        match s {
            PropertyScalar::Empty => PropertyValue::Empty,
            PropertyScalar::Text(t) => PropertyValue::Text(t),
            PropertyScalar::Number(n) => PropertyValue::Number(n),
            PropertyScalar::Bool(b) => PropertyValue::Bool(b),
            PropertyScalar::Date(d) => PropertyValue::Date(d),
            PropertyScalar::Link(the) => PropertyValue::Link(the),
            PropertyScalar::Unknown(v) => PropertyValue::Unknown(v),
        }
    }
}

/// `2026-07-25`, `2026-07-25T10:30`, `2026-07-25 10:30:00Z`, `…+02:00`.
///
/// Rigido di proposito: solo l'ISO-8601 nella forma che YAML e Obsidian
/// producono. Un parser tollerante qui direbbe di sì a `1-2-3` e trasformerebbe
/// in date delle stringhe che l'utente non intendeva tali.
fn parse_iso_date(s: &str) -> Option<PropertyDate> {
    let (date, rest) = s.split_at_checked(10)?;
    let mut parts = date.split('-');
    let year = parts.next()?;
    if year.len() != 4 {
        return None;
    }
    let year = digits(year, 4)? as i32;
    let month: u8 = fixed_width(parts.next()?, 2)?;
    let day: u8 = fixed_width(parts.next()?, 2)?;
    if parts.next().is_some() || !valid_civil_date(year, month, day) {
        return None;
    }
    let time = match rest {
        "" => None,
        _ => Some(parse_iso_time(rest.strip_prefix(['T', 't', ' '])?)?),
    };
    Some(PropertyDate {
        year,
        month,
        day,
        time,
    })
}

/// Validità gregoriana condivisa da date ISO, ordini dichiarati e workflow
/// che usano la data come parte di un path.
pub fn valid_civil_date(year: i32, month: u8, day: u8) -> bool {
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1..=days).contains(&day)
}

fn parse_iso_time(s: &str) -> Option<PropertyTime> {
    let (hms, zone) = match s.find(['Z', 'z', '+']) {
        Some(the) => s.split_at(the),
        // Il `-` del fuso si distingue dal nulla solo per posizione: prima ci
        // sono almeno `hh:mm`.
        None => match s.get(5..).and_then(|rest| rest.find('-')) {
            Some(the) => s.split_at(the + 5),
            None => (s, ""),
        },
    };
    let mut parts = hms.split(':');
    let hour: u8 = fixed_width(parts.next()?, 2)?;
    let minute: u8 = fixed_width(parts.next()?, 2)?;
    let second: u8 = match parts.next() {
        // I secondi frazionari si troncano: il modello dichiara cosa c'era
        // scritto, non pretende di essere un istante.
        Some(sec) => fixed_width(sec.split('.').next()?, 2)?,
        None => 0,
    };
    if parts.next().is_some() || hour > 23 || minute > 59 || second > 60 {
        return None;
    }
    let offset_minutes = match zone {
        "" => None,
        "Z" | "z" => Some(0),
        z => {
            let sign: i16 = if z.starts_with('-') { -1 } else { 1 };
            let (h, m) = z[1..].split_once(':').unwrap_or((&z[1..], "0"));
            let h: i16 = h.parse().ok()?;
            let m: i16 = m.parse().ok()?;
            if h > 23 || m > 59 {
                return None;
            }
            Some(sign * (h * 60 + m))
        }
    };
    Some(PropertyTime {
        hour,
        minute,
        second,
        offset_minutes,
    })
}

/// Un campo numerico a larghezza fissa (`07`), che è ciò che distingue una data
/// ISO da un'espressione: `2026-7-5` non è una data ISO.
fn fixed_width(s: &str, width: usize) -> Option<u8> {
    if s.len() != width || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok()
}

/// Un campo numerico di una data **dichiarata**: da una a `max` cifre ASCII.
///
/// Il gemello largo di [`fixed_width`], e la larghezza è il punto: `2026-7-5`
/// non è una data ISO e resta tale, ma un vault che dichiara `ymd` sta dicendo
/// che quella è la sua scrittura del cinque luglio.
fn digits(s: &str, max: usize) -> Option<u32> {
    if s.is_empty() || s.len() > max || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok()
}
