//! «Apri con»: quali app Craft aprono un file del vault, e aprirlo con una.
//!
//! Il menu della shell, l'MCP e il prestito di un documento chiedono la stessa
//! cosa, e la risposta è una, qui. I tipi e i due metodi di [`Host`] ci sono
//! sempre; il lavoro lo fa `craft::open_with`, dietro la feature `craft`.
//! Senza la feature, o col componente `fub.craft` spento nel vault, non c'è
//! nessuna app: la lista è vuota e aprire è `host.open_with.off`.
//!
//! Fub non parla mai con un'app che non si fa riconoscere: il canale verso
//! un'app aperta vale soltanto con un token che Fub le ha dato avviandola
//! (`craft::channel`). Le regole sono in `docs/reference/external-editors.md`.

use serde::{Deserialize, Serialize};

use fub_abi::PluginError;

use crate::session::Host;

/// Un'app Craft che Fub conosce, vista da «Apri con».
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExternalEditor {
    /// L'id della tabella delle app (`photocraft`).
    pub id: String,
    /// Il nome da mostrare (`PhotoCraft`).
    pub name: String,
    /// Le estensioni che apre, minuscole e senza il punto.
    pub opens: Vec<String>,
    /// Se Fub ha trovato il suo programma su questa macchina.
    pub installed: bool,
    /// Avviata da Fub e non ancora uscita: «Già aperta». Un'app aperta da
    /// un'altra parte non conta, perché Fub non la vede.
    pub running: bool,
}

/// Come il file è arrivato all'app.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OpenHow {
    /// L'app tiene una finestra sola su questo sistema: Fub l'ha avviata col
    /// file, e lei lo passa alla finestra aperta, se c'è.
    Forwarded,
    /// L'app avviata da Fub, ancora aperta, l'ha ricevuto dal suo canale.
    InRunning,
    /// Un processo nuovo dell'app, col file.
    NewProcess,
}

/// L'esito di «Apri con».
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OpenedWith {
    /// L'id dell'app che ha il file.
    pub editor: String,
    pub how: OpenHow,
}

impl Host {
    /// Le app Craft che aprono `doc` (un percorso relativo alla radice del
    /// vault), nell'ordine della tabella; senza `doc` tutte quelle che Fub
    /// conosce, perché la shell sappia se ce n'è almeno una installata.
    /// Senza la feature `craft`, o con `fub.craft` spento, nessuna.
    pub fn external_editors(
        &self,
        vault: Option<&str>,
        doc: Option<&str>,
    ) -> Result<Vec<ExternalEditor>, PluginError> {
        #[cfg(feature = "craft")]
        {
            crate::craft::open_with::external_editors(self, vault, doc)
        }
        #[cfg(not(feature = "craft"))]
        {
            let _ = (vault, doc);
            Ok(Vec::new())
        }
    }

    /// Apre il file `path` del vault con l'app `editor`. `page` vale per
    /// PdfCraft (`--page N`); le altre app la ignorano.
    pub fn open_with(
        &self,
        vault: Option<&str>,
        path: &str,
        editor: &str,
        page: Option<u32>,
    ) -> Result<OpenedWith, PluginError> {
        #[cfg(feature = "craft")]
        {
            crate::craft::open_with::open_with(self, vault, path, editor, page)
        }
        #[cfg(not(feature = "craft"))]
        {
            let _ = (vault, path, editor, page);
            Err(PluginError::Unserved(fub_abi::text::Text::key(
                "host.open_with.off",
            )))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shapes_cross_json_in_snake_case() {
        let opened = OpenedWith {
            editor: "photocraft".into(),
            how: OpenHow::InRunning,
        };
        let json = serde_json::to_value(&opened).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"editor": "photocraft", "how": "in_running"})
        );
        assert_eq!(serde_json::from_value::<OpenedWith>(json).unwrap(), opened);
        for (how, name) in [
            (OpenHow::Forwarded, "forwarded"),
            (OpenHow::NewProcess, "new_process"),
        ] {
            assert_eq!(serde_json::to_value(how).unwrap(), name);
        }
        let editor = ExternalEditor {
            id: "pdfcraft".into(),
            name: "PdfCraft".into(),
            opens: vec!["pdf".into()],
            installed: false,
            running: false,
        };
        let json = serde_json::to_value(&editor).unwrap();
        assert_eq!(json["opens"], serde_json::json!(["pdf"]));
        assert_eq!(
            serde_json::from_value::<ExternalEditor>(json).unwrap(),
            editor
        );
    }
}
