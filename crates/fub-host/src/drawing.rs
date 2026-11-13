//! I disegni aperti nel motore del disegno (piano K5,
//! `docs/architecture/disegno.md`): le sei porte lato host, come quelle delle
//! cartelle di Excel in [`crate::workbook`].
//!
//! Il client resta lo scrittore del file: apre un'istanza sul testo della sua
//! `DocumentSession` (`drawing_open`), le porta le modifiche
//! (`drawing_sync`), le manda i gesti e i comandi (`drawing_gesture`,
//! `drawing_commands`, `drawing_command`) e la chiude (`drawing_close`). Le
//! forme sono quelle di `fub_abi::drawing`, e ogni richiesta passa da
//! `validate()` prima di arrivare al motore.
//!
//! - **Le istanze sono per vault**: una mappa radice → istanza, sotto un
//!   lucchetto che si prende per trovare l'istanza e si lascia prima di
//!   chiamarla. Ogni istanza ha il suo lucchetto: due finestre sullo stesso
//!   file sono due istanze e non si aspettano. La chiusura del vault toglie
//!   le sue istanze dalla mappa; un gesto in corso tiene la sua finché non
//!   finisce, e l'istanza si chiude dopo.
//! - **Il motore è quello del processo** (`Disegni::processo`), iscritto nei
//!   motori di `fub-motori`; alla prima apertura l'host dà ai servizi del
//!   processo i caratteri di Fub, gli stessi dell'export
//!   ([`fub_features::draw::facce`]). Un motore che non si costruisce è
//!   `Internal` con il motivo nel log, e un nuovo tentativo lo ricostruisce:
//!   il `Pigro` non ricorda il fallimento.
//! - **Il motore si spegne nel vault** (D-14 (a)): la riga
//!   `fub.motore-vettoriale` della pagina Componenti, o i disegni spenti
//!   ([`crate::componenti::motore_disegno_spento`]). Spento, `drawing_open`
//!   risponde `Unserved` prima di costruire qualunque cosa; spento mentre il
//!   vault ha disegni aperti (`apply_components`), le istanze del vault si
//!   chiudono come alla chiusura del vault, e una loro richiesta dopo
//!   risponde `Unserved`. Se non resta nessuna istanza in nessun vault, il
//!   motore si libera e la memoria torna al sistema. Riacceso, l'host non
//!   riapre niente: riapre il client.
//! - **Senza la feature `engine-drawing`** le porte ci sono e rispondono
//!   `Unserved`: il motore non c'è in questa build, e il client ricade sugli
//!   strumenti semplici.
//!
//! Un vault che non è aperto dà l'errore di ogni porta che nomina un vault
//! (quello dei comandi Grid); un'istanza che il vault non ha, chiusa o mai
//! aperta, è `NotFound` come un'istanza Grid sconosciuta.

use fub_abi::{
    DocId, DrawingCommandInfo, DrawingCommandRequest, DrawingGesture, DrawingOpen, DrawingOutcome,
    DrawingSync, DrawingSynced, PluginError,
};

use crate::session::Host;

#[cfg(feature = "engine-drawing")]
mod engine {
    use std::collections::{BTreeMap, BTreeSet, HashMap};
    use std::sync::{Arc, Mutex, Once, OnceLock};

    use camino::{Utf8Path, Utf8PathBuf};
    use fub_abi::{Arg, PluginError, Text, MAX_DRAWING_OPS};
    use fub_disegno::motore::{Disegni, Disegno};
    use fub_motori::{Caratteri, Generiche, Servizi, Voce};

    /// Un'istanza aperta: il suo lucchetto è suo, non della mappa.
    pub(super) type Instance = Arc<Mutex<Disegno>>;

    /// Radice del vault → istanza → disegno.
    type Open = BTreeMap<Utf8PathBuf, HashMap<String, Instance>>;

    /// I disegni aperti nel motore, per vault.
    #[derive(Default)]
    pub(crate) struct Drawings {
        /// Il motore: quello del processo, o quello dato da una prova.
        engine: OnceLock<Arc<Disegni>>,
        /// Le istanze aperte, per vault.
        open: Mutex<Open>,
    }

    impl Drawings {
        /// Un registro su un motore dato (per le prove).
        pub(crate) fn on(engine: Arc<Disegni>) -> Self {
            Self {
                engine: OnceLock::from(engine),
                open: Mutex::default(),
            }
        }

        /// Il motore, quello del processo se nessuno ne ha dato un altro. Al
        /// primo uso del motore del processo, i suoi servizi ricevono i
        /// caratteri di Fub.
        pub(super) fn engine(&self) -> Arc<Disegni> {
            Arc::clone(self.engine.get_or_init(|| {
                give_fonts();
                Disegni::processo()
            }))
        }

        fn map(&self) -> Result<std::sync::MutexGuard<'_, Open>, PluginError> {
            self.open
                .lock()
                .map_err(|_| PluginError::Internal(Text::key("host.drawing.poisoned")))
        }

        /// Mette l'istanza nel vault `root`.
        pub(super) fn insert(
            &self,
            root: &Utf8Path,
            instance: String,
            drawing: Disegno,
        ) -> Result<(), PluginError> {
            self.map()?
                .entry(root.to_owned())
                .or_default()
                .insert(instance, Arc::new(Mutex::new(drawing)));
            Ok(())
        }

        /// L'istanza `instance` del vault `root`. Il lucchetto della mappa
        /// si lascia qui: chi chiama il motore tiene soltanto quello
        /// dell'istanza.
        pub(super) fn find(
            &self,
            root: &Utf8Path,
            instance: &str,
        ) -> Result<Instance, PluginError> {
            self.map()?
                .get(root)
                .and_then(|open| open.get(instance))
                .cloned()
                .ok_or_else(|| unknown(instance))
        }

        /// Toglie l'istanza dal vault `root` e la restituisce, così che cada
        /// fuori dal lucchetto della mappa.
        pub(super) fn remove(&self, root: &Utf8Path, instance: &str) -> Option<Instance> {
            let mut map = self.map().ok()?;
            let open = map.get_mut(root)?;
            let removed = open.remove(instance);
            if open.is_empty() {
                map.remove(root);
            }
            removed
        }

        /// Il vault `root` si chiude: le sue istanze lasciano la mappa e
        /// cadono qui, fuori dal lucchetto. Un gesto in corso tiene la sua
        /// istanza finché non finisce.
        pub(crate) fn forget_vault(&self, root: &Utf8Path) {
            let gone = match self.open.lock() {
                Ok(mut map) => map.remove(root),
                Err(poisoned) => poisoned.into_inner().remove(root),
            };
            if let Some(gone) = gone {
                tracing::debug!(vault = %root, instances = gone.len(), "fub.disegno: il vault si chiude con i suoi disegni");
                drop(gone);
            }
        }

        /// Il motore si è spento nel vault `root`: le sue istanze si chiudono
        /// come alla chiusura del vault. Se non resta nessuna istanza in
        /// nessun vault, il motore costruito si libera e la memoria torna al
        /// sistema; un gesto in corso tiene il suo motore finché non finisce.
        /// Dà quante istanze si sono chiuse.
        pub(crate) fn switch_off(&self, root: &Utf8Path) -> usize {
            let (gone, idle) = {
                let mut map = match self.open.lock() {
                    Ok(map) => map,
                    Err(poisoned) => poisoned.into_inner(),
                };
                let gone = map.remove(root);
                (gone, map.is_empty())
            };
            let closed = gone.as_ref().map_or(0, HashMap::len);
            drop(gone);
            tracing::debug!(vault = %root, instances = closed, "fub.disegno: il motore si spegne nel vault");
            if idle {
                // Solo un motore già nato: spegnere non lo costruisce.
                if let Some(engine) = self.engine.get() {
                    let was_on = engine.libera();
                    engine.svuota();
                    tracing::debug!(
                        was_on,
                        "fub.disegno: nessun disegno aperto, il motore si libera"
                    );
                }
            }
            closed
        }

        /// Ogni vault si chiude.
        pub(crate) fn forget_all(&self) {
            let gone = match self.open.lock() {
                Ok(mut map) => std::mem::take(&mut *map),
                Err(poisoned) => std::mem::take(&mut *poisoned.into_inner()),
            };
            drop(gone);
        }

        /// Quante istanze ha il vault `root`.
        pub(crate) fn count(&self, root: &Utf8Path) -> usize {
            self.open
                .lock()
                .map(|map| map.get(root).map_or(0, HashMap::len))
                .unwrap_or(0)
        }
    }

    /// Dà ai servizi del processo i caratteri di Fub, una volta sola. Se
    /// qualcuno li ha già dati, restano i suoi.
    fn give_fonts() {
        static GIVEN: Once = Once::new();
        GIVEN.call_once(|| {
            use fub_features::draw::{facce, FAMIGLIA_MONO, FAMIGLIA_SANS, FAMIGLIA_SERIF};
            let fonts = Caratteri::nuovi(
                facce().iter().copied(),
                Generiche {
                    serif: FAMIGLIA_SERIF.to_string(),
                    sans: FAMIGLIA_SANS.to_string(),
                    mono: FAMIGLIA_MONO.to_string(),
                },
            );
            if Servizi::processo().fornisci_caratteri(fonts).is_err() {
                tracing::debug!("fub.disegno: i servizi del processo avevano già i caratteri");
            }
        });
    }

    /// Un'istanza che il vault non ha: chiusa, o di un vault chiuso, o mai
    /// aperta. Come un'istanza Grid sconosciuta.
    pub(super) fn unknown(instance: &str) -> PluginError {
        PluginError::NotFound(Text::message(
            "host.drawing.instance",
            vec![Arg::text("instance", instance)],
        ))
    }

    /// Il motore è spento nel vault: il client ricade sugli strumenti
    /// semplici, come in una build senza il motore.
    pub(super) fn switched_off() -> PluginError {
        PluginError::Unserved(Text::key("host.drawing.engine_off"))
    }

    /// Un'istanza il cui lucchetto è avvelenato: una chiamata al motore si è
    /// fermata a metà. Il client la dice «Motore fermo» e la riapre.
    pub(super) fn stopped(instance: &str) -> PluginError {
        PluginError::Internal(Text::message(
            "host.drawing.stopped",
            vec![Arg::text("instance", instance)],
        ))
    }

    /// La selezione di `drawing_commands`, con le regole delle selezioni di
    /// `fub_abi::drawing`: nessun id vuoto o ripetuto, al più
    /// [`MAX_DRAWING_OPS`].
    pub(super) fn selection(list: &[String]) -> Result<(), PluginError> {
        let bad = |message: String| PluginError::BadArgs(message.into());
        if list.len() > MAX_DRAWING_OPS {
            return Err(bad(format!(
                "`selection` has {} ids, at most {MAX_DRAWING_OPS}",
                list.len()
            )));
        }
        let mut seen = BTreeSet::new();
        for id in list {
            if id.is_empty() {
                return Err(bad("`selection` has an empty id".into()));
            }
            if !seen.insert(id.as_str()) {
                return Err(bad(format!("`selection` repeats the id `{id}`")));
            }
        }
        Ok(())
    }
}

#[cfg(feature = "engine-drawing")]
pub(crate) use engine::Drawings;

/// Senza il motore il registro è vuoto.
#[cfg(not(feature = "engine-drawing"))]
#[derive(Default)]
pub(crate) struct Drawings {}

#[cfg(not(feature = "engine-drawing"))]
impl Drawings {
    pub(crate) fn forget_vault(&self, _root: &camino::Utf8Path) {}
    pub(crate) fn forget_all(&self) {}
}

/// Il rifiuto delle porte in una build senza il motore del disegno.
#[cfg(not(feature = "engine-drawing"))]
fn unserved() -> PluginError {
    PluginError::Unserved(fub_abi::Text::key("host.drawing.unserved"))
}

#[cfg(feature = "engine-drawing")]
impl Host {
    /// Prende l'istanza `instance` del vault nominato e le applica `f`, con
    /// il solo lucchetto dell'istanza.
    fn with_drawing<R>(
        &self,
        vault: Option<&str>,
        instance: &str,
        f: impl FnOnce(&mut fub_disegno::motore::Disegno) -> Result<R, PluginError>,
    ) -> Result<R, PluginError> {
        let root = self.root(vault)?;
        let drawing = self
            .drawings
            .find(&root, instance)
            .map_err(|missing| self.missing(&root, missing))?;
        let mut drawing = drawing.lock().map_err(|_| engine::stopped(instance))?;
        f(&mut drawing)
    }

    /// Un'istanza che il vault non ha: se il motore è spento nel vault,
    /// `Unserved` (le sue istanze si sono chiuse con lui); altrimenti
    /// l'errore della ricerca. Le chiavi si leggono soltanto qui, non a ogni
    /// gesto.
    fn missing(&self, root: &camino::Utf8Path, missing: PluginError) -> PluginError {
        match self.drawing_engine_off(Some(root.as_str())) {
            Ok(true) => engine::switched_off(),
            _ => missing,
        }
    }

    /// `apply_components` ha cambiato la riga del motore o dei disegni nel
    /// vault `root`: spento, le istanze del vault si chiudono. Acceso, niente.
    pub(crate) fn drawing_engine_switched(&self, root: &camino::Utf8Path) {
        match self.drawing_engine_off(Some(root.as_str())) {
            Ok(true) => {
                self.drawings.switch_off(root);
            }
            Ok(false) => {}
            Err(error) => {
                tracing::debug!(vault = %root, %error, "fub.disegno: lo stato del motore non si legge");
            }
        }
    }
}

impl Host {
    /// Apre un'istanza del motore sul testo di `doc` (a capo LF, come lo
    /// tiene il client), nel vault nominato. Due aperture dello stesso file
    /// sono due istanze.
    pub fn drawing_open(
        &self,
        vault: Option<&str>,
        doc: &DocId,
        text: &str,
    ) -> Result<DrawingOpen, PluginError> {
        #[cfg(feature = "engine-drawing")]
        {
            let root = self.root(vault)?;
            // Spento nel vault: niente si costruisce.
            if self.drawing_engine_off(Some(root.as_str()))? {
                return Err(engine::switched_off());
            }
            let engine = self.drawings.engine();
            let (drawing, opened) = fub_disegno::motore::Disegno::apri_con(&engine, text)
                .inspect_err(|error| {
                    if matches!(error, PluginError::Internal(_)) {
                        tracing::warn!(doc = %doc.as_str(), %error, "fub.disegno: il motore non apre il disegno");
                    }
                })?;
            self.drawings
                .insert(&root, opened.instance.clone(), drawing)?;
            // La chiusura del vault toglie le istanze dopo aver segnato la
            // sessione come in chiusura: se il vault si è chiuso mentre il
            // motore apriva, o l'ha già tolta, o questa riga lo vede.
            if let Err(closed) = self.root(Some(root.as_str())) {
                drop(self.drawings.remove(&root, &opened.instance));
                return Err(closed);
            }
            // Lo stesso per il motore spento mentre apriva: `apply_components`
            // scrive le chiavi e poi chiude le istanze, quindi o l'ha già
            // tolta, o questa lettura vede le chiavi nuove.
            if self
                .drawing_engine_off(Some(root.as_str()))
                .unwrap_or(false)
            {
                drop(self.drawings.remove(&root, &opened.instance));
                return Err(engine::switched_off());
            }
            tracing::debug!(doc = %doc.as_str(), instance = %opened.instance, "fub.disegno: aperto");
            Ok(opened)
        }
        #[cfg(not(feature = "engine-drawing"))]
        {
            let _ = (vault, doc, text);
            Err(unserved())
        }
    }

    /// Porta all'istanza un cambio del testo; la copia del motore si
    /// reimporta in sottofondo.
    pub fn drawing_sync(
        &self,
        vault: Option<&str>,
        instance: &str,
        sync: DrawingSync,
    ) -> Result<DrawingSynced, PluginError> {
        #[cfg(feature = "engine-drawing")]
        {
            sync.validate()?;
            self.with_drawing(vault, instance, |drawing| drawing.sincronizza(sync))
        }
        #[cfg(not(feature = "engine-drawing"))]
        {
            let _ = (vault, instance, sync);
            Err(unserved())
        }
    }

    /// Un pezzo di gesto: l'anteprima, o le operazioni al `commit`.
    pub fn drawing_gesture(
        &self,
        vault: Option<&str>,
        instance: &str,
        gesture: DrawingGesture,
    ) -> Result<DrawingOutcome, PluginError> {
        #[cfg(feature = "engine-drawing")]
        {
            gesture.validate()?;
            self.with_drawing(vault, instance, |drawing| drawing.gesto(gesture))
        }
        #[cfg(not(feature = "engine-drawing"))]
        {
            let _ = (vault, instance, gesture);
            Err(unserved())
        }
    }

    /// I comandi del disegno, accesi o spenti sulla selezione.
    pub fn drawing_commands(
        &self,
        vault: Option<&str>,
        instance: &str,
        selection: &[String],
    ) -> Result<Vec<DrawingCommandInfo>, PluginError> {
        #[cfg(feature = "engine-drawing")]
        {
            engine::selection(selection)?;
            self.with_drawing(vault, instance, |drawing| Ok(drawing.comandi(selection)))
        }
        #[cfg(not(feature = "engine-drawing"))]
        {
            let _ = (vault, instance, selection);
            Err(unserved())
        }
    }

    /// Un comando del disegno sulla selezione.
    pub fn drawing_command(
        &self,
        vault: Option<&str>,
        instance: &str,
        request: DrawingCommandRequest,
    ) -> Result<DrawingOutcome, PluginError> {
        #[cfg(feature = "engine-drawing")]
        {
            request.validate()?;
            self.with_drawing(vault, instance, |drawing| drawing.comando(request))
        }
        #[cfg(not(feature = "engine-drawing"))]
        {
            let _ = (vault, instance, request);
            Err(unserved())
        }
    }

    /// Chiude l'istanza. Un gesto in corso la tiene finché non finisce.
    pub fn drawing_close(&self, vault: Option<&str>, instance: &str) -> Result<(), PluginError> {
        #[cfg(feature = "engine-drawing")]
        {
            let root = self.root(vault)?;
            let closed = self
                .drawings
                .remove(&root, instance)
                .ok_or_else(|| self.missing(&root, engine::unknown(instance)))?;
            drop(closed);
            Ok(())
        }
        #[cfg(not(feature = "engine-drawing"))]
        {
            let _ = (vault, instance);
            Err(unserved())
        }
    }

    /// Un host con un motore del disegno suo invece di quello del processo:
    /// per le prove del motore che non si costruisce.
    #[cfg(feature = "engine-drawing")]
    #[doc(hidden)]
    pub fn with_drawing_engine(
        mut self,
        engine: std::sync::Arc<fub_disegno::motore::Disegni>,
    ) -> Self {
        self.drawings = Drawings::on(engine);
        self
    }

    /// Quante istanze del motore ha aperte il vault nominato (per le prove).
    #[cfg(feature = "engine-drawing")]
    #[doc(hidden)]
    pub fn drawing_instances(&self, vault: Option<&str>) -> Result<usize, PluginError> {
        let root = self.root(vault)?;
        Ok(self.drawings.count(&root))
    }
}
