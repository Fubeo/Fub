//! **«Sta dentro questa cartella?» ha una risposta sola** (difetto 0141).
//!
//! Ne aveva tre. `query::within_folder` tagliava i soli `/` finali,
//! `rules::events::folder_contains` pure ma su un'altra forma, e
//! `transfer::in_folder` tagliava da entrambi i capi — al punto che il banco di
//! `transfer.rs` asseriva vero (`/x/` contiene `x/a.md`) ciò che
//! `within_folder` dava falso. Nessuna delle tre era sbagliata da sola: erano
//! diverse, e la differenza era **muta**, perché nessuna riga del repo le
//! vedeva insieme.
//!
//! Questa è quella riga. Non prova cosa risponde la regola — quello lo provano
//! le prove unitarie di [`fub_abi::rules::folders`], accanto al corpo: prova
//! che tutte le superfici che fanno la domanda rispondano **la stessa cosa**,
//! su una tabella sola, compresi i modi di scrivere una cartella che una copia
//! accettava e un'altra no.
//!
//! È il banco che diventa rosso se un giorno una quarta superficie se la
//! riscrive in tre righe per non aggiungere un `use`.

use fub_abi::model::DocId;
use fub_abi::query::{in_folder, parent_folder, within_folder};
use fub_abi::rules::folders;
use fub_abi::rules::events::folder_contains;
use fub_abi::transfer::ImportRequest;

/// I casi: la cartella com'è scritta, il documento, e se ci sta dentro.
///
/// Le prime quattro righe sono la stessa cartella scritta nei quattro modi in
/// cui la scrive chi la scrive — a mano in un comando, incollata da un file
/// manager, pensata come path assoluto — e sono la ragione del difetto: due di
/// quelle scritture filtravano diversamente.
const CASES: &[(&str, &str, bool)] = &[
    ("Progetti", "Progetti/Alpha.md", true),
    ("Progetti/", "Progetti/Alpha.md", true),
    ("/Progetti", "Progetti/Alpha.md", true),
    ("/Progetti/", "Progetti/Alpha.md", true),
    ("Progetti", "Progetti/2026/Alpha.md", true),
    ("Progetti/2026", "Progetti/2026/Alpha.md", true),
    ("Progetti/2026", "Progetti/2027/Alpha.md", false),
    ("Progetti", "Progetti-vecchi/Alpha.md", false),
    ("Progetti", "Alpha.md", false),
    ("Progetti", "Progetti", false),
    ("", "Alpha.md", true),
    ("", "Progetti/2026/Alpha.md", true),
    ("/", "Progetti/Alpha.md", true),
];

#[test]
fn every_surface_that_does_the_question_from_the_same_response() {
    for &(folder, id, expected) in CASES {
        let doc = DocId::new(id);
        let answers = [
            ("rules::folders::contains", folders::contains(folder, id)),
            (
                "rules::folders::within",
                folders::within(folder, parent_folder(id), true),
            ),
            ("query::in_folder", in_folder(&doc, folder, true)),
            (
                "query::within_folder",
                within_folder(parent_folder(id), folder, true),
            ),
            (
                "rules::events::folder_contains",
                folder_contains(folder, id),
            ),
        ];
        for (who, answer) in answers {
            assert_eq!(
                answer, expected,
                "«{id}» dentro «{folder}»: {who} dice {answer}, e la regola \
                 dice {expected}. Tre risposte a questa domanda sono il difetto \
                 0141: se questa superficie deve divergere, la divergenza si \
                 dichiara in `una_regola_di_nome_si_dichiara.rs` con la sua \
                 ragione — non si scrive in tre righe qui"
            );
        }
    }
}

/// Chi **compone** dentro una cartella e chi la **interroga** parlano della
/// stessa cartella.
///
/// È la metà del difetto che non si vede guardando i predicati: importare in
/// `/Importati/2026/` e poi esportare `Importati/2026` sono due normalizzazioni
/// diverse di una stringa che l'utente ha scritto una volta sola. Se divergono,
/// l'importazione riesce e la cartella risulta vuota.
#[test]
fn import_in_a_folder_and_query_it_and_the_same_folder() {
    for written in ["Importati/2026", "Importati/2026/", "/Importati/2026/"] {
        let request = ImportRequest::apply()
            .into_folder(written)
            .destination("Nota.md");
        assert_eq!(request, DocId::new("Importati/2026/Nota.md"));
        for query in ["Importati/2026", "Importati/2026/", "/Importati/2026/"] {
            assert!(
                folders::contains(query, request.as_str()),
                "importato in «{written}», non si trova chiedendo «{query}»"
            );
        }
    }
}

/// Una cartella dichiarata dal suo antenato: la selezione di un'esportazione e
/// la maschera di un abbonamento devono prendere le stesse note.
#[test]
fn who_is_subscribes_and_who_exports_take_the_same_notes() {
    let vault = [
        "Alpha.md",
        "Progetti/Beta.md",
        "Progetti/2026/Gamma.md",
        "Progetti-vecchi/Delta.md",
    ];
    for folder in ["Progetti", "Progetti/", "/Progetti/"] {
        let exported: Vec<&str> = vault
            .iter()
            .copied()
            .filter(|id| folders::contains(folder, id))
            .collect();
        let subscribed: Vec<&str> = vault
            .iter()
            .copied()
            .filter(|id| folder_contains(folder, id))
            .collect();
        assert_eq!(
            exported,
            ["Progetti/Beta.md", "Progetti/2026/Gamma.md"],
            "«{folder}» prende le discendenti e non l'omonima"
        );
        assert_eq!(exported, subscribed, "con la cartella scritta «{folder}»");
    }
}
