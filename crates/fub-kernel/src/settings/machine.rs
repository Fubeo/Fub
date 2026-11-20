//! Il livello **macchina**: `MachineSettings`, con il suo schema e le sue
//! revisioni.

use super::*;

/// Il livello **macchina**, condiviso da tutti i vault aperti.
///
/// Condiviso e non copiato: i vault aperti insieme sono N
/// ([decisione 0029](../../../docs/decisions/0183-composizione-host-kernel.md))
/// e la configurazione della macchina è **una**. N copie sarebbero N idee del
/// tema, e la seconda finestra che scrive vincerebbe sulla prima senza che
/// nessuna delle due lo sappia.
///
/// `path: None` è il livello macchina **in memoria**: è ciò che usa un test —
/// e un e2e headless — per non scrivere nella cartella di configurazione di chi
/// esegue la suite. Un livello che non ha un file non lo scrive, e lo dice
/// rispondendo `Ok` senza fare niente: non è un errore, è un host che ha detto
/// di non averne uno.
///
/// # Perché tiene anche uno **schema**
///
/// Perché una chiave di macchina esiste quando un vault non c'è, e fino alla
/// [0116](../../../docs/decisions/0185-capability-un-solo-guard.md)
/// esisteva solo il suo *valore*: lo schema stava nello [`SettingsStore`] di un
/// vault, cioè nell'unico posto che sparisce proprio nel caso per cui lo scope
/// `Machine` era nato. `log.level` si poteva leggere e scrivere **solo con un
/// vault aperto**, che è il contrario di ciò che il suo doc-comment prometteva.
///
/// Lo schema qui dentro è quello del **core** e di nessun altro: chi dichiara
/// vive quanto ciò che dichiara, e un plugin si registra per vault. Una spec di
/// scope [`SettingScope::Vault`] viene **rifiutata**, o questo livello
/// risponderebbe per una chiave che non gli appartiene.
pub struct MachineSettings {
    path: Option<Utf8PathBuf>,
    /// **Il turno di chi scrive.** Non protegge un dato — lo protegge
    /// [`values`](Self::values) — ma l'ordine di due scritture: vedi
    /// [`MachineSettings::write`], dove serve perché il lucchetto dei valori
    /// non copre più l'andata al disco.
    ///
    /// Un [`Shelter`] e non un `Mutex` nudo perché la domanda «e se è
    /// avvelenato?» ha una porta sola nel kernel (0126): qui poi la risposta è
    /// la più facile di tutte — ciò che c'è dentro è `()`, e un ordine non si
    /// corrompe.
    write: Shelter<()>,
    pub(super) values: RwLock<BTreeMap<String, SettingValue>>,
    /// Exact revisions of writes made through this shared machine-settings
    /// instance. They distinguish a mount's temporary denial from a later
    /// write of the same value without changing the persistent settings schema.
    revisions: RwLock<BTreeMap<String, u64>>,
    next_revision: AtomicU64,
    /// Lo schema delle chiavi di macchina. Dietro un lock come i valori, e per
    /// la stessa ragione: l'`Arc` è condiviso da ogni vault aperto, e chi
    /// dichiara è l'host una volta sola all'avvio.
    specs: RwLock<BTreeMap<String, SettingSpec>>,
    /// Le chiavi nell'ordine in cui sono state dichiarate: è l'ordine in cui
    /// [`MachineSettings::entries`] le restituisce. Si scrive solo tenendo il
    /// lock di `specs`, così le due viste non divergono.
    order: RwLock<Vec<String>>,
    profile_state: RwLock<SettingsFile>,
}

impl MachineSettings {
    /// Apre (o crea al primo salvataggio) il file della macchina. Un file
    /// illeggibile non impedisce di aprire un vault: torna l'avviso, e il
    /// livello resta vuoto — perché la configurazione della macchina è la meno
    /// autorevole delle due, e perdere il tema non vale un'app che non parte.
    pub fn open(path: &Utf8Path) -> (Arc<Self>, Option<String>) {
        let (file, warning) = match load_raw_from(path, |p| std::fs::read(p)) {
            Ok(file) => (file, None),
            Err(and) => (
                SettingsFile {
                    active_profile: default_profile_name(),
                    ..SettingsFile::default()
                },
                Some(and),
            ),
        };
        let values = supported_values(&file);
        (
            Arc::new(MachineSettings {
                path: Some(path.to_owned()),
                write: Shelter::new(()),
                values: RwLock::new(values),
                revisions: RwLock::new(BTreeMap::new()),
                next_revision: AtomicU64::new(1),
                specs: RwLock::new(BTreeMap::new()),
                order: RwLock::new(Vec::new()),
                profile_state: RwLock::new(file),
            }),
            warning,
        )
    }

    /// Un livello macchina che non tocca il disco.
    pub fn in_memory() -> Arc<Self> {
        Arc::new(MachineSettings {
            path: None,
            write: Shelter::new(()),
            values: RwLock::new(BTreeMap::new()),
            revisions: RwLock::new(BTreeMap::new()),
            next_revision: AtomicU64::new(1),
            specs: RwLock::new(BTreeMap::new()),
            order: RwLock::new(Vec::new()),
            profile_state: RwLock::new(SettingsFile {
                active_profile: default_profile_name(),
                ..SettingsFile::default()
            }),
        })
    }

    fn profile_file(&self) -> Result<SettingsFile, String> {
        match &self.path {
            Some(path) => load_raw_from(path, |p| std::fs::read(p)),
            None => Ok(self.profile_state.read().expect("machine profiles").clone()),
        }
    }

    fn change_profiles(
        &self,
        change: impl FnOnce(&mut SettingsFile) -> Result<(), String>,
    ) -> Result<(), String> {
        let _turn = self.write.acquire();
        self.change_profiles_locked(change)
    }

    /// [`change_profiles`](Self::change_profiles) per chi ha già il turno di
    /// scrittura.
    fn change_profiles_locked(
        &self,
        change: impl FnOnce(&mut SettingsFile) -> Result<(), String>,
    ) -> Result<(), String> {
        let file = if let Some(path) = &self.path {
            update_atomic(
                path,
                || {
                    load_raw_from(path, |p| std::fs::read(p))
                        .map_err(|e| do_not_overwrite(&e, LOSS))
                },
                |file| {
                    change(file)?;
                    file.version = SCHEMA_VERSION;
                    encode(file)
                },
            )?
        } else {
            let mut file = self.profile_state.read().expect("machine profiles").clone();
            change(&mut file)?;
            file
        };
        *self.values.write().expect("livello macchina") = supported_values(&file);
        *self.profile_state.write().expect("machine profiles") = file;
        Ok(())
    }

    pub fn active_profile(&self) -> Result<String, String> {
        Ok(self.profile_file()?.active_profile)
    }

    pub fn profiles(&self) -> Result<Vec<String>, String> {
        Ok(profile_names(&self.profile_file()?))
    }

    pub fn export_profile(&self, name: &str) -> Result<String, String> {
        let file = self.profile_file()?;
        let profile = file
            .profile(name)
            .ok_or_else(|| format!("unknown profile `{name}`"))?;
        serde_json::to_string_pretty(&profile).map_err(|e| e.to_string())
    }

    pub fn import_profile(&self, json: &str) -> Result<(), String> {
        let profile: SettingsProfile = serde_json::from_str(json).map_err(|e| e.to_string())?;
        self.change_profiles(|file| add_profile(file, profile))
    }

    pub fn duplicate_profile(&self, source: &str, name: &str) -> Result<(), String> {
        self.change_profiles(|file| {
            let mut profile = file
                .profile(source)
                .ok_or_else(|| format!("unknown profile `{source}`"))?;
            profile.name = name.into();
            add_profile(file, profile)
        })
    }

    pub fn switch_profile(&self, name: &str) -> Result<(), String> {
        self.change_profiles(|file| file.switch_profile(name))
    }

    /// Reset only declared, representable settings; foreign values survive.
    pub fn reset_profile(&self, name: &str) -> Result<(), String> {
        let declared = self.specs.read().expect("schema della macchina").clone();
        self.change_profiles(|file| {
            if file.profile(name).is_none() {
                return Err(format!("unknown profile `{name}`"));
            }
            let reset = |values: &mut BTreeMap<String, serde_json::Value>| {
                values.retain(|key, raw| {
                    !declared.get(key).is_some_and(|spec| {
                        serde_json::from_value::<SettingValue>(raw.clone())
                            .ok()
                            .is_some_and(|value| spec.kind.rejects(&value).is_none())
                    })
                });
            };
            if name == file.active_profile {
                reset(&mut file.values);
            } else {
                let profile = file.profiles.get_mut(name).expect("checked above");
                reset(&mut profile.values);
            }
            Ok(())
        })
    }

    /// Dichiara le chiavi di macchina del core.
    ///
    /// Una spec di scope [`SettingScope::Vault`] è un errore del chiamante e
    /// non un valore da ignorare: chi la passa crede di aver dichiarato
    /// qualcosa, e un livello che accettasse in silenzio risponderebbe per una
    /// chiave che vive altrove — cioè con un default, dove il vault ha il valore
    /// vero. Un doppione è un errore per la stessa ragione dello
    /// [`SettingsStore::declare`]: due schemi sulla stessa chiave sono due
    /// default, e a vincere sarebbe l'ordine di montaggio.
    pub fn declare(&self, specs: &[SettingSpec]) -> Result<(), String> {
        let mut declared = self.specs.write().expect("schema della macchina");
        let mut order = self.order.write().expect("ordine della macchina");
        for spec in specs {
            if spec.scope != SettingScope::Machine {
                return Err(format!(
                    "l'impostazione `{}` è del vault: il livello macchina non la tiene",
                    spec.key
                ));
            }
            if declared.contains_key(&spec.key) {
                return Err(format!(
                    "l'impostazione `{}` è già dichiarata nel livello macchina",
                    spec.key
                ));
            }
            declared.insert(spec.key.clone(), spec.clone());
            order.push(spec.key.clone());
        }
        Ok(())
    }

    /// Questa chiave è dichiarata qui? È la domanda con cui chi riceve una
    /// scrittura **senza nessun vault aperto** distingue «non c'è vault» da
    /// «questa chiave un vault non le serve».
    pub fn declares(&self, key: &str) -> bool {
        self.specs
            .read()
            .expect("schema della macchina")
            .contains_key(key)
    }

    /// Tutte le righe di macchina risolte, in ordine di dichiarazione.
    ///
    /// La stessa forma di [`SettingsStore::entries`], e i valori sono gli stessi
    /// che vede un vault aperto: la mappa è una sola.
    pub fn entries(&self) -> Vec<SettingEntry> {
        let specs = self.specs.read().expect("schema della macchina");
        let order = self.order.read().expect("ordine della macchina");
        order
            .iter()
            .filter_map(|key| specs.get(key))
            .map(|spec| {
                let (value, source) = self.resolve(spec);
                SettingEntry {
                    spec: spec.clone(),
                    value,
                    source,
                }
            })
            .collect()
    }

    /// Il valore che vale adesso per una chiave di macchina, e da dove viene.
    pub fn effective(&self, key: &str) -> Result<(SettingValue, SettingSource), PluginError> {
        let specs = self.specs.read().expect("schema della macchina");
        let spec = specs.get(key).ok_or_else(|| undeclared(key))?;
        Ok(self.resolve(spec))
    }

    /// Scrive una chiave di macchina, con lo stesso cancello dello store di un
    /// vault: dichiarata, e di una forma che lo schema accetta.
    pub fn set(&self, key: &str, value: SettingValue) -> Result<(), PluginError> {
        let spec = self.spec_of(key)?;
        if let Some(why) = spec.kind.rejects(&value) {
            return Err(PluginError::BadArgs(format!("`{key}`: {why}").into()));
        }
        self.write(key, Some(value))
            .map(|_| ())
            .map_err(|and| PluginError::Internal(and.into()))
    }

    /// Dimentica ciò che era stato deciso: la chiave ricade sul default dello
    /// schema, che per una chiave di macchina è l'unico livello sotto.
    pub fn reset(&self, key: &str) -> Result<(), PluginError> {
        self.spec_of(key)?;
        self.write(key, None)
            .map(|_| ())
            .map_err(|and| PluginError::Internal(and.into()))
    }

    #[cfg(test)]
    pub(crate) fn set_if_default_tracked(
        &self,
        key: &str,
        value: SettingValue,
    ) -> Result<Option<MachineSettingRevision>, PluginError> {
        let spec = self.spec_of(key)?;
        if let Some(why) = spec.kind.rejects(&value) {
            return Err(PluginError::BadArgs(format!("`{key}`: {why}").into()));
        }
        self.set_validated_if_default_tracked(key, value)
    }

    pub(super) fn set_validated_if_default_tracked(
        &self,
        key: &str,
        value: SettingValue,
    ) -> Result<Option<MachineSettingRevision>, PluginError> {
        let _turn = self.write.acquire();
        if self
            .values
            .read()
            .expect("livello macchina")
            .contains_key(key)
        {
            return Ok(None);
        }
        let written = serde_json::to_value(&value)
            .map_err(|error| PluginError::Internal(error.to_string().into()))?;
        self.write_locked(key, Some(value))
            .map(|revision| {
                Some(MachineSettingRevision {
                    key: key.to_owned(),
                    revision,
                    profile: self
                        .profile_state
                        .read()
                        .expect("machine profiles")
                        .active_profile
                        .clone(),
                    value: written,
                })
            })
            .map_err(|error| PluginError::Internal(error.into()))
    }

    #[cfg(test)]
    pub(crate) fn reset_if_current(
        &self,
        receipt: &MachineSettingRevision,
    ) -> Result<bool, PluginError> {
        self.spec_of(&receipt.key)?;
        self.reset_validated_if_current(receipt)
    }

    pub(super) fn reset_validated_if_current(
        &self,
        receipt: &MachineSettingRevision,
    ) -> Result<bool, PluginError> {
        let _turn = self.write.acquire();
        if self
            .revisions
            .read()
            .expect("revisioni del livello macchina")
            .get(&receipt.key)
            .copied()
            != Some(receipt.revision)
        {
            return Ok(false);
        }
        // La revisione è un contatore di questa istanza: non sa di un cambio
        // di profilo né di una scrittura di un'altra istanza. Si toglie la
        // chiave soltanto se, nel profilo in cui l'abbiamo scritta e così come
        // è adesso persistita, ha ancora il valore che abbiamo scritto noi.
        let file = self
            .profile_file()
            .map_err(|error| PluginError::Internal(error.into()))?;
        let stored = if file.active_profile == receipt.profile {
            file.values.get(&receipt.key)
        } else {
            file.profiles
                .get(&receipt.profile)
                .and_then(|profile| profile.values.get(&receipt.key))
        };
        if stored != Some(&receipt.value) {
            return Ok(false);
        }
        if file.active_profile == receipt.profile {
            return self
                .write_locked(&receipt.key, None)
                .map(|_| true)
                .map_err(|error| PluginError::Internal(error.into()));
        }
        self.change_profiles_locked(|file| {
            if let Some(profile) = file.profiles.get_mut(&receipt.profile) {
                profile.values.remove(&receipt.key);
            }
            Ok(())
        })
        .map(|()| true)
        .map_err(|error| PluginError::Internal(error.into()))
    }

    fn spec_of(&self, key: &str) -> Result<SettingSpec, PluginError> {
        self.specs
            .read()
            .expect("schema della macchina")
            .get(key)
            .cloned()
            .ok_or_else(|| undeclared(key))
    }

    /// Il valore scritto se regge lo schema, altrimenti il default — la stessa
    /// regola di [`SettingsStore::resolve`], che per un livello solo si scrive
    /// in quattro righe.
    fn resolve(&self, spec: &SettingSpec) -> (SettingValue, SettingSource) {
        if let Some(value) = self.get(&spec.key) {
            if spec.kind.rejects(&value).is_none() {
                return (value, SettingSource::Machine);
            }
        }
        (spec.kind.default_value(), SettingSource::Default)
    }

    pub(super) fn get(&self, key: &str) -> Option<SettingValue> {
        self.values
            .read()
            .expect("livello macchina")
            .get(key)
            .cloned()
    }

    /// Scrive **prima su disco e poi in memoria**, e l'ordine è la riga: al
    /// contrario, una scrittura fallita (disco pieno, permessi, cartella
    /// sparita) lascerebbe il valore nuovo in memoria e quello vecchio nel file,
    /// con l'evento *non* emesso perché il chiamante ha ricevuto un errore —
    /// cioè tre verità per una chiave, e la terza torna al riavvio.
    ///
    /// E ciò che finisce in memoria è il file **fuso**, non la mappa di prima
    /// con la chiave nuova sopra: se un'altra installazione ha scritto altre
    /// chiavi dopo la nostra apertura, quelle sono nel file e da questo momento
    /// sono anche qui.
    ///
    /// # Due lucchetti, e coprono due cose diverse
    ///
    /// **La sezione critica di [`values`](Self::values) è la sostituzione in
    /// memoria, tutta e sola.** L'andata al disco — il lock del file, la
    /// rilettura, la fusione, la scrittura, la rename — sta **fuori**: questo
    /// `Arc` è condiviso da ogni vault aperto e da chi disegna il pannello, e
    /// tenerlo in scrittura per la durata di un'operazione di I/O vuol dire che
    /// chiunque legga *un'altra* impostazione — il livello di log, il tema —
    /// aspetta il disco per una cosa che non lo riguarda. Su un supporto lento
    /// quell'attesa è la shell ferma.
    ///
    /// Il turno di [`write`](Self::write) è ciò che quel restringimento
    /// costa, e non è un di più: **due scritture devono adottare nell'ordine in
    /// cui il disco le ha accettate**. Senza il turno, la fusione più vecchia
    /// può tornare per seconda e posarsi sopra la più recente, lasciando in
    /// memoria una mappa che sul disco non c'è più — cioè la *lost update* che
    /// la [0066](../../../docs/decisions/0195-versioni-indipendenti.md)
    /// aveva tolto al file, rientrata dalla porta della memoria. Il lock del
    /// file serializza le installazioni; questo serializza i thread, che quel
    /// lock non li vede nemmeno.
    pub(super) fn write(&self, key: &str, value: Option<SettingValue>) -> Result<u64, String> {
        let _turn = self.write.acquire();
        self.write_locked(key, value)
    }

    fn write_locked(&self, key: &str, value: Option<SettingValue>) -> Result<u64, String> {
        let Some(path) = &self.path else {
            let mut values = self.values.write().expect("livello macchina");
            match value {
                Some(v) => {
                    values.insert(key.to_string(), v);
                }
                None => {
                    values.remove(key);
                }
            }
            drop(values);
            let mut file = self.profile_state.write().expect("machine profiles");
            match self.values.read().expect("livello macchina").get(key) {
                Some(v) => {
                    file.values.insert(
                        key.to_string(),
                        serde_json::to_value(v).map_err(|e| e.to_string())?,
                    );
                }
                None => {
                    file.values.remove(key);
                }
            }
            return Ok(self.note_write(key));
        };
        let zone = store(path, key, value)?;
        *self.values.write().expect("livello macchina") = zone;
        if let Ok(file) = load_raw_from(path, |p| std::fs::read(p)) {
            *self.profile_state.write().expect("machine profiles") = file;
        }
        Ok(self.note_write(key))
    }

    fn note_write(&self, key: &str) -> u64 {
        let revision = self.next_revision.fetch_add(1, Ordering::Relaxed);
        self.revisions
            .write()
            .expect("revisioni del livello macchina")
            .insert(key.to_owned(), revision);
        revision
    }
}

pub(crate) struct MachineSettingRevision {
    key: String,
    revision: u64,
    /// Il profilo attivo quando l'abbiamo scritta, e il valore scritto: ciò
    /// che il rollback deve ritrovare perché la scelta sia ancora nostra.
    profile: String,
    value: serde_json::Value,
}

impl MachineSettingRevision {
    pub(crate) fn key(&self) -> &str {
        &self.key
    }
}
