//! Le interrogazioni sul **frontmatter**: filtro, ordinamento, faccette — e la
//! composizione di una risposta a [`IndexQuery::Documents`].
//!
//! Chi interroga il frontmatter ce l'ha già normalizzato dal
//! `FormatProvider`, e questo modulo è ciò che lo rende interrogabile dal
//! contratto. Da qui passano 9.1 (ricerca per campo e faccette), 8.4
//! (collezioni), 11 (database su file), 16 (template con query): senza, ognuna
//! di quelle famiglie si scriverebbe il proprio giro sul JSON grezzo, con la
//! propria idea di cosa vuol dire "maggiore di".
//!
//! # Le regole, in un posto solo
//!
//! - **I valori sono quelli normalizzati** ([`PropertyValue`], decisione 0003): la data è
//!   una data, il `[[wikilink]]` è una relazione, il resto è JSON. Chi
//!   interroga non riparsa niente.
//! - **Specie diverse non si confrontano**: `>` fra un numero e un testo è
//!   *falso*, non un errore. Un vault vero ha frontmatter disomogeneo, e una
//!   query che morisse sulla prima nota scritta a mano sarebbe inutilizzabile.
//!   Nell'ordinamento, però, le specie si separano per **rango fisso** (come
//!   Excel: numero, data, bool, testo, link, elenco, unknown, vuoto): il rango
//!   non si ribalta col decrescente ([decisione 0155]). Un numero in una
//!   colonna di testi sta prima, non in fondo; un testo in una colonna di
//!   numeri sta dopo. Non è un pareggio che il `DocId` intercalerebbe.
//! - **Chi non ha la chiave finisce in fondo**, in entrambi i versi
//!   dell'ordinamento: è assente, non minimo. A parità vale l'ordine dei
//!   `DocId`, perché la risposta è paginata e senza un ordine totale la seconda
//!   pagina ripeterebbe la prima.
//! - **Un elenco conta per ognuno dei suoi elementi** nelle faccette
//!   (`autore: [a, b]` è una nota di `a` *e* una di `b`): è ciò che una
//!   faccetta deve fare, ed è la stessa regola dei tag.
//!
//! [`IndexQuery::Documents`]: crate::traits::IndexQuery::Documents
//! [decisione 0155]: ../../../docs/decisions/0155-fra-specie-diverse-decide-un-rango-fisso.md

use std::cmp::Ordering;
use std::collections::BTreeMap;

use crate::model::{DateFormats, DocId, Frontmatter, PropertyDate, PropertyScalar, PropertyValue};
use crate::query::Matches;
use crate::traits::{
    DocumentMatch, Page, Paged, PropertyCount, PropertyEntry, PropertyFilter, PropertySelect,
    PropertySort, PropertyTest,
};

/// I valori distinti di una proprietà fra i documenti che passano i filtri, coi
/// rispettivi conteggi: le faccette. In ordine di frequenza decrescente, poi
/// per valore — l'ordine con cui una lista di faccette si mostra, e comunque
/// totale (serve alla paginazione).
pub fn facets<'a>(
    docs: impl Iterator<Item = (&'a DocId, &'a Frontmatter)>,
    key: &str,
    formats: &DateFormats,
) -> Vec<PropertyCount> {
    // Chiave di raggruppamento: la serializzazione del valore normalizzato. Un
    // `PropertyValue` porta un `f64`, quindi non è `Hash` né `Ord`; la sua forma
    // JSON sì, ed è la stessa che attraversa il confine.
    let mut counts: BTreeMap<String, (PropertyValue, u32)> = BTreeMap::new();
    for (_, fm) in docs {
        let Some(value) = fm.property(key, formats) else {
            continue;
        };
        // Un elenco è una nota per ciascuno dei suoi elementi.
        let values: Vec<PropertyValue> = match value {
            PropertyValue::List(items) => items.into_iter().map(PropertyValue::from).collect(),
            single => vec![single],
        };
        for value in values {
            // Il `Debug` è la rete: se un valore non si serializzasse, due
            // valori diversi non devono finire nello stesso gruppo (il modo in
            // cui questo sbaglierebbe sarebbe muto — un conteggio plausibile e
            // falso). Che ogni variante attraversi il JSON è provato nell'abi.
            let group = serde_json::to_string(&value).unwrap_or_else(|_| format!("{value:?}"));
            let entry = counts.entry(group).or_insert((value, 0));
            entry.1 += 1;
        }
    }
    let mut facets: Vec<(String, PropertyValue, u32)> = counts
        .into_iter()
        .map(|(group, (value, count))| (group, value, count))
        .collect();
    facets.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| a.0.cmp(&b.0)));
    facets
        .into_iter()
        .map(|(_, value, count)| PropertyCount { value, count })
        .collect()
}

/// Il frontmatter passa questa prova?
///
/// È la foglia [`QueryPredicate::Property`](crate::query::QueryPredicate::Property)
/// valutata: prima era dentro un filtro in AND che solo questo modulo sapeva
/// applicare, adesso è una funzione che il linguaggio chiama una volta per
/// letterale — e l'AND, l'OR e la negazione stanno nel contratto.
pub fn test(fm: &Frontmatter, filter: &PropertyFilter, formats: &DateFormats) -> bool {
    let value = fm.property(&filter.key, formats);
    match (&filter.test, value) {
        (PropertyTest::Exists, v) => v.is_some(),
        (PropertyTest::Missing, v) => v.is_none(),
        // Una chiave assente non è uguale a niente e non è diversa da niente:
        // "diverso da X" su una nota che quella proprietà non ce l'ha è falso,
        // o `NotEquals` diventerebbe un modo obliquo di dire `Missing`.
        (_, None) => false,
        (PropertyTest::Equals(want), Some(got)) => got == *want,
        (PropertyTest::NotEquals(want), Some(got)) => got != *want,
        (PropertyTest::Contains(want), Some(got)) => contains(&got, want),
        (PropertyTest::GreaterThan(want), Some(got)) => {
            compare(&got, want) == Some(Ordering::Greater)
        }
        (PropertyTest::LessThan(want), Some(got)) => compare(&got, want) == Some(Ordering::Less),
    }
}

/// `contains`: elenco → appartenenza, testo → sottostringa (senza distinguere
/// maiuscole: chi filtra a mano non ricorda come aveva scritto il tag), resto →
/// uguaglianza.
fn contains(got: &PropertyValue, want: &PropertyScalar) -> bool {
    match got {
        PropertyValue::List(items) => items.contains(want),
        PropertyValue::Text(haystack) => match want {
            PropertyScalar::Text(needle) => haystack
                .to_lowercase()
                .contains(needle.to_lowercase().as_str()),
            other => *got == PropertyValue::from(other.clone()),
        },
        other => *other == PropertyValue::from(want.clone()),
    }
}

/// L'ordine fra due valori della stessa specie; `None` se non sono confrontabili.
fn compare(a: &PropertyValue, b: &PropertyValue) -> Option<Ordering> {
    use PropertyValue as V;
    match (a, b) {
        (V::Number(a), V::Number(b)) => a.partial_cmp(b),
        (V::Text(a), V::Text(b)) => Some(a.cmp(b)),
        (V::Bool(a), V::Bool(b)) => Some(a.cmp(b)),
        (V::Date(a), V::Date(b)) => Some(instant_of(a).cmp(&instant_of(b))),
        _ => None,
    }
}

/// Il rango fisso delle specie, come fa Excel: le categorie hanno un ordine
/// prestabilito che il decrescente **non ribalta** — solo dentro la stessa
/// specie il verso si inverte. Così l'ordinamento fra specie diverse è
/// totale e antisimmetrico, e i valori non confrontabili finiscono in fondo
/// in entrambi i versi invece di spararsi a caso come «pari».
///
/// L'ordine — numero, data, bool, testo, link, elenco, unknown, vuoto —
/// segue ciò che un utente si aspetta da un foglio: prima i numeri (che si
/// sommano), poi le date (che si contano), poi i booleani (vero prima di
/// falso), poi il testo, poi le relazioni, poi gli elenchi, e in fondo ciò
/// che non si è riusciti a normalizzare. È una convenzione di prodotto, non
/// una verità di natura: la [decisione 0005] dice «in fondo in entrambi i
/// versi» per chi **non ha la chiave**, e la [decisione 0155] fissa il rango
/// fra specie diverse perché `Equal` non era un ordine e `Greater` non era
/// antisimmetrico.
///
/// [decisione 0005]: ../../../docs/decisions/0005-canale-dati-verso-le-view.md
/// [decisione 0155]: ../../../docs/decisions/0155-fra-specie-diverse-decide-un-rango-fisso.md
fn species_rank(v: &PropertyValue) -> u8 {
    match v {
        PropertyValue::Number(_) => 0,
        PropertyValue::Date(_) => 1,
        PropertyValue::Bool(_) => 2,
        PropertyValue::Text(_) => 3,
        PropertyValue::Link(_) => 4,
        PropertyValue::List(_) => 5,
        PropertyValue::Unknown(_) => 6,
        PropertyValue::Empty => 7,
    }
}

/// L'ordine fra due documenti secondo la chiave di ordinamento: chi non ha la
/// chiave finisce **in fondo** in entrambi i versi. Fra specie diverse decide
/// il [rango fisso](`species_rank`), che non si ribalta col decrescente
/// ([decisione 0155]).
///
/// [decisione 0155]: ../../../docs/decisions/0155-fra-specie-diverse-decide-un-rango-fisso.md
pub fn order_of(
    a: Option<&PropertyValue>,
    b: Option<&PropertyValue>,
    descending: bool,
) -> Ordering {
    match (a, b) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(a), Some(b)) => match compare(a, b) {
            Some(ord) if descending => ord.reverse(),
            Some(ord) => ord,
            // Specie diverse: il rango fisso decide, e non si ribalta col
            // decrescente — come Excel. Solo dentro la stessa specie il verso
            // si inverte (gestito sopra da `ord.reverse()`).
            None => species_rank(a).cmp(&species_rank(b)),
        },
    }
}

/// Una data ridotta a un istante ordinabile: minuti da un'epoca qualunque, col
/// fuso applicato quando c'è.
///
/// Serve un istante e non la tupla (anno, mese, giorno, ora) perché applicare
/// un fuso può scavallare la mezzanotte, e due scritture dello stesso momento
/// (`2026-01-01T00:00+01:00` e `2025-12-31T23:00Z`) devono risultare uguali.
/// Un orario assente vale mezzanotte: la data nuda precede lo stesso giorno con
/// un'ora.
fn instant_of(d: &PropertyDate) -> i64 {
    let minutes_in_day = match d.time {
        None => 0,
        Some(t) => {
            let local = t.hour as i64 * 60 + t.minute as i64;
            // Senza fuso l'orario è "come era scritto": confrontarlo con uno che
            // il fuso ce l'ha è il meglio che si possa fare senza indovinare il
            // fuso dell'utente, che è una capacità dell'host (decisione 0013).
            local - t.offset_minutes.unwrap_or(0) as i64
        }
    };
    days_from_civil(d.year as i64, d.month, d.day) * 1440 + minutes_in_day
}

/// Giorni dall'epoca civile (algoritmo di Howard Hinnant): il calendario senza
/// dipendere da `chrono`, che nel kernel non c'è e per un confronto non serve.
fn days_from_civil(year: i64, month: u8, day: u8) -> i64 {
    let m = month.clamp(1, 12) as i64;
    let d = day.clamp(1, 31) as i64;
    let y = year - if m <= 2 { 1 } else { 0 };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Le proprietà da restituire, in ordine di chiave. Una chiave chiesta e
/// assente non compare: l'assenza è un fatto, non un valore da inventare.
pub fn entries(
    fm: &Frontmatter,
    select: &PropertySelect,
    formats: &DateFormats,
) -> Vec<PropertyEntry> {
    let select = match select {
        PropertySelect::None => return Vec::new(),
        PropertySelect::All => None,
        PropertySelect::Keys { keys } => Some(keys),
    };
    let mut entries: Vec<PropertyEntry> = match select {
        None => fm
            .properties(formats)
            .into_iter()
            .map(|(key, value)| PropertyEntry { key, value })
            .collect(),
        Some(keys) => keys
            .iter()
            .filter_map(|key| {
                fm.property(key, formats).map(|value| PropertyEntry {
                    key: key.clone(),
                    value,
                })
            })
            .collect(),
    };
    entries.sort_by(|a, b| a.key.cmp(&b.key));
    entries
}

/// Impagina, ordina e completa una risposta a
/// [`IndexQuery::Documents`](crate::traits::IndexQuery::Documents).
///
/// È la coda comune a **chiunque** serva quella famiglia: il pianificatore del
/// kernel quando ricompone, l'indice del kernel quando la domanda gli arriva
/// intera, e il primo indice di terzi che la rivendicherà. Tre implementazioni
/// divergerebbero sul caso che nessuno prova — l'ordine di chi non ha la chiave
/// di ordinamento, quello fra due documenti a pari rilevanza — e la divergenza
/// sarebbe muta: due risposte plausibili alla stessa domanda, che nessun test
/// confronta perché i tre non si vedono fra loro.
///
/// `frontmatter` è come si legge il frontmatter di un documento: chi non ce
/// l'ha in cache restituisce `None`, e ordinamento e colonne si comportano come
/// per una chiave assente.
pub fn finish<'a>(
    matches: Matches,
    sort: Option<&PropertySort>,
    select: &PropertySelect,
    page: Option<Page>,
    formats: &DateFormats,
    frontmatter: impl Fn(&DocId) -> Option<&'a Frontmatter>,
) -> Paged<DocumentMatch> {
    let mut rows = matches.into_vec();

    if !select.is_none() {
        for row in rows.iter_mut() {
            if let Some(fm) = frontmatter(&row.doc) {
                row.properties = entries(fm, select, formats);
            }
        }
    }

    match sort {
        // Senza chiave: prima la rilevanza (chi ha cercato si aspetta i
        // risultati migliori in cima), poi l'id. Chi non ha rilevanza va in
        // fondo, come chi non ha la chiave di ordinamento.
        None => rows.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(Ordering::Equal)
                .then_with(|| a.doc.cmp(&b.doc))
        }),
        Some(sort) => rows.sort_by(|a, b| {
            let av = frontmatter(&a.doc).and_then(|fm| fm.property(&sort.key, formats));
            let bv = frontmatter(&b.doc).and_then(|fm| fm.property(&sort.key, formats));
            order_of(av.as_ref(), bv.as_ref(), sort.descending).then_with(|| a.doc.cmp(&b.doc))
        }),
    }

    Paged::window(rows, page)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{DateOrder, PropertyTime};

    fn fm(json: serde_json::Value) -> Frontmatter {
        Frontmatter(json.as_object().expect("oggetto").clone())
    }

    /// Tre note con frontmatter disomogeneo — che è il caso normale.
    fn vault() -> Vec<(DocId, Frontmatter)> {
        vec![
            (
                DocId::new("a.md"),
                fm(serde_json::json!({"tipo": "nota", "peso": 3, "autore": ["mario", "lucia"]})),
            ),
            (
                DocId::new("b.md"),
                fm(serde_json::json!({"tipo": "nota", "peso": 10, "autore": "mario"})),
            ),
            (
                DocId::new("c.md"),
                fm(serde_json::json!({"tipo": "idea", "peso": "tanto"})),
            ),
        ]
    }

    fn ids(rows: &[DocumentMatch]) -> Vec<&str> {
        rows.iter().map(|r| r.doc.as_str()).collect()
    }

    /// Il giro completo come lo fa il kernel: i filtri sono letterali in AND
    /// (valutati da [`test`]), e ordine, colonne e finestra li mette [`finish`].
    /// Passa da lì e non da una composizione locale perché è **quella** la
    /// composizione che gira in produzione.
    fn run(
        filter: &[PropertyFilter],
        sort: Option<&PropertySort>,
        select: &PropertySelect,
    ) -> Vec<DocumentMatch> {
        let vault = vault();
        let matches: Matches = vault
            .iter()
            .filter(|(_, fm)| filter.iter().all(|f| test(fm, f, &DateFormats::ISO)))
            .map(|(id, _)| DocumentMatch::of(id.clone()))
            .collect();
        finish(matches, sort, select, None, &DateFormats::ISO, |id| {
            vault
                .iter()
                .find(|(other, _)| other == id)
                .map(|(_, fm)| fm)
        })
        .items
    }

    /// Ordina un vault per una chiave, nei due versi. Serve ai banchi che
    /// montano un vault loro invece di quello di [`run`].
    fn ordine_di(vault: &[(DocId, Frontmatter)], key: &str, descending: bool) -> Vec<String> {
        let sort = PropertySort {
            key: key.to_string(),
            descending,
        };
        let matches: Matches = vault
            .iter()
            .map(|(id, _)| DocumentMatch::of(id.clone()))
            .collect();
        finish(
            matches,
            Some(&sort),
            &PropertySelect::None,
            None,
            &DateFormats::ISO,
            |id| {
                vault
                    .iter()
                    .find(|(other, _)| other == id)
                    .map(|(_, fm)| fm)
            },
        )
        .items
        .iter()
        .map(|r| r.doc.as_str().to_string())
        .collect()
    }

    fn filter(key: &str, test: PropertyTest) -> PropertyFilter {
        PropertyFilter {
            key: key.to_string(),
            test,
        }
    }

    #[test]
    fn filters_are_in_and_and_a_missing_key_never_matches() {
        let rows = run(
            &[
                filter(
                    "tipo",
                    PropertyTest::Equals(PropertyValue::Text("nota".into())),
                ),
                filter(
                    "peso",
                    PropertyTest::GreaterThan(PropertyValue::Number(5.0)),
                ),
            ],
            None,
            &PropertySelect::None,
        );
        assert_eq!(ids(&rows), vec!["b.md"]);

        let rows = run(
            &[filter("assente", PropertyTest::Missing)],
            None,
            &PropertySelect::None,
        );
        assert_eq!(ids(&rows), vec!["a.md", "b.md", "c.md"]);

        let rows = run(
            &[filter(
                "assente",
                PropertyTest::NotEquals(PropertyValue::Text("x".into())),
            )],
            None,
            &PropertySelect::None,
        );
        assert!(
            rows.is_empty(),
            "una chiave assente non è «diversa da»: sarebbe Missing per vie traverse"
        );
    }

    #[test]
    fn comparing_different_species_is_false_not_an_error() {
        // `peso: "tanto"` su c.md: il confronto con un numero non ha senso e la
        // nota semplicemente non passa il filtro.
        let rows = run(
            &[filter(
                "peso",
                PropertyTest::LessThan(PropertyValue::Number(5.0)),
            )],
            None,
            &PropertySelect::None,
        );
        assert_eq!(ids(&rows), vec!["a.md"]);
    }

    #[test]
    fn contains_looks_inside_a_list_and_inside_a_text() {
        let rows = run(
            &[filter(
                "autore",
                PropertyTest::Contains(PropertyScalar::Text("lucia".into())),
            )],
            None,
            &PropertySelect::None,
        );
        assert_eq!(ids(&rows), vec!["a.md"], "appartenenza all'elenco");

        let rows = run(
            &[filter(
                "peso",
                PropertyTest::Contains(PropertyScalar::Text("TAN".into())),
            )],
            None,
            &PropertySelect::None,
        );
        assert_eq!(ids(&rows), vec!["c.md"], "sottostringa, maiuscole a parte");
    }

    #[test]
    fn a_missing_key_sorts_last_in_both_directions() {
        let sort = PropertySort {
            key: "autore".to_string(),
            descending: false,
        };
        let rows = run(&[], Some(&sort), &PropertySelect::None);
        assert_eq!(
            ids(&rows).last(),
            Some(&"c.md"),
            "c.md non ha `autore`: è assente, non minimo"
        );

        let sort = PropertySort {
            key: "autore".to_string(),
            descending: true,
        };
        let rows = run(&[], Some(&sort), &PropertySelect::None);
        assert_eq!(ids(&rows).last(), Some(&"c.md"));
    }

    #[test]
    fn sorting_is_total_so_a_page_never_repeats_itself() {
        // `tipo` vale "nota" per due note: senza il DocId a rompere la parità
        // l'ordine dipenderebbe da come sono arrivate.
        let sort = PropertySort {
            key: "tipo".to_string(),
            descending: false,
        };
        let rows = run(&[], Some(&sort), &PropertySelect::None);
        assert_eq!(ids(&rows), vec!["c.md", "a.md", "b.md"], "idea < nota");
    }

    #[test]
    fn diverse_species_sort_by_fixed_rank_in_both_directions() {
        // Come Excel: le specie hanno un rango fisso (numero < data < bool <
        // testo < link < elenco < unknown < vuoto), e il rango **non si
        // ribalta** col decrescente — solo dentro la stessa specie il verso
        // si inverte. Così l'ordinamento è totale e antisimmetrico.
        let num = PropertyValue::Number(3.0);
        let txt = PropertyValue::Text("x".into());
        // Crescente: il numero viene prima del testo.
        assert_eq!(
            order_of(Some(&num), Some(&txt), false),
            Ordering::Less,
            "numero prima di testo, crescente"
        );
        assert_eq!(
            order_of(Some(&txt), Some(&num), false),
            Ordering::Greater,
            "testo dopo numero, crescente — antisimmetrico"
        );
        // Decrescente: il rango non si ribalta, il numero resta prima.
        assert_eq!(
            order_of(Some(&num), Some(&txt), true),
            Ordering::Less,
            "numero prima di testo anche al decrescente: il rango fisso non si ribalta"
        );
        assert_eq!(
            order_of(Some(&txt), Some(&num), true),
            Ordering::Greater,
            "testo dopo numero anche al decrescente — antisimmetrico"
        );
    }

    #[test]
    fn a_text_in_a_number_column_sorts_last_in_both_directions() {
        // Lo scenario di issues.md §12: un testo sporco in una colonna di
        // numeri. Il rango mette il testo dopo i numeri in entrambi i versi,
        // e l'assente ancora dopo — sul caso che il difetto misurava, Excel
        // e «in fondo» coincidono.
        let vault = vec![
            (DocId::new("a.md"), fm(serde_json::json!({"peso": "tanto"}))),
            (DocId::new("b.md"), fm(serde_json::json!({"peso": 3}))),
            (DocId::new("c.md"), fm(serde_json::json!({"peso": 10}))),
            (DocId::new("d.md"), fm(serde_json::json!({}))),
        ];
        assert_eq!(
            ordine_di(&vault, "peso", false),
            vec!["b.md", "c.md", "a.md", "d.md"],
            "crescente: 3, 10, poi il testo, poi l'assente"
        );
        assert_eq!(
            ordine_di(&vault, "peso", true),
            vec!["c.md", "b.md", "a.md", "d.md"],
            "decrescente: 10, 3, poi il testo, poi l'assente — il rango non si ribalta"
        );
    }

    #[test]
    fn a_number_in_a_text_column_sorts_first_not_last() {
        // La differenza fra Excel e la specie di riferimento: un numero
        // sporco in una colonna di testi sta *prima*, non in fondo. È la
        // scelta che la 0155 ratifica.
        let vault = vec![
            (
                DocId::new("a.md"),
                fm(serde_json::json!({"titolo": "zeta"})),
            ),
            (DocId::new("b.md"), fm(serde_json::json!({"titolo": 1}))),
        ];
        assert_eq!(
            ordine_di(&vault, "titolo", false),
            vec!["b.md", "a.md"],
            "il numero sta in testa anche se la colonna è di testi"
        );
        assert_eq!(
            ordine_di(&vault, "titolo", true),
            vec!["b.md", "a.md"],
            "il rango non si ribalta: il numero resta in testa"
        );
    }

    #[test]
    fn order_of_is_antisymmetric_for_every_pair() {
        let data = PropertyValue::Date(PropertyDate {
            year: 2026,
            month: 1,
            day: 1,
            time: None,
        });
        let samples: [Option<PropertyValue>; 8] = [
            None,
            Some(PropertyValue::Number(1.0)),
            Some(data),
            Some(PropertyValue::Bool(true)),
            Some(PropertyValue::Text("x".into())),
            Some(PropertyValue::List(vec![])),
            Some(PropertyValue::Unknown(serde_json::json!({}))),
            Some(PropertyValue::Empty),
        ];
        for descending in [false, true] {
            for a in &samples {
                for b in &samples {
                    let ab = order_of(a.as_ref(), b.as_ref(), descending);
                    let ba = order_of(b.as_ref(), a.as_ref(), descending);
                    assert_eq!(
                        ab,
                        ba.reverse(),
                        "antisimmetria rotta: {a:?} vs {b:?}, descending={descending}"
                    );
                }
            }
        }
    }

    #[test]
    fn select_narrows_the_columns_and_absence_stays_absence() {
        let rows = run(
            &[filter("tipo", PropertyTest::Exists)],
            None,
            &PropertySelect::keys(&["peso", "assente"]),
        );
        let keys: Vec<&str> = rows[0].properties.iter().map(|p| p.key.as_str()).collect();
        assert_eq!(
            keys,
            vec!["peso"],
            "la chiave chiesta e assente non compare"
        );
    }

    #[test]
    fn a_facet_counts_every_element_of_a_list() {
        let vault = vault();
        let facets = facets(
            vault.iter().map(|(id, fm)| (id, fm)),
            "autore",
            &DateFormats::ISO,
        );
        let seen: Vec<(String, u32)> = facets
            .iter()
            .map(|f| match &f.value {
                PropertyValue::Text(t) => (t.clone(), f.count),
                other => (format!("{other:?}"), f.count),
            })
            .collect();
        assert_eq!(
            seen,
            vec![("mario".to_string(), 2), ("lucia".to_string(), 1)],
            "mario due volte (una in un elenco, una da solo), per frequenza"
        );
    }

    /// Le faccette si contano sul **sottoinsieme già selezionato**, o la
    /// navigazione per faccette non converge mai. Chi seleziona non è più un
    /// campo `filter` di questa funzione: è l'espressione della query, e a
    /// valutarla è chi la possiede — qui il sottoinsieme arriva già scelto.
    #[test]
    fn facets_count_on_the_already_selected_subset() {
        let vault = vault();
        let only_b = [filter(
            "peso",
            PropertyTest::GreaterThan(PropertyValue::Number(5.0)),
        )];
        let selected = vault
            .iter()
            .filter(|(_, fm)| only_b.iter().all(|f| test(fm, f, &DateFormats::ISO)))
            .map(|(id, fm)| (id, fm));
        let facets = facets(selected, "autore", &DateFormats::ISO);
        assert_eq!(facets.len(), 1);
        assert_eq!(facets[0].count, 1, "solo b.md è nel sottoinsieme");
    }

    #[test]
    fn the_same_instant_written_in_two_time_zones_is_the_same_instant() {
        let midnight_rome = PropertyDate {
            year: 2026,
            month: 1,
            day: 1,
            time: Some(PropertyTime {
                hour: 0,
                minute: 0,
                second: 0,
                offset_minutes: Some(60),
            }),
        };
        let eleven_utc = PropertyDate {
            year: 2025,
            month: 12,
            day: 31,
            time: Some(PropertyTime {
                hour: 23,
                minute: 0,
                second: 0,
                offset_minutes: Some(0),
            }),
        };
        assert_eq!(
            compare(
                &PropertyValue::Date(midnight_rome),
                &PropertyValue::Date(eleven_utc)
            ),
            Some(Ordering::Equal),
            "il fuso scavalla la mezzanotte: senza istante, il confronto mentirebbe"
        );
    }

    /// **Il difetto intero, in un banco.** Un vault misto — metà note in ISO,
    /// metà no, cioè lo stato normale di una migrazione — e le tre domande che
    /// 8.2 fa su una data. Senza dichiarazione tutte e tre rispondono male, e
    /// nessuna delle tre lo dice: il filtro non trova, la faccetta conta due
    /// giorni dove ce n'è uno, l'ordinamento separa le specie per rango fisso
    /// (la data prima dei testi) ma dentro i testi l'ordine è lessicale, non
    /// cronologico — plausibile, e sbagliato.
    #[test]
    fn a_mixed_vault_answers_wrong_and_says_nothing_until_the_format_is_declared() {
        let misto = vec![
            (
                DocId::new("a.md"),
                fm(serde_json::json!({"q": "2026-07-05"})),
            ),
            (DocId::new("b.md"), fm(serde_json::json!({"q": "5/7/2026"}))),
            (DocId::new("c.md"), fm(serde_json::json!({"q": "1/1/2020"}))),
        ];
        let dopo = filter(
            "q",
            PropertyTest::GreaterThan(PropertyValue::Date(PropertyDate {
                year: 2026,
                month: 1,
                day: 1,
                time: None,
            })),
        );
        let passano = |formats: &DateFormats| -> Vec<&str> {
            misto
                .iter()
                .filter(|(_, fm)| test(fm, &dopo, formats))
                .map(|(id, _)| id.as_str())
                .collect()
        };
        assert_eq!(
            passano(&DateFormats::ISO),
            vec!["a.md"],
            "`b.md` è del cinque luglio e il filtro non la trova: per `compare`              un testo e una data non sono confrontabili, e non confrontabile              vale falso"
        );
        let dmy = DateFormats::declaring(DateOrder::Dmy);
        assert_eq!(passano(&dmy), vec!["a.md", "b.md"]);

        // La faccetta: lo stesso giorno scritto in due modi conta due volte.
        let conta = |formats: &DateFormats| {
            facets(misto.iter().map(|(id, fm)| (id, fm)), "q", formats).len()
        };
        assert_eq!(conta(&DateFormats::ISO), 3);
        let mut uguali = misto.clone();
        uguali[1].1 = fm(serde_json::json!({"q": "5/7/2026"}));
        assert_eq!(
            facets(uguali.iter().map(|(id, fm)| (id, fm)), "q", &dmy).len(),
            2,
            "col formato dichiarato `2026-07-05` e `5/7/2026` sono lo stesso              giorno, quindi la stessa faccetta"
        );

        let per_data = PropertySort {
            key: "q".into(),
            descending: false,
        };
        let ordine = |formats: &DateFormats| -> Vec<String> {
            let matches: Matches = misto
                .iter()
                .map(|(id, _)| DocumentMatch::of(id.clone()))
                .collect();
            finish(
                matches,
                Some(&per_data),
                &PropertySelect::None,
                None,
                formats,
                |id| {
                    misto
                        .iter()
                        .find(|(other, _)| other == id)
                        .map(|(_, fm)| fm)
                },
            )
            .items
            .iter()
            .map(|r| r.doc.as_str().to_string())
            .collect()
        };
        // L'ordinamento: senza dichiarazione le due specie non si
        // confrontano, ma il rango fisso le separa — la `Date` (rango 1)
        // prima dei `Text` (rango 3), che a loro volta si ordinano fra loro
        // come stringhe. È totale e deterministico, anche se la risposta è
        // sbagliata (le date non dichiarate restano testo, e il 2020 finisce
        // dopo il 2026 per via del rango, non del valore).
        assert_eq!(ordine(&DateFormats::ISO), vec!["a.md", "c.md", "b.md"]);
        assert_eq!(
            order_of(
                Some(&PropertyValue::Text("1/1/2020".into())),
                Some(&PropertyValue::Date(PropertyDate {
                    year: 2026,
                    month: 7,
                    day: 5,
                    time: None,
                })),
                false
            ),
            Ordering::Greater,
            "una data (rango 1) viene prima di un testo (rango 3): il rango \
             fisso separa le specie invece di dirle «pari»"
        );
        assert_eq!(
            ordine(&dmy),
            vec!["c.md", "a.md", "b.md"],
            "il 2020 prima del cinque luglio 2026, che è la risposta vera"
        );
    }
}
