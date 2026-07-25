//! Le interrogazioni sul **frontmatter**: filtro, ordinamento, faccette.
//!
//! Il kernel il frontmatter di ogni nota ce l'ha già in cache (è metà dei
//! [`DocMeta`](crate::workspace)), e questo modulo è ciò che lo rende
//! interrogabile dal contratto — [`IndexQuery::Properties`] e
//! [`IndexQuery::PropertyValues`]. Da qui passano 9.1 (ricerca per campo e
//! faccette), 8.4 (collezioni), 11 (database su file), 16 (template con query):
//! senza, ognuna di quelle famiglie si scriverebbe il proprio giro sul JSON
//! grezzo, con la propria idea di cosa vuol dire "maggiore di".
//!
//! # Le regole, in un posto solo
//!
//! - **I valori sono quelli normalizzati** ([`PropertyValue`], §1.5): la data è
//!   una data, il `[[wikilink]]` è una relazione, il resto è JSON. Chi
//!   interroga non riparsa niente.
//! - **Specie diverse non si confrontano**: `>` fra un numero e un testo è
//!   *falso*, non un errore. Un vault vero ha frontmatter disomogeneo, e una
//!   query che morisse sulla prima nota scritta a mano sarebbe inutilizzabile.
//! - **Chi non ha la chiave finisce in fondo**, in entrambi i versi
//!   dell'ordinamento: è assente, non minimo. A parità vale l'ordine dei
//!   `DocId`, perché la risposta è paginata e senza un ordine totale la seconda
//!   pagina ripeterebbe la prima.
//! - **Un elenco conta per ognuno dei suoi elementi** nelle faccette
//!   (`autore: [a, b]` è una nota di `a` *e* una di `b`): è ciò che una
//!   faccetta deve fare, ed è la stessa regola dei tag.
//!
//! [`IndexQuery::Properties`]: fubmd_abi::traits::IndexQuery::Properties
//! [`IndexQuery::PropertyValues`]: fubmd_abi::traits::IndexQuery::PropertyValues

use std::cmp::Ordering;
use std::collections::BTreeMap;

use fubmd_abi::model::{DocId, Frontmatter, PropertyDate, PropertyScalar, PropertyValue};
use fubmd_abi::traits::{
    DocumentProperties, PropertyCount, PropertyEntry, PropertyFilter, PropertySort, PropertyTest,
};

/// I documenti che passano tutti i filtri, con le proprietà chieste.
///
/// `select` vuoto = tutto il frontmatter. L'ordine è quello di `sort` se c'è,
/// altrimenti quello dei `DocId`.
pub fn query<'a>(
    docs: impl Iterator<Item = (&'a DocId, &'a Frontmatter)>,
    filter: &[PropertyFilter],
    sort: Option<&PropertySort>,
    select: &[String],
) -> Vec<DocumentProperties> {
    let mut matching: Vec<(&DocId, &Frontmatter)> =
        docs.filter(|(_, fm)| matches(fm, filter)).collect();

    match sort {
        None => matching.sort_by_key(|(id, _)| *id),
        Some(sort) => matching.sort_by(|(a_id, a_fm), (b_id, b_fm)| {
            let a = a_fm.property(&sort.key);
            let b = b_fm.property(&sort.key);
            order_of(a.as_ref(), b.as_ref(), sort.descending).then_with(|| a_id.cmp(b_id))
        }),
    }

    matching
        .into_iter()
        .map(|(id, fm)| DocumentProperties {
            doc: id.clone(),
            properties: entries(fm, select),
        })
        .collect()
}

/// I valori distinti di una proprietà fra i documenti che passano i filtri, coi
/// rispettivi conteggi: le faccette. In ordine di frequenza decrescente, poi
/// per valore — l'ordine con cui una lista di faccette si mostra, e comunque
/// totale (serve alla paginazione).
pub fn facets<'a>(
    docs: impl Iterator<Item = (&'a DocId, &'a Frontmatter)>,
    key: &str,
    filter: &[PropertyFilter],
) -> Vec<PropertyCount> {
    // Chiave di raggruppamento: la serializzazione del valore normalizzato. Un
    // `PropertyValue` porta un `f64`, quindi non è `Hash` né `Ord`; la sua forma
    // JSON sì, ed è la stessa che attraversa il confine.
    let mut counts: BTreeMap<String, (PropertyValue, u32)> = BTreeMap::new();
    for (_, fm) in docs.filter(|(_, fm)| matches(fm, filter)) {
        let Some(value) = fm.property(key) else {
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

/// Il frontmatter passa **tutti** i filtri? (vuoto = sì)
fn matches(fm: &Frontmatter, filter: &[PropertyFilter]) -> bool {
    filter.iter().all(|f| test(fm, f))
}

fn test(fm: &Frontmatter, filter: &PropertyFilter) -> bool {
    let value = fm.property(&filter.key);
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

/// L'ordine fra due documenti secondo la chiave di ordinamento: chi non ha la
/// chiave, o ha un valore non confrontabile, finisce **in fondo** in entrambi i
/// versi.
fn order_of(a: Option<&PropertyValue>, b: Option<&PropertyValue>, descending: bool) -> Ordering {
    match (a, b) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(a), Some(b)) => match compare(a, b) {
            Some(ord) if descending => ord.reverse(),
            Some(ord) => ord,
            // Specie diverse: nessun ordine, e nessuna delle due "vince".
            None => Ordering::Equal,
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
            // fuso dell'utente, che è una capacità dell'host (§1.4).
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

/// Le proprietà da restituire, in ordine di chiave. `select` vuoto = tutte;
/// una chiave chiesta e assente non compare (l'assenza è un fatto, non un
/// valore da inventare).
fn entries(fm: &Frontmatter, select: &[String]) -> Vec<PropertyEntry> {
    let mut entries: Vec<PropertyEntry> = if select.is_empty() {
        fm.properties()
            .into_iter()
            .map(|(key, value)| PropertyEntry { key, value })
            .collect()
    } else {
        select
            .iter()
            .filter_map(|key| {
                fm.property(key).map(|value| PropertyEntry {
                    key: key.clone(),
                    value,
                })
            })
            .collect()
    };
    entries.sort_by(|a, b| a.key.cmp(&b.key));
    entries
}

#[cfg(test)]
mod tests {
    use super::*;
    use fubmd_abi::model::PropertyTime;

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

    fn ids(rows: &[DocumentProperties]) -> Vec<&str> {
        rows.iter().map(|r| r.doc.as_str()).collect()
    }

    fn run(
        filter: &[PropertyFilter],
        sort: Option<&PropertySort>,
        select: &[String],
    ) -> Vec<DocumentProperties> {
        let vault = vault();
        query(vault.iter().map(|(id, fm)| (id, fm)), filter, sort, select)
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
            &[],
        );
        assert_eq!(ids(&rows), vec!["b.md"]);

        let rows = run(&[filter("assente", PropertyTest::Missing)], None, &[]);
        assert_eq!(ids(&rows), vec!["a.md", "b.md", "c.md"]);

        let rows = run(
            &[filter(
                "assente",
                PropertyTest::NotEquals(PropertyValue::Text("x".into())),
            )],
            None,
            &[],
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
            &[],
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
            &[],
        );
        assert_eq!(ids(&rows), vec!["a.md"], "appartenenza all'elenco");

        let rows = run(
            &[filter(
                "peso",
                PropertyTest::Contains(PropertyScalar::Text("TAN".into())),
            )],
            None,
            &[],
        );
        assert_eq!(ids(&rows), vec!["c.md"], "sottostringa, maiuscole a parte");
    }

    #[test]
    fn a_missing_key_sorts_last_in_both_directions() {
        let sort = PropertySort {
            key: "autore".to_string(),
            descending: false,
        };
        let rows = run(&[], Some(&sort), &[]);
        assert_eq!(
            ids(&rows).last(),
            Some(&"c.md"),
            "c.md non ha `autore`: è assente, non minimo"
        );

        let sort = PropertySort {
            key: "autore".to_string(),
            descending: true,
        };
        let rows = run(&[], Some(&sort), &[]);
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
        let rows = run(&[], Some(&sort), &[]);
        assert_eq!(ids(&rows), vec!["c.md", "a.md", "b.md"], "idea < nota");
    }

    #[test]
    fn select_narrows_the_columns_and_absence_stays_absence() {
        let rows = run(
            &[filter("tipo", PropertyTest::Exists)],
            None,
            &["peso".to_string(), "assente".to_string()],
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
        let facets = facets(vault.iter().map(|(id, fm)| (id, fm)), "autore", &[]);
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

    #[test]
    fn facets_count_on_the_already_filtered_subset() {
        let vault = vault();
        let only_b = [filter(
            "peso",
            PropertyTest::GreaterThan(PropertyValue::Number(5.0)),
        )];
        let facets = facets(vault.iter().map(|(id, fm)| (id, fm)), "autore", &only_b);
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
}
