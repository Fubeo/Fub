//! Il pannello **statistiche** come `ViewProvider` (FEATURES 4.3: conteggio
//! parole, conteggio caratteri, tempo di lettura).
//!
//! È il primo cliente della **selezione** nel contesto di sessione, ed è il
//! motivo per cui [`Selection`] porta il `text` e non solo lo span: "quante
//! parole ho selezionato" si risponde con il testo che l'utente ha davvero
//! sotto il cursore — cioè quello del buffer, che a metà di una frase appena
//! scritta **non è** quello che `read_document` restituirebbe. Un pannello che
//! ritagliasse il file salvato con gli offset del buffer conterebbe le parole
//! sbagliate proprio mentre si scrive, che è l'unico momento in cui il
//! conteggio serve.
//!
//! È anche l'unico cliente della **modalità**: in lettura non c'è cursore né
//! selezione, e ciò che di un documento interessa a chi legge è quanto ci
//! metterà — quindi in [`PaneMode::Reading`] il pannello mostra il tempo di
//! lettura al posto del conteggio della selezione.

use fub_abi::error::PluginError;
use fub_abi::event::{EventKind, EventMask};
use fub_abi::session::{ContextMask, PaneMode, Selection};
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{
    HostApi, ReadApi, ViewInstance, ViewInterests, ViewProvider, ViewSpec, ViewSurface,
};
use fub_abi::ui::{UiAction, UiNode, ViewUpdate};

/// Id del provider (spazio dati/registrazione) e id della view che offre.
pub const STATS_ID: &str = "fub.stats";
/// Id della `ViewSpec`: è ciò con cui la shell chiede questa view al kernel.
pub const STATS_VIEW: &str = "stats";

/// Parole al minuto di una lettura media. È una costante dichiarata e non un
/// parametro perché finché non ci sono impostazioni (§11.1) un numero
/// configurabile sarebbe configurabile solo nel codice.
const WPM: usize = 200;

/// Il pannello statistiche. Senza stato: sorgente e contesto li chiede all'host
/// a ogni render.
#[derive(Default)]
pub struct StatsView;

/// Conteggi di un pezzo di testo.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TextStats {
    pub words: usize,
    /// Caratteri come li conta un umano: **code point**, non byte — "però" ha
    /// cinque caratteri e sei byte, e mostrare sei sarebbe una bugia.
    pub chars: usize,
}

/// Conta parole e caratteri di un testo.
///
/// Conta il **sorgente**, sintassi markdown compresa: contare il testo reso
/// vorrebbe il modello parsato al di qua del confine, che è il canale che
/// ancora non c'è (§4.1). È una differenza di pochi punti percentuali su una
/// nota vera, e dichiararla costa meno che fingere una precisione che non c'è.
pub fn count(text: &str) -> TextStats {
    TextStats {
        words: text.split_whitespace().count(),
        chars: text.chars().count(),
    }
}

/// Minuti di lettura, arrotondati per eccesso. Un testo non vuoto non legge mai
/// "0 min".
pub fn reading_minutes(words: usize) -> usize {
    if words == 0 {
        return 0;
    }
    words.div_ceil(WPM)
}

impl ViewProvider for StatsView {
    fn interests(&self, _instance: &ViewInstance) -> ViewInterests {
        ViewInterests {
            // Il conteggio del documento invecchia a ogni scrittura (anche
            // quelle del watcher): `IndexUpdated` le copre tutte.
            refresh: EventMask::of([EventKind::IndexUpdated, EventKind::BatchEnded]),
            // Del contesto segue tutto: quale nota (di chi sono i conteggi), la
            // selezione (il conteggio della selezione) e la modalità (in
            // lettura il pannello dice un'altra cosa).
            follows: ContextMask::all(),
        }
    }

    fn views(&self) -> Vec<ViewSpec> {
        vec![
            // Sta nella **barra di stato**, e ci sta da questa seduta: prima le
            // superfici erano tre e questo pannello finiva "in basso", cioè in
            // un riquadro largo quanto la finestra per due conteggi. Il §2.2
            // nomina proprio questo caso — ciò che informa senza interrompere —
            // ed è il primo cliente di una superficie nuova.
            ViewSpec::new(STATS_VIEW, Text::key(VIEW_TITLE), ViewSurface::StatusBar)
                .open_by_default(),
        ]
    }

    fn render_view(
        &self,
        _instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        let Some(doc) = host.active_context().and_then(|c| c.doc) else {
            return Ok(riga(Text::key(NO_ACTIVE_DOC)));
        };
        // Il contesto è stato appena letto: rileggerlo qui darebbe la stessa
        // risposta, ma prenderlo una volta sola è ciò che rende il render una
        // fotografia coerente.
        let context = host
            .active_context()
            .expect("il contesto c'era un attimo fa");
        let source = host.read_document(&doc)?;
        Ok(build_stats_view(
            count(&source),
            selezione(&context.selection),
            context.mode,
        ))
    }

    fn on_action(
        &mut self,
        _instance: &ViewInstance,
        _action: UiAction,
        _host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        // Un pannello di sola lettura: non emette azioni, e non ne riconosce.
        Ok(ViewUpdate::None)
    }
}

/// I conteggi della selezione, se c'è del testo selezionato.
///
/// Un cursore senza testo non è una selezione da contare: `Selection::text`
/// vuoto significa "sono qui", non "ho selezionato niente".
fn selezione(selection: &Option<Selection>) -> Option<TextStats> {
    let s = selection.as_ref()?;
    (!s.is_empty()).then(|| count(&s.text))
}

/// Costruisce l'albero della view. Separato dal provider perché è pura
/// trasformazione dati→UI: si prova senza un host.
pub fn build_stats_view(doc: TextStats, selection: Option<TextStats>, mode: PaneMode) -> UiNode {
    let mut righe = vec![conteggi(DOC_COUNTS, doc)];
    match (mode, selection) {
        // In lettura non c'è selezione da contare: ciò che serve a chi legge è
        // quanto ci metterà.
        (PaneMode::Reading, _) => righe.push(Text::message(
            READING_TIME,
            vec![Arg::int(MINUTES, reading_minutes(doc.words).max(1) as i64)],
        )),
        (_, Some(sel)) => righe.push(conteggi(SELECTION_COUNTS, sel)),
        (_, None) => {}
    }
    UiNode::row(12, righe.into_iter().map(UiNode::text).collect())
}

/// Una riga di conteggi: i due numeri **come numeri**, non come pezzi di frase
/// già composta.
///
/// Le due righe che questo pannello scrive erano `format!` con un plurale
/// scelto qui dentro (`1 parola` / `2 parole`), ed è la cosa che non attraversa
/// il confine: la forma plurale non è una proprietà del numero, è una proprietà
/// della **lingua** — l'inglese ne ha due, il polacco tre, il giapponese una — e
/// sceglierla dove il numero nasce vuol dire sceglierla per una lingua che chi
/// scrive il provider non conosce.
///
/// Il motore dei template della 0040 sostituisce `{nome}` e non sa ancora
/// scegliere una forma; `ArgValue::Int` però conserva il numero apposta — il suo
/// doc lo dice: passare `"3"` butterebbe via ciò con cui una forma si sceglie.
/// Quindi finché la scelta non c'è, le due righe si scrivono in una forma che
/// non la chiede — `Parole: 3`, non `3 parole` —, che è onesta in tutte le
/// lingue e non finge una grammatica. Il giorno che il motore saprà scegliere,
/// a cambiare sarà **il catalogo**, e non questa funzione.
fn conteggi(key: &str, stats: TextStats) -> Text {
    Text::message(
        key,
        vec![
            Arg::int(WORDS, stats.words as i64),
            Arg::int(CHARS, stats.chars as i64),
        ],
    )
}

fn riga(testo: Text) -> UiNode {
    UiNode::row(12, vec![UiNode::text(testo)])
}

/// Il titolo del pannello, che sta nella barra di stato e si vede sempre.
const VIEW_TITLE: &str = "view_title";
/// Nessuna nota aperta: non è un errore, è uno stato.
const NO_ACTIVE_DOC: &str = "no_active_doc";
/// I conteggi del documento, e quelli della selezione: due chiavi e non una con
/// un prefisso, perché in una lingua qualsiasi la seconda può non essere la
/// prima con una parola davanti.
const DOC_COUNTS: &str = "doc_counts";
const SELECTION_COUNTS: &str = "selection_counts";
/// Il tempo di lettura stimato.
const READING_TIME: &str = "reading_time";
/// I nomi degli argomenti: sono parte della chiave quanto la chiave stessa —
/// un catalogo tradotto che scrive `{parole}` invece di `{words}` lascia la
/// graffa a vista, che è il degrado giusto e va comunque saputo.
const WORDS: &str = "words";
const CHARS: &str = "chars";
const MINUTES: &str = "minutes";

/// Le stringhe del pannello statistiche. Vedi
/// [`backlinks::catalog`](crate::backlinks::catalog) per il perché stia nel
/// componente e non nella shell.
pub fn catalog() -> Vec<StringCatalog> {
    vec![
        StringCatalog::new("it")
            .with(VIEW_TITLE, "Statistiche")
            .with(NO_ACTIVE_DOC, "Nessuna nota aperta.")
            .with(DOC_COUNTS, "Parole: {words} · Caratteri: {chars}")
            .with(
                SELECTION_COUNTS,
                "Selezione — parole: {words} · caratteri: {chars}",
            )
            .with(READING_TIME, "~{minutes} min di lettura"),
        StringCatalog::new("en")
            .with(VIEW_TITLE, "Statistics")
            .with(NO_ACTIVE_DOC, "No note open.")
            .with(DOC_COUNTS, "Words: {words} · Characters: {chars}")
            .with(
                SELECTION_COUNTS,
                "Selection — words: {words} · characters: {chars}",
            )
            .with(READING_TIME, "~{minutes} min read"),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::locale::Locale;
    use fub_abi::text::Strings;
    use fub_abi::ui::UiKind;
    use fub_sdk::testing::MemoryHost;

    /// Le righe del pannello **come le legge chi guarda**: risolte col catalogo
    /// di questo componente, invece che stampate col `Display` del `Text`.
    ///
    /// La differenza è il punto. Prima queste asserzioni confrontavano prosa
    /// italiana cablata nel provider, e non c'era niente da sbagliare; adesso
    /// passano dalla stessa strada di un utente — chiave, catalogo, template —
    /// e quindi una chiave senza voce, un nome d'argomento scritto diverso fra
    /// codice e catalogo, o una lingua che ne dimentica una riga, cadono qui.
    fn testi(tree: &UiNode) -> Vec<String> {
        righe(tree, "it")
    }

    fn righe(tree: &UiNode, lingua: &str) -> Vec<String> {
        let UiKind::Stack { children, .. } = &tree.kind else {
            panic!("il pannello è uno stack")
        };
        let catalogo = catalog();
        let locale = Locale {
            language: lingua.to_string(),
            ..Locale::default()
        };
        let strings = Strings::new(&catalogo, "it", &locale);
        children
            .iter()
            .map(|c| match &c.kind {
                UiKind::Text { content } => strings.render(content),
                other => panic!("nodo inatteso: {other:?}"),
            })
            .collect()
    }

    #[test]
    fn counts_words_and_characters_not_bytes() {
        let s = count("Però questo è àccentato");
        assert_eq!(s.words, 4);
        assert_eq!(
            s.chars, 23,
            "i caratteri sono code point: 'ò' è uno, non due byte"
        );
        assert_eq!(count(""), TextStats::default());
        assert_eq!(count("   \n  ").words, 0);
    }

    #[test]
    fn reading_time_rounds_up_and_is_zero_only_when_empty() {
        assert_eq!(reading_minutes(0), 0);
        assert_eq!(reading_minutes(1), 1);
        assert_eq!(reading_minutes(WPM), 1);
        assert_eq!(reading_minutes(WPM + 1), 2);
    }

    #[test]
    fn the_selection_is_counted_from_its_text_even_with_a_dirty_buffer() {
        let host = MemoryHost::new().con_documento("nota.md", "uno due tre");
        host.set_active(Some("nota.md"));
        // Il buffer ha modifiche non salvate: nessuno span attraversa il
        // confine. Il testo sì — ed è tutto ciò che serve a contarlo.
        host.set_context(Some(
            fub_abi::session::ViewContext::new("main")
                .with_doc(Some(fub_abi::model::DocId::new("nota.md")))
                .with_selection(Some(Selection {
                    span: None,
                    text: "quattro cinque".into(),
                })),
        ));
        let tree = StatsView
            .render_view(&ViewInstance::only(STATS_VIEW), &host)
            .unwrap();
        assert_eq!(
            testi(&tree),
            vec![
                "Parole: 3 · Caratteri: 11".to_string(),
                "Selezione — parole: 2 · caratteri: 14".to_string()
            ],
            "il conteggio del documento viene dal vault, quello della \
             selezione dal buffer: sono due testi diversi, ed è il caso normale \
             mentre si scrive"
        );
    }

    #[test]
    fn a_caret_is_not_a_selection() {
        let host = MemoryHost::new().con_documento("nota.md", "una parola");
        host.set_active(Some("nota.md"));
        host.set_caret(Some(3));
        assert_eq!(
            testi(
                &StatsView
                    .render_view(&ViewInstance::only(STATS_VIEW), &host)
                    .unwrap()
            ),
            vec!["Parole: 2 · Caratteri: 10".to_string()],
            "un cursore senza testo non è una selezione da contare"
        );
    }

    #[test]
    fn reading_mode_shows_the_reading_time_instead() {
        let host = MemoryHost::new().con_documento("nota.md", "una nota breve");
        host.set_active(Some("nota.md"));
        host.set_selection(0, "una nota");
        host.set_mode(PaneMode::Reading);
        assert_eq!(
            testi(
                &StatsView
                    .render_view(&ViewInstance::only(STATS_VIEW), &host)
                    .unwrap()
            ),
            vec![
                "Parole: 3 · Caratteri: 14".to_string(),
                "~1 min di lettura".to_string()
            ]
        );
    }

    #[test]
    fn without_a_document_it_says_so() {
        let host = MemoryHost::new();
        assert_eq!(
            testi(
                &StatsView
                    .render_view(&ViewInstance::only(STATS_VIEW), &host)
                    .unwrap()
            ),
            vec!["Nessuna nota aperta.".to_string()]
        );
    }

    #[test]
    fn one_word_reads_the_same_as_two() {
        // Il pannello scriveva `1 parola` e `2 parole`, e il plurale lo
        // sceglieva qui — cioè in italiano, per chiunque. Adesso il numero
        // arriva al catalogo **come numero** e la frase è scritta in una forma
        // che il plurale non lo chiede: è quello che si può promettere finché
        // il motore dei template non sa scegliere una forma (vedi `conteggi`).
        let tree = build_stats_view(
            TextStats { words: 1, chars: 1 },
            Some(TextStats { words: 1, chars: 1 }),
            PaneMode::LivePreview,
        );
        assert_eq!(
            testi(&tree),
            vec![
                "Parole: 1 · Caratteri: 1".to_string(),
                "Selezione — parole: 1 · caratteri: 1".to_string()
            ]
        );
    }

    #[test]
    fn the_english_catalog_says_the_same_things() {
        // Un catalogo tradotto a metà è la forma di rottura che nessuno vede:
        // le chiavi senza voce **non** falliscono, scendono alla chiave nuda e
        // finiscono davanti a chi legge come `doc_counts`. Qui si guarda che
        // ogni chiave che questo pannello sa produrre abbia una voce anche
        // nell'altra lingua, e che gli argomenti si chiamino allo stesso modo.
        let tree = build_stats_view(
            TextStats {
                words: 3,
                chars: 14,
            },
            None,
            PaneMode::Reading,
        );
        assert_eq!(
            righe(&tree, "en"),
            vec![
                "Words: 3 · Characters: 14".to_string(),
                "~1 min read".to_string()
            ]
        );
        assert_eq!(
            righe(
                &StatsView
                    .render_view(&ViewInstance::only(STATS_VIEW), &MemoryHost::new())
                    .unwrap(),
                "en"
            ),
            vec!["No note open.".to_string()]
        );
    }
}
