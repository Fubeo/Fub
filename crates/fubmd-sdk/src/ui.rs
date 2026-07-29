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
//! E sta in `fubmd_sdk::ui`, non in `fubmd_sdk::testing` come il §16.1
//! proponeva, perché **un costruttore di view non è codice di prova**: sotto
//! `testing` sarebbe stato a disposizione di un provider solo nei suoi test, che
//! è il posto in cui non serve.

use fubmd_abi::text::Text;
use fubmd_abi::ui::{ActionRef, UiNode};

/// Il segnaposto per il vuoto: *non ci sono backlink*, *nessuna nota aperta*,
/// *nessun tag che corrisponda*.
///
/// Prende una **chiave**, non una stringa (§12.1): la prosa sta nel catalogo di
/// chi scrive il provider, e la shell non conosce le chiavi di nessuno.
pub fn segnaposto(chiave: &str) -> UiNode {
    UiNode::empty_state(Text::key(chiave))
}

/// Una riga cliccabile che porta con sé il dato su cui l'azione va servita.
///
/// È la convenzione che le tre view ufficiali avevano ognuna per conto proprio:
/// il payload porta il dato, la chiave della riga è la sua **identità fra due
/// ridisegni** — il documento, non la posizione nell'elenco. Prima della
/// [decisione 0016](../../../docs/decisions/0016-cosa-e-una-view.md) il dato
/// veniva codificato dentro l'`ActionId` e ognuno lo codificava a modo suo.
pub fn riga_con_dato(
    titolo: impl Into<Text>,
    sottotitolo: Option<Text>,
    azione: &str,
    campo: &str,
    valore: &str,
) -> UiNode {
    UiNode::list_item(
        titolo,
        sottotitolo,
        Some(ActionRef::with(
            azione,
            serde_json::json!({ campo: valore }),
        )),
    )
    .with_key(valore)
}

#[cfg(test)]
mod tests {
    use super::*;
    use fubmd_abi::ui::UiKind;

    #[test]
    fn il_segnaposto_e_uno_stato_vuoto_non_un_testo_in_una_colonna() {
        // La differenza si vede quando è la shell a doverlo disegnare
        // diversamente dal contenuto.
        assert!(matches!(
            segnaposto("empty").kind,
            UiKind::EmptyState { .. }
        ));
    }

    #[test]
    fn la_riga_porta_il_dato_nel_payload_e_si_riconosce_fra_due_ridisegni() {
        let riga = riga_con_dato("Nota", None, "open", "doc", "a/Uno.md");
        assert_eq!(riga.key.as_deref(), Some("a/Uno.md"));
        let UiKind::ListItem { action, .. } = &riga.kind else {
            panic!("una riga è un ListItem");
        };
        let action = action.as_ref().expect("la riga ha un'azione");
        assert_eq!(action.payload["doc"], "a/Uno.md");
    }
}
