//! La suite di conformità: **le proprietà che il contratto promette**, rese
//! eseguibili da chi implementa il contratto.
//!
//! È la differenza fra «il contratto è documentato» e «il contratto è
//! verificabile da chi lo implementa». Sono ventitré funzioni [conta: conformance-functions],
//! ed è quel numero che [decision 0054] una volta scrisse come «otto» quando
//! erano già quattordici: d'ora in poi conta la guardia del §16.8, non chi
//! scrive la frase.
//!
//! [decision 0054]: https://github.com/Fubeo/Fub/blob/main/docs/decisions/0054-the-provider-side-bench.md
//!
//! Ogni funzione qui corrisponde a una frase del doc-comment di un trait in
//! `fub-abi/src/traits.rs`, ed è scritta per essere chiamata da un test
//! dell'*autore della feature* — non da un test del kernel.
//!
//! ```no_run
//! # use fub_sdk::testing::conformance;
//! # fn example(my: &mut impl fub_abi::traits::IndexProvider) {
//! conformance::an_index_respects_the_contract(my);
//! # }
//! ```
//!
//! # Le proprietà erano state scritte per metodi che non esistono più
//!
//! Il §16.1 elencava «un `IndexProvider` che non perde documenti fra
//! `on_document_*` e `flush`». Quei metodi si chiamano
//! `on_documents_indexed`/`on_documents_removed` dalla [decision
//! 0051](../../../../docs/decisions/0051-indexing-responds.md), prendono un
//! **lotto** e — ed è il punto — restituiscono `Vec<IndexLoss>`.
//!
//! La proprietà è cambiata in **natura**, non nel nome. Quando la perdita era
//! silenziosa, una suite poteva solo dedurla: indicizza, interroga, e se non
//! trovi nulla concludi che si è perso. Ora la perdita è **dicibile**, e ciò
//! che si verifica è più forte e più preciso — la *coerenza fra ciò che il
//! provider dichiara di aver perso e ciò che ha davvero perso*. Un indice che
//! ingoia un documento e restituisce un elenco vuoto non è più «un indice che
//! perde»: è un indice che **mente**, ed è una condizione che si può
//! nominare.

use std::collections::BTreeSet;

use fub_abi::error::FormatError;
use fub_abi::format::{DocumentSource, ParseContext, SourceKind};
use fub_abi::model::{
    canonical_anchor, heading_slugs, Block, DocId, DocumentModel, Heading, Inline, Link,
    LinkTarget, Span, Tag,
};
use fub_abi::traits::{IndexProvider, IndexQuery, ReadApi, ViewProvider};
use fub_abi::FormatProvider;

use crate::testing::MemoryHost;

// ---------------------------------------------------------------------------
// IndexProvider
// ---------------------------------------------------------------------------

/// Tutte le proprietà di un [`IndexProvider`] verificabili senza sapere
/// cosa l'indice indicizza. Va in panico con un messaggio che nomina la
/// proprietà violata.
///
/// Chiama in ordine:
/// [`routes_are_stable`], [`losses_name_only_what_was_given`],
/// [`an_empty_batch_loses_nothing`] e
/// [`up_to_date_only_reported_what_it_saw`].
pub fn an_index_respects_the_contract<I: IndexProvider + ?Sized>(index: &mut I) {
    routes_are_stable(index);
    losses_name_only_what_was_given(index);
    an_empty_batch_loses_nothing(index);
    up_to_date_only_reported_what_it_saw(index);
}

/// *«Ciò che si serve, dichiarato una volta alla registrazione.»*
///
/// Il kernel legge `routes()` **una volta**, al montaggio, e costruisce la
/// tabella di dispatch. Un indice che risponde diversamente alla seconda
/// chiamata ha una tabella che non corrisponde a sé stessa, e il sintomo
/// sarebbe una query che nessuno serve — o che serve chi non dovrebbe.
pub fn routes_are_stable<I: IndexProvider + ?Sized>(index: &I) {
    let first = index.routes();
    let then = index.routes();
    assert_eq!(
        first, then,
        "`routes()` ha risposto due cose diverse a due chiamate di fila.\n\
         Il kernel la legge una volta al montaggio: ciò che dichiari lì è la\n\
         tabella di dispatch per tutta la vita del vault."
    );
}

/// *«Ciò che è elencato è perso, ciò che non è elencato è preso.»*
///
/// Segue una proprietà che il contratto non scrive ma che ogni chiamante dà
/// per scontata: una perdita può nominare **solo** un documento che era nel
/// lotto. Un id estraneo nell'esito è indistinguibile, per chi lo legge, da
/// un documento davvero perso — e manderebbe il kernel a dire all'utente che
/// una nota che non ha mai toccato non è più ricercabile.
pub fn losses_name_only_what_was_given<I: IndexProvider + ?Sized>(index: &mut I) {
    let docs = vec![
        model("conformita/uno.md", "il primo documento del banco"),
        model("conformita/due.md", "il secondo documento del banco"),
    ];
    let data: BTreeSet<DocId> = docs.iter().map(|d| d.id.clone()).collect();

    let losses = index.on_documents_indexed(&docs);
    for p in &losses {
        assert!(
            data.contains(&p.id),
            "`on_documents_indexed` ha elencato la perdita di `{}`, che non era\n\
             nel lotto. Una perdita può nominare solo ciò che ti è stato dato:\n\
             chi legge l'esito non ha modo di distinguere un id estraneo da un\n\
             documento davvero perso.",
            p.id.as_str()
        );
    }

    let ids: Vec<DocId> = docs.iter().map(|d| d.id.clone()).collect();
    let losses = index.on_documents_removed(&ids);
    for p in &losses {
        assert!(
            data.contains(&p.id),
            "`on_documents_removed` ha elencato la perdita di `{}`, che non era\n\
             fra gli id da togliere.",
            p.id.as_str()
        );
    }
}

/// *«Una lista vuota significa che è andato tutto bene.»* Letta al contrario:
/// niente può essere andato male a chi non è stato chiesto nulla.
pub fn an_empty_batch_loses_nothing<I: IndexProvider + ?Sized>(index: &mut I) {
    let losses = index.on_documents_indexed(&[]);
    assert!(
        losses.is_empty(),
        "`on_documents_indexed(&[])` listed {} losses on an empty batch.",
        losses.len()
    );
    let losses = index.on_documents_removed(&[]);
    assert!(
        losses.is_empty(),
        "`on_documents_removed(&[])` listed {} losses on an empty batch.",
        losses.len()
    );
}

/// [`IndexProvider::up_to_date`] risponde con gli id che **non** deve
/// rileggere, e possono essere solo fra quelli che gli sono stati mostrati.
///
/// Il default del contratto è «non so niente, rileggili tutti», ed è la
/// risposta sicura. Chi lo sovrascrive promette il contrario, ed è qui che un
/// indice che sbaglia fa saltare una rilettura necessaria — cioè non diventa
/// rosso: diventa stantio.
pub fn up_to_date_only_reported_what_it_saw<I: IndexProvider + ?Sized>(index: &I) {
    let skippable = index.up_to_date(&[]);
    assert!(
        skippable.is_empty(),
        "`up_to_date(&[])` ha detto che {} documenti sono aggiornati, senza che\n\
         gliene sia stato mostrato nessuno: può rispondere solo di ciò che ha\n\
         visto in questa chiamata.",
        skippable.len()
    );
}

/// La proprietà che il §16.1 chiedeva, riscritta per il contratto di oggi:
/// **ciò che dichiari di non aver perso, lo devi avere davvero.**
///
/// Vale solo per un indice che dichiara di servire una famiglia di query, e
/// va chiamata passandole la query con cui ritrovare ciò che le è stato dato.
/// Su un indice che non dichiara rotte non c'è nulla da verificare — e dirlo
/// è la risposta corretta, perché «questo indice non risponde a niente» è una
/// dichiarazione legittima e non un difetto.
///
/// Restituisce `false` quando non c'era nulla da verificare, così il chiamante
/// si accorge che il suo indice non è stato testato invece di credere che sia
/// passato.
pub fn what_is_not_lost_is_found_again<I: IndexProvider + ?Sized>(
    index: &mut I,
    docs: &[DocumentModel],
    query: IndexQuery,
    found: impl Fn(&fub_abi::traits::IndexResult, &DocId) -> bool,
) -> bool {
    if index.routes().is_empty() {
        return false;
    }

    let lost: BTreeSet<DocId> = index
        .on_documents_indexed(docs)
        .into_iter()
        .map(|p| p.id)
        .collect();

    let mut host = MemoryHost::new();
    index
        .flush(&mut host)
        .expect("`flush` dopo un'alimentazione riuscita");

    let result = index
        .query(query)
        .expect("l'indice serve la query dichiarata");

    for d in docs {
        if lost.contains(&d.id) {
            continue;
        }
        assert!(
            found(&result, &d.id),
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

/// Tutte le proprietà di un [`ViewProvider`] verificabili senza sapere
/// cosa la view disegna, contro l'host che le viene dato.
pub fn a_view_respects_the_contract<V: ViewProvider + ?Sized>(view: &V, host: &dyn ReadApi) {
    view_ids_are_distinct(view);
    redrawing_on_index_updated_declares_batch_ended(view);
    every_declared_view_draws(view, host);
    render_view_has_no_memory(view, host);
}

/// *«Una view che dichiara `IndexUpdated` deve dichiarare anche `BatchEnded`:
/// dentro un lotto il primo non arriva, ed è il secondo a farle fare **un**
/// ridisegno dove prima ne faceva N.»*
///
/// È la [decision 0011](../../../../docs/decisions/0011-the-batch.md) letta
/// dal lato dell'autore della view, ed è il peggior difetto che questa suite
/// possa vedere: una view che sbaglia questo **non si rompe**, smette solo di
/// aggiornarsi dentro un lotto — cioè proprio quando l'utente ha appena fatto
/// la cosa più grossa. Nessun test la vede fallire, perché fuori dal lotto
/// funziona.
pub fn redrawing_on_index_updated_declares_batch_ended<V: ViewProvider + ?Sized>(
    view: &V,
) {
    for spec in view.views() {
        // La regola vive in **un posto solo** ([decision
        // 0020](../../../../docs/decisions/0020-rules-in-one-place.md)):
        // `misses_batches` viene dal contratto, e questa funzione la applica
        // invece di riscriverla. Una seconda idea della stessa regola, scritta
        // in un banco di test, è il modo in cui due guardie finiscono per
        // non essere d'accordo.
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
/// distinguere: la seconda registrazione vince o perde, e in nessuno dei due
/// casi l'autore del provider se ne accorge.
pub fn view_ids_are_distinct<V: ViewProvider + ?Sized>(view: &V) {
    let specs = view.views();
    let mut seen = BTreeSet::new();
    for s in &specs {
        assert!(
            seen.insert(s.id.clone()),
            "`views()` declares id `{}` twice.",
            s.id
        );
    }
}

/// Ogni view **dichiarata** deve saper disegnare sé stessa: `views()` è una
/// promessa, e una `ViewSpec` che `render_view` non serve è una voce di menu
/// che si apre su un errore.
pub fn every_declared_view_draws<V: ViewProvider + ?Sized>(view: &V, host: &dyn ReadApi) {
    for spec in view.views() {
        let instance = fub_abi::traits::ViewInstance::only(spec.id.clone());
        if let Err(and) = view.render_view(&instance, host) {
            panic!(
                "`views()` dichiara `{}`, ma `render_view` su quell'id ha risposto\n\
                 con un errore: {and:?}.\n\
                 Ciò che si dichiara si disegna: una `ViewSpec` che nessuno serve\n\
                 è una voce di menu che si apre su un errore.",
                spec.id
            );
        }
    }
}

/// *«Un `ViewProvider` che non muta durante `render_view`.»*
///
/// La forma che il §16.1 chiedeva è **già garantita dal tipo**:
/// `render_view` prende `&self`, quindi mutare non compila. Ciò che il tipo
/// non garantisce, e che questa funzione verifica, è che non ci sia
/// mutabilità interna nascosta — una cache dietro un `Mutex`, un contatore —
/// che renda il secondo disegno diverso dal primo su un host fermo. È la
/// proprietà su cui la shell conta per ridisegnare quando vuole.
pub fn render_view_has_no_memory<V: ViewProvider + ?Sized>(view: &V, host: &dyn ReadApi) {
    for spec in view.views() {
        let instance = fub_abi::traits::ViewInstance::only(spec.id.clone());
        let Ok(first) = view.render_view(&instance, host) else {
            continue;
        };
        let Ok(then) = view.render_view(&instance, host) else {
            panic!("`render_view` on `{}` succeeded and then failed", spec.id);
        };
        assert_eq!(
            first, then,
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

/// Proprietà di un [`FormatProvider`] verificabili **senza un input**:
/// quelle leggibili dal descrittore.
///
/// Chi ha un input da dare — cioè chi ha un corpus — dovrebbe chiamare anche
/// [`a_model_tells_the_truth_about_the_source`], dove stanno le proprietà che
/// contano. Le due non sono fuse perché una sorgente non c'è sempre: un
/// provider può essere registrato e presidiato prima di avere un corpus, e una
/// firma che chiedesse una `&str` costringerebbe a inventarne una — cioè a
/// testare il provider contro un esempio scelto dalla suite invece che dal suo
/// autore.
pub fn a_format_respects_the_contract<F: FormatProvider + ?Sized>(format: &F) {
    a_text_provider_refuses_bytes(format);
    the_descriptor_declares_at_least_one_extension(format);
}

/// *«Un provider di testo che riceve byte risponde
/// [`FormatError::Unsupported`] invece di indovinare l'encoding.»*
///
/// [`FormatError::Unsupported`]: fub_abi::error::FormatError::Unsupported
///
/// È la proprietà che protegge i file dell'utente: indovinare un encoding
/// riesce quasi sempre, e quando sbaglia produce un documento leggibile ma
/// **sbagliato** — un danno che si vede solo dopo aver salvato sopra
/// l'originale.
pub fn a_text_provider_refuses_bytes<F: FormatProvider + ?Sized>(format: &F) {
    let d = format.descriptor();
    if d.source != SourceKind::Text {
        return;
    }
    let result = format.parse(
        &DocumentSource::Bytes(vec![0xff, 0xfe, 0x00, 0x41]),
        &ParseContext::bare("conformance/byte.bin"),
    );
    let Err(and) = result else {
        panic!(
            "`{}` declares itself `SourceKind::Text` but parsed raw bytes\n\
             invece di rifiutarli. Indovinare un encoding riesce quasi sempre, e\n\
             quando sbaglia produce un documento leggibile e **sbagliato**: un danno\n\
             che si vede solo dopo averlo salvato sopra l'originale.",
            d.id
        );
    };
    // Rifiutare non basta: `parse`/`render`/`serialize` finiscono in un log,
    // e solo `unsupported` arriva agli occhi di chi ha aperto il file, dove
    // significa «nessuno lo serve» e il consiglio è installare un plugin. Un
    // provider che rifiutasse con `Parse` direbbe all'utente che il suo
    // allegato è malformato, cioè la cosa sbagliata sul file sbagliato.
    let FormatError::Unsupported { format, got } = &and else {
        panic!(
            "`{}` refused raw bytes with `{and:?}` instead of with\n\
             `Unsupported`. The other three variants say \"this document is broken\"\n\
             and end up in a log; this one says \"this source is not mine\" and is\n\
             the only one the kernel carries to `Unserved`, meaning in front of\n\
             whoever just tried to open the file.",
            d.id
        );
    };
    // I due campi sono ciò con cui la frase è composta all'uscita, e il
    // compilatore ti costringe a *portarli*, non a portarli **giusti**: un
    // provider che si nomina con l'id di un altro manda l'utente a cercare il
    // plugin sbagliato.
    assert_eq!(
        (format.as_str(), *got),
        (d.id.as_str(), SourceKind::Bytes),
        "`{}` refused saying it is `{format}` and received\n\
         `{got:?}`. Sono i due dati con cui il kernel compone la frase che\n\
         l'utente legge: sbagliarli manda a installare il plugin sbagliato.",
        d.id
    );
}

/// Un formato che non dichiara estensioni non riceverà mai un file: il registro
/// instrada per estensione, e una registrazione riuscita che non serve niente
/// è la forma più silenziosa in cui un provider può essere assente.
pub fn the_descriptor_declares_at_least_one_extension<F: FormatProvider + ?Sized>(format: &F) {
    let d = format.descriptor();
    assert!(
        !d.extensions.is_empty(),
        "`{}` declares no extensions: it will register without errors and never\n\
         receive a file.",
        d.id
    );
}

// ---------------------------------------------------------------------------
// FormatProvider: proprietà che richiedono un input
// ---------------------------------------------------------------------------

/// Quanto ci si aspetta dagli span, e il motivo per cui i livelli sono **due**
/// e non uno.
///
/// La differenza non è di gravità ma di **pubblico**. Un input curato — il
/// corpus dell'autore del provider — è markdown scelto da qualcuno, e su
/// quello ci si aspetta tutto. Un input **generato** dal fuzzer no, e non per
/// pietà: su input costruiti per essere ostili un provider eredita dal parser
/// che ha sotto le incongruenze di sourcepos che sono difetti veri, ma
/// *ripararle è una decisione su cosa sia lo span di un nodo* — non qualcosa
/// che una guardia può pretendere senza averlo deciso prima. Pretenderlo
/// comunque avrebbe un effetto solo: il fuzzer resta rosso, e chi lo vede
/// rosso lo disattiva.
///
/// Ciò che è **sempre** atteso, e ciò che il §17.1 chiede al fuzzing («un
/// parser che va in panico è un vault che non si apre»), è l'altra metà: che
/// nessuno span mandi in panico chi lo usa, che il parse sia deterministico,
/// e che il modello non porti il BOM dentro.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Claim {
    /// Ogni span affetta la sorgente. Vale per **qualsiasi** input.
    SliceOnly,
    /// E in più: ogni span sta dentro quello del suo nodo contenitore,
    /// e i fratelli non si sovrappongono. Richiesto su un corpus curato.
    Coherence,
}

/// **Ciò che il modello dice del documento è vero rispetto ai byte del file.**
///
/// È il gruppo che vuole una sorgente, e va chiamato su ogni voce di un
/// corpus. Chiama in ordine: [`the_model_matches_the_given_id`],
/// [`spans_slice_the_source`] con [`Claim::Coherence`],
/// [`flat_tables_are_the_tree_projection`],
/// [`a_heading_slug_matches_the_contract`],
/// [`leading_bom_is_not_content`] e [`parse_is_deterministic`].
///
/// Restituisce `false` se il provider ha **rifiutato** la sorgente, cioè se
/// non c'era un modello da verificare. Non è un fallimento: un `Err` è una
/// risposta legittima, e su un input generato è quella giusta più spesso di
/// quanto non lo sia il contrario. Restituisce `false` invece di ingoiarlo
/// perché un corpus che finisce con zero modelli verificati è un corpus che
/// passa senza aver testato niente, e il suo autore deve poter contare — la
/// stessa ragione per cui [`what_is_not_lost_is_found_again`] restituisce
/// `bool`.
pub fn a_model_tells_the_truth_about_the_source<F: FormatProvider + ?Sized>(
    format: &F,
    source: &str,
    ctx: &ParseContext,
) -> bool {
    let Ok(model) = format.parse(&DocumentSource::Text(source.to_string()), ctx) else {
        return false;
    };
    the_model_matches_the_given_id(&model, ctx);
    spans_slice_the_source(&model, source, Claim::Coherence);
    flat_tables_are_the_tree_projection(&model);
    a_heading_slug_matches_the_contract(&model);
    leading_bom_is_not_content(&model, source);
    parse_is_deterministic(format, source, ctx);
    true
}

/// Ciò che deve valere su **qualsiasi** sorgente, anche una che nessuno ha
/// scelto: è il gruppo da dare a un fuzzer.
///
/// Non è «le stesse proprietà, più permissive»: è l'insieme di quelle la cui
/// violazione non produce un modello discutibile ma un **panico o una
/// scrittura cieca**. Uno span che non affetta manda in panico il primo che
/// lo usa, e lo fa all'apertura della nota; un parse non deterministico fa
/// cambiare un documento da sé fra un'apertura e la successiva; un BOM che
/// diventa contenuto rende una nota introvabile. Nessuna delle tre è
/// un'opinione su come rappresentare una costruzione.
///
/// Restituisce `false` se la sorgente è stata rifiutata: vedi
/// [`a_model_tells_the_truth_about_the_source`].
pub fn no_span_panics_its_user<F: FormatProvider + ?Sized>(
    format: &F,
    source: &str,
    ctx: &ParseContext,
) -> bool {
    let Ok(model) = format.parse(&DocumentSource::Text(source.to_string()), ctx) else {
        return false;
    };
    the_model_matches_the_given_id(&model, ctx);
    spans_slice_the_source(&model, source, Claim::SliceOnly);
    leading_bom_is_not_content(&model, source);
    parse_is_deterministic(format, source, ctx);
    true
}

/// *«L'id del documento che stiamo parsando (per riempire `DocumentModel.id`).»*
///
/// Il chiamante è il kernel, che quell'id ce l'ha già e lo usa come chiave
/// per tutto: grafo, indice, stato per documento. Un provider che ne mettesse
/// uno diverso — il titolo del frontmatter, il percorso assoluto, il
/// basename — non romperebbe nulla subito: farebbe atterrare backlink e
/// versioni sotto una chiave che nessuno interroga.
pub fn the_model_matches_the_given_id(model: &DocumentModel, ctx: &ParseContext) {
    assert_eq!(
        model.id.as_str(),
        ctx.doc_id,
        "the model says it is `{}`, but the context asked for `{}`.\n\
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
/// La proprietà, per intero e ricorsiva: ogni span del modello **affetta** la
/// sorgente, sta **dentro** quello del nodo contenitore, e non si sovrappone
/// a quello del fratello precedente.
///
/// È la proprietà più preziosa dell'intera suite, e il motivo non è il
/// pannello sbagliato: le tabelle piatte e gli span sono **le coordinate con
/// cui un file viene riscritto**. Una modifica programmatica è una patch
/// chirurgica guidata da uno span ([decision
/// 0008](../../../../docs/decisions/0008-surgical-edit.md)): uno span che
/// mente di un byte non disegna male, **corrompe un documento** — spunta la
/// task sbagliata, rinomina dentro la parola accanto, taglia un carattere a
/// metà. E lo fa senza diventare rosso, perché il file resta UTF-8 valido.
///
/// Le due metà che questa funzione tiene insieme e che da sole non
/// basterebbero: «affetta» esclude l'offset fuori dalla sorgente e quello in
/// mezzo a un carattere (`str::get` restituisce `None` per entrambi);
/// «sta dentro, e dopo il fratello» esclude il caso in cui tutti gli span
/// affettano e sono sbagliati insieme — la tabella riga→byte spostata di uno,
/// che affetta perfettamente il pezzo di documento accanto.
pub fn spans_slice_the_source(model: &DocumentModel, source: &str, claim: Claim) {
    let whole = Span::new(0, source.len());
    blocks_are_disjoint_and_contained(
        &model.body,
        whole,
        source,
        "il corpo del documento",
        claim,
    );

    // Le tabelle piatte non hanno un padre nell'tree: si affettano, e basta.
    for the in &model.links {
        slices(source, the.span, "lo span di un link");
    }
    for t in &model.tags {
        slices(source, t.span, "lo span di un tag");
    }
    for h in &model.outline {
        slices(source, h.span, "lo span di un heading dell'outline");
    }
    for a in &model.anchors {
        slices(source, a.span, "lo span del blocco di un'ancora");
        let marker = slices(source, a.marker, "il `marker` di un'ancora");
        // Il `marker` **non** deve stare dentro `span`, e la prima stesura di
        // questa proprietà lo pretendeva: la forma «ancora su riga propria»
        // (`A paragraph\n\n^abc123\n`), che è quella di Obsidian, mette il
        // marker *fuori* dal blocco che marca — e giustamente, perché è ciò
        // che fa sì che l'embed del blocco non si porti l'id dietro. Ciò che
        // si può pretendere è che il marker nomini davvero l'ancora.
        assert!(
            marker.to_lowercase().contains(&a.id.to_lowercase()),
            "l'ancora `{}` ha un `marker` ({:?}) che affetta `{marker}`, dove\n\
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
/// `outline`, `links` e `tags` sono documentati come «piatti»: *«Headings in
/// order, flat (for outline panel and link to heading)»*, *«Flat links,
/// resolved later by the kernel graph»*. Piatto significa **la stessa cosa
/// vista senza camminare l'albero**, e questa funzione verifica che lo siano
/// davvero: stesso numero, stesso ordine, stessi span.
///
/// Il difetto che previene è il più silenzioso di questa famiglia, perché non
/// produce niente di sbagliato — produce **due documenti**. Il pannello
/// outline legge `outline`, l'anteprima legge `body`, il grafo legge `links`,
/// e chi rinomina riscrive gli span di `links`: se le due letture divergono,
/// ogni consumatore ha ragione e il vault ha due verità. Il caso concreto è
/// un link che sta nell'albero ma non nella tabella — e allora una rinomina
/// non lo aggiorna, lasciando un link rotto che nessuno ha scritto.
pub fn flat_tables_are_the_tree_projection(model: &DocumentModel) {
    let mut heading_tree: Vec<(u8, Span)> = Vec::new();
    let mut link_tree: Vec<Link> = Vec::new();
    let mut tag_tree: Vec<Tag> = Vec::new();
    collect_blocks(
        &model.body,
        &mut heading_tree,
        &mut link_tree,
        &mut tag_tree,
    );

    assert_projection_matches(
        "outline",
        &heading_tree,
        &model
            .outline
            .iter()
            .map(|h| (h.level, h.span))
            .collect::<Vec<_>>(),
    );
    assert_projection_matches(
        "links",
        &link_tree
            .iter()
            .map(|the| (the.target.clone(), the.embed, the.span))
            .collect::<Vec<_>>(),
        &model
            .links
            .iter()
            .map(|the| (the.target.clone(), the.embed, the.span))
            .collect::<Vec<_>>(),
    );
    assert_projection_matches(
        "tags",
        &tag_tree
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

/// *«L'ancora di un heading, **generata** dal suo testo — e da chi c'era
/// prima di lui.»*
///
/// La regola sta nel contratto ([`heading_slugs`]) e non nel provider, e il
/// motivo è scritto lì: due provider che la scrivessero per conto loro
/// darebbero due id diversi allo stesso titolo, e un `[[Note#Title]]`
/// risolverebbe sull'uno e non sull'altro. Questa funzione verifica che chi
/// riempie `slug` la **applichi** invece di riscriverla.
///
/// Si confronta l'**intero** outline, non un titolo alla volta, perché lo
/// slug non è una funzione del solo testo: due `## Notes` non possono
/// portare lo stesso `id`, e finché il confronto era `slug ==
/// heading_slug(text)` la disambiguazione era letteralmente **vietata** a chi
/// avesse voluto scriverla.
///
/// L'eccezione è un heading con **ancora esplicita** (`## Title ^My-ID`):
/// chi ha scritto un id non viene disambiguato dal contratto, e il suo `slug`
/// è la forma canonica di quell'id ([`canonical_anchor`]) — non un prodotto
/// di [`heading_slugs`]. Gli id espliciti non consumano la numerazione, quindi
/// la sequenza generata è calcolata solo dai titoli senza ancora.
pub fn a_heading_slug_matches_the_contract(model: &DocumentModel) {
    let without_explicit: Vec<&Heading> = model
        .outline
        .iter()
        .filter(|h| h.explicit_anchor.is_none())
        .collect();
    let mut expected = heading_slugs(without_explicit.iter().map(|h| h.text.as_str())).into_iter();
    for h in &model.outline {
        if let Some(written) = &h.explicit_anchor {
            let expected = canonical_anchor(written);
            assert_eq!(
                &h.slug, &expected,
                "l'heading `{}` porta l'ancora esplicita `^{}` e lo slug `{}`,\n\
                 ma la regola del contratto dà `{}` (la forma canonica dell'id\n\
                 scritto). Lo slug è la chiave con cui si risolve un\n\
                 `[[Nota#Titolo]]` e un `[[Nota#^id]]` insieme: due idee della\n\
                 stessa chiave sono un link che funziona da un lato e non\n\
                 dall'altro.",
                h.text, written, h.slug, expected
            );
        } else {
            let expected = expected.next().expect("il conto degli slug è allineato");
            assert_eq!(
                h.slug, expected,
                "l'heading `{}` porta lo slug `{}`, ma la regola del contratto\n\
                 (`heading_slugs` sui titoli senza ancora esplicita, in ordine di\n\
                 lettura) dà `{}`. Lo slug è la chiave con cui si risolve un\n\
                 `[[Nota#Titolo]]`: una seconda idea di come si genera è un link\n\
                 che funziona da un lato e non dall'altro, e due titoli omonimi\n\
                 con lo stesso slug sono un link che atterra sempre sul primo.",
                h.text, h.slug, expected
            );
        }
    }
}

/// *«Uno `Span { start: 0, end: 0 }` su un file col BOM inserisce **prima**
/// del BOM.»* Ne segue che il BOM **in testa** è sorgente, e non è contenuto.
///
/// Il difetto che chiude è invisibile per costruzione: un `U+FEFF` in testa
/// al testo di un blocco è invisibile a schermo, eppure è nel modello, in
/// HTML e nel testo indicizzato. Il sintomo è una nota trovata cercando il
/// suo titolo e un titolo non trovato, e nessuno sa perché.
///
/// # Solo quello in testa, e la differenza non è un dettaglio
///
/// `U+FEFF` in mezzo a un documento **è contenuto**: è uno spazio a
/// larghezza zero, un carattere che l'utente può aver incollato e che il file
/// dichiara. La prima stesura di questa proprietà bandiva ogni `U+FEFF`, ed è
/// stata la prima cosa che il fuzzer ha reso rossa — infilandone uno in mezzo
/// a un titolo. Una guardia che ne avesse preteso la rimozione avrebbe chiesto
/// al provider di **modificare il documento dell'utente**, che è l'opposto
/// del §2.4.
///
/// Quindi la forma è un conteggio: nessuna stringa del modello può contenere
/// più di quanto la sorgente dichiari **al netto di** quello in testa. Un BOM
/// che trapela nel contenuto resta visibile, perché su un file che inizia
/// col BOM la tolleranza è zero.
pub fn leading_bom_is_not_content(model: &DocumentModel, source: &str) {
    let in_source = source.matches('\u{feff}').count();
    let allowance = in_source - usize::from(source.starts_with('\u{feff}'));
    let check = |context: &str, s: &str| {
        assert!(
            s.matches('\u{feff}').count() <= allowance,
            "{context} porta dentro {} `U+FEFF`, e la sorgente ne dichiara {} al\n\
             netto di quello in testa. Il BOM in testa è sorgente e non\n\
             contenuto: da lì finisce nel titolo, nel pannello e nell'indice di\n\
             ricerca, e la nota smette di trovarsi cercando la sua prima parola —\n\
             senza che niente si veda a schermo.\n\
             Il pezzo, come sta nel modello: {s:?}",
            s.matches('\u{feff}').count(),
            allowance
        );
    };
    check("la proiezione a testo del modello", &model.text);
    for b in &model.body {
        bom_in_blocks(b, &check);
    }
}

/// Due chiamate a `parse` sulla stessa sorgente producono lo stesso modello.
///
/// Il contratto non lo scrive, e ogni chiamante lo dà per scontato: l'host
/// riparsa quando vuole — a ogni apertura, a ogni alimentazione dell'indice,
/// camminando il disco per raccogliere lo stato per documento — e non tiene
/// il modello di prima per confrontarlo. È il gemello di
/// [`render_view_has_no_memory`]: `&self` impedisce di mutare il provider,
/// ma non una cache dietro un `Mutex` o un contatore che entra in un
/// `custom_kind`.
pub fn parse_is_deterministic<F: FormatProvider + ?Sized>(
    format: &F,
    source: &str,
    ctx: &ParseContext,
) {
    let first = format.parse(&DocumentSource::Text(source.to_string()), ctx);
    let second = format.parse(&DocumentSource::Text(source.to_string()), ctx);
    match (first, second) {
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

// --- aiuti per le due proprietà ricorsive --------------------------------

/// Il pezzo di sorgente che uno span nomina, o un panico che dice **quale**
/// span e perché non affetta.
///
/// `str::get` restituisce `None` per due difetti diversi — l'offset fuori
/// dalla sorgente e l'offset in mezzo a un carattere — ed entrambi sono il
/// motivo per cui questa funzione esiste invece di `&source[a..b]`: quello
/// andrebbe in panico col messaggio di `str`, che dà i conteggi in byte e non
/// di chi siano.
fn slices<'a>(source: &'a str, span: Span, label: &str) -> &'a str {
    match source.get(span.start..span.end) {
        Some(s) => s,
        None => panic!(
            "{label} è {span:?}, e non affetta la sorgente ({} byte).\n\
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
/// «Non sovrapporsi» è ciò che serve a chi **scrive**: due patch chirurgiche
/// su span che si intersecano non hanno un risultato definito, e applicarle in
/// ordine fa atterrare la seconda su un offset che la prima ha già spostato.
///
/// # L'ordine invece non è richiesto — e il motivo è una scoperta
///
/// La prima stesura pretendeva anche che i fratelli fossero in **ordine di
/// sorgente**, ed era sbagliato: `body` è documentato come «l'albero dei
/// blocchi (per la resa)», e l'ordine di resa non è l'ordine del file. Il
/// caso vero che lo smentì sono le **note a piè di pagina**, che finiscono in
/// coda a `body` con lo span che punta in mezzo al documento — dove sono
/// rese, dove servono. Pretendere l'ordine avrebbe significato chiedere a
/// ogni provider di rinunciare a quella libertà per passare una guardia.
fn blocks_are_disjoint_and_contained(
    blocks: &[Block],
    parent: Span,
    source: &str,
    context: &str,
    claim: Claim,
) {
    let mut spans = Vec::with_capacity(blocks.len());
    for b in blocks {
        let span = b.span();
        slices(source, span, &format!("lo span di un blocco in {context}"));
        // Uno span **vuoto** su un blocco che esiste è il modo in cui una
        // tabella riga→byte rotta si presenta quando l'interrogatore è robusto
        // ai valori fuori intervallo: non un errore, un numero plausibile. È
        // così che un file con terminatori `\r` passava questa guardia con
        // ogni span in fondo al file.
        //
        // Sta sotto la pretesa di coerenza e non sotto quella minima, e la
        // linea di divisione è: uno span vuoto **affetta** (restituisce la
        // stringa vuota), quindi non manda in panico nessuno. Chi ci scrive
        // dentro inserisce nel posto sbagliato, che è un danno — ma è il
        // danno che la famiglia dei `Claim` descrive, non qualcosa che un
        // fuzzer può pretendere venga riparato.
        if claim == Claim::Coherence {
            assert!(
                span.start < span.end,
                "in {context} un blocco ha span vuoto ({span:?}) su una sorgente di \
                 {} byte.\n\
                 Un blocco esiste perché qualcosa nel file lo ha prodotto, quindi\n\
                 nomina almeno un byte. Uno span vuoto non dice «non lo so»: dice\n\
                 «qui», e ci manda chi ritaglia e chi riscrive.",
                source.len()
            );
        }
        contained(span, parent, source, "un blocco", context, claim);
        spans.push(span);
        block_children(b, span, source, claim);
    }
    disjoint(&mut spans, "blocchi fratelli", context, claim);
}

/// Gli span di un gruppo di fratelli sono a due a due disgiunti.
///
/// Sono ordinati per posizione e si controllano i vicini: `n log n` invece di
/// n al quadrato, e soprattutto un messaggio che nomina la coppia che si
/// sovrappone invece del primo che si trova.
fn disjoint(spans: &mut [Span], label: &str, context: &str, claim: Claim) {
    if claim == Claim::SliceOnly {
        return;
    }
    spans.sort_by_key(|s| (s.start, s.end));
    for pair in spans.windows(2) {
        let (a, b) = (pair[0], pair[1]);
        assert!(
            a.end <= b.start,
            "in {context} due {label} si sovrappongono: {a:?} e {b:?}.\n\
             La separazione è ciò su cui poggia una patch chirurgica: due span che\n\
             si intersecano non hanno un risultato definito, e chi applica due\n\
             modifiche in fila fa atterrare la seconda su offset che la prima ha\n\
             già spostato. (L'ordine invece è libero: `body` è in ordine di resa,\n\
             non di sorgente.)"
        );
    }
}

/// Scende nei figli di un blocco. Il `match` è **esaustivo apposta**: una
/// nuova variante di [`Block`] non compila finché qualcuno non dice dove
/// stanno i suoi figli, che è l'unico modo per non aggiungerne una che questa
/// proprietà non copre.
fn block_children(b: &Block, span: Span, source: &str, claim: Claim) {
    match b {
        Block::Heading { inlines, .. } | Block::Paragraph { inlines, .. } => {
            inlines_are_disjoint_and_contained(inlines, span, source, "un blocco di testo", claim)
        }
        Block::Quote { blocks, .. } | Block::Custom { blocks, .. } => blocks_are_disjoint_and_contained(
            blocks,
            span,
            source,
            "un blocco che contiene blocchi",
            claim,
        ),
        Block::List { items, .. } => {
            let mut spans = Vec::with_capacity(items.len());
            for it in items {
                slices(source, it.span, "lo span di una voce di lista");
                contained(
                    it.span,
                    span,
                    source,
                    "una voce di lista",
                    "la sua lista",
                    claim,
                );
                spans.push(it.span);
                if let Some(t) = &it.task {
                    slices(source, t.span, "lo span del marcatore di una task");
                    contained(
                        t.span,
                        it.span,
                        source,
                        "il marcatore di una task",
                        "la sua voce di lista",
                        claim,
                    );
                    assert!(
                        slices(source, t.span, "il marcatore di una task")
                            .chars()
                            .count()
                            <= 1,
                        "il marcatore di una task affetta {:?}, cioè più di un\n\
                         carattere. Deve essere il **simbolo** e non le parentesi:\n\
                         spuntare una task è la sostituzione di un carattere solo,\n\
                         ed è la patch più piccola che si possa scrivere.",
                        slices(source, t.span, "il marcatore di una task")
                    );
                }
                blocks_are_disjoint_and_contained(
                    &it.blocks,
                    it.span,
                    source,
                    "una voce di lista",
                    claim,
                );
            }
            disjoint(&mut spans, "voci di lista", "una lista", claim);
        }
        Block::Table { head, rows, .. } => {
            let mut spans = Vec::new();
            for row in head.iter().chain(rows.iter()) {
                for cell in &row.cells {
                    slices(source, cell.span, "lo span di una cella");
                    contained(
                        cell.span,
                        span,
                        source,
                        "una cella",
                        "la sua tabella",
                        claim,
                    );
                    spans.push(cell.span);
                    inlines_are_disjoint_and_contained(
                        &cell.inlines,
                        cell.span,
                        source,
                        "una cella",
                        claim,
                    );
                }
            }
            disjoint(&mut spans, "celle", "una tabella", claim);
        }
        // Non ha figli, e il campo `anchor` non è uno span. Una definizione
        // di riferimento è scalare (etichetta, URL, titolo): non ha span
        // figli da verificare — il suo span è già quello del blocco.
        Block::CodeBlock { .. }
        | Block::ThematicBreak { .. }
        | Block::ReferenceDefinition { .. } => {}
    }
}

/// Gli inline che **portano** uno span. `Text`, `Emph`, `Strong` e `Code`
/// non ce l'hanno nel contratto, quindi qui non c'è nulla da verificare su di
/// loro — e il `match` resta esaustivo perché una nuova variante che ne
/// portasse uno non deve poter entrare in silenzio.
fn inlines_are_disjoint_and_contained(
    inlines: &[Inline],
    parent: Span,
    source: &str,
    context: &str,
    claim: Claim,
) {
    let mut spans = Vec::new();
    for the in inlines {
        let span = match the {
            // L'etichetta di un link è testo riparsato, e ciò che c'è dentro
            // sta dentro **il link**, non accanto: il padre della discesa è il
            // suo span.
            Inline::Link { span, label, .. } => {
                inlines_are_disjoint_and_contained(
                    label.as_deref().unwrap_or(&[]),
                    *span,
                    source,
                    "l'etichetta di un link",
                    claim,
                );
                *span
            }
            Inline::TagRef { span, .. } | Inline::Custom { span, .. } => *span,
            Inline::Emph(inner)
            | Inline::Strong(inner)
            | Inline::Superscript(inner)
            | Inline::Strikethrough(inner) => {
                inlines_are_disjoint_and_contained(inner, parent, source, context, claim);
                continue;
            }
            Inline::Text(_) | Inline::Code(_) | Inline::HardBreak | Inline::SoftBreak => continue,
        };
        slices(source, span, &format!("lo span di un inline in {context}"));
        contained(span, parent, source, "un inline", context, claim);
        spans.push(span);
    }
    disjoint(&mut spans, "inline fratelli", context, claim);
}

fn contained(child: Span, parent: Span, source: &str, label: &str, context: &str, claim: Claim) {
    if claim == Claim::SliceOnly {
        return;
    }
    assert!(
        parent.start <= child.start && child.end <= parent.end,
        "{label} ha span {child:?}, che esce da quello di {context} ({parent:?}).\n\
         Il figlio affetta `{}` e il padre `{}`: uno dei due nomina un pezzo di\n\
         documento che non è il suo, e non c'è modo di sapere quale guardando il\n\
         solo modello. È il sintomo della tabella riga→byte spostata: tutti gli\n\
         span affettano, e affettano il pezzo accanto.",
        source.get(child.start..child.end).unwrap_or("?"),
        source.get(parent.start..parent.end).unwrap_or("?")
    );
}

fn collect_blocks(
    blocks: &[Block],
    heading: &mut Vec<(u8, Span)>,
    link: &mut Vec<Link>,
    tag: &mut Vec<Tag>,
) {
    for b in blocks {
        match b {
            Block::Heading {
                level,
                inlines,
                span,
                ..
            } => {
                heading.push((*level, *span));
                collect_inlines(inlines, link, tag);
            }
            Block::Paragraph { inlines, .. } => collect_inlines(inlines, link, tag),
            Block::Quote { blocks, .. } | Block::Custom { blocks, .. } => {
                collect_blocks(blocks, heading, link, tag)
            }
            Block::List { items, .. } => {
                for it in items {
                    collect_blocks(&it.blocks, heading, link, tag);
                }
            }
            Block::Table { head, rows, .. } => {
                for row in head.iter().chain(rows.iter()) {
                    for cell in &row.cells {
                        collect_inlines(&cell.inlines, link, tag);
                    }
                }
            }
            // Una definizione di riferimento non porta heading, link o tag:
            // è un indirizzo, non prosa — e non deve entrare nelle tabelle
            // piatte.
            Block::CodeBlock { .. }
            | Block::ThematicBreak { .. }
            | Block::ReferenceDefinition { .. } => {}
        }
    }
}

fn collect_inlines(inlines: &[Inline], link: &mut Vec<Link>, tag: &mut Vec<Tag>) {
    for the in inlines {
        match the {
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
                // **Anche dentro l'etichetta.** Non è un dettaglio di
                // ricorsione: l'etichetta di un link è testo che il provider
                // riparsa, e ciò che ci trova finisce nelle tabelle piatte
                // come tutto il resto. La prima stesura di questa funzione
                // non ci scendeva, e questa proprietà diventò rossa su un
                // `[[#Sezione]]` — dove dentro l'etichetta c'era un `TagRef`
                // che la tabella `tags` dichiarava e l'albero, letto male,
                // no.
                collect_inlines(label.as_deref().unwrap_or(&[]), link, tag);
            }
            Inline::TagRef { name, span } => tag.push(Tag {
                name: name.clone(),
                span: *span,
            }),
            Inline::Emph(contained)
            | Inline::Strong(contained)
            | Inline::Superscript(contained)
            | Inline::Strikethrough(contained) => collect_inlines(contained, link, tag),
            Inline::Text(_)
            | Inline::Code(_)
            | Inline::Custom { .. }
            | Inline::HardBreak
            | Inline::SoftBreak => {}
        }
    }
}

fn assert_projection_matches<T: PartialEq + std::fmt::Debug>(which: &str, tree: &[T], flat: &[T]) {
    assert!(
        tree == flat,
        "la tabella `{which}` non è la proiezione dell'albero.\n\
         Camminando `body` se ne trovano {}, la tabella ne dichiara {}.\n\
         \n\
         dall'tree: {tree:?}\n\
         dalla tabella: {flat:?}\n\
         \n\
         Non produce niente di sbagliato: produce **due documenti**. L'anteprima\n\
         legge l'tree, il grafo e chi rinomina leggono la tabella, il pannello\n\
         outline la tabella: se divergono ogni consumatore ha ragione e il vault\n\
         ha due verità. Un link che sta nell'albero e non nella tabella è un link\n\
         che nessuna rinomina aggiorna.",
        tree.len(),
        flat.len()
    );
}

fn bom_in_blocks(b: &Block, check: &impl Fn(&str, &str)) {
    let inline = |inlines: &[Inline]| {
        for the in inlines {
            bom_in_inlines(the, check);
        }
    };
    match b {
        Block::Heading { inlines, .. } | Block::Paragraph { inlines, .. } => inline(inlines),
        Block::Quote { blocks, .. } | Block::Custom { blocks, .. } => {
            for b in blocks {
                bom_in_blocks(b, check);
            }
        }
        Block::List { items, .. } => {
            for it in items {
                for b in &it.blocks {
                    bom_in_blocks(b, check);
                }
            }
        }
        Block::Table { head, rows, .. } => {
            for row in head.iter().chain(rows.iter()) {
                for cell in &row.cells {
                    inline(&cell.inlines);
                }
            }
        }
        Block::CodeBlock { code, .. } => check("a code block", code),
        // Una definizione è tre stringhe: un BOM dentro etichetta,
        // destinazione o titolo è un byte che il modello si porta dietro e che
        // una riscrittura pianterebbe in mezzo alla sintassi.
        Block::ReferenceDefinition {
            label, url, title, ..
        } => {
            check("a reference definition label", label);
            check("a reference definition url", url);
            if let Some(t) = title {
                check("a reference definition title", t);
            }
        }
        Block::ThematicBreak { .. } => {}
    }
}

fn bom_in_inlines(the: &Inline, check: &impl Fn(&str, &str)) {
    match the {
        Inline::Text(t) => check("a text inline", t),
        Inline::Code(t) => check("a code inline", t),
        Inline::Emph(contained)
        | Inline::Strong(contained)
        | Inline::Superscript(contained)
        | Inline::Strikethrough(contained) => {
            for the in contained {
                bom_in_inlines(the, check);
            }
        }
        Inline::TagRef { name, .. } => check("a tag name", name),
        Inline::Link { label, .. } => {
            for the in label.iter().flatten() {
                bom_in_inlines(the, check);
            }
        }
        Inline::HardBreak | Inline::SoftBreak => {}
        Inline::Custom { .. } => {}
    }
}

// ---------------------------------------------------------------------------

/// L'insieme delle destinazioni dei link che un modello dichiara, nella forma
/// in cui un corpus le confronta con le attese.
///
/// Sta qui e non nel corpus di un provider perché la domanda «cosa nomina
/// questo documento?» è la stessa per ogni formato, ed è quella su cui si
/// nutre il grafo del kernel.
///
/// È arrivata con la
/// [0061](../../../../docs/decisions/0061-a-pass-not-through-the-model.md),
/// alla condizione che la
/// [0060](../../../../docs/decisions/0060-the-model-tells-the-truth-about-bytes.md)
/// l'avesse scritta qui invece di lasciarla scoprire — *il primo corpus che
/// verifica ciò che un documento nomina le dà una ragione di esistere, o va
/// tolta*. È il round-trip senza metadati di
/// `fub-format-markdown/tests/transfer_e2e.rs`: togliere il frontmatter da un
/// documento non deve cambiare ciò che quel documento nomina, e il confronto
/// è fra questo insieme prima e dopo. Non è una proprietà, quindi non può
/// passare verde senza essere stata testata: chi la chiama confronta due suoi
/// valori, e uno viene da un file che il taglio non ha toccato.
pub fn targets(model: &DocumentModel) -> BTreeSet<String> {
    model
        .links
        .iter()
        .map(|the| match &the.target {
            LinkTarget::Wiki { page, .. } => format!("wiki:{page}"),
            LinkTarget::Url(u) => format!("url:{u}"),
            LinkTarget::Path(p) => format!("path:{p}"),
        })
        .collect()
}

fn model(id: &str, text: &str) -> DocumentModel {
    let mut m = DocumentModel::empty(DocId::new(id));
    m.text = text.to_string();
    m
}
