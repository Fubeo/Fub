//! **Dove finisce una cartella**, e cosa vuol dire starci dentro.
//!
//! Nel kernel una cartella non esiste come oggetto (§14.3): esistono i `DocId`,
//! che sono path, e una cartella è il **prefisso** che li accomuna. Ne segue
//! che «sta dentro questa cartella?» è una domanda su due stringhe, e che ogni
//! superficie che la fa — un predicato d'indice, la maschera di un abbonamento,
//! la selezione di un'esportazione — se la può scrivere da sé in tre righe.
//!
//! È esattamente ciò che era successo: tre risposte in produzione, tre trim
//! diversi, e un banco che asseriva vero ciò che un'altra copia dava falso
//! (difetto 0141). Nessuna delle tre era sbagliata da sola; erano diverse, e la
//! differenza era muta — chi si abbonava a `/Progetti` non riceveva niente
//! mentre l'esportazione della stessa cartella scritta uguale prendeva tutto, e
//! nessun test le confrontava perché nessuna riga le vedeva insieme.
//!
//! Qui la risposta è una. Le due decisioni che la compongono, scritte una volta
//! sola:
//!
//! - **gli slash ai due capi sono cortesia, non componenti.** `Progetti`,
//!   `Progetti/`, `/Progetti/` sono la stessa cartella. La forma con lo slash
//!   in coda è come la scrive chi viene da un file manager, quella con lo slash
//!   davanti è come la scrive chi pensa a un path assoluto, e due modi di
//!   scrivere la stessa cartella che filtrano diversamente sono un difetto che
//!   si vede una volta su venti. Lo diceva già `ImportRequest::destination`, che
//!   tagliava da entrambi i capi perché «gli slash di cortesia non diventano
//!   componenti vuote»: la novità non è la regola, è che adesso la dice un posto
//!   solo.
//! - **il confronto è per segmento, non per prefisso.** `Progetti-vecchi` non
//!   sta dentro `Progetti`, e la radice — la cartella vuota — contiene tutto.
//!
//! Ciò che questo modulo **non** decide, e che resta giustamente diverso: chi
//! *compone* un id dentro una cartella e chi *rifiuta* una cartella scritta
//! male. Sono altre due domande, e sono dichiarate accanto alle loro righe in
//! `crates/fub-abi/tests/una_regola_di_nome_si_dichiara.rs`.

/// La cartella nella forma su cui si confronta: senza gli slash di cortesia.
///
/// Chi **compone** un path la usa per lo stesso motivo per cui la usa chi
/// confronta — comporre dentro una cartella e poi interrogarla devono parlare
/// della stessa cartella.
pub fn normalizzata(folder: &str) -> &str {
    folder.trim_matches('/')
}

/// La cartella che contiene questo path, qualunque cosa il path nomini: un file
/// o **un'altra cartella**. `""` per chi sta nella radice.
pub fn genitrice(path: &str) -> &str {
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
pub fn dentro(folder: &str, own: &str, discendenti: bool) -> bool {
    let folder = normalizzata(folder);
    let own = normalizzata(own);
    if !discendenti {
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
pub fn contiene(folder: &str, path: &str) -> bool {
    dentro(folder, genitrice(path), true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn i_tre_modi_di_scrivere_la_stessa_cartella_filtrano_uguale() {
        for folder in ["Progetti", "Progetti/", "/Progetti", "/Progetti/"] {
            assert!(
                contiene(folder, "Progetti/Alpha.md"),
                "«{folder}» è la stessa cartella di «Progetti»"
            );
            assert!(
                dentro(folder, "Progetti/2026", true),
                "«{folder}» contiene le sue discendenti"
            );
            assert!(dentro(folder, "Progetti", false), "«{folder}» è sé stessa");
        }
    }

    #[test]
    fn il_confine_e_un_segmento_e_non_un_prefisso() {
        assert!(!contiene("Progetti", "Progetti-vecchi/Alpha.md"));
        assert!(!contiene("Progetti", "Progetti"));
        assert!(!dentro("Progetti", "Progetti/2026", false));
        assert!(contiene("Progetti/2026", "Progetti/2026/Alpha.md"));
        assert!(!contiene("Progetti/2026", "Progetti/2027/Alpha.md"));
    }

    #[test]
    fn la_radice_e_tutto_il_vault_e_si_scrive_in_tre_modi() {
        for radice in ["", "/", "//"] {
            assert!(contiene(radice, "Alpha.md"));
            assert!(contiene(radice, "Progetti/2026/Alpha.md"));
            assert!(dentro(radice, "", false), "la radice è sé stessa");
            assert!(!dentro(radice, "Progetti", false));
        }
    }

    #[test]
    fn la_genitrice_di_chi_sta_nella_radice_e_la_radice() {
        assert_eq!(genitrice("Alpha.md"), "");
        assert_eq!(genitrice("Progetti/Alpha.md"), "Progetti");
        assert_eq!(genitrice("Progetti/2026/Alpha.md"), "Progetti/2026");
    }
}
