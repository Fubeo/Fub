//! Il registro dei vault conosciuti e dei bundle dei plugin.

use super::*;

impl Host {
    /// I vault conosciuti: prima i preferiti, poi i recenti.
    pub fn known_vaults(&self) -> Vec<VaultEntry> {
        self.vaults.handle().list()
    }

    /// Il **vault da aprire all'avvio**, se la shell non ha ricevuto un
    /// `FUB_VAULT`: scorre i candidati del registro dal più recente e
    /// restituisce la radice del primo la cui cartella esiste ancora sul disco.
    ///
    /// Non lo apre — solo il path. Un preferito più vecchio non salta davanti
    /// all'ultimo aperto: il registro è memoria di recency, e l'avvio chiede
    /// *l'ultimo*, non il *preferito*. Un path sparito non fa fallire l'avvio:
    /// si passa al successivo e la shell resta libera di aprirne uno dal
    /// dialogo.
    ///
    /// Il `Utf8Path::is_dir` è l'unica domanda al disco, ed è intenzionale:
    /// [`VaultEntry::root`] è canonica per contratto, quindi non si
    /// ricanonicalizza (la cartella potrebbe essere sparita, e
    /// `canonicalize` non risponde su ciò che non c'è).
    pub fn last_vault(&self) -> Option<String> {
        self.vaults
            .handle()
            .in_recency_order()
            .into_iter()
            .find(|and| Utf8Path::new(&and.root).is_dir())
            .map(|and| and.root)
    }

    /// Appunta (o spunta) un vault. Il path **non** deve essere aperto: si
    /// preferisce un vault anche quando è chiuso, ed è quasi sempre allora.
    pub fn set_vault_favorite(&self, root: &Utf8Path, favorite: bool) -> Result<(), PluginError> {
        self.vaults
            .handle()
            .set_favorite(&self.key(root)?, favorite)
    }

    /// L'icona e il nome con cui un vault compare nell'elenco: **l'aspetto
    /// intero**, nelle stesse forme in cui `known_vaults` lo restituisce —
    /// l'icona assente è `None`, il nome non scelto è il vuoto.
    pub fn set_vault_look(
        &self,
        root: &Utf8Path,
        icon: Option<String>,
        name: String,
    ) -> Result<(), PluginError> {
        self.vaults.handle().set_look(&self.key(root)?, icon, name)
    }

    /// Toglie un vault dall'elenco. **Non lo cancella dal disco**: dimenticare
    /// una scorciatoia non è distruggere ciò a cui punta.
    ///
    /// Non *pretende* di canonicalizzare: si dimentica anche una cartella che
    /// non esiste più, che è il caso più comune per cui lo si fa, e su un path
    /// che non esiste `canonicalize` non risponde. Ma non può nemmeno ignorare
    /// la forma canonica, perché è **quella** la chiave con cui l'apertura ha
    /// scritto la voce ([`canonical`]): dimenticare la sola forma data lascerebbe
    /// in elenco ogni vault nominato in un modo diverso da come è stato aperto —
    /// e su macOS o Windows, dove la canonica differisce quasi sempre dal path
    /// che l'utente sceglie (`/var` → `/private/var`, il prefisso UNC), sarebbe
    /// *ogni* vault. Quindi si dimenticano entrambe le forme.
    ///
    /// **Dimentica anche come lo si stava guardando** (§11.2): senza questa riga
    /// il file dello stato di vista sarebbe l'unico posto del progetto che cresce
    /// e non cala mai, e riaprendo fra un anno un vault dimenticato le cartelle
    /// sarebbero ancora aperte com'erano. Il registro per primo, perché è lui che
    /// l'utente vede: se la potatura fallisce dopo, resta un residuo in un file
    /// di cache — e lo si dice — invece di uno scroll perso per un vault che è
    /// rimasto in elenco.
    pub fn forget_vault(&self, root: &Utf8Path) -> Result<(), PluginError> {
        let forms = root_forms(root);
        self.vaults.handle().forget(&forms)?;
        // **Le forme insieme, non una per volta**: sono due file diversi, quindi
        // due scritture ci vogliono per forza, ma dentro ciascuno la potatura è
        // *una* mossa. Il ciclo che stava qui ne faceva N sullo stesso file, e
        // bastava che la seconda non riuscisse per lasciare il vault mezzo
        // dimenticato — dimenticato sotto il nome dato, ancora lì sotto quello
        // canonico. Adesso quella metà non è più esprimibile: la firma prende
        // l'insieme, come `Registry::forget` qui sopra.
        self.view_states
            .forget_vault(&forms)
            .map_err(|and| PluginError::Io(and.into()))?;
        Ok(())
    }

    // --- accendere e spegnere un componente (§11.1) -------------------------

    /// Chi questo host sa montare, e chi è acceso in questo vault.
    pub fn bundles(&self, vault: Option<&str>) -> Result<Vec<BundleInfo>, PluginError> {
        self.in_session(vault, |s| Ok(s.registry.write()?.inventory()))
    }

    /// Ricorda un bundle runtime senza scrivere alcuna preferenza.
    pub fn remember_claimed_bundle(
        &self,
        vault: Option<&str>,
        bundle: Arc<dyn Bundle>,
        claim: &BundleClaim,
    ) -> Result<(), PluginError> {
        let (_id, known) = BundleRegistry::claimed(bundle, claim.clone());
        let registry = self.in_session(vault, |session| Ok(session.registry.clone()))?;
        let mut candidate = Some(known);
        let remembered = match registry.write() {
            Ok(mut registry) => registry.remember_claimed(&mut candidate),
            Err(error) => Err(error),
        };
        BundleRegistry::drop_known(candidate);
        remembered.map(drop)
    }

    /// Dice se la voce conosciuta appartiene precisamente a `claim`.
    pub fn bundle_is_owned(
        &self,
        vault: Option<&str>,
        id: &str,
        claim: &BundleClaim,
    ) -> Result<bool, PluginError> {
        self.in_session(vault, |session| {
            Ok(session.registry.read()?.is_owned(id, claim))
        })
    }

    /// Dice se l'istanza montata appartiene precisamente a `claim`.
    pub fn is_bundle_active(
        &self,
        vault: Option<&str>,
        id: &str,
        claim: &BundleClaim,
    ) -> Result<bool, PluginError> {
        self.in_session(vault, |session| {
            Ok(session.registry.read()?.is_active_owned(id, claim))
        })
    }

    /// Monta o smonta soltanto la voce posseduta da `claim`, senza toccare
    /// `plugins.disabled` o alcun inventario installato.
    pub fn set_bundle_active(
        &self,
        vault: Option<&str>,
        id: &str,
        claim: &BundleClaim,
        active: bool,
    ) -> Result<Vec<PluginError>, PluginError> {
        if active {
            let (workspace, registry) = self.in_session(vault, |session| {
                Ok((session.workspace.clone(), session.registry.clone()))
            })?;
            BundleRegistry::enable_claimed_guarded(&registry, &workspace, id, claim)?;
            return Ok(Vec::new());
        }

        let selected = self.in_session(vault, |session| {
            let mounted = session.registry.read()?.is_active_owned(id, claim);
            Ok(mounted.then(|| {
                (
                    session.workspace.clone(),
                    session.registry.clone(),
                    session.runner.shutdown_bundle(id),
                )
            }))
        })?;
        let Some((workspace, registry, _shutdown)) = selected else {
            return Ok(Vec::new());
        };
        let _turn = workspace.write_turn();
        let deferred = { workspace.write()?.defer_event_dispatch() };
        let outcome = crate::teardown::unmount(&workspace, &registry, id);
        workspace.write()?.restore_event_dispatch(deferred);
        drain_events(&workspace)?;
        outcome
    }

    /// Dimentica soltanto una voce propria già smontata.
    pub fn forget_bundle(
        &self,
        vault: Option<&str>,
        id: &str,
        claim: &BundleClaim,
    ) -> Result<(), PluginError> {
        let registry = self.in_session(vault, |session| Ok(session.registry.clone()))?;
        let removed = {
            let mut registry = registry.write()?;
            registry.forget_claimed(id, claim)?
        };
        BundleRegistry::drop_known(Some(removed));
        Ok(())
    }
}
