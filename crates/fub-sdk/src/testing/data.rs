//! Lo spazio dati, le impostazioni, lo stato delle viste, l'ambiente e gli
//! eventi del doppio.

use super::*;

impl DataRead for MemoryHost {
    fn data_read(&self, path: &str) -> Result<Option<Vec<u8>>, PluginError> {
        fence_data(path)?;
        let blob = self.blobs.lock().unwrap().get(path).cloned();
        if let Some(bytes) = &blob {
            self.record_read(path, bytes.len());
        }
        Ok(blob)
    }

    fn data_list(&self, prefix: &str) -> Result<Vec<String>, PluginError> {
        // Il prefisso vuoto è la radice dello spazio dati, e non nomina niente
        // apposta: è l'unico path che non passa dal recinto.
        if !prefix.is_empty() {
            fence_data(prefix)?;
        }
        // Semantica di *cartella*, come l'host vero (`KernelHost`), non di
        // prefisso testuale: un finto che si comporta diversamente dal vero è
        // una trappola che scatta il giorno che si cambia chiamante.
        Ok(self
            .blobs
            .lock()
            .unwrap()
            .keys()
            .filter(|k| prefix.is_empty() || k.starts_with(&format!("{prefix}/")))
            .cloned()
            .collect())
    }

    fn cache_read(&self, path: &str) -> Result<Option<Vec<u8>>, PluginError> {
        fence_data(path)?;
        let blob = self.cache_blobs.lock().unwrap().get(path).cloned();
        if let Some(bytes) = &blob {
            self.record_read(path, bytes.len());
        }
        Ok(blob)
    }
}

impl DataWrite for MemoryHost {
    fn data_write(&mut self, path: &str, bytes: &[u8]) -> Result<(), PluginError> {
        fence_data(path)?;
        if self.writes_negate.lock().unwrap().contains(path) {
            return Err(PluginError::Io(
                format!("scrittura negata su `{path}`").into(),
            ));
        }
        self.blobs
            .lock()
            .unwrap()
            .insert(path.to_string(), bytes.to_vec());
        // Il conto sale **solo** sulle scritture riuscite: una scrittura
        // negata non è lavoro fatto sul disco, e contarla renderebbe il
        // contatore inservibile proprio nei banchi che provano i rifiuti.
        let mut writes = self.writes.lock().unwrap();
        let count = writes.entry(path.to_string()).or_insert((0, 0));
        count.0 += 1;
        count.1 += bytes.len();
        Ok(())
    }

    fn data_remove(&mut self, path: &str) -> Result<(), PluginError> {
        fence_data(path)?;
        self.blobs.lock().unwrap().remove(path);
        Ok(())
    }

    fn cache_write(&mut self, path: &str, bytes: &[u8]) -> Result<(), PluginError> {
        fence_data(path)?;
        if self.writes_negate.lock().unwrap().contains(path) {
            return Err(PluginError::Io(
                format!("scrittura cache negata su `{path}`").into(),
            ));
        }
        self.cache_blobs
            .lock()
            .unwrap()
            .insert(path.to_string(), bytes.to_vec());
        let mut writes = self.writes.lock().unwrap();
        let count = writes.entry(path.to_string()).or_insert((0, 0));
        count.0 += 1;
        count.1 += bytes.len();
        Ok(())
    }
}

impl SettingsRead for MemoryHost {
    fn setting(&self, key: &str) -> Result<SettingValue, PluginError> {
        let settings = self.settings.lock().unwrap();
        let (spec, value) = settings.get(key).ok_or_else(|| {
            PluginError::BadArgs(format!("nessuno ha dichiarato l'impostazione `{key}`").into())
        })?;
        Ok(value.clone().unwrap_or_else(|| spec.kind.default_value()))
    }
}

impl SettingsWrite for MemoryHost {
    /// Il doppio applica **il cancello della chiave** e non quello del
    /// permesso: il secondo è del guard del kernel, il primo è ciò che una
    /// feature scritta come un plugin deve trovarsi davanti anche qui — o il
    /// test proverebbe una scrittura che nell'app vera è un rifiuto.
    fn set_setting(&mut self, key: &str, value: SettingValue) -> Result<(), PluginError> {
        let mut settings = self.settings.lock().unwrap();
        let (spec, slot) = settings.get_mut(key).ok_or_else(|| {
            PluginError::BadArgs(format!("nessuno ha dichiarato l'impostazione `{key}`").into())
        })?;
        if !spec.program_writable {
            return Err(PluginError::PermissionDenied(
                format!("l'impostazione `{key}` non si è dichiarata scrivibile da un programma")
                    .into(),
            ));
        }
        if let Some(why) = spec.kind.rejects(&value) {
            return Err(PluginError::BadArgs(format!("`{key}`: {why}").into()));
        }
        *slot = Some(value);
        Ok(())
    }

    fn reset_setting(&mut self, key: &str) -> Result<(), PluginError> {
        let mut settings = self.settings.lock().unwrap();
        let (spec, slot) = settings.get_mut(key).ok_or_else(|| {
            PluginError::BadArgs(format!("nessuno ha dichiarato l'impostazione `{key}`").into())
        })?;
        if !spec.program_writable {
            return Err(PluginError::PermissionDenied(
                format!("l'impostazione `{key}` non si è dichiarata scrivibile da un programma")
                    .into(),
            ));
        }
        *slot = None;
        Ok(())
    }
}

/// Lo stato di vista del doppio è quello di **un esemplare per volta**, e senza
/// esemplare non c'è: leggere torna `None`, scrivere è `BadArgs`. Non è una
/// mutilazione per comodità — è ciò che risponde l'host vero fuori da una view
/// (`KernelHost`), e un doppio che accettasse la scrittura farebbe passare un
/// provider che nell'app perde quello che crede di ricordare.
impl ViewStateRead for MemoryHost {
    fn view_state(&self, key: &str) -> Result<Option<serde_json::Value>, PluginError> {
        let Some(instance) = self.view_instance.lock().unwrap().clone() else {
            return Ok(None);
        };
        Ok(self
            .view_state
            .lock()
            .unwrap()
            .get(&(instance, key.to_string()))
            .cloned())
    }
}

impl ViewStateWrite for MemoryHost {
    fn set_view_state(
        &mut self,
        key: &str,
        value: Option<serde_json::Value>,
    ) -> Result<(), PluginError> {
        let instance = self.view_instance.lock().unwrap().clone().ok_or_else(|| {
            PluginError::BadArgs(
                "lo stato di vista è di un esemplare di view: dillo con \
                 `MemoryHost::with_instance`"
                    .into(),
            )
        })?;
        let mut states = self.view_state.lock().unwrap();
        match value {
            Some(v) => states.insert((instance, key.to_string()), v),
            None => states.remove(&(instance, key.to_string())),
        };
        Ok(())
    }
}

impl HostEnv for MemoryHost {
    fn now_unix_millis(&self) -> u64 {
        self.now.load(Ordering::Relaxed)
    }

    fn user_locale(&self) -> Locale {
        self.locale.lock().unwrap().clone()
    }

    /// Deterministico, come l'orologio di questo banco: i byte sono un contatore
    /// in little-endian. Un test che generasse identità **vere** non potrebbe
    /// asserire su ciò che produce, e un banco che non si può asserire non
    /// presidia niente. Che siano diversi a ogni chiamata è tutto ciò che serve
    /// a chi verifica di non collidere.
    fn random_bytes(&self, n: u32) -> Result<Vec<u8>, PluginError> {
        // Il contatore in little-endian nei primi otto byte, l'indice negli
        // altri. Due chiamate non danno mai lo stesso blocco — che è la sola
        // promessa della capacità vera — e ogni chiamata è prevedibile, che è la
        // sola cosa che rende asseribile un test.
        if self.without_entropy.load(Ordering::Relaxed) {
            return Err(PluginError::PermissionDenied(
                "questo banco non concede entropia".into(),
            ));
        }
        // Il tetto lo porta anche il doppio, e non è pedanteria: un banco che
        // concedesse ciò che l'host vero rifiuta lascerebbe verde un test scritto
        // sopra una richiesta che in produzione non riesce.
        if n > MAX_RANDOM_BYTES {
            return Err(PluginError::BadArgs(
                format!("chiesti {n} byte di caso, il massimo è {MAX_RANDOM_BYTES}").into(),
            ));
        }
        let base = self.entropy.fetch_add(1, Ordering::Relaxed).to_le_bytes();
        Ok((0..n as usize)
            .map(|the| base.get(the).copied().unwrap_or(the as u8))
            .collect())
    }

    fn active_context(&self) -> Option<ViewContext> {
        self.reads_from_context.fetch_add(1, Ordering::Relaxed);
        self.context.lock().unwrap().clone()
    }
}

impl HostEvents for MemoryHost {
    fn emit(&mut self, _event: Event) {}

    fn spawn_job(&mut self, _spec: JobSpec) -> Result<JobId, PluginError> {
        Ok(JobId(0))
    }
}
