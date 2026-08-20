//! The conformance suite: **the properties the contract promises**, made
//! executable by whoever implements the contract.
//!
//! This is the difference between "the contract is documented" and "the
//! contract is verifiable by its implementer". There are twenty-three functions
//! [count: conformance-functions], and that is the number [decision 0054] once
//! wrote as "eight" when it already had fourteen: from now on the §16.8 guard
//! counts, not whoever writes the sentence.
//!
//! [decision 0054]: https://github.com/Fubeo/Fub/blob/main/docs/decisions/0054-the-provider-side-bench.md
//!
//! Every function here corresponds to a sentence in a trait's doc-comment in
//! `fub-abi/src/traits.rs`, and is written to be called from a test by the
//! *feature author* — not from a kernel test.
//!
//! ```no_run
//! # use fub_sdk::testing::conformance;
//! # fn example(my: &mut impl fub_abi::traits::IndexProvider) {
//! conformance::an_index_respects_the_contract(my);
//! # }
//! ```
//!
//! # The properties were written for methods that no longer exist
//!
//! §16.1 listed "an `IndexProvider` that does not lose documents between
//! `on_document_*` and `flush`". Those methods have been called
//! `on_documents_indexed`/`on_documents_removed` since [decision
//! 0051](../../../../docs/decisions/0051-indexing-responds.md), take a
//! **batch**, and — the point — return `Vec<IndexLoss>`.
//!
//! The property changed in **nature**, not in name. When loss was silent, a
//! suite could only deduce it: index, query, and if you find nothing conclude it
//! was lost. Now loss is **speakable**, and what is verified is stronger and
//! more precise — the *coherence between what the provider claims to have lost
//! and what it actually lost*. An index that swallows a document and returns an
//! empty list is no longer "an index that loses": it is an index that
//! **lies**, and that is a condition that can be named.

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

/// All properties of an [`IndexProvider`] that can be verified without
/// knowing what the index indexes. Panics with a message naming the
/// violated property.
///
/// Calls in order:
/// [`routes_are_stable`], [`losses_name_only_what_was_given`],
/// [`an_empty_batch_loses_nothing`], and
/// [`up_to_date_only_reported_what_it_saw`].
pub fn an_index_respects_the_contract<I: IndexProvider + ?Sized>(index: &mut I) {
    routes_are_stable(index);
    losses_name_only_what_was_given(index);
    an_empty_batch_loses_nothing(index);
    up_to_date_only_reported_what_it_saw(index);
}

/// *"What is served, declared once at registration."*
///
/// The kernel reads `routes()` **once**, at mount, and builds a dispatch
/// table. An index that responds differently on the second call has a table
/// that does not match itself, and the symptom would be a query nobody
/// serves — or served by someone who should not.
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

/// *"What is listed is lost, what is not listed is taken."*
///
/// There follows a property the contract does not write but every caller
/// takes for granted: a loss may name **only** a document that was in the
/// batch. A foreign id in the outcome is indistinguishable, for whoever reads
/// it, from a document actually lost — and would send the kernel telling the
/// user that a note they never touched is no longer searchable.
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

/// *"An empty list means everything went well."* Read in reverse: nothing
/// can have gone wrong for someone to whom nothing was asked.
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

/// [`IndexProvider::up_to_date`] responds with ids it does **not** need to
/// re-read, and they can only be among those it has been shown.
///
/// The contract default is "I know nothing, re-read them all", which is the
/// safe response. Whoever overrides it promises the opposite, and this is
/// where an index that makes a mistake causes a needed re-read to be skipped
/// — meaning it does not go red, it goes stale.
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

/// The property §16.1 asked for, rewritten for today's contract:
/// **what you claim not to have lost, you must actually have.**
///
/// It only applies to an index that declares serving a family of queries,
/// and must be called giving it the query by which to find what was given
/// to it. On an index that declares no routes there is nothing to verify —
/// and saying so is the correct answer, because "this index does not
/// respond to anything" is a legitimate declaration and not a defect.
///
/// Returns `false` when there was nothing to verify, so the caller can
/// notice its index was not tested instead of believing it passed.
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

/// All properties of a [`ViewProvider`] that can be verified without knowing
/// what the view draws, against the host given to it.
pub fn a_view_respects_the_contract<V: ViewProvider + ?Sized>(view: &V, host: &dyn ReadApi) {
    view_ids_are_distinct(view);
    redrawing_on_index_updated_declares_batch_ended(view);
    every_declared_view_draws(view, host);
    render_view_has_no_memory(view, host);
}

/// *"A view that declares `IndexUpdated` must also declare `BatchEnded`:
/// inside a batch the first does not arrive, and the second is what causes it
/// to make **one** redraw where before it made N."*
///
/// This is [decision 0011](../../../../docs/decisions/0011-the-batch.md) read
/// from the side of the view author, and it is the worst defect this suite can
/// see: a view that gets this wrong **does not break**, it just stops updating
/// inside a batch — which is exactly when the user has just done the biggest
/// thing. No test sees it fail, because outside the batch it works.
pub fn redrawing_on_index_updated_declares_batch_ended<V: ViewProvider + ?Sized>(
    view: &V,
) {
    for spec in view.views() {
        // The rule lives in **one place only** ([decision
        // 0020](../../../../docs/decisions/0020-rules-in-one-place.md)):
        // `misses_batches` is from the contract, and this function applies it
        // instead of rewriting it. A second idea of the same rule, written in a
        // test bench, is how two guards end up disagreeing.
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

/// Two `ViewSpec`s with the same id are two views the kernel cannot
/// distinguish: the second registration wins or loses, and in neither case
/// does the provider author notice.
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

/// Every **declared** view must know how to draw itself: `views()` is a
/// promise, and a `ViewSpec` that `render_view` does not serve is a menu entry
/// that opens to an error.
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

/// *"A `ViewProvider` that does not mutate during `render_view`."*
///
/// The form §16.1 asked for is **already guaranteed by the type**:
/// `render_view` takes `&self`, so mutating does not compile. What the type
/// does not guarantee, and this function verifies, is that there is no hidden
/// internal mutability — a cache behind a `Mutex`, a counter — that makes the
/// second draw different from the first on a still host. This is the property
/// the shell relies on to redraw when it wants.
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

/// Properties of a [`FormatProvider`] that can be verified **without an
/// input**: those readable from the descriptor.
///
/// Anyone who has an input to give — that is, anyone with a corpus — should
/// also call [`a_model_tells_the_truth_about_the_source`], where the
/// properties that matter live. The two are not merged because a source is not
/// always available: a provider can be registered and guarded before having a
/// corpus, and a signature requiring a `&str` would force inventing one —
/// that is, testing the provider against an example chosen by the suite
/// instead of by its author.
pub fn a_format_respects_the_contract<F: FormatProvider + ?Sized>(format: &F) {
    a_text_provider_refuses_bytes(format);
    the_descriptor_declares_at_least_one_extension(format);
}

/// *"A text provider that receives bytes responds
/// [`FormatError::Unsupported`] instead of guessing the encoding."*
///
/// [`FormatError::Unsupported`]: fub_abi::error::FormatError::Unsupported
///
/// This is the property that protects user files: guessing an encoding works
/// almost always, and when it is wrong it produces a readable but wrong
/// document — damage visible only after saving over the original.
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
    // Refusing is not enough: `parse`/`render`/`serialize` end up in a log, and
    // only `unsupported` reaches the eyes of whoever opened the file, where it
    // means "nobody serves it" and the advice is to install a plugin. A provider
    // that refused with `Parse` would tell a user their attachment is
    // malformed, which is the wrong thing about the wrong file.
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
    // The two fields are what the sentence is composed from on the way out, and
    // the compiler forces you to *carry them*, not carry them **correctly**: a
    // provider that names itself with another's id sends the user looking for
    // the wrong plugin.
    assert_eq!(
        (format.as_str(), *got),
        (d.id.as_str(), SourceKind::Bytes),
        "`{}` refused saying it is `{format}` and received\n\
         `{got:?}`. Sono i due dati con cui il kernel compone la frase che\n\
         l'utente legge: sbagliarli manda a installare il plugin sbagliato.",
        d.id
    );
}

/// A format that declares no extensions will never receive a file: the registry
/// routes by extension, and a successful registration that serves nothing is the
/// most silent form in which a provider can be absent.
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
// FormatProvider: properties that require an input
// ---------------------------------------------------------------------------

/// How much is expected of spans, and the reason there are **two** levels
/// and not one.
///
/// The difference is not severity but **audience**. A curated input — the corpus
/// of the provider author — is markdown someone chose, and on that everything is
/// expected. A **generated** input from the fuzzer is not, and not out of mercy:
/// on inputs built to be hostile a provider inherits from the parser beneath it
/// sourcepos inconsistencies that are real defects, but *fixing them is a
/// decision about what a node span is* — not something a guard can demand
/// without having decided it first. Demanding it anyway would have one effect
/// only: the fuzzer stays red, and whoever finds it red disables it.
///
/// What is **always** expected, and what §17.1 asks of fuzzing ("a parser that
/// panics is a vault that does not open"), is the other half: that no span
/// panics its user, that the parse is deterministic, and that the model does
/// not carry the BOM inside.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Claim {
    /// Every span slices the source. Applies to **any** input.
    SliceOnly,
    /// And additionally: every span lies inside that of its containing node,
    /// and siblings do not overlap. Required on a curated corpus.
    Coherence,
}

/// **What the model says about the document is true relative to the file bytes.**
///
/// This is the group that wants a source, and must be called on every entry in
/// a corpus. It calls in order: [`the_model_matches_the_given_id`],
/// [`spans_slice_the_source`] with [`Claim::Coherence`],
/// [`flat_tables_are_the_tree_projection`],
/// [`a_heading_slug_matches_the_contract`],
/// [`leading_bom_is_not_content`], and [`parse_is_deterministic`].
///
/// Returns `false` if the provider **refused** the source, meaning there was
/// no model to verify. This is not a failure: an `Err` is a legitimate
/// response, and on a generated input it is the right one more often than
/// not. It returns `false` instead of swallowing it because a corpus that
/// ends with zero models verified is a corpus that passes without having
/// tested anything, and its author must be able to count — the same reason
/// [`what_is_not_lost_is_found_again`] returns `bool`.
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

/// What must hold on **any** source, including one nobody chose: this is the
/// group to give to a fuzzer.
///
/// It is not "the same properties, more permissive": it is the set of those
/// whose violation does not produce a questionable model but produces a
/// **panic or a blind write**. A span that does not slice panics the first
/// person who uses it, and does so at note opening; a non-deterministic parse
/// makes a document change by itself between one opening and the next; a BOM
/// that becomes content makes a note unfindable. None of the three is an
/// opinion on how a construct should be represented.
///
/// Returns `false` if the source was refused: see
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

/// *"The id of the document we are parsing (to fill `DocumentModel.id`)."*
///
/// The caller is the kernel, which already has that id and uses it as the key
/// for everything: graph, index, per-document state. A provider that put a
/// different one — the frontmatter title, the absolute path, the basename —
/// would break nothing immediately: it would land backlinks and versions under
/// a key nobody queries.
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

/// *"A [`Span`] is a **byte** range in the original source."*
///
/// The property, fully and recursively: every span in the model **slices** the
/// source, lies **inside** that of the containing node, and does not overlap
/// that of the preceding sibling.
///
/// This is the most valuable property in the whole suite, and the reason is
/// not the wrong panel: flat tables and spans are **the coordinates by which
/// a file is rewritten**. A programmatic edit is a surgical patch guided by a
/// span ([decision 0008](../../../../docs/decisions/0008-surgical-edit.md)):
/// a span that lies by one byte does not draw badly, it **corrupts a
/// document** — checks off the wrong task, renames inside the adjacent word,
/// cuts a character in half. And it does so without going red, because the
/// file remains valid UTF-8.
///
/// The two halves this function holds together that alone would not suffice:
/// "slices" excludes the offset outside the source and the one in the middle
/// of a character (`str::get` returns `None` for both); "lies inside, and
/// after the sibling" excludes the case where all spans are sliceable and
/// wrong at once — the row-to-byte table shifted by one, which slices the
/// adjacent document piece perfectly.
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
        // this property demanded it: the form "anchor on its own line"
        // (`A paragraph\n\n^abc123\n`), which is Obsidian's, puts the
        // marker *outside* the block it marks — and rightly so, because that
        // is what causes the block embed not to carry the id along. What can
        // be demanded is that the marker actually names the anchor.
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

/// Flat tables are **a projection of the tree**, not a second read of the file.
///
/// `outline`, `links`, and `tags` are documented as "flat": *"Headings in
/// order, flat (for outline panel and link to heading)"*, *"Flat links,
/// resolved later by the kernel graph"*. Flat means **the same thing seen
/// without walking the tree**, and this function verifies they really are the
/// same: same count, same order, same spans.
///
/// The defect this prevents is the most silent in this family, because it does
/// not produce anything wrong — it produces **two documents**. The outline
/// panel reads `outline`, the preview reads `body`, the graph reads `links`,
/// and the renamer rewrites `links` spans: if the two reads diverge, every
/// consumer is right and the vault has two truths. The concrete case is a
/// link that is in the tree but not in the table — and then a rename does not
/// update it, leaving a broken link nobody wrote.
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

/// *"The anchor of a heading, **generated** from its text — and from whoever
/// was there before it."*
///
/// The rule lives in the contract ([`heading_slugs`]) and not in the provider,
/// and the reason is written there: two providers writing it independently
/// would give two different ids to the same title, and a `[[Note#Title]]`
/// would resolve on one and not the other. This function verifies that whoever
/// fills `slug` **applies** it instead of rewriting it.
///
/// The **entire** outline is compared, not one title at a time, because the
/// slug is not a function of the text alone: two `## Notes` cannot carry the
/// same `id`, and as long as the comparison was `slug == heading_slug(text)`
/// disambiguation was literally **forbidden** to anyone who wanted to write it.
///
/// The exception is a heading with an **explicit anchor** (`## Title ^My-ID`):
/// whoever wrote an id is not disambiguated by the contract, and its `slug` is
/// the canonical form of that id ([`canonical_anchor`]) — not a product of
/// [`heading_slugs`]. Explicit ids do not consume the numbering, so the
/// generated sequence is computed from titles without anchors only.
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

/// *"A `Span { start: 0, end: 0 }` on a file with a BOM inserts **before** the
/// BOM."* It follows that the BOM **at the head** is source, and is not
/// content.
///
/// The defect it closes is invisible by construction: a `U+FEFF` at the head
/// of a block's text is invisible on screen, yet is present in the model, in
/// HTML, and in indexed text. The symptom is a note found by searching its
/// title and a title not found, and nobody knows why.
///
/// # Only the one at the head, and the difference is not a detail
///
/// `U+FEFF` in the middle of a document **is content**: it is a zero-width
/// space, a character a user may have pasted and the file declares. The first
/// draft of this property banned every `U+FEFF`, and it was the first thing
/// the fuzzer turned red — by sticking one in the middle of a title. A guard
/// that had demanded its removal would have asked the provider to **modify the
/// user's document**, which is the opposite of §2.4.
///
/// So the form is a count: no string in the model may contain more than the
/// source declares **net of** the one at the head. A BOM that leaks into
/// content is still visible, because on a file that starts with a BOM the
/// allowance is zero.
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

/// Two `parse` calls on the same source produce the same model.
///
/// The contract does not write this, and every caller takes it for granted: the
/// host re-parses whenever it wants — at every opening, at every index feed,
/// while walking the disk to gather per-document state — and does not keep the
/// previous model aside to compare. It is the twin of
/// [`render_view_has_no_memory`]: `&self` prevents mutating the provider, but
/// not a cache behind a `Mutex` or a counter that enters a `custom_kind`.
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

// --- helpers for the two recursive properties ----------------------------

/// The piece of source that a span names, or a panic that says **which** span
/// and why it does not slice.
///
/// `str::get` returns `None` for two different defects — the offset outside the
/// source and the offset in the middle of a character — and they are both the
/// reason this function exists instead of `&source[a..b]`: that would panic
/// with the message from `str`, which gives byte counts and not whose they are.
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

/// Siblings do not overlap, and lie inside the parent.
///
/// "Do not overlap" is what **writers** need: two surgical patches on
/// overlapping spans have no defined result, and applying them in order lands
/// the second on an offset the first has already shifted.
///
/// # Order, however, is not required — and the reason is a discovery
///
/// The first draft also required siblings to be in **source order**, and that
/// was wrong: `body` is documented as "the block tree (for rendering)", and
/// the render order is not the file order. The true case that disproved it is
/// **footnotes**, which end up at the tail of `body` with the span pointing
/// into the middle of the document — where they are rendered, where they are
/// needed. Requiring order would have meant asking every provider to give up
/// that freedom to pass a guard.
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
        // An **empty** span on a block that exists is how a broken
        // row-to-byte table presents itself when the interrogator is robust to
        // out-of-range values: not an error, a plausible number. That is how a
        // file with `\r` terminators passed this guard with every span at the
        // end of the file.
        //
        // It lives under the coherence claim and not the minimal one, and the
        // dividing line is: an empty span **slices** (yields the empty string),
        // so it does not panic anyone. Whoever writes into it inserts at the
        // wrong place, which is damage — but it is the damage the `Claim`
        // family describes, not what a fuzzer can demand be fixed.
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

/// The spans of a group of siblings are pairwise disjoint.
///
/// They are sorted by position and neighbors are checked: `n log n` instead of
/// n squared, and more importantly a message that names the overlapping pair
/// instead of the first one found.
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

/// Descend into a block's children. The `match` is **exhaustive on purpose**:
/// a new variant of [`Block`] will not compile until someone says where its
/// children are, which is the only way not to add one this property does not
/// cover.
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
        // Has no children, and the `anchor` field is not a span. A reference
        // definition is scalar (label, URL, title): it has no child spans to
        // verify — its span is already the block's span.
        Block::CodeBlock { .. }
        | Block::ThematicBreak { .. }
        | Block::ReferenceDefinition { .. } => {}
    }
}

/// Inlines that **carry** a span. `Text`, `Emph`, `Strong`, and `Code` do not
/// have one in the contract, so there is nothing to verify on them here —
/// and the `match` remains exhaustive because a new variant that carried one
/// must not be able to enter silently.
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
            // A link's label is re-parsed text, and what is inside it lies
            // inside **the link**, not next to it: the parent of the descent
            // is its span.
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
            // A reference definition carries no heading, link, or tag:
            // it is an address, not prose — and must not enter the flat tables.
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
                // **Also inside the label.** This is not a recursion detail: a
                // link's label is text the provider re-parses, and what it finds
                // there ends up in the flat tables like anything else. The first
                // draft of this function did not descend into it, and this
                // property went red on a `[[#Section]]` — where inside the label
                // there was a `TagRef` that the `tags` table declared and the
                // tree, read wrong, did not.
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
        // A definition is three strings: a BOM inside label, destination, or
        // title is a byte the model carries along and that a rewrite would
        // plant in the middle of the syntax.
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

/// The set of link targets a model declares, in the form a corpus compares
/// against expectations.
///
/// It lives here and not in a provider's corpus because the question "what does
/// this document name?" is the same for every format, and it is the one the
/// kernel graph feeds on.
///
/// It arrived with [0061](../../../../docs/decisions/0061-a-pass-not-through-the-model.md),
/// on the condition that
/// [0060](../../../../docs/decisions/0060-the-model-tells-the-truth-about-bytes.md)
/// had written it here instead of leaving it to be discovered — *the first
/// corpus that verifies what a document names gives it a reason to exist, or it
/// must be removed*. It is the metadata-free round-trip of
/// `fub-format-markdown/tests/transfer_e2e.rs`: stripping frontmatter from a
/// document must not change what that document names, and the comparison is
/// between this set before and after. It is not a property, so it cannot pass
/// green without having been tested: whoever calls it compares two of its own
/// values, and one comes from a file the cut did not touch.
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
