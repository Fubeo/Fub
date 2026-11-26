//! Lettura dei documenti e delle risorse.

use super::*;

/// Apertura metadata sullo storage attivo, eseguibile senza custodia workspace.
pub struct PreparedResourceOpen {
    pub(super) vault: crate::vault::Vault,
    pub(super) id: DocId,
}

/// La domanda «c'è già questo contenuto nel vault?» sul vault attivo, eseguibile
/// senza custodia workspace: i candidati si prendono dall'indice vivo sotto il
/// lucchetto, il confronto si fa fuori (vedi [`crate::same_content`]).
pub struct PreparedSameContent {
    pub(super) vault: crate::vault::Vault,
    pub(super) plan: crate::same_content::Plan,
}

/// Il lettore delle lease di un vault, da tenere fuori dal workspace.
///
/// È la forma durevole di [`PreparedResourceOpen`] e
/// [`PreparedResourceRead`]: tiene il [`Vault`](crate::vault::Vault) clonato,
/// come `prepare_resource_open` lo clona a ogni apertura, in un posto che il
/// workspace condivide con tutti i suoi lettori, e **non** il lucchetto del
/// workspace. Chi lo tiene apre e legge a pezzi senza prendere
/// la custodia, cioè anche da dentro un comando o un job che ha già il suo
/// `HostApi`.
///
/// Le recinzioni sono quelle delle due `prepare_*`, con le stesse funzioni:
/// [`valid_doc_id`] e `transfer::resource_open_on` all'apertura, il controllo
/// della radice di `check_resource_lease` e `transfer::resource_read_at` a
/// ogni pezzo (stat, identità e timbro prima e dopo, `Stale` se uno cambia).
///
/// Chiuso il vault ([`Workspace::prepare_close`]), il lettore non apre e non
/// legge più: il pezzo dopo è un errore `Io` di specie `NotConnected`, mai un
/// byte di un vault che non c'è più. La chiusura svuota il posto condiviso, e
/// con lui la maniglia della cartella del vault: un lettore rimasto in giro
/// (in una cache, in un biglietto) non tiene aperta la cartella, che su
/// Windows altrimenti non si rinomina e non si cancella.
#[derive(Clone)]
pub struct ResourceReader {
    pub(super) root: Utf8PathBuf,
    pub(super) vault: Arc<Shelter<Option<crate::vault::Vault>>>,
}

impl ResourceReader {
    /// Una lease su `id`, come [`Workspace::open_resource`].
    pub fn open(&self, id: &DocId) -> Result<ResourceLease> {
        let vault = self.vault()?;
        crate::transfer::resource_open_on(&vault, &valid_doc_id(id.as_str())?)
    }

    /// Al più `len` byte da `offset` della lease, come
    /// [`Workspace::read_resource`]: una lease di un altro vault è
    /// `OutsideVault`, un file cambiato dall'apertura è `Stale`.
    pub fn read_at(&self, lease: &ResourceLease, offset: u64, len: usize) -> Result<Vec<u8>> {
        let vault = self.vault()?;
        check_lease_root(vault.root(), lease)?;
        crate::transfer::resource_read_at(vault.storage().as_ref(), lease, offset, len)
    }

    /// La radice canonica del vault che il lettore serve.
    pub fn root(&self) -> &Utf8Path {
        &self.root
    }

    /// Il vault ancora aperto, clonato fuori dal lucchetto del posto: la
    /// lettura non trattiene la chiusura, e la chiusura che arriva a metà
    /// lascia finire solo il pezzo già cominciato.
    pub(super) fn vault(&self) -> Result<crate::vault::Vault> {
        if let Some(vault) = self.vault.acquire().as_ref() {
            return Ok(vault.clone());
        }
        Err(KernelError::Io {
            path: self.root.clone(),
            source: std::io::Error::new(
                std::io::ErrorKind::NotConnected,
                "il vault è chiuso: il lettore delle risorse non legge più",
            ),
        })
    }
}

/// Il controllo della radice di una lease: una lease aperta su un altro vault
/// non si legge da questo.
pub(super) fn check_lease_root(root: &Utf8Path, lease: &ResourceLease) -> Result<()> {
    if lease.root != *root {
        return Err(KernelError::OutsideVault(
            lease.root.join(lease.path.as_str()),
        ));
    }
    Ok(())
}

/// Lettura bounded su lease condivisa: non copia path o buffer dell'allegato.
pub struct PreparedResourceRead {
    pub(super) storage: Arc<dyn crate::storage::VaultStorage>,
    pub(super) lease: Arc<ResourceLease>,
    pub(super) offset: u64,
    pub(super) len: usize,
}

impl PreparedResourceOpen {
    pub fn invoke(self) -> Result<ResourceLease> {
        crate::transfer::resource_open_on(&self.vault, &self.id)
    }
}

impl PreparedSameContent {
    /// Il contenuto, già in memoria, confrontato con i candidati: vedi
    /// [`SameContent`](crate::same_content::SameContent). I byte devono essere
    /// quelli della misura data a [`Workspace::prepare_same_content`]; le
    /// impronte calcolate per strada tornano all'indice con
    /// [`Workspace::learn_fingerprints`].
    pub fn invoke(self, bytes: &[u8]) -> SameContentOutcome {
        crate::same_content::answer(&self.vault, self.plan, bytes)
    }
}

impl PreparedResourceRead {
    pub fn invoke(self) -> Result<Vec<u8>> {
        crate::transfer::resource_read_at(self.storage.as_ref(), &self.lease, self.offset, self.len)
    }
}

impl Workspace {
    /// Elenco ordinato dei documenti indicizzati.
    ///
    /// L'ordine non si impone più a ogni chiamata: la cache dei metadati è
    /// ordinata per costruzione (§5.5). Chi ne vuole una **finestra** non passa
    /// di qui ma da
    /// [`VaultRead::list_documents`](fub_abi::traits::VaultRead::list_documents),
    /// che non materializza il resto.
    pub fn documents(&self) -> Vec<DocId> {
        self.indexes.core.documents()
    }

    /// Una finestra sui documenti indicizzati, col conto di quanti sono.
    pub fn documents_page(&self, page: Option<Page>) -> Paged<DocId> {
        let total = self.indexes.core.metas.len() as u32;
        let Some(page) = page else {
            return Paged::all(self.indexes.core.documents());
        };
        Paged {
            items: self
                .indexes
                .core
                .ids()
                .skip(page.offset as usize)
                .take(page.limit as usize)
                .cloned()
                .collect(),
            offset: page.offset,
            total,
        }
    }

    /// Le estensioni che i provider registrati riconoscono (minuscole, senza
    /// punto), ordinate.
    ///
    /// Serve a chi disegna: il "nome pagina" di un documento è il basename
    /// senza l'estensione **gestita**, e quale sia dipende dai provider —
    /// cablare `.md` nel frontend è vero solo finché markdown è l'unico
    /// formato, cioè finché il progetto non fa ciò per cui esiste.
    pub fn extensions(&self) -> Vec<String> {
        let mut exts = self.docs.registry.all_extensions();
        exts.sort();
        exts
    }

    /// Sorgente grezza di un documento dal disco.
    pub fn read_source(&self, id: &DocId) -> Result<String> {
        self.docs.read_text(id)
    }

    /// I byte di un documento, senza decodificarli (§21.8).
    ///
    /// Non è una variante di comodo di [`Workspace::read_source`]: è la sola
    /// forma in cui un allegato — un PDF, un audio — si lascia leggere, e chi la
    /// chiama è chi da quei byte tira fuori del testo.
    pub fn read_source_bytes(&self, id: &DocId) -> Result<Vec<u8>> {
        self.docs.vault.read_bytes(id)
    }

    /// Apre una lease di risorsa sul VERO Vault/storage di sessione/mount: recinto
    /// via `fenced_doc_id` + `resource_open_on`, mai `Vault::open` nuovo, mai
    /// getter grezzi. `revision` resta `None`: NON si copia l'eventuale
    /// `Entries.fingerprint`, che per testo puo essere hash decodificato e NON
    /// hash raw/BOM/CRLF. Dopo una write il chiamante usa il raw noto.
    pub fn open_resource(&self, id: &DocId) -> Result<ResourceLease> {
        self.prepare_resource_open(id)?.invoke()
    }

    pub fn prepare_resource_open(&self, id: &DocId) -> Result<PreparedResourceOpen> {
        Ok(PreparedResourceOpen {
            vault: self.docs.vault.clone(),
            id: valid_doc_id(id.as_str())?,
        })
    }

    /// La domanda «c'è già un file con questi `bytes_len` byte, dello stesso
    /// tipo di `target`?», da fare fuori dal lucchetto del workspace: i
    /// candidati si prendono adesso dall'indice vivo (le voci in memoria, con
    /// misura e impronta), il vault si clona, e la custodia si rilascia (vedi
    /// [`PreparedSameContent`]). Finché la scansione non ha installato
    /// l'anagrafe la risposta è «non so».
    pub fn prepare_same_content(&self, target: &DocId, bytes_len: u64) -> PreparedSameContent {
        let plan = crate::same_content::plan(
            self.indexes.core.entries.values(),
            |id| self.indexes.core.learned_on(id),
            self.indexes.core.anagrafe_complete(),
            &self.docs.vault.ignore_policy(),
            target,
            bytes_len,
        );
        PreparedSameContent {
            vault: self.docs.vault.clone(),
            plan,
        }
    }

    /// Riporta nell'indice vivo le impronte che una domanda sul contenuto ha
    /// calcolato fuori dal lucchetto. Ciascuna si tiene solo se:
    ///
    /// - la data letta era già nel passato quando la domanda è cominciata
    ///   (*racily clean*);
    /// - la voce c'è ancora con la misura e la data lette: una voce cambiata
    ///   nel frattempo, da una scrittura o dal rilevatore, non torna indietro;
    /// - la voce non sa già di venire da un altro file (vedi
    ///   [`CoreIndex::learn_fingerprint`](crate::index::CoreIndex::learn_fingerprint));
    /// - se l'anagrafe ha una riga con quella misura e quella data, la riga
    ///   non dice un altro file: un'altra identità, o un altro timbro quando
    ///   la riga ne ha uno. Un file sostituito da un altro con la stessa
    ///   misura e la stessa data, senza che il rilevatore lo dicesse, ha una
    ///   voce che descrive ancora quello di prima. Una riga senza timbro non
    ///   ha certificato nessun timbro, e il suo non smentisce; la sua
    ///   identità basta per rifiutare, che è la parte prudente.
    ///
    /// Il file letto (segno del cambio e identità) l'ha preso la domanda, fuori
    /// dal lucchetto: qui si confronta soltanto, senza domande al supporto e
    /// senza copiare la riga dell'anagrafe. L'impronta resta nella voce col
    /// suo testimone: chi la usa dopo la crede solo per quel file, e
    /// [`store_entries`](Self::store_entries) non la scrive per un file che nel
    /// frattempo è un altro.
    ///
    /// Non scrive niente su disco: l'anagrafe porta le impronte in
    /// `entries.json` con [`store_entries`](Self::store_entries), l'unico che lo
    /// scrive. Ritorna quante impronte ha tenuto.
    pub fn learn_fingerprints(&mut self, learned: LearnedFingerprints) -> usize {
        let mut kept = 0;
        for learned in learned.0 {
            if learned.mtime == 0 || learned.mtime >= learned.observed_at {
                continue;
            }
            let table_disagrees = self
                .entry_store
                .ask_known(&learned.id, |known| {
                    known.describes(learned.size, learned.mtime)
                        && (known.identity != learned.witness.identity
                            || known
                                .change_stamp
                                .is_some_and(|stamp| Some(stamp) != learned.witness.change_stamp))
                })
                .unwrap_or(false);
            if table_disagrees {
                continue;
            }
            if self.indexes.core.learn_fingerprint(
                &learned.id,
                learned.size,
                learned.mtime,
                &learned.fingerprint,
                learned.witness,
            ) {
                kept += 1;
            }
        }
        kept
    }

    pub(super) fn check_resource_lease(&self, lease: &ResourceLease) -> Result<()> {
        check_lease_root(self.docs.vault.root(), lease)
    }

    /// Il lettore delle lease di questo vault, da tenere fuori dal lucchetto
    /// (vedi [`ResourceReader`]). Smette di leggere quando il vault si chiude.
    pub fn resource_reader(&self) -> ResourceReader {
        ResourceReader {
            root: self.docs.vault.root().to_owned(),
            vault: Arc::clone(&self.resource_readers_vault),
        }
    }

    pub fn prepare_resource_read(
        &self,
        lease: Arc<ResourceLease>,
        offset: u64,
        len: usize,
    ) -> Result<PreparedResourceRead> {
        self.check_resource_lease(&lease)?;
        Ok(PreparedResourceRead {
            storage: Arc::clone(self.docs.vault.storage()),
            lease,
            offset,
            len,
        })
    }

    /// Range stabile su lease del VERO storage attivo: rifiuta root diversa dalla
    /// propria, poi `resource_read_at` (stat+identity+change prima/dopo, Stale su
    /// mismatch). Mai intero file in memoria oltre il chunk.
    pub fn read_resource(&self, lease: &ResourceLease, offset: u64, len: usize) -> Result<Vec<u8>> {
        self.check_resource_lease(lease)?;
        crate::transfer::resource_read_at(self.docs.vault.storage().as_ref(), lease, offset, len)
    }
}
