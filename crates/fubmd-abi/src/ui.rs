//! Il protocollo di **UI dichiarativa** dei plugin.
//!
//! Un plugin descrive la sua UI come albero [`UiNode`] (serializzabile, neutro
//! rispetto al framework); il frontend del core lo rende con i suoi componenti
//! nativi → temi coerenti, niente JS nei plugin. La variante
//! [`UiKind::WebView`] è l'escape hatch: solo quando il dichiarativo non basta
//! davvero.
//!
//! # Un nodo è una chiave e una specie
//!
//! [`UiNode`] non è l'enum: è il record `{ key, kind }`. La chiave è ciò su cui
//! un riconciliatore lavora (§2.8) — senza, l'unico aggiornamento possibile è
//! «butta via e ricostruisci», che con i nodi di input di questa seduta
//! significa un campo di testo che perde il focus e il contenuto a ogni
//! `IndexUpdated`, cioè a ogni salvataggio. Non è decorazione dello stesso
//! albero di prima: è la differenza fra una UI dichiarativa che si può usare e
//! una che si può solo guardare. Chi non ha liste che si riordinano può lasciare
//! `None` e non pensarci: la chiave serve dove l'identità di una riga non
//! coincide con la sua posizione.
//!
//! # Confine di fiducia
//!
//! [`UiKind::Html`] e [`UiKind::WebView`] iniettano contenuto attivo nella
//! webview principale, che ha accesso all'IPC con pieni privilegi: un plugin
//! sandboxato che potesse emetterle aggirerebbe l'intera sandbox via UI. Sono
//! quindi varianti **riservate al codice fidato** (core e feature ufficiali).
//! L'host che riceve un albero da un provider non fidato DEVE rifiutarlo con
//! [`UiNode::validate_untrusted`] — è lo stesso principio dell'enforcement dei
//! permessi in un solo punto (`HostApi`). Ogni nodo aggiunto qui è **sicuro per
//! costruzione**: nessun campo di nessuna variante nuova è interpretato come
//! markup, e chi disegna lo inserisce come testo. Vedi
//! `docs/architecture/ui-protocol.md`.
//!
//! # Chi mette cosa in un'azione
//!
//! Un'azione ha due metà con due proprietari distinti, e la separazione è il
//! §2.7:
//!
//! - Il **provider** attacca al nodo un [`ActionRef`]: l'id e il `payload` che
//!   gli serve per riconoscere *su cosa* si è cliccato. È ciò che sostituisce la
//!   convenzione privata «i dati dentro l'id» (`open:a/Uno.md`) che le tre
//!   feature ufficiali stavano promuovendo a contratto de facto.
//! - La **shell** riempie [`UiAction::fields`] con lo stato dei campi di input
//!   che circondano l'azione. Nessuno dei due deve fondere l'oggetto dell'altro,
//!   quindi non serve una regola di collisione fra le due metà.

use serde::{Deserialize, Serialize};

/// Id di un'azione richiamabile dalla UI (torna al provider via `on_action`).
///
/// È **opaco**: un id non è un canale dati. Ciò che il provider deve sapere per
/// servire il click sta nel `payload` dell'[`ActionRef`], non concatenato qui
/// dentro — vedi il doc del modulo.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActionId(pub String);

/// L'azione attaccata a un nodo: cosa chiamare, e con cosa.
///
/// `payload` è JSON libero **del provider**: lo scrive lui rendendo l'albero e
/// gli torna intatto in [`UiAction::payload`]. La shell non lo interpreta e non
/// lo riscrive.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ActionRef {
    pub action: ActionId,
    #[serde(default)]
    pub payload: serde_json::Value,
}

impl ActionRef {
    /// Un'azione senza dati: il click dice solo *cosa*, non *su cosa*.
    pub fn new(action: impl Into<String>) -> Self {
        ActionRef {
            action: ActionId(action.into()),
            payload: serde_json::Value::Null,
        }
    }

    /// Un'azione che porta con sé ciò che serve a servirla.
    pub fn with(action: impl Into<String>, payload: serde_json::Value) -> Self {
        ActionRef {
            action: ActionId(action.into()),
            payload,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Axis {
    Row,
    Column,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Intent {
    #[default]
    Neutral,
    Primary,
    Danger,
}

/// L'allineamento di una colonna di [`UiKind::Table`]. Non è stile: un numero
/// allineato a sinistra è una tabella che non si legge, e il provider è l'unico
/// a sapere se una colonna contiene numeri.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Align {
    #[default]
    Start,
    Center,
    End,
}

/// Il valore di un campo di input, come torna dalla shell.
///
/// Non è `serde_json::Value` perché il tipo di un campo lo dichiara il nodo che
/// lo disegna: un [`UiKind::Checkbox`] non può tornare una stringa, e chi legge
/// non deve difendersi da quel caso. `Number` è `f64` per la stessa ragione per
/// cui lo è [`crate::command::ParamKind::Number`]: la distinzione intero/decimale
/// non attraversa JSON.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum UiValue {
    Text(String),
    Number(f64),
    Bool(bool),
    /// Selezione multipla: i `value` delle opzioni scelte, nell'ordine in cui
    /// sono dichiarate nel nodo.
    Choices(Vec<String>),
}

/// Lo stato di un campo, come la shell lo consegna al provider.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FieldValue {
    /// Il `field` dichiarato dal nodo di input.
    pub field: String,
    pub value: UiValue,
}

/// Una scelta di [`UiKind::Select`] / [`UiKind::Radio`].
///
/// `value` è ciò che torna nei [`FieldValue`], `label` è ciò che si legge: che
/// siano due campi e non uno è la differenza fra una scelta che si può
/// localizzare (§12.1) e una che è anche la sua etichetta.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UiOption {
    pub value: String,
    pub label: String,
}

impl UiOption {
    pub fn new(value: impl Into<String>, label: impl Into<String>) -> Self {
        UiOption {
            value: value.into(),
            label: label.into(),
        }
    }
}

/// Una voce di [`UiKind::KeyValue`].
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeyValueEntry {
    pub label: String,
    pub value: String,
}

/// Una colonna di [`UiKind::Table`].
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TableColumn {
    pub title: String,
    pub align: Align,
}

impl TableColumn {
    pub fn new(title: impl Into<String>) -> Self {
        TableColumn {
            title: title.into(),
            align: Align::Start,
        }
    }

    pub fn aligned(title: impl Into<String>, align: Align) -> Self {
        TableColumn {
            title: title.into(),
            align,
        }
    }
}

/// Un nodo dell'albero: la sua **chiave** e la sua **specie**.
///
/// La chiave è l'identità del nodo attraverso due ridisegni: chi la dichiara sta
/// dicendo alla shell «questo nodo è lo stesso di prima anche se ha cambiato
/// posizione». Senza, l'identità è la posizione — e una lista che si riordina
/// sposta il focus, la selezione e lo scroll insieme alle righe. Deve essere
/// **stabile** e **unica fra i fratelli**: l'id di un documento, non l'indice
/// nella lista.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct UiNode {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(flatten)]
    pub kind: UiKind,
}

/// La specie di un nodo. Il frontend ha un componente per variante; il tema è
/// interamente controllato dal core (i plugin scelgono intenti semantici, non
/// colori).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "node", rename_all = "snake_case")]
pub enum UiKind {
    // --- struttura di base -------------------------------------------------
    Stack {
        dir: Axis,
        gap: u8,
        children: Vec<UiNode>,
    },
    Text {
        content: String,
    },
    Heading {
        level: u8,
        content: String,
    },
    List {
        items: Vec<UiNode>,
    },
    ListItem {
        title: String,
        subtitle: Option<String>,
        action: Option<ActionRef>,
        /// È l'elemento **corrente**? Non è stile: è l'unica cosa che una lista
        /// non sa dire di sé, e senza di essa chi ce l'ha se la scrive nel
        /// titolo — che è il §2.7 in un'altra forma. L'outline lo faceva col
        /// sottotitolo (*«cursore qui»*), e il suo commento nominava già questa
        /// mancanza.
        selected: bool,
    },
    Button {
        label: String,
        intent: Intent,
        action: ActionRef,
    },
    /// Frammento già renderizzato a HTML (es. anteprima di un backlink).
    /// **Solo codice fidato**: vedi il confine di fiducia nel doc del modulo.
    Html {
        html: String,
    },
    /// Escape hatch: web-view isolata. Usata con parsimonia.
    /// **Solo codice fidato** finché non esistono asset story e CSP per i
    /// plugin (vedi `docs/architecture/ui-protocol.md`).
    WebView {
        url: String,
        height: u32,
    },

    // --- nodi strutturali (§2.1) -------------------------------------------
    /// Un gruppo con un titolo, apribile e richiudibile. `collapsed` è lo stato
    /// **iniziale**: aprire e chiudere è una faccenda della shell, che non
    /// disturba il provider per una piega (e che con la chiave sopravvive al
    /// ridisegno).
    Section {
        title: String,
        collapsed: bool,
        children: Vec<UiNode>,
    },
    /// Una tabella. Le righe sono nodi ([`UiKind::Row`]) e non record proprio
    /// perché **una riga ha una chiave**: è il caso che il §2.8 nomina, il
    /// pannello con 500 righe che si riordina.
    Table {
        columns: Vec<TableColumn>,
        rows: Vec<UiNode>,
    },
    /// Una riga di [`UiKind::Table`]. Fuori da una tabella non ha senso e la
    /// shell la disegna come uno stack orizzontale — degrado garbato, non
    /// errore.
    Row {
        cells: Vec<UiNode>,
        action: Option<ActionRef>,
    },
    /// Un albero (file tree, gerarchia di tag, outline annidata).
    Tree {
        roots: Vec<UiNode>,
    },
    /// Una voce di [`UiKind::Tree`]: l'annidamento passa dai `children`, che
    /// sono altri `TreeItem`.
    TreeItem {
        label: String,
        expanded: bool,
        action: Option<ActionRef>,
        /// Come per [`UiKind::ListItem`]: l'elemento corrente.
        selected: bool,
        children: Vec<UiNode>,
    },
    /// Schede. `active` è l'indice iniziale in `tabs`; fuori range = la prima.
    Tabs {
        active: u32,
        tabs: Vec<UiNode>,
    },
    /// Una scheda di [`UiKind::Tabs`]. `action`, se c'è, scatta quando la
    /// scheda viene scelta: la shell cambia scheda da sé — non serve un giro
    /// dal provider per una piega — e avvisa solo chi ha chiesto di saperlo.
    Tab {
        label: String,
        action: Option<ActionRef>,
        children: Vec<UiNode>,
    },
    Badge {
        label: String,
        intent: Intent,
    },
    /// Un'icona dal repertorio della shell. Un nome che la shell non conosce
    /// non disegna niente: un'icona mancante non deve rompere un pannello.
    Icon {
        name: String,
    },
    /// Avanzamento. `value` è in `0.0..=1.0`; `None` = indeterminato, che è il
    /// caso normale di chi non sa quanto manca.
    Progress {
        value: Option<f32>,
        label: Option<String>,
    },
    Separator,
    /// Il vuoto detto bene: non c'è niente **e** questo è ciò che si può fare.
    EmptyState {
        title: String,
        detail: Option<String>,
        action: Option<ActionRef>,
    },
    KeyValue {
        entries: Vec<KeyValueEntry>,
    },

    // --- nodi di input (§2.1) ----------------------------------------------
    //
    // `field` è la chiave sotto cui il valore torna in `UiAction::fields`, e
    // `value` è ciò che il provider vuole vederci **adesso**: il protocollo
    // resta senza stato lato shell, che è la sola forma compatibile con un
    // `render_view` che può essere richiamato in qualunque momento.
    //
    // `action`, dove c'è, è opzionale e scatta quando il valore si assesta
    // (invio, uscita dal campo, cambio di scelta). Chi non la dichiara riceve il
    // valore solo quando qualcun altro — un bottone, un form — invia.
    TextInput {
        field: String,
        label: Option<String>,
        value: String,
        placeholder: Option<String>,
        action: Option<ActionRef>,
    },
    TextArea {
        field: String,
        label: Option<String>,
        value: String,
        rows: u32,
        action: Option<ActionRef>,
    },
    Number {
        field: String,
        label: Option<String>,
        value: Option<f64>,
        min: Option<f64>,
        max: Option<f64>,
        step: Option<f64>,
        action: Option<ActionRef>,
    },
    Checkbox {
        field: String,
        label: String,
        value: bool,
        action: Option<ActionRef>,
    },
    /// Scelta da un elenco. Con `multiple` il valore torna come
    /// [`UiValue::Choices`], altrimenti come [`UiValue::Text`].
    Select {
        field: String,
        label: Option<String>,
        value: Vec<String>,
        options: Vec<UiOption>,
        multiple: bool,
        action: Option<ActionRef>,
    },
    /// Come [`UiKind::Select`] a scelta singola, ma tutte le opzioni sono
    /// visibili insieme. Sono due nodi e non un campo `style` perché la scelta
    /// fra i due è semantica — poche opzioni che vanno confrontate contro molte
    /// da cercare — e chi disegna deve poterla rispettare.
    Radio {
        field: String,
        label: Option<String>,
        value: Option<String>,
        options: Vec<UiOption>,
        action: Option<ActionRef>,
    },
    Slider {
        field: String,
        label: Option<String>,
        value: f64,
        min: f64,
        max: f64,
        step: f64,
        action: Option<ActionRef>,
    },
    /// Una data civile in ISO-8601 (`2026-07-26`). Che sia una stringa e non un
    /// istante è deliberato: il tempo civile è il §12.3 e non è ancora deciso;
    /// una data qui è ciò che l'utente ha scritto su un calendario, non un
    /// punto sulla linea del tempo.
    DatePicker {
        field: String,
        label: Option<String>,
        value: Option<String>,
        action: Option<ActionRef>,
    },
    /// Un gruppo di campi con un invio. Inviare manda **tutti** i campi
    /// contenuti, anche quelli che non hanno un'`action` propria: è ciò che
    /// distingue un form da una fila di input sciolti.
    Form {
        children: Vec<UiNode>,
        submit_label: String,
        submit: ActionRef,
    },

    // --- il varco, e i due stati (§2.1, §2.5) ------------------------------
    /// Widget che il protocollo non prevede: la shell che conosce `ns` disegna
    /// il suo (grafo, canvas, chart), chi non lo conosce disegna il `fallback`
    /// dichiarativo. È il modo di far entrare le superfici privilegiate **dentro**
    /// il protocollo invece di tenerle fuori come ha dovuto fare il grafo.
    Custom {
        ns: String,
        payload: serde_json::Value,
        fallback: Vec<UiNode>,
    },
    /// «Non ancora»: il dato non c'è perché qualcuno lo sta preparando (§2.5).
    /// È un nodo e non una risposta di `render_view` perché il caso normale è
    /// **parziale** — la testata c'è, la tabella arriva.
    Pending {
        label: Option<String>,
    },
    /// «Non ce l'ho fatta», con l'invito a riprovare quando c'è. Distinto da un
    /// `PluginError` restituito da `render_view`: quello dice che la view non si
    /// è disegnata, questo che una sua parte non ha un dato.
    Failed {
        message: String,
        retry: Option<ActionRef>,
    },
}

impl UiNode {
    /// Un nodo senza chiave.
    pub fn new(kind: UiKind) -> Self {
        UiNode { key: None, kind }
    }

    /// Un nodo con la sua identità attraverso i ridisegni.
    pub fn keyed(key: impl Into<String>, kind: UiKind) -> Self {
        UiNode {
            key: Some(key.into()),
            kind,
        }
    }

    pub fn with_key(mut self, key: impl Into<String>) -> Self {
        self.key = Some(key.into());
        self
    }

    pub fn stack(dir: Axis, gap: u8, children: Vec<UiNode>) -> Self {
        UiNode::new(UiKind::Stack { dir, gap, children })
    }

    pub fn column(gap: u8, children: Vec<UiNode>) -> Self {
        UiNode::stack(Axis::Column, gap, children)
    }

    pub fn row(gap: u8, children: Vec<UiNode>) -> Self {
        UiNode::stack(Axis::Row, gap, children)
    }

    pub fn text(content: impl Into<String>) -> Self {
        UiNode::new(UiKind::Text {
            content: content.into(),
        })
    }

    pub fn heading(level: u8, content: impl Into<String>) -> Self {
        UiNode::new(UiKind::Heading {
            level,
            content: content.into(),
        })
    }

    pub fn list(items: Vec<UiNode>) -> Self {
        UiNode::new(UiKind::List { items })
    }

    /// Una voce cliccabile: titolo, sottotitolo, e l'azione col suo payload.
    pub fn list_item(
        title: impl Into<String>,
        subtitle: Option<String>,
        action: Option<ActionRef>,
    ) -> Self {
        UiNode::new(UiKind::ListItem {
            title: title.into(),
            subtitle,
            action,
            selected: false,
        })
    }

    pub fn button(label: impl Into<String>, intent: Intent, action: ActionRef) -> Self {
        UiNode::new(UiKind::Button {
            label: label.into(),
            intent,
            action,
        })
    }

    pub fn separator() -> Self {
        UiNode::new(UiKind::Separator)
    }

    pub fn badge(label: impl Into<String>, intent: Intent) -> Self {
        UiNode::new(UiKind::Badge {
            label: label.into(),
            intent,
        })
    }

    pub fn empty_state(title: impl Into<String>) -> Self {
        UiNode::new(UiKind::EmptyState {
            title: title.into(),
            detail: None,
            action: None,
        })
    }

    pub fn pending(label: Option<String>) -> Self {
        UiNode::new(UiKind::Pending { label })
    }

    pub fn failed(message: impl Into<String>, retry: Option<ActionRef>) -> Self {
        UiNode::new(UiKind::Failed {
            message: message.into(),
            retry,
        })
    }

    /// I figli di questo nodo, qualunque sia la specie.
    ///
    /// Esiste per chi deve **attraversare** l'albero senza conoscerlo — la
    /// validazione del confine di fiducia, la ricerca di una chiave — e il
    /// `match` esaustivo qui sotto è ciò che impedisce a una variante nuova di
    /// portarsi dietro figli che nessuno visita: un nodo `Html` annidato dentro
    /// un contenitore dimenticato passerebbe la validazione.
    pub fn children(&self) -> Vec<&UiNode> {
        match &self.kind {
            UiKind::Stack { children, .. }
            | UiKind::Section { children, .. }
            | UiKind::TreeItem { children, .. }
            | UiKind::Tab { children, .. }
            | UiKind::Form { children, .. }
            | UiKind::Custom {
                fallback: children, ..
            } => children.iter().collect(),
            UiKind::List { items } => items.iter().collect(),
            UiKind::Table { rows, .. } => rows.iter().collect(),
            UiKind::Row { cells, .. } => cells.iter().collect(),
            UiKind::Tree { roots } => roots.iter().collect(),
            UiKind::Tabs { tabs, .. } => tabs.iter().collect(),
            UiKind::Text { .. }
            | UiKind::Heading { .. }
            | UiKind::ListItem { .. }
            | UiKind::Button { .. }
            | UiKind::Html { .. }
            | UiKind::WebView { .. }
            | UiKind::Badge { .. }
            | UiKind::Icon { .. }
            | UiKind::Progress { .. }
            | UiKind::Separator
            | UiKind::EmptyState { .. }
            | UiKind::KeyValue { .. }
            | UiKind::TextInput { .. }
            | UiKind::TextArea { .. }
            | UiKind::Number { .. }
            | UiKind::Checkbox { .. }
            | UiKind::Select { .. }
            | UiKind::Radio { .. }
            | UiKind::Slider { .. }
            | UiKind::DatePicker { .. }
            | UiKind::Pending { .. }
            | UiKind::Failed { .. } => Vec::new(),
        }
    }

    /// Valida un albero proveniente da un provider **non fidato**: rifiuta le
    /// varianti riservate (`Html`, `WebView`) ovunque nell'albero.
    ///
    /// È il punto di enforcement del confine di fiducia della UI: l'host (M5:
    /// il proxy WASM; M4: il registry per i plugin nativi non-core) lo chiama
    /// su ogni albero restituito da `render_view` prima di passarlo al
    /// frontend. La ricorsione passa da [`UiNode::children`], quindi un nodo
    /// contenitore nuovo è coperto dal giorno in cui esiste — la vecchia
    /// versione elencava a mano i due contenitori che c'erano, ed è la forma di
    /// presidio che si dimentica alla terza aggiunta.
    pub fn validate_untrusted(&self) -> Result<(), crate::error::PluginError> {
        match &self.kind {
            UiKind::Html { .. } => {
                return Err(crate::error::PluginError::PermissionDenied(
                    "UiKind::Html è riservato al codice fidato".into(),
                ))
            }
            UiKind::WebView { .. } => {
                return Err(crate::error::PluginError::PermissionDenied(
                    "UiKind::WebView è riservato al codice fidato".into(),
                ))
            }
            _ => {}
        }
        self.children()
            .into_iter()
            .try_for_each(UiNode::validate_untrusted)
    }
}

/// Azione emessa dal frontend verso un `ViewProvider`.
///
/// Le due metà hanno due proprietari (vedi il doc del modulo): `payload` è ciò
/// che il provider ha attaccato al nodo, `fields` è ciò che l'utente ha
/// digitato. Nessuno dei due sovrascrive l'altro.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct UiAction {
    pub action: ActionId,
    #[serde(default)]
    pub payload: serde_json::Value,
    /// Lo stato dei campi di input in vigore quando l'azione è scattata: quelli
    /// del form che la contiene, o — per un'azione fuori da un form — quelli
    /// della view intera. L'ordine è quello di comparsa nell'albero; un campo
    /// dichiarato due volte con lo stesso `field` compare una volta sola, con
    /// l'ultimo valore.
    #[serde(default)]
    pub fields: Vec<FieldValue>,
}

impl UiAction {
    /// Un'azione nuda: nessun payload, nessun campo. È ciò che manda un test, e
    /// ciò che mandava la shell prima del §2.7.
    pub fn new(action: impl Into<String>) -> Self {
        UiAction {
            action: ActionId(action.into()),
            payload: serde_json::Value::Null,
            fields: Vec::new(),
        }
    }

    pub fn with_payload(mut self, payload: serde_json::Value) -> Self {
        self.payload = payload;
        self
    }

    pub fn with_fields(mut self, fields: Vec<FieldValue>) -> Self {
        self.fields = fields;
        self
    }

    /// Il valore di un campo, se la shell l'ha mandato.
    pub fn field(&self, name: &str) -> Option<&UiValue> {
        self.fields
            .iter()
            .find(|f| f.field == name)
            .map(|f| &f.value)
    }

    /// Il valore testuale di un campo: la forma che serve il novanta per cento
    /// delle volte, senza che ogni provider riscriva lo stesso `match`.
    pub fn text_field(&self, name: &str) -> Option<&str> {
        match self.field(name) {
            Some(UiValue::Text(s)) => Some(s.as_str()),
            _ => None,
        }
    }

    /// Il valore booleano di un campo.
    pub fn bool_field(&self, name: &str) -> Option<bool> {
        match self.field(name) {
            Some(UiValue::Bool(b)) => Some(*b),
            _ => None,
        }
    }

    /// Il valore numerico di un campo.
    pub fn number_field(&self, name: &str) -> Option<f64> {
        match self.field(name) {
            Some(UiValue::Number(n)) => Some(*n),
            _ => None,
        }
    }
}

/// Aggiornamento restituito da un `ViewProvider` dopo un'azione.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ViewUpdate {
    /// Rimpiazza l'intero albero della view.
    Replace { root: UiNode },
    /// Nessun cambiamento visivo.
    None,
    /// Chiedi al core di navigare a un documento (usato dai backlink).
    Navigate { doc_id: String },
    /// Chiedi al core di **rivelare** un intervallo di un documento: aprirlo se
    /// non è quello attivo e portare la vista sull'intervallo (usato
    /// dall'outline per saltare a un heading). `span` è in **byte UTF-8**, come
    /// ogni [`Span`](crate::model::Span) del modello; è chi disegna a mapparlo
    /// sulle posizioni dell'editor.
    Reveal {
        doc_id: String,
        span: crate::model::Span,
    },
    /// Chiedi al core di eseguire una **ricerca** e mostrarne i risultati (usato
    /// dal pannello tag: cliccare un tag cerca le note che lo portano). La
    /// query è la stessa stringa che l'utente potrebbe digitare nella ricerca.
    RunSearch { query: String },
    /// Varco di estensione, con namespace (`ns` = plugin id): un intento che il
    /// protocollo non prevede ancora. **La shell che non riconosce `ns` non fa
    /// nulla** — degrado garbato, stessa semantica degli altri enum di confine
    /// ([`Event::Custom`](crate::Event::Custom),
    /// [`IndexQuery::Custom`](crate::traits::IndexQuery::Custom)). È il motivo
    /// per cui gli intenti nuovi non sono più un cambio di versione: un
    /// intento sperimentale nasce qui, e solo se si dimostra universale viene
    /// promosso a variante propria (quello sì, un cambio di minor).
    Custom {
        ns: String,
        payload: serde_json::Value,
    },
    /// Rimpiazza **un solo nodo**, quello con questa chiave.
    ///
    /// È ciò che il §2.1 chiedeva come `Patch { path, node }` e che il §2.8 ha
    /// corretto: un patch indirizzato per posizione si rompe al primo riordino
    /// della lista, cioè esattamente nel caso che lo motivava (il pannello con
    /// 500 righe e una spunta). Una chiave che la shell non trova **non è un
    /// errore**: è una view che nel frattempo è cambiata sotto, e chi ha
    /// chiesto la patch la ridisegnerà intera al prossimo giro.
    Patch { key: String, node: UiNode },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn untrusted_tree_without_html_is_valid() {
        let tree = UiNode::column(
            1,
            vec![
                UiNode::heading(2, "Titolo"),
                UiNode::list(vec![UiNode::list_item(
                    "voce",
                    None,
                    Some(ActionRef::new("open")),
                )]),
            ],
        );
        assert!(tree.validate_untrusted().is_ok());
    }

    #[test]
    fn untrusted_html_is_rejected_even_if_nested() {
        let tree = UiNode::row(
            0,
            vec![UiNode::list(vec![UiNode::new(UiKind::Html {
                html: "<script>evil()</script>".into(),
            })])],
        );
        assert!(tree.validate_untrusted().is_err());
        let webview = UiNode::new(UiKind::WebView {
            url: "https://x".into(),
            height: 100,
        });
        assert!(webview.validate_untrusted().is_err());
    }

    /// I contenitori nuovi di questa seduta non sono un varco: la validazione
    /// scende **dovunque** ci siano figli, e questo test lo prova sui due posti
    /// dove sarebbe più facile dimenticarsene — la cella di una tabella e il
    /// `fallback` di un `Custom`, che è il nodo pensato apposta per chi non
    /// conosce `ns`.
    #[test]
    fn untrusted_html_is_rejected_inside_the_new_containers() {
        let html = || {
            UiNode::new(UiKind::Html {
                html: "<b>x</b>".into(),
            })
        };
        let table = UiNode::new(UiKind::Table {
            columns: vec![TableColumn::new("c")],
            rows: vec![UiNode::new(UiKind::Row {
                cells: vec![html()],
                action: None,
            })],
        });
        assert!(table.validate_untrusted().is_err());

        let custom = UiNode::new(UiKind::Custom {
            ns: "plugin".into(),
            payload: serde_json::Value::Null,
            fallback: vec![html()],
        });
        assert!(custom.validate_untrusted().is_err());

        let form = UiNode::new(UiKind::Form {
            children: vec![UiNode::new(UiKind::Tabs {
                active: 0,
                tabs: vec![UiNode::new(UiKind::Tab {
                    label: "t".into(),
                    action: None,
                    children: vec![html()],
                })],
            })],
            submit_label: "Ok".into(),
            submit: ActionRef::new("submit"),
        });
        assert!(form.validate_untrusted().is_err());
    }

    /// La chiave viaggia accanto alla specie, non dentro: un nodo senza chiave
    /// serializza come prima di questa seduta, e uno con la chiave aggiunge un
    /// campo — non un livello di annidamento.
    #[test]
    fn the_key_travels_beside_the_kind() {
        let plain = serde_json::to_value(UiNode::text("ciao")).unwrap();
        assert_eq!(
            plain,
            serde_json::json!({"node": "text", "content": "ciao"})
        );

        let keyed = serde_json::to_value(UiNode::text("ciao").with_key("k")).unwrap();
        assert_eq!(
            keyed,
            serde_json::json!({"key": "k", "node": "text", "content": "ciao"})
        );
        let back: UiNode = serde_json::from_value(keyed).unwrap();
        assert_eq!(back.key.as_deref(), Some("k"));
    }

    /// Le due metà di un'azione hanno due proprietari e non si toccano: il
    /// payload del provider torna intatto anche quando la shell manda dei campi.
    #[test]
    fn an_action_carries_both_halves_without_mixing_them() {
        let action = UiAction::new("save")
            .with_payload(serde_json::json!({"doc": "a/Uno.md"}))
            .with_fields(vec![
                FieldValue {
                    field: "titolo".into(),
                    value: UiValue::Text("Nuovo".into()),
                },
                FieldValue {
                    field: "pinned".into(),
                    value: UiValue::Bool(true),
                },
            ]);
        assert_eq!(action.payload["doc"], "a/Uno.md");
        assert_eq!(action.text_field("titolo"), Some("Nuovo"));
        assert_eq!(action.bool_field("pinned"), Some(true));
        assert_eq!(action.text_field("pinned"), None, "il tipo non si indovina");
        assert_eq!(action.field("mai"), None);
    }
}
