//! I conteggi dei tag del vault, mantenuti **incrementalmente** dentro le
//! stesse operazioni che aggiornano il grafo (`ingest`/`remove`/rename).
//!
//! Prima dello split della cache, [`IndexQuery::Tags`] rifaceva l'aggregazione
//! O(vault) a ogni interrogazione — e il pannello tag interroga a ogni
//! `IndexUpdated`, cioè a ogni salvataggio: un O(N) caldo istituzionalizzato.
//! Qui il costo si paga per-documento alla mutazione, come per il grafo, e la
//! lettura è la copia di una struttura già pronta. L'appartenenza di una nota
//! a una chiave è servita da un indice inverso (`per_chiave`), così anche
//! [`docs_with`](TagCounts::docs_with) non riscansiona il vault.
//!
//! La semantica è la stessa dell'aggregatore che rimpiazza (e l'oracolo nei
//! test è la sua riscrittura): la chiave è la forma canonica
//! ([`canonical_tag`]) — `#Rust` e `#rust` sono UNA voce; il conteggio è per
//! **note**, non occorrenze; il nome mostrato conserva il case e fra più
//! grafie vive vince la minore in ordine lessicografico (deterministico).
//!
//! [`IndexQuery::Tags`]: fub_abi::traits::IndexQuery::Tags

use std::collections::{BTreeMap, BTreeSet, HashMap};

use fub_abi::model::{canonical_tag, DocId, Tag};
use fub_abi::rules::tag::is_sub_tag;
use fub_abi::traits::TagCount;

/// Il contributo di una nota: chiave canonica → grafie con cui la scrive.
type Contribution = BTreeMap<String, BTreeSet<String>>;

#[derive(Default)]
pub(crate) struct TagCounts {
    /// chiave canonica → stato aggregato. `BTreeMap`: lo snapshot esce già
    /// ordinato per chiave canonica, come l'aggregatore che rimpiazza.
    keys: BTreeMap<String, KeyEntry>,
    /// nota → il suo contributo, per poterlo sottrarre a update/remove.
    docs: HashMap<DocId, Contribution>,
    /// chiave canonica → note che la portano: l'indice inverso che serve a
    /// [`docs_with`](TagCounts::docs_with) per rispondere senza riscansare il
    /// vault.
    for_key: HashMap<String, BTreeSet<DocId>>,
}

#[derive(Default)]
struct KeyEntry {
    /// grafia → numero di note che la scrivono così. Serve il conteggio, non
    /// solo l'insieme: quando l'ultima nota con `#Rust` lo perde, la grafia
    /// deve sparire dal display anche se la chiave `rust` resta viva.
    grafie: BTreeMap<String, u32>,
    /// Quante note portano la chiave (una volta per nota).
    notes: u32,
}

impl TagCounts {
    /// Registra (o aggiorna) il contributo di una nota.
    pub(crate) fn upsert(&mut self, id: &DocId, tags: &[Tag]) {
        self.upsert_names(id, tags.iter().map(|t| t.name.as_str()));
    }

    /// Come [`upsert`](TagCounts::upsert), dai soli **nomi**.
    ///
    /// È la porta da cui rientra ciò che l'anagrafe si è ricordata (§14.2): di
    /// una nota immutata il kernel non riapre il file, quindi non ha dei
    /// [`Tag`] con i loro span — ha i nomi, che è tutto ciò che questo
    /// aggregatore ha mai guardato.
    pub(crate) fn upsert_names<'a>(&mut self, id: &DocId, names: impl Iterator<Item = &'a str>) {
        self.remove(id);
        let mut contribution: Contribution = BTreeMap::new();
        for name in names {
            contribution
                .entry(canonical_tag(name))
                .or_default()
                .insert(name.to_string());
        }
        if contribution.is_empty() {
            return;
        }
        for (key, grafie) in &contribution {
            let entry = self.keys.entry(key.clone()).or_default();
            entry.notes += 1;
            for spelling in grafie {
                *entry.grafie.entry(spelling.clone()).or_default() += 1;
            }
            self.for_key
                .entry(key.clone())
                .or_default()
                .insert(id.clone());
        }
        self.docs.insert(id.clone(), contribution);
    }

    /// Sottrae il contributo di una nota. Idempotente.
    pub(crate) fn remove(&mut self, id: &DocId) {
        let Some(contribution) = self.docs.remove(id) else {
            return;
        };
        for (key, grafie) in contribution {
            if let Some(docs) = self.for_key.get_mut(&key) {
                docs.remove(id);
                if docs.is_empty() {
                    self.for_key.remove(&key);
                }
            }
            let Some(entry) = self.keys.get_mut(&key) else {
                continue;
            };
            entry.notes -= 1;
            for spelling in grafie {
                if let Some(n) = entry.grafie.get_mut(&spelling) {
                    *n -= 1;
                    if *n == 0 {
                        entry.grafie.remove(&spelling);
                    }
                }
            }
            if entry.notes == 0 {
                self.keys.remove(&key);
            }
        }
    }

    pub(crate) fn clear(&mut self) {
        self.keys.clear();
        self.docs.clear();
        self.for_key.clear();
    }

    /// Le **grafie** con cui una nota scrive i propri tag, in ordine.
    ///
    /// È il verso opposto di [`upsert_names`](TagCounts::upsert_names): serve a
    /// scrivere l'anagrafe, che di ogni documento ricorda ciò che servirebbe a
    /// riparlarne senza riaprirlo. Le grafie e non le chiavi canoniche, perché
    /// è la grafia che il pannello dei tag mostra.
    pub(crate) fn names_of(&self, id: &DocId) -> Vec<String> {
        self.docs
            .get(id)
            .map(|contribution| contribution.values().flatten().cloned().collect())
            .unwrap_or_default()
    }

    /// I tag del vault, ordinati per chiave canonica: la risposta a
    /// [`IndexQuery::Tags`](fub_abi::traits::IndexQuery::Tags).
    pub(crate) fn snapshot(&self) -> Vec<TagCount> {
        self.keys
            .values()
            .map(|entry| TagCount {
                name: entry
                    .grafie
                    .keys()
                    .next()
                    .expect("una chiave viva ha almeno una grafia")
                    .clone(),
                count: entry.notes,
            })
            .collect()
    }

    /// I tag di un **sottoinsieme** di documenti: le faccette di un risultato.
    ///
    /// Stesse regole dello snapshot intero (chiave canonica, conteggio per
    /// note, grafia minore fra quelle vive) applicate ai soli contributi dei
    /// documenti chiesti — è ciò che rende `Tags { matching }` una faccetta
    /// invece che una seconda aggregazione con una sua idea di cosa sia un tag.
    pub(crate) fn snapshot_of<'a>(&self, docs: impl Iterator<Item = &'a DocId>) -> Vec<TagCount> {
        let mut for_key: BTreeMap<String, (BTreeSet<String>, u32)> = BTreeMap::new();
        for doc in docs {
            let Some(contribution) = self.docs.get(doc) else {
                continue;
            };
            for (key, grafie) in contribution {
                let entry = for_key.entry(key.clone()).or_default();
                entry.0.extend(grafie.iter().cloned());
                entry.1 += 1;
            }
        }
        for_key
            .into_values()
            .map(|(grafie, count)| TagCount {
                name: grafie.first().expect("almeno una grafia").clone(),
                count,
            })
            .collect()
    }

    /// I documenti che portano una chiave canonica; con `descendants`, anche
    /// quelli che portano una sua sottochiave (`progetto` prende
    /// `progetto/casa`).
    pub(crate) fn docs_with(&self, canonical: &str, descendants: bool) -> Vec<DocId> {
        let mut found: BTreeSet<DocId> =
            self.for_key.get(canonical).cloned().unwrap_or_default();
        if descendants {
            for (key, docs) in &self.for_key {
                if is_sub_tag(key, canonical) {
                    found.extend(docs.iter().cloned());
                }
            }
        }
        found.into_iter().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::model::Span;

    fn tags(names: &[&str]) -> Vec<Tag> {
        names
            .iter()
            .map(|n| Tag {
                name: n.to_string(),
                span: Span::EMPTY,
            })
            .collect()
    }

    /// L'oracolo: l'aggregazione O(vault) che questa struttura rimpiazza,
    /// riscritta dal vivo sui contributi correnti.
    fn oracle(docs: &[(&DocId, Vec<Tag>)]) -> Vec<TagCount> {
        let mut for_key: BTreeMap<String, (BTreeSet<String>, u32)> = BTreeMap::new();
        for (_, doc_tags) in docs {
            let mut seen: BTreeSet<String> = BTreeSet::new();
            for tag in doc_tags {
                let key = canonical_tag(&tag.name);
                let first_time = seen.insert(key.clone());
                let entry = for_key.entry(key).or_default();
                entry.0.insert(tag.name.clone());
                if first_time {
                    entry.1 += 1;
                }
            }
        }
        for_key
            .into_values()
            .filter(|(_, count)| *count > 0)
            .map(|(grafie, count)| TagCount {
                name: grafie.first().expect("almeno una grafia").clone(),
                count,
            })
            .collect()
    }

    #[test]
    fn incremental_counts_match_the_full_scan_oracle_through_a_lifecycle() {
        let a = DocId::new("a.md");
        let b = DocId::new("b.md");
        let c = DocId::new("c.md");
        let mut counts = TagCounts::default();

        // Nasce, cambia, muore: dopo ogni mossa l'incrementale deve dire la
        // stessa cosa dell'oracolo.
        let mosse: Vec<Vec<(&DocId, Vec<Tag>)>> = vec![
            vec![(&a, tags(&["Rust", "rust", "note/idee"]))],
            vec![
                (&a, tags(&["Rust", "rust", "note/idee"])),
                (&b, tags(&["rust"])),
            ],
            // `a` perde la grafia maiuscola: il display deve seguirla.
            vec![(&a, tags(&["rust"])), (&b, tags(&["rust"]))],
            // `b` resta senza tag; entra `c`.
            vec![(&a, tags(&["rust"])), (&b, tags(&[])), (&c, tags(&["Zen"]))],
            // tutti spariscono.
            vec![],
        ];

        let mut live: Vec<&DocId> = Vec::new();
        for state in &mosse {
            // Porta la struttura allo stato voluto: upsert per chi c'è,
            // remove per chi non c'è più.
            for (id, doc_tags) in state {
                counts.upsert(id, doc_tags);
            }
            for id in live
                .iter()
                .filter(|id| !state.iter().any(|(s, _)| s == *id))
            {
                counts.remove(id);
            }
            live = state.iter().map(|(id, _)| *id).collect();

            assert_eq!(
                counts.snapshot(),
                oracle(state),
                "incremental and oracle diverge on state {state:?}"
            );
        }
    }

    #[test]
    fn a_rename_is_remove_plus_upsert_and_keeps_the_counts() {
        let before = DocId::new("prima.md");
        let after = DocId::new("cartella/dopo.md");
        let mut counts = TagCounts::default();
        counts.upsert(&before, &tags(&["Rust"]));

        counts.remove(&before);
        counts.upsert(&after, &tags(&["Rust"]));

        let snap = counts.snapshot();
        assert_eq!(snap.len(), 1);
        assert_eq!(snap[0].name, "Rust");
        assert_eq!(snap[0].count, 1, "the document is one, whatever its name");
    }

    #[test]
    fn removing_the_unknown_is_a_noop() {
        let mut counts = TagCounts::default();
        counts.remove(&DocId::new("mai-vista.md"));
        assert!(counts.snapshot().is_empty());
    }
}
