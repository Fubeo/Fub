//! **Dove finisce una cartella**, e cosa vuol dire starci dentro.
//!
//! Nel kernel una cartella non esiste come oggetto: esistono i `DocId`, che
//! sono path, e una cartella è il **prefisso** che li accomuna. «Sta dentro
//! questa cartella?» è quindi una domanda su due stringhe, e chi la fa — un
//! filtro, un abbonamento, un'esportazione — se la scriveva da solo, in tre
//! copie diverse che si contraddicevano (difetto 0141).
//!
//! Qui la risposta è una, in due regole:
//!
//! - **gli slash ai due capi non contano**: `Progetti`, `Progetti/`,
//!   `/Progetti/` sono la stessa cartella;
//! - **il confronto è per segmento, non per prefisso**: `Progetti-vecchi` non
//!   sta dentro `Progetti`, e la radice (la cartella vuota) contiene tutto.
//!
//! Non decide chi *compone* un id dentro una cartella né chi *rifiuta* una
//! cartella scritta male: sono altre due domande, dichiarate accanto alle loro
//! righe in `crates/fub-abi/tests/a_named_rule_is_declared.rs`.

/// La cartella nella forma su cui si confronta: senza gli slash di cortesia.
///
/// Chi **compone** un path la usa per lo stesso motivo per cui la usa chi
/// confronta — comporre dentro una cartella e poi interrogarla devono parlare
/// della stessa cartella.
pub fn normalized(folder: &str) -> &str {
    folder.trim_matches('/')
}

/// La cartella che contiene questo path, qualunque cosa il path nomini: un file
/// o **un'altra cartella**. `""` per chi sta nella radice.
pub fn parent(path: &str) -> &str {
    path.rsplit_once('/').map(|(dir, _)| dir).unwrap_or("")
}

/// `own` — la cartella di ciò che si sta valutando — sta in `folder`?
///
/// Con `discendenti`, anche in una sua discendente a qualunque profondità; e la
/// radice con `discendenti` è tutto il vault.
///
/// L'argomento è `own` e non il documento perché **la stessa domanda si fa su
/// due cose diverse**: per un file `own` è la cartella che lo contiene, per una
/// cartella è la sua genitrice — e da lì in poi le regole sono le stesse,
/// radice compresa. Con due funzioni sarebbero due, e divergerebbero sul caso
/// che nessuno prova.
pub fn within(folder: &str, own: &str, descendants: bool) -> bool {
    let folder = normalized(folder);
    let own = normalized(own);
    if !descendants {
        return own == folder;
    }
    folder.is_empty()
        || own == folder
        || own.strip_prefix(folder).is_some_and(|r| r.starts_with('/'))
}

/// Questo path sta dentro questa cartella, a qualunque profondità?
///
/// È [`dentro`] posta su ciò che è contenuto invece che sulla sua cartella, ed
/// è la forma che serve a chi ha in mano un `DocId`. Una cartella non sta
/// dentro sé stessa: `contiene("Progetti", "Progetti")` è falso, perché la
/// domanda è «questo *documento* sta lì», e la genitrice di `Progetti` è la
/// radice.
pub fn contains(folder: &str, path: &str) -> bool {
    within(folder, parent(path), true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_three_ways_to_write_the_same_folder_filter_alike() {
        for folder in ["Progetti", "Progetti/", "/Progetti", "/Progetti/"] {
            assert!(
                contains(folder, "Progetti/Alpha.md"),
                "\"{folder}\" is the same folder as \"Progetti\""
            );
            assert!(
                within(folder, "Progetti/2026", true),
                "\"{folder}\" contains its descendants"
            );
            assert!(within(folder, "Progetti", false), "\"{folder}\" is itself");
        }
    }

    #[test]
    fn the_boundary_is_segment_level_not_prefix() {
        assert!(!contains("Progetti", "Progetti-vecchi/Alpha.md"));
        assert!(!contains("Progetti", "Progetti"));
        assert!(!within("Progetti", "Progetti/2026", false));
        assert!(contains("Progetti/2026", "Progetti/2026/Alpha.md"));
        assert!(!contains("Progetti/2026", "Progetti/2027/Alpha.md"));
    }

    #[test]
    fn the_root_is_the_entire_vault_and_has_three_written_forms() {
        for root in ["", "/", "//"] {
            assert!(contains(root, "Alpha.md"));
            assert!(contains(root, "Progetti/2026/Alpha.md"));
            assert!(within(root, "", false), "the root is itself");
            assert!(!within(root, "Progetti", false));
        }
    }

    #[test]
    fn the_parent_of_something_at_root_is_root() {
        assert_eq!(parent("Alpha.md"), "");
        assert_eq!(parent("Progetti/Alpha.md"), "Progetti");
        assert_eq!(parent("Progetti/2026/Alpha.md"), "Progetti/2026");
    }
}
