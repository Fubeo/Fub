//! I costruttori dell'albero che ogni `ViewProvider` ridisegna a mano.
//!
//! # Quanto era davvero, e perché sta qui e non in `testing`
//!
//! Il §16.1 diceva che «le feature ufficiali costruiscono già lo stesso albero
//! tre volte». Contato, l'albero **non** è lo stesso: il pannello backlink è una
//! colonna con un'intestazione e una lista, l'outline è una colonna con un
//! albero, il pannello dei tag è una colonna con un campo di filtro e una lista.
//! Ciò che è davvero scritto tre volte è **una funzione di due righe** — il
//! segnaposto per il vuoto — più la convenzione con cui una riga porta il
//! proprio dato dentro il payload dell'azione.
//!
//! È molto meno di quanto la voce prometteva, ed è la ragione per cui questo
//! modulo è piccolo: raccogliere le tre copie di un albero che non esiste
//! avrebbe voluto dire inventarne uno che nessuno dei tre voleva.
//!
//! E sta in `fub_sdk::ui`, non in `fub_sdk::testing` come il §16.1
//! proponeva, perché **un costruttore di view non è codice di prova**: sotto
//! `testing` sarebbe stato a disposizione di un provider solo nei suoi test, che
//! è il posto in cui non serve.

use fub_abi::text::Text;
use fub_abi::ui::{ActionRef, UiNode};

/// Il segnaposto per il vuoto: *non ci sono backlink*, *nessuna nota aperta*,
/// *nessun tag che corrisponda*.
///
/// Prende una **chiave**, non una stringa (§12.1): la prosa sta nel catalogo di
/// chi scrive il provider, e la shell non conosce le chiavi di nessuno.
pub fn placeholder(key: &str) -> UiNode {
    UiNode::empty_state(Text::key(key))
}

/// Una riga cliccabile che porta con sé il dato su cui l'azione va servita.
///
/// È la convenzione che le tre view ufficiali avevano ognuna per conto proprio:
/// il payload porta il dato, la chiave della riga è la sua **identità fra due
/// ridisegni** — il documento, non la posizione nell'elenco. Prima della
/// [decisione 0016](../../../docs/decisions/0016-cosa-e-una-view.md) il dato
/// veniva codificato dentro l'`ActionId` e ognuno lo codificava a modo suo.
pub fn row_with_datum(
    title: impl Into<Text>,
    subtitle: Option<Text>,
    action: &str,
    field: &str,
    value: &str,
) -> UiNode {
    UiNode::list_item(
        title,
        subtitle,
        Some(ActionRef::with(action, serde_json::json!({ field: value }))),
    )
    .with_key(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::ui::UiKind;

    #[test]
    fn placeholder_is_an_empty_state_not_text_in_a_column() {
        // La differenza si vede quando è la shell a doverlo disegnare
        // diversamente dal contenuto.
        assert!(matches!(
            placeholder("empty").kind,
            UiKind::EmptyState { .. }
        ));
    }

    #[test]
    fn row_carries_the_datum_in_the_payload_and_is_identifiable_across_redraws() {
        let row = row_with_datum("Note", None, "open", "doc", "a/One.md");
        assert_eq!(row.key.as_deref(), Some("a/One.md"));
        let UiKind::ListItem { action, .. } = &row.kind else {
            panic!("a row is a ListItem");
        };
        let action = action.as_ref().expect("a row has an action");
        assert_eq!(action.payload["doc"], "a/One.md");
    }
}
