//! Gli handler di evento e l'`HostApi` prestato ai provider.

use super::*;

impl Workspace {
    /// Registra un [`EventHandler`] per conto di un plugin dichiarato.
    ///
    /// `plugin` è l'identità di chi lo offre: determina lo spazio dello storage
    /// persistente che l'`HostApi` gli concede (`.fub/plugins/<id>/`, con cache in `.fub/data/plugins/<id>/`) e
    /// **i permessi con cui girerà**. Un handler non nomina niente di suo, e
    /// quindi non ha id da far collidere: l'unico nome in gioco è quello del
    /// plugin.
    pub fn register_event_handler(
        &mut self,
        plugin: impl Into<String>,
        handler: Box<dyn EventHandler>,
    ) -> std::result::Result<(), RegistryError> {
        let plugin = plugin.into();
        let mut prepared = PreparedRegistration::event_handler(handler);
        let permit = self.registration_permit(&plugin)?;
        self.commit_registration(&permit, &mut prepared)
    }

    /// Presta un [`HostApi`] intestato a un plugin, per la durata di una
    /// chiamata.
    ///
    /// Serve a chi compone le due metà di una feature dall'esterno del
    /// dispatch: l'app apre lo store delle versioni e legge una versione con le
    /// stesse capacità che l'handler usa dentro `handle`, e non con `std::fs`.
    /// A M4 è anche il modo in cui il registry guiderà `Plugin::activate`.
    ///
    /// Le capacità sono **quelle del plugin**, non quelle del chiamante: un id
    /// che nessuno ha dichiarato riceve un host che nega tutto, dicendo perché.
    pub fn with_host<R>(&mut self, plugin: &str, f: impl FnOnce(&mut dyn HostApi) -> R) -> R {
        self.with_host_mode(plugin, InvokeMode::Apply, f)
    }

    /// Come [`with_host`](Self::with_host), conservando la modalità della
    /// chiamata esterna. Serve ai proxy che rientrano per una singola capacità.
    pub fn with_host_mode<R>(
        &mut self,
        plugin: &str,
        mode: InvokeMode,
        f: impl FnOnce(&mut dyn HostApi) -> R,
    ) -> R {
        // Anche questa è una "chiamata di provider" ai fini della consegna:
        // ciò che `f` emette arriva agli handler quando `f` è tornata.
        let result = self.with_provider_call(|ws| {
            let mut host = ws.host_for(plugin, mode);
            f(&mut host)
        });
        self.dispatch_pending();
        result
    }

    /// Variante del proxy di scrittura intestata a un esemplare di view. Le
    /// capacità restano per-chiamata; cambia soltanto il timbro dello stato di
    /// view.
    pub fn with_host_mode_instance<R>(
        &mut self,
        plugin: &str,
        mode: InvokeMode,
        instance: &str,
        f: impl FnOnce(&mut dyn HostApi) -> R,
    ) -> R {
        let mut host = self.host_for_view(plugin, mode, Some(instance));
        f(&mut host)
    }

    /// Presta un [`ReadApi`] intestato a un plugin, per la durata di una
    /// chiamata — il gemello in sola lettura di
    /// [`with_host`](Workspace::with_host).
    ///
    /// Prende `&self`, ed è tutta la ragione per cui esiste: chi ha il workspace
    /// dietro un `RwLock` (l'host, decisione 0024) può servire una lettura con
    /// il prestito **condiviso** invece di quello esclusivo. Passare da
    /// `with_host` anche per leggere rimetterebbe in fila chiunque stia
    /// disegnando, e lo farebbe in silenzio: `write()` al posto di `read()`
    /// compila.
    ///
    /// Il primo cliente è il `JobHost` di `fub-host` (§9.1): un lavoro lungo
    /// che cammina il vault fa quasi solo letture, e sono migliaia.
    pub fn with_read_host<R>(&self, plugin: &str, f: impl FnOnce(&dyn ReadApi) -> R) -> R {
        // Niente `with_provider_call` e niente drenaggio: da qui non si emette
        // e non si scrive, quindi non c'è nessuna coda che possa crescere.
        let host = self.read_host_for(plugin);
        f(&host)
    }

    /// Variante del proxy di lettura intestata a un esemplare di view. È la
    /// stessa politica di `with_read_host`, con in più la chiave dello stato di
    /// view che solo l'host può timbrare correttamente.
    pub fn with_read_host_instance<R>(
        &self,
        plugin: &str,
        instance: &str,
        f: impl FnOnce(&dyn ReadApi) -> R,
    ) -> R {
        let host = self.read_host_for_view(plugin, Some(instance));
        f(&host)
    }

    /// L'host di **lettura** intestato a un plugin, con la stessa politica di
    /// [`host_for`](Workspace::host_for) davanti.
    ///
    /// Non è un `KernelHost` con meno capacità: è un tipo che le altre non le
    /// ha (§7.1), e prende `&self` perché una lettura gira sotto prestito
    /// condiviso del workspace.
    pub(crate) fn read_host_for<'a>(&'a self, plugin: &'a str) -> Guard<ReadHost<'a>, Granted> {
        self.read_host_for_view(plugin, None)
    }

    /// Come [`read_host_for`](Workspace::read_host_for), **per conto di un
    /// esemplare di view**.
    ///
    /// L'esemplare è ciò che rende la chiave dello stato di vista (§11.2) di chi
    /// disegna e non di chiunque: lo timbra l'host, come l'id di un job nella
    /// 0035, perché è l'unico dei due a saperlo con certezza. `None` = non si
    /// sta disegnando una view, e allora uno stato di vista non c'è.
    pub(crate) fn read_host_for_view<'a>(
        &'a self,
        plugin: &'a str,
        instance: Option<&'a str>,
    ) -> Guard<ReadHost<'a>, Granted> {
        Guard::new(
            ReadHost {
                ws: self,
                plugin,
                instance,
            },
            self.providers.plugins.granted(plugin),
        )
    }

    /// **Il punto di applicazione** (§7.3): un host intestato a un plugin, con
    /// davanti la politica che i suoi permessi e la sua fiducia compongono.
    ///
    /// Ogni prestito passa di qui. Prima ne passava nessuno: `KernelHost`
    /// portava `plugin: &str` e `mode`, e nient'altro — non sapeva di chi
    /// fossero le capacità che stava prestando, quindi non poteva negarne
    /// nessuna.
    pub(crate) fn host_for<'a>(
        &'a mut self,
        plugin: &'a str,
        mode: InvokeMode,
    ) -> Guard<KernelHost<'a>, Granted> {
        self.host_for_view(plugin, mode, None)
    }

    /// Come [`host_for`](Workspace::host_for), per conto di un esemplare di
    /// view: vedi [`read_host_for_view`](Workspace::read_host_for_view).
    pub(crate) fn host_for_view<'a>(
        &'a mut self,
        plugin: &'a str,
        mode: InvokeMode,
        instance: Option<&'a str>,
    ) -> Guard<KernelHost<'a>, Granted> {
        // La politica si prende **prima**: dopo, `self` è prestato all'host.
        let granted = self.providers.plugins.granted(plugin);
        Guard::new(
            KernelHost {
                ws: self,
                plugin,
                mode,
                instance,
            },
            granted,
        )
    }

    /// Mette il gancio **prima della scrittura** (0154): l'id del plugin a cui
    /// intestare l'host e la chiusura da chiamare in
    /// [`write_source`](Workspace::write_source) fra il parse e il disco.
    ///
    /// Un gancio per owner, nell'ordine di registrazione: rimetterlo sostituisce
    /// quello dello stesso owner e lascia gli altri al loro posto. `None` toglie
    /// quello dell'owner.
    pub fn set_before_write_hook(&mut self, owner: &str, hook: Option<BeforeWriteHook>) {
        match (
            self.before_write.iter_mut().find(|(held, _)| held == owner),
            hook,
        ) {
            (Some(slot), Some(hook)) => slot.1 = hook,
            (None, Some(hook)) => self.before_write.push((owner.to_owned(), hook)),
            (_, None) => self.before_write.retain(|(held, _)| held != owner),
        }
    }
}
