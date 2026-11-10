//! L'anagrafe dei nomi: la risoluzione di un link fra le voci del vault e
//! `EntryNames`, con i suoi attrezzi sui path.

use super::*;

/// Il **file** che un path nomina dentro un'anagrafe, se c'è — di qualunque
/// specie (§14.1).
///
/// Funzione libera e non metodo perché il suo cliente non è solo l'indice: la
/// usa il controllo di salute, che riceve l'anagrafe e non chi la tiene.
pub(crate) fn resolve_entry_in(
    entries: &BTreeMap<DocId, VaultEntry>,
    names: &EntryNames,
    source: &DocId,
    target: &LinkTarget,
) -> Option<DocId> {
    resolve_entry_in_folder(entries, names, source, target, None)
}

/// Come [`resolve_entry_in`], ma con la cartella degli allegati dichiarata dal
/// vault. Un wikilink nudo a un allegato preferisce quella cartella; il ripiego
/// per nome resta per i vault che non hanno la chiave o che non contengono la
/// cartella nominata.
pub(super) fn resolve_entry_in_folder(
    entries: &BTreeMap<DocId, VaultEntry>,
    names: &EntryNames,
    source: &DocId,
    target: &LinkTarget,
    attachment_folder: Option<&str>,
) -> Option<DocId> {
    let raw = match target {
        // Un wikilink nomina un file **per nome**, come nomina una nota per
        // nome: `![[foto.png]]` è il modo in cui si incorpora un allegato.
        // Se il vault dichiara una cartella, quella è la prima candidata: per
        // una cartella con `./`, quella accanto alla nota che nomina.
        LinkTarget::Wiki { page, .. } => {
            if !page.contains('/') {
                let folder = attachment_folder
                    .map(|folder| fub_abi::rules::folders::for_note(folder, source.as_str()))
                    .filter(|folder| !folder.is_empty());
                if let Some(folder) = folder {
                    let candidate = DocId::new(format!("{folder}/{page}"));
                    if entries
                        .get(&candidate)
                        .is_some_and(|entry| entry.kind == EntryKind::Asset)
                    {
                        return Some(candidate);
                    }
                    if let Some(candidate) =
                        names.by_path_key(&fub_abi::rules::path::resolution_key(candidate.as_str()))
                    {
                        if entries
                            .get(&candidate)
                            .is_some_and(|entry| entry.kind == EntryKind::Asset)
                        {
                            return Some(candidate);
                        }
                    }
                }
            }
            return names.named(page);
        }
        LinkTarget::Path(raw) => raw,
        LinkTarget::Url(_) => return None,
    };
    let path = fub_abi::rules::path::resolve_against(source, raw)?;
    let id = DocId::new(path);
    if entries.contains_key(&id) {
        return Some(id);
    }
    // Ripiego, e non è pignoleria: macOS scrive i nomi dei file in NFD e i
    // link si digitano in NFC, quindi il confronto byte a byte manca
    // esattamente i nomi accentati. La chiave di risoluzione le riconcilia (è
    // la stessa regola con cui il grafo indicizza), e si paga solo quando il
    // confronto esatto ha già detto di no — cioè su un riferimento che sta per
    // essere dichiarato rotto.
    names.by_path_key(&fub_abi::rules::path::resolution_key(id.as_str()))
}

/// **I nomi dell'anagrafe**, dalla chiave di risoluzione ai file che la portano.
///
/// Risolvere un riferimento è una domanda **per chiave**, e prima era una
/// scansione: si calcolavano fino a due chiavi per ogni voce del vault e si
/// chiudeva con un `min_by_key`, che non cortocircuita — quindi trovare costava
/// quanto non trovare. Il chiamante caro non è il controllo di salute ma
/// `entry_rewrite_plan`, che chiede una volta per ogni link di ogni documento:
/// su ventimila voci, spostare un allegato voleva dire decine di minuti
/// (difetto 0115). Qui la chiave si calcola **una volta per voce, quando la
/// voce entra**, e la domanda diventa una ricerca in una mappa. È la stessa
/// forma che il grafo ha da sempre per le note (`path_index`), portata
/// sull'anagrafe.
///
/// **Due mappe e non una**, perché le domande sono due e mescolarle darebbe
/// risposte sbagliate: un `[[foto.png]]` può trovare un file che si chiama così
/// in fondo a una cartella, un path scritto per intero no — e se stessero
/// insieme, un `a/foto.png` indicizzato per nome verrebbe reso a chi ha scritto
/// il path `foto.png`, che è un file diverso.
///
/// Il prezzo è due chiavi in memoria per voce, ed è il conto che questa forma
/// paga per non riscandire: un'anagrafe di ventimila file tiene quarantamila
/// stringhe corte invece di ricalcolarne quarantamila **a ogni link**.
#[derive(Debug, Default)]
pub(crate) struct EntryNames {
    /// La chiave del **path intero**, per ogni voce di qualunque specie: è ciò
    /// che serve al ripiego di [`resolve_entry_in`], che riconcilia NFD e NFC
    /// dopo che il confronto esatto ha già detto di no. I documenti ci sono
    /// perché quel ripiego li considera.
    by_path: BTreeMap<String, BTreeSet<DocId>>,
    /// Le chiavi con cui un **nome** trova un file che non è un documento: il
    /// nome del file con la sua estensione — che è come si scrive
    /// `![[foto.png]]` — e il path intero, per chi disambigua scrivendolo.
    ///
    /// I documenti restano fuori: quelli li risolve il grafo, che conosce anche
    /// gli alias, e chi chiama prova prima lui.
    by_name: BTreeMap<String, BTreeSet<DocId>>,
}

impl EntryNames {
    /// I nomi di un'anagrafe che c'è già, in una passata.
    ///
    /// **Solo per i banchi**, e la riga che lo dice è il `cfg`: in produzione
    /// non esiste un'anagrafe senza chi la mantiene — a `entries` si arriva
    /// dalle due porte di [`CoreIndex`], che tengono i nomi al passo. Chi
    /// invece un'anagrafe se la costruisce a mano per provarci sopra una regola
    /// (il controllo di salute, che riceve le due mappe e non l'indice) ha
    /// bisogno di questa, e averla `pub(crate)` in produzione vorrebbe dire
    /// tenere aperta una seconda via per fare i nomi — cioè il modo in cui due
    /// elenchi cominciano a divergere.
    #[cfg(test)]
    pub(crate) fn of(entries: &BTreeMap<DocId, VaultEntry>) -> Self {
        let mut names = EntryNames::default();
        for (id, entry) in entries {
            names.insert_entry(id, entry.kind);
        }
        names
    }

    /// Registra una voce, con la sua specie.
    ///
    /// Toglie prima di mettere perché la stessa voce può rientrare cambiando
    /// specie, e una chiave vecchia rimasta dietro risponderebbe con un file
    /// che non si chiama più così.
    pub(crate) fn insert_entry(&mut self, id: &DocId, kind: EntryKind) {
        self.remove_entry(id);
        let path = fub_abi::rules::path::resolution_key(id.as_str());
        let name = fub_abi::rules::path::resolution_key(file_name_of(id.as_str()));
        remember(&mut self.by_path, &path, id);
        if kind != EntryKind::Document {
            remember(&mut self.by_name, &path, id);
            remember(&mut self.by_name, &name, id);
        }
    }

    /// Toglie una voce da tutte le chiavi che la portavano.
    ///
    /// Le chiavi si ricalcolano dall'id invece di tenerle scritte: sono due
    /// stringhe corte, e un secondo elenco da mantenere è un secondo elenco che
    /// può divergere dal primo. La specie qui non serve — togliere da una chiave
    /// che non c'era non è un errore.
    pub(crate) fn remove_entry(&mut self, id: &DocId) {
        let path = fub_abi::rules::path::resolution_key(id.as_str());
        let name = fub_abi::rules::path::resolution_key(file_name_of(id.as_str()));
        forget_entry(&mut self.by_path, &path, id);
        forget_entry(&mut self.by_name, &path, id);
        forget_entry(&mut self.by_name, &name, id);
    }

    pub(crate) fn clear(&mut self) {
        self.by_path.clear();
        self.by_name.clear();
    }

    /// Il file che un **nome** nomina, fra quelli che non sono documenti (§14.1).
    ///
    /// La regola è quella dei wikilink fra note, e lo è di proposito: si
    /// confronta la chiave di risoluzione (trim, NFC, minuscolo) contro il nome
    /// del file con la sua estensione, o contro il path intero. Fra omonimi
    /// vince il più vicino alla radice, e a parità l'ordine dei path: la stessa
    /// regola del grafo, perché due regole di risoluzione in un'app sola sono
    /// due risposte alla stessa domanda.
    ///
    /// Gli omonimi di una chiave sono pochi — è la ragione per cui questa forma
    /// guadagna: il `min_by_key` è rimasto, ma gira su loro e non sul vault.
    pub(crate) fn named(&self, name: &str) -> Option<DocId> {
        let wanted = fub_abi::rules::path::resolution_key(name);
        if wanted.is_empty() {
            return None;
        }
        self.by_name
            .get(&wanted)?
            .iter()
            // Il più vicino alla radice, e a parità il primo in ordine di path:
            // il gruppo è ordinato, quindi `min_by_key` è stabile.
            .min_by_key(|id| id.as_str().matches('/').count())
            .cloned()
    }

    /// La voce il cui **path intero** ha questa chiave: la prima in ordine di
    /// path, che è ciò che rispondeva la scansione.
    pub(crate) fn by_path_key(&self, key: &str) -> Option<DocId> {
        self.by_path.get(key)?.iter().next().cloned()
    }
}

fn remember(map: &mut BTreeMap<String, BTreeSet<DocId>>, key: &str, id: &DocId) {
    if key.is_empty() {
        return;
    }
    map.entry(key.to_string()).or_default().insert(id.clone());
}

fn forget_entry(map: &mut BTreeMap<String, BTreeSet<DocId>>, key: &str, id: &DocId) {
    if let Some(group) = map.get_mut(key) {
        group.remove(id);
        if group.is_empty() {
            map.remove(key);
        }
    }
}

/// Il nome di un file dentro il suo path.
fn file_name_of(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// Il primo path che può stare dentro `folder`, in una mappa ordinata per path.
///
/// I path di un sottoalbero sono **contigui** nell'ordine lessicografico, e
/// questa è la loro soglia: da qui in poi, finché il prefisso regge, c'è solo
/// roba di quella cartella. Per la radice è la stringa vuota, cioè tutto.
pub(super) fn subtree_start(folder: &str) -> String {
    if folder.is_empty() {
        String::new()
    } else {
        format!("{folder}/")
    }
}

/// Quanti, fra i path ordinati che l'iteratore produce **a partire dalla
/// soglia** di `folder`, le stanno direttamente dentro.
///
/// Il `take_while` è ciò che rende il conto proporzionale al sottoalbero e non
/// al vault: appena il prefisso non regge più, il resto della mappa non si
/// guarda. Per la radice il prefisso è vuoto e si guarda tutto — che è giusto,
/// perché i figli della radice si contano una volta sola.
pub(super) fn count_direct<'a>(paths: impl Iterator<Item = &'a str>, folder: &str) -> u32 {
    let prefix = subtree_start(folder);
    paths
        .take_while(|path| path.starts_with(&prefix))
        .filter(|path| parent_folder(path) == folder)
        .count()
        .min(u32::MAX as usize) as u32
}
