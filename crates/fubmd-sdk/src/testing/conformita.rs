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
use fubmd_abi::model::{
    heading_slug, Block, DocId, DocumentModel, Inline, Link, LinkTarget, Span, Tag,
};
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

/// Le proprietà di un [`FormatProvider`] che si verificano **senza un
/// ingresso**: quelle che si leggono nel descrittore.
///
/// Chi ha un ingresso da dare — cioè chi ha un corpus — chiami anche
/// [`un_modello_dice_il_vero_sulla_sorgente`], che è dove stanno le proprietà
/// che contano. Le due non sono unite perché una sorgente non c'è sempre: un
/// provider si può registrare e presidiare prima di avere un corpus, e la
/// firma che pretendesse un `&str` costringerebbe a inventarne uno — cioè a
/// provare il provider contro un esempio scelto dalla suite invece che dal suo
/// autore.
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
// FormatProvider: le proprietà che vogliono un ingresso
// ---------------------------------------------------------------------------

/// Quanto si pretende dagli span, e la ragione per cui sono **due** pretese e non
/// una.
///
/// La differenza non è di severità, è di **destinatario**. Un ingresso curato — il
/// corpus di chi scrive il provider — è markdown che qualcuno ha scelto, e su
/// quello si pretende tutto. Un ingresso **generato** dal fuzzer no, e non per
/// clemenza: su input costruiti per essere ostili un provider eredita dal parser
/// che ha sotto delle incoerenze di `sourcepos` che sono difetti veri, ma
/// *ripararle è una decisione su cosa sia lo span di un nodo* — non una cosa che
/// un presidio possa pretendere senza averla prima decisa. Pretenderla lo stesso
/// avrebbe un effetto solo: il fuzzer resta rosso, e chi lo trova rosso lo
/// disattiva.
///
/// Ciò che si pretende **sempre**, e che è quello che il §5.3 chiede al fuzzing
/// («un parser che pania è un vault che non si apre»), è l'altra metà: che nessuno
/// span faccia panicare chi lo usa, che il parse sia deterministico, e che il
/// modello non porti dentro il BOM.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Pretesa {
    /// Ogni span affetta la sorgente. Vale su **qualunque** ingresso.
    CheAffettino,
    /// E in più: ogni span sta dentro quello del nodo che lo contiene, e i
    /// fratelli non si sovrappongono. Si pretende su un corpus curato.
    ELaCoerenza,
}

/// **Ciò che il modello dice del documento è vero rispetto ai byte del file.**
///
/// È il gruppo che vuole una sorgente, e va chiamato su ogni voce di un corpus.
/// Chiama in fila: [`il_modello_dice_l_id_che_gli_e_stato_dato`],
/// [`gli_span_affettano_la_sorgente`] con [`Pretesa::ELaCoerenza`],
/// [`le_tabelle_piatte_sono_la_proiezione_dell_albero`],
/// [`lo_slug_di_un_heading_e_quello_del_contratto`],
/// [`il_bom_in_testa_non_e_contenuto`] e [`parse_e_deterministico`].
///
/// Restituisce `false` se il provider ha **rifiutato** la sorgente, cioè se non
/// c'era nessun modello da verificare. Non è un fallimento: un `Err` è una
/// risposta lecita, e su un ingresso generato è quella giusta più spesso che no.
/// Lo restituisce invece di ingoiarlo perché un corpus che finisce con zero
/// modelli verificati è un corpus che passa senza aver provato niente, e chi lo
/// scrive deve poterlo contare — è la stessa ragione per cui
/// [`cio_che_non_e_perduto_si_ritrova`] risponde `bool`.
pub fn un_modello_dice_il_vero_sulla_sorgente<F: FormatProvider + ?Sized>(
    formato: &F,
    source: &str,
    ctx: &ParseContext,
) -> bool {
    let Ok(model) = formato.parse(&DocumentSource::Text(source.to_string()), ctx) else {
        return false;
    };
    il_modello_dice_l_id_che_gli_e_stato_dato(&model, ctx);
    gli_span_affettano_la_sorgente(&model, source, Pretesa::ELaCoerenza);
    le_tabelle_piatte_sono_la_proiezione_dell_albero(&model);
    lo_slug_di_un_heading_e_quello_del_contratto(&model);
    il_bom_in_testa_non_e_contenuto(&model, source);
    parse_e_deterministico(formato, source, ctx);
    true
}

/// Ciò che deve valere su **qualunque** sorgente, compresa quella che nessuno ha
/// scelto: è il gruppo da dare a un fuzzer.
///
/// Non è «le stesse proprietà, più permissive»: è l'insieme di quelle la cui
/// violazione non produce un modello discutibile, produce un **panico o una
/// scrittura alla cieca**. Uno span che non affetta fa panicare il primo che lo
/// usa, e lo fa all'apertura di una nota; un parse non deterministico fa cambiare
/// un documento da sé fra un'apertura e la successiva; un BOM che diventa
/// contenuto rende una nota introvabile. Nessuna delle tre è un'opinione su come
/// vada rappresentato un costrutto.
///
/// Restituisce `false` se la sorgente è stata rifiutata: vedi
/// [`un_modello_dice_il_vero_sulla_sorgente`].
pub fn nessuno_span_manda_in_panico_chi_lo_usa<F: FormatProvider + ?Sized>(
    formato: &F,
    source: &str,
    ctx: &ParseContext,
) -> bool {
    let Ok(model) = formato.parse(&DocumentSource::Text(source.to_string()), ctx) else {
        return false;
    };
    il_modello_dice_l_id_che_gli_e_stato_dato(&model, ctx);
    gli_span_affettano_la_sorgente(&model, source, Pretesa::CheAffettino);
    il_bom_in_testa_non_e_contenuto(&model, source);
    parse_e_deterministico(formato, source, ctx);
    true
}

/// *«Id del documento che stiamo parsando (per riempire `DocumentModel.id`).»*
///
/// Il chiamante è il kernel, che quell'id ce l'ha già e lo usa come chiave di
/// tutto: grafo, indice, stato per-documento. Un provider che ne mettesse un
/// altro — il titolo del frontmatter, il path assoluto, il basename — non
/// romperebbe niente subito: farebbe atterrare i backlink e le versioni sotto
/// una chiave che nessuno interroga.
pub fn il_modello_dice_l_id_che_gli_e_stato_dato(model: &DocumentModel, ctx: &ParseContext) {
    assert_eq!(
        model.id.as_str(),
        ctx.doc_id,
        "il modello dice di essere `{}`, ma il contesto chiedeva `{}`.\n\
         L'id è la chiave con cui il kernel indicizza, risolve e versiona questo\n\
         documento ([decisione 0043](../../../../docs/decisions/0043-il-path-e-la-chiave.md)):\n\
         un provider che ne mette un altro non sbaglia il parse, fa atterrare\n\
         backlink e versioni sotto una chiave che nessuno interroga.",
        model.id.as_str(),
        ctx.doc_id
    );
}

/// *«Uno [`Span`] è un intervallo in **byte** nella sorgente originale.»*
///
/// La proprietà, per esteso e ricorsiva: ogni span del modello **affetta** la
/// sorgente, sta **dentro** quello del nodo che lo contiene, e non si sovrappone
/// a quello del fratello che lo precede.
///
/// È la proprietà che vale di più di tutta questa suite, e la ragione non è il
/// pannello sbagliato: le tabelle piatte e gli span sono **le coordinate con cui
/// si riscrive un file**. Una modifica programmatica è una patch chirurgica
/// guidata da uno span ([decisione 0008](../../../../docs/decisions/0008-modifica-chirurgica.md)):
/// uno span che mente di un byte non disegna male, **corrompe un documento** —
/// spunta la task sbagliata, rinomina dentro la parola accanto, taglia un
/// carattere a metà. E lo fa senza diventare rosso, perché il file resta UTF-8
/// valido.
///
/// I due versi che questa funzione tiene insieme e che da soli non basterebbero:
/// «affetta» esclude l'offset fuori dalla sorgente e quello in mezzo a un
/// carattere (`str::get` dice `None` a entrambi); «sta dentro, e dopo il
/// fratello» esclude il caso in cui tutti gli span sono affettabili e sbagliati
/// insieme — la tabella riga→byte spostata di uno, che affetta benissimo il
/// pezzo di documento accanto.
pub fn gli_span_affettano_la_sorgente(model: &DocumentModel, source: &str, pretesa: Pretesa) {
    let tutto = Span::new(0, source.len());
    blocchi_disgiunti_e_dentro(
        &model.body,
        tutto,
        source,
        "il corpo del documento",
        pretesa,
    );

    // Le tabelle piatte non hanno un padre nell'albero: si affettano, e basta.
    for l in &model.links {
        affetta(source, l.span, "lo span di un link");
    }
    for t in &model.tags {
        affetta(source, t.span, "lo span di un tag");
    }
    for h in &model.outline {
        affetta(source, h.span, "lo span di un heading dell'outline");
    }
    for a in &model.anchors {
        affetta(source, a.span, "lo span del blocco di un'ancora");
        let marcatore = affetta(source, a.marker, "il `marker` di un'ancora");
        // Il `marker` **non** deve stare dentro `span`, e la prima stesura di
        // questa proprietà lo pretendeva: la forma «ancora su riga propria»
        // (`Un paragrafo\n\n^abc123\n`), che è quella di Obsidian, mette il
        // marcatore *fuori* dal blocco che marca — e giustamente, perché è ciò
        // che fa sì che l'embed del blocco non si porti dietro l'id. Ciò che si
        // può pretendere è che il marcatore nomini davvero l'ancora.
        assert!(
            marcatore.to_lowercase().contains(&a.id.to_lowercase()),
            "l'ancora `{}` ha un `marker` ({:?}) che affetta `{marcatore}`, dove\n\
             il suo id non c'è. `marker` è il token che si riscrive per rinominare\n\
             l'ancora e che si toglie esportando: se nomina altri byte, quei due\n\
             gesti modificano un pezzo di documento che non è l'ancora.",
            a.id,
            a.marker
        );
    }
}

/// Le tabelle piatte sono **una proiezione dell'albero**, non una seconda
/// lettura del file.
///
/// `outline`, `links` e `tags` sono documentati come «piatti»: *«Heading in
/// ordine, piatti (per outline panel e link a heading)»*, *«Link piatti, risolti
/// in seguito dal grafo del kernel»*. Piatto vuol dire **la stessa cosa vista
/// senza camminare l'albero**, e questa funzione verifica che siano davvero la
/// stessa: stesso numero, stesso ordine, stessi span.
///
/// Il difetto che previene è il più silenzioso di questa famiglia, perché non
/// produce niente di sbagliato — produce **due documenti**. Il pannello outline
/// legge `outline`, l'anteprima legge `body`, il grafo legge `links` e chi
/// rinomina riscrive gli span di `links`: se le due letture divergono, ogni
/// consumatore ha ragione e il vault ha due verità. Il caso concreto è un link
/// che sta nell'albero e non nella tabella — e allora una rinomina non lo
/// aggiorna, lasciando un link rotto che nessuno ha scritto.
pub fn le_tabelle_piatte_sono_la_proiezione_dell_albero(model: &DocumentModel) {
    let mut heading_albero: Vec<(u8, Span)> = Vec::new();
    let mut link_albero: Vec<Link> = Vec::new();
    let mut tag_albero: Vec<Tag> = Vec::new();
    raccogli_blocchi(
        &model.body,
        &mut heading_albero,
        &mut link_albero,
        &mut tag_albero,
    );

    confronta_proiezione(
        "outline",
        &heading_albero,
        &model
            .outline
            .iter()
            .map(|h| (h.level, h.span))
            .collect::<Vec<_>>(),
    );
    confronta_proiezione(
        "links",
        &link_albero
            .iter()
            .map(|l| (l.target.clone(), l.embed, l.span))
            .collect::<Vec<_>>(),
        &model
            .links
            .iter()
            .map(|l| (l.target.clone(), l.embed, l.span))
            .collect::<Vec<_>>(),
    );
    confronta_proiezione(
        "tags",
        &tag_albero
            .iter()
            .map(|t| (t.name.clone(), t.span))
            .collect::<Vec<_>>(),
        &model
            .tags
            .iter()
            .map(|t| (t.name.clone(), t.span))
            .collect::<Vec<_>>(),
    );
}

/// *«L'ancora di un heading, **generata** dal suo testo.»*
///
/// La regola sta nel contratto ([`heading_slug`]) e non nel provider, e la
/// ragione è scritta là: due provider che la scrivessero ognuno per sé darebbero
/// due id diversi allo stesso titolo, e un `[[Nota#Titolo]]` risolverebbe
/// sull'uno e non sull'altro. Questa funzione verifica che chi riempie `slug` la
/// **applichi** invece di riscriverla.
pub fn lo_slug_di_un_heading_e_quello_del_contratto(model: &DocumentModel) {
    for h in &model.outline {
        assert_eq!(
            h.slug,
            heading_slug(&h.text),
            "l'heading `{}` porta lo slug `{}`, ma la regola del contratto\n\
             (`heading_slug`) su quel testo dà `{}`. Lo slug è la chiave con cui\n\
             si risolve un `[[Nota#Titolo]]`: una seconda idea di come si genera\n\
             è un link che funziona da un lato e non dall'altro.",
            h.text,
            h.slug,
            heading_slug(&h.text)
        );
    }
}

/// *«Un `Span { start: 0, end: 0 }` su un file col BOM inserisce **prima** del
/// BOM.»* Ne segue che il BOM **in testa** è sorgente, e non è contenuto.
///
/// Il difetto che chiude è invisibile per costruzione: un `U+FEFF` in testa al
/// testo di un blocco non si vede a schermo, e c'è comunque nel modello,
/// nell'HTML e nel testo indicizzato. Il sintomo è una nota che si trova
/// cercando il suo titolo e un titolo che non si trova, e nessuno sa perché.
///
/// # Solo quello in testa, e la differenza non è un dettaglio
///
/// `U+FEFF` in mezzo a un documento **è contenuto**: è uno spazio a larghezza
/// zero, un carattere che un utente può avere incollato e che il file dichiara.
/// La prima stesura di questa proprietà vietava ogni `U+FEFF`, ed è stata la
/// prima cosa che il fuzzer ha fatto diventare rossa — infilandone uno in mezzo
/// a un titolo. Un presidio che avesse preteso di toglierlo avrebbe chiesto al
/// provider di **modificare il documento dell'utente**, che è il contrario della
/// §2.4.
///
/// Quindi la forma è un conteggio: nessuna stringa del modello può contenerne
/// più di quanti la sorgente ne dichiari **al netto** di quello in testa. Il
/// BOM che cola dentro il contenuto lo si vede lo stesso, perché su un file che
/// comincia col BOM la franchigia è zero.
pub fn il_bom_in_testa_non_e_contenuto(model: &DocumentModel, source: &str) {
    let nella_sorgente = source.matches('\u{feff}').count();
    let franchigia = nella_sorgente - usize::from(source.starts_with('\u{feff}'));
    let controlla = |dove: &str, s: &str| {
        assert!(
            s.matches('\u{feff}').count() <= franchigia,
            "{dove} porta dentro {} `U+FEFF`, e la sorgente ne dichiara {} al\n\
             netto di quello in testa. Il BOM in testa è sorgente e non\n\
             contenuto: da lì finisce nel titolo, nel pannello e nell'indice di\n\
             ricerca, e la nota smette di trovarsi cercando la sua prima parola —\n\
             senza che niente si veda a schermo.\n\
             Il pezzo, come sta nel modello: {s:?}",
            s.matches('\u{feff}').count(),
            franchigia
        );
    };
    controlla("la proiezione a testo del modello", &model.text);
    for b in &model.body {
        bom_nei_blocchi(b, &controlla);
    }
}

/// Due `parse` della stessa sorgente danno lo stesso modello.
///
/// Il contratto non lo scrive, e ogni chiamante lo dà per buono: l'host riparsa
/// quando vuole — a ogni apertura, a ogni alimentazione dell'indice, camminando
/// il disco per raccogliere lo stato per-documento — e non tiene da parte il
/// modello di prima per confrontarlo. È la gemella di
/// [`render_view_non_ha_memoria`]: `&self` impedisce di mutare il provider, non
/// una cache dietro un `Mutex` né un contatore che entra in un `custom_kind`.
pub fn parse_e_deterministico<F: FormatProvider + ?Sized>(
    formato: &F,
    source: &str,
    ctx: &ParseContext,
) {
    let uno = formato.parse(&DocumentSource::Text(source.to_string()), ctx);
    let due = formato.parse(&DocumentSource::Text(source.to_string()), ctx);
    match (uno, due) {
        (Ok(a), Ok(b)) => assert!(
            a == b,
            "due `parse` della stessa sorgente hanno dato due modelli diversi.\n\
             L'host riparsa quando vuole e non tiene il modello di prima per\n\
             confrontarlo: uno stato nascosto qui dentro diventa un documento che\n\
             cambia da sé fra un'apertura e la successiva."
        ),
        (Err(_), Err(_)) => {}
        (a, b) => panic!(
            "due `parse` della stessa sorgente hanno dato un esito diverso:\n\
             il primo {}, il secondo {}.",
            if a.is_ok() {
                "è riuscito"
            } else {
                "ha fallito"
            },
            if b.is_ok() {
                "è riuscito"
            } else {
                "ha fallito"
            }
        ),
    }
}

// --- gli attrezzi delle due proprietà ricorsive ----------------------------

/// Il pezzo di sorgente che uno span nomina, o un panico che dice **quale** span
/// e perché non affetta.
///
/// `str::get` risponde `None` a due difetti diversi — l'offset fuori dalla
/// sorgente e l'offset in mezzo a un carattere — e sono l'uno e l'altro il
/// motivo per cui questa funzione esiste invece di uno `&source[a..b]`: quello
/// panicherebbe con il messaggio di `str`, che dice i byte e non dice di chi
/// sono.
fn affetta<'a>(source: &'a str, span: Span, cosa: &str) -> &'a str {
    match source.get(span.start..span.end) {
        Some(s) => s,
        None => panic!(
            "{cosa} è {span:?}, e non affetta la sorgente ({} byte).\n\
             O esce dal file, o cade in mezzo a un carattere. Uno span serve a\n\
             ritagliare e a riscrivere quel pezzo di documento: se non affetta,\n\
             il primo che lo usa non disegna male, va in panico — e lo fa\n\
             all'apertura di una nota, cioè addosso all'utente.",
            source.len()
        ),
    }
}

/// I fratelli non si sovrappongono, e stanno dentro il padre.
///
/// «Non si sovrappongono» è ciò che serve a chi **scrive**: due patch chirurgiche
/// su span che si intersecano non hanno un risultato definito, e chi le applica
/// in fila fa atterrare la seconda su offset che la prima ha già spostato.
///
/// # L'ordine, invece, non si pretende — e la ragione è una scoperta
///
/// La prima stesura pretendeva anche che i fratelli fossero in **ordine di
/// sorgente**, ed era sbagliata: `body` è documentato come «l'albero a blocchi
/// (per il rendering)», e l'ordine della resa non è quello del file. Il caso vero
/// che l'ha smentita sono le **note a piè di pagina**, che finiscono in coda a
/// `body` con lo span che punta in mezzo al documento — dove vanno rese, cioè
/// dove servono. Pretendere l'ordine avrebbe voluto dire chiedere a ogni provider
/// di rinunciare a quella libertà per far passare un presidio.
fn blocchi_disgiunti_e_dentro(
    blocchi: &[Block],
    padre: Span,
    source: &str,
    dove: &str,
    pretesa: Pretesa,
) {
    let mut spans = Vec::with_capacity(blocchi.len());
    for b in blocchi {
        let span = b.span();
        affetta(source, span, &format!("lo span di un blocco in {dove}"));
        // Uno span **vuoto** su un blocco che esiste è il modo in cui una
        // tabella riga→byte sballata si presenta quando chi la interroga è
        // robusto ai valori fuori range: non un errore, un numero plausibile.
        // È così che un file con i terminatori a `\r` passava questo presidio
        // avendo ogni span in fondo al file.
        //
        // Sta sotto la pretesa della coerenza e non sotto quella minima, e la
        // riga di confine è: uno span vuoto **affetta** (dà la stringa vuota),
        // quindi non fa panicare nessuno. Chi ci scrive inserisce nel posto
        // sbagliato, che è un danno — ma è il danno della famiglia che
        // `Pretesa` descrive, non quello che un fuzzer può pretendere risolto.
        if pretesa == Pretesa::ELaCoerenza {
            assert!(
                span.start < span.end,
                "in {dove} un blocco ha span vuoto ({span:?}) su una sorgente di \
                 {} byte.\n\
                 Un blocco esiste perché qualcosa nel file lo ha prodotto, quindi\n\
                 nomina almeno un byte. Uno span vuoto non dice «non lo so»: dice\n\
                 «qui», e ci manda chi ritaglia e chi riscrive.",
                source.len()
            );
        }
        dentro(span, padre, source, "un blocco", dove, pretesa);
        spans.push(span);
        figli_del_blocco(b, span, source, pretesa);
    }
    disgiunti(&mut spans, "blocchi fratelli", dove, pretesa);
}

/// Gli span di un gruppo di fratelli sono a due a due disgiunti.
///
/// Si ordinano per posizione e si guardano i vicini: `n log n` invece di `n²`, e
/// soprattutto un messaggio che nomina la coppia che si tocca invece della prima
/// che capita.
fn disgiunti(spans: &mut [Span], chi: &str, dove: &str, pretesa: Pretesa) {
    if pretesa == Pretesa::CheAffettino {
        return;
    }
    spans.sort_by_key(|s| (s.start, s.end));
    for coppia in spans.windows(2) {
        let (a, b) = (coppia[0], coppia[1]);
        assert!(
            a.end <= b.start,
            "in {dove} due {chi} si sovrappongono: {a:?} e {b:?}.\n\
             La separazione è ciò su cui poggia una patch chirurgica: due span che\n\
             si intersecano non hanno un risultato definito, e chi applica due\n\
             modifiche in fila fa atterrare la seconda su offset che la prima ha\n\
             già spostato. (L'ordine invece è libero: `body` è in ordine di resa,\n\
             non di sorgente.)"
        );
    }
}

/// La discesa nei figli di un blocco. Il `match` è **esaustivo di proposito**:
/// una variante nuova di [`Block`] non compila finché qualcuno non dice dove
/// stanno i suoi figli, che è il solo modo di non aggiungerne una che questa
/// proprietà non guarda.
fn figli_del_blocco(b: &Block, span: Span, source: &str, pretesa: Pretesa) {
    match b {
        Block::Heading { inlines, .. } | Block::Paragraph { inlines, .. } => {
            inline_disgiunti_e_dentro(inlines, span, source, "un blocco di testo", pretesa)
        }
        Block::Quote { blocks, .. } | Block::Custom { blocks, .. } => blocchi_disgiunti_e_dentro(
            blocks,
            span,
            source,
            "un blocco che contiene blocchi",
            pretesa,
        ),
        Block::List { items, .. } => {
            let mut spans = Vec::with_capacity(items.len());
            for it in items {
                affetta(source, it.span, "lo span di una voce di lista");
                dentro(
                    it.span,
                    span,
                    source,
                    "una voce di lista",
                    "la sua lista",
                    pretesa,
                );
                spans.push(it.span);
                if let Some(t) = &it.task {
                    affetta(source, t.span, "lo span del marcatore di una task");
                    dentro(
                        t.span,
                        it.span,
                        source,
                        "il marcatore di una task",
                        "la sua voce di lista",
                        pretesa,
                    );
                    assert!(
                        affetta(source, t.span, "il marcatore di una task")
                            .chars()
                            .count()
                            <= 1,
                        "il marcatore di una task affetta {:?}, cioè più di un\n\
                         carattere. Deve essere il **simbolo** e non le parentesi:\n\
                         spuntare una task è la sostituzione di un carattere solo,\n\
                         ed è la patch più piccola che si possa scrivere.",
                        affetta(source, t.span, "il marcatore di una task")
                    );
                }
                blocchi_disgiunti_e_dentro(
                    &it.blocks,
                    it.span,
                    source,
                    "una voce di lista",
                    pretesa,
                );
            }
            disgiunti(&mut spans, "voci di lista", "una lista", pretesa);
        }
        Block::Table { head, rows, .. } => {
            let mut spans = Vec::new();
            for riga in head.iter().chain(rows.iter()) {
                for cella in &riga.cells {
                    affetta(source, cella.span, "lo span di una cella");
                    dentro(
                        cella.span,
                        span,
                        source,
                        "una cella",
                        "la sua tabella",
                        pretesa,
                    );
                    spans.push(cella.span);
                    inline_disgiunti_e_dentro(
                        &cella.inlines,
                        cella.span,
                        source,
                        "una cella",
                        pretesa,
                    );
                }
            }
            disgiunti(&mut spans, "celle", "una tabella", pretesa);
        }
        // Non ha figli, e il campo `anchor` non è uno span.
        Block::CodeBlock { .. } | Block::ThematicBreak { .. } => {}
    }
}

/// Gli inline che **portano** uno span. `Text`, `Emph`, `Strong` e `Code` non ne
/// hanno uno nel contratto, quindi qui non c'è niente da verificare su di loro —
/// e il `match` resta esaustivo perché la variante nuova che ne portasse uno non
/// deve poter entrare in silenzio.
fn inline_disgiunti_e_dentro(
    inlines: &[Inline],
    padre: Span,
    source: &str,
    dove: &str,
    pretesa: Pretesa,
) {
    let mut spans = Vec::new();
    for i in inlines {
        let span = match i {
            // L'etichetta di un link è testo riparsato, e ciò che ci sta dentro
            // sta dentro **il link**, non accanto a lui: il padre della discesa
            // è il suo span.
            Inline::Link { span, label, .. } => {
                inline_disgiunti_e_dentro(
                    label.as_deref().unwrap_or(&[]),
                    *span,
                    source,
                    "l'etichetta di un link",
                    pretesa,
                );
                *span
            }
            Inline::TagRef { span, .. } | Inline::Custom { span, .. } => *span,
            Inline::Emph(dentro_) | Inline::Strong(dentro_) => {
                inline_disgiunti_e_dentro(dentro_, padre, source, dove, pretesa);
                continue;
            }
            Inline::Text(_) | Inline::Code(_) => continue,
        };
        affetta(source, span, &format!("lo span di un inline in {dove}"));
        dentro(span, padre, source, "un inline", dove, pretesa);
        spans.push(span);
    }
    disgiunti(&mut spans, "inline fratelli", dove, pretesa);
}

fn dentro(figlio: Span, padre: Span, source: &str, chi: &str, dove: &str, pretesa: Pretesa) {
    if pretesa == Pretesa::CheAffettino {
        return;
    }
    assert!(
        padre.start <= figlio.start && figlio.end <= padre.end,
        "{chi} ha span {figlio:?}, che esce da quello di {dove} ({padre:?}).\n\
         Il figlio affetta `{}` e il padre `{}`: uno dei due nomina un pezzo di\n\
         documento che non è il suo, e non c'è modo di sapere quale guardando il\n\
         solo modello. È il sintomo della tabella riga→byte spostata: tutti gli\n\
         span affettano, e affettano il pezzo accanto.",
        source.get(figlio.start..figlio.end).unwrap_or("?"),
        source.get(padre.start..padre.end).unwrap_or("?")
    );
}

fn raccogli_blocchi(
    blocchi: &[Block],
    heading: &mut Vec<(u8, Span)>,
    link: &mut Vec<Link>,
    tag: &mut Vec<Tag>,
) {
    for b in blocchi {
        match b {
            Block::Heading {
                level,
                inlines,
                span,
                ..
            } => {
                heading.push((*level, *span));
                raccogli_inline(inlines, link, tag);
            }
            Block::Paragraph { inlines, .. } => raccogli_inline(inlines, link, tag),
            Block::Quote { blocks, .. } | Block::Custom { blocks, .. } => {
                raccogli_blocchi(blocks, heading, link, tag)
            }
            Block::List { items, .. } => {
                for it in items {
                    raccogli_blocchi(&it.blocks, heading, link, tag);
                }
            }
            Block::Table { head, rows, .. } => {
                for riga in head.iter().chain(rows.iter()) {
                    for cella in &riga.cells {
                        raccogli_inline(&cella.inlines, link, tag);
                    }
                }
            }
            Block::CodeBlock { .. } | Block::ThematicBreak { .. } => {}
        }
    }
}

fn raccogli_inline(inlines: &[Inline], link: &mut Vec<Link>, tag: &mut Vec<Tag>) {
    for i in inlines {
        match i {
            Inline::Link {
                target,
                label,
                embed,
                span,
            } => {
                link.push(Link {
                    target: target.clone(),
                    embed: *embed,
                    span: *span,
                    context: None,
                });
                // **Anche dentro l'etichetta.** Non è un dettaglio della
                // ricorsione: l'etichetta di un link è testo che il provider
                // riparsa, e ciò che ci trova finisce nelle tabelle piatte come
                // qualunque altra cosa. La prima stesura di questa funzione non
                // ci scendeva, e questa proprietà è diventata rossa su un
                // `[[#Sezione]]` — dove dentro l'etichetta c'era un `TagRef`
                // che la tabella `tags` dichiarava e l'albero, letto male, no.
                raccogli_inline(label.as_deref().unwrap_or(&[]), link, tag);
            }
            Inline::TagRef { name, span } => tag.push(Tag {
                name: name.clone(),
                span: *span,
            }),
            Inline::Emph(dentro) | Inline::Strong(dentro) => raccogli_inline(dentro, link, tag),
            Inline::Text(_) | Inline::Code(_) | Inline::Custom { .. } => {}
        }
    }
}

fn confronta_proiezione<T: PartialEq + std::fmt::Debug>(quale: &str, albero: &[T], piatto: &[T]) {
    assert!(
        albero == piatto,
        "la tabella `{quale}` non è la proiezione dell'albero.\n\
         Camminando `body` se ne trovano {}, la tabella ne dichiara {}.\n\
         \n\
         dall'albero: {albero:?}\n\
         dalla tabella: {piatto:?}\n\
         \n\
         Non produce niente di sbagliato: produce **due documenti**. L'anteprima\n\
         legge l'albero, il grafo e chi rinomina leggono la tabella, il pannello\n\
         outline la tabella: se divergono ogni consumatore ha ragione e il vault\n\
         ha due verità. Un link che sta nell'albero e non nella tabella è un link\n\
         che nessuna rinomina aggiorna.",
        albero.len(),
        piatto.len()
    );
}

fn bom_nei_blocchi(b: &Block, controlla: &impl Fn(&str, &str)) {
    let inline = |inlines: &[Inline]| {
        for i in inlines {
            bom_negli_inline(i, controlla);
        }
    };
    match b {
        Block::Heading { inlines, .. } | Block::Paragraph { inlines, .. } => inline(inlines),
        Block::Quote { blocks, .. } | Block::Custom { blocks, .. } => {
            for b in blocks {
                bom_nei_blocchi(b, controlla);
            }
        }
        Block::List { items, .. } => {
            for it in items {
                for b in &it.blocks {
                    bom_nei_blocchi(b, controlla);
                }
            }
        }
        Block::Table { head, rows, .. } => {
            for riga in head.iter().chain(rows.iter()) {
                for cella in &riga.cells {
                    inline(&cella.inlines);
                }
            }
        }
        Block::CodeBlock { code, .. } => controlla("un blocco di codice", code),
        Block::ThematicBreak { .. } => {}
    }
}

fn bom_negli_inline(i: &Inline, controlla: &impl Fn(&str, &str)) {
    match i {
        Inline::Text(t) => controlla("un inline di testo", t),
        Inline::Code(t) => controlla("un inline di codice", t),
        Inline::Emph(dentro) | Inline::Strong(dentro) => {
            for i in dentro {
                bom_negli_inline(i, controlla);
            }
        }
        Inline::TagRef { name, .. } => controlla("il nome di un tag", name),
        Inline::Link { label, .. } => {
            for i in label.iter().flatten() {
                bom_negli_inline(i, controlla);
            }
        }
        Inline::Custom { .. } => {}
    }
}

// ---------------------------------------------------------------------------

/// L'insieme dei bersagli di link che un modello dichiara, nella forma in cui un
/// corpus li confronta con ciò che si aspetta.
///
/// Sta qui e non nel corpus di un provider perché la domanda «questo documento
/// che cosa nomina?» è la stessa per ogni formato, ed è quella con cui il grafo
/// del kernel si alimenta.
pub fn bersagli(model: &DocumentModel) -> BTreeSet<String> {
    model
        .links
        .iter()
        .map(|l| match &l.target {
            LinkTarget::Wiki { page, .. } => format!("wiki:{page}"),
            LinkTarget::Url(u) => format!("url:{u}"),
            LinkTarget::Path(p) => format!("path:{p}"),
        })
        .collect()
}

fn modello(id: &str, testo: &str) -> DocumentModel {
    let mut m = DocumentModel::empty(DocId::new(id));
    m.text = testo.to_string();
    m
}
