//! Le prove della memoria d'esportazione: il riconoscimento dei blocchi, il
//! file, e la memoria che segue la nota col kernel vero (rinomina, cestino,
//! cancellazione).

use camino::Utf8PathBuf;
use fub_abi::edit::WriteBase;
use fub_abi::traits::{DataRead, DataWrite};
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{FormatRegistry, Workspace};
use fub_sdk::testing::MemoryHost;
use serde_json::json;

use super::super::SPAZIO_DATI;
use super::*;

/// Una nota fatta di blocchi: (sezione, contenuto).
struct Nota {
    blocchi: Vec<(Vec<String>, String)>,
}

impl Nota {
    fn new(blocchi: &[(&[&str], &str)]) -> Self {
        Self {
            blocchi: blocchi
                .iter()
                .map(|(sezione, contenuto)| {
                    (
                        sezione.iter().map(|s| s.to_string()).collect(),
                        contenuto.to_string(),
                    )
                })
                .collect(),
        }
    }

    fn vista(&self) -> Vec<BloccoNota<'_>> {
        self.blocchi
            .iter()
            .map(|(sezione, contenuto)| BloccoNota { sezione, contenuto })
            .collect()
    }
}

const DIAGRAMMA: &str = "```mermaid\nflowchart LR\n  A --> B\n```";

fn nota_di_prova() -> Nota {
    Nota::new(&[
        (&[], "Introduzione."),
        (&["Metodo"], "Un paragrafo."),
        (&["Metodo"], DIAGRAMMA),
        (&["Metodo", "Dettagli"], "Un paragrafo."),
        (&["Risultati"], "| a | b |\n|---|---|\n| 1 | 2 |"),
    ])
}

#[test]
fn l_impronta_non_guarda_i_capo_riga_ne_gli_spazi_in_fondo() {
    assert_eq!(impronta("a\nb"), impronta("a\r\nb  \n\n"));
    assert_eq!(impronta("a\nb"), impronta("\n\na\nb"));
    assert_ne!(impronta("a\nb"), impronta("a\n b"));
    assert_eq!(impronta("x").len(), 64);
}

#[test]
fn un_blocco_lasciato_fuori_si_riconosce_da_sezione_e_contenuto() {
    let nota = nota_di_prova();
    let mut memoria = MemoriaNota::default();
    assert!(memoria.lascia_fuori(&nota.vista(), 1));
    // Lo stesso testo in un'altra sezione è un altro blocco.
    assert!(memoria.e_fuori(&nota.vista(), 1));
    assert!(!memoria.e_fuori(&nota.vista(), 3));

    // Un blocco aggiunto prima non lo sposta: si riconosce ancora.
    let mut spostata = nota_di_prova();
    spostata
        .blocchi
        .insert(0, (vec![], "Una riga nuova in cima.".into()));
    assert!(memoria.e_fuori(&spostata.vista(), 2));
    assert_eq!(
        memoria.esclusioni(&spostata.vista())[0].riconoscimento,
        Riconoscimento::Vale { blocco: 2 }
    );

    // Lasciarlo fuori due volte non lo ripete; un indice fuori non fa niente.
    assert!(memoria.lascia_fuori(&nota.vista(), 1));
    assert!(!memoria.lascia_fuori(&nota.vista(), 99));
    assert_eq!(memoria.fuori.len(), 1);
}

#[test]
fn se_il_blocco_cambia_l_esclusione_non_vale_piu_e_lo_dice() {
    let nota = nota_di_prova();
    let mut memoria = MemoriaNota::default();
    memoria.lascia_fuori(&nota.vista(), 4);

    let mut cambiata = nota_di_prova();
    cambiata.blocchi[4].1 = "| a | b |\n|---|---|\n| 1 | 3 |".into();
    let esclusioni = memoria.esclusioni(&cambiata.vista());
    assert_eq!(esclusioni.len(), 1);
    assert_eq!(esclusioni[0].riconoscimento, Riconoscimento::NonVale);
    assert_eq!(esclusioni[0].voce.anteprima, "| a | b |");
    assert!(!memoria.e_fuori(&cambiata.vista(), 4));

    // Anche spostato in un'altra sezione non vale più: la sezione è parte di
    // come si riconosce.
    let mut spostata = nota_di_prova();
    spostata.blocchi[4].0 = vec!["Conclusioni".into()];
    assert_eq!(
        memoria.esclusioni(&spostata.vista())[0].riconoscimento,
        Riconoscimento::NonVale
    );

    // La lettura non dimentica niente: lo fa la persona.
    assert_eq!(memoria.fuori.len(), 1);
    memoria.dimentica_non_valide(&cambiata.vista());
    assert!(memoria.fuori.is_empty());
}

#[test]
fn due_blocchi_uguali_nella_stessa_sezione_si_distinguono() {
    let nota = Nota::new(&[
        (&["A"], "Ripetuto."),
        (&["A"], "Altro."),
        (&["A"], "Ripetuto."),
    ]);
    let mut memoria = MemoriaNota::default();
    memoria.lascia_fuori(&nota.vista(), 2);
    assert!(!memoria.e_fuori(&nota.vista(), 0));
    assert!(memoria.e_fuori(&nota.vista(), 2));

    // Tolto il primo dei due, il secondo diventa il primo: l'esclusione
    // della seconda occorrenza non vale più invece di cadere sull'altro.
    let tolto = Nota::new(&[(&["A"], "Altro."), (&["A"], "Ripetuto.")]);
    assert_eq!(
        memoria.esclusioni(&tolto.vista())[0].riconoscimento,
        Riconoscimento::NonVale
    );

    memoria.rimetti(&RiferimentoBlocco::di(&nota.vista(), 2).unwrap());
    assert!(memoria.fuori.is_empty());
}

#[test]
fn lo_stile_di_un_diagramma_vale_finche_il_diagramma_e_quello() {
    let nota = nota_di_prova();
    let mut memoria = MemoriaNota::default();
    assert!(memoria.imposta_stile(&nota.vista(), 2, StileDiagramma::new("lavagna")));
    assert_eq!(
        memoria.stile(&nota.vista(), 2).map(StileDiagramma::as_str),
        Some("lavagna")
    );
    assert_eq!(memoria.stile(&nota.vista(), 1), None);

    // Lo stesso diagramma con un altro stile sostituisce, non aggiunge.
    memoria.imposta_stile(&nota.vista(), 2, StileDiagramma::new(StileDiagramma::TEMA));
    assert_eq!(memoria.diagrammi.len(), 1);
    assert_eq!(
        memoria.stile(&nota.vista(), 2).map(StileDiagramma::as_str),
        Some("tema")
    );

    let mut cambiata = nota_di_prova();
    cambiata.blocchi[2].1 = DIAGRAMMA.replace("A --> B", "A --> C");
    assert_eq!(memoria.stile(&cambiata.vista(), 2), None);
    assert_eq!(
        memoria.stili(&cambiata.vista())[0].riconoscimento,
        Riconoscimento::NonVale
    );

    let blocco = memoria.diagrammi[0].blocco.clone();
    memoria.togli_stile(&blocco);
    assert!(memoria.vuota());
}

#[test]
fn una_nota_senza_memoria_ne_ha_una_vuota_e_una_memoria_vuota_non_lascia_file() {
    let mut host = MemoryHost::new();
    let nota = DocId::new("Progetti/Relazione.md");
    assert_eq!(leggi(&host, &nota).unwrap(), MemoriaNota::default());

    let vista = nota_di_prova();
    let mut memoria = MemoriaNota::default();
    memoria.lascia_fuori(&vista.vista(), 0);
    salva(&mut host, &nota, &memoria).unwrap();
    assert_eq!(
        percorso(&nota),
        "doc/Progetti%2FRelazione.md/esportazione-pdf.json"
    );
    assert!(host.data_read(&percorso(&nota)).unwrap().is_some());
    assert_eq!(leggi(&host, &nota).unwrap(), memoria);

    memoria.fuori.clear();
    salva(&mut host, &nota, &memoria).unwrap();
    assert!(host.data_read(&percorso(&nota)).unwrap().is_none());
}

#[test]
fn una_memoria_illeggibile_resta_finche_la_persona_non_ricomincia() {
    let mut host = MemoryHost::new();
    let nota = DocId::new("Nota.md");
    host.data_write(&percorso(&nota), b"[rotta").unwrap();

    assert!(matches!(
        leggi(&host, &nota),
        Err(ErroreMemoria::Illeggibile { .. })
    ));
    let errore = salva(&mut host, &nota, &MemoriaNota::default()).unwrap_err();
    assert!(matches!(errore, ErroreMemoria::Illeggibile { .. }));
    assert_eq!(
        host.data_read(&percorso(&nota)).unwrap().as_deref(),
        Some(&b"[rotta"[..])
    );

    ricomincia(&mut host, &nota).unwrap();
    assert_eq!(leggi(&host, &nota).unwrap(), MemoriaNota::default());
}

#[test]
fn una_memoria_futura_si_legge_conserva_il_resto_e_non_si_riscrive() {
    let mut host = MemoryHost::new();
    let nota = DocId::new("Nota.md");
    let futura = json!({
        "versione": 3,
        "fuori": [{ "sezione": ["A"], "impronta": impronta("x"), "occorrenza": 0, "colonna": 2 }],
        "diagrammi": [],
        "zoom": { "pagina": 4 }
    });
    host.data_write(&percorso(&nota), &serde_json::to_vec(&futura).unwrap())
        .unwrap();

    let memoria = leggi(&host, &nota).unwrap();
    assert!(memoria.futura());
    assert!(memoria.e_fuori(&Nota::new(&[(&["A"], "x")]).vista(), 0));
    let riscritta = serde_json::to_value(&memoria).unwrap();
    assert_eq!(riscritta["zoom"], futura["zoom"]);
    assert_eq!(riscritta["fuori"][0]["colonna"], json!(2));

    let prima = host.data_read(&percorso(&nota)).unwrap();
    assert!(matches!(
        salva(&mut host, &nota, &memoria),
        Err(ErroreMemoria::Futura { versione: 3 })
    ));
    assert!(matches!(
        salva(&mut host, &nota, &MemoriaNota::default()),
        Err(ErroreMemoria::Futura { versione: 3 })
    ));
    assert_eq!(host.data_read(&percorso(&nota)).unwrap(), prima);
}

#[test]
fn una_scrittura_che_fallisce_lascia_la_memoria_di_prima() {
    let mut host = MemoryHost::new();
    let nota = DocId::new("Nota.md");
    let vista = nota_di_prova();
    let mut memoria = MemoriaNota::default();
    memoria.lascia_fuori(&vista.vista(), 0);
    salva(&mut host, &nota, &memoria).unwrap();

    host.denies_write(&percorso(&nota));
    memoria.lascia_fuori(&vista.vista(), 1);
    let errore = salva(&mut host, &nota, &memoria).unwrap_err();
    assert!(
        matches!(errore, ErroreMemoria::Archivio { .. }),
        "{errore:?}"
    );
    assert_eq!(leggi(&host, &nota).unwrap().fuori.len(), 1);
}

#[test]
fn troppe_voci_non_si_scrivono_ne_si_leggono() {
    let mut host = MemoryHost::new();
    let nota = DocId::new("Nota.md");
    let voce = RiferimentoBlocco::di(&nota_di_prova().vista(), 0).unwrap();
    let memoria = MemoriaNota {
        fuori: vec![voce; MAX_VOCI + 1],
        ..MemoriaNota::default()
    };
    assert!(matches!(
        salva(&mut host, &nota, &memoria),
        Err(ErroreMemoria::TroppeVoci { .. })
    ));
    assert!(host.data_read(&percorso(&nota)).unwrap().is_none());
}

// --- col kernel vero: la memoria segue la nota ------------------------------

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
    ws: Workspace,
}

fn vault() -> Vault {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let mut registry = FormatRegistry::new();
    registry
        .register(MarkdownProvider::boxed())
        .expect("nessun conflitto di estensioni");
    let mut ws = Workspace::new(&root, registry).expect("l'apertura del vault riesce");
    ws.register_core_feature(SPAZIO_DATI, SPAZIO_DATI)
        .expect("dichiarato");
    ws.reindex().expect("reindex");
    Vault {
        _dir: dir,
        root,
        ws,
    }
}

impl Vault {
    fn nota(&mut self, id: &str) -> DocId {
        let doc = DocId::new(id);
        self.ws
            .write_document(&doc, "# Titolo\n\nUn paragrafo.\n", WriteBase::Dictated)
            .expect("scrittura");
        doc
    }

    fn salva(&mut self, nota: &DocId, memoria: &MemoriaNota) {
        self.ws
            .with_host(SPAZIO_DATI, |host| salva(host, nota, memoria))
            .expect("la memoria si salva");
    }

    fn leggi(&mut self, nota: &DocId) -> MemoriaNota {
        self.ws
            .with_host(SPAZIO_DATI, |host| leggi(host, nota))
            .expect("la memoria si legge")
    }

    /// Lo spazio dati autorevole dell'esportazione, sul disco.
    fn spazio(&self) -> Utf8PathBuf {
        self.root.join(".fub").join("plugins").join(SPAZIO_DATI)
    }

    fn file(&self, nota: &DocId) -> Utf8PathBuf {
        self.spazio().join(percorso(nota))
    }
}

fn una_memoria() -> MemoriaNota {
    let mut memoria = MemoriaNota::default();
    memoria.lascia_fuori(&nota_di_prova().vista(), 1);
    memoria.imposta_stile(&nota_di_prova().vista(), 2, StileDiagramma::new("lavagna"));
    memoria
}

#[test]
fn la_memoria_sta_nello_spazio_dati_e_la_nota_non_cambia() {
    let mut vault = vault();
    let nota = vault.nota("Relazione.md");
    let prima = std::fs::read(vault.root.join("Relazione.md")).unwrap();
    vault.salva(&nota, &una_memoria());

    assert!(vault.file(&nota).is_file(), "{}", vault.file(&nota));
    assert_eq!(
        std::fs::read(vault.root.join("Relazione.md")).unwrap(),
        prima
    );
    assert_eq!(vault.leggi(&nota), una_memoria());
}

#[test]
fn una_nota_rinominata_porta_con_se_la_memoria() {
    let mut vault = vault();
    let nota = vault.nota("Bozze/Relazione.md");
    vault.salva(&nota, &una_memoria());

    let nuova = DocId::new("Archivio/Relazione 2026.md");
    vault.ws.rename_document(&nota, &nuova).expect("rinomina");

    assert_eq!(vault.leggi(&nuova), una_memoria());
    assert_eq!(vault.leggi(&nota), MemoriaNota::default());
    assert!(!vault.file(&nota).exists());
}

#[test]
fn una_nota_cestinata_tiene_la_memoria_e_una_cancellata_la_perde() {
    let mut vault = vault();
    let nota = vault.nota("Relazione.md");
    vault.salva(&nota, &una_memoria());

    // Nel cestino la memoria non resta sotto il suo nome, che torna libero…
    vault.ws.delete_document(&nota).expect("cestina");
    assert_eq!(vault.leggi(&nota), MemoriaNota::default());
    // …e la nota che prende quel nome comincia senza memoria.
    let omonima = vault.nota("Relazione.md");
    assert_eq!(vault.leggi(&omonima), MemoriaNota::default());
    vault
        .ws
        .delete_document(&omonima)
        .expect("cestina l'omonima");

    // Cancellata per sempre (cestino svuotato), alla riapertura la memoria
    // se ne va con lei.
    let parcheggiate: Vec<_> = walk(&vault.spazio())
        .into_iter()
        .filter(|p| p.ends_with(NOME_MEMORIA))
        .collect();
    assert_eq!(
        parcheggiate.len(),
        1,
        "nel cestino la memoria è parcheggiata, non persa: {parcheggiate:?}"
    );
    vault.ws.empty_trash().expect("svuota");
    vault.ws.reindex().expect("riapertura");
    let rimasti: Vec<_> = walk(&vault.spazio());
    assert!(
        rimasti.iter().all(|p| !p.ends_with(NOME_MEMORIA)),
        "la memoria di una nota cancellata è rimasta: {rimasti:?}"
    );
}

#[test]
fn una_nota_ripristinata_ritrova_la_memoria() {
    let mut vault = vault();
    let nota = vault.nota("Relazione.md");
    vault.salva(&nota, &una_memoria());
    let nel_cestino = vault.ws.delete_document(&nota).expect("cestina");
    let tornata =
        fub_testkit::restore_document(&mut vault.ws, &nel_cestino, None).expect("ripristina");
    assert_eq!(vault.leggi(&tornata), una_memoria());
}

fn walk(dir: &Utf8PathBuf) -> Vec<String> {
    let mut out = Vec::new();
    let Ok(voci) = std::fs::read_dir(dir) else {
        return out;
    };
    for voce in voci.flatten() {
        let path = Utf8PathBuf::from_path_buf(voce.path()).expect("utf8");
        if path.is_dir() {
            out.extend(walk(&path));
        } else {
            out.push(path.to_string());
        }
    }
    out
}
