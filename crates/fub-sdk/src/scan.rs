//! Toolkit di scansione testo condiviso dai provider testuali.
//!
//! Né comrak né pulldown trattano `#tag` o la semantica interna di
//! `[[wikilink]]` in stile Obsidian: questi helper coprono quel divario e sono
//! riusabili da qualsiasi `FormatProvider` basato su testo.

/// Il riconoscimento di un `#tag` **vive nel contratto**
/// ([`fub_abi::rules::tag::scan_tags`]) ed è ri-esportato qui per la stessa
/// ragione di `parse_wikilink_inner` qui sotto, che è anche l'argomento che
/// l'ha fatto salire (§4.4): la grammatica di un tag descrive i campi di
/// [`Tag`](fub_abi::model::Tag), quindi è una regola di ciò che il contratto
/// dichiara — come `canonical_tag` — e non del toolkit di chi lo usa. Finché
/// stava qui, due provider potevano rispondere due cose diverse sulla stessa
/// riga, e una superficie di scrittura non poteva rispondere affatto.
pub use fub_abi::rules::tag::scan_tags;

/// Il parsing dell'interno di un wikilink **vive nel contratto**
/// ([`fub_abi::model::parse_wikilink_inner`]) ed è ri-esportato qui perché è
/// da qui che i provider testuali lo prendono: la grammatica di
/// `Page#Heading^block|Alias` descrive i campi di `LinkTarget::Wiki`, quindi è
/// una regola di ciò che il contratto dichiara — come `canonical_tag` — e non
/// del toolkit di chi lo usa. Averla qui significava che una proprietà del
/// frontmatter non poteva riconoscere una relazione senza dipendere dall'SDK.
pub use fub_abi::model::{parse_wikilink_inner, ParsedWikilink};

// Non c'è un `mod tests` qui: quel che questo modulo esporta lo implementa il
// contratto, e i suoi test stanno con l'implementazione — in
// `fub_abi::rules::tag` per i tag, in `fub_abi::model` per i wikilink. Una
// copia qui proverebbe che il `pub use` compila, che è già il lavoro del
// compilatore.
