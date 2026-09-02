//! [`ProviderTable`]: un registro di provider di una specie, e **la disciplina
//! di consegna scritta una volta sola** (§7.2).
//!
//! # Cosa era scritto tre volte
//!
//! `deliver_to_handlers`, `flush_indexes` e `view_action` facevano, riga per
//! riga, la stessa cosa:
//!
//! 1. `mem::take` dei provider dal workspace — perché l'host presta
//!    `&mut Workspace` e un provider che vi restasse dentro sarebbe un alias;
//! 2. la chiamata dentro `with_provider_call`, che rimanda il dispatch degli
//!    eventi a *dopo* che la chiamata è tornata (la semantica che il component
//!    model impone a M5: un'istanza non è rientrante);
//! 3. il ripristino, con in coda **chi si è registrato nel frattempo** — un
//!    provider registrato durante la chiamata non si perde per essere arrivato
//!    nel momento sbagliato.
//!
//! Non è codice di servizio: è la semantica di consegna del contratto, ed era
//! già triplicata. Ogni famiglia di provider che il piano aggiunge — le
//! impostazioni (§11.1), i servizi fra plugin (§7.5) — ne avrebbe portata
//! un'altra copia, e una copia che sbaglia il punto 3 perde registrazioni in
//! un caso che nessun test guarda.
//!
//! # Cosa NON fa questa tabella
//!
//! Non decide chi possiede quale id: quello dipende dalla specie (una view ha
//! id di view, un comando id di comando) e sta dove gli id si conoscono. Qui
//! c'è ciò che è **uguale** per tutte le specie, che è il prestito.

/// I provider di una specie, in ordine di registrazione.
///
/// È un `Vec` con un nome e una disciplina: l'ordine di registrazione è dato
/// (decide chi compare prima negli elenchi e chi è interpellato per primo dove
/// l'ordine conta ancora, come l'import), e il prestito passa da
/// [`Workspace::lend`](crate::Workspace::lend).
pub(crate) struct ProviderTable<T> {
    entries: Vec<T>,
}

impl<T> Default for ProviderTable<T> {
    fn default() -> Self {
        ProviderTable {
            entries: Vec::new(),
        }
    }
}

impl<T> ProviderTable<T> {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn push(&mut self, entry: T) {
        self.entries.push(entry);
    }

    pub(crate) fn len(&self) -> usize {
        self.entries.len()
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub(crate) fn iter(&self) -> std::slice::Iter<'_, T> {
        self.entries.iter()
    }

    pub(crate) fn get(&self, at: usize) -> Option<&T> {
        self.entries.get(at)
    }

    pub(crate) fn position(&self, pred: impl FnMut(&T) -> bool) -> Option<usize> {
        self.entries.iter().position(pred)
    }

    /// Toglie le voci che non superano il filtro: è ciò che serve a una
    /// **sostituzione**, dove chi entra prende il posto di chi c'era.
    pub(crate) fn retain(&mut self, keep: impl FnMut(&T) -> bool) {
        self.entries.retain(keep);
    }

    /// Estrae le voci, lasciando la tabella vuota: il primo passo del prestito.
    pub(crate) fn take(&mut self) -> Vec<T> {
        std::mem::take(&mut self.entries)
    }

    /// Rimette le voci prestate, **in coda a quelle registrate nel frattempo**.
    ///
    /// È il passo che le tre copie avevano in comune e che è facile scrivere
    /// al contrario: chi si è registrato durante la chiamata deve finire dopo
    /// chi c'era già, o l'ordine di registrazione — che è dato — dipenderebbe
    /// da quando qualcuno ha chiamato.
    pub(crate) fn restore(&mut self, lent: Vec<T>) {
        let registered_meanwhile = std::mem::take(&mut self.entries);
        self.entries = lent;
        self.entries.extend(registered_meanwhile);
    }
}

impl<T> std::ops::Index<usize> for ProviderTable<T> {
    type Output = T;

    fn index(&self, at: usize) -> &T {
        &self.entries[at]
    }
}

impl<T> std::ops::IndexMut<usize> for ProviderTable<T> {
    fn index_mut(&mut self, at: usize) -> &mut T {
        &mut self.entries[at]
    }
}

// ---------------------------------------------------------------------------
// Il registro dei provider (§8.1)
// ---------------------------------------------------------------------------

use std::sync::Arc;

use fub_abi::command::CommandSpec;
use fub_abi::traits::{
    CommandProvider, EventHandler, ServiceProvider, ViewInstance, ViewProvider, ViewSpec,
};
use fub_abi::transfer::{ExportProvider, ExportTarget, ImportProvider};
use fub_abi::PluginError;

use crate::plugins::{PluginInfo, PluginRegistry, RegistrationKind, RegistryError};
use crate::poison::SharedShelter;
use crate::workspace::Trust;

/// Un provider registrato, con **ciò che ha dichiarato al momento della
/// registrazione**.
///
/// Le spec sono dato di registrazione e non una chiamata al provider, ed è la
/// metà kernel del §5.5. Prima `view_owner` chiamava `views()` su *ogni*
/// provider per risolvere un id, e `check_params` la richiamava sul vincitore
/// per convalidare i parametri: due giri di allocazioni per azione, sul
/// percorso caldo di ogni render — e con le istanze (decisione 0016) quel
/// percorso è diventato quello di ogni click.
///
/// La domanda che questo risolve non è di prestazioni ma di **forma**: chi
/// possiede la verità su cosa un provider offre. La risposta è il registro, dal
/// momento in cui il provider gliel'ha detta; un provider che cambia idea lo
/// dichiara ([`ProviderRegistry::refresh_specs`]), invece di farlo scoprire a
/// chi interroga.
pub(crate) struct RegisteredView {
    pub(crate) id: String,
    pub(crate) provider: Arc<SharedShelter<Box<dyn ViewProvider>>>,
    pub(crate) specs: Vec<ViewSpec>,
    /// Quanto ci si fida di ciò che produce. Sta qui e non fra le spec perché è
    /// una proprietà di **chi manda**, non di ciò che ha dichiarato: lo stesso
    /// albero è legittimo da una feature ufficiale e inaccettabile da un plugin
    /// sandboxato. I comandi non ce l'hanno, e non è una dimenticanza — da un
    /// comando non passa un albero di UI.
    pub(crate) trust: Trust,
}

/// Ciò che un `ViewProvider` dichiara, chiesto **una volta sola**: le spec, e
/// per ognuna la maschera dell'esemplare che la shell monta da sé (§22.3).
///
/// I campi `refresh` e `follows` della spec sono la dichiarazione fatta prima
/// che un esemplare esistesse; dal §22.3 la maschera è dell'esemplare, e per
/// l'esemplare unico ([`ViewInstance::only`]) le due coincidono per
/// costruzione. Risolverle qui — e non a ogni lettura — è ciò che tiene in
/// piedi «le spec sono dato di registrazione»: il kernel possiede la verità, e
/// chi cambia idea lo dice passando da [`Providers::refresh_specs`].
///
/// Chi apre un esemplare **con parametri** non passa di qui: la sua maschera
/// gliela risponde `Workspace::view_interests`, ed è il verso in cui il §22.3
/// continua.
pub(crate) fn declared_specs(provider: &dyn ViewProvider) -> Vec<ViewSpec> {
    provider
        .views()
        .into_iter()
        .map(|mut spec| {
            let interests = provider.interests(&ViewInstance::only(&spec.id));
            spec.refresh = interests.refresh;
            spec.follows = interests.follows;
            spec
        })
        .collect()
}

pub(crate) struct RegisteredCommand {
    pub(crate) id: String,
    pub(crate) provider: Arc<dyn CommandProvider>,
    pub(crate) specs: Vec<CommandSpec>,
}

/// **Chi è registrato, cosa ha dichiarato, e chi possiede quale nome.**
///
/// Uno dei cinque componenti in cui il §8.1 scompone il `Workspace`. Mette
/// insieme le sei tabelle di provider, il registro dei plugin della
/// [decisione 0021](../../../docs/decisions/0185-capability-un-solo-guard.md) e le due catene
/// di chiamate in corso (servizi e comandi), perché sono la stessa domanda vista
/// da lati diversi: *chi c'è, cosa ha promesso, e sta già girando?*
///
/// # Cosa **non** sta qui: chiamarli
///
/// È il taglio che conta, ed è netto. Ogni chiamata a un provider vuole un
/// `HostApi`, e un `HostApi` è costruito su `&mut Workspace` — cioè su **tutto**
/// il workspace, non su questo componente. Quindi `render_view`, `view_action`,
/// `invoke_command`, `import`, `export`, `call_service` e `deliver_to_handlers`
/// restano orchestratori sul `Workspace`, e qui c'è solo ciò che si risponde
/// **senza svegliare nessuno**: chi possiede un id, cosa ha dichiarato, di chi
/// ci si fida.
///
/// La distinzione non è estetica. È esattamente la linea lungo cui il §8.3 ha
/// messo il `RwLock` ([decisione 0024](../../../docs/decisions/README.md)):
/// le risposte qui sotto sono letture pure, non toccano né il vault né gli
/// indici, e girano sotto prestito **condiviso**; le chiamate no, e non
/// potranno mai esserlo.
pub(crate) struct ProviderRegistry {
    /// Handler registrati, ognuno col proprio id (feature ufficiali; a M4/M5 i
    /// plugin via registry). L'id non è decorativo: è lo spazio dei nomi dello
    /// storage che l'`HostApi` concede a quell'handler, e chi lo assegna è il
    /// kernel — non l'handler, che altrimenti sceglierebbe il proprio recinto.
    pub(crate) handlers: ProviderTable<(String, Box<dyn EventHandler>)>,
    /// Chi è registrato, cosa ha dichiarato, cosa ha registrato (§7.3, §7.6).
    pub(crate) plugins: PluginRegistry,
    /// Chi offre servizi agli altri plugin (§7.5). Come i comandi sono `Arc` e
    /// non `Box`, e per la stessa ragione: un servizio deve restare
    /// **raggiungibile durante una propria chiamata**, o A→B→C non troverebbe
    /// C. `call` prende `&self`, quindi condividere il puntatore basta.
    pub(crate) services: ProviderTable<(String, Arc<dyn ServiceProvider>)>,
    /// La catena dei servizi in corso, dal più esterno al più interno: rifiuta
    /// una ricorsione **nominandola** invece di scoprirla come stack overflow.
    pub(crate) service_stack: Vec<String>,
    /// Provider di import, interpellati **in ordine**: il primo che riconosce
    /// una sorgente la prende. Come per handler e indici, l'id è lo spazio dati
    /// che l'`HostApi` concede al provider.
    pub(crate) imports: ProviderTable<(String, Box<dyn ImportProvider>)>,
    /// Provider di export. Non hanno un ordine che conta: una richiesta nomina
    /// una destinazione, e la destinazione ha un proprietario solo.
    pub(crate) exports: ProviderTable<(String, Box<dyn ExportProvider>)>,
    /// View dichiarative registrate, col grado di fiducia di chi le produce.
    /// Ogni albero di UI che entra nell'host passa dal `Workspace`, che è il
    /// punto unico in cui `UiNode::validate_untrusted` viene applicato: qui c'è
    /// solo *di chi ci si fida*, che è il dato su cui quella decisione si basa.
    pub(crate) views: ProviderTable<RegisteredView>,
    /// Provider di comandi, in ordine di registrazione. Senza [`Trust`], a
    /// differenza delle view: la fiducia serve dove passa **contenuto attivo**
    /// (`Html`/`WebView`), e da un comando non passa un albero di UI — l'unica
    /// stringa che l'esito porta all'utente (`notify`) è testo semplice. Ciò
    /// che serve a un comando è un *permesso* (§7.3), che è un'altra domanda.
    ///
    /// Sono `Arc` e non `Box` — soli fra i provider, con i servizi — perché
    /// devono restare **raggiungibili durante una propria chiamata**: col
    /// `run_command` della decisione 0013 un comando ne invoca un altro, e se il
    /// registro fosse svuotato per la durata dell'invocazione (la disciplina di
    /// view, indici e handler) la macro non troverebbe nessuno dei comandi che
    /// deve comporre.
    pub(crate) commands: ProviderTable<RegisteredCommand>,
    /// La catena dei comandi in corso, dal più esterno al più interno: serve a
    /// rifiutare una ricorsione **nominandola** (`a → b → a`) invece di
    /// scoprirla come stack overflow. È anche ciò che limita la profondità: i
    /// comandi registrati sono finiti e nessuno può comparire due volte.
    pub(crate) command_stack: Vec<String>,
}

impl ProviderRegistry {
    pub(crate) fn new() -> Self {
        Self {
            handlers: ProviderTable::new(),
            plugins: PluginRegistry::new(),
            services: ProviderTable::new(),
            service_stack: Vec::new(),
            imports: ProviderTable::new(),
            exports: ProviderTable::new(),
            views: ProviderTable::new(),
            commands: ProviderTable::new(),
            command_stack: Vec::new(),
        }
    }

    // --- chi c'è -----------------------------------------------------------

    /// L'inventario di ciò che è **attivo** (§7.6): chi è registrato, con quale
    /// manifest, quale fiducia, quali permessi, e cosa ha registrato.
    pub(crate) fn inventory(&self) -> Vec<PluginInfo> {
        self.plugins.iter().map(PluginInfo::of).collect()
    }

    /// Il grado di fiducia di un plugin dichiarato.
    pub(crate) fn trust_of(&self, plugin: &str) -> Option<Trust> {
        self.plugins.trust_of(plugin)
    }

    /// Un plugin può nominare questo id?
    ///
    /// Serve al topic di un `Event::Custom`, che è l'unico nome del contratto
    /// senza un momento di registrazione in cui verificarlo: si controlla
    /// quando lo si emette.
    pub(crate) fn owns_name(
        &self,
        plugin: &str,
        id: &str,
    ) -> std::result::Result<(), fub_abi::rules::ids::IdFault> {
        let owner = match self.plugins.trust_of(plugin) {
            Some(Trust::Core) => fub_abi::rules::ids::Owner::Core,
            _ => fub_abi::rules::ids::Owner::Plugin(plugin),
        };
        fub_abi::rules::ids::check(id, owner)
    }

    // --- cosa hanno dichiarato ---------------------------------------------

    /// Le view offerte dai provider registrati, in ordine di registrazione.
    /// **Con chi le ha dichiarate**: il proprietario serve per risolverne i
    /// testi, perché il catalogo giusto è quello suo e non uno solo per tutti
    /// (§12.1). Prima esisteva anche la forma senza — l'elenco nudo — e non ha
    /// più clienti: chi legge le spec le legge per mostrarle.
    pub(crate) fn view_specs_by_owner(&self) -> Vec<(String, ViewSpec)> {
        self.views
            .iter()
            .flat_map(|r| r.specs.iter().map(|s| (r.id.clone(), s.clone())))
            .collect()
    }

    /// I comandi offerti dai provider registrati, in ordine di registrazione.
    /// Con chi li ha dichiarati. Vedi
    /// [`view_specs_by_owner`](Self::view_specs_by_owner).
    pub(crate) fn command_specs_by_owner(&self) -> Vec<(String, CommandSpec)> {
        self.commands
            .iter()
            .flat_map(|r| r.specs.iter().map(|s| (r.id.clone(), s.clone())))
            .collect()
    }

    /// Le destinazioni di export offerte dai provider registrati.
    pub(crate) fn export_targets(&self) -> Vec<ExportTarget> {
        self.exports.iter().flat_map(|(_, p)| p.targets()).collect()
    }

    // --- chi possiede cosa -------------------------------------------------

    /// Chi possiede una view, per posizione. `UnknownView` se nessuno.
    pub(crate) fn view_owner(&self, view: &str) -> std::result::Result<usize, PluginError> {
        self.views
            .position(|r| r.specs.iter().any(|spec| spec.id == view))
            .ok_or_else(|| PluginError::UnknownView(view.to_string().into()))
    }

    /// Chi possiede un comando, per posizione. `UnknownCommand` se nessuno.
    pub(crate) fn command_owner(&self, command: &str) -> std::result::Result<usize, PluginError> {
        self.commands
            .position(|r| r.specs.iter().any(|spec| spec.id == command))
            .ok_or_else(|| PluginError::UnknownCommand(command.to_string().into()))
    }

    /// I parametri di un'istanza reggono la spec che il provider ha dichiarato?
    pub(crate) fn check_params(
        &self,
        at: usize,
        instance: &ViewInstance,
    ) -> std::result::Result<(), PluginError> {
        let spec = self.views[at]
            .specs
            .iter()
            .find(|spec| spec.id == instance.view)
            .ok_or_else(|| PluginError::UnknownView(instance.view.clone().into()))?;
        spec.validate_params(&instance.params)
    }

    /// Rilegge le spec di un provider che dichiara di aver cambiato idea.
    ///
    /// Un rifiuto non cambia niente: le due famiglie si convalidano **prima**
    /// che l'una o l'altra si muova.
    pub(crate) fn refresh_specs(&mut self, id: &str) -> std::result::Result<(), RegistryError> {
        // Le spec si chiedono una volta sola, anche qui: chiederle per
        // convalidarle e poi di nuovo per tenerle sarebbe due risposte diverse
        // dalla stessa domanda, che è precisamente ciò che questo metodo esiste
        // per evitare.
        let views: Vec<(usize, Vec<ViewSpec>)> = self
            .views
            .iter()
            .enumerate()
            .filter(|(_, v)| v.id == id)
            .map(|(at, v)| {
                let provider = v.provider.read();
                (at, declared_specs(provider.as_ref()))
            })
            .collect();
        let commands: Vec<(usize, Vec<CommandSpec>)> = self
            .commands
            .iter()
            .enumerate()
            .filter(|(_, c)| c.id == id)
            .map(|(at, c)| (at, c.provider.commands()))
            .collect();

        let view_ids: Vec<String> = views
            .iter()
            .flat_map(|(_, specs)| specs.iter().map(|s| s.id.clone()))
            .collect();
        let command_ids: Vec<String> = commands
            .iter()
            .flat_map(|(_, specs)| specs.iter().map(|s| s.id.clone()))
            .collect();

        self.plugins
            .admit_refreshing(id, RegistrationKind::View, &view_ids)?;
        self.plugins
            .admit_refreshing(id, RegistrationKind::Command, &command_ids)?;

        for (at, specs) in views {
            self.views[at].specs = specs;
        }
        for (at, specs) in commands {
            self.commands[at].specs = specs;
        }
        self.plugins.resettle(id, RegistrationKind::View, &view_ids);
        self.plugins
            .resettle(id, RegistrationKind::Command, &command_ids);
        Ok(())
    }
}
