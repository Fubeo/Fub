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

use fubmd_abi::error::PluginError;
use fubmd_abi::event::{EventKind, EventMask};
use fubmd_abi::session::{ContextMask, PaneMode, Selection};
use fubmd_abi::traits::{HostApi, ReadApi, ViewInstance, ViewProvider, ViewSpec, ViewSurface};
use fubmd_abi::ui::{UiAction, UiNode, ViewUpdate};

/// Id del provider (spazio dati/registrazione) e id della view che offre.
pub const STATS_ID: &str = "fubmd.stats";
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
    fn views(&self) -> Vec<ViewSpec> {
        vec![
            // Sta nella **barra di stato**, e ci sta da questa seduta: prima le
            // superfici erano tre e questo pannello finiva "in basso", cioè in
            // un riquadro largo quanto la finestra per due conteggi. Il §2.2
            // nomina proprio questo caso — ciò che informa senza interrompere —
            // ed è il primo cliente di una superficie nuova.
            ViewSpec::new(STATS_VIEW, "Statistiche", ViewSurface::StatusBar)
                // Il conteggio del documento invecchia a ogni scrittura (anche
                // quelle del watcher): `IndexUpdated` le copre tutte.
                .refreshing(EventMask(vec![
                    EventKind::IndexUpdated,
                    EventKind::BatchEnded,
                ]))
                // Del contesto segue tutto: quale nota (di chi sono i
                // conteggi), la selezione (il conteggio della selezione) e la
                // modalità (in lettura il pannello dice un'altra cosa).
                .following(ContextMask::all())
                .open_by_default(),
        ]
    }

    fn render_view(
        &self,
        _instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        let Some(doc) = host.active_context().and_then(|c| c.doc) else {
            return Ok(riga("Nessuna nota aperta."));
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
    let mut righe = vec![format!(
        "{} · {}",
        plurale(doc.words, "parola", "parole"),
        plurale(doc.chars, "carattere", "caratteri")
    )];
    match (mode, selection) {
        // In lettura non c'è selezione da contare: ciò che serve a chi legge è
        // quanto ci metterà.
        (PaneMode::Reading, _) => righe.push(format!(
            "~{} min di lettura",
            reading_minutes(doc.words).max(1)
        )),
        (_, Some(sel)) => righe.push(format!(
            "selezione: {} · {}",
            plurale(sel.words, "parola", "parole"),
            plurale(sel.chars, "carattere", "caratteri")
        )),
        (_, None) => {}
    }
    UiNode::row(12, righe.into_iter().map(UiNode::text).collect())
}

fn plurale(n: usize, uno: &str, molti: &str) -> String {
    format!("{n} {}", if n == 1 { uno } else { molti })
}

fn riga(testo: &str) -> UiNode {
    UiNode::row(12, vec![UiNode::text(testo)])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::MemoryHost;
    use fubmd_abi::ui::UiKind;

    fn testi(tree: &UiNode) -> Vec<String> {
        let UiKind::Stack { children, .. } = &tree.kind else {
            panic!("il pannello è uno stack")
        };
        children
            .iter()
            .map(|c| match &c.kind {
                UiKind::Text { content } => content.clone(),
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
            fubmd_abi::session::ViewContext::new("main")
                .with_doc(Some(fubmd_abi::model::DocId::new("nota.md")))
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
                "3 parole · 11 caratteri".to_string(),
                "selezione: 2 parole · 14 caratteri".to_string()
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
            vec!["2 parole · 10 caratteri".to_string()],
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
                "3 parole · 14 caratteri".to_string(),
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
    fn one_word_is_singular() {
        let tree = build_stats_view(
            TextStats { words: 1, chars: 1 },
            Some(TextStats { words: 1, chars: 1 }),
            PaneMode::LivePreview,
        );
        assert_eq!(
            testi(&tree),
            vec![
                "1 parola · 1 carattere".to_string(),
                "selezione: 1 parola · 1 carattere".to_string()
            ]
        );
    }
}
