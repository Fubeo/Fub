//! Grammatica condivisa delle card testuali: tag scanner dal contratto,
//! wikilink scanner locale con escape.
//!
//! Il riconoscimento dei `#tag` vive nel contratto (`scan_tags`) perché due
//! provider non possono avere due idee dello stesso tag; lo scanner dei
//! `[[..]]` resta locale perché la card testo è l'unico posto che lo usa fuori
//! dal parser markdown.

pub use fub_abi::rules::tag::scan_tags;
