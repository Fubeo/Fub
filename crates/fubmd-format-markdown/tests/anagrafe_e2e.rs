//! L'anagrafe con markdown **vero** (§14.1): spostare un allegato senza
//! rompere le note che lo mostrano.
//!
//! Sta qui e non fra i test del kernel per la ragione di sempre: le due sintassi
//! con cui una nota nomina un'immagine — `![[foto.png]]` e `![alt](img/foto.png)`
//! — le produce un parser, e un provider finto proverebbe solo che il kernel sa
//! riscrivere ciò che ha inventato lui. La proprietà sotto esame è che spostare
//! `foto.png` in `allegati/` — cioè la prima cosa che si fa mettendo ordine —
//! non lasci dietro di sé un'immagine rotta in ogni nota che la incorpora.

use camino::Utf8PathBuf;
use fubmd_abi::model::DocId;
use fubmd_abi::traits::{EntryKind, HealthCheck, IndexQuery, IndexResult};
use fubmd_format_markdown::MarkdownProvider;
use fubmd_kernel::{FormatRegistry, Workspace};

/// Un vault con un'immagine e tre modi di nominarla.
fn vault() -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().join("vault")).expect("utf8");
    let write = |rel: &str, body: &str| {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    };

    write("foto.png", "PNG!");
    write("Diario.md", "# Diario\n\nEccola: ![[foto.png]]\n");
    write(
        "Note/Album.md",
        "Da una sottocartella: ![album](../foto.png)\n",
    );
    write("Assente.md", "Questa non c'è: ![vuoto](manca.png)\n");

    let mut registry = FormatRegistry::new();
    registry
        .register(MarkdownProvider::boxed())
        .expect("nessun conflitto di estensioni");
    let mut ws = Workspace::new(&root, registry);
    ws.reindex().expect("reindex");
    (dir, ws)
}

fn broken(ws: &Workspace) -> Vec<(String, Option<String>)> {
    let IndexResult::VaultHealth(page) = ws
        .query_index(IndexQuery::VaultHealth {
            check: HealthCheck::BrokenLinks,
            page: None,
        })
        .expect("il kernel serve la salute")
    else {
        panic!("atteso un rapporto");
    };
    page.items
        .iter()
        .map(|i| (i.doc.to_string(), i.detail.clone()))
        .collect()
}

#[test]
fn un_allegato_che_manca_e_un_link_rotto_e_uno_che_ce_no() {
    let (_g, ws) = vault();

    // Prima di questa voce il controllo taceva su **tutti** gli allegati,
    // perché un allegato nel kernel non esisteva e l'unica cosa onesta che si
    // potesse fare era non pronunciarsi. Adesso i due casi si distinguono.
    assert_eq!(
        broken(&ws),
        [("Assente.md".to_string(), Some("manca.png".to_string()))],
        "solo quello che davvero non c'è: le due note che mostrano foto.png non sono rotte"
    );
}

#[test]
fn spostare_un_allegato_porta_con_se_chi_lo_mostra() {
    let (_g, mut ws) = vault();

    // Nessun provider sa parsare i PNG, e **pretenderlo sarebbe il difetto**:
    // rinominare un allegato è la stessa operazione di rinominare una nota, con
    // una coda diversa.
    ws.rename_document(&DocId::new("foto.png"), &DocId::new("allegati/foto.png"))
        .expect("lo spostamento riesce");

    assert_eq!(
        ws.read_source(&DocId::new("Diario.md")).unwrap(),
        "# Diario\n\nEccola: ![[foto.png]]\n",
        "un wikilink nomina per NOME: nel vault c'è una foto sola, quindi il nome \
         basta ancora e il testo non si tocca. Contarsi come omonimo di sé stesso \
         è il difetto che questo presidio ha trovato: il piano si calcola con il \
         path vecchio ancora in anagrafe"
    );
    assert_eq!(
        ws.read_source(&DocId::new("Note/Album.md")).unwrap(),
        "Da una sottocartella: ![album](../allegati/foto.png)\n",
        "un link markdown è relativo alla cartella di chi lo scrive: si ri-basa"
    );
    assert_eq!(
        ws.read_source(&DocId::new("Assente.md")).unwrap(),
        "Questa non c'è: ![vuoto](manca.png)\n",
        "e chi non lo nominava non viene toccato"
    );

    // L'anagrafe conosce il path nuovo e non più il vecchio.
    let IndexResult::Entries(page) = ws
        .query_index(IndexQuery::Entries {
            of_kind: Some(EntryKind::Asset),
            page: None,
        })
        .expect("il kernel serve l'anagrafe")
    else {
        panic!("attesa l'anagrafe");
    };
    let ids: Vec<String> = page.items.iter().map(|e| e.id.to_string()).collect();
    assert_eq!(ids, ["allegati/foto.png"]);

    // E il conto dei link rotti non è cambiato: se la riscrittura fosse
    // saltata, qui ce ne sarebbero tre invece di uno.
    assert_eq!(
        broken(&ws),
        [("Assente.md".to_string(), Some("manca.png".to_string()))],
        "spostare un allegato non rompe niente, che è tutto il punto"
    );
}

#[test]
fn un_wikilink_a_un_allegato_omonimo_prende_il_path_intero() {
    let (_g, mut ws) = vault();
    // Un secondo `foto.png` altrove: adesso il nome è conteso, e il rename non
    // può cavarsela scrivendo il solo nome del file.
    let root = ws.root().to_owned();
    std::fs::create_dir_all(root.join("altrove")).unwrap();
    std::fs::write(root.join("altrove/foto.png"), "PNG!").unwrap();
    ws.reindex().expect("reindex");

    ws.rename_document(&DocId::new("foto.png"), &DocId::new("allegati/foto.png"))
        .expect("lo spostamento riesce");

    assert_eq!(
        ws.read_source(&DocId::new("Diario.md")).unwrap(),
        "# Diario\n\nEccola: ![[allegati/foto.png]]\n",
        "col nome ambiguo si scrive il path intero, che è sempre univoco — la \
         stessa regola delle note"
    );
}
