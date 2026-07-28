//! Il **testo che si legge**: una stringa, o una chiave con i suoi argomenti.
//!
//! È la risposta al §12.1 — *chi localizza*. Prima di questo modulo un
//! `ViewProvider` restituiva `UiNode::text("Nessun backlink")`: prosa italiana
//! cablata dentro il provider, e quindi non traducibile da nessuno.
//!
//! # Perché non è né `String` né una chiave
//!
//! Le due risposte ovvie sono entrambe sbagliate, e per ragioni simmetriche.
//!
//! **Il provider traduce.** Vorrebbe dire che ogni componente si imbarca un
//! runtime i18n, il proprio catalogo e il proprio ladder di ripiego; che
//! `render_view` — che è puro, sincrono e richiamabile in qualunque momento —
//! diventa dipendente da uno stato che va invalidato a ogni cambio di locale; e
//! che la qualità della traduzione di FubMD è la peggiore fra quelle dei plugin
//! installati. Soprattutto: un messaggio già composto **non si traduce**. Chi lo
//! riceve ha una stringa e non sa più da cosa venisse.
//!
//! **Tutto è una chiave.** Vorrebbe dire che il nome di un tag, il titolo di una
//! nota e il path di un file — cioè la maggioranza schiacciante di ciò che
//! attraversa il confine verso uno schermo — devono passare da un catalogo che
//! non li contiene, o da una convenzione di fuga che qualcuno prima o poi
//! dimentica. Un `DocId` non si traduce.
//!
//! Quindi il tipo non è nessuno dei due: è un tipo che **porta la propria
//! provenienza**. [`Text::Literal`] è un dato, e viaggia com'è; [`Text::Message`]
//! è una chiave con i suoi argomenti, e viene risolta all'**ultimo momento**.
//!
//! # Chi risolve, e dove
//!
//! Il **kernel**, sulla via d'uscita dal contratto. Non la shell: la shell è uno
//! dei tre host previsti (l'app, la CLI di 27.1, l'API locale di 27.2) e tutti e
//! tre hanno lo stesso bisogno; il kernel è l'unico posto che ognuno attraversa.
//!
//! La conseguenza pratica è una riga che vale la pena dire: **`Text` è un tipo
//! di contratto (provider ↔ kernel), non un tipo di IPC (kernel ↔ shell).** Dopo
//! la risoluzione ogni `Text` è un `Literal`, e con `#[serde(untagged)]` un
//! `Literal` serializza come stringa nuda — quindi il mirror TypeScript resta
//! `string` e la shell non ha imparato niente di nuovo. È presidiato:
//! `crates/fubmd-kernel/tests/le_stringhe.rs`.
//!
//! # Il degrado garbato
//!
//! [`Text::Literal`] è il **default** (`impl From<&str>`, `From<String>`): chi si
//! dimentica della localizzazione continua a scrivere `UiNode::text("Nessun
//! backlink")` e ottiene la stringa in chiaro. È la regola di
//! [`Trust::default`](crate::traits::Trust) applicata alle stringhe — ciò che si
//! ottiene dimenticandosi non può essere *più* di ciò che si ottiene dichiarando
//! — e vale anche in senso opposto: un provider che dichiara e non ha catalogo
//! non rompe niente, perché l'ultimo gradino della scala è la chiave nuda.
//!
//! # Il ladder, e il suo ultimo gradino
//!
//! Con [`Strings`], la ricerca di una traduzione scende di specificità:
//!
//! 1. il catalogo della lingua esatta di chi guarda (`it-IT`);
//! 2. il catalogo della sua lingua senza regione (`it`, via
//!    [`Locale::language_base`]);
//! 3. il catalogo della lingua di ripiego dichiarata dal componente;
//! 4. **la chiave nuda**.
//!
//! Il quarto gradino è deliberato: brutto ma onesto e *cercabile*. Un ripiego che
//! inventasse una prosa plausibile renderebbe una chiave mancante indistinguibile
//! da una traduzione fatta male.
//!
//! # Il linguaggio del template, e ciò che non è ancora
//!
//! A M2 il template ha **una** costruzione: la sostituzione `{nome}`, con `{{` e
//! `}}` per le graffe letterali. Non c'è selezione per plurale né per genere.
//!
//! La cosa importante è *dove* cresceranno: **dentro il linguaggio del template**,
//! che è dato di catalogo, e non nel tipo. `Message` porta già argomenti
//! tipizzati; il giorno che un catalogo scriverà `{n, plural, one{...} other{...}}`
//! il tipo congelato a M4 non avrà bisogno di cambiare. È la ragione per cui gli
//! argomenti sono un [`ArgValue`] e non una `String` già formattata: un provider
//! che passasse `"3"` avrebbe già buttato via l'informazione con cui si sceglie
//! la forma plurale, e formattare un numero o una data è comunque lavoro di chi
//! conosce il locale — non di chi conosce il dato.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::locale::Locale;

// ---------------------------------------------------------------------------
// Il tipo
// ---------------------------------------------------------------------------

/// Testo destinato a un umano: un dato, o una chiave da risolvere.
///
/// `untagged`, e con [`Literal`](Text::Literal) **per primo**: una stringa JSON
/// resta una stringa JSON, e un messaggio è un oggetto. Le due forme non
/// possono collidere, e l'ordine è ciò che rende gratuita la forma comune.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Text {
    /// Un dato: il nome di un tag, un path, il titolo di una nota. Viaggia
    /// com'è, ed è ciò che si ottiene da una `&str`.
    Literal(String),
    /// Una chiave del catalogo di chi l'ha scritta, con i suoi argomenti.
    Message(Message),
}

impl Default for Text {
    fn default() -> Self {
        Text::Literal(String::new())
    }
}

impl Text {
    /// Una chiave senza argomenti — la forma più comune di ciò che si traduce.
    pub fn key(key: impl Into<String>) -> Self {
        Text::Message(Message::new(key))
    }

    /// Una chiave con i suoi argomenti.
    pub fn message(key: impl Into<String>, args: Vec<Arg>) -> Self {
        Text::Message(Message {
            key: key.into(),
            args,
        })
    }

    /// Il testo, se è già un dato. `None` per un messaggio non ancora risolto:
    /// è il modo di chiedere *«questo è leggibile così com'è?»* senza inventare
    /// una risposta quando non lo è.
    pub fn as_literal(&self) -> Option<&str> {
        match self {
            Text::Literal(s) => Some(s.as_str()),
            Text::Message(_) => None,
        }
    }

    /// Il messaggio, se è una chiave.
    pub fn as_message(&self) -> Option<&Message> {
        match self {
            Text::Message(m) => Some(m),
            Text::Literal(_) => None,
        }
    }

    /// È già risolto? È l'invariante che il kernel garantisce a chi sta fuori
    /// dal contratto, e l'asserzione che i suoi test fanno.
    pub fn is_literal(&self) -> bool {
        matches!(self, Text::Literal(_))
    }

    /// Vuoto: una stringa vuota, o un messaggio con la chiave vuota. Serve dove
    /// il campo è opzionale per convenzione invece che per tipo (il `group` di
    /// una [`SettingSpec`](crate::settings::SettingSpec)).
    pub fn is_empty(&self) -> bool {
        match self {
            Text::Literal(s) => s.is_empty(),
            Text::Message(m) => m.key.is_empty(),
        }
    }
}

impl From<String> for Text {
    fn from(s: String) -> Self {
        Text::Literal(s)
    }
}

impl From<&str> for Text {
    fn from(s: &str) -> Self {
        Text::Literal(s.to_string())
    }
}

impl From<&String> for Text {
    fn from(s: &String) -> Self {
        Text::Literal(s.clone())
    }
}

impl From<Message> for Text {
    fn from(m: Message) -> Self {
        Text::Message(m)
    }
}

/// Un `Text` è uguale a una stringa quando **è già quella stringa**.
///
/// Un messaggio non risolto non è mai uguale a niente di leggibile, e questa è
/// la proprietà utile: chi confronta sta implicitamente affermando che a quel
/// punto della catena il testo è risolto, e se non lo è il confronto lo dice
/// invece di passare. Il verso inverso (`"x" == text`) c'è per lo stesso motivo
/// per cui c'è per `String`: chi asserisce non deve ricordarsi da che parte
/// scrivere.
impl PartialEq<str> for Text {
    fn eq(&self, other: &str) -> bool {
        self.as_literal() == Some(other)
    }
}

impl PartialEq<&str> for Text {
    fn eq(&self, other: &&str) -> bool {
        self.as_literal() == Some(*other)
    }
}

impl PartialEq<String> for Text {
    fn eq(&self, other: &String) -> bool {
        self.as_literal() == Some(other.as_str())
    }
}

impl PartialEq<Text> for str {
    fn eq(&self, other: &Text) -> bool {
        other.as_literal() == Some(self)
    }
}

impl PartialEq<Text> for &str {
    fn eq(&self, other: &Text) -> bool {
        other.as_literal() == Some(*self)
    }
}

impl PartialEq<Text> for String {
    fn eq(&self, other: &Text) -> bool {
        other.as_literal() == Some(self.as_str())
    }
}

/// **`Display` è per chi legge un log, non per chi legge uno schermo.**
///
/// Un `Message` qui si stampa come la sua chiave e i suoi argomenti — non come
/// una traduzione, che a questo punto della catena nessuno può produrre. È la
/// distinzione che tiene in piedi `#[error(...)]` su
/// [`PluginError`](crate::error::PluginError): la forma per il log resta
/// disponibile e non pretende di essere quella per l'utente.
impl std::fmt::Display for Text {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Text::Literal(s) => f.write_str(s),
            Text::Message(m) => write!(f, "{m}"),
        }
    }
}

/// Una chiave del catalogo, con ciò che serve a comporla.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Message {
    /// La chiave, con la regola dei nomi del §7.4: la qualifica l'host con l'id
    /// di chi l'ha scritta, esattamente come le chiavi delle impostazioni. Un
    /// plugin non nomina il catalogo di un altro.
    pub key: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<Arg>,
}

impl Message {
    pub fn new(key: impl Into<String>) -> Self {
        Message {
            key: key.into(),
            args: Vec::new(),
        }
    }

    /// Aggiunge un argomento, in stile builder.
    pub fn with(mut self, name: impl Into<String>, value: ArgValue) -> Self {
        self.args.push(Arg {
            name: name.into(),
            value,
        });
        self
    }

    pub fn arg(&self, name: &str) -> Option<&ArgValue> {
        self.args.iter().find(|a| a.name == name).map(|a| &a.value)
    }
}

impl std::fmt::Display for Message {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.key)?;
        if self.args.is_empty() {
            return Ok(());
        }
        f.write_str(" {")?;
        for (i, arg) in self.args.iter().enumerate() {
            if i > 0 {
                f.write_str(", ")?;
            }
            write!(f, "{}={}", arg.name, arg.value)?;
        }
        f.write_str("}")
    }
}

/// Un argomento di un [`Message`], col suo nome.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Arg {
    pub name: String,
    pub value: ArgValue,
}

impl Arg {
    pub fn new(name: impl Into<String>, value: ArgValue) -> Self {
        Arg {
            name: name.into(),
            value,
        }
    }

    pub fn text(name: impl Into<String>, value: impl Into<String>) -> Self {
        Arg::new(name, ArgValue::Text(value.into()))
    }

    pub fn int(name: impl Into<String>, value: i64) -> Self {
        Arg::new(name, ArgValue::Int(value))
    }

    pub fn float(name: impl Into<String>, value: f64) -> Self {
        Arg::new(name, ArgValue::Float(value))
    }

    /// Un istante in millisecondi UTC — **non** una data già scritta.
    pub fn timestamp(name: impl Into<String>, utc_millis: u64) -> Self {
        Arg::new(name, ArgValue::Timestamp(utc_millis))
    }
}

/// Il valore di un argomento: **tipizzato**, non una stringa già formattata.
///
/// È la scelta che rende il resto possibile. Un provider che passasse
/// `"28/07/2026"` avrebbe già deciso il calendario e il fuso di un utente che
/// non conosce; uno che passasse `"3"` avrebbe già buttato via ciò con cui si
/// sceglie una forma plurale. Qui il dato arriva intero e chi conosce il
/// [`Locale`] decide come si legge.
///
/// Adiacentemente taggato come [`UiValue`](crate::ui::UiValue), e per la stessa
/// ragione tecnica: un enum taggato *internamente* non sa serializzare una
/// variante il cui payload non è una mappa.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum ArgValue {
    /// Un dato testuale — un nome di tag, un path. Non si traduce: se andasse
    /// tradotto sarebbe una chiave, non un argomento.
    Text(String),
    Int(i64),
    Float(f64),
    /// Millisecondi dall'epoca UNIX, **UTC**. È l'unico argomento che a M2 si
    /// formatta davvero secondo il locale (vedi [`Locale::format_timestamp`]).
    Timestamp(u64),
}

impl ArgValue {
    /// La forma leggibile di questo valore per chi ha questo locale.
    ///
    /// `Int` e `Float` sono resi nella forma **invariante**: separatore
    /// decimale `.`, nessun raggruppamento delle migliaia. È una mancanza
    /// dichiarata e non una svista — la forma giusta vuole una tabella CLDR,
    /// che il contratto non porta — e il punto di questo tipo è proprio che
    /// quando la tabella arriverà si cambierà **questo metodo**, non i provider.
    pub fn render(&self, locale: &Locale) -> String {
        match self {
            ArgValue::Text(s) => s.clone(),
            ArgValue::Int(n) => n.to_string(),
            ArgValue::Float(x) => x.to_string(),
            ArgValue::Timestamp(ms) => locale.format_timestamp(*ms),
        }
    }
}

impl std::fmt::Display for ArgValue {
    /// Per il log: nessun locale in mano, quindi l'istante resta il numero che
    /// è. Vedi il doc di [`Display for Text`](Text).
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ArgValue::Text(s) => f.write_str(s),
            ArgValue::Int(n) => write!(f, "{n}"),
            ArgValue::Float(x) => write!(f, "{x}"),
            ArgValue::Timestamp(ms) => write!(f, "{ms}"),
        }
    }
}

// ---------------------------------------------------------------------------
// Il catalogo
// ---------------------------------------------------------------------------

/// Le stringhe di un componente in **una** lingua.
///
/// Sta nel manifest ([`PluginManifest::strings`](crate::traits::PluginManifest)),
/// esattamente come lo schema delle impostazioni della decisione 0036, e per la
/// stessa ragione: il catalogo si legge **prima** di montare il componente — chi
/// disegna la palette dei comandi legge i titoli senza aver attivato nessuno — e
/// un catalogo registrato da `activate` sarebbe assente nel momento in cui
/// serve. C'è anche una ragione che vale solo per le stringhe: un catalogo è
/// **dato**, e dato nel manifest vuol dire che un traduttore lo può correggere
/// senza ricompilare, e che un plugin WASM di terzi non ci può scrivere a build
/// time.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct StringCatalog {
    /// Il tag BCP-47 della lingua di questo catalogo: `it`, `it-IT`, `en`.
    pub locale: String,
    /// Chiave → template. La chiave è **nuda**: la qualifica l'host con l'id
    /// del componente, e un catalogo non può quindi nominare le stringhe di un
    /// altro.
    pub entries: BTreeMap<String, String>,
}

impl StringCatalog {
    pub fn new(locale: impl Into<String>) -> Self {
        StringCatalog {
            locale: locale.into(),
            entries: BTreeMap::new(),
        }
    }

    /// Aggiunge una voce, in stile builder.
    pub fn with(mut self, key: impl Into<String>, template: impl Into<String>) -> Self {
        self.entries.insert(key.into(), template.into());
        self
    }
}

/// La ricerca di una traduzione: i cataloghi di **un** componente, letti nella
/// lingua di chi guarda.
///
/// Sta nel contratto e non nel kernel perché il *ladder* è contratto — un
/// provider deve poter sapere quale catalogo verrà scelto per lui — mentre *chi
/// ha quali cataloghi* è faccenda dell'host, che li tiene coi manifest.
#[derive(Clone, Copy, Debug)]
pub struct Strings<'a> {
    catalogs: &'a [StringCatalog],
    default_locale: &'a str,
    locale: &'a Locale,
}

impl<'a> Strings<'a> {
    pub fn new(catalogs: &'a [StringCatalog], default_locale: &'a str, locale: &'a Locale) -> Self {
        Strings {
            catalogs,
            default_locale,
            locale,
        }
    }

    /// Nessun catalogo: ogni messaggio scende fino alla chiave nuda.
    ///
    /// È ciò che serve un host che i manifest non li ha — un test, il
    /// riassorbimento di un albero che arriva dal confine — e non è un caso
    /// degenere da evitare: è l'ultimo gradino della scala, esercitato.
    pub fn none(locale: &'a Locale) -> Self {
        Strings {
            catalogs: &[],
            default_locale: "",
            locale,
        }
    }

    pub fn locale(&self) -> &'a Locale {
        self.locale
    }

    /// Il template di una chiave, per la scala del doc del modulo. `None` =
    /// nessun catalogo la contiene.
    ///
    /// **Più cataloghi per la stessa lingua si sommano**, e vince il primo che
    /// ha la chiave. Non è un dettaglio di implementazione: è ciò che permette a
    /// un componente fatto di due metà di portarne una per metà, senza che
    /// nessuno debba fonderle a mano. Il core ne è il caso vivo — le sue chiavi
    /// stanno in `fubmd-host` e quelle del locale in `fubmd-kernel`, e sono due
    /// crate diverse apposta. Cercando solo nel **primo** catalogo di quella
    /// lingua, il secondo sarebbe stato invisibile: non un errore, non un
    /// avviso, solo metà delle stringhe che scendono alla chiave nuda.
    pub fn template(&self, key: &str) -> Option<&'a str> {
        let cerca = |tag: &str| -> Option<&'a str> {
            if tag.is_empty() {
                return None;
            }
            self.catalogs
                .iter()
                .filter(|c| c.locale.eq_ignore_ascii_case(tag))
                .find_map(|c| c.entries.get(key))
                .map(String::as_str)
        };
        if self.locale.has_language() {
            if let Some(t) = cerca(&self.locale.language) {
                return Some(t);
            }
            if let Some(t) = cerca(self.locale.language_base()) {
                return Some(t);
            }
        }
        cerca(self.default_locale)
    }

    /// Il testo, leggibile. Un [`Text::Literal`] è già la risposta.
    pub fn render(&self, text: &Text) -> String {
        match text {
            Text::Literal(s) => s.clone(),
            Text::Message(m) => match self.template(&m.key) {
                Some(template) => expand(template, &m.args, self.locale),
                // L'ultimo gradino: la chiave nuda. Brutto, onesto, cercabile.
                None => m.key.clone(),
            },
        }
    }

    /// Risolve sul posto: dopo, il `Text` è un [`Text::Literal`].
    pub fn resolve(&self, text: &mut Text) {
        if text.is_literal() {
            return;
        }
        *text = Text::Literal(self.render(text));
    }

    /// Risolve **ogni** `Text` dentro una struttura del contratto.
    ///
    /// È il metodo che il kernel chiama sulla via d'uscita: un albero di UI, una
    /// spec, un errore.
    pub fn localize<T: Localize + ?Sized>(&self, value: &mut T) {
        value.visit_texts(&mut |t| self.resolve(t));
    }
}

/// Sostituisce i `{nome}` di un template con i suoi argomenti.
///
/// `{{` e `}}` sono le graffe letterali. Un nome che non è fra gli argomenti
/// resta **scritto com'è**, graffe comprese: è la stessa scelta dell'ultimo
/// gradino del ladder — un buco si deve vedere e si deve poter cercare, non
/// diventare una lacuna silenziosa in mezzo a una frase.
fn expand(template: &str, args: &[Arg], locale: &Locale) -> String {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(at) = rest.find(['{', '}']) {
        out.push_str(&rest[..at]);
        let brace = rest.as_bytes()[at];
        rest = &rest[at + 1..];
        // Raddoppiata = letterale, per l'una e per l'altra.
        if rest.as_bytes().first() == Some(&brace) {
            out.push(brace as char);
            rest = &rest[1..];
            continue;
        }
        if brace == b'}' {
            // Una graffa chiusa spaiata è testo: non c'è niente da chiudere.
            out.push('}');
            continue;
        }
        match rest.find('}') {
            Some(end) => {
                let name = &rest[..end];
                match args.iter().find(|a| a.name == name) {
                    Some(arg) => out.push_str(&arg.value.render(locale)),
                    None => {
                        out.push('{');
                        out.push_str(name);
                        out.push('}');
                    }
                }
                rest = &rest[end + 1..];
            }
            // Una graffa aperta che non si chiude mai: testo fino alla fine.
            None => {
                out.push('{');
                break;
            }
        }
    }
    out.push_str(rest);
    out
}

// ---------------------------------------------------------------------------
// Dove stanno i Text
// ---------------------------------------------------------------------------

/// **Dove** stanno i [`Text`] dentro una struttura del contratto.
///
/// Il taglio è deliberato: questo trait dice *dove sono*, [`Strings`] dice *cosa
/// diventano*. Le due metà hanno due proprietari — la prima sta accanto ai tipi,
/// nel contratto, dove un `match` esaustivo la tiene aggiornata quando nasce una
/// variante; la seconda sta nel kernel, che è l'unico a sapere quale componente
/// ha quale catalogo. Senza il taglio, l'`abi` avrebbe dovuto conoscere il
/// registro dei plugin, o il kernel avrebbe dovuto riscrivere a mano
/// l'attraversamento di ogni albero di UI — cioè il posto esatto in cui una
/// variante nuova sarebbe passata inosservata.
pub trait Localize {
    /// Visita ogni `Text` contenuto, in profondità e in ordine di lettura.
    fn visit_texts(&mut self, visit: &mut dyn FnMut(&mut Text));
}

impl Localize for Text {
    fn visit_texts(&mut self, visit: &mut dyn FnMut(&mut Text)) {
        visit(self);
    }
}

impl<T: Localize> Localize for Option<T> {
    fn visit_texts(&mut self, visit: &mut dyn FnMut(&mut Text)) {
        if let Some(inner) = self {
            inner.visit_texts(visit);
        }
    }
}

impl<T: Localize> Localize for Vec<T> {
    fn visit_texts(&mut self, visit: &mut dyn FnMut(&mut Text)) {
        for item in self {
            item.visit_texts(visit);
        }
    }
}

impl<T: Localize> Localize for Box<T> {
    fn visit_texts(&mut self, visit: &mut dyn FnMut(&mut Text)) {
        (**self).visit_texts(visit);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn italiano() -> Locale {
        Locale {
            language: "it-IT".into(),
            ..Locale::default()
        }
    }

    /// La riga che tiene in piedi il mirror TypeScript: un letterale è una
    /// stringa JSON, non un oggetto con un tag.
    #[test]
    fn a_literal_is_a_bare_json_string() {
        let json = serde_json::to_value(Text::from("Nessun backlink")).unwrap();
        assert_eq!(json, serde_json::json!("Nessun backlink"));
        let back: Text = serde_json::from_value(json).unwrap();
        assert_eq!(back, Text::Literal("Nessun backlink".into()));
    }

    /// E un messaggio è un oggetto — con gli argomenti omessi quando non ce ne
    /// sono, che è il caso comune.
    #[test]
    fn a_message_is_an_object_and_travels_both_ways() {
        let nudo = serde_json::to_value(Text::key("backlinks.empty")).unwrap();
        assert_eq!(nudo, serde_json::json!({"key": "backlinks.empty"}));

        let con_argomenti = Text::message(
            "backlinks.count",
            vec![Arg::int("n", 3), Arg::text("doc", "a/Uno.md")],
        );
        let json = serde_json::to_value(&con_argomenti).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "key": "backlinks.count",
                "args": [
                    {"name": "n", "value": {"kind": "int", "value": 3}},
                    {"name": "doc", "value": {"kind": "text", "value": "a/Uno.md"}},
                ]
            })
        );
        let back: Text = serde_json::from_value(json).unwrap();
        assert_eq!(back, con_argomenti);
    }

    /// La scala del doc del modulo, gradino per gradino.
    #[test]
    fn the_ladder_descends_by_specificity() {
        let cataloghi = vec![
            StringCatalog::new("it-IT").with("solo_regionale", "regionale"),
            StringCatalog::new("it")
                .with("solo_regionale", "generico")
                .with("solo_lingua", "lingua"),
            StringCatalog::new("en")
                .with("solo_regionale", "regional")
                .with("solo_lingua", "language")
                .with("solo_default", "default"),
        ];
        let locale = italiano();
        let s = Strings::new(&cataloghi, "en", &locale);
        assert_eq!(s.render(&Text::key("solo_regionale")), "regionale");
        assert_eq!(s.render(&Text::key("solo_lingua")), "lingua");
        assert_eq!(s.render(&Text::key("solo_default")), "default");
        // L'ultimo gradino: la chiave nuda.
        assert_eq!(s.render(&Text::key("mai_scritta")), "mai_scritta");
    }

    /// Chi non ha dichiarato la propria lingua salta i primi due gradini invece
    /// di cercare un catalogo `und` che nessuno scriverà mai.
    #[test]
    fn an_undetermined_language_goes_straight_to_the_default() {
        let cataloghi = vec![StringCatalog::new("en").with("k", "english")];
        let mut und = Locale::default();
        let s = Strings::new(&cataloghi, "en", &und);
        assert_eq!(s.render(&Text::key("k")), "english");
        // E chi la dichiara e non ce l'ha scende comunque al default.
        und.language = "de".into();
        let s = Strings::new(&cataloghi, "en", &und);
        assert_eq!(s.render(&Text::key("k")), "english");
    }

    #[test]
    fn substitution_puts_the_arguments_where_the_braces_are() {
        let cataloghi =
            vec![StringCatalog::new("it").with("conteggio", "{n} note in «{cartella}»")];
        let locale = italiano();
        let s = Strings::new(&cataloghi, "it", &locale);
        let t = Text::message(
            "conteggio",
            vec![Arg::int("n", 12), Arg::text("cartella", "Archivio")],
        );
        assert_eq!(s.render(&t), "12 note in «Archivio»");
    }

    /// I tre casi in cui una sostituzione ingenua sbaglia: la graffa letterale,
    /// il nome che non c'è, la graffa che non si chiude.
    #[test]
    fn the_template_language_has_exactly_one_construct() {
        let locale = Locale::default();
        let args = vec![Arg::text("a", "A")];
        assert_eq!(expand("{{a}}", &args, &locale), "{a}");
        assert_eq!(expand("{{{a}}}", &args, &locale), "{A}");
        // Un nome sconosciuto resta scritto com'è: un buco si deve vedere.
        assert_eq!(expand("<{ignoto}>", &args, &locale), "<{ignoto}>");
        // Graffe spaiate: testo.
        assert_eq!(
            expand("aperta { e basta", &args, &locale),
            "aperta { e basta"
        );
        assert_eq!(
            expand("chiusa } e basta", &args, &locale),
            "chiusa } e basta"
        );
        assert_eq!(expand("niente", &args, &locale), "niente");
    }

    /// L'argomento tipizzato serve a questo: lo stesso messaggio, due locali,
    /// due date — e nessun provider ha dovuto saperlo.
    #[test]
    fn a_typed_timestamp_is_formatted_by_whoever_knows_the_locale() {
        let cataloghi = vec![StringCatalog::new("it").with("visto", "visto il {quando}")];
        let t = Text::message("visto", vec![Arg::timestamp("quando", 1_785_241_800_000)]);

        let utc = Locale {
            language: "it".into(),
            ..Locale::default()
        };
        assert_eq!(
            Strings::new(&cataloghi, "it", &utc).render(&t),
            "visto il 2026-07-28 12:30"
        );
        let roma = Locale {
            utc_offset_minutes: 120,
            ..utc.clone()
        };
        assert_eq!(
            Strings::new(&cataloghi, "it", &roma).render(&t),
            "visto il 2026-07-28 14:30"
        );
    }

    /// `Display` non traduce, e non finge: dice la chiave e i suoi argomenti,
    /// che è ciò che serve a chi legge un log.
    #[test]
    fn display_is_for_logs() {
        assert_eq!(Text::from("ciao").to_string(), "ciao");
        assert_eq!(Text::key("a.b").to_string(), "a.b");
        assert_eq!(
            Text::message("a.b", vec![Arg::int("n", 2), Arg::text("x", "y")]).to_string(),
            "a.b {n=2, x=y}"
        );
    }

    /// Risolvere è idempotente e non tocca ciò che era già un dato.
    #[test]
    fn resolving_is_idempotent() {
        let cataloghi = vec![StringCatalog::new("it").with("k", "tradotto")];
        let locale = italiano();
        let s = Strings::new(&cataloghi, "it", &locale);
        let mut t = Text::key("k");
        s.resolve(&mut t);
        assert_eq!(t, Text::Literal("tradotto".into()));
        s.resolve(&mut t);
        assert_eq!(t, Text::Literal("tradotto".into()));

        let mut dato = Text::from("a/Uno.md");
        s.resolve(&mut dato);
        assert_eq!(dato, Text::Literal("a/Uno.md".into()));
    }

    /// Senza cataloghi non si rompe niente: si scende al gradino di sotto.
    #[test]
    fn no_catalog_is_not_an_error() {
        let locale = italiano();
        let s = Strings::none(&locale);
        let mut v = vec![Text::from("dato"), Text::key("chiave")];
        s.localize(&mut v);
        assert_eq!(
            v,
            vec![Text::Literal("dato".into()), Text::Literal("chiave".into())]
        );
    }
}
