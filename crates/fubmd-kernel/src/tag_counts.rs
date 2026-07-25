//! I conteggi dei tag del vault, mantenuti **incrementalmente** dentro le
//! stesse operazioni che aggiornano il grafo (`ingest`/`remove`/rename).
//!
//! Prima dello split della cache, [`IndexQuery::Tags`] rifaceva l'aggregazione
//! O(vault) a ogni interrogazione — e il pannello tag interroga a ogni
//! `IndexUpdated`, cioè a ogni salvataggio: un O(N) caldo istituzionalizzato.
//! Qui il costo si paga per-documento alla mutazione, come per il grafo, e la
//! lettura è la copia di una struttura già pronta.
//!
//! La semantica è la stessa dell'aggregatore che rimpiazza (e l'oracolo nei
//! test è la sua riscrittura): la chiave è la forma canonica
//! ([`canonical_tag`]) — `#Rust` e `#rust` sono UNA voce; il conteggio è per
//! **note**, non occorrenze; il nome mostrato conserva il case e fra più
//! grafie vive vince la minore in ordine lessicografico (deterministico).
//!
//! [`IndexQuery::Tags`]: fubmd_abi::traits::IndexQuery::Tags

use std::collections::{BTreeMap, BTreeSet, HashMap};

use fubmd_abi::model::{canonical_tag, DocId, Tag};
use fubmd_abi::traits::TagCount;

/// Il contributo di una nota: chiave canonica → grafie con cui la scrive.
type Contribution = BTreeMap<String, BTreeSet<String>>;

#[derive(Default)]
pub(crate) struct TagCounts {
    /// chiave canonica → stato aggregato. `BTreeMap`: lo snapshot esce già
    /// ordinato per chiave canonica, come l'aggregatore che rimpiazza.
    keys: BTreeMap<String, KeyEntry>,
    /// nota → il suo contributo, per poterlo sottrarre a update/remove.
    docs: HashMap<DocId, Contribution>,
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
        self.remove(id);
        if tags.is_empty() {
            return;
        }
        let mut contribution: Contribution = BTreeMap::new();
        for tag in tags {
            contribution
                .entry(canonical_tag(&tag.name))
                .or_default()
                .insert(tag.name.clone());
        }
        for (key, grafie) in &contribution {
            let entry = self.keys.entry(key.clone()).or_default();
            entry.notes += 1;
            for grafia in grafie {
                *entry.grafie.entry(grafia.clone()).or_default() += 1;
            }
        }
        self.docs.insert(id.clone(), contribution);
    }

    /// Sottrae il contributo di una nota. Idempotente.
    pub(crate) fn remove(&mut self, id: &DocId) {
        let Some(contribution) = self.docs.remove(id) else {
            return;
        };
        for (key, grafie) in contribution {
            let Some(entry) = self.keys.get_mut(&key) else {
                continue;
            };
            entry.notes -= 1;
            for grafia in grafie {
                if let Some(n) = entry.grafie.get_mut(&grafia) {
                    *n -= 1;
                    if *n == 0 {
                        entry.grafie.remove(&grafia);
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
    }

    /// I tag del vault, ordinati per chiave canonica: la risposta a
    /// [`IndexQuery::Tags`](fubmd_abi::traits::IndexQuery::Tags).
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use fubmd_abi::model::Span;

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
        let mut per_key: BTreeMap<String, (BTreeSet<String>, u32)> = BTreeMap::new();
        for (_, doc_tags) in docs {
            let mut seen: BTreeSet<String> = BTreeSet::new();
            for tag in doc_tags {
                let key = canonical_tag(&tag.name);
                let prima_volta = seen.insert(key.clone());
                let entry = per_key.entry(key).or_default();
                entry.0.insert(tag.name.clone());
                if prima_volta {
                    entry.1 += 1;
                }
            }
        }
        per_key
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

        let mut vivi: Vec<&DocId> = Vec::new();
        for stato in &mosse {
            // Porta la struttura allo stato voluto: upsert per chi c'è,
            // remove per chi non c'è più.
            for (id, doc_tags) in stato {
                counts.upsert(id, doc_tags);
            }
            for id in vivi
                .iter()
                .filter(|id| !stato.iter().any(|(s, _)| s == *id))
            {
                counts.remove(id);
            }
            vivi = stato.iter().map(|(id, _)| *id).collect();

            assert_eq!(
                counts.snapshot(),
                oracle(stato),
                "incrementale e oracolo divergono sullo stato {stato:?}"
            );
        }
    }

    #[test]
    fn a_rename_is_remove_plus_upsert_and_keeps_the_counts() {
        let prima = DocId::new("prima.md");
        let dopo = DocId::new("cartella/dopo.md");
        let mut counts = TagCounts::default();
        counts.upsert(&prima, &tags(&["Rust"]));

        counts.remove(&prima);
        counts.upsert(&dopo, &tags(&["Rust"]));

        let snap = counts.snapshot();
        assert_eq!(snap.len(), 1);
        assert_eq!(snap[0].name, "Rust");
        assert_eq!(snap[0].count, 1, "la nota è una, comunque si chiami");
    }

    #[test]
    fn removing_the_unknown_is_a_noop() {
        let mut counts = TagCounts::default();
        counts.remove(&DocId::new("mai-vista.md"));
        assert!(counts.snapshot().is_empty());
    }
}
