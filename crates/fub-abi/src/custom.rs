//! **Chi disegna ciò che il core non conosce** — le due firme che il §3.1 e il
//! §3.2 chiedevano, e che sono la stessa decisione vista da due lati.
//!
//! Il perno è il `custom_kind`. Un nome con namespace lo produce
//! ([`SyntaxRule`], §3.1), lo stesso nome lo disegna ([`CustomRenderer`], §3.2),
//! e lo stesso nome arriva alla shell dentro `UiKind::Custom { ns }` (§3.3). Chi
//! ne registra uno solo ha scritto mezzo plugin, e adesso il registro glielo può
//! dire — prima non c'era nemmeno un posto dove accorgersene.
//!
//! # Cosa una regola può produrre, e cosa no
//!
//! **Solo l'escape hatch.** Una regola emette un `Block::Custom` o un
//! `Inline::Custom`, mai un nodo del vocabolario centrale: nessuno può innestare
//! una sintassi che finge di essere un `Heading`, e chi consuma il modello sa
//! che tutto ciò che è arrivato da un terzo porta un `custom_kind` con un
//! namespace addosso. È il confine che rende il modello leggibile a chi non
//! conosce le estensioni installate.
//!
//! # Dove una regola agisce, e il limite dichiarato
//!
//! Sul **modello**, dopo il parse del provider — non sul flusso di caratteri.
//! Questo è ciò che rende una regola innestabile su un provider che non la
//! conosce (è il punto del §3.1: prima si poteva solo *rimpiazzare* un
//! provider), e ha un prezzo che va detto: una regola **non può cambiare come
//! la grammatica di base spezza il testo**. Non si può far significare altro a
//! `**`, né inventare un delimitatore di blocco che il provider non
//! riconoscerebbe come tale. Ciò che si può fare è ciò che i trigger dichiarano:
//! prendersi un blocco recintato che il provider ha già riconosciuto come tale
//! ([`SyntaxTrigger::Fence`] — mermaid, PlantUML, Graphviz, D2, chart, math a
//! display), e prendersi un tratto di testo fra due delimitatori
//! ([`SyntaxTrigger::Inline`] — `$…$`, `==…==`, apici e pedici). Sono le due
//! forme in cui è scritta la maggioranza delle ~50 estensioni del 5.2.

use serde::{Deserialize, Serialize};

use crate::error::FormatError;
use crate::format::{ParseContext, RenderOptions};
use crate::model::{Block, Span};
use crate::ui::UiNode;

// ---------------------------------------------------------------------------
// §3.1 — chi aggiunge la sintassi
// ---------------------------------------------------------------------------

/// Cosa fa scattare una regola.
///
/// Il trigger è **dichiarato** e non deciso dal codice della regola: è ciò che
/// permette di sapere che due regole si contendono la stessa sintassi *prima*
/// di eseguirle, che è tutta la differenza fra un conflitto e un vincitore a
/// sorpresa.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyntaxTrigger {
    /// Un blocco recintato con una di queste info string: ```` ```mermaid ````.
    /// Il provider lo ha già riconosciuto come recinto; la regola decide cosa
    /// diventa.
    Fence { info: Vec<String> },
    /// Un tratto di testo fra due delimitatori: `==…==`, `$…$`, `^…^`.
    /// Delimitatori vuoti = regola inerte (e il registro lo rifiuta).
    Inline { open: String, close: String },
}

impl SyntaxTrigger {
    /// Le **chiavi di contesa**: due regole che ne condividono una sullo stesso
    /// formato rivendicano la stessa sintassi.
    pub fn claims(&self) -> Vec<String> {
        match self {
            SyntaxTrigger::Fence { info } => info
                .iter()
                .map(|i| format!("fence:{}", i.to_lowercase()))
                .collect(),
            SyntaxTrigger::Inline { open, .. } => vec![format!("inline:{open}")],
        }
    }
}

/// La dichiarazione di una regola sintattica: cosa innesta, su cosa, quando e
/// con quale precedenza.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyntaxRuleSpec {
    /// Id con namespace (`ns:nome`). Il namespace è di chi la scrive.
    pub id: String,
    /// L'id del [`FormatDescriptor`](crate::format::FormatDescriptor) su cui si
    /// innesta: `"markdown"`. Una regola non si innesta su *tutti* i formati —
    /// una sintassi è di una grammatica.
    pub format: String,
    pub trigger: SyntaxTrigger,
    /// Ordine di applicazione, crescente; i pari merito nell'ordine di
    /// registrazione. Serve perché due regole possono agganciare **testi
    /// diversi nello stesso punto** (un `$…$` dentro un `==…==`), e senza un
    /// ordine dichiarato il risultato dipenderebbe da chi si è registrato prima.
    pub order: i32,
    /// La chiave di [`ParseContext`](crate::format::ParseContext) che la
    /// accende; assente = sempre attiva. È il ponte col §3.4: una regola si
    /// spegne per vault, per cartella o per nota senza che nessuno la
    /// disinstalli.
    pub option: Option<String>,
    /// I `custom_kind` che questa regola emette. È l'altra metà del conto del
    /// §3.2: un `custom_kind` prodotto e mai rivendicato da un renderer è un
    /// blocco che l'utente leggerà crudo, e adesso si può **contare**.
    ///
    /// **È un contratto, non una nota.** Ciò che [`SyntaxRule::apply`]
    /// restituisce e che non è dichiarato qui viene **scartato**, e il nodo
    /// resta com'era. Senza quel controllo `produces` sarebbe una promessa che
    /// non costa niente rompere: una regola di terzi potrebbe dichiarare
    /// `terzi:onesto` ed emettere `callout`, farsi disegnare dal renderer del
    /// core e mandare in confusione il conto — che conterebbe un kind mai
    /// emesso e non vedrebbe quello emesso. La frase «tutto ciò che arriva da
    /// un terzo porta un namespace addosso» vale perché questo elenco è
    /// verificato due volte: qui contro ciò che la regola emette, e alla
    /// registrazione contro il namespace di chi la registra (§7.4).
    ///
    /// Vuoto = una regola che non può produrre niente, cioè un no-op che
    /// sembra una regola: il registro la rifiuta.
    pub produces: Vec<String>,
}

/// **Come si riconosce una sintassi, per chi non ha il parser** (§4.4).
///
/// È la dichiarazione vista da fuori: il nome nel vocabolario di
/// [`syntax`](crate::options::syntax), e la **forma** quando la forma è un
/// dato invece che una grammatica. Chi disegna una superficie di scrittura —
/// la nostra live preview, o quella di un terzo dalla
/// [0104](../../../docs/decisions/0104-la-superficie-di-scrittura-si-presta.md)
/// — non ha il provider e non può parsare il buffer sporco che ha in mano
/// ([0018](../../../docs/decisions/0018-chi-vede-il-modello-parsato.md)):
/// tutto ciò che può fare è **interpretare** questa dichiarazione, e ciò che
/// qui non è dichiarato lo riscriverà a mano.
///
/// `trigger` assente non vuol dire «nessuna forma»: vuol dire che la forma è
/// nella grammatica del provider, ed è il confine esatto oltre il quale chi
/// decora si arrangia. Distinguerlo da un elenco di nomi nudi è tutto il
/// valore di questo tipo: dice **dove finisce** ciò che si può generare.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyntaxForm {
    /// Il nome della sintassi: `fub:highlight`, `fub:wikilinks`, `terzi:spoiler`.
    pub name: String,
    /// Il trigger dichiarato da una [`SyntaxRuleSpec`], se la sintassi arriva
    /// da una regola innestata; `None` se la conosce il provider.
    pub trigger: Option<SyntaxTrigger>,
}

/// Ciò che una regola ha agganciato.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyntaxMatch {
    /// La chiave di contesa che ha agganciato: l'info string del recinto, o il
    /// delimitatore d'apertura.
    pub trigger: String,
    /// Il contenuto: il corpo del recinto, o il testo fra i delimitatori.
    pub text: String,
    /// Dove sta sulla sorgente. Lo riempie il kernel, non la regola: una regola
    /// che potesse dichiarare il proprio span potrebbe mentire sull'identità di
    /// un blocco, e il §13.1 ci poggia sopra.
    pub span: Span,
}

/// Cosa una regola produce: sempre l'escape hatch, mai un nodo centrale.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyntaxProduct {
    /// Un `Block::Custom`. `blocks` sono i figli, per le sintassi che ne hanno
    /// (una timeline, uno stepper); vuoto per quelle che portano solo un
    /// sorgente negli `attrs` (mermaid, math).
    Block {
        custom_kind: String,
        attrs: serde_json::Value,
        blocks: Vec<Block>,
    },
    /// Un `Inline::Custom`. Non ha figli — è la forma che l'escape hatch inline
    /// ha nel modello, ed è deliberato che una regola non possa produrre
    /// enfasi o link.
    ///
    /// **Convenzione degli `attrs`: chi porta del testo lo chiama `text`.** Non
    /// è un capriccio di stile — è ciò che il degrado generico di un provider
    /// legge per non far sparire il contenuto quando nessuno conosce il kind.
    /// Un inline che mette il proprio testo sotto un altro nome si rende come
    /// uno span vuoto da chiunque non lo conosca, che è esattamente la
    /// sparizione silenziosa che il §3.2 ha corretto.
    Inline {
        custom_kind: String,
        attrs: serde_json::Value,
    },
}

/// Una sintassi innestata su un formato che non la conosce.
///
/// Prima di questo trait `FormatRegistry` era una mappa estensione → **un**
/// provider, e `register` faceva `insert`: l'unico modo di aggiungere una
/// sintassi al markdown era sostituire il provider markdown. Era l'unico punto
/// in cui l'invariante del progetto — «una feature ufficiale è ciò che scriverà
/// un plugin di terzi» — era **già falsa**.
pub trait SyntaxRule: Send + Sync {
    fn spec(&self) -> SyntaxRuleSpec;

    /// Trasforma ciò che ha agganciato. `None` = «non è roba mia dopo tutto»,
    /// e il nodo resta com'era: è il modo con cui una regola declina senza
    /// fallire (```` ```math ```` che contiene qualcosa che non è una formula).
    fn apply(
        &self,
        m: &SyntaxMatch,
        ctx: &ParseContext,
    ) -> Result<Option<SyntaxProduct>, FormatError>;
}

// ---------------------------------------------------------------------------
// §3.2 — chi disegna il blocco che ne esce
// ---------------------------------------------------------------------------

/// Quali `custom_kind` un renderer rivendica.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CustomRendererSpec {
    /// Id con namespace (`ns:nome`).
    pub id: String,
    /// I `custom_kind` che sa disegnare.
    pub kinds: Vec<String>,
}

/// Un blocco custom, come arriva al suo renderer.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CustomBlock {
    pub custom_kind: String,
    pub attrs: serde_json::Value,
    pub blocks: Vec<Block>,
    pub anchor: Option<String>,
    pub span: Span,
}

/// Come un blocco custom si disegna.
///
/// Le due strade non sono equivalenti e la differenza è il §3.6:
///
/// - [`CustomRendering::Html`] è la via veloce, ed è **HTML che entra nella
///   webview**: passa dal punto unico di sanitizzazione, chiunque l'abbia
///   prodotta;
/// - [`CustomRendering::Ui`] è **sicura per costruzione** — nessun campo di un
///   `UiNode` è interpretato come markup — e viaggia fino alla shell, che la
///   monta con lo stesso `mountTree` delle view. È la strada per cui la UI di un
///   plugin entra nella shell **senza codice nel bundle** (§3.3), e per cui
///   `UiKind::Custom` ha finalmente un cliente.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CustomRendering {
    Html(String),
    /// L'albero sta dietro un `Box`: un `UiNode` è un ordine di grandezza più
    /// grosso di una `String`, e senza, ogni `Fallback` restituito costerebbe
    /// quanto l'albero che non c'è. Al confine non si vede — nel WIT è
    /// `ui(ui-tree)`, e la serializzazione è quella del nodo.
    Ui(Box<UiNode>),
    /// «Non lo disegno io»: il blocco torna al provider, che lo degrada. È
    /// diverso da un errore, ed è ciò che un renderer risponde quando gli
    /// `attrs` non sono quelli che si aspettava.
    Fallback,
}

/// Il punto d'innesto che `Block::Custom` non aveva.
///
/// L'escape hatch del modello esisteva, il suo disegno no: il rendering di un
/// blocco custom era un `if custom_kind == CALLOUT` dentro il provider markdown,
/// e ogni altro kind cadeva in un ramo generico. Quel ramo non era un difetto in
/// sé — è il **degrado**, e serve; il difetto era che il degrado *fosse tutto*,
/// e che non ci fosse modo di dire chi lo disegnerebbe.
pub trait CustomRenderer: Send + Sync {
    fn spec(&self) -> CustomRendererSpec;

    fn render(
        &self,
        block: &CustomBlock,
        opts: &RenderOptions,
    ) -> Result<CustomRendering, FormatError>;
}
