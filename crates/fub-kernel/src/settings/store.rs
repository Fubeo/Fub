//! Il livello di un vault: `SettingsStore`, con lo schema dichiarato e il
//! valore effettivo di ogni chiave.

use super::*;

/// Una chiave **dichiarata**: lo schema, e di chi è.
///
/// Il proprietario non sta nella `SettingSpec` e non ci deve stare: la spec è
/// ciò che il plugin dichiara di sé, il proprietario è ciò che l'host sa di lui
/// — la stessa distinzione di [`Trust`](crate::Trust), che non sta nel manifest
/// per la stessa ragione. Serve a rispondere a
/// [`IndexQuery::Settings { plugin }`](fub_abi::traits::IndexQuery::Settings)
/// senza dedurre il proprietario dal prefisso della chiave: le chiavi del core
/// un prefisso non ce l'hanno.
struct Declared {
    spec: SettingSpec,
    plugin: String,
    /// Il posto nella sequenza delle dichiarazioni: chi dichiara scrive le
    /// proprie chiavi nell'ordine in cui vanno lette, e
    /// [`SettingsStore::entries`] le restituisce così.
    seq: u64,
}

/// Lo store di configurazione di **un vault**.
pub struct SettingsStore {
    specs: BTreeMap<String, Declared>,
    /// Il prossimo [`Declared::seq`]. Solo cresce: una chiave ritirata e poi
    /// ridichiarata va in fondo, come un componente appena acceso.
    next_seq: u64,
    vault_path: Utf8PathBuf,
    /// Il supporto del vault (§15.1). `settings.json` sta dentro `.fub/`, cioè
    /// **dentro il vault**: passa da qui e non da `std::fs`, o il giorno in cui
    /// un vault vive su un supporto che cifra la sua configurazione resterebbe
    /// in chiaro accanto ai documenti cifrati
    /// ([0065](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md)).
    storage: Arc<dyn VaultStorage>,
    /// Il livello del vault, che è **anche** ciò che sta nel file: un
    /// [`Durable`] perché «su disco prima, in memoria dopo» smettesse di
    /// essere una frase in un commento e diventasse l'unico ordine scrivibile.
    vault: Durable<BTreeMap<String, SettingValue>>,
    machine: Arc<MachineSettings>,
    /// Le chiavi il cui valore del vault **non si legge** finché qualcuno non
    /// lo guarda (§23.13): vedi [`SettingsStore::suspend`] e la nota in testa al
    /// modulo. Vuoto per quasi ogni vault, ed è la forma giusta — una
    /// sospensione è un'eccezione con un elenco, non uno stato.
    suspended: BTreeSet<String>,
    /// Cosa è andato storto **leggendo**: un file malformato, una chiave di
    /// macchina scritta dentro un vault. Chi monta le stampa; il canale vero è
    /// il §20.2.
    warnings: Vec<String>,
}

impl SettingsStore {
    /// Apre lo store di un vault: carica il livello del vault e si aggancia a
    /// quello della macchina.
    pub fn open(
        root: &Utf8Path,
        storage: Arc<dyn VaultStorage>,
        machine: Arc<MachineSettings>,
    ) -> Self {
        let vault_path = root.join(crate::vault::FUB_DIR).join("settings.json");
        let (vault, warnings) = match load_from(&vault_path, |p| storage.read(p)) {
            Ok(values) => (values, Vec::new()),
            // Come per la macchina: un file rotto non impedisce di aprire il
            // vault. La differenza è che qui la perdita è più grave — è la
            // configurazione **autorevole** — e per questo l'avviso resta a
            // disposizione di chi lo sa mostrare invece di finire su stderr e
            // basta.
            Err(and) => (BTreeMap::new(), vec![and]),
        };
        SettingsStore {
            specs: BTreeMap::new(),
            next_seq: 0,
            vault_path,
            storage,
            vault: Durable::new(vault),
            machine,
            suspended: BTreeSet::new(),
            warnings,
        }
    }

    /// Le scorciatoie che il file **di questo vault** dichiara, come chiave →
    /// accordo (§23.13).
    ///
    /// Guarda il file e non gli schemi, e non è un dettaglio: chi deve decidere
    /// se sospenderle è chi monta, e chiama **prima** che i provider di comandi
    /// si registrino — cioè prima che quelle chiavi siano dichiarate da
    /// qualcuno. Una scorciatoia scritta per un comando che questo montaggio non
    /// ha esce di qui lo stesso, ed è giusto: il giorno che quel componente si
    /// accende, il valore che stava lì ad aspettarlo non deve diventare attivo
    /// senza che nessuno l'abbia mai visto.
    ///
    /// I valori che non sono testo non ci sono: una chiave di scorciatoia con un
    /// numero dentro è un file scritto male, che `declare` diagnostica e
    /// `resolve` scarta già per conto suo.
    pub fn vault_keybindings(&self) -> BTreeMap<String, String> {
        self.vault
            .iter()
            .filter(|(key, _)| fub_abi::settings::command_of_keybinding_key(key).is_some())
            .filter_map(|(key, value)| match value {
                SettingValue::Text(chord) => Some((key.clone(), chord.clone())),
                _ => None,
            })
            .collect()
    }

    /// Sospende il valore *del vault* di queste chiavi: [`resolve`] le tratta
    /// come se il file non ne parlasse, e sotto resta il default dello schema.
    ///
    /// Sostituisce l'elenco invece di aggiungersi, perché una sospensione è la
    /// risposta a una domanda fatta tutta insieme — *cosa, di ciò che questo
    /// file porta, non è ancora stato guardato* — e due chiamate che si
    /// sommassero lascerebbero sospesa una chiave a cui qualcuno ha già detto di
    /// sì.
    ///
    /// Non tocca il file. Una sospensione che cancellasse sarebbe irreversibile
    /// dove il caso è **il dubbio**, ed è la riga della
    /// [0099](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md):
    /// delle due mosse si sospende quella che non si disfa.
    ///
    /// [`resolve`]: SettingsStore::resolve
    pub fn suspend(&mut self, keys: BTreeSet<String>) {
        self.suspended = keys;
    }

    /// Le chiavi sospese adesso.
    pub fn suspended(&self) -> &BTreeSet<String> {
        &self.suspended
    }

    /// Gli avvisi raccolti finora, e li **svuota**: chi li legge se ne fa
    /// carico, e un avviso mostrato due volte è peggio di uno mostrato una.
    pub fn take_warnings(&mut self) -> Vec<String> {
        std::mem::take(&mut self.warnings)
    }

    fn profile_file(&self) -> Result<SettingsFile, String> {
        load_raw_from(&self.vault_path, |p| self.storage.read(p))
    }

    fn change_profiles(
        &mut self,
        change: impl Fn(&mut SettingsFile) -> Result<(), String>,
    ) -> Result<(), String> {
        let file = change_vault_profiles(self.storage.as_ref(), &self.vault_path, change)?;
        let values = supported_values(&file);
        self.vault.update(|| Ok::<_, String>(values))?;
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

    pub fn import_profile(&mut self, json: &str) -> Result<(), String> {
        let profile: SettingsProfile = serde_json::from_str(json).map_err(|e| e.to_string())?;
        self.change_profiles(|file| add_profile(file, profile.clone()))
    }

    pub fn duplicate_profile(&mut self, source: &str, name: &str) -> Result<(), String> {
        self.change_profiles(|file| {
            let mut profile = file
                .profile(source)
                .ok_or_else(|| format!("unknown profile `{source}`"))?;
            profile.name = name.into();
            add_profile(file, profile)
        })
    }

    pub fn switch_profile(&mut self, name: &str) -> Result<(), String> {
        self.change_profiles(|file| file.switch_profile(name))
    }

    pub fn reset_profile(&mut self, name: &str) -> Result<(), String> {
        let declared: BTreeMap<String, SettingSpec> = self
            .specs
            .iter()
            .filter(|(_, d)| d.spec.scope == SettingScope::Vault)
            .map(|(key, d)| (key.clone(), d.spec.clone()))
            .collect();
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
                reset(&mut file.profiles.get_mut(name).expect("checked").values);
            }
            Ok(())
        })
    }

    /// Dichiara le chiavi di un plugin. Un doppione è un errore **del
    /// chiamante**, e chi lo riceve non dichiara il plugin: due schemi sulla
    /// stessa chiave sono due default e due specie, e chi legge prenderebbe
    /// quello che l'ordine di montaggio gli ha lasciato.
    pub fn declare(&mut self, plugin: &str, specs: &[SettingSpec]) -> Result<(), String> {
        // Il doppione si cerca in due posti, e il secondo è quello che si
        // dimentica: fra ciò che è già dichiarato, e **dentro lo stesso
        // manifest**. Confrontare solo con `self.specs` lascia passare un
        // manifest che nomina due volte la stessa chiave, e a vincere sarebbe
        // l'ultima — che è la forma peggiore dello stesso errore, perché non la
        // vede nemmeno chi ha scritto il plugin.
        let mut seen = std::collections::BTreeSet::new();
        for spec in specs {
            if let Some(incumbent) = self.specs.get(&spec.key) {
                return Err(format!(
                    "l'impostazione `{}` è già dichiarata da `{}`",
                    spec.key, incumbent.plugin
                ));
            }
            if !seen.insert(spec.key.as_str()) {
                return Err(format!(
                    "`{plugin}` dichiara due volte l'impostazione `{}`",
                    spec.key
                ));
            }
        }
        for spec in specs {
            // Il valore del vault che non regge lo schema si scarta **qui**,
            // cioè nel momento in cui esiste qualcuno che sa dire cosa
            // quella chiave accetta. Prima di questa dichiarazione era solo una
            // riga in un file.
            // E si guarda **il livello che la chiave dichiara**, non tutti e
            // due: da quando `resolve` non scala più (0076), un valore nel file
            // sbagliato non è un valore scartato — è un valore che nessuno
            // leggerà mai, e dirlo come se fosse stato *ignorato per la sua
            // forma* manderebbe a cercare il difetto dalla parte opposta.
            let (level, present) = match spec.scope {
                SettingScope::Vault => (SettingSource::Vault, self.vault.get(&spec.key).cloned()),
                SettingScope::Machine => (SettingSource::Machine, self.machine.get(&spec.key)),
            };
            if let Some(value) = present {
                if let Some(why) = spec.kind.rejects(&value) {
                    self.warnings.push(format!(
                        "impostazione `{}` ignorata (livello {level:?}): {why}",
                        spec.key
                    ));
                }
            }
            if spec.scope == SettingScope::Machine && self.vault.contains_key(&spec.key) {
                self.warnings.push(format!(
                    "l'impostazione `{}` è della macchina: il valore scritto nel \
                     vault non viene applicato",
                    spec.key
                ));
            }
            let seq = self.next_seq;
            self.next_seq += 1;
            self.specs.insert(
                spec.key.clone(),
                Declared {
                    spec: spec.clone(),
                    plugin: plugin.to_string(),
                    seq,
                },
            );
        }
        Ok(())
    }

    /// Ritira le chiavi di un plugin che smette (`deactivate_plugin`).
    ///
    /// I **valori restano scritti**, ed è il punto: spegnere una feature non
    /// cancella come l'avevi configurata, o riaccenderla vorrebbe dire
    /// riconfigurarla. Sparisce lo schema, cioè la possibilità di leggerla e di
    /// scriverla — che è esattamente ciò che vuol dire «quella feature non c'è».
    pub fn withdraw(&mut self, plugin: &str) {
        self.specs.retain(|_, d| d.plugin != plugin);
    }

    fn declared(&self, key: &str) -> Result<&Declared, PluginError> {
        self.specs.get(key).ok_or_else(|| undeclared(key))
    }

    /// Il valore che vale adesso, e da dove viene.
    pub fn effective(&self, key: &str) -> Result<(SettingValue, SettingSource), PluginError> {
        let declared = self.declared(key)?;
        Ok(self.resolve(declared))
    }

    /// Il livello che una chiave dichiara, e **nient'altro sotto di lui**.
    ///
    /// Fino alla 0076 una chiave di vault non trovata nel vault scendeva al file
    /// della macchina, e quella era la precedenza. Adesso non c'è: una chiave ha
    /// un posto, e sotto quel posto c'è il default dello schema. Ciò che si
    /// guadagna è la domanda a cui si può rispondere guardando un file solo —
    /// *perché questo vault è chiaro?* — e ciò che si perde è nominato nel
    /// verbale: un vault nuovo riparte dalle impostazioni di fabbrica.
    ///
    /// Un valore che non regge lo schema non è un valore: si ricade sul default,
    /// come se non ci fosse. La sua diagnosi è già un avviso (vedi [`declare`]),
    /// e restituirlo qui vorrebbe dire dare a chi legge un `bool` dove il suo
    /// codice si aspetta un numero.
    ///
    /// Una chiave **sospesa** (§23.13) si legge come se il file del vault non ne
    /// parlasse: torna il default dello schema, e `SettingSource::Default` dice
    /// il vero — nessuno *che valga* ha deciso quel valore. La sospensione non
    /// è una quarta provenienza perché non dura: o la si scioglie guardandola, o
    /// la si scioglie scrivendo, e un vocabolario nel contratto per uno stato
    /// che finisce sarebbe firma pagata per un'attesa.
    ///
    /// [`declare`]: SettingsStore::declare
    fn resolve(&self, declared: &Declared) -> (SettingValue, SettingSource) {
        let spec = &declared.spec;
        let (found, source) = match spec.scope {
            SettingScope::Vault if self.suspended.contains(&spec.key) => {
                (None, SettingSource::Default)
            }
            SettingScope::Vault => (self.vault.get(&spec.key).cloned(), SettingSource::Vault),
            SettingScope::Machine => (self.machine.get(&spec.key), SettingSource::Machine),
        };
        if let Some(value) = found {
            if spec.kind.rejects(&value).is_none() {
                return (value, source);
            }
        }
        (spec.kind.default_value(), SettingSource::Default)
    }

    /// Lo schema di una chiave dichiarata.
    pub fn spec(&self, key: &str) -> Option<&SettingSpec> {
        self.specs.get(key).map(|d| &d.spec)
    }

    /// Tutte le righe risolte, o quelle di un plugin, in ordine di
    /// dichiarazione: un plugin le elenca nel suo manifest nell'ordine in cui
    /// vanno lette, e un ordine per chiave metterebbe «accento» prima di «tema».
    pub fn entries(&self, plugin: Option<&str>) -> Vec<SettingEntry> {
        self.entries_by_owner(plugin)
            .into_iter()
            .map(|(_, and)| and)
            .collect()
    }

    /// Le stesse, **con chi le ha dichiarate**: il proprietario non sta nella
    /// [`SettingSpec`] (e non ci deve stare, vedi [`Declared`]), ma è ciò che
    /// dice quale catalogo di stringhe risolve le sue etichette (§12.1).
    pub fn entries_by_owner(&self, plugin: Option<&str>) -> Vec<(String, SettingEntry)> {
        let mut declared: Vec<&Declared> = self
            .specs
            .values()
            .filter(|d| plugin.is_none_or(|p| d.plugin == p))
            .collect();
        declared.sort_by_key(|d| d.seq);
        declared
            .into_iter()
            .map(|d| {
                let (value, source) = self.resolve(d);
                (
                    d.plugin.clone(),
                    SettingEntry {
                        spec: d.spec.clone(),
                        value,
                        source,
                    },
                )
            })
            .collect()
    }

    /// Scrive una chiave nel livello che il suo scope dichiara.
    ///
    /// Torna lo scope in cui ha scritto: è ciò che finisce dentro
    /// [`Event::SettingChanged`](fub_abi::Event::SettingChanged), e chi lo
    /// riceve lo legge per sapere se il cambio riguarda questo vault o la
    /// macchina intera.
    pub fn set(&mut self, key: &str, value: SettingValue) -> Result<SettingScope, PluginError> {
        let spec = self.declared(key)?.spec.clone();
        if let Some(why) = spec.kind.rejects(&value) {
            return Err(PluginError::BadArgs(format!("`{key}`: {why}").into()));
        }
        self.write(&spec, Some(value))
    }

    /// Dimentica ciò che era stato deciso: la chiave ricade al livello sotto.
    pub fn reset(&mut self, key: &str) -> Result<SettingScope, PluginError> {
        let spec = self.declared(key)?.spec.clone();
        self.write(&spec, None)
    }

    fn write(
        &mut self,
        spec: &SettingSpec,
        value: Option<SettingValue>,
    ) -> Result<SettingScope, PluginError> {
        match spec.scope {
            SettingScope::Machine => {
                self.machine
                    .write(&spec.key, value)
                    .map_err(|and| PluginError::Internal(and.into()))?;
            }
            SettingScope::Vault => {
                // Su disco prima, in memoria dopo: non più perché lo dica
                // questo commento, ma perché `Durable` non sa esprimere
                // l'altro ordine — la ragione sta là sopra.
                //
                // E **ciò che si adotta è la fusione, non la propria copia
                // mutata**: la chiave che si scrive è una, il file può averne
                // altre che qualcun altro ha messo dopo la nostra apertura, e
                // tenersi la propria mappa vorrebbe dire essere l'unico a non
                // sapere che ci sono (vedi [`store_vault`]).
                let (path, storage) = (&self.vault_path, self.storage.as_ref());
                let key = spec.key.clone();
                self.vault
                    .update(|| store_vault(storage, path, &key, value))
                    .map_err(|and| PluginError::Internal(and.into()))?;
                // **Scrivere risveglia**, e sta qui perché qui passano tutti e
                // due i modi di scrivere — il valore e l'azzeramento. A scrivere
                // un'impostazione è una persona davanti al pannello (la via dei
                // programmi ha il suo cancello, `program_writable`, e le
                // scorciatoie non lo aprono), quindi ciò che esce da questa riga
                // è un valore che qualcuno ha appena guardato. Lasciarlo sospeso
                // vorrebbe dire scrivere in un file una riga che nessuno
                // leggerà, che è la cosa che la 0076 esiste per non avere.
                //
                // **Una chiave alla volta**, e non l'elenco: chi rimappa *una*
                // scorciatoia non ha guardato le altre cinque che quel vault
                // portava, e adottargliele tutte al primo gesto sarebbe
                // esattamente il sì che questa voce esiste per non far dare per
                // sbaglio.
                self.suspended.remove(&spec.key);
            }
        }
        Ok(spec.scope)
    }

    /// Il livello macchina, per chi apre un secondo vault sulla stessa
    /// installazione.
    pub fn machine(&self) -> &Arc<MachineSettings> {
        &self.machine
    }

    pub(crate) fn initialize_machine_default_tracked(
        &self,
        key: &str,
        value: SettingValue,
    ) -> Result<Option<MachineSettingRevision>, PluginError> {
        let declared = self.declared(key)?;
        if declared.spec.scope != SettingScope::Machine {
            return Err(PluginError::BadArgs(
                format!("`{key}` is not a machine setting").into(),
            ));
        }
        if let Some(why) = declared.spec.kind.rejects(&value) {
            return Err(PluginError::BadArgs(format!("`{key}`: {why}").into()));
        }
        self.machine.set_validated_if_default_tracked(key, value)
    }

    pub(crate) fn rollback_machine_if_current(
        &self,
        receipt: &MachineSettingRevision,
    ) -> Result<bool, PluginError> {
        let declared = self.declared(receipt.key())?;
        if declared.spec.scope != SettingScope::Machine {
            return Err(PluginError::BadArgs(
                format!("`{}` is not a machine setting", receipt.key()).into(),
            ));
        }
        self.machine.reset_validated_if_current(receipt)
    }
}
