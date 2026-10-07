//! La copia di oggetti da un documento PDF a un altro.
//!
//! Un oggetto si porta con tutto ciò che raggiunge: un carattere con il suo
//! programma, un'immagine con la sua maschera. I numeri si danno nell'ordine
//! in cui gli oggetti si incontrano, in ampiezza, e lo stesso documento dà
//! sempre gli stessi numeri; un oggetto raggiunto da due strade si copia una
//! volta sola.
//!
//! La copia ha un **recinto**: i tipi elencati in [`Copier::new`] non si
//! copiano mai, e un riferimento a uno di loro diventa `null`. Serve perché un
//! riferimento qualunque, per esempio il `/P` di un'annotazione o il `/Parent`
//! di un nodo, porterebbe con sé l'albero delle pagine intero, cioè anche le
//! pagine che il documento nuovo non deve contenere. Le pagine che il
//! documento nuovo ha si annunciano prima con [`Copier::seed`], e un
//! riferimento a una di loro diventa un riferimento alla pagina nuova.

use std::collections::{BTreeMap, VecDeque};

use lopdf::{Dictionary, Document, Object, ObjectId};

/// I tipi che non si copiano: la struttura del documento, che il documento
/// nuovo si fa da sé, e ciò che porterebbe dentro pagine o testo nascosto.
pub(super) const DOCUMENT: [&[u8]; 8] = [
    b"Catalog",
    b"Pages",
    b"Page",
    b"Annot",
    b"StructTreeRoot",
    b"StructElem",
    b"Outlines",
    b"Filespec",
];

pub(super) struct Copier<'a> {
    from: &'a Document,
    fence: &'a [&'a [u8]],
    map: BTreeMap<ObjectId, ObjectId>,
    queue: VecDeque<ObjectId>,
    /// Gli oggetti nuovi che devono essere Form XObject: vedi
    /// [`Copier::form`].
    forms: Vec<ObjectId>,
}

impl<'a> Copier<'a> {
    /// Una copia da `from`, che non attraversa gli oggetti dei tipi `fence`.
    pub(super) fn new(from: &'a Document, fence: &'a [&'a [u8]]) -> Copier<'a> {
        Copier {
            from,
            fence,
            map: BTreeMap::new(),
            queue: VecDeque::new(),
            forms: Vec::new(),
        }
    }

    /// Dice che l'oggetto `old` di `from` nel documento nuovo è `new`: un
    /// riferimento a `old` diventa un riferimento a `new`, e `old` non si
    /// copia.
    pub(super) fn seed(&mut self, old: ObjectId, new: ObjectId) {
        self.map.insert(old, new);
    }

    /// Il documento da cui si copia.
    pub(super) fn source(&self) -> &'a Document {
        self.from
    }

    /// Le coppie di oggetti copiati finora, `(vecchio, nuovo)`, comprese
    /// quelle annunciate con [`seed`](Copier::seed).
    pub(super) fn copied(&self) -> impl Iterator<Item = (ObjectId, ObjectId)> + '_ {
        self.map.iter().map(|(old, new)| (*old, *new))
    }

    /// Il flusso `old` copiato come Form XObject: l'aspetto di
    /// un'annotazione lo è per definizione, ma non tutti i PDF lo scrivono
    /// nel dizionario, e senza `/Subtype /Form` l'operatore `Do` non lo
    /// disegna. Il dizionario si corregge in [`finish`](Copier::finish).
    pub(super) fn form(&mut self, old: ObjectId, into: &mut Document) -> Option<ObjectId> {
        let new = self.reference(old, into).as_reference().ok()?;
        self.forms.push(new);
        Some(new)
    }

    /// Il valore `value` di `from`, con i riferimenti tradotti in `into`.
    /// Gli oggetti nuovi che raggiunge ricevono un numero subito e si copiano
    /// con [`finish`](Copier::finish).
    pub(super) fn value(&mut self, value: &Object, into: &mut Document) -> Object {
        match value {
            Object::Reference(id) => self.reference(*id, into),
            Object::Array(items) => {
                Object::Array(items.iter().map(|item| self.value(item, into)).collect())
            }
            Object::Dictionary(dict) => Object::Dictionary(self.dictionary(dict, into)),
            Object::Stream(stream) => {
                let mut copied = stream.clone();
                copied.dict = self.dictionary(&stream.dict, into);
                Object::Stream(copied)
            }
            other => other.clone(),
        }
    }

    /// Un dizionario di `from`, con i riferimenti tradotti.
    pub(super) fn dictionary(&mut self, dict: &Dictionary, into: &mut Document) -> Dictionary {
        let mut out = Dictionary::new();
        for (key, value) in dict.iter() {
            out.set(key.clone(), self.value(value, into));
        }
        out
    }

    /// Copia tutto ciò che i valori tradotti finora hanno raggiunto.
    pub(super) fn finish(&mut self, into: &mut Document) {
        while let Some(old) = self.queue.pop_front() {
            let new = self.map[&old];
            let object = match self.from.objects.get(&old) {
                Some(object) => self.value(object, into),
                None => Object::Null,
            };
            into.objects.insert(new, object);
        }
        for id in self.forms.drain(..) {
            if let Some(Object::Stream(stream)) = into.objects.get_mut(&id) {
                stream.dict.set("Type", "XObject");
                stream.dict.set("Subtype", "Form");
            }
        }
    }

    fn reference(&mut self, old: ObjectId, into: &mut Document) -> Object {
        if let Some(new) = self.map.get(&old) {
            return Object::Reference(*new);
        }
        let Some(object) = self.from.objects.get(&old) else {
            return Object::Null;
        };
        if self.fenced(object) {
            return Object::Null;
        }
        let new = into.new_object_id();
        self.map.insert(old, new);
        self.queue.push_back(old);
        Object::Reference(new)
    }

    fn fenced(&self, object: &Object) -> bool {
        let dict = match object {
            Object::Dictionary(dict) => dict,
            Object::Stream(stream) => &stream.dict,
            _ => return false,
        };
        dict.get(b"Type")
            .and_then(Object::as_name)
            .is_ok_and(|name| self.fence.contains(&name))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{dictionary, Stream};

    #[test]
    fn a_graph_is_copied_once_in_breadth_order() {
        let mut from = Document::with_version("1.7");
        let shared = from.add_object(dictionary! { "N" => 1 });
        let left = from.add_object(dictionary! { "S" => shared });
        let stream = from.add_object(Stream::new(dictionary! { "S" => shared }, b"q Q".to_vec()));
        let root = from.add_object(dictionary! { "L" => left, "R" => stream, "Again" => left });
        // Un ciclo non tiene ferma la copia.
        from.get_dictionary_mut(shared).unwrap().set("Back", root);

        let mut into = Document::with_version("1.7");
        into.new_object_id();
        let mut copier = Copier::new(&from, &[]);
        let copied = copier.value(&Object::Reference(root), &mut into);
        copier.finish(&mut into);
        assert_eq!(copied, Object::Reference((2, 0)));
        assert_eq!(into.objects.len(), 4);
        let root = into.get_dictionary((2, 0)).unwrap();
        assert_eq!(root.get(b"L").unwrap(), &Object::Reference((3, 0)));
        assert_eq!(root.get(b"R").unwrap(), &Object::Reference((4, 0)));
        assert_eq!(root.get(b"Again").unwrap(), &Object::Reference((3, 0)));
        let shared = into.get_dictionary((5, 0)).unwrap();
        assert_eq!(shared.get(b"Back").unwrap(), &Object::Reference((2, 0)));
        let Object::Stream(stream) = into.get_object((4, 0)).unwrap() else {
            panic!("un flusso resta un flusso");
        };
        assert_eq!(stream.content, b"q Q");
        assert_eq!(stream.dict.get(b"S").unwrap(), &Object::Reference((5, 0)));
    }

    #[test]
    fn the_fence_stops_at_pages_and_seeds_translate() {
        let mut from = Document::with_version("1.7");
        let pages = from.new_object_id();
        let kept = from.add_object(dictionary! { "Type" => "Page", "Parent" => pages });
        let dropped =
            from.add_object(dictionary! { "Type" => "Page", "Parent" => pages, "Secret" => "x" });
        from.objects.insert(
            pages,
            Object::Dictionary(
                dictionary! { "Type" => "Pages", "Kids" => vec![kept.into(), dropped.into()] },
            ),
        );
        let link = from.add_object(dictionary! { "D" => vec![kept.into(), "Fit".into()], "Up" => pages, "Gone" => (99, 0) });

        let mut into = Document::with_version("1.7");
        let new_page = into.new_object_id();
        let mut copier = Copier::new(&from, &DOCUMENT);
        copier.seed(kept, new_page);
        let copied = copier.value(&Object::Reference(link), &mut into);
        copier.finish(&mut into);
        let link = into.get_dictionary(copied.as_reference().unwrap()).unwrap();
        assert_eq!(
            link.get(b"D").unwrap(),
            &Object::Array(vec![Object::Reference(new_page), "Fit".into()])
        );
        assert_eq!(link.get(b"Up").unwrap(), &Object::Null);
        assert_eq!(link.get(b"Gone").unwrap(), &Object::Null);
        assert_eq!(
            into.objects.len(),
            1,
            "solo il collegamento: le pagine restano fuori"
        );
    }
}
