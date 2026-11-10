//! Il frontmatter YAML: la lettura e il blocco verbatim quando non si legge.

use super::*;

/// Il frontmatter proiettato su JSON, oppure **perché non si è potuto**.
///
/// L'errore è una frase, non un tipo: qui non c'è nessuno che debba
/// distinguere fra «virgola sbagliata» e «non è una mappa» *facendo* qualcosa
/// di diverso — c'è qualcuno che deve leggerla. Ciò che conta è che il
/// fallimento **esista**: prima cadeva in un `_ => Frontmatter::default()`, e
/// da lì in poi un frontmatter rotto e un frontmatter assente erano
/// indistinguibili per chiunque, riscrittura compresa.
pub(super) fn parse_frontmatter(raw: &str) -> Result<Frontmatter, String> {
    // `raw` include i delimitatori `---`; li togliamo prima di parsare lo YAML.
    let inner = raw.trim();
    let inner = inner.strip_prefix("---").unwrap_or(inner);
    let inner = inner.strip_suffix("---").unwrap_or(inner).trim();
    if inner.is_empty() {
        return Ok(Frontmatter::default());
    }
    if !yaml::within_budget(inner) {
        return Err(yaml::OVER_BUDGET.to_string());
    }
    match serde_yaml_ng::from_str::<serde_json::Value>(inner) {
        Ok(serde_json::Value::Object(map)) => Ok(Frontmatter(map)),
        // Uno YAML valido che non è una mappa (`- a`, `solo testo`) non è un
        // frontmatter: non ha proprietà da offrire, e non è un errore di
        // sintassi che si possa citare con una riga.
        Ok(other) => Err(format!(
            "il frontmatter non è una mappa di proprietà ma {}",
            yaml_kind(&other)
        )),
        Err(and) => Err(and.to_string()),
    }
}

fn yaml_kind(v: &serde_json::Value) -> &'static str {
    match v {
        serde_json::Value::Null => "un valore vuoto",
        serde_json::Value::Bool(_) => "un booleano",
        serde_json::Value::Number(_) => "un numero",
        serde_json::Value::String(_) => "una stringa",
        serde_json::Value::Array(_) => "un elenco",
        serde_json::Value::Object(_) => "una mappa",
    }
}

/// Il blocco che conserva un frontmatter illeggibile **verbatim**.
///
/// `text` è normalizzato a finire con un solo `\n` dopo il delimitatore di
/// chiusura: `raw` di comrak si porta dietro anche la riga vuota che separa il
/// frontmatter dal corpo, e quella riga la rimette il serializer come
/// separatore fra blocchi. Senza la normalizzazione il giro completo
/// guadagnerebbe una riga vuota a ogni passaggio.
pub(super) fn frontmatter_verbatim(raw: &str, reason: String, span: Span) -> Block {
    let mut text = raw.trim_end().to_string();
    text.push('\n');
    Block::Custom {
        custom_kind: custom_kind::FRONTMATTER_UNPARSED.to_string(),
        attrs: serde_json::json!({ "text": text, "error": reason }),
        blocks: Vec::new(),
        anchor: None,
        span,
    }
}
