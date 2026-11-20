//! Le prove del profilo: il file, il tema e ciò che è tuo, i casi limite
//! della cartella (illeggibile, stesso nome, futuro, scrittura che fallisce).

use fub_abi::traits::{DataRead, DataWrite};
use fub_sdk::testing::MemoryHost;
use serde_json::json;

use super::*;

fn id(s: &str) -> IdProfilo {
    IdProfilo(s.to_owned())
}

fn scrivi_a_mano(host: &mut MemoryHost, nome_file: &str, valore: &serde_json::Value) {
    host.data_write(
        &format!("{CARTELLA_PROFILI}/{nome_file}"),
        &serde_json::to_vec_pretty(valore).unwrap(),
    )
    .unwrap();
}

#[test]
fn un_profilo_si_crea_si_rilegge_uguale_e_ha_un_file_col_suo_nome() {
    let mut host = MemoryHost::new();
    let mut profilo = Profilo::nuovo("Relazione per il Comune");
    profilo.cambia_tema(IdTema::new("relazione"));
    profilo.frontespizio.frontespizio = true;
    profilo.contenuto.proprieta = Proprieta::InEvidenza;

    let id = crea(&mut host, &profilo).unwrap();
    assert_eq!(id, IdProfilo("Relazione per il Comune".into()));
    assert!(host
        .data_read("profili/Relazione per il Comune.json")
        .unwrap()
        .is_some());
    assert_eq!(leggi(&host, &id).unwrap(), profilo);
}

#[test]
fn il_file_ha_la_versione_e_tiene_solo_cio_che_e_tuo() {
    let mut profilo = Profilo::nuovo("Bozza");
    profilo
        .imposta_colore(ChiaveColore::Accento, "#A4552A")
        .unwrap();
    profilo.testo.corpo = Some(10.5);
    let valore: serde_json::Value = serde_json::from_slice(&in_byte(&profilo)).unwrap();
    assert_eq!(valore["versione"], json!(VERSIONE_PROFILO));
    assert_eq!(valore["colori"], json!({ "accento": "#a4552a" }));
    // Nel testo c'è solo il corpo (tuo) e la sillabazione, che il tema non
    // decide: il resto lo decide il tema e non è scritto.
    assert_eq!(
        valore["testo"],
        json!({ "corpo": 10.5, "sillabazione": true })
    );
}

#[test]
fn i_byte_sono_sempre_gli_stessi_per_lo_stesso_profilo() {
    let profilo = Profilo::di_serie();
    assert_eq!(in_byte(&profilo), in_byte(&profilo.clone()));
    let riletto = da_byte(&id("x"), &in_byte(&profilo)).unwrap();
    assert_eq!(in_byte(&riletto), in_byte(&profilo));
}

#[test]
fn un_file_quasi_vuoto_vale_le_regolazioni_di_serie() {
    let profilo = da_byte(&id("x"), br#"{"versione":1,"nome":"Minimo"}"#).unwrap();
    let mut atteso = Profilo::nuovo("Minimo");
    atteso.nome = "Minimo".into();
    assert_eq!(profilo, atteso);
    assert!(profilo.testo.sillabazione);
    assert!(profilo.testata.filo);
    assert_eq!(profilo.pagina.margini, Margini::default());
}

#[test]
fn cambiando_tema_cio_che_e_tuo_resta_e_torna_al_tema_uno_per_uno_o_tutto() {
    let mut profilo = Profilo::di_serie();
    profilo
        .imposta_colore(ChiaveColore::Carta, "#fbf5e9")
        .unwrap();
    profilo
        .imposta_colore(ChiaveColore::DiagrammaNodi, "#fff")
        .unwrap();
    profilo.testo.carattere_testo = Some("palatino".into());
    assert_eq!(profilo.regolazioni_tue(), 3);

    profilo.cambia_tema(IdTema::new("quaderno"));
    assert_eq!(profilo.tema.as_str(), "quaderno");
    assert!(profilo.colore_e_tuo(&ChiaveColore::Carta));
    assert_eq!(
        profilo.colore_tuo(&ChiaveColore::DiagrammaNodi),
        Some(Rgb([255, 255, 255]))
    );
    assert!(profilo.testo.e_tua(ChiaveTesto::CarattereTesto));
    assert!(!profilo.testo.e_tua(ChiaveTesto::Corpo));

    profilo.colore_al_tema(&ChiaveColore::Carta);
    assert!(!profilo.colore_e_tuo(&ChiaveColore::Carta));
    assert_eq!(profilo.regolazioni_tue(), 2);

    profilo.tutto_al_tema();
    assert_eq!(profilo.regolazioni_tue(), 0);
    // Il tema scelto resta: «torna al tema» non cambia tema.
    assert_eq!(profilo.tema.as_str(), "quaderno");
}

#[test]
fn un_colore_scritto_male_non_entra_e_uno_nel_file_non_vale() {
    let mut profilo = Profilo::di_serie();
    let errore = profilo
        .imposta_colore(ChiaveColore::Testo, "verde")
        .unwrap_err();
    assert_eq!(errore.scritto, "verde");
    assert!(profilo.colori.is_empty());
    assert!(Rgb::leggi("#12345").is_none());
    assert!(Rgb::leggi("#ggg").is_none());
    assert_eq!(Rgb::leggi(" #1F4f8F ").unwrap().esadecimale(), "#1f4f8f");

    // Scritto male a mano nel file: il profilo si legge, il colore resta
    // com'è ma non vale, e «torna al tema» lo toglie.
    let mut profilo = da_byte(
        &id("x"),
        br#"{"versione":1,"nome":"A mano","colori":{"testo":"blu"}}"#,
    )
    .unwrap();
    assert!(profilo.colore_e_tuo(&ChiaveColore::Testo));
    assert_eq!(profilo.colore_tuo(&ChiaveColore::Testo), None);
    profilo.colore_al_tema(&ChiaveColore::Testo);
    assert!(profilo.colori.is_empty());
}

#[test]
fn un_profilo_illeggibile_resta_nell_elenco_e_non_si_sovrascrive() {
    let mut host = MemoryHost::new();
    host.data_write("profili/Rotto.json", b"{ non e json")
        .unwrap();
    host.data_write("profili/Sbagliato.json", br#"{"versione":"uno"}"#)
        .unwrap();
    crea(&mut host, &Profilo::nuovo("Buono")).unwrap();

    let voci = elenca(&host).unwrap();
    let ids: Vec<&str> = voci.iter().map(|v| v.id.as_str()).collect();
    assert_eq!(ids, ["Buono", "Rotto", "Sbagliato"]);
    assert!(voci[0].esito.is_ok());
    assert!(matches!(
        voci[1].esito,
        Err(ErroreProfilo::Illeggibile { .. })
    ));
    assert!(matches!(
        voci[2].esito,
        Err(ErroreProfilo::Illeggibile { .. })
    ));

    // Salvarci sopra non riesce, e il file resta com'era.
    let errore = salva(&mut host, &id("Rotto"), &Profilo::nuovo("Nuovo")).unwrap_err();
    assert!(matches!(errore, ErroreProfilo::Illeggibile { .. }));
    assert_eq!(
        host.data_read("profili/Rotto.json").unwrap().as_deref(),
        Some(&b"{ non e json"[..])
    );
    // E si può togliere, se è la persona a volerlo.
    elimina(&mut host, &id("Rotto")).unwrap();
    assert!(host.data_read("profili/Rotto.json").unwrap().is_none());
}

#[test]
fn un_file_troppo_grande_non_si_legge() {
    let mut host = MemoryHost::new();
    let grande = vec![b' '; MAX_PROFILO_BYTE + 1];
    host.data_write("profili/Grande.json", &grande).unwrap();
    assert!(matches!(
        leggi(&host, &id("Grande")),
        Err(ErroreProfilo::TroppoGrande { .. })
    ));
}

#[test]
fn due_profili_con_lo_stesso_nome_si_vedono_tutti_e_due_e_fub_non_ne_fa_altri() {
    let mut host = MemoryHost::new();
    let profilo = Profilo::nuovo("Relazione");
    let primo = crea(&mut host, &profilo).unwrap();
    // La copia a mano, col gestore dei file: stesso contenuto, altro file.
    let byte = host.data_read("profili/Relazione.json").unwrap().unwrap();
    host.data_write("profili/Relazione copia.json", &byte)
        .unwrap();

    let voci = elenca(&host).unwrap();
    assert_eq!(voci.len(), 2);
    assert!(voci.iter().all(|v| v.stesso_nome), "{voci:?}");

    // Creare o rinominare con un nome già usato non riesce, anche con le
    // maiuscole diverse.
    assert!(matches!(
        crea(&mut host, &Profilo::nuovo(" relazione ")),
        Err(ErroreProfilo::NomeGiaUsato { .. })
    ));
    crea(&mut host, &Profilo::nuovo("Bozza")).unwrap();
    assert!(matches!(
        rinomina(&mut host, &id("Bozza"), "RELAZIONE"),
        Err(ErroreProfilo::NomeGiaUsato { .. })
    ));

    // Rinominare la copia la distingue, e l'id (il file) resta.
    rinomina(&mut host, &id("Relazione copia"), "Relazione breve").unwrap();
    let voci = elenca(&host).unwrap();
    assert!(voci.iter().all(|v| !v.stesso_nome));
    assert_eq!(leggi(&host, &primo).unwrap().nome, "Relazione");
    assert_eq!(
        leggi(&host, &id("Relazione copia")).unwrap().nome,
        "Relazione breve"
    );
}

#[test]
fn salvare_lo_stesso_profilo_col_suo_nome_riesce() {
    let mut host = MemoryHost::new();
    let mut profilo = Profilo::nuovo("Relazione");
    let id = crea(&mut host, &profilo).unwrap();
    profilo.pagina.orizzontale = true;
    salva(&mut host, &id, &profilo).unwrap();
    assert!(leggi(&host, &id).unwrap().pagina.orizzontale);
}

#[test]
fn l_id_viene_dal_nome_e_non_esce_dalla_cartella() {
    let mut host = MemoryHost::new();
    let fuori = crea(&mut host, &Profilo::nuovo("../Fuori: sì/no?")).unwrap();
    assert!(fuori.valido(), "{fuori}");
    assert!(!fuori.as_str().contains('/'));
    assert!(!fuori.as_str().starts_with('.'));
    assert_eq!(leggi(&host, &fuori).unwrap().nome, "../Fuori: sì/no?");

    for cattivo in ["", "../x", "a/b", ".nascosto", "con:due"] {
        assert!(
            matches!(
                leggi(&host, &id(cattivo)),
                Err(ErroreProfilo::IdNonValido { .. })
            ),
            "{cattivo}"
        );
    }

    // Un nome già preso come file, con un nome diverso dentro: l'id prende un
    // numero.
    host.data_write(
        "profili/Bozza.json",
        &in_byte(&Profilo::nuovo("Un altro nome")),
    )
    .unwrap();
    let bozza = crea(&mut host, &Profilo::nuovo("Bozza")).unwrap();
    assert_eq!(bozza.as_str(), "Bozza 2");
}

#[test]
fn nomi_vuoti_o_troppo_lunghi_non_entrano() {
    let mut host = MemoryHost::new();
    assert_eq!(
        crea(&mut host, &Profilo::nuovo("   ")),
        Err(ErroreProfilo::NomeVuoto)
    );
    let lungo = "x".repeat(MAX_NOME + 1);
    assert_eq!(
        crea(&mut host, &Profilo::nuovo(lungo)),
        Err(ErroreProfilo::NomeTroppoLungo)
    );
}

#[test]
fn un_profilo_futuro_conserva_i_campi_sconosciuti() {
    let mut host = MemoryHost::new();
    let futuro = json!({
        "versione": 7,
        "nome": "Dal futuro",
        "tema": "galassia",
        "rilegatura": { "lato": "sinistro", "mm": 8 },
        "colori": { "accento": "#c8371f", "aurora": "#00ff88" },
        "pagina": {
            "formato": "B5",
            "orizzontale": true,
            "margini": { "sopra": 20, "destra": 20, "sotto": 20, "sinistra": 20, "rilegatura": 6 },
            "piega": "a-tre"
        },
        "testata": {
            "posti": { "sopra-destra": { "voce": "luna", "fase": "piena" }, "angolo": { "voce": "titolo" } }
        },
        "contenuto": { "commenti": "a-fumetto", "codice_numerato": true },
        "uscita": { "immagini": "vettoriali", "pdfua": true }
    });
    scrivi_a_mano(&mut host, "Dal futuro.json", &futuro);

    // Si legge per ciò che si conosce.
    let profilo = leggi(&host, &id("Dal futuro")).unwrap();
    assert!(profilo.futuro());
    assert_eq!(profilo.nome, "Dal futuro");
    assert!(!profilo.tema.conosciuto());
    assert!(profilo.pagina.orizzontale);
    assert_eq!(profilo.pagina.formato, Formato::Altro("B5".into()));
    assert!(!profilo.pagina.formato.conosciuta());
    assert_eq!(profilo.pagina.margini.sopra, 20.0);
    assert!(profilo.contenuto.codice_numerato);
    assert_eq!(
        profilo.contenuto.commenti,
        Commenti::Altro("a-fumetto".into())
    );
    assert_eq!(
        profilo.colore_tuo(&ChiaveColore::Accento),
        Some(Rgb([0xc8, 0x37, 0x1f]))
    );
    let mut sconosciute = profilo.chiavi_sconosciute();
    sconosciute.sort();
    assert_eq!(
        sconosciute,
        [
            "pagina.margini.rilegatura",
            "pagina.piega",
            "rilegatura",
            "testata.posti.sopra-destra.fase",
            "uscita.pdfua",
        ]
    );

    // Il resto si conserva: riscritto, ogni campo sconosciuto torna com'era.
    let riscritto: serde_json::Value = serde_json::from_slice(&in_byte(&profilo)).unwrap();
    for puntatore in [
        "/versione",
        "/tema",
        "/rilegatura",
        "/colori/aurora",
        "/pagina/formato",
        "/pagina/piega",
        "/pagina/margini/rilegatura",
        "/testata/posti/sopra-destra",
        "/testata/posti/angolo",
        "/contenuto/commenti",
        "/uscita/immagini",
        "/uscita/pdfua",
    ] {
        assert_eq!(
            riscritto.pointer(puntatore),
            futuro.pointer(puntatore),
            "{puntatore}"
        );
    }

    // E il suo file non si riscrive.
    let prima = host.data_read("profili/Dal futuro.json").unwrap();
    assert!(matches!(
        salva(&mut host, &id("Dal futuro"), &profilo),
        Err(ErroreProfilo::Futuro { versione: 7, .. })
    ));
    let mut di_oggi = profilo.clone();
    di_oggi.versione = VERSIONE_PROFILO;
    assert!(matches!(
        salva(&mut host, &id("Dal futuro"), &di_oggi),
        Err(ErroreProfilo::Futuro { versione: 7, .. })
    ));
    assert!(matches!(
        rinomina(&mut host, &id("Dal futuro"), "Altro nome"),
        Err(ErroreProfilo::Futuro { .. })
    ));
    assert_eq!(host.data_read("profili/Dal futuro.json").unwrap(), prima);

    // Chi vuole cambiarlo ne fa una copia, che porta tutto con sé.
    let copia_id = copia(&mut host, &id("Dal futuro"), "Copia del futuro").unwrap();
    let copia_letta: serde_json::Value = serde_json::from_slice(
        &host
            .data_read(&format!("profili/{copia_id}.json"))
            .unwrap()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(copia_letta["nome"], json!("Copia del futuro"));
    assert_eq!(copia_letta["rilegatura"], futuro["rilegatura"]);
    assert_eq!(copia_letta["pagina"]["piega"], futuro["pagina"]["piega"]);
}

#[test]
fn una_versione_1_con_campi_nuovi_li_conserva_anche_salvando() {
    // Un Fub più nuovo può aggiungere un campo senza cambiare versione:
    // questa versione lo riscrive com'era quando salva le sue modifiche.
    let mut host = MemoryHost::new();
    scrivi_a_mano(
        &mut host,
        "Nuovo campo.json",
        &json!({
            "versione": 1,
            "nome": "Nuovo campo",
            "diagrammi": { "stile": "lavagna", "ombre": true },
            "segno": "x"
        }),
    );
    let mut profilo = leggi(&host, &id("Nuovo campo")).unwrap();
    assert_eq!(profilo.diagrammi.stile.as_str(), "lavagna");
    profilo.diagrammi.fondo = false;
    salva(&mut host, &id("Nuovo campo"), &profilo).unwrap();

    let riletto: serde_json::Value =
        serde_json::from_slice(&host.data_read("profili/Nuovo campo.json").unwrap().unwrap())
            .unwrap();
    assert_eq!(riletto["diagrammi"]["ombre"], json!(true));
    assert_eq!(riletto["diagrammi"]["fondo"], json!(false));
    assert_eq!(riletto["segno"], json!("x"));
}

#[test]
fn una_scrittura_che_fallisce_lascia_il_profilo_di_prima() {
    let mut host = MemoryHost::new();
    let mut profilo = Profilo::nuovo("Relazione");
    let id = crea(&mut host, &profilo).unwrap();
    let prima = host.data_read("profili/Relazione.json").unwrap();

    host.denies_write("profili/Relazione.json");
    profilo.pagina.specchio = true;
    let errore = salva(&mut host, &id, &profilo).unwrap_err();
    assert!(
        matches!(errore, ErroreProfilo::Archivio { .. }),
        "{errore:?}"
    );
    assert_eq!(host.data_read("profili/Relazione.json").unwrap(), prima);
    assert!(!leggi(&host, &id).unwrap().pagina.specchio);

    // Anche la rinomina, che riscrive lo stesso file.
    assert!(rinomina(&mut host, &id, "Altra").is_err());
    assert_eq!(leggi(&host, &id).unwrap().nome, "Relazione");
}

#[test]
fn un_profilo_che_non_c_e_lo_dice() {
    let mut host = MemoryHost::new();
    assert_eq!(
        leggi(&host, &id("Assente")),
        Err(ErroreProfilo::NonTrovato { id: id("Assente") })
    );
    assert!(matches!(
        copia(&mut host, &id("Assente"), "X"),
        Err(ErroreProfilo::NonTrovato { .. })
    ));
    // Togliere ciò che non c'è riesce.
    elimina(&mut host, &id("Assente")).unwrap();
}

#[test]
fn l_elenco_guarda_solo_i_json_della_cartella() {
    let mut host = MemoryHost::new();
    crea(&mut host, &Profilo::nuovo("Uno")).unwrap();
    host.data_write("profili/leggimi.txt", b"x").unwrap();
    host.data_write("profili/vecchi/Due.json", &in_byte(&Profilo::nuovo("Due")))
        .unwrap();
    host.data_write("altro/Tre.json", &in_byte(&Profilo::nuovo("Tre")))
        .unwrap();
    let voci = elenca(&host).unwrap();
    let ids: Vec<&str> = voci.iter().map(|v| v.id.as_str()).collect();
    assert_eq!(ids, ["Uno"]);
}

#[test]
fn le_scelte_aperte_conoscono_i_loro_valori() {
    for formato in Formato::CONOSCIUTI {
        assert_eq!(&Formato::da_testo(formato.come_testo()), formato);
        assert!(formato.conosciuta());
    }
    assert_eq!(VoceTestata::default(), VoceTestata::Niente);
    assert_eq!(ChiaveColore::CONOSCIUTI.len(), 15);
    assert_eq!(IdTema::DI_FUB.len(), 8);
    assert!(IdTema::default().conosciuto());
}
