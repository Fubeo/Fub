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
use fub_abi::model::DocId;
use fub_abi::traits::{EntryKind, HealthCheck, IndexQuery, IndexResult};
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{FormatRegistry, Workspace};

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
    let mut ws = Workspace::new(&root, registry).expect("l'apertura del vault riesce");
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
        .map(|the| (the.doc.to_string(), the.detail.clone()))
        .collect()
}

#[test]
fn a_missing_attachment_is_a_broken_link_and_one_that_exists_is_not() {
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
fn moving_an_attachment_brings_along_what_references_it() {
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
            within: None,
            page: None,
        })
        .expect("il kernel serve l'anagrafe")
    else {
        panic!("attesa l'anagrafe");
    };
    let ids: Vec<String> = page.items.iter().map(|and| and.id.to_string()).collect();
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
fn a_wikilink_to_a_same_name_attachment_takes_the_full_path() {
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

/// **Il verso opposto, e non è simmetrico** (difetto 0059).
///
/// Rinominando una *nota*, `link_rewrite_plan` cerca gli omonimi del nome
/// d'arrivo in `metas` — i documenti — e **non** nell'anagrafe. Letto di fianco
/// al banco qui sopra, che invece cammina `entries`, sembra una svista: un
/// allegato omonimo «sfugge» al controllo. La 0059 diceva esattamente questo, e
/// **è falsa**; questo banco tiene ferma la metà falsa, perché la simmetria è
/// una lettura troppo facile e qualcuno la «riparerà» di nuovo.
///
/// Il motivo è che **ogni piano cerca l'omonimia nel registro che il proprio
/// risolutore legge**, e i due risolutori sono due:
///
/// - un wikilink verso un allegato passa dai nomi dell'anagrafe, che portano il
///   nome del file **con la sua estensione** — `![[foto.png]]`, mai `[[foto]]`.
///   Quindi un allegato non contende mai un *nome pagina*, che l'estensione non
///   ce l'ha: `foto.png` e `foto` non si somigliano nemmeno;
/// - e dove i due nomi coincidono davvero — un file **senza** estensione, come
///   il `LICENSE` qui sotto — decide l'ordine: chi risolve prova il grafo, cioè
///   i documenti, e solo se lì non trova niente ripiega sull'anagrafe
///   (`rules::health::broken_target`). Un allegato non può togliere un nome a
///   una nota perché non arriva mai al proprio turno.
///
/// Allargare la ricerca a `entries` non riparerebbe niente e costerebbe: la nota
/// finirebbe nominata `[[Legale/LICENSE]]` dentro i documenti di terzi, cioè il
/// path intero al posto del nome, per un'ambiguità che non c'è.
///
/// **La destinazione sta in una sottocartella apposta.** Sostituendo `metas` con
/// `entries` in `link_rewrite_plan` questo banco diventa rosso — `Vedi
/// [[Legale/LICENSE]]` invece di `Vedi [[LICENSE]]` — ed è la prova che serve:
/// non presidia il codice com'è, presidia il codice contro la riparazione che la
/// riga proponeva. Rinominando invece nella **radice** sarebbe verde anche con
/// quella riparazione applicata (misurato), perché lì `strip_ext(path)` e il nome
/// pagina sono la stessa stringa e la seconda forma non si distingue dalla
/// prima: un presidio non rosso *per come è montato*, non perché la proprietà
/// tenga.
#[test]
fn an_attachment_does_not_contend_a_notes_page_name() {
    let (_g, mut ws) = vault();
    let root = ws.root().to_owned();
    // Un file senza estensione: è il solo caso in cui il nome di un allegato e
    // il nome pagina di una nota possono essere la stessa stringa.
    std::fs::write(root.join("LICENSE"), "MIT").unwrap();
    std::fs::write(root.join("bozza.md"), "# Bozza\n").unwrap();
    std::fs::write(root.join("Indice.md"), "Vedi [[bozza]]\n").unwrap();
    std::fs::create_dir_all(root.join("Legale")).unwrap();
    ws.reindex().expect("reindex");

    ws.rename_document(&DocId::new("bozza.md"), &DocId::new("Legale/LICENSE.md"))
        .expect("la nota si rinomina");

    assert_eq!(
        ws.read_source(&DocId::new("Indice.md")).unwrap(),
        "Vedi [[LICENSE]]\n",
        "il nome basta: l'omonimo è un allegato, e un allegato non si nomina \
         senza estensione. Cercando l'omonimia in `entries` qui ci sarebbe \
         `[[Legale/LICENSE]]`"
    );
    assert_eq!(
        ws.resolve_link("LICENSE"),
        Some(DocId::new("Legale/LICENSE.md")),
        "ed è il nome che riporta alla nota, non al file omonimo: fra i due \
         risolutori il grafo va per primo"
    );
    assert_eq!(
        broken(&ws),
        [("Assente.md".to_string(), Some("manca.png".to_string()))],
        "nessun link nuovo è rotto — il solo rotto è quello che lo era già"
    );
}
