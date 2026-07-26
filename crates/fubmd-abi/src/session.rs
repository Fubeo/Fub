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
//! [`Selection::text`] è **sempre** il testo selezionato nell'editor;
//! [`Selection::span`] c'è solo quando le sue coordinate valgono anche per il
//! sorgente che il kernel ha in mano — cioè quando il buffer non ha modifiche
//! non salvate. Non è prudenza: è l'unico modo di rendere impossibile l'errore
//! che il contratto altrimenti inviterebbe a fare — leggere il documento con
//! [`HostApi::read_document`](crate::traits::HostApi::read_document) e
//! ritagliarlo con uno span calcolato su un altro testo, cioè tagliare i byte
//! sbagliati mentre l'utente scrive. Chi vuole il testo lo ha sempre; chi vuole
//! la posizione la ha quando è vera.

use serde::{Deserialize, Serialize};

use crate::model::{DocId, Span};

/// Identità di un pannello di editing: una scheda, una metà di uno split, una
/// finestra.
///
/// È una stringa opaca assegnata dalla shell: il kernel non la interpreta e non
/// la inventa mai (un pannello nasce e muore nell'app, non nel vault). Serve
/// perché un provider possa **distinguere** due contesti — tenere lo stato per
/// pannello in `storage_*`, accorgersi che il focus si è spostato — anche prima
/// che le view sappiano istanziarsi (§1.15).
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

/// Ciò che è selezionato in un pannello — o dove sta il cursore, che è una
/// selezione vuota.
///
/// Vedi la regola dello span nel doc del modulo: `text` è sempre vero, `span`
/// c'è solo quando le sue coordinate valgono anche per il sorgente del kernel.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Selection {
    /// Dove sta nel sorgente, in **byte UTF-8** come ogni [`Span`] del modello.
    /// `None` = il buffer ha modifiche non salvate, quindi nessuno span sarebbe
    /// vero; il testo qui sotto lo è comunque.
    pub span: Option<Span>,
    /// Il testo selezionato, così com'è nell'editor. Vuoto = cursore senza
    /// selezione (è la forma con cui "inserisci qui" si esprime).
    pub text: String,
}

impl Selection {
    /// Un cursore: nessun testo, la posizione se è vera.
    pub fn caret(span: Option<Span>) -> Self {
        Selection {
            span,
            text: String::new(),
        }
    }

    /// Non c'è testo selezionato (è solo un cursore)?
    pub fn is_empty(&self) -> bool {
        self.text.is_empty()
    }
}

/// Il contesto in cui una view sta girando: il pannello con il focus e ciò che
/// contiene.
///
/// Lo **imposta la shell** e lo **legge** un provider via
/// [`HostApi::active_context`](crate::traits::HostApi::active_context). Non ha
/// un gemello che scrive: quale nota si guarda, dove si è cliccato e in che
/// modalità si legge sono decisioni dell'utente sull'app, non capacità da
/// concedere a un plugin.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ViewContext {
    /// Il pannello a cui questo contesto appartiene.
    pub pane: PaneId,
    /// Il documento aperto nel pannello. `None` = pannello vuoto (l'app è
    /// aperta ma nessuna nota lo è).
    pub doc: Option<DocId>,
    /// La selezione dentro il documento. `None` = niente cursore (modalità di
    /// lettura, o nessun documento).
    pub selection: Option<Selection>,
    pub mode: PaneMode,
}

impl ViewContext {
    /// Un pannello vuoto, in modalità normale: il contesto di un'app appena
    /// aperta.
    pub fn new(pane: impl Into<String>) -> Self {
        ViewContext {
            pane: PaneId::new(pane),
            doc: None,
            selection: None,
            mode: PaneMode::default(),
        }
    }

    /// Lo stesso contesto con un documento aperto (comodità per test e shell).
    pub fn with_doc(mut self, doc: Option<DocId>) -> Self {
        self.doc = doc;
        self
    }

    /// Lo stesso contesto con una selezione.
    pub fn with_selection(mut self, selection: Option<Selection>) -> Self {
        self.selection = selection;
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
        if self.selection != next.selection {
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
            .with_selection(Some(Selection {
                span: Some(Span::new(3, 9)),
                text: "ciao".into(),
            }))
            .with_mode(PaneMode::Reading);
        let json = serde_json::to_string(&full).unwrap();
        assert_eq!(
            serde_json::from_str::<ViewContext>(&json).unwrap(),
            full,
            "il contesto attraversa l'IPC: un tipo che non fa il giro del JSON \
             non è un tipo del contratto"
        );
        // Le due forme in cui la selezione è "non posizionabile" e "assente"
        // devono restare distinte anche in JSON.
        let sporca = ctx().with_selection(Some(Selection {
            span: None,
            text: "ciao".into(),
        }));
        let round: ViewContext =
            serde_json::from_str(&serde_json::to_string(&sporca).unwrap()).unwrap();
        assert_eq!(round, sporca);
        assert_ne!(round, ctx().with_selection(None));
    }

    #[test]
    fn what_changed_is_computed_field_by_field() {
        let prima = ctx();
        assert!(
            prima.changes(&prima).is_empty(),
            "un contesto identico non invecchia nessuna view"
        );

        let dopo = prima.clone().with_doc(Some(DocId::new("Altra.md")));
        assert_eq!(prima.changes(&dopo), ContextMask::document());

        let dopo = prima
            .clone()
            .with_selection(Some(Selection::caret(Some(Span::new(10, 10)))));
        assert_eq!(
            prima.changes(&dopo),
            ContextMask(vec![ContextKind::Selection])
        );

        // Lo span che sparisce (il buffer è diventato sporco) È un cambio di
        // selezione: chi la segue deve sapere che non è più posizionabile.
        let sporca = dopo.clone().with_selection(Some(Selection::caret(None)));
        assert_eq!(
            dopo.changes(&sporca),
            ContextMask(vec![ContextKind::Selection])
        );

        let dopo = prima.clone().with_mode(PaneMode::Reading);
        assert_eq!(prima.changes(&dopo), ContextMask(vec![ContextKind::Mode]));
    }

    #[test]
    fn another_pane_changes_everything() {
        let a = ctx();
        let b = ViewContext::new("split-2").with_doc(a.doc.clone());
        assert_eq!(
            a.changes(&b),
            ContextMask::all(),
            "il focus è su un altro pannello: anche i campi uguali valgono \
             un'altra cosa"
        );
    }

    #[test]
    fn a_mask_intersects_only_what_it_declares() {
        let segue = ContextMask::document();
        assert!(segue.intersects(&ContextMask(vec![ContextKind::Document])));
        assert!(!segue.intersects(&ContextMask(vec![ContextKind::Selection])));
        assert!(
            !ContextMask::default().intersects(&ContextMask::all()),
            "chi non dichiara nulla non si ridisegna mai per il contesto"
        );
    }

    #[test]
    fn reading_mode_has_no_caret() {
        assert!(!PaneMode::Reading.has_caret());
        assert!(PaneMode::LivePreview.has_caret());
        assert!(PaneMode::Source.has_caret());
    }
}
