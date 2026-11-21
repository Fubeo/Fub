//! The process-wide tables that grow with what documents and commands bring in: decoded images,
//! bitmaps and reads of placed documents, halftone arts, textures, profiles and fonts the user
//! added. A host that keeps the engine in a process of its own, among other work, weighs them
//! against its memory budget ([`bytes`]) and empties those that can be emptied when it needs the
//! memory back ([`release_all`]); each is filled again on demand.
//!
//! Not listed:
//! - tables that can't grow past a small fixed size: the built-in libraries and profiles, the
//!   proof and ink tables (a handful of entries each), the font database's glyph and outline
//!   caches (capped by count and bytes), the view and color settings;
//! - per-thread caches of one frame;
//! - the files read lately for placing (`cmd::place::document`), kept only when no automation root
//!   is in force: under [`crate::file_access::AutomationRoots::deny_all`] they stay empty;
//! - the names of recovery blobs (`cmd::recovery`), pruned to about twice the live images and only
//!   filled with a recovery folder;
//! - what plug-in formats intern (feature `plugins`).
//!
//! Patch di Fub (`0008-nessuna-radice-e-tabelle`).

/// One process-wide table.
#[derive(Clone, Copy, Debug)]
pub struct Table {
    /// The crate that holds it (`vectorcraft-render`).
    pub krate: &'static str,
    /// Its name, unique among the tables.
    pub name: &'static str,
    /// What makes it grow, for people.
    pub grows_with: &'static str,
    /// Roughly how many bytes it holds now.
    pub bytes: fn() -> usize,
    /// Empty it, when that leaves the engine working (what it held is made again when needed);
    /// `None` when it holds what documents name and can't be emptied.
    pub release: Option<fn()>,
}

fn font_faces_bytes() -> usize {
    vectorcraft_text::FontDb::global().faces_bytes()
}

static TABLES: [Table; 8] = [
    Table {
        krate: "vectorcraft-render",
        name: "image_cache",
        grows_with: "images drawn (decoded pixels, within the image cache budget)",
        bytes: vectorcraft_render::image_cache_bytes,
        release: Some(vectorcraft_render::release_image_cache),
    },
    Table {
        krate: "vectorcraft-render",
        name: "placed_bitmaps",
        grows_with: "placed documents drawn (a bitmap per file and zoom step)",
        bytes: vectorcraft_render::placed_document::placed_bitmaps_bytes,
        release: Some(vectorcraft_render::placed_document::release_placed_bitmaps),
    },
    Table {
        krate: "vectorcraft-render",
        name: "halftone_cache",
        grows_with: "objects with a Vector Halftone effect drawn (the last few arts)",
        bytes: vectorcraft_render::addons::halftone::halftone_cache_bytes,
        release: Some(vectorcraft_render::addons::halftone::release_halftone_cache),
    },
    Table {
        krate: "vectorcraft-doc",
        name: "placed_files",
        grows_with: "linked placed documents read again in full",
        bytes: vectorcraft_doc::placed_document::placed_files_bytes,
        release: Some(vectorcraft_doc::placed_document::release_placed_files),
    },
    Table {
        krate: "vectorcraft-doc",
        name: "placed_reads",
        grows_with: "placed documents read for drawing (their art and setup)",
        bytes: vectorcraft_doc::placed_document::placed_reads_bytes,
        release: Some(vectorcraft_doc::placed_document::release_placed_reads),
    },
    Table {
        krate: "vectorcraft-effects",
        name: "texture_cache",
        grows_with: "texture effects with a loaded texture drawn (the last few textures)",
        bytes: vectorcraft_effects::pixel::texture_cache_bytes,
        release: Some(vectorcraft_effects::pixel::release_texture_cache),
    },
    Table {
        krate: "vectorcraft-color",
        name: "user_profiles",
        grows_with: "color profiles loaded",
        bytes: vectorcraft_color::cms::user_profiles_bytes,
        release: None,
    },
    Table {
        krate: "vectorcraft-text",
        name: "font_faces",
        grows_with: "fonts added as bytes or read from installed font files",
        bytes: font_faces_bytes,
        release: None,
    },
];

/// The tables, in a fixed order.
pub fn tables() -> &'static [Table] {
    &TABLES
}

/// Roughly how many bytes the tables hold together.
pub fn bytes() -> usize {
    TABLES.iter().map(|t| (t.bytes)()).sum()
}

/// Empty every table that can be emptied.
pub fn release_all() {
    for t in &TABLES {
        if let Some(release) = t.release {
            release();
        }
    }
}
