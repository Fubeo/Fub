//! I comandi (`CommandProvider`) e le view dichiarative (`ViewProvider` e i
//! suoi tipi).

use super::*;

// ---------------------------------------------------------------------------
// Comandi
// ---------------------------------------------------------------------------

/// Chi offre azioni al registro dei comandi: la palette, la tastiera, le macro
/// (16.2), la CLI (27.1) e il centro di comando (22.4) sono tutti clienti dello
/// stesso elenco. I tipi stanno in [`crate::command`], che è dove la forma di un
/// comando è ragionata per intero.
///
/// # Come l'host chiama, e cosa garantisce
///
/// - Gli argomenti arrivano **già convalidati** contro la
///   [`CommandSpec`]: un comando non deve difendersi da un chiamante distratto,
///   e i `params` che ha dichiarato sono la sua difesa.
/// - Con [`InvokeMode::DryRun`] — e con qualunque modo, se la spec dice
///   `writes: false` — l'`host` prestato è in **sola lettura**: ogni scrittura
///   risponde [`PluginError::PermissionDenied`]. La simulazione non è una
///   promessa di chi implementa.
/// - La consegna degli eventi è quella di sempre: ciò che il comando emette o
///   scrive arriva agli handler **dopo** che `invoke` è tornata (vedi
///   [`EventHandler`]).
pub trait CommandProvider: Send + Sync {
    fn commands(&self) -> Vec<CommandSpec>;
    /// Esegue (o simula) un comando. `command` è un id fra quelli di
    /// [`commands`](CommandProvider::commands); un id ignoto è
    /// [`PluginError::UnknownCommand`].
    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError>;
}

// ---------------------------------------------------------------------------
// View (UI dichiarativa)
// ---------------------------------------------------------------------------

/// Dove una view si **ancora**. Non è come si disegna — quello è l'albero
/// [`UiNode`] — ma quale superficie della finestra occupa.
///
/// Erano tre (`LeftSidebar`, `RightSidebar`, `Bottom`) e con tre superfici
/// nominate ogni capitolo grande di FEATURES doveva uscire dal contratto per
/// avere un posto dove stare: il grafo lo ha già fatto, con un comando bespoke e
/// un renderer privato, **non** perché sia speciale ma perché non c'era un posto
/// dove metterlo. Il nome è cambiato da `ViewPlacement` a `ViewSurface` perché
/// una voce di menu o una scheda di impostazioni non è un *posto in un layout*:
/// è una superficie della shell a cui ci si attacca. Le tre di prima restano
/// dove erano, in testa e nello stesso ordine, perché sono lo stesso
/// discriminante.
///
/// # Il piano è della superficie, e non della view
///
/// «Chi sta sopra» non è un campo di [`ViewSpec`] e non lo sarà: una view non
/// porta una superficie, ci si **attacca**, e a dipingere è la shell. Il piano
/// appartiene quindi alla superficie — è dichiarato una volta sola, accanto
/// agli altri, in `apps/client/src/theme/struttura.css` — e la regola che lo lega ai
/// tasti è che fra due superfici che intrappolano il fuoco comanda **l'ultima
/// aperta**, che sullo stesso piano è anche l'ultima dipinta. Un numero
/// dichiarato da chi non dipinge sarebbe un secondo ordine accanto a questo, e
/// due ordini che si contraddicono sono esattamente il difetto che quella
/// regola ha tolto.
///
/// Volere un piano diverso, quindi, non è volere un campo: è volere una
/// **superficie** diversa, e quella si chiede aggiungendo un caso in fondo a
/// questo elenco — una mossa additiva, che il freeze non chiude (decisione
/// 0150).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ViewSurface {
    LeftSidebar,
    RightSidebar,
    Bottom,
    /// L'area principale, cioè dove oggi c'è l'editor e basta. È la superficie
    /// che mancava di più: database (11), canvas e slide (12), grafo (7.3),
    /// viste task (10.3), dashboard (11.5) e calendario (10.4) vivono qui, e
    /// senza di essa ognuno di quei capitoli ripete la scappatoia del grafo.
    ///
    /// Che la shell di oggi abbia **un** documento aperto e nessun modello di
    /// tab non è un'obiezione: il modello di layout è la feature 3.3 (§1.2), e
    /// il contratto deve poter nominare la superficie prima che la shell sappia
    /// dividerla in due.
    Main,
    /// Una finestra modale: la view che chiede qualcosa e se ne va.
    Modal,
    /// La barra di stato: poco spazio, sempre visibile. Il posto di ciò che
    /// informa senza interrompere — lo stato del sync (18.1), il conteggio
    /// parole, l'indicizzazione in corso.
    StatusBar,
    /// La barra delle icone: i pulsanti che aprono qualcosa.
    Ribbon,
    /// Una voce nel menu dell'app.
    Menu,
    /// Una voce nel menu contestuale. La shell le ospita in coda al menu di una
    /// nota, di una cartella o di un file dell'albero
    /// (`apps/client/src/ui/context-views.ts`).
    ///
    /// Il bersaglio del clic **non** lo dice il contesto di sessione:
    /// [`ViewContext`](crate::session::ViewContext) non ha quel campo e non lo
    /// avrà, perché un bersaglio è vero per un istante mentre quel record si
    /// legge quando capita. Viaggia con l'**invocazione**, dove già viaggia ciò
    /// su cui un comando agisce (decisione 0152): nei `params` di
    /// `render_view` e `view_action`, e solo per le chiavi che la view dichiara
    /// fra i propri [`ParamSpec`](crate::command::ParamSpec): `target` (l'id di
    /// ciò su cui si è cliccato) e `target_kind` (`note`, `folder` o `file`).
    ContextMenu,
    /// Una scheda nelle impostazioni (28): è ciò che rende le impostazioni di un
    /// plugin indistinguibili da quelle del core, invece di una finestra a
    /// parte che il plugin deve inventarsi.
    SettingsTab,
}

impl ViewSurface {
    /// Ogni superficie, una volta sola.
    ///
    /// Esiste per la stessa ragione di `Capability::ALL`: tutto ciò che vuole
    /// dire qualcosa su **tutte** le superfici sta a valle di questo elenco, e
    /// senza di lui lo direbbe a memoria. Il §16.7 chiama quella forma col suo
    /// nome — *esaustivo a memoria, non per costruzione* — e qui aveva già
    /// sbagliato: l'intestazione del banco della shell contava «sette superfici
    /// su otto» quando erano dieci, e nessun presidio se n'era accorto perché
    /// nessuno confrontava il conto con l'enum.
    ///
    /// L'ordine è quello della dichiarazione. Chi aggiunge una variante la
    /// aggiunge anche qui, e il presidio dei discriminanti glielo ricorda in
    /// rosso invece che a M5.
    pub const ALL: [ViewSurface; 10] = [
        ViewSurface::LeftSidebar,
        ViewSurface::RightSidebar,
        ViewSurface::Bottom,
        ViewSurface::Main,
        ViewSurface::Modal,
        ViewSurface::StatusBar,
        ViewSurface::Ribbon,
        ViewSurface::Menu,
        ViewSurface::ContextMenu,
        ViewSurface::SettingsTab,
    ];
}

/// Un esemplare vivo di una view: *quale* view, *quale* esemplare, e con quali
/// parametri.
///
/// È l'altra metà della decisione 0007. Quella risponde a «quale documento sta
/// guardando questa view»; questa a «quale delle tre istanze di questa view
/// sono io». Senza, [`ViewProvider::views`] restituisce un elenco **statico** e
/// non c'è modo di dire *questa view, con questo parametro* — cioè le viste
/// multiple di un database (11.2), le viste salvate (8.3), le query embed
/// parametriche (9.2), una dashboard per progetto (11.5), un canvas per file
/// (12), i task per tag / per cartella / per data (10.3): la stessa view, filtri
/// diversi.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ViewInstance {
    /// L'id della [`ViewSpec`] di cui questa è un'istanza.
    pub view: String,
    /// L'identità dell'esemplare, unica fra le istanze **vive**. La sceglie la
    /// shell che apre, da sé o eseguendo un
    /// [`CommandEffect::OpenView`](crate::command::CommandEffect::OpenView); il
    /// provider la riceve e basta. Per la view che la shell monta da sola —
    /// quella dichiarata, senza parametri — è l'id della view: un esemplare
    /// solo che si chiama come la sua specie.
    pub instance: String,
    /// Gli argomenti dichiarati in [`ViewSpec::params`], già convalidati contro
    /// di essi come lo sono quelli di un comando: un provider non deve
    /// difendersi da un chiamante distratto.
    #[serde(default)]
    pub params: serde_json::Value,
}

impl ViewInstance {
    /// L'istanza unica di una view senza parametri.
    pub fn only(view: impl Into<String>) -> Self {
        let view = view.into();
        ViewInstance {
            instance: view.clone(),
            view,
            params: serde_json::Value::Null,
        }
    }

    pub fn new(
        view: impl Into<String>,
        instance: impl Into<String>,
        params: serde_json::Value,
    ) -> Self {
        ViewInstance {
            view: view.into(),
            instance: instance.into(),
            params,
        }
    }

    /// Un parametro, per nome.
    pub fn param(&self, name: &str) -> Option<&serde_json::Value> {
        self.params.get(name)
    }

    /// Un parametro testuale — la forma che serve quasi sempre.
    pub fn text_param(&self, name: &str) -> Option<&str> {
        self.param(name).and_then(|v| v.as_str())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ViewSpec {
    pub id: String,
    pub title: Text,
    pub surface: ViewSurface,
    /// Dichiarazione di interesse: gli eventi al cui arrivo la shell deve
    /// ridisegnare questa view (chiamare di nuovo `render_view`).
    ///
    /// **Dal §22.3 questo campo è ciò che l'host ci ha scritto, non ciò che il
    /// provider ci scrive**: la maschera la dichiara
    /// [`ViewProvider::interests`], per esemplare, e l'host risolve qui quella
    /// dell'esemplare unico quando prende in carico la spec. Scriverlo dal
    /// provider non è un errore ed è ancora il modo di dirlo in un posto solo —
    /// ma è `interests` a essere chiesta, e se le due dicessero cose diverse
    /// vince lei. Maschera vuota = nessun ridisegno event-driven.
    ///
    /// È il pezzo di protocollo che dice *quando* una view invecchia: senza,
    /// la shell può solo indovinare per conoscenza privata delle feature — e
    /// per una view di plugin non può indovinare niente. Maschera vuota =
    /// nessun ridisegno event-driven.
    ///
    /// Una view che dichiara
    /// [`IndexUpdated`](crate::event::EventKind::IndexUpdated) deve dichiarare
    /// anche [`BatchEnded`](crate::event::EventKind::BatchEnded): dentro un
    /// lotto (decisione 0011) il primo non arriva, e il secondo è ciò che le fa fare
    /// **un** ridisegno dove prima ne faceva N. Vale a rovescio per una view che
    /// segue i documenti: quelli passano tutti, lotto o no.
    #[serde(default)]
    pub refresh: EventMask,
    /// L'altra metà della stessa dichiarazione, per ciò che **non è un evento
    /// del vault**: le parti del contesto di sessione
    /// ([`HostEnv::active_context`]) al cui cambio questa view invecchia.
    ///
    /// Vale parola per parola ciò che è scritto su [`refresh`](Self::refresh):
    /// dal §22.3 le due metà si dichiarano insieme in [`ViewInterests`], e
    /// questo campo è dove l'host posa la risposta per l'esemplare unico.
    ///
    /// Esiste perché "la shell ridisegna comunque quando cambia il documento
    /// attivo" smette di essere sostenibile appena il contesto porta anche la
    /// **selezione**: ridisegnare ogni view a ogni movimento del cursore
    /// significherebbe interrogare l'indice a ogni battuta di tasto. Chi segue
    /// il cursore lo dichiara e viene servito; chi mostra il vault intero (una
    /// vista a grafo, il pannello tag) non dichiara nulla e resta fermo.
    #[serde(default)]
    pub follows: ContextMask,
    /// Gli argomenti con cui si può aprire un'**istanza** di questa view.
    ///
    /// Sono gli stessi [`ParamSpec`] dei comandi, e non un secondo tipo con lo
    /// stesso mestiere: chi apre una view parametrica lo fa quasi sempre da un
    /// comando ([`CommandEffect::OpenView`](crate::command::CommandEffect::OpenView)),
    /// e due grammatiche di parametri vorrebbero dire due convalide, due
    /// descrizioni per un umano e due modi di sbagliarle. Vuoto = la view ha una
    /// sola istanza, quella che la shell monta da sé.
    #[serde(default)]
    pub params: Vec<ParamSpec>,
    /// L'icona con cui la shell la nomina dove non c'è spazio per il titolo (la
    /// ribbon, una scheda). Un nome del repertorio della shell, come
    /// [`UiKind::Icon`](crate::ui::UiKind::Icon); ciò che non conosce lo ignora.
    #[serde(default)]
    pub icon: Option<String>,
    /// L'ordine fra le view della stessa superficie: crescente, i pari merito
    /// nell'ordine di registrazione. Con tre pannelli decideva la shell per
    /// conoscenza privata di quali fossero; con le superfici del §2.2 non ha più
    /// su cosa decidere.
    #[serde(default)]
    pub order: i32,
    /// È aperta appena la superficie esiste, o aspetta che qualcuno la chieda?
    /// Il default (`false`) è **chiusa**, perché una view che si apre da sola
    /// costa lo spazio di tutti quelli che non la volevano.
    #[serde(default)]
    pub open_by_default: bool,
    /// La dimensione che vorrebbe, in pixel logici, sull'asse che la sua
    /// superficie lascia decidere (la larghezza in una sidebar, l'altezza in
    /// basso). È una preferenza: la shell la usa alla prima apertura, e da lì in
    /// poi comanda ciò che l'utente ha trascinato.
    #[serde(default)]
    pub preferred_size: Option<u32>,
    /// Si può chiudere? Il default (`true`) è sì. Una view che dice di no sta
    /// dicendo che la sua superficie non ha senso senza di lei — la barra di
    /// stato di chi la sta usando come tale.
    #[serde(default = "crate::ipc::default_true")]
    pub closable: bool,
}

impl ViewSpec {
    /// Le tre cose che una view non può non dire. Tutto il resto ha un default
    /// dichiarato qui e si aggiunge col builder: con dieci campi, una `ViewSpec`
    /// scritta a mano diventa un elenco di `Default::default()` in cui la riga
    /// che conta non si distingue.
    pub fn new(id: impl Into<String>, title: impl Into<Text>, surface: ViewSurface) -> Self {
        ViewSpec {
            id: id.into(),
            title: title.into(),
            surface,
            refresh: EventMask::default(),
            follows: ContextMask::default(),
            params: Vec::new(),
            icon: None,
            order: 0,
            open_by_default: false,
            preferred_size: None,
            closable: true,
        }
    }

    /// Gli eventi al cui arrivo questa view è invecchiata.
    pub fn refreshing(mut self, refresh: EventMask) -> Self {
        self.refresh = refresh;
        self
    }

    /// Le parti del contesto di sessione che questa view segue.
    pub fn following(mut self, follows: ContextMask) -> Self {
        self.follows = follows;
        self
    }

    pub fn with_params(mut self, params: Vec<ParamSpec>) -> Self {
        self.params = params;
        self
    }

    pub fn with_icon(mut self, icon: impl Into<String>) -> Self {
        self.icon = Some(icon.into());
        self
    }

    pub fn ordered(mut self, order: i32) -> Self {
        self.order = order;
        self
    }

    pub fn open_by_default(mut self) -> Self {
        self.open_by_default = true;
        self
    }

    pub fn sized(mut self, preferred_size: u32) -> Self {
        self.preferred_size = Some(preferred_size);
        self
    }

    pub fn unclosable(mut self) -> Self {
        self.closable = false;
        self
    }

    /// I parametri di un'istanza sono compilabili contro questa spec?
    ///
    /// È la stessa convalida degli argomenti di un comando, e letteralmente la
    /// stessa funzione: chi apre una view da un comando e chi la apre a mano
    /// devono ricevere la stessa risposta sullo stesso argomento sbagliato.
    pub fn validate_params(&self, params: &serde_json::Value) -> Result<(), PluginError> {
        crate::command::validate_params(&self.id, &self.params, params)
    }
}

impl Localize for ViewSpec {
    fn visit_texts(&mut self, visit: &mut dyn FnMut(&mut Text)) {
        visit(&mut self.title);
        self.params.visit_texts(visit);
    }
}

/// **Quando questa view invecchia**, per l'esemplare che lo chiede (§22.3).
///
/// Le due metà stanno in un record solo perché sono la stessa dichiarazione
/// vista su due canali — gli eventi del vault (`refresh`) e il contesto di
/// sessione (`follows`) — e separarle darebbe due posti dove la stessa view può
/// dire due cose diverse su quando ridisegnarsi.
///
/// I campi omonimi di [`ViewSpec`] restano il **caso largo**: sono la
/// dichiarazione fatta prima che un esemplare esistesse, e per l'esemplare unico
/// ([`ViewInstance::only`]) le due cose coincidono per costruzione — è l'host a
/// risolverle, dove le spec si chiedono.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ViewInterests {
    #[serde(default)]
    pub refresh: EventMask,
    #[serde(default)]
    pub follows: ContextMask,
}

/// Chi disegna una view.
///
/// # Perché `render_view` prende `&self` e `on_action` `&mut self`
///
/// Le due firme dicono insieme cosa può essere una view, e prima di questa
/// seduta dicevano che era una funzione **pura**: entrambe prendevano `&self`,
/// quindi filtro corrente, tab attiva, pagina, ordinamento, selezione e sezioni
/// aperte non avevano dove stare se non dietro un `Mutex` che ogni autore di
/// provider si inventava per conto suo. Con tre pannelli in sola lettura non si
/// notava; con i nodi di input del §2.1 è il caso normale.
///
/// Ora il percorso di **scrittura** (`on_action`) può mutare il provider e
/// quello di **lettura** (`render_view`) no. Non è un compromesso: è la stessa
/// divisione che regge `index.query` e il §8.3 — N view che si ridisegnano non
/// si aspettano a vicenda, e dalla
/// [decisione 0024](../../../docs/decisions/README.md)
/// il render gira davvero in parallelo: era la firma a permetterlo. Il kernel estrae il provider dal workspace per la
/// durata di `on_action`, come faceva prima per prestargli l'host in scrittura;
/// il costo di `&mut self` è quindi zero, ed è per questo che la terza strada —
/// l'interior mutability dichiarata a contratto — non serve più a nessuno.
///
/// A M5 la firma non si vede: nel WIT `self` non compare, e un componente WASM
/// muta la propria memoria lineare senza chiedere permesso a nessuno. È il
/// motivo per cui questa è la scelta che costa meno di tutte al confine.
pub trait ViewProvider: Send + Sync {
    fn views(&self) -> Vec<ViewSpec>;
    /// Cosa fa invecchiare **questo esemplare** (§22.3).
    ///
    /// Non ha un default, e non è una dimenticanza: con un default vuoto un
    /// provider che non la implementa smetterebbe di ridisegnarsi in silenzio,
    /// e a scoprirlo sarebbe uno schermo fermo invece del compilatore.
    fn interests(&self, instance: &ViewInstance) -> ViewInterests;
    /// Restituisce l'albero di UI dichiarativa per **questa istanza** della
    /// view.
    ///
    /// L'host è un [`ReadApi`] e non un [`HostApi`]: disegnare è leggere, e
    /// dal §7.1 quella frase è un tipo invece che un commento. Chi disegna non
    /// ha davanti le capacità di scrittura — non le può chiamare, non le deve
    /// rifiutare, e l'host che gliele prestava non deve più implementarne
    /// dodici come altrettanti `unreachable!()`.
    fn render_view(
        &self,
        instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError>;
    fn on_action(
        &mut self,
        instance: &ViewInstance,
        action: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError>;
}
