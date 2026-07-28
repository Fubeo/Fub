//! L'**organizzazione** di un vault: icone, note appuntate, ordinamenti scelti a
//! mano, spazi (§11.3).
//!
//! # Cos'è, e cosa non è
//!
//! Sono i dati che dicono **come questo vault si presenta**: l'emoji accanto a
//! una nota, le note tenute in cima, l'ordine in cui i figli di una cartella si
//! vedono quando non è quello alfabetico, e quali cartelle sono «spazi». Vivono
//! in `.fubmd/workspace.json`, **dentro il vault**, e ci restano: a differenza
//! dello stato di vista (§11.2) questo *viaggia col vault* — chi sincronizza le
//! sue note si porta dietro anche il modo in cui le ha messe in ordine, e chi
//! passa un vault a un collega gli passa un vault organizzato.
//!
//! Sono **autorevoli e non derivati**, che è la riga da cui discende tutto il
//! resto: persi, non si ricostruiscono da niente. Un `.fubmd-data/` si può
//! cancellare e si rifà con una scansione; questo no. Per questo il file ha la
//! stessa disciplina della configurazione ([decisione 0036](../../../docs/decisions/0036-le-impostazioni-e-i-tre-stati.md)):
//! versione di schema, scrittura atomica, e un file che non si è potuto leggere
//! **non si riscrive**.
//!
//! # Le chiavi sono path, ed è la ragione per cui la migrazione è del kernel
//!
//! Ogni chiave qui è un path relativo al vault: un [`DocId`](crate::model::DocId)
//! per le note, un path di cartella senza slash finale per le cartelle (`""` è
//! la radice). Il path **è** l'identità di un documento (§13.1), quindi
//! rinominare una nota cambia la chiave sotto ognuna di queste mappe — e chi non
//! la migra lascia un'icona attaccata a un path che non esiste più.
//!
//! Che a migrarla sia il kernel non è una scelta di comodo: è l'unico che vede
//! *tutte* le rinomine, comprese quelle fatte da un'altra app a FubMD aperto (il
//! rilevatore le riconosce e chiama `sync_renamed_path`). La migrazione sta
//! dentro l'operazione che sposta l'identità e non sull'evento `DocumentRenamed`,
//! perché la coda degli eventi ha un budget e può troncare
//! ([decisione 0034](../../../docs/decisions/0034-il-freno-e-il-raggruppamento.md)):
//! un dato autorevole non può dipendere da una consegna che è dichiaratamente
//! best-effort.
//!
//! # Cosa NON sta qui
//!
//! **Quale** spazio è selezionato. È stato di vista, per-macchina (§11.2): due
//! computer che aprono lo stesso vault possono guardare due spazi diversi, e uno
//! che si portasse dietro il proprio farebbe litigare il secondo. Il confine fra
//! i due file passa esattamente lì: `spaces` è *quali cartelle sono spazi* (una
//! decisione sul vault, che viaggia), lo spazio attivo è *dove sto guardando
//! adesso* (una condizione della macchina, che non viaggia).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// L'organizzazione di un vault, come risponde
/// [`IndexQuery::Organization`](crate::traits::IndexQuery::Organization).
///
/// Si chiamava `WorkspaceMeta` quando viveva nell'host. Il nome è cambiato
/// salendo nel contratto perché nel kernel `Workspace` è **un'altra cosa** — il
/// vault montato, con i suoi indici e i suoi provider — e due tipi vicini che
/// dicono «workspace» intendendo l'uno il vault aperto e l'altro le sue icone
/// sono il genere di vicinanza che si legge male una volta sola, e poi si
/// ricopia.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Organization {
    /// path → emoji mostrata accanto al nome.
    #[serde(default)]
    pub icons: BTreeMap<String, String>,
    /// Note appuntate in cima alla sidebar, nell'ordine scelto.
    #[serde(default)]
    pub pinned: Vec<String>,
    /// cartella → nomi dei figli nell'ordine scelto a mano; chi non compare
    /// segue in ordine alfabetico.
    #[serde(default)]
    pub order: BTreeMap<String, Vec<String>>,
    /// Cartelle registrate come «spazi»: la striscia di icone in cima alla
    /// sidebar, nell'ordine in cui appaiono. **Quale** sia selezionato non sta
    /// qui: è stato di vista (§11.2).
    #[serde(default)]
    pub spaces: Vec<String>,
}
