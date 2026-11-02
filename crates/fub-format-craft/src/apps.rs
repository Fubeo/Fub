//! Le quattro famiglie di file Craft che Fub legge, con i loro id di formato,
//! le estensioni e l'editor esterno che le apre.
//!
//! Gli id e le estensioni si confrontano così come sono scritti: il kernel
//! assegna il formato dall'estensione, e qui arriva l'id che ne è uscito.

use serde::{Deserialize, Serialize};

/// L'id del formato dei disegni di VectorCraft (`.vectorcraft`).
pub const VECTORCRAFT_FORMAT_ID: &str = "craft-vectorcraft";
/// L'id del formato delle immagini a livelli di PhotoCraft (`.pcraft`).
pub const PHOTOCRAFT_FORMAT_ID: &str = "craft-photocraft";
/// L'id del formato dei progetti di FigCraft (`.figcraft`).
pub const FIGCRAFT_FORMAT_ID: &str = "craft-figcraft";
/// L'id del formato degli XMP di LightCraft (`.xmp`).
pub const XMP_FORMAT_ID: &str = "craft-xmp";

/// Una famiglia di file Craft.
///
/// In JSON (`info.app` del contratto dell'anteprima) è il suo [`id`](Self::id):
/// `vectorcraft`, `photocraft`, `figcraft` o `xmp`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum CraftApp {
    #[serde(rename = "vectorcraft")]
    VectorCraft,
    #[serde(rename = "photocraft")]
    PhotoCraft,
    #[serde(rename = "figcraft")]
    FigCraft,
    #[serde(rename = "xmp")]
    Xmp,
}

impl CraftApp {
    /// Le quattro famiglie, nell'ordine in cui il crate registra i provider.
    pub const ALL: [CraftApp; 4] = [
        CraftApp::VectorCraft,
        CraftApp::PhotoCraft,
        CraftApp::FigCraft,
        CraftApp::Xmp,
    ];

    /// Il nome della famiglia nel contratto: lo stesso che serde scrive.
    pub fn id(self) -> &'static str {
        match self {
            CraftApp::VectorCraft => "vectorcraft",
            CraftApp::PhotoCraft => "photocraft",
            CraftApp::FigCraft => "figcraft",
            CraftApp::Xmp => "xmp",
        }
    }

    /// L'id del formato che il provider della famiglia dichiara.
    pub fn format_id(self) -> &'static str {
        match self {
            CraftApp::VectorCraft => VECTORCRAFT_FORMAT_ID,
            CraftApp::PhotoCraft => PHOTOCRAFT_FORMAT_ID,
            CraftApp::FigCraft => FIGCRAFT_FORMAT_ID,
            CraftApp::Xmp => XMP_FORMAT_ID,
        }
    }

    /// Il nome del formato, quello del descrittore.
    pub fn name(self) -> &'static str {
        match self {
            CraftApp::VectorCraft => "VectorCraft",
            CraftApp::PhotoCraft => "PhotoCraft",
            CraftApp::FigCraft => "FigCraft",
            CraftApp::Xmp => "XMP di LightCraft",
        }
    }

    /// Le estensioni che il provider della famiglia reclama, senza il punto.
    /// Soltanto quelle dei file Craft: le altre che le app aprono restano di
    /// chi le ha.
    pub fn extensions(self) -> &'static [&'static str] {
        match self {
            CraftApp::VectorCraft => &["vectorcraft"],
            CraftApp::PhotoCraft => &["pcraft"],
            CraftApp::FigCraft => &["figcraft"],
            CraftApp::Xmp => &["xmp"],
        }
    }

    /// L'id dell'editor esterno che apre la famiglia: un XMP è di LightCraft,
    /// che lo scrive accanto alla foto.
    pub fn editor(self) -> &'static str {
        match self {
            CraftApp::VectorCraft => "vectorcraft",
            CraftApp::PhotoCraft => "photocraft",
            CraftApp::FigCraft => "figcraft",
            CraftApp::Xmp => "lightcraft",
        }
    }

    /// Il nome da mostrare dell'editor esterno (`info.editor` del contratto).
    pub fn editor_name(self) -> &'static str {
        match self {
            CraftApp::VectorCraft => "VectorCraft",
            CraftApp::PhotoCraft => "PhotoCraft",
            CraftApp::FigCraft => "FigCraft",
            CraftApp::Xmp => "LightCraft",
        }
    }

    /// La famiglia che dichiara l'id di formato `id`, se è una delle quattro.
    pub fn of_format(id: &str) -> Option<CraftApp> {
        CraftApp::ALL.into_iter().find(|app| app.format_id() == id)
    }
}
