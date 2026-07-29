//! La suite di conformità: **le proprietà che il contratto promette**, rese
//! eseguibili da chi il contratto lo implementa.
//!
//! È la differenza fra «il contratto è documentato» e «il contratto è
//! verificabile da chi lo implementa». Ogni funzione qui dentro corrisponde a
//! una frase del doc-comment di un trait in `fubmd-abi/src/traits.rs`, ed è
//! scritta per essere chiamata da un test di *chi scrive il provider* — non da
//! un test del kernel.
//!
//! ```no_run
//! # use fubmd_sdk::testing::conformita;
//! # fn esempio(mio: &mut impl fubmd_abi::traits::IndexProvider) {
//! conformita::un_indice_rispetta_il_contratto(mio);
//! # }
//! ```
//!
//! # Le proprietà erano scritte su metodi che non esistono più
//!
//! Il §16.1 elencava «un `IndexProvider` che non perde documenti fra
//! `on_document_*` e `flush`». Quei metodi si chiamano
//! `on_documents_indexed`/`on_documents_removed` dalla [decisione
//! 0051](../../../../docs/decisions/0051-l-alimentazione-risponde.md), prendono
//! un **lotto**, e — che è il punto — restituiscono `Vec<IndexLoss>`.
//!
//! La proprietà è cambiata di **natura**, non di nome. Quando la perdita era
//! muta, una suite poteva solo dedurla: indicizza, interroga, e se non trovi
//! concludi che è andato perso. Adesso la perdita è **dicibile**, e ciò che si
//! verifica è più forte e più preciso — la *coerenza fra ciò che il provider
//! dichiara di aver perso e ciò che ha davvero*. Un indice che ingoia un
//! documento e restituisce un elenco vuoto non è più «un indice che perde»: è un
//! indice che **mente**, ed è una condizione che si può nominare.

use std::collections::BTreeSet;

use fubmd_abi::format::{DocumentSource, ParseContext, SourceKind};
use fubmd_abi::model::{DocId, DocumentModel};
use fubmd_abi::traits::{IndexProvider, IndexQuery, ReadApi, ViewProvider};
use fubmd_abi::FormatProvider;

use crate::testing::MemoryHost;

// ---------------------------------------------------------------------------
// IndexProvider
// ---------------------------------------------------------------------------

/// Tutte le proprietà di un [`IndexProvider`] che si verificano senza sapere
/// cosa quell'indice indicizzi. Va in panico con un messaggio che nomina la
/// proprietà violata.
///
/// Chiama in fila:
/// [`le_rotte_sono_stabili`], [`le_perdite_nominano_solo_cio_che_e_stato_dato`],
/// [`un_lotto_vuoto_non_perde_niente`] e
/// [`up_to_date_risponde_solo_di_cio_che_ha_visto`].
pub fn un_indice_rispetta_il_contratto<I: IndexProvider + ?Sized>(indice: &mut I) {
    le_rotte_sono_stabili(indice);
    le_perdite_nominano_solo_cio_che_e_stato_dato(indice);
    un_lotto_vuoto_non_perde_niente(indice);
    up_to_date_risponde_solo_di_cio_che_ha_visto(indice);
}

/// *«Cosa serve, dichiarato una volta alla registrazione.»*
///
/// Il kernel legge `routes()` **una volta sola**, al montaggio, e ne fa una
/// tabella di dispatch. Un indice che risponde in modo diverso alla seconda
/// chiamata ha una tabella che non corrisponde a sé stesso, e il sintomo sarebbe
/// una query che nessuno serve — o servita da chi non doveva.
pub fn le_rotte_sono_stabili<I: IndexProvider + ?Sized>(indice: &I) {
    let prima = indice.routes();
    let poi = indice.routes();
    assert_eq!(
        prima, poi,
        "`routes()` ha risposto due cose diverse a due chiamate di fila.\n\
         Il kernel la legge una volta al montaggio: ciò che dichiari lì è la\n\
         tabella di dispatch per tutta la vita del vault."
    );
}

/// *«Ciò che si elenca è perduto, ciò che non si elenca è preso.»*
///
/// Ne segue una proprietà che il contratto non scrive ma che ogni chiamante dà
/// per buona: una perdita può nominare **solo** un documento che era nel lotto.
/// Un id estraneo nell'esito è indistinguibile, per chi lo legge, da un
/// documento davvero perso — e manderebbe il kernel a raccontare all'utente che
/// una nota che non ha mai toccato non è più cercabile.
pub fn le_perdite_nominano_solo_cio_che_e_stato_dato<I: IndexProvider + ?Sized>(indice: &mut I) {
    let docs = vec![
        modello("conformita/uno.md", "il primo documento del banco"),
        modello("conformita/due.md", "il secondo documento del banco"),
    ];
    let dati: BTreeSet<DocId> = docs.iter().map(|d| d.id.clone()).collect();

    let perdite = indice.on_documents_indexed(&docs);
    for p in &perdite {
        assert!(
            dati.contains(&p.id),
            "`on_documents_indexed` ha elencato la perdita di `{}`, che non era\n\
             nel lotto. Una perdita può nominare solo ciò che ti è stato dato:\n\
             chi legge l'esito non ha modo di distinguere un id estraneo da un\n\
             documento davvero perso.",
            p.id.as_str()
        );
    }

    let ids: Vec<DocId> = docs.iter().map(|d| d.id.clone()).collect();
    let perdite = indice.on_documents_removed(&ids);
    for p in &perdite {
        assert!(
            dati.contains(&p.id),
            "`on_documents_removed` ha elencato la perdita di `{}`, che non era\n\
             fra gli id da togliere.",
            p.id.as_str()
        );
    }
}

/// *«Un elenco vuoto vuol dire che è andato tutto bene.»* Letto al contrario:
/// a chi non gli è stato chiesto niente non può essere andato male niente.
pub fn un_lotto_vuoto_non_perde_niente<I: IndexProvider + ?Sized>(indice: &mut I) {
    let perdite = indice.on_documents_indexed(&[]);
    assert!(
        perdite.is_empty(),
        "`on_documents_indexed(&[])` ha elencato {} perdite su un lotto vuoto.",
        perdite.len()
    );
    let perdite = indice.on_documents_removed(&[]);
    assert!(
        perdite.is_empty(),
        "`on_documents_removed(&[])` ha elencato {} perdite su un lotto vuoto.",
        perdite.len()
    );
}

/// [`IndexProvider::up_to_date`] risponde con gli id che **non** ha bisogno di
/// rileggere, e possono essere solo fra quelli che gli sono stati mostrati.
///
/// Il default del contratto è «non so niente, rileggili tutti», che è la
/// risposta sicura. Chi lo sovrascrive promette il contrario, ed è il posto in
/// cui un indice che si sbaglia fa saltare una rilettura che serviva — cioè non
/// diventa rosso, diventa stantio.
pub fn up_to_date_risponde_solo_di_cio_che_ha_visto<I: IndexProvider + ?Sized>(indice: &I) {
    let saltabili = indice.up_to_date(&[]);
    assert!(
        saltabili.is_empty(),
        "`up_to_date(&[])` ha detto che {} documenti sono aggiornati, senza che\n\
         gliene sia stato mostrato nessuno: può rispondere solo di ciò che ha\n\
         visto in questa chiamata.",
        saltabili.len()
    );
}

/// La proprietà che il §16.1 chiedeva, riscritta per il contratto di oggi:
/// **ciò che dichiari di non aver perso, devi averlo davvero.**
///
/// Vale solo per un indice che dichiara di servire una famiglia di query, e va
/// chiamata dandogli la query con cui ritrovare ciò che gli si è dato. Su un
/// indice che non dichiara rotte non c'è niente da verificare — e dirlo è la
/// risposta giusta, perché «questo indice non risponde a niente» è una
/// dichiarazione legittima e non un difetto.
///
/// Restituisce `false` se non c'era niente da verificare, così chi la chiama può
/// accorgersi che il suo indice non è stato provato invece di crederlo promosso.
pub fn cio_che_non_e_perduto_si_ritrova<I: IndexProvider + ?Sized>(
    indice: &mut I,
    docs: &[DocumentModel],
    query: IndexQuery,
    ritrovato: impl Fn(&fubmd_abi::traits::IndexResult, &DocId) -> bool,
) -> bool {
    if indice.routes().is_empty() {
        return false;
    }

    let perduti: BTreeSet<DocId> = indice
        .on_documents_indexed(docs)
        .into_iter()
        .map(|p| p.id)
        .collect();

    let mut host = MemoryHost::new();
    indice
        .flush(&mut host)
        .expect("`flush` dopo un'alimentazione riuscita");

    let esito = indice
        .query(query)
        .expect("l'indice serve la query dichiarata");

    for d in docs {
        if perduti.contains(&d.id) {
            continue;
        }
        assert!(
            ritrovato(&esito, &d.id),
            "`{}` non è stato elencato fra le perdite — quindi il contratto dice\n\
             che l'hai preso — ma dopo `flush` non si ritrova.\n\
             Un indice che ingoia un documento e restituisce un elenco vuoto non\n\
             è un indice che perde: è un indice che **mente**, e chi legge\n\
             l'esito non ha modo di accorgersene.",
            d.id.as_str()
        );
    }
    true
}

// ---------------------------------------------------------------------------
// ViewProvider
// ---------------------------------------------------------------------------

/// Tutte le proprietà di un [`ViewProvider`] che si verificano senza sapere cosa
/// quella view disegni, contro l'host che le si dà.
pub fn una_view_rispetta_il_contratto<V: ViewProvider + ?Sized>(view: &V, host: &dyn ReadApi) {
    gli_id_delle_view_sono_distinti(view);
    chi_si_ridisegna_su_index_updated_dichiara_anche_batch_ended(view);
    ogni_view_dichiarata_si_disegna(view, host);
    render_view_non_ha_memoria(view, host);
}

/// *«Una view che dichiara `IndexUpdated` deve dichiarare anche `BatchEnded`:
/// dentro un lotto il primo non arriva, e il secondo è ciò che le fa fare **un**
/// ridisegno dove prima ne faceva N.»*
///
/// È la [decisione 0011](../../../../docs/decisions/0011-il-lotto.md) letta dal
/// lato di chi scrive la view, ed è il difetto peggiore che questa suite sa
/// vedere: una view che sbaglia qui **non si rompe**, smette solo di
/// aggiornarsi dentro un lotto — cioè esattamente quando l'utente ha appena
/// fatto la cosa più grossa. Nessun test la vede fallire, perché fuori dal lotto
/// funziona.
pub fn chi_si_ridisegna_su_index_updated_dichiara_anche_batch_ended<V: ViewProvider + ?Sized>(
    view: &V,
) {
    for spec in view.views() {
        // La regola sta in **un posto solo** ([decisione
        // 0020](../../../../docs/decisions/0020-le-regole-in-un-posto-solo.md)):
        // `misses_batches` è del contratto, e questa funzione la applica invece
        // di riscriverla. Una seconda idea della stessa regola, scritta in un
        // banco di prova, è il modo in cui due presidi finiscono per non essere
        // d'accordo.
        assert!(
            !spec.refresh.misses_batches(),
            "la view `{}` si ridisegna su `index-updated` ma non su\n\
             `batch-ended`. Dentro un lotto `index-updated` non arriva: questa\n\
             view smetterà di aggiornarsi proprio quando l'utente ha fatto la\n\
             cosa più grossa, e nessun test la vedrà fallire perché fuori dal\n\
             lotto funziona.",
            spec.id
        );
    }
}

/// Due `ViewSpec` con lo stesso id sono due view che il kernel non sa
/// distinguere: la seconda registrazione vince, o perde, e in nessuno dei due
/// casi chi ha scritto il provider se ne accorge.
pub fn gli_id_delle_view_sono_distinti<V: ViewProvider + ?Sized>(view: &V) {
    let specs = view.views();
    let mut visti = BTreeSet::new();
    for s in &specs {
        assert!(
            visti.insert(s.id.clone()),
            "`views()` dichiara due volte l'id `{}`.",
            s.id
        );
    }
}

/// Ogni view **dichiarata** deve sapersi disegnare: `views()` è una promessa, e
/// una `ViewSpec` che `render_view` non serve è una voce di menu che si apre su
/// un errore.
pub fn ogni_view_dichiarata_si_disegna<V: ViewProvider + ?Sized>(view: &V, host: &dyn ReadApi) {
    for spec in view.views() {
        let istanza = fubmd_abi::traits::ViewInstance::only(spec.id.clone());
        if let Err(e) = view.render_view(&istanza, host) {
            panic!(
                "`views()` dichiara `{}`, ma `render_view` su quell'id ha risposto\n\
                 con un errore: {e:?}.\n\
                 Ciò che si dichiara si disegna: una `ViewSpec` che nessuno serve\n\
                 è una voce di menu che si apre su un errore.",
                spec.id
            );
        }
    }
}

/// *«Un `ViewProvider` che non muta durante `render_view`.»*
///
/// La forma in cui il §16.1 lo chiedeva è **già garantita dal tipo**:
/// `render_view` prende `&self`, quindi mutare non compila. Ciò che il tipo non
/// garantisce, e che questa funzione verifica, è che non ci sia una mutabilità
/// interna nascosta — una cache dietro un `Mutex`, un contatore — che renda il
/// secondo disegno diverso dal primo a host fermo. È la proprietà su cui la
/// shell si appoggia per ridisegnare quando vuole.
pub fn render_view_non_ha_memoria<V: ViewProvider + ?Sized>(view: &V, host: &dyn ReadApi) {
    for spec in view.views() {
        let istanza = fubmd_abi::traits::ViewInstance::only(spec.id.clone());
        let Ok(prima) = view.render_view(&istanza, host) else {
            continue;
        };
        let Ok(poi) = view.render_view(&istanza, host) else {
            panic!("`render_view` su `{}` è riuscita e poi fallita", spec.id);
        };
        assert_eq!(
            prima, poi,
            "due `render_view` di fila su `{}`, a host fermo, hanno dato due\n\
             alberi diversi. `&self` impedisce di mutare il provider, ma non una\n\
             cache dietro un `Mutex`: la shell ridisegna quando vuole, e conta su\n\
             questo.",
            spec.id
        );
    }
}

// ---------------------------------------------------------------------------
// FormatProvider
// ---------------------------------------------------------------------------

/// Le proprietà di un [`FormatProvider`] che si verificano senza sapere quale
/// sintassi parsi.
pub fn un_formato_rispetta_il_contratto<F: FormatProvider + ?Sized>(formato: &F) {
    un_provider_testuale_rifiuta_i_byte(formato);
    il_descrittore_dichiara_almeno_una_estensione(formato);
}

/// *«Un provider testuale che ricevesse dei byte risponde
/// [`FormatError::Unsupported`] invece di indovinare l'encoding.»*
///
/// [`FormatError::Unsupported`]: fubmd_abi::error::FormatError::Unsupported
///
/// È la proprietà che protegge i file dell'utente: indovinare un encoding
/// riesce quasi sempre, e quando sbaglia produce un documento leggibile e
/// sbagliato — cioè un danno che non si vede finché non è stato salvato sopra
/// l'originale.
pub fn un_provider_testuale_rifiuta_i_byte<F: FormatProvider + ?Sized>(formato: &F) {
    let d = formato.descriptor();
    if d.source != SourceKind::Text {
        return;
    }
    let esito = formato.parse(
        &DocumentSource::Bytes(vec![0xff, 0xfe, 0x00, 0x41]),
        &ParseContext::bare("conformita/byte.bin"),
    );
    assert!(
        esito.is_err(),
        "`{}` si dichiara `SourceKind::Text` ma ha parsato dei byte grezzi\n\
         invece di rifiutarli. Indovinare un encoding riesce quasi sempre, e\n\
         quando sbaglia produce un documento leggibile e **sbagliato**: un danno\n\
         che si vede solo dopo averlo salvato sopra l'originale.",
        d.id
    );
}

/// Un formato che non dichiara estensioni non riceverà mai un file: il registro
/// instrada per estensione, e una registrazione riuscita che non serve niente è
/// la forma più silenziosa in cui un provider può non esserci.
pub fn il_descrittore_dichiara_almeno_una_estensione<F: FormatProvider + ?Sized>(formato: &F) {
    let d = formato.descriptor();
    assert!(
        !d.extensions.is_empty(),
        "`{}` non dichiara nessuna estensione: si registrerà senza errori e non\n\
         riceverà mai un file.",
        d.id
    );
}

// ---------------------------------------------------------------------------

fn modello(id: &str, testo: &str) -> DocumentModel {
    let mut m = DocumentModel::empty(DocId::new(id));
    m.text = testo.to_string();
    m
}
