//! Un host in memoria per i test delle feature.
//!
//! Serve a provare le feature **contro il contratto** e non contro il kernel:
//! una feature scritta come la scriverebbe un plugin non deve avere altro modo
//! di toccare il mondo che l'[`HostApi`], e un doppio in memoria lo dimostra
//! meglio di un vault vero (i test e2e col kernel vero ci sono comunque, in
//! `tests/`).
//!
//! Il pezzo che conta è l'**orologio che si muove a comando**: è il guadagno di
//! aver messo il tempo nel contratto, e permette di invecchiare le fasce di
//! ritenzione del versioning senza piantare timestamp finti dentro lo store.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use fubmd_abi::event::Event;
use fubmd_abi::model::DocId;
use fubmd_abi::traits::{HostApi, JobId, JobSpec};
use fubmd_abi::PluginError;

/// Storage dei blob e dei documenti in memoria, più un orologio pilotabile.
#[derive(Default)]
pub struct MemoryHost {
    blobs: Mutex<BTreeMap<String, Vec<u8>>>,
    docs: Mutex<BTreeMap<String, String>>,
    now: AtomicU64,
}

impl MemoryHost {
    pub fn new() -> Self {
        let host = MemoryHost::default();
        host.now.store(1_700_000_000_000, Ordering::Relaxed);
        host
    }

    /// Sposta l'orologio in avanti di `ms`.
    pub fn avanza(&self, ms: u64) {
        self.now.fetch_add(ms, Ordering::Relaxed);
    }

    /// Aggiunge un documento al vault finto (stile builder).
    pub fn con_documento(self, id: &str, source: &str) -> Self {
        self.docs
            .lock()
            .unwrap()
            .insert(id.to_string(), source.to_string());
        self
    }

    /// Fa sparire un documento **senza emettere eventi**: è ciò che accade
    /// quando un `DocumentRemoved` va perso in un troncamento della coda.
    pub fn dimentica_documento(&self, id: &str) {
        self.docs.lock().unwrap().remove(id);
    }

    /// Sposta un documento **senza emettere eventi**: il rename perso.
    pub fn rinomina_di_nascosto(&self, from: &str, to: &str) {
        let mut docs = self.docs.lock().unwrap();
        if let Some(source) = docs.remove(from) {
            docs.insert(to.to_string(), source);
        }
    }
}

impl HostApi for MemoryHost {
    fn read_document(&self, id: &DocId) -> Result<String, PluginError> {
        self.docs
            .lock()
            .unwrap()
            .get(id.as_str())
            .cloned()
            .ok_or_else(|| PluginError::BadArgs(format!("{id} non esiste")))
    }

    fn write_document(&mut self, id: &DocId, source: &str) -> Result<(), PluginError> {
        self.docs
            .lock()
            .unwrap()
            .insert(id.to_string(), source.to_string());
        Ok(())
    }

    fn list_documents(&self) -> Result<Vec<DocId>, PluginError> {
        Ok(self.docs.lock().unwrap().keys().map(DocId::new).collect())
    }

    fn emit(&mut self, _event: Event) {}

    fn spawn_job(&mut self, _spec: JobSpec) -> Result<JobId, PluginError> {
        Ok(JobId(0))
    }

    fn storage_get(&self, _key: &str) -> Option<serde_json::Value> {
        None
    }

    fn storage_set(&mut self, _key: &str, _value: serde_json::Value) {}

    fn data_read(&self, path: &str) -> Result<Option<Vec<u8>>, PluginError> {
        Ok(self.blobs.lock().unwrap().get(path).cloned())
    }

    fn data_write(&mut self, path: &str, bytes: &[u8]) -> Result<(), PluginError> {
        self.blobs
            .lock()
            .unwrap()
            .insert(path.to_string(), bytes.to_vec());
        Ok(())
    }

    fn data_remove(&mut self, path: &str) -> Result<(), PluginError> {
        self.blobs.lock().unwrap().remove(path);
        Ok(())
    }

    fn data_list(&self, prefix: &str) -> Result<Vec<String>, PluginError> {
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

    fn now_unix_millis(&self) -> u64 {
        self.now.load(Ordering::Relaxed)
    }
}
