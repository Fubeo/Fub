//! Test della domanda che mancava (§14.2): cosa è cambiato fra un'apertura
//! e l'altra, revisioni, indice mancante o corrotto.

use super::*;

// --- la domanda che mancava (§14.2) ------------------------------------

/// Una voce d'anagrafe come la costruisce il kernel: la specie, e
/// l'impronta del **sorgente** se qualcuno ne ha già avuto i byte in mano.
fn entry(id: &str, source: Option<&str>) -> VaultEntry {
    VaultEntry {
        id: DocId::new(id),
        kind: EntryKind::Document,
        size: 0,
        mtime: 0,
        fingerprint: source.map(Revision::of),
    }
}

/// Il giro dell'apertura come lo fa il kernel: prima si chiede cosa c'è
/// già, poi si consegna ciò che non c'era.
fn round(idx: &mut SearchIndex, vault: &[(&str, &str)]) -> Vec<String> {
    let entries: Vec<VaultEntry> = vault
        .iter()
        .map(|(id, source)| entry(id, Some(source)))
        .collect();
    let already = idx.up_to_date(&entries);
    for (id, source) in vault {
        if already.iter().any(|d| d.as_str() == *id) {
            continue;
        }
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc(id, source)));
    }
    already.iter().map(|d| d.to_string()).collect()
}

#[test]
fn to_the_first_opening_not_exists_nothing_of_already_a_place() {
    let (_g, path) = tmp();
    let (idx, _host) = fresh(&path);
    assert!(
        idx.up_to_date(&[entry("a.md", Some("contenuto"))])
            .is_empty(),
        "an empty index asks for everything, which is the safe direction to err in"
    );
}

#[test]
fn to_the_reopening_is_recognizes_that_that_not_and_changed() {
    let (_g, path) = tmp();
    let mut host = MemoryHost::new();
    let vault = [("a.md", "il gatto"), ("b.md", "il cane")];
    {
        let mut idx = open(&path, &mut host);
        assert!(
            round(&mut idx, &vault).is_empty(),
            "the first round knows nothing"
        );
        idx.flush(&mut host).unwrap();
    }

    // Le impronte dei sorgenti sono nel manifest, accanto a quelle dei
    // modelli: sono due informazioni diverse, e fra le due c'è un parser.
    let manifest = manifest_of(&host);
    assert_eq!(manifest.sources.len(), 2);
    assert_eq!(
        manifest.sources.get("a.md"),
        Some(&Revision::of("il gatto").0)
    );

    let mut idx = open(&path, &mut host);
    let mut already = round(&mut idx, &vault);
    already.sort();
    assert_eq!(
        already,
        ["a.md", "b.md"],
        "and on reopen it answers WITHOUT anyone having opened a file"
    );
    assert_eq!(
        search(&idx, "gatto").len(),
        1,
        "and the index is still the same one"
    );
}

#[test]
fn a_slice_not_cancels_the_declarations_of_that_first() {
    // **Il giro dell'apertura come lo fa il kernel su un vault grande**: la
    // domanda arriva per fetta (`Workspace::plan_batch`), e fra la domanda e
    // la consegna il prestito passa di mano — dalla 0119 pianificare e
    // applicare sono due chiamate pubbliche distinte, che un chiamante può
    // sovrapporre. Qui le due domande stanno prima delle due consegne, che è
    // l'ordine peggiore fra quelli che il contratto permette.
    //
    // Prima che questa riga esistesse `up_to_date` faceva `clear()` in
    // testa: la seconda domanda si portava via la dichiarazione della prima,
    // `a.md` finiva nell'indice senza la revisione del suo sorgente, e alla
    // riapertura lo si rileggeva pur non essendo cambiato — a ogni apertura,
    // per sempre, in silenzio.
    let (_g, path) = tmp();
    let mut host = MemoryHost::new();
    let vault = [("a.md", "il gatto"), ("b.md", "il cane")];
    {
        let mut idx = open(&path, &mut host);
        for (id, source) in vault {
            assert!(
                idx.up_to_date(&[entry(id, Some(source))]).is_empty(),
                "the first round knows nothing"
            );
        }
        for (id, source) in vault {
            let _ = idx.on_documents_indexed(std::slice::from_ref(&doc(id, source)));
        }
        idx.flush(&mut host).unwrap();
    }

    assert_eq!(
        manifest_of(&host).sources.len(),
        2,
        "source revisions are two as many as the slices: the first's wasn't \
             cancelled by the second's question"
    );

    let idx = open(&path, &mut host);
    let mut already: Vec<String> = idx
        .up_to_date(&[
            entry("a.md", Some("il gatto")),
            entry("b.md", Some("il cane")),
        ])
        .iter()
        .map(|d| d.to_string())
        .collect();
    already.sort();
    assert_eq!(
        already,
        ["a.md", "b.md"],
        "and on reopen neither needs re-reading"
    );
}

#[test]
fn that_that_and_changed_ad_app_closed_not_results_a_place() {
    let (_g, path) = tmp();
    let mut host = MemoryHost::new();
    {
        let mut idx = open(&path, &mut host);
        round(&mut idx, &[("a.md", "il gatto"), ("b.md", "il cane")]);
        idx.flush(&mut host).unwrap();
    }

    let mut idx = open(&path, &mut host);
    let already = round(&mut idx, &[("a.md", "il gatto"), ("b.md", "il criceto")]);
    assert_eq!(already, ["a.md"], "only the one with the same fingerprint");
    assert_eq!(
        search(&idx, "criceto").len(),
        1,
        "e l'altro è stato riletto"
    );
    assert_eq!(search(&idx, "cane").len(), 0);
}

#[test]
fn without_fingerprint_declared_not_is_responds() {
    // Il kernel non calcola l'impronta di ciò che non deve leggere: chi non
    // sa di che revisione è un file non può sapere se è la sua.
    let (_g, path) = tmp();
    let mut host = MemoryHost::new();
    {
        let mut idx = open(&path, &mut host);
        round(&mut idx, &[("a.md", "il gatto")]);
        idx.flush(&mut host).unwrap();
    }
    let idx = open(&path, &mut host);
    assert!(idx.up_to_date(&[entry("a.md", None)]).is_empty());
    // E ciò che non è un documento non è affar suo, per quanta impronta
    // porti: il kernel oggi manda solo documenti, ma leggerlo più stretto di
    // com'è scritto sarebbe un'assunzione, non una lettura.
    let mut attachment = entry("a.md", Some("il gatto"));
    attachment.kind = EntryKind::Asset;
    assert!(idx.up_to_date(&[attachment]).is_empty());
}

#[test]
fn a_manifest_of_a_other_era_is_carries_via_also_the_fingerprints_of_the_sources() {
    let (_g, path) = tmp();
    let mut host = MemoryHost::new();
    {
        let mut idx = open(&path, &mut host);
        round(&mut idx, &[("a.md", "il gatto")]);
        idx.flush(&mut host).unwrap();
    }
    let mut m = manifest_of(&host);
    m.opstamp += 1;
    put_manifest(&mut host, &m);

    let idx = open(&path, &mut host);
    assert!(
        idx.up_to_date(&[entry("a.md", Some("il gatto"))])
            .is_empty(),
        "il guardiano è uno solo: se il manifest è di un'altra epoca non se ne \
             crede nessuna parte — dire «ce l'ho» a sproposito farebbe SALTARE un \
             documento, cioè mentire in silenzio"
    );
}

#[test]
fn a_write_a_session_open_not_inherits_the_revision_of_first() {
    // Il caso in cui la mappa mentirebbe: alla riapertura il kernel dichiara
    // le revisioni di *adesso*, poi l'utente salva, e l'indice riceve un
    // documento nuovo senza che nessuno gli abbia detto di che revisione è.
    // Tenere quella dichiarata all'avvio vorrebbe dire attribuire al testo di
    // adesso la revisione del testo di allora — e alla riapertura saltare un
    // documento modificato.
    let (_g, path) = tmp();
    let mut host = MemoryHost::new();
    {
        let mut idx = open(&path, &mut host);
        round(&mut idx, &[("a.md", "il gatto")]);
        idx.flush(&mut host).unwrap();
    }
    {
        let mut idx = open(&path, &mut host);
        round(&mut idx, &[("a.md", "il gatto")]);
        // Salvataggio a sessione aperta: nessuna domanda prima.
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "il cane")));
        idx.close(&mut host).unwrap();
    }
    assert!(
        !manifest_of(&host).sources.contains_key("a.md"),
        "nessuna dichiarazione = nessuna promessa: alla prossima apertura lo si rilegge"
    );

    let idx = open(&path, &mut host);
    assert!(idx.up_to_date(&[entry("a.md", Some("il cane"))]).is_empty());
}

#[test]
fn a_document_exited_from_the_vault_not_leaves_a_revision_behind() {
    let (_g, path) = tmp();
    let mut host = MemoryHost::new();
    let mut idx = open(&path, &mut host);
    round(&mut idx, &[("a.md", "il gatto"), ("b.md", "il cane")]);

    let _ = idx.on_documents_removed(std::slice::from_ref(&DocId::new("a.md")));
    let _ = idx.reconcile(&[DocId::new("b.md")]);
    idx.flush(&mut host).unwrap();
    assert_eq!(
        manifest_of(&host).sources.keys().collect::<Vec<_>>(),
        ["b.md"],
        "una revisione senza il documento dietro è una risposta sbagliata che \
             aspetta di essere data"
    );
}

#[test]
fn a_edit_that_not_changes_the_model_updates_the_same_the_revision() {
    // Due sorgenti diversi che danno lo stesso modello: succede davvero —
    // una riga di frontmatter che nessuno indicizza, uno spazio in fondo.
    // Se la revisione non si aggiornasse, quel documento risulterebbe
    // «cambiato» a ogni apertura, per sempre.
    let (_g, path) = tmp();
    let mut host = MemoryHost::new();
    let mut idx = open(&path, &mut host);
    idx.up_to_date(&[entry("a.md", Some("prima"))]);
    let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "testo identico")));
    idx.up_to_date(&[entry("a.md", Some("dopo"))]);
    let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "testo identico")));
    idx.flush(&mut host).unwrap();

    assert_eq!(
        manifest_of(&host).sources.get("a.md"),
        Some(&Revision::of("dopo").0)
    );
}

#[test]
fn a_missing_manifest_is_not_an_error() {
    // Il primo avvio, e ogni avvio dopo un manifest perso: non si fallisce,
    // si reindicizza. Un'attivazione che fallisse per questo impedirebbe la
    // ricerca per un file che il vault non ha nemmeno bisogno di avere.
    let (_g, path) = tmp();
    let mut host = MemoryHost::new();
    let mut idx = SearchIndex::open_dir(&path).unwrap();
    assert!(idx.activate(&mut host).is_ok());
    assert!(idx.is_empty());
}

#[test]
fn a_corrupt_index_is_rebuilt_not_diagnosed() {
    let (_g, path) = tmp();
    let mut host = MemoryHost::new();
    {
        let mut idx = open(&path, &mut host);
        let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "contenuto")));
        idx.flush(&mut host).unwrap();
    }
    std::fs::write(path.join("meta.json"), b"non sono json").unwrap();

    let mut idx = open(&path, &mut host);
    assert_eq!(idx.len(), 0);
    let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "contenuto")));
    assert_eq!(search(&idx, "contenuto").len(), 1);
}

/// **Non esiste più una query malformata.** Prima `campo:valore` andava nel
/// parser di tantivy e un campo sconosciuto era un `BadArgs` che la shell
/// mostrava come «Query incompleta»: la sintassi di ricerca dell'utente era
/// quella di una dipendenza. Adesso quella stringa è ciò che sembra — dei
/// termini — e la risposta è un elenco, eventualmente vuoto.
#[test]
fn what_used_to_be_a_syntax_error_is_now_just_terms() {
    let (_g, path) = tmp();
    let (mut idx, _host) = fresh(&path);
    let _ = idx.on_documents_indexed(std::slice::from_ref(&doc(
        "a.md",
        "qui c'è scritto campo_inesistente:valore",
    )));
    let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("b.md", "qui no")));

    let hits = search(&idx, "campo_inesistente:valore");
    assert_eq!(
        hits.len(),
        1,
        "i due token sono termini, e il documento che li contiene combacia"
    );
    assert_eq!(hits[0].doc, DocId::new("a.md"));
}

#[test]
fn empty_query_returns_nothing() {
    let (_g, path) = tmp();
    let (mut idx, _host) = fresh(&path);
    let _ = idx.on_documents_indexed(std::slice::from_ref(&doc("a.md", "qualcosa")));
    assert!(search(&idx, "   ").is_empty());
}
