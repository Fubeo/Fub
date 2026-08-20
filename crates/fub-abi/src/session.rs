//! Il **contesto di sessione**: quale pannello ha il focus, che documento
//! guarda, cosa c'è selezionato dentro, in che modalità.
//!
//! È la risposta alla domanda che `active_document() -> Option<DocId>` non
//! sapeva porre: *quale* documento, di *quale* pannello. Una nota aperta era
//! una variabile globale del workspace, e con schede, split e finestre multiple
//! (FEATURES 4.1) smette di esserlo — due pannelli backlink affiancati
//! chiederebbero la stessa cosa e riceverebbero la stessa risposta, che per uno
//! dei due è sbagliata.
//!
//! # Cosa c'è dentro, e perché tutto adesso
//!
//! [`ViewContext`] è un **record**, e un campo in più a un record dopo il
//! freeze di M4 non è un'aggiunta: è una migrazione di ogni provider che lo
//! riceve. I quattro campi sono quindi quelli che il piano nomina — pannello,
//! documento, selezione, modalità — e non un sottoinsieme da completare dopo.
//!
//! # La regola dello `Span`: coordinate del sorgente che il kernel conosce
//!
//! Il **testo** di una selezione è sempre quello vero dell'editor; le sue
//! **coordinate** valgono solo quando valgono anche per il sorgente che il
//! kernel ha in mano — cioè quando il buffer non ha modifiche non salvate. Non
//! è prudenza: è l'unico modo di rendere impossibile l'errore che il contratto
//! altrimenti inviterebbe a fare — leggere il documento con
//! [`VaultRead::read_document`](crate::traits::VaultRead::read_document) e
//! ritagliarlo con uno span calcolato su un altro testo, cioè tagliare i byte
//! sbagliati mentre l'utente scrive. Chi vuole il testo lo ha sempre; chi vuole
//! la posizione la ha quando è vera.
//!
//! # Quante ne porta, e dove sta la regola dello span (decisione 0093)
//!
//! Ne porta **N**: un pannello con tre cursori ha tre selezioni, e il campo si
//! chiama [`ViewContext::selections`]. La 0007 ne aveva scritta una sola e
//! dichiarato il resto fuori — «la seconda sarebbe `list<selection>`, cioè
//! additiva solo cambiando il tipo del campo» — ma il multi-cursore è acceso
//! nell'editor della shell **da sempre** (CodeMirror lo porta di serie): a
//! essere fuori non era la funzione, era la sola facoltà di dirla.
//!
//! Due cose seguono, e sono la ragione per cui questo non è «metterci una
//! lista».
//!
//! La prima: la **primaria** è un campo che si chiama
//! [`primary`](AnchoredSelections::primary), non la prima della lista. La
//! convenzione di CodeMirror non è «la prima» — `EditorSelection` ha un
//! `mainIndex` a parte, e la sua documentazione dice che di norma è *l'ultima
//! aggiunta* — quindi «la prima per convenzione» non sarebbe stata gratis:
//! sarebbe stata una conversione della shell che **perde** quale fosse la
//! primaria. Nominarla la rende anche non vuota per costruzione: `Some` di un
//! insieme vuoto non esiste, e «nessun cursore» resta l'`Option` che la 0007
//! aveva già scelto.
//!
//! La seconda: la condizione dello span è del **buffer**, e il buffer è uno.
//! Con N selezioni non possono cadere una alla volta, quindi la scelta non sta
//! dentro ogni selezione ma **sopra l'insieme**: [`SelectionSet`] è ancorato o
//! fluttuante, e nel caso ancorato lo `span` non è facoltativo — c'è. Un
//! insieme con due selezioni posizionate e una no non è rappresentabile, ed è
//! il punto: un provider che agisse solo su quelle posizionate agirebbe su due
//! punti dei tre che l'utente vede.

use serde::{Deserialize, Serialize};

use crate::model::{DocId, Span};

/// Identità di un pannello di editing: una scheda, una metà di uno split, una
/// finestra.
///
/// È una stringa opaca assegnata dalla shell: il kernel non la interpreta e non
/// la inventa mai (un pannello nasce e muore nell'app, non nel vault). Serve
/// perché un provider possa **distinguere** due contesti — tenere lo stato per
/// pannello in `storage_*`, accorgersi che il focus si è spostato — anche prima
/// che le view sappiano istanziarsi (§2.3).
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct PaneId(pub String);

impl PaneId {
    pub fn new(id: impl Into<String>) -> Self {
        PaneId(id.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// In che modalità un pannello sta mostrando il suo documento (FEATURES 4.1).
///
/// Sono le tre modalità **esclusive**: ciò che non lo è — focus mode, zen,
/// typewriter, schermo intero — non sta qui, perché non cambia *cosa* un
/// provider deve fare, solo come la shell si dispone. Una quarta modalità
/// esclusiva (WYSIWYG, block editor) è un caso in fondo all'enum, cioè una
/// minor dopo il freeze: è additiva, a differenza di un campo del record.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaneMode {
    /// Il sorgente nudo, senza resa inline.
    Source,
    /// Sorgente con resa inline di ciò che non si sta editando: il modo
    /// normale di scrivere, e il default.
    #[default]
    LivePreview,
    /// Sola lettura: il documento reso, nessun cursore.
    Reading,
}

impl PaneMode {
    /// C'è un punto d'inserimento in questa modalità?
    ///
    /// In lettura non c'è cursore, quindi non c'è selezione da pubblicare: è la
    /// ragione per cui una view che segue la selezione non deve stupirsi di
    /// riceverne `None`.
    pub fn has_caret(&self) -> bool {
        matches!(self, PaneMode::Source | PaneMode::LivePreview)
    }
}

/// Una selezione di cui si sa il **testo** e basta: il buffer ha modifiche non
/// salvate, quindi nessuna coordinata di questo testo vale per il sorgente che
/// il kernel ha in mano.
///
/// Non è una selezione monca: è tutto ciò che è vero in quel momento. Chi conta
/// parole, chi manda il testo a un comando, chi lo cerca altrove ha qui ciò che
/// gli serve; chi vuole *ritagliare il file* non deve poterci provare, ed è la
/// ragione per cui il tipo non ha uno span nemmeno facoltativo.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FloatingSelection {
    /// Il testo selezionato, così com'è nell'editor. Vuoto = cursore senza
    /// selezione (è la forma con cui "inserisci qui" si esprime).
    pub text: String,
}

impl FloatingSelection {
    pub fn new(text: impl Into<String>) -> Self {
        FloatingSelection { text: text.into() }
    }

    /// Non c'è testo selezionato (è solo un cursore)?
    pub fn is_empty(&self) -> bool {
        self.text.is_empty()
    }
}

/// Una selezione **ancorata**: sa anche dove sta nel sorgente che il kernel
/// conosce.
///
/// Lo `span` non è facoltativo, e non lo è per un motivo che non riguarda
/// questa selezione ma l'insieme a cui appartiene: ciò che decide se le
/// coordinate valgono è lo stato del **buffer**, che è uno per pannello. Vedi
/// [`SelectionSet`].
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AnchoredSelection {
    /// Dove sta nel sorgente, in **byte UTF-8** come ogni [`Span`] del modello.
    pub span: Span,
    /// Il testo selezionato. È lo stesso testo che sta fra i due offset dello
    /// span, perché uno span esiste solo a buffer pulito.
    pub text: String,
}

/// Un cursore all'inizio del documento: è ciò che «una selezione, non detta»
/// può voler dire senza mentire ([`Span`] non ha un default, e non deve
/// averlo).
impl Default for AnchoredSelection {
    fn default() -> Self {
        AnchoredSelection::caret(0)
    }
}

impl AnchoredSelection {
    pub fn new(span: Span, text: impl Into<String>) -> Self {
        AnchoredSelection {
            span,
            text: text.into(),
        }
    }

    /// Un cursore ancorato: nessun testo, una posizione.
    pub fn caret(at: usize) -> Self {
        AnchoredSelection {
            span: Span::new(at, at),
            text: String::new(),
        }
    }

    /// Non c'è testo selezionato (è solo un cursore)?
    pub fn is_empty(&self) -> bool {
        self.text.is_empty()
    }
}

/// Le selezioni ancorate di un pannello: la primaria e le altre.
///
/// La primaria è un **campo**, non «la prima della lista»: vedi il doc del
/// modulo. `secondary` vuota = un cursore solo, che è il caso normale.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AnchoredSelections {
    /// Quella su cui agisce un comando che ne vuole una sola.
    pub primary: AnchoredSelection,
    /// Le altre, in ordine di posizione nel documento. La primaria **non** è
    /// qui dentro: chi le vuole tutte usa [`AnchoredSelections::all`].
    pub secondary: Vec<AnchoredSelection>,
}

impl AnchoredSelections {
    /// Una sola selezione: la primaria, e nessun'altra.
    pub fn one(primary: AnchoredSelection) -> Self {
        AnchoredSelections {
            primary,
            secondary: Vec::new(),
        }
    }

    /// Tutte, primaria compresa, in ordine di posizione.
    ///
    /// È l'iteratore di chi applica un'azione a **ogni** punto — il gesto per
    /// cui il multi-cursore esiste — e ordina perché chi ne fa degli edit deve
    /// poterli applicare senza spostarsi i propri offset sotto i piedi.
    pub fn all(&self) -> Vec<&AnchoredSelection> {
        let mut all: Vec<&AnchoredSelection> = std::iter::once(&self.primary)
            .chain(&self.secondary)
            .collect();
        all.sort_by_key(|s| (s.span.start, s.span.end));
        all
    }

    /// Quante sono, primaria compresa. Mai zero.
    pub fn len(&self) -> usize {
        1 + self.secondary.len()
    }

    /// Non c'è mai: esiste perché `len()` senza `is_empty()` è un warning di
    /// clippy, e la risposta è **sempre** `false`. Un insieme di selezioni
    /// vuoto non è rappresentabile — è l'`Option` di [`ViewContext`].
    pub fn is_empty(&self) -> bool {
        false
    }
}

/// Le selezioni fluttuanti di un pannello: la primaria e le altre, senza
/// coordinate.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FloatingSelections {
    /// Quella su cui agisce un comando che ne vuole una sola.
    pub primary: FloatingSelection,
    /// Le altre, in ordine di posizione nel documento.
    pub secondary: Vec<FloatingSelection>,
}

impl FloatingSelections {
    /// Una sola selezione: la primaria, e nessun'altra.
    pub fn one(primary: FloatingSelection) -> Self {
        FloatingSelections {
            primary,
            secondary: Vec::new(),
        }
    }

    /// Tutte, primaria compresa. Qui l'ordine è quello in cui la shell le ha
    /// consegnate: senza coordinate non c'è niente su cui ordinare.
    pub fn all(&self) -> Vec<&FloatingSelection> {
        std::iter::once(&self.primary)
            .chain(&self.secondary)
            .collect()
    }

    /// Quante sono, primaria compresa. Mai zero.
    pub fn len(&self) -> usize {
        1 + self.secondary.len()
    }

    /// Sempre `false`, per la stessa ragione di
    /// [`AnchoredSelections::is_empty`].
    pub fn is_empty(&self) -> bool {
        false
    }
}

/// Ciò che è selezionato in un pannello — o dove stanno i cursori, che sono
/// selezioni vuote.
///
/// I due casi non sono due forme della stessa cosa: sono lo **stato del
/// buffer**, che è uno solo, detto dove serve. A buffer pulito ogni selezione
/// sa dove sta; a buffer sporco nessuna lo sa, e la parola «nessuna» qui è
/// garantita dal tipo invece che da una regola da ricordare.
///
/// L'ordine dei casi è il discriminante al confine e non si tocca: `anchored`
/// sta per primo perché è quello su cui si può **agire**, cioè quello che una
/// firma su cui si può sbagliare deve nominare per primo (è l'ordine della
/// [`WriteBase`](crate::edit::WriteBase), per la stessa ragione).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
// Tag adiacente come [`WriteBase`](crate::edit::WriteBase): entrambi i casi
// portano un payload, e il tag interno costringerebbe a un `Deserialize` a
// mano per la shell.
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum SelectionSet {
    /// Il buffer non ha modifiche non salvate: le coordinate di ogni selezione
    /// valgono anche per il sorgente che il kernel ha in mano.
    Anchored(AnchoredSelections),
    /// Il buffer ha modifiche non salvate: il testo è vero, le coordinate no —
    /// e non lo sono **per tutte**, perché il buffer è uno.
    Floating(FloatingSelections),
}

impl SelectionSet {
    /// Una sola selezione ancorata.
    pub fn anchored(span: Span, text: impl Into<String>) -> Self {
        SelectionSet::Anchored(AnchoredSelections::one(AnchoredSelection::new(span, text)))
    }

    /// Un solo cursore ancorato.
    pub fn caret(at: usize) -> Self {
        SelectionSet::Anchored(AnchoredSelections::one(AnchoredSelection::caret(at)))
    }

    /// Una sola selezione fluttuante (buffer sporco).
    pub fn floating(text: impl Into<String>) -> Self {
        SelectionSet::Floating(FloatingSelections::one(FloatingSelection::new(text)))
    }

    /// Le selezioni ancorate, se questo insieme lo è.
    ///
    /// È la lettura di chi sta per **ritagliare il file**: se risponde `None`
    /// le coordinate non esistono, e non esistono per nessuna delle selezioni.
    pub fn placed(&self) -> Option<&AnchoredSelections> {
        match self {
            SelectionSet::Anchored(s) => Some(s),
            SelectionSet::Floating(_) => None,
        }
    }

    /// Il testo della selezione primaria: l'unica cosa che è vera in tutti e
    /// due i casi.
    pub fn primary_text(&self) -> &str {
        match self {
            SelectionSet::Anchored(s) => &s.primary.text,
            SelectionSet::Floating(s) => &s.primary.text,
        }
    }

    /// I testi di tutte le selezioni, primaria compresa.
    pub fn texts(&self) -> Vec<&str> {
        match self {
            SelectionSet::Anchored(s) => s.all().into_iter().map(|s| s.text.as_str()).collect(),
            SelectionSet::Floating(s) => s.all().into_iter().map(|s| s.text.as_str()).collect(),
        }
    }

    /// Quante sono. Mai zero.
    pub fn len(&self) -> usize {
        match self {
            SelectionSet::Anchored(s) => s.len(),
            SelectionSet::Floating(s) => s.len(),
        }
    }

    /// Sempre `false`: «niente selezione» è l'assenza dell'insieme, non un
    /// insieme vuoto.
    pub fn is_empty(&self) -> bool {
        false
    }

    /// Nessuna delle selezioni ha del testo dentro (sono tutti cursori)?
    pub fn is_caret_only(&self) -> bool {
        self.texts().iter().all(|t| t.is_empty())
    }
}

impl Default for SelectionSet {
    fn default() -> Self {
        SelectionSet::Anchored(AnchoredSelections::default())
    }
}

/// Il contesto in cui una view sta girando: il pannello con il focus e ciò che
/// contiene.
///
/// Lo **imposta la shell** e lo **legge** un provider via
/// [`HostEnv::active_context`](crate::traits::HostEnv::active_context). Non ha
/// un gemello che scrive: quale nota si guarda e in che modalità si legge sono
/// decisioni dell'utente sull'app, non capacità da concedere a un plugin.
///
/// **I campi sono quattro, e non un sottoinsieme da completare dopo**: la
/// decisione 0007 li ha messi tutti qui perché un campo in più a un record è
/// una migrazione di ogni provider che lo riceve. Il bersaglio di un clic
/// destro non è fra loro e non lo diventerà (decisione 0152), né è un caso di
/// [`ContextKind`], che nomina le parti al cui **cambio** una view invecchia:
/// un clic non cambia il contesto, lo interroga.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ViewContext {
    /// Il pannello a cui questo contesto appartiene.
    pub pane: PaneId,
    /// Il documento aperto nel pannello. `None` = pannello vuoto (l'app è
    /// aperta ma nessuna nota lo è).
    pub doc: Option<DocId>,
    /// Le selezioni dentro il documento — una, o quante ne ha il
    /// multi-cursore. `None` = niente cursore (modalità di lettura, o nessun
    /// documento); non esiste un insieme vuoto, e il campo si chiama al plurale
    /// perché al singolare direbbe una cosa falsa.
    pub selections: Option<SelectionSet>,
    pub mode: PaneMode,
}

impl ViewContext {
    /// Un pannello vuoto, in modalità normale: il contesto di un'app appena
    /// aperta.
    pub fn new(pane: impl Into<String>) -> Self {
        ViewContext {
            pane: PaneId::new(pane),
            doc: None,
            selections: None,
            mode: PaneMode::default(),
        }
    }

    /// Lo stesso contesto con un documento aperto (comodità per test e shell).
    pub fn with_doc(mut self, doc: Option<DocId>) -> Self {
        self.doc = doc;
        self
    }

    /// Lo stesso contesto con delle selezioni.
    pub fn with_selections(mut self, selections: Option<SelectionSet>) -> Self {
        self.selections = selections;
        self
    }

    /// Lo stesso contesto in un'altra modalità.
    pub fn with_mode(mut self, mode: PaneMode) -> Self {
        self.mode = mode;
        self
    }

    /// Cosa è cambiato passando da `self` a `next`.
    ///
    /// È la funzione con cui la shell decide **quali view ridisegnare** (vedi
    /// [`ContextMask`] e `ViewSpec::follows`): sta qui, e non nella shell,
    /// perché la risposta non deve dipendere da chi la calcola — il kernel la
    /// usa per rispondere a `set_active_context`, e a M5 un host diverso avrà
    /// la stessa.
    ///
    /// Un **cambio di pannello** conta come cambio di tutto: il contesto è di
    /// un altro pannello, e ogni campo che una view legge può valere un'altra
    /// cosa anche quando il confronto campo per campo direbbe di no.
    pub fn changes(&self, next: &ViewContext) -> ContextMask {
        if self.pane != next.pane {
            return ContextMask::all();
        }
        let mut kinds = Vec::new();
        if self.doc != next.doc {
            kinds.push(ContextKind::Document);
        }
        // Il confronto è per uguaglianza dell'**insieme**, quindi muovere uno
        // solo di N cursori conta come cambio: è ciò che si vuole, e va detto
        // invece che lasciato succedere. Chi segue la selezione la segue per
        // sapere *dove si sta lavorando*, e con più cursori si lavora in più
        // punti — un pannello statistiche che conta il testo di tutte, o una
        // view che evidenzia i punti attivi, invecchiano allo stesso modo se a
        // muoversi è il terzo cursore o il primo.
        if self.selections != next.selections {
            kinds.push(ContextKind::Selection);
        }
        if self.mode != next.mode {
            kinds.push(ContextKind::Mode);
        }
        ContextMask(kinds)
    }
}

/// Le parti di un [`ViewContext`] che possono cambiare da sole.
///
/// Non c'è un caso per il pannello: un cambio di pannello è un cambio di tutto
/// (vedi [`ViewContext::changes`]), e un caso a parte inviterebbe a dichiarare
/// di seguire il pannello senza seguire ciò che ci sta dentro.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextKind {
    /// Il documento aperto nel pannello.
    Document,
    /// La selezione o la posizione del cursore.
    Selection,
    /// La modalità del pannello.
    Mode,
}

/// Le parti del contesto al cui cambio una view invecchia.
///
/// È il gemello di [`EventMask`](crate::event::EventMask) per ciò che non è un
/// evento del vault: una nota che si apre e un cursore che si muove non sono
/// fatti del vault, sono fatti della sessione, e mescolarli agli eventi
/// significherebbe far passare ogni movimento del cursore per l'event bus e per
/// ogni handler registrato.
///
/// Vuota (il default) = la view non guarda il contesto. Dichiararla è ciò che
/// impedisce a una vista a grafo di ridisegnarsi a ogni battuta di tasto.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContextMask(pub Vec<ContextKind>);

impl ContextMask {
    pub fn all() -> Self {
        ContextMask(vec![
            ContextKind::Document,
            ContextKind::Selection,
            ContextKind::Mode,
        ])
    }

    /// Solo il documento: la maschera di chi mostra qualcosa *della nota*
    /// (backlink, struttura) e non di dove ci si trova dentro.
    pub fn document() -> Self {
        ContextMask(vec![ContextKind::Document])
    }

    pub fn contains(&self, kind: ContextKind) -> bool {
        self.0.contains(&kind)
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// C'è almeno una parte in comune con `other`? È la domanda che si fa chi
    /// ha in mano *cosa è cambiato* e deve decidere se una view lo segue.
    pub fn intersects(&self, other: &ContextMask) -> bool {
        self.0.iter().any(|k| other.contains(*k))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> ViewContext {
        ViewContext::new("main").with_doc(Some(DocId::new("Nota.md")))
    }

    #[test]
    fn a_context_survives_the_json_boundary_with_every_field() {
        let full = ctx()
            .with_selections(Some(SelectionSet::anchored(Span::new(3, 9), "ciao")))
            .with_mode(PaneMode::Reading);
        let json = serde_json::to_string(&full).unwrap();
        assert_eq!(
            serde_json::from_str::<ViewContext>(&json).unwrap(),
            full,
            "the context crosses the IPC boundary: a type that does not round-trip \
             through JSON is not a contract type"
        );
        // Le due forme in cui la selezione è "non posizionabile" e "assente"
        // devono restare distinte anche in JSON.
        let dirty = ctx().with_selections(Some(SelectionSet::floating("ciao")));
        let round: ViewContext =
            serde_json::from_str(&serde_json::to_string(&dirty).unwrap()).unwrap();
        assert_eq!(round, dirty);
        assert_eq!(round, ctx().with_selections(None));
    }

    #[test]
    fn what_changed_is_computed_field_by_field() {
        let before = ctx();
        assert!(
            before.changes(&before).is_empty(),
            "an identical context ages no view"
        );

        let after = before.clone().with_doc(Some(DocId::new("Altra.md")));
        assert_eq!(before.changes(&after), ContextMask::document());

        let after = before.clone().with_selections(Some(SelectionSet::caret(10)));
        assert_eq!(
            before.changes(&after),
            ContextMask(vec![ContextKind::Selection])
        );

        // Lo span che sparisce (il buffer è diventato sporco) È un cambio di
        // selezione: chi la segue deve sapere che non è più posizionabile.
        let dirty = after
            .clone()
            .with_selections(Some(SelectionSet::floating("")));
        assert_eq!(
            after.changes(&dirty),
            ContextMask(vec![ContextKind::Selection])
        );

        let after = before.clone().with_mode(PaneMode::Reading);
        assert_eq!(before.changes(&after), ContextMask(vec![ContextKind::Mode]));
    }

    #[test]
    fn another_pane_changes_everything() {
        let a = ctx();
        let b = ViewContext::new("split-2").with_doc(a.doc.clone());
        assert_eq!(
            a.changes(&b),
            ContextMask::all(),
            "focus is on another pane: even equal fields mean something \
             different"
        );
    }

    #[test]
    fn a_mask_intersects_only_what_it_declares() {
        let follows = ContextMask::document();
        assert!(follows.intersects(&ContextMask(vec![ContextKind::Document])));
        assert!(!follows.intersects(&ContextMask(vec![ContextKind::Selection])));
        assert!(
            !ContextMask::default().intersects(&ContextMask::all()),
            "one who declares nothing never redraws for context"
        );
    }

    #[test]
    fn reading_mode_has_no_caret() {
        assert!(!PaneMode::Reading.has_caret());
        assert!(PaneMode::LivePreview.has_caret());
        assert!(PaneMode::Source.has_caret());
    }
}
