//! I campi che Fub legge dal JSON di un file Craft, senza costruire il
//! documento.
//!
//! Il JSON di un file è input ostile: un `[0,0,0,…]` di 64 MiB diventerebbe
//! un `serde_json::Value` di trentadue milioni di valori. [`Fields`] invece
//! cammina il JSON una volta, con un visitatore che tiene solo ciò che
//! [`Want`] chiede (la versione e il titolo dell'oggetto in cima, i testi, i
//! file collegati, l'anteprima di un `.vectorcraft`) e salta il resto con
//! [`IgnoredAny`] quando dentro non c'è più niente da prendere. La pila non
//! cresce oltre il limite di annidamento di `serde_json` (128 livelli, come
//! per un `Value`).
//!
//! Le regole sono quelle di prima, sul documento intero:
//!
//! - versione e titolo vengono dall'oggetto in cima: il primo dei campi, in
//!   ordine di nome, che ha un valore buono; una chiave ripetuta vale per
//!   l'ultima volta che compare;
//! - i testi sono le stringhe non vuote dei campi [`TEXT_KEYS`], a ogni
//!   profondità e nell'ordine del file, fino a [`MAX_TEXT_BYTES`];
//! - i file collegati seguono [`linked`](crate::linked): i campi
//!   [`LINK_KEYS`] degli oggetti fino a [`MAX_DEPTH`] livelli, fino a
//!   [`MAX_LINKS`](crate::linked::MAX_LINKS) percorsi;
//! - l'anteprima è la stringa in `/preview/data`, che si copia solo se sta
//!   sotto il tetto del base64.

use std::fmt;
use std::io::Read;

use serde::de::{DeserializeSeed, Deserializer, IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde_json::Number;

use super::{strip_data_url, MAX_PREVIEW_BASE64, MAX_TEXT_BYTES, TEXT_KEYS, TITLE_KEYS};
use crate::linked::{relative_path, Found, LINK_KEYS, MAX_DEPTH};

/// Che cosa si prende dal JSON.
#[derive(Clone, Copy)]
pub(super) struct Want {
    /// I campi della versione, nell'ordine in cui valgono.
    pub version_keys: &'static [&'static str],
    pub title: bool,
    pub text: bool,
    pub links: bool,
    /// `/preview/data` di un `.vectorcraft`.
    pub preview: bool,
}

/// L'anteprima di un `.vectorcraft` come il JSON la porta.
#[derive(Debug)]
pub(super) enum Preview {
    /// Non c'è, o non è una stringa in base64.
    Absent,
    /// La stringa supera il tetto del base64: non si è copiata.
    TooLarge,
    /// Il base64, senza il prefisso `data:…;base64,`.
    Encoded(String),
}

/// Ciò che il cammino ha preso.
pub(super) struct Fields {
    want: Want,
    /// Un posto per campo della versione: l'ultimo valore buono, o `None`.
    versions: [Option<String>; 2],
    titles: [Option<String>; 2],
    text: String,
    text_full: bool,
    links: Found,
    links_full: bool,
    preview: Preview,
}

/// Perché il JSON non si è letto: la lettura sotto, o il JSON stesso.
#[derive(Debug)]
pub(super) enum Failure {
    Read,
    Json,
}

impl Fields {
    pub(super) fn new(want: Want) -> Fields {
        Fields {
            want,
            versions: [None, None],
            titles: [None, None],
            text: String::new(),
            text_full: false,
            links: Found::default(),
            links_full: false,
            preview: Preview::Absent,
        }
    }

    /// La versione: il primo campo, nell'ordine di [`Want::version_keys`],
    /// che ha un valore buono.
    pub(super) fn version(&mut self) -> Option<String> {
        self.versions.iter_mut().find_map(Option::take)
    }

    pub(super) fn title(&mut self) -> Option<String> {
        self.titles.iter_mut().find_map(Option::take)
    }

    /// I testi, uno per riga, tagliati a [`MAX_TEXT_BYTES`] su un confine di
    /// carattere e senza un a capo in fondo.
    pub(super) fn text(&mut self) -> String {
        let mut text = std::mem::take(&mut self.text);
        if text.len() > MAX_TEXT_BYTES {
            let mut cut = MAX_TEXT_BYTES;
            while !text.is_char_boundary(cut) {
                cut -= 1;
            }
            text.truncate(cut);
            let kept = text.trim_end_matches('\n').len();
            text.truncate(kept);
        }
        text
    }

    pub(super) fn links(&mut self) -> Vec<String> {
        std::mem::take(&mut self.links.paths)
    }

    pub(super) fn preview(&mut self) -> Preview {
        std::mem::replace(&mut self.preview, Preview::Absent)
    }

    /// Resta qualcosa da prendere sotto l'oggetto in cima.
    fn hungry(&self) -> bool {
        (self.want.text && !self.text_full) || (self.want.links && !self.links_full)
    }

    fn push_text(&mut self, found: &str) {
        if found.is_empty() {
            return;
        }
        if !self.text.is_empty() {
            self.text.push('\n');
        }
        // Di una stringa lunga si copia solo ciò che il taglio può tenere: un
        // byte oltre il tetto, arrotondato al carattere.
        let mut room = (MAX_TEXT_BYTES + 1).saturating_sub(self.text.len());
        while room < found.len() && !found.is_char_boundary(room) {
            room += 1;
        }
        self.text.push_str(found.get(..room).unwrap_or(found));
        if self.text.len() > MAX_TEXT_BYTES {
            self.text_full = true;
        }
    }
}

/// I campi da `bytes`, un JSON intero.
pub(super) fn from_slice(bytes: &[u8], want: Want) -> Result<Fields, Failure> {
    let mut fields = Fields::new(want);
    let mut json = serde_json::Deserializer::from_slice(bytes);
    walk(&mut json, &mut fields)
        .and_then(|()| json.end())
        .map_err(|_| Failure::Json)?;
    Ok(fields)
}

/// I campi da `reader`, un JSON intero.
pub(super) fn from_reader<R: Read>(reader: R, want: Want) -> Result<Fields, Failure> {
    let mut fields = Fields::new(want);
    let mut json = serde_json::Deserializer::from_reader(reader);
    walk(&mut json, &mut fields)
        .and_then(|()| json.end())
        .map_err(failure)?;
    Ok(fields)
}

/// I campi dai primi `cap` byte di `reader`. Un JSON più lungo di `cap` che
/// fin lì è valido dà ciò che si è trovato prima del taglio; uno che finisce
/// prima, rotto, è [`Failure::Json`].
pub(super) fn from_prefix<R: Read>(
    reader: &mut R,
    want: Want,
    cap: u64,
) -> Result<Fields, Failure> {
    let mut fields = Fields::new(want);
    let mut head = reader.take(cap);
    let outcome = {
        let mut json = serde_json::Deserializer::from_reader(&mut head);
        walk(&mut json, &mut fields).and_then(|()| json.end())
    };
    match outcome {
        Ok(()) => Ok(fields),
        Err(error) if error.is_eof() && head.limit() == 0 => {
            let mut next = [0u8; 1];
            match head.into_inner().read(&mut next) {
                // Il JSON continua oltre il taglio: vale ciò che c'era prima.
                Ok(1..) => Ok(fields),
                Ok(0) => Err(Failure::Json),
                Err(_) => Err(Failure::Read),
            }
        }
        Err(error) => Err(failure(error)),
    }
}

fn failure(error: serde_json::Error) -> Failure {
    if error.is_io() {
        Failure::Read
    } else {
        Failure::Json
    }
}

fn walk<'de, D: Deserializer<'de>>(json: D, fields: &mut Fields) -> Result<(), D::Error> {
    Node {
        fields,
        depth: 1,
        key: Key::Other,
    }
    .deserialize(json)
}

/// Che cosa è un campo per chi cammina.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Key {
    Other,
    Text,
    Link,
    /// Un campo della versione dell'oggetto in cima, col suo posto.
    Version(usize),
    Title(usize),
    /// `preview` dell'oggetto in cima.
    Preview,
    /// `data` dentro `preview`.
    Data,
}

/// Il nome di un campo, riconosciuto senza copiarlo.
struct KeySeed {
    want: Want,
    top: bool,
    in_preview: bool,
}

impl<'de> DeserializeSeed<'de> for KeySeed {
    type Value = Key;

    fn deserialize<D: Deserializer<'de>>(self, json: D) -> Result<Key, D::Error> {
        json.deserialize_str(self)
    }
}

impl Visitor<'_> for KeySeed {
    type Value = Key;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("il nome di un campo")
    }

    fn visit_str<E>(self, name: &str) -> Result<Key, E> {
        let want = self.want;
        let position = |keys: &[&str]| keys.iter().position(|key| *key == name);
        if self.top {
            if let Some(slot) = position(want.version_keys) {
                return Ok(Key::Version(slot));
            }
            if want.title {
                if let Some(slot) = position(&TITLE_KEYS) {
                    return Ok(Key::Title(slot));
                }
            }
            if want.preview && name == "preview" {
                return Ok(Key::Preview);
            }
        }
        if self.in_preview && name == "data" {
            return Ok(Key::Data);
        }
        if want.text && TEXT_KEYS.contains(&name) {
            return Ok(Key::Text);
        }
        if want.links && LINK_KEYS.contains(&name) {
            return Ok(Key::Link);
        }
        Ok(Key::Other)
    }
}

/// Un valore a profondità `depth` (il documento è 1), sotto il campo `key`.
struct Node<'a> {
    fields: &'a mut Fields,
    depth: usize,
    key: Key,
}

impl Node<'_> {
    /// Il valore del campo non è una stringa buona: il suo posto si svuota.
    fn not_a_string(&mut self) {
        match self.key {
            Key::Version(slot) => self.set_version(slot, None),
            Key::Title(slot) => self.set_title(slot, None),
            Key::Preview | Key::Data => self.fields.preview = Preview::Absent,
            Key::Other | Key::Text | Key::Link => {}
        }
    }

    fn set_version(&mut self, slot: usize, value: Option<String>) {
        if let Some(place) = self.fields.versions.get_mut(slot) {
            *place = value;
        }
    }

    fn set_title(&mut self, slot: usize, value: Option<String>) {
        if let Some(place) = self.fields.titles.get_mut(slot) {
            *place = value;
        }
    }

    fn number(&mut self, number: Option<Number>) {
        match self.key {
            Key::Version(slot) => self.set_version(slot, number.map(|n| n.to_string())),
            _ => self.not_a_string(),
        }
    }

    /// Dentro questo valore c'è ancora qualcosa da prendere.
    fn worth_walking(&self) -> bool {
        self.depth == 1 || self.key != Key::Other || self.fields.hungry()
    }

    fn child(&mut self, key: Key) -> Node<'_> {
        Node {
            fields: self.fields,
            depth: self.depth + 1,
            key,
        }
    }
}

/// Una stringa non vuota dopo gli spazi.
fn filled(text: &str) -> Option<String> {
    (!text.trim().is_empty()).then(|| text.to_owned())
}

impl<'de> DeserializeSeed<'de> for Node<'_> {
    type Value = ();

    fn deserialize<D: Deserializer<'de>>(self, json: D) -> Result<(), D::Error> {
        if self.worth_walking() {
            json.deserialize_any(self)
        } else {
            json.deserialize_ignored_any(IgnoredAny).map(|_| ())
        }
    }
}

impl<'de> Visitor<'de> for Node<'_> {
    type Value = ();

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("un valore JSON")
    }

    fn visit_bool<E>(mut self, _: bool) -> Result<(), E> {
        self.not_a_string();
        Ok(())
    }

    fn visit_i64<E>(mut self, value: i64) -> Result<(), E> {
        self.number(Some(Number::from(value)));
        Ok(())
    }

    fn visit_u64<E>(mut self, value: u64) -> Result<(), E> {
        self.number(Some(Number::from(value)));
        Ok(())
    }

    fn visit_f64<E>(mut self, value: f64) -> Result<(), E> {
        self.number(Number::from_f64(value));
        Ok(())
    }

    fn visit_unit<E>(mut self) -> Result<(), E> {
        self.not_a_string();
        Ok(())
    }

    fn visit_none<E>(mut self) -> Result<(), E> {
        self.not_a_string();
        Ok(())
    }

    fn visit_str<E>(mut self, found: &str) -> Result<(), E> {
        match self.key {
            Key::Version(slot) => self.set_version(slot, filled(found)),
            Key::Title(slot) => self.set_title(slot, filled(found)),
            Key::Preview => self.fields.preview = Preview::Absent,
            Key::Data => {
                self.fields.preview = match strip_data_url(found) {
                    None => Preview::Absent,
                    // Il tetto si guarda prima di copiare.
                    Some(encoded) if encoded.len() > MAX_PREVIEW_BASE64 => Preview::TooLarge,
                    Some(encoded) => Preview::Encoded(encoded.to_owned()),
                }
            }
            Key::Text => {
                if !self.fields.text_full {
                    self.fields.push_text(found);
                }
            }
            // La stringa sta a `depth`, il suo oggetto un livello sopra.
            Key::Link if self.depth.saturating_sub(1) <= MAX_DEPTH && !self.fields.links_full => {
                if let Some(path) = relative_path(found) {
                    self.fields.links_full = self.fields.links.push(path).is_break();
                }
            }
            Key::Link | Key::Other => {}
        }
        Ok(())
    }

    fn visit_map<A: MapAccess<'de>>(mut self, mut map: A) -> Result<(), A::Error> {
        self.not_a_string();
        let seed = |node: &Node<'_>| KeySeed {
            want: node.fields.want,
            top: node.depth == 1,
            in_preview: node.key == Key::Preview,
        };
        while let Some(key) = map.next_key_seed(seed(&self))? {
            map.next_value_seed(self.child(key))?;
        }
        Ok(())
    }

    fn visit_seq<A: SeqAccess<'de>>(mut self, mut seq: A) -> Result<(), A::Error> {
        self.not_a_string();
        while seq.next_element_seed(self.child(Key::Other))?.is_some() {}
        Ok(())
    }
}
