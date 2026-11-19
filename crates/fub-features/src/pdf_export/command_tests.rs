//! Le prove dell'esportazione come comando e dei comandi dei profili, sul
//! doppio dell'host: la presenza della shell, la scelta del profilo (nominato,
//! per tipo, del vault, di serie), i casi limite e i predefiniti. Il viaggio
//! vero dell'evento fino alla shell lo prova `fub-host/tests/pdf_export_command.rs`.

use fub_abi::traits::DataRead;
use fub_sdk::testing::MemoryHost;
use serde_json::json;

use super::*;
use crate::note_types::{vault, LIBRO};

/// Un fornitore senza comandi: il comando si compone sopra qualsiasi altro.
struct Vuoto;

impl CommandProvider for Vuoto {
    fn commands(&self) -> Vec<CommandSpec> {
        Vec::new()
    }

    fn invoke(
        &self,
        command: &str,
        _args: Value,
        _mode: InvokeMode,
        _host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        Err(PluginError::UnknownCommand(command.into()))
    }
}

fn fornitore() -> ConIlComando<Vuoto> {
    ConIlComando::new(Vuoto)
}

/// Un vault con un tipo, una nota di quel tipo e una nota senza tipo.
fn vault_con_tipo() -> MemoryHost {
    vault(&[
        ("Tipi/Libro.md", LIBRO),
        (
            "Dune.md",
            "---\ntipo: \"[[Tipi/Libro]]\"\n---\n# Dune\n\nTesto.\n",
        ),
        ("Diario.md", "# Diario\n\nTesto.\n"),
    ])
}

fn invoca(
    p: &ConIlComando<Vuoto>,
    host: &mut MemoryHost,
    command: &str,
    args: Value,
) -> Result<CommandOutcome, PluginError> {
    p.invoke(command, args, InvokeMode::Apply, host)
}

fn ascolta(p: &ConIlComando<Vuoto>, host: &mut MemoryHost) {
    invoca(p, host, PDF_EXPORT_LISTEN, json!({})).expect("la shell si annuncia");
}

fn crea(host: &mut MemoryHost, nome: &str) -> IdProfilo {
    let mut profilo = Profilo::nuovo(nome);
    profilo.pagina = Default::default();
    profile::crea(host, &profilo).expect("il profilo si crea")
}

fn effetto(esito: &CommandOutcome) -> (&str, &Value) {
    match &esito.effect {
        CommandEffect::Custom { ns, payload } => (ns.as_str(), payload),
        altro => panic!("un effetto coi dati: {altro:?}"),
    }
}

fn chiave(e: &PluginError) -> String {
    let testo = match e {
        PluginError::BadArgs(t)
        | PluginError::AlreadyExists(t)
        | PluginError::NotFound(t)
        | PluginError::Conflict(t)
        | PluginError::Unserved(t) => t,
        altro => panic!("{altro:?}"),
    };
    serde_json::to_value(testo).unwrap()["key"]
        .as_str()
        .unwrap_or_default()
        .to_owned()
}

#[test]
fn pdf_export_le_spec_ci_sono_tutte_e_la_nota_e_richiesta() {
    let specs = fornitore().commands();
    let ids: Vec<&str> = specs.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(
        ids,
        [
            PDF_EXPORT_NOTE,
            PDF_EXPORT_LISTEN,
            PDF_PROFILES,
            PDF_PROFILE_SAVE,
            PDF_PROFILE_COPY,
            PDF_PROFILE_RENAME,
            PDF_PROFILE_DEFAULT
        ]
    );
    let esporta = &specs[0];
    let richiesti: Vec<&str> = esporta
        .params
        .iter()
        .filter(|p| p.required)
        .map(|p| p.name.as_str())
        .collect();
    assert_eq!(richiesti, [P_NOTE]);
}

#[test]
fn pdf_export_le_stringhe_ci_sono_in_tutte_e_due_le_lingue() {
    let it = in_italian(StringCatalog::new("it"));
    let en = in_english(StringCatalog::new("en"));
    assert_eq!(it.entries.len(), en.entries.len());
    assert!(it.entries.contains_key(E_NEEDS_APP));
    assert!(en.entries.contains_key(E_NEEDS_APP));
    for chiave in it.entries.keys() {
        assert!(
            en.entries.contains_key(chiave),
            "manca in inglese: {chiave}"
        );
    }
}

#[test]
fn pdf_export_senza_l_app_aperta_l_errore_chiede_l_app() {
    let p = fornitore();
    let mut host = vault_con_tipo();
    let errore = invoca(
        &p,
        &mut host,
        PDF_EXPORT_NOTE,
        json!({ "note": "Diario.md" }),
    )
    .expect_err("nessuno impagina");
    assert!(matches!(errore, PluginError::Unserved(_)), "{errore:?}");
    assert_eq!(chiave(&errore), E_NEEDS_APP);
    // Nemmeno la prova promette un'esportazione che nessuno farà.
    let errore = p
        .invoke(
            PDF_EXPORT_NOTE,
            json!({ "note": "Diario.md" }),
            InvokeMode::DryRun,
            &mut host,
        )
        .expect_err("nessuno impagina");
    assert!(matches!(errore, PluginError::Unserved(_)));
}

#[test]
fn pdf_export_con_l_app_aperta_la_richiesta_parte_e_dice_il_profilo() {
    let p = fornitore();
    let mut host = vault_con_tipo();
    ascolta(&p, &mut host);
    let esito = invoca(
        &p,
        &mut host,
        PDF_EXPORT_NOTE,
        json!({ "note": "Diario.md" }),
    )
    .expect("la richiesta parte");
    assert!(esito.notify.is_some(), "chi chiede sa che il PDF arriverà");
    let (ns, dati) = effetto(&esito);
    assert_eq!(ns, NS_RICHIESTA);
    assert_eq!(dati["note"], "Diario.md");
    assert_eq!(dati["target"], "Diario.pdf");
    assert_eq!(dati["profile"]["id"], "");
    assert_eq!(dati["profile"]["name"], NOME_DI_SERIE);
    assert_eq!(dati["profile"]["from"], "default");
    assert!(!dati["request"].as_str().unwrap().is_empty());
}

#[test]
fn pdf_export_la_presenza_scade_se_la_shell_non_la_rinnova() {
    let p = fornitore();
    let mut host = vault_con_tipo();
    ascolta(&p, &mut host);
    host.advance(TTL_PRESENZA_MS - 1);
    invoca(
        &p,
        &mut host,
        PDF_EXPORT_NOTE,
        json!({ "note": "Diario.md" }),
    )
    .expect("ancora presente");
    host.advance(1);
    let errore = invoca(
        &p,
        &mut host,
        PDF_EXPORT_NOTE,
        json!({ "note": "Diario.md" }),
    )
    .expect_err("la promessa è scaduta");
    assert!(matches!(errore, PluginError::Unserved(_)));
    // Una prova di `listen` non promette niente.
    p.invoke(PDF_EXPORT_LISTEN, json!({}), InvokeMode::DryRun, &mut host)
        .unwrap();
    assert!(invoca(
        &p,
        &mut host,
        PDF_EXPORT_NOTE,
        json!({ "note": "Diario.md" })
    )
    .is_err());
}

#[test]
fn pdf_export_un_profilo_che_non_c_e_e_un_errore_tipato() {
    let p = fornitore();
    let mut host = vault_con_tipo();
    ascolta(&p, &mut host);
    let errore = invoca(
        &p,
        &mut host,
        PDF_EXPORT_NOTE,
        json!({ "note": "Diario.md", "profile": "Rivista" }),
    )
    .expect_err("il profilo non c'è");
    assert!(matches!(errore, PluginError::NotFound(_)), "{errore:?}");
    assert_eq!(chiave(&errore), E_PROFILE_MISSING);
}

#[test]
fn pdf_export_il_profilo_si_trova_per_id_e_per_nome() {
    let p = fornitore();
    let mut host = vault_con_tipo();
    ascolta(&p, &mut host);
    let id = crea(&mut host, "Rivista di giugno");
    for nome in [id.as_str(), "rivista DI giugno"] {
        let esito = invoca(
            &p,
            &mut host,
            PDF_EXPORT_NOTE,
            json!({ "note": "Diario.md", "profile": nome }),
        )
        .unwrap();
        let (_, dati) = effetto(&esito);
        assert_eq!(dati["profile"]["id"], id.as_str(), "{nome}");
        assert_eq!(dati["profile"]["from"], "chosen");
    }
}

#[test]
fn pdf_export_un_profilo_futuro_vale_per_cio_che_si_conosce() {
    let p = fornitore();
    let mut host = vault_con_tipo();
    ascolta(&p, &mut host);
    host.data_write(
        "profili/futuro.json",
        br#"{"versione": 9, "nome": "Futuro", "rilegatura": "a spirale"}"#,
    )
    .unwrap();
    let esito = invoca(
        &p,
        &mut host,
        PDF_EXPORT_NOTE,
        json!({ "note": "Diario.md", "profile": "Futuro" }),
    )
    .expect("si usa");
    let (_, dati) = effetto(&esito);
    assert_eq!(dati["profile"]["future"], true);
    // Ma non si riscrive: il salvataggio lo rifiuta e dice di copiarlo.
    let errore = invoca(
        &p,
        &mut host,
        PDF_PROFILE_RENAME,
        json!({ "id": "futuro", "name": "Altro" }),
    )
    .expect_err("non si riscrive");
    assert_eq!(chiave(&errore), E_PROFILE_FUTURE);
    let esito = invoca(
        &p,
        &mut host,
        PDF_PROFILE_COPY,
        json!({ "id": "futuro", "name": "Copia" }),
    )
    .expect("la copia sì");
    assert_eq!(effetto(&esito).1["name"], "Copia");
}

#[test]
fn pdf_export_il_predefinito_per_tipo_vince_su_quello_del_vault() {
    let p = fornitore();
    let mut host = vault_con_tipo();
    ascolta(&p, &mut host);
    let del_vault = crea(&mut host, "Del vault");
    let dei_libri = crea(&mut host, "Dei libri");
    invoca(
        &p,
        &mut host,
        PDF_PROFILE_DEFAULT,
        json!({ "id": del_vault.as_str() }),
    )
    .unwrap();
    invoca(
        &p,
        &mut host,
        PDF_PROFILE_DEFAULT,
        json!({ "id": dei_libri.as_str(), "scope": "type", "note": "Dune.md" }),
    )
    .unwrap();
    // Il predefinito del tipo sta nello spazio della nota del tipo.
    assert!(host
        .data_read(&percorso_tipo(&DocId::new("Tipi/Libro.md")))
        .unwrap()
        .is_some());

    let profilo_di = |host: &mut MemoryHost, nota: &str| {
        let esito = invoca(&p, host, PDF_EXPORT_NOTE, json!({ "note": nota })).unwrap();
        let (_, dati) = effetto(&esito);
        (
            dati["profile"]["id"].as_str().unwrap().to_owned(),
            dati["profile"]["from"].as_str().unwrap().to_owned(),
        )
    };
    assert_eq!(
        profilo_di(&mut host, "Dune.md"),
        (dei_libri.0.clone(), "type".into())
    );
    assert_eq!(
        profilo_di(&mut host, "Diario.md"),
        (del_vault.0.clone(), "vault".into())
    );

    // Un predefinito che punta a un profilo sparito lascia il posto al livello
    // dopo: la nota del tipo prende quello del vault.
    profile::elimina(&mut host, &dei_libri).unwrap();
    assert_eq!(
        profilo_di(&mut host, "Dune.md"),
        (del_vault.0.clone(), "vault".into())
    );

    // `pdf.profiles` lo dice per una nota, coi due predefiniti.
    let esito = invoca(&p, &mut host, PDF_PROFILES, json!({ "note": "Dune.md" })).unwrap();
    let (ns, dati) = effetto(&esito);
    assert_eq!(ns, NS_PROFILI);
    assert_eq!(dati["vault_default"], del_vault.as_str());
    assert_eq!(dati["type_default"], dei_libri.as_str());
    assert_eq!(dati["note_type"]["doc"], "Tipi/Libro.md");
    assert_eq!(dati["effective"]["from"], "vault");
    assert_eq!(dati["profiles"].as_array().unwrap().len(), 1);

    // Un id vuoto toglie il predefinito del vault: torna «Di serie».
    invoca(&p, &mut host, PDF_PROFILE_DEFAULT, json!({ "id": "" })).unwrap();
    assert_eq!(
        profilo_di(&mut host, "Diario.md"),
        (String::new(), "default".into())
    );
}

#[test]
fn pdf_export_il_predefinito_per_tipo_vuole_una_nota_con_un_tipo() {
    let p = fornitore();
    let mut host = vault_con_tipo();
    let id = crea(&mut host, "Qualcosa");
    let errore = invoca(
        &p,
        &mut host,
        PDF_PROFILE_DEFAULT,
        json!({ "id": id.as_str(), "scope": "type", "note": "Diario.md" }),
    )
    .expect_err("Diario non ha un tipo");
    assert_eq!(chiave(&errore), E_DEFAULT_TYPE);
    // E il predefinito punta solo a un profilo che c'è.
    let errore = invoca(&p, &mut host, PDF_PROFILE_DEFAULT, json!({ "id": "manca" }))
        .expect_err("il profilo non c'è");
    assert!(matches!(errore, PluginError::NotFound(_)));
}

#[test]
fn pdf_export_un_predefinito_futuro_si_legge_ma_non_si_riscrive() {
    let p = fornitore();
    let mut host = vault_con_tipo();
    ascolta(&p, &mut host);
    let id = crea(&mut host, "Nuovo");
    host.data_write(
        FILE_PREDEFINITO,
        format!(
            r#"{{"versione": 4, "profilo": "{}", "per_lingua": {{}}}}"#,
            id.as_str()
        )
        .as_bytes(),
    )
    .unwrap();
    let esito = invoca(
        &p,
        &mut host,
        PDF_EXPORT_NOTE,
        json!({ "note": "Diario.md" }),
    )
    .unwrap();
    assert_eq!(effetto(&esito).1["profile"]["from"], "vault");
    let errore = invoca(&p, &mut host, PDF_PROFILE_DEFAULT, json!({ "id": "" }))
        .expect_err("non si riscrive");
    assert_eq!(chiave(&errore), E_DEFAULT_FUTURE);
    assert!(host.data_read(FILE_PREDEFINITO).unwrap().is_some());
}

#[test]
fn pdf_export_destinazione_nota_e_sostituzione_si_controllano() {
    let p = fornitore();
    let mut host = vault_con_tipo().with_binary_document("Diario.pdf", b"%PDF-1.7");
    ascolta(&p, &mut host);
    let errore = invoca(
        &p,
        &mut host,
        PDF_EXPORT_NOTE,
        json!({ "note": "Diario.md" }),
    )
    .expect_err("il PDF c'è già");
    assert!(matches!(errore, PluginError::AlreadyExists(_)));
    invoca(
        &p,
        &mut host,
        PDF_EXPORT_NOTE,
        json!({ "note": "Diario.md", "replace": true }),
    )
    .expect("con replace sì");
    let errore = invoca(
        &p,
        &mut host,
        PDF_EXPORT_NOTE,
        json!({ "note": "Diario.md", "target": "Diario.txt" }),
    )
    .expect_err("non è un PDF");
    assert!(matches!(errore, PluginError::BadArgs(_)));
    let errore = invoca(
        &p,
        &mut host,
        PDF_EXPORT_NOTE,
        json!({ "note": "Manca.md" }),
    )
    .expect_err("la nota non c'è");
    assert!(matches!(errore, PluginError::NotFound(_)));
    let errore = invoca(
        &p,
        &mut host,
        PDF_EXPORT_NOTE,
        json!({ "note": "Diario.pdf" }),
    )
    .expect_err("non è una nota");
    assert_eq!(chiave(&errore), E_NOTE);
    let esito = invoca(
        &p,
        &mut host,
        PDF_EXPORT_NOTE,
        json!({ "note": "Diario.md", "target": "Esportati/Il diario.pdf" }),
    )
    .unwrap();
    assert_eq!(effetto(&esito).1["target"], "Esportati/Il diario.pdf");
}

#[test]
fn pdf_export_la_prova_dell_esportazione_non_manda_niente() {
    let p = fornitore();
    let mut host = vault_con_tipo();
    ascolta(&p, &mut host);
    let esito = p
        .invoke(
            PDF_EXPORT_NOTE,
            json!({ "note": "Diario.md" }),
            InvokeMode::DryRun,
            &mut host,
        )
        .unwrap();
    assert!(matches!(esito.effect, CommandEffect::Plan(_)));
}

#[test]
fn pdf_export_i_comandi_dei_profili_salvano_copiano_e_rinominano() {
    let p = fornitore();
    let mut host = vault_con_tipo();
    let mut profilo = serde_json::to_value(Profilo::nuovo("Relazione")).unwrap();
    // La vista manda il profilo senza la versione: vale quella di oggi.
    profilo.as_object_mut().unwrap().remove("versione");
    let esito = invoca(
        &p,
        &mut host,
        PDF_PROFILE_SAVE,
        json!({ "profile": profilo.to_string() }),
    )
    .expect("salvato");
    let id = effetto(&esito).1["id"].as_str().unwrap().to_owned();
    assert_eq!(
        profile::leggi(&host, &IdProfilo(id.clone())).unwrap().nome,
        "Relazione"
    );

    // Un secondo profilo nuovo con lo stesso nome no.
    let errore = invoca(
        &p,
        &mut host,
        PDF_PROFILE_SAVE,
        json!({ "profile": profilo.to_string() }),
    )
    .expect_err("il nome c'è già");
    assert_eq!(chiave(&errore), E_PROFILE_NAME_TAKEN);

    // Sopra lo stesso id sì.
    invoca(
        &p,
        &mut host,
        PDF_PROFILE_SAVE,
        json!({ "id": id, "profile": profilo.to_string() }),
    )
    .expect("sopra sé stesso");

    let esito = invoca(
        &p,
        &mut host,
        PDF_PROFILE_COPY,
        json!({ "id": id, "name": "Relazione breve" }),
    )
    .unwrap();
    let copia = effetto(&esito).1["id"].as_str().unwrap().to_owned();
    assert_ne!(copia, id);

    invoca(
        &p,
        &mut host,
        PDF_PROFILE_RENAME,
        json!({ "id": copia, "name": "Breve" }),
    )
    .unwrap();
    assert_eq!(
        profile::leggi(&host, &IdProfilo(copia)).unwrap().nome,
        "Breve"
    );

    let errore = invoca(
        &p,
        &mut host,
        PDF_PROFILE_SAVE,
        json!({ "profile": "{non è json" }),
    )
    .expect_err("non è un profilo");
    assert_eq!(chiave(&errore), E_PROFILE_JSON);
    let errore = invoca(
        &p,
        &mut host,
        PDF_PROFILE_RENAME,
        json!({ "id": "../fuori", "name": "X" }),
    )
    .expect_err("non è un id");
    assert_eq!(chiave(&errore), E_PROFILE_ID);
}

#[test]
fn pdf_export_il_pdf_accanto_alla_nota() {
    assert_eq!(pdf_accanto(&DocId::new("Note/Dune.md")), "Note/Dune.pdf");
    assert_eq!(pdf_accanto(&DocId::new("Diario.md")), "Diario.pdf");
    assert_eq!(pdf_accanto(&DocId::new("A.b/c.d.md")), "A.b/c.d.pdf");
}

#[test]
fn pdf_export_gli_altri_comandi_passano_al_fornitore_di_sotto() {
    let p = fornitore();
    let mut host = vault_con_tipo();
    let errore = invoca(&p, &mut host, "draw.new", json!({})).unwrap_err();
    assert!(matches!(errore, PluginError::UnknownCommand(_)));
}
