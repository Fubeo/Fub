//! I livelli del PDF che l'editor mostra.
//!
//! Un livello (un gruppo di contenuto facoltativo, OCG) si vede o no secondo
//! la configurazione di serie del documento, `/OCProperties /D`, e un
//! dizionario di appartenenza (OCMD) combina più livelli con una regola o con
//! un'espressione. L'editor mostra le pagine con pdf.js, e la pagina redatta
//! deve mostrare ciò che chi ha messo le coperture ha visto: né di meno, né
//! di più, perché un livello nascosto che riapparisse nell'immagine
//! porterebbe con sé ciò che nessuno ha guardato. `hayro` di queste regole
//! conosce una parte, e qui si rifanno quelle di pdf.js 6.3 per la
//! visualizzazione, casi limite compresi: un livello che `/OCGs` non elenca
//! si vede, uno stato `/ViewState /OFF` dell'uso lo nasconde.

use std::collections::BTreeMap;

use lopdf::{Document, Object, ObjectId};

/// Quanto può essere annidata un'espressione di visibilità: un livello più a
/// fondo, per pdf.js, è un'espressione vuota.
const NESTING: usize = 10;

/// I livelli della configurazione di serie, e quali si vedono.
#[derive(Debug, Default)]
pub(super) struct Layers {
    groups: BTreeMap<ObjectId, bool>,
}

/// Un'espressione `/VE`: un operatore e i suoi termini.
struct Expression {
    operator: Operator,
    terms: Vec<Term>,
}

#[derive(Clone, Copy, PartialEq)]
enum Operator {
    And,
    Or,
    Not,
}

enum Term {
    Group(ObjectId),
    /// Un'espressione annidata; `None` se non si legge, e allora vale vera.
    Nested(Option<Expression>),
}

impl Layers {
    /// I livelli di `doc`. Senza `/OCProperties`, senza `/D` o senza un
    /// elenco `/OCGs` non ce ne sono, e tutto si vede.
    pub(super) fn of(doc: &Document) -> Layers {
        let groups = (|| {
            let catalog = doc.catalog().ok()?;
            let properties = dict(doc, catalog.get(b"OCProperties").ok()?)?;
            let default = dict(doc, properties.get(b"D").ok()?)?;
            let listed = array(doc, properties.get(b"OCGs").ok()?)?;
            let mut groups = BTreeMap::new();
            for item in listed {
                if let Object::Reference(id) = item {
                    if doc.get_dictionary(*id).is_ok() {
                        groups.insert(*id, true);
                    }
                }
            }
            let base = default.get(b"BaseState").and_then(Object::as_name).ok();
            if base == Some(b"OFF".as_slice()) {
                groups.values_mut().for_each(|visible| *visible = false);
            }
            for (key, state) in [(b"ON".as_slice(), true), (b"OFF".as_slice(), false)] {
                let Some(list) = default.get(key).ok().and_then(|value| array(doc, value)) else {
                    continue;
                };
                for item in list {
                    if let Some(visible) =
                        item.as_reference().ok().and_then(|id| groups.get_mut(&id))
                    {
                        *visible = state;
                    }
                }
            }
            for (id, visible) in groups.iter_mut() {
                if *visible && view_off(doc, *id) {
                    *visible = false;
                }
            }
            Some(groups)
        })()
        .unwrap_or_default();
        Layers { groups }
    }

    /// Vero se il contenuto con `/OC` uguale a `oc` si vede. Ciò che non è
    /// un livello né un dizionario di appartenenza si vede.
    pub(super) fn visible(&self, doc: &Document, oc: &Object) -> bool {
        if self.groups.is_empty() {
            return true;
        }
        let id = oc.as_reference().ok();
        let Some(dict) = dict(doc, oc) else {
            return true;
        };
        match dict.get(b"Type").and_then(Object::as_name).ok() {
            Some(b"OCG") => id.is_none_or(|id| self.group(id).unwrap_or(true)),
            Some(b"OCMD") => self.membership(doc, dict),
            _ => true,
        }
    }

    /// Se un livello elencato si vede; `None` se l'elenco non lo ha.
    fn group(&self, id: ObjectId) -> Option<bool> {
        self.groups.get(&id).copied()
    }

    fn membership(&self, doc: &Document, dict: &lopdf::Dictionary) -> bool {
        if let Some(expression) = dict
            .get(b"VE")
            .ok()
            .and_then(|value| array(doc, value))
            .and_then(|items| expression(doc, items, 1))
        {
            return self.evaluate(&expression);
        }
        // I livelli dell'elenco: uno solo, o un array. Un elemento che non è
        // un riferimento a un livello elencato decide per «si vede».
        let ids: Vec<Option<ObjectId>> = match dict.get(b"OCGs") {
            Ok(Object::Array(items)) => items.iter().map(|item| item.as_reference().ok()).collect(),
            Ok(Object::Reference(id)) => match doc.get_object(*id) {
                Ok(Object::Array(items)) => {
                    items.iter().map(|item| item.as_reference().ok()).collect()
                }
                Ok(Object::Dictionary(_)) => vec![Some(*id)],
                _ => return true,
            },
            Ok(Object::Dictionary(_)) => vec![None],
            _ => return true,
        };
        let policy = dict
            .get(b"P")
            .and_then(Object::as_name)
            .ok()
            .unwrap_or(b"AnyOn");
        let states = ids.into_iter().map(|id| id.and_then(|id| self.group(id)));
        match policy {
            b"AnyOn" => {
                for state in states {
                    match state {
                        None | Some(true) => return true,
                        Some(false) => {}
                    }
                }
                false
            }
            b"AllOn" => {
                for state in states {
                    match state {
                        None => return true,
                        Some(false) => return false,
                        Some(true) => {}
                    }
                }
                true
            }
            b"AnyOff" => {
                for state in states {
                    match state {
                        None | Some(false) => return true,
                        Some(true) => {}
                    }
                }
                false
            }
            b"AllOff" => {
                for state in states {
                    match state {
                        None => return true,
                        Some(true) => return false,
                        Some(false) => {}
                    }
                }
                true
            }
            _ => true,
        }
    }

    fn evaluate(&self, expression: &Expression) -> bool {
        if expression.terms.is_empty() {
            return true;
        }
        for term in &expression.terms {
            let state = match term {
                Term::Group(id) => match self.group(*id) {
                    Some(state) => state,
                    None => return true,
                },
                Term::Nested(Some(nested)) => self.evaluate(nested),
                Term::Nested(None) => true,
            };
            match expression.operator {
                Operator::And if !state => return false,
                Operator::Or if state => return true,
                Operator::Not => return !state,
                _ => {}
            }
        }
        expression.operator == Operator::And
    }

    /// I livelli e i dizionari di appartenenza fra `ids` che non si vedono.
    pub(super) fn hidden<'a>(
        &'a self,
        doc: &'a Document,
        ids: impl Iterator<Item = ObjectId> + 'a,
    ) -> impl Iterator<Item = ObjectId> + 'a {
        ids.filter(move |id| {
            let kind = doc
                .get_dictionary(*id)
                .ok()
                .and_then(|dict| dict.get(b"Type").and_then(Object::as_name).ok());
            matches!(kind, Some(b"OCG" | b"OCMD")) && !self.visible(doc, &Object::Reference(*id))
        })
    }
}

/// L'espressione `items` letta come pdf.js: un operatore valido e almeno un
/// termine, altrimenti niente.
fn expression(doc: &Document, items: &[Object], depth: usize) -> Option<Expression> {
    if depth > NESTING || items.len() < 2 {
        return None;
    }
    let operator = match doc.dereference(&items[0]).ok()?.1.as_name().ok()? {
        b"And" => Operator::And,
        b"Or" => Operator::Or,
        b"Not" => Operator::Not,
        _ => return None,
    };
    let terms = items[1..]
        .iter()
        .filter_map(|item| match doc.dereference(item).ok()?.1 {
            Object::Array(nested) => Some(Term::Nested(expression(doc, nested, depth + 1))),
            _ => item.as_reference().ok().map(Term::Group),
        })
        .collect();
    Some(Expression { operator, terms })
}

/// Vero se l'uso del livello dice che a schermo non si vede.
fn view_off(doc: &Document, id: ObjectId) -> bool {
    let state = || -> Option<bool> {
        let usage = dict(doc, doc.get_dictionary(id).ok()?.get(b"Usage").ok()?)?;
        let view = dict(doc, usage.get(b"View").ok()?)?;
        Some(view.get(b"ViewState").and_then(Object::as_name).ok()? == b"OFF")
    };
    state().unwrap_or(false)
}

fn dict<'a>(doc: &'a Document, value: &'a Object) -> Option<&'a lopdf::Dictionary> {
    doc.dereference(value).ok()?.1.as_dict().ok()
}

fn array<'a>(doc: &'a Document, value: &'a Object) -> Option<&'a Vec<Object>> {
    doc.dereference(value).ok()?.1.as_array().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::dictionary;

    /// Un documento con tre livelli: `a` acceso, `b` spento, `c` acceso ma
    /// spento a schermo dall'uso; `d` non è elencato.
    fn document() -> (Document, [ObjectId; 4]) {
        let mut doc = Document::with_version("1.7");
        let a =
            doc.add_object(dictionary! { "Type" => "OCG", "Name" => Object::string_literal("A") });
        let b =
            doc.add_object(dictionary! { "Type" => "OCG", "Name" => Object::string_literal("B") });
        let c = doc.add_object(dictionary! {
            "Type" => "OCG",
            "Usage" => dictionary! { "View" => dictionary! { "ViewState" => "OFF" } },
        });
        let d = doc.add_object(dictionary! { "Type" => "OCG" });
        let catalog = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "OCProperties" => dictionary! {
                "OCGs" => vec![a.into(), b.into(), c.into()],
                "D" => dictionary! { "OFF" => vec![b.into(), d.into()] },
            },
        });
        doc.trailer.set("Root", catalog);
        (doc, [a, b, c, d])
    }

    fn ocmd(doc: &mut Document, dict: lopdf::Dictionary) -> Object {
        let mut dict = dict;
        dict.set("Type", "OCMD");
        Object::Reference(doc.add_object(dict))
    }

    #[test]
    fn groups_follow_the_default_configuration_and_the_view_usage() {
        let (doc, [a, b, c, d]) = document();
        let layers = Layers::of(&doc);
        assert!(layers.visible(&doc, &Object::Reference(a)));
        assert!(!layers.visible(&doc, &Object::Reference(b)));
        assert!(!layers.visible(&doc, &Object::Reference(c)));
        // Un livello che l'elenco non ha si vede, anche se `/OFF` lo nomina.
        assert!(layers.visible(&doc, &Object::Reference(d)));
        assert!(layers.visible(&doc, &Object::Null));
        let hidden: Vec<ObjectId> = layers.hidden(&doc, [a, b, c, d].into_iter()).collect();
        assert_eq!(hidden, vec![b, c]);
    }

    #[test]
    fn the_base_state_off_hides_what_on_does_not_list() {
        let (mut doc, [a, b, ..]) = document();
        let root = doc.trailer.get(b"Root").unwrap().as_reference().unwrap();
        let catalog = doc.get_dictionary_mut(root).unwrap();
        catalog.set(
            "OCProperties",
            dictionary! {
                "OCGs" => vec![a.into(), b.into()],
                "D" => dictionary! { "BaseState" => "OFF", "ON" => vec![b.into()] },
            },
        );
        let layers = Layers::of(&doc);
        assert!(!layers.visible(&doc, &Object::Reference(a)));
        assert!(layers.visible(&doc, &Object::Reference(b)));
    }

    #[test]
    fn membership_policies_and_expressions_are_those_of_pdf_js() {
        let (mut doc, [a, b, c, d]) = document();
        let both = vec![Object::Reference(a), Object::Reference(b)];
        let cases = [
            (dictionary! { "OCGs" => both.clone() }, true),
            (
                dictionary! { "OCGs" => both.clone(), "P" => "AllOn" },
                false,
            ),
            (
                dictionary! { "OCGs" => both.clone(), "P" => "AnyOff" },
                true,
            ),
            (
                dictionary! { "OCGs" => both.clone(), "P" => "AllOff" },
                false,
            ),
            (dictionary! { "OCGs" => vec![b.into(), c.into()] }, false),
            // Un livello non elencato decide per «si vede».
            (
                dictionary! { "OCGs" => vec![b.into(), d.into()], "P" => "AllOn" },
                false,
            ),
            (
                dictionary! { "OCGs" => vec![d.into(), b.into()], "P" => "AllOn" },
                true,
            ),
            // Un elenco vuoto: nessuno acceso.
            (dictionary! { "OCGs" => Vec::<Object>::new() }, false),
            (dictionary! { "OCGs" => b }, false),
            (dictionary! { "P" => "AllOff" }, true),
            (dictionary! { "OCGs" => both.clone(), "P" => "Some" }, true),
            // L'espressione vince sull'elenco.
            (
                dictionary! { "OCGs" => both.clone(), "VE" => vec!["Not".into(), b.into()] },
                true,
            ),
            (
                dictionary! { "VE" => vec!["And".into(), a.into(), b.into()] },
                false,
            ),
            (
                dictionary! { "VE" => vec!["Or".into(), b.into(), vec!["Not".into(), c.into()].into()] },
                true,
            ),
            (
                dictionary! { "VE" => vec!["And".into(), a.into(), vec!["Xor".into(), b.into()].into()] },
                true,
            ),
            // Un operatore che non c'è lascia la parola all'elenco.
            (
                dictionary! { "VE" => vec!["Xor".into(), a.into()], "OCGs" => vec![b.into()] },
                false,
            ),
        ];
        let layers = Layers::of(&doc);
        for (dict, expected) in cases {
            let shown = format!("{dict:?}");
            let oc = ocmd(&mut doc, dict);
            assert_eq!(layers.visible(&doc, &oc), expected, "{shown}");
        }
    }

    #[test]
    fn a_deep_expression_reads_as_empty() {
        let (mut doc, [_, b, ..]) = document();
        let mut nested: Object = vec!["Not".into(), b.into()].into();
        for _ in 0..NESTING {
            nested = vec!["And".into(), nested].into();
        }
        let oc = ocmd(&mut doc, dictionary! { "VE" => nested });
        // Oltre il decimo livello l'espressione più interna è vuota, e vale
        // vera: `Not b` non si legge più.
        assert!(Layers::of(&doc).visible(&doc, &oc));
    }

    #[test]
    fn without_a_configuration_everything_is_visible() {
        let (mut doc, [_, b, ..]) = document();
        let root = doc.trailer.get(b"Root").unwrap().as_reference().unwrap();
        doc.get_dictionary_mut(root)
            .unwrap()
            .remove(b"OCProperties");
        assert!(Layers::of(&doc).visible(&doc, &Object::Reference(b)));
    }
}
