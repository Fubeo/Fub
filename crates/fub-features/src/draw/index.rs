//! L'indice `fub.draw`: le domande dell'editor dei disegni all'host.
//!
//! Non indicizza niente: non riceve documenti e non tiene stato. È il canale
//! con cui la superficie dell'editor chiede all'host quello che soltanto l'host
//! sa fare allo stesso modo dell'export, e oggi sono i caratteri del vault
//! ([`super::fonts`]). Le domande passano dal canale `Custom` già esistente,
//! con un `kind`, una versione e campi chiusi:
//!
//! - `{"kind": "font_faces", "version": 1, "data": "<base64>"}` chiede le
//!   facce di un file di caratteri, i suoi byte così come stanno nel vault, e
//!   risponde `{"faces": [...]}`;
//! - `{"kind": "font_instance", "version": 1, "data": "<base64>", "index": 0,
//!   "coordinates": [{"tag": "wght", "value": 700}]}` chiede la faccia `index`
//!   fissata in quel punto degli assi, e risponde `{"data": "<base64>"}`, un
//!   TrueType o un OpenType con una faccia sola.
//!
//! I byte li manda il client, che il file lo legge già dalla porta delle
//! risorse: un indice non legge il vault.

use std::fmt;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use fub_abi::{
    DocId, DocumentModel, HostApi, IndexLoss, IndexProvider, IndexQuery, IndexResult, PluginError,
    QueryKind, QueryRoute,
};
use serde::Deserialize;
use serde_json::json;

use super::fonts::{self, Coordinate, FontError};
use super::DRAW_ID;

/// Le domande, con la loro versione.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum DrawQuery {
    FontFaces {
        version: u32,
        data: String,
    },
    FontInstance {
        version: u32,
        data: String,
        index: u32,
        coordinates: Vec<Coordinate>,
    },
}

/// Perché una domanda non ha risposta.
enum QueryError {
    Namespace,
    Shape(String),
    Version(u32),
    Base64,
    Font(FontError),
}

impl fmt::Display for QueryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            QueryError::Namespace => write!(f, "expected a {DRAW_ID} query"),
            QueryError::Shape(reason) => write!(f, "malformed {DRAW_ID} query: {reason}"),
            QueryError::Version(version) => {
                write!(f, "unsupported {DRAW_ID} query version {version}")
            }
            QueryError::Base64 => f.write_str("font data is not base64"),
            QueryError::Font(error) => error.fmt(f),
        }
    }
}

impl From<QueryError> for PluginError {
    fn from(error: QueryError) -> Self {
        PluginError::BadArgs(error.to_string().into())
    }
}

/// L'indice dei disegni.
pub struct DrawIndex;

impl DrawIndex {
    fn answer(query: &serde_json::Value) -> Result<serde_json::Value, QueryError> {
        let query =
            DrawQuery::deserialize(query).map_err(|error| QueryError::Shape(error.to_string()))?;
        let (version, data) = match &query {
            DrawQuery::FontFaces { version, data } => (*version, data),
            DrawQuery::FontInstance { version, data, .. } => (*version, data),
        };
        if version != 1 {
            return Err(QueryError::Version(version));
        }
        // Il tetto vale prima di decodificare: il base64 di un file troppo
        // grande non diventa nemmeno byte.
        if data.len() / 4 * 3 > fonts::MAX_FONT_BYTES + 3 {
            return Err(QueryError::Font(FontError::TooLarge));
        }
        let bytes = BASE64.decode(data).map_err(|_| QueryError::Base64)?;
        let sfnt = fonts::decode(&bytes).map_err(QueryError::Font)?;
        match query {
            DrawQuery::FontFaces { .. } => {
                let faces = fonts::describe(&sfnt).map_err(QueryError::Font)?;
                Ok(json!({ "faces": faces }))
            }
            DrawQuery::FontInstance {
                index, coordinates, ..
            } => {
                let font = fonts::instance(&sfnt, index, &coordinates).map_err(QueryError::Font)?;
                Ok(json!({ "data": BASE64.encode(font) }))
            }
        }
    }
}

impl IndexProvider for DrawIndex {
    fn routes(&self) -> Vec<QueryRoute> {
        vec![QueryRoute::Query(QueryKind::Custom(DRAW_ID.into()))]
    }

    fn activate(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn on_documents_indexed(&mut self, _: &[DocumentModel]) -> Vec<IndexLoss> {
        Vec::new()
    }

    fn on_documents_removed(&mut self, _: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }

    fn reconcile(&mut self, _: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }

    fn close(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn query(&self, request: IndexQuery) -> Result<IndexResult, PluginError> {
        let IndexQuery::Custom { ns, query } = request else {
            return Err(QueryError::Namespace.into());
        };
        if ns != DRAW_ID {
            return Err(QueryError::Namespace.into());
        }
        Ok(IndexResult::Custom(Self::answer(&query)?))
    }

    fn flush(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::super::fonts::tests::app_font;
    use super::*;

    fn ask(query: Value) -> Result<Value, PluginError> {
        match DrawIndex.query(IndexQuery::Custom {
            ns: DRAW_ID.into(),
            query,
        })? {
            IndexResult::Custom(answer) => Ok(answer),
            other => panic!("{other:?}"),
        }
    }

    fn refusal(query: Value) -> String {
        match ask(query) {
            Err(PluginError::BadArgs(reason)) => reason.to_string(),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn the_index_answers_with_the_faces_and_an_instance() {
        let data = BASE64.encode(app_font("literata-latin-wght-italic.woff2"));
        let answer = ask(json!({"kind": "font_faces", "version": 1, "data": data})).unwrap();
        let face = &answer["faces"][0];
        assert_eq!(face["family"], "Literata");
        assert_eq!(face["generic"], "serif");
        assert_eq!(face["weight"], json!([200.0, 900.0]));
        assert_eq!(face["styles"], json!([{"style": "italic", "fixed": []}]));
        assert_eq!(face["axes"][0]["tag"], "wght");

        let answer = ask(json!({
            "kind": "font_instance", "version": 1, "data": data, "index": 0,
            "coordinates": [{"tag": "wght", "value": 650}],
        }))
        .unwrap();
        let font = BASE64.decode(answer["data"].as_str().unwrap()).unwrap();
        let faces = fonts::describe(&font).unwrap();
        assert_eq!(faces[0].weight, [650.0, 650.0]);
        assert!(faces[0].axes.is_empty());
    }

    #[test]
    fn a_wrong_question_is_refused_with_its_reason() {
        let data = BASE64.encode(app_font("inter-latin-wght-normal.woff2"));
        assert_eq!(
            refusal(json!({"kind": "font_faces", "version": 2, "data": data})),
            "unsupported fub.draw query version 2"
        );
        assert!(
            refusal(json!({"kind": "font_names", "version": 1, "data": data}))
                .starts_with("malformed fub.draw query")
        );
        assert!(
            refusal(json!({"kind": "font_faces", "version": 1, "data": data, "x": 1}))
                .starts_with("malformed fub.draw query")
        );
        assert_eq!(
            refusal(json!({"kind": "font_faces", "version": 1, "data": "%%%"})),
            "font data is not base64"
        );
        assert_eq!(
            refusal(json!({"kind": "font_faces", "version": 1, "data": BASE64.encode("<svg/>")})),
            "not a font file"
        );
        assert_eq!(
            refusal(json!({
                "kind": "font_instance", "version": 1, "data": data, "index": 3, "coordinates": [],
            })),
            "the font has no face 3"
        );
        let huge = "A".repeat(fonts::MAX_FONT_BYTES / 3 * 4 + 16);
        assert_eq!(
            refusal(json!({"kind": "font_faces", "version": 1, "data": huge})),
            "font larger than 64 MiB"
        );
        let other = DrawIndex.query(IndexQuery::Custom {
            ns: "fub.sheet".into(),
            query: json!({}),
        });
        assert!(matches!(other, Err(PluginError::BadArgs(_))));
        assert_eq!(
            DrawIndex.routes(),
            [QueryRoute::Query(QueryKind::Custom(DRAW_ID.into()))]
        );
    }
}
