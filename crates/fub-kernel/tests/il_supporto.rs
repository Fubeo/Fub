//! Il supporto su cui vive un vault (§15.1): che le due implementazioni dicano
//! la stessa cosa, e che il [`Vault`] non tocchi nient'altro.
//!
//! Sono due presidi diversi e nessuno dei due basta da solo.
//!
//! Il primo — `le_due_implementazioni_rispondono_uguale` — esiste perché
//! **un'astrazione con un cliente solo non è un'astrazione**: finché il
//! `FsStorage` è l'unico, il trait può accumulare in silenzio le abitudini di
//! `std::fs` (una `remove` che vale anche per le cartelle, una `list` che torna
//! nell'ordine del filesystem) e il giorno in cui arriva il supporto che cifra,
//! o quello su OPFS, il contratto che deve rispettare non sta scritto da
//! nessuna parte. Sta qui: è questo file.
//!
//! Il secondo — `un_vault_intero_su_un_supporto_che_non_e_il_disco` — presidia
//! l'altra metà della voce, che il primo non tocca: che il `Vault` ci passi
//! **davvero** sopra. Un `std::fs::write` rimasto dentro un metodo del vault
//! non fa fallire nessun test di conformità del trait; fa fallire questo,
//! perché il disco lì sotto non c'è.
//!
//! Cosa **non** c'è qui, di proposito: i test di durabilità. Il §15.2 è
//! temp+rename+fsync sulla directory, cioè una proprietà che esiste solo su un
//! filesystem vero, e un supporto in memoria per costruzione non la modella.
//! Presidiarla qui vorrebbe dire renderla verde su un supporto che non ce l'ha.
//! Stanno in `la_durabilita.rs`, su `FsStorage` soltanto — e il fatto che questa
//! riga sia rimasta identica il giorno in cui la durabilità è arrivata
//! ([0065](../../../docs/decisions/0065-una-scrittura-o-c-e-o-non-c-e.md)) è il
//! punto: la ragione per cui non stanno qui non è cambiata insieme a loro.
//!
//! Il terzo — `il_varco_del_filesystem_ha_solo_i_chiamanti_dichiarati` —
//! presidia l'eccezione dichiarata della
//! [0064](../../../docs/decisions/0064-il-supporto-sta-sotto.md):
//! `plugin_data_dir` consegna a un provider nativo una cartella vera del
//! filesystem, e la cifratura si ferma lì. Il banco elenca chi la riceve, e un
//! chiamante nuovo è un varco nuovo che si dichiara prima di esistere.
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::DocId;
use fub_kernel::storage::{FsStorage, MemStorage, VaultStorage};
use fub_kernel::Vault;

/// Un supporto da provare: come si chiama nei messaggi, cosa è, dove sta la sua
/// radice, e la `TempDir` che va tenuta viva finché dura il giro — che è la
/// ragione per cui viaggia insieme al supporto invece di essere una variabile
/// locale di chi lo costruisce.
type Banco = (
    &'static str,
    Arc<dyn VaultStorage>,
    Utf8PathBuf,
    Option<tempfile::TempDir>,
);

/// I due supporti, ognuno sulla propria radice.
fn supporti() -> Vec<Banco> {
    let tmp = tempfile::tempdir().expect("cartella temporanea");
    let root = Utf8Path::from_path(tmp.path())
        .expect("path UTF-8")
        .to_owned();
    vec![
        ("fs", Arc::new(FsStorage), root, Some(tmp)),
        ("mem", Arc::new(MemStorage::new()), "/vault".into(), None),
    ]
}

#[test]
fn le_due_implementazioni_rispondono_uguale() {
    for (nome, storage, root, _tmp) in supporti() {
        let dice = |cosa: &str| format!("[{nome}] {cosa}");

        // Scrivere crea le cartelle che mancano: è la riga che stava ripetuta a
        // ogni chiamante, e che ora sta in una firma sola.
        let a = root.join("note/idee/a.md");
        storage
            .write(&a, b"ciao")
            .unwrap_or_else(|e| panic!("{} — {e}", dice("scrittura")));
        assert_eq!(storage.read(&a).unwrap(), b"ciao", "{}", dice("rilettura"));
        assert!(storage.exists(&a), "{}", dice("esiste dopo la scrittura"));
        assert!(
            storage.stat(&root.join("note/idee")).unwrap().is_dir(),
            "{}",
            dice("il genitore è nato con la scrittura")
        );

        // Lo `stat` di un file dice la dimensione vera.
        let stat = storage.stat(&a).unwrap();
        assert!(stat.is_file(), "{}", dice("specie"));
        assert_eq!(stat.size, 4, "{}", dice("dimensione"));

        // Riscrivere cambia la data: è la sola cosa che chi salta un file
        // chiede al supporto (§14.2), ed è la sola che un contatore e un
        // orologio devono avere in comune.
        let prima = storage.stat(&a).unwrap().mtime;
        storage
            .write(&a, b"ciao ciao")
            .unwrap_or_else(|e| panic!("{} — {e}", dice("riscrittura")));
        assert!(
            storage.stat(&a).unwrap().mtime >= prima,
            "{}",
            dice("la data non torna indietro")
        );

        // `list` è di **un** livello, in ordine di path, e porta i metadati con
        // sé — file e cartelle insieme, perché chi cammina deve poter decidere
        // se scendere senza chiedere una seconda volta.
        storage.write(&root.join("note/b.md"), b"b").unwrap();
        let voci = storage
            .list(&root.join("note"))
            .unwrap_or_else(|e| panic!("{} — {e}", dice("elenco")));
        let nomi: Vec<&str> = voci.iter().filter_map(|v| v.path.file_name()).collect();
        assert_eq!(nomi, vec!["b.md", "idee"], "{}", dice("ordine e livello"));
        assert!(
            voci[0].stat.is_file() && voci[1].stat.is_dir(),
            "{}",
            dice("specie")
        );
        assert_eq!(voci[0].stat.size, 1, "{}", dice("metadati nell'elenco"));

        // Una cartella che non c'è è un errore, non un elenco vuoto: chi
        // preferisce il vuoto lo dice lui (`collect_data_files` lo fa), e
        // sceglierlo qui toglierebbe a tutti gli altri il modo di accorgersene.
        assert!(
            storage.list(&root.join("mai-esistita")).is_err(),
            "{}",
            dice("elencare ciò che non c'è")
        );

        // `rename` funziona per un file e per una cartella, e crea la
        // destinazione che manca.
        storage
            .rename(&a, &root.join("archivio/2026/a.md"))
            .unwrap_or_else(|e| panic!("{} — {e}", dice("rename di un file")));
        assert!(!storage.exists(&a), "{}", dice("l'origine sparisce"));
        assert_eq!(
            storage.read(&root.join("archivio/2026/a.md")).unwrap(),
            b"ciao ciao",
            "{}",
            dice("i byte seguono il rename")
        );
        storage
            .rename(&root.join("archivio"), &root.join("vecchio"))
            .unwrap_or_else(|e| panic!("{} — {e}", dice("rename di una cartella")));
        assert!(
            storage.exists(&root.join("vecchio/2026/a.md")),
            "{}",
            dice("una cartella si sposta con dentro tutto")
        );

        // `append` aggiunge in coda **e crea ciò che non c'è**: chi appende su
        // un file che non esiste ancora non deve prima scriverlo vuoto, o quella
        // riga la dimenticherebbe qualcuno. È l'ottava operazione (§15.2), e sta
        // qui perché il registro delle mutazioni deve poter vivere su un
        // supporto che non è il disco tanto quanto ci vive il vault.
        let reg = root.join("registro/righe.jsonl");
        storage
            .append(&reg, b"una\n")
            .unwrap_or_else(|e| panic!("{} — {e}", dice("append su ciò che non c'è")));
        storage
            .append(&reg, b"due\n")
            .unwrap_or_else(|e| panic!("{} — {e}", dice("append")));
        assert_eq!(
            storage.read(&reg).unwrap(),
            b"una\ndue\n",
            "{}",
            dice("ciò che c'era resta dov'è")
        );
        // E `write` sullo stesso path **sostituisce**: le due promesse sono
        // diverse, e un supporto che le confondesse renderebbe verde un registro
        // che perde tutto a ogni riga.
        storage.write(&reg, b"tre\n").unwrap();
        assert_eq!(
            storage.read(&reg).unwrap(),
            b"tre\n",
            "{}",
            dice("write non è append")
        );
        storage.remove(&reg).unwrap();
        storage.remove_dir_all(&root.join("registro")).unwrap();

        // `remove` è dei file soltanto: per una cartella c'è `remove_dir_all`,
        // e la distinzione è ciò che impedisce a un `data_remove` di un plugin
        // di portarsi via un albero intero con un path che finisce bene.
        assert!(
            storage.remove(&root.join("vecchio")).is_err(),
            "{}",
            dice("remove non tocca le cartelle")
        );
        storage
            .remove(&root.join("vecchio/2026/a.md"))
            .unwrap_or_else(|e| panic!("{} — {e}", dice("remove di un file")));
        assert!(
            storage.remove(&root.join("vecchio/2026/a.md")).is_err(),
            "{}",
            dice("due volte no")
        );

        // `remove_dir_all` scende, e il default composto dalle sette deve dare
        // lo stesso esito dell'implementazione nativa del filesystem.
        storage
            .write(&root.join("vecchio/2026/c.md"), b"c")
            .unwrap();
        storage
            .remove_dir_all(&root.join("vecchio"))
            .unwrap_or_else(|e| panic!("{} — {e}", dice("remove_dir_all")));
        assert!(
            !storage.exists(&root.join("vecchio")),
            "{}",
            dice("è sparita")
        );
        assert!(
            !storage.exists(&root.join("vecchio/2026/c.md")),
            "{}",
            dice("ed è sparito ciò che aveva dentro")
        );

        // --- il doppio sbaglia dove sbaglia il disco -------------------------
        //
        // Le righe che seguono non provano cosa il supporto sa fare, ma **cosa
        // si rifiuta di fare**, ed è la metà che un doppio si dimentica: un
        // `Ok` di troppo qui non rompe niente in memoria, rende verde di qua un
        // banco che di là sarebbe rosso, e chi lo scrive non lo saprà mai.
        // Nessuna asserzione sulla specie dell'errore: cosa dica il sistema
        // operativo cambia fra Linux, macOS e Windows, e il contratto è che sia
        // un errore.
        storage.write(&root.join("scritti/uno.md"), b"1").unwrap();
        assert!(
            storage.write(&root.join("scritti"), b"x").is_err(),
            "{}",
            dice("scrivere su una cartella")
        );
        assert!(
            storage
                .update(&root.join("scritti"), &mut |_| Ok(Some(b"x".to_vec())))
                .is_err(),
            "{}",
            dice("aggiornare una cartella")
        );
        assert!(
            storage.append(&root.join("scritti"), b"x").is_err(),
            "{}",
            dice("appendere a una cartella")
        );
        // E un file non è una cartella nemmeno da genitore: `create_dir_all` di
        // là si ferma, e un path che fosse insieme file e cartella è uno stato
        // che il filesystem non sa rappresentare.
        assert!(
            storage
                .write(&root.join("scritti/uno.md/sotto.md"), b"x")
                .is_err(),
            "{}",
            dice("scrivere sotto un file")
        );

        // Una cartella ha una data, e non è zero — che nel contratto di `Stat`
        // vuol dire «non lo so». Un doppio che rispondesse sempre zero direbbe
        // «non è cambiata» dove il disco dice «è cambiata». Che poi la data
        // **avanzi** lo prova il banco unitario del contatore in `storage.rs`:
        // qui un orologio vero e un contatore possono promettere solo che una
        // data c'è e che non torna indietro.
        let dir = root.join("scritti");
        let quando = storage.stat(&dir).unwrap().mtime;
        assert_ne!(quando, 0, "{}", dice("una cartella ha una data"));
        let voci = storage.list(&root).unwrap();
        let elencata = voci.iter().find(|v| v.path == dir).expect("nell'elenco");
        assert_ne!(
            elencata.stat.mtime,
            0,
            "{}",
            dice("e ce l'ha anche nell'elenco")
        );
        storage.write(&dir.join("due.md"), b"2").unwrap();
        assert!(
            storage.stat(&dir).unwrap().mtime >= quando,
            "{}",
            dice("la data di una cartella non torna indietro")
        );

        // «Vuota» vuol dire vuota: togliere una cartella che ha dentro qualcosa
        // è un errore, e non un `Ok` che lascia orfano ciò che c'era.
        assert!(
            storage.remove_empty_dir(&dir).is_err(),
            "{}",
            dice("una cartella piena non si toglie")
        );
        assert!(
            storage.exists(&dir.join("due.md")),
            "{}",
            dice("e ciò che aveva dentro è ancora lì")
        );
        storage.remove_dir_all(&dir).unwrap();

        // Un `fondi` che va in panico non porta via il supporto con sé: di là
        // il lucchetto del file si rilascia e si continua a leggere, di qua il
        // `Mutex` resterebbe avvelenato e ogni accesso successivo morirebbe.
        let esito = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = storage.update(&root.join("fusione.md"), &mut |_| {
                panic!("la fusione esplode")
            });
        }));
        assert!(esito.is_err(), "{}", dice("il panico risale"));
        assert!(
            !storage.exists(&root.join("fusione.md")),
            "{}",
            dice("e non ha scritto niente")
        );
        storage
            .write(&root.join("dopo.md"), b"d")
            .unwrap_or_else(|e| panic!("{} — {e}", dice("il supporto regge al panico")));
        assert_eq!(storage.read(&root.join("dopo.md")).unwrap(), b"d");

        // Leggere ciò che non c'è è un `NotFound`, e non un altro errore: sopra
        // di qui `data_read` ci distingue «lo store è vuoto» da «il disco è
        // rotto», e sbagliare specie di errore trasformerebbe un guasto in un
        // silenzio.
        let err = storage.read(&root.join("fantasma.md")).unwrap_err();
        assert_eq!(
            err.kind(),
            std::io::ErrorKind::NotFound,
            "{}",
            dice("specie dell'errore")
        );
    }
}

/// Un symlink si presenta come `Other`, e non come la cosa a cui punta.
///
/// È il presidio della sola riga di comportamento che scrivere questo trait
/// avrebbe cambiato in silenzio: la specie di una voce di elenco chiesta con
/// `metadata()` invece che con `file_type()` segue il link, e una scansione che
/// segue i link non torna da un anello. Vale su Unix, che è dove si sanno
/// creare senza privilegi.
#[cfg(unix)]
#[test]
fn un_collegamento_non_e_la_cosa_a_cui_punta() {
    let tmp = tempfile::tempdir().unwrap();
    let root = Utf8Path::from_path(tmp.path()).unwrap().to_owned();
    let storage = FsStorage;

    storage.write(&root.join("vera/nota.md"), b"x").unwrap();
    std::os::unix::fs::symlink(root.join("vera"), root.join("finta")).unwrap();
    std::os::unix::fs::symlink(root.join("mai-esistita"), root.join("rotta")).unwrap();

    let voci = storage.list(&root).unwrap();
    let specie: Vec<_> = voci
        .iter()
        .map(|v| (v.path.file_name().unwrap(), v.stat.kind))
        .collect();
    assert_eq!(
        specie,
        vec![
            ("finta", fub_kernel::storage::EntryKind::Other),
            ("rotta", fub_kernel::storage::EntryKind::Other),
            ("vera", fub_kernel::storage::EntryKind::Dir),
        ],
        "la specie di una voce di elenco non segue il link — e un link rotto \
         non fa fallire l'elenco intero"
    );

    // Uno `stat`, invece, lo segue: si chiede su un path e non su una voce, ed
    // è ciò che ha sempre fatto (`std::fs::metadata`).
    assert!(storage.stat(&root.join("finta")).unwrap().is_dir());

    // E la scansione del vault lo salta, come faceva prima di questo trait.
    let vault = Vault::on(&root, Arc::new(FsStorage)).expect("l'apertura del vault riesce");
    let scan = vault.scan().unwrap();
    assert_eq!(scan.folders, vec!["vera".to_string()]);
    assert_eq!(
        scan.files.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(),
        vec!["vera/nota.md"]
    );
}

#[test]
fn un_vault_intero_su_un_supporto_che_non_e_il_disco() {
    let storage = Arc::new(MemStorage::new());
    let vault = Vault::on("/vault", Arc::clone(&storage) as Arc<dyn VaultStorage>)
        .expect("l'apertura del vault riesce");

    let nota = DocId::new("progetti/Idea.md");
    vault.write(&nota, "# Idea\n").unwrap();
    assert!(vault.exists(&nota));
    assert_eq!(vault.read(&nota).unwrap(), "# Idea\n");

    // La scansione vede il file **e** la cartella, e non vede `.fub/`.
    vault
        .write(&DocId::new(".fub/data/qualcosa.json"), "{}")
        .unwrap();
    let scan = vault.scan().unwrap();
    assert_eq!(
        scan.files.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(),
        vec!["progetti/Idea.md"]
    );
    assert_eq!(scan.folders, vec!["progetti".to_string()]);

    // Il rename porta i byte e libera l'origine.
    let rinominata = DocId::new("archivio/Idea.md");
    vault.rename(&nota, &rinominata).unwrap();
    assert!(!vault.exists(&nota));
    assert_eq!(vault.read(&rinominata).unwrap(), "# Idea\n");

    // Il cestino: la voce ci finisce, il sidecar si ricorda da dove veniva, e
    // l'elenco lo dice. È il giro in cui il vault scrive **tre** posti diversi
    // (il cestino, il sidecar sotto `.fub/data/`, e il file d'origine), quindi
    // è quello che si accorge se uno solo dei tre è rimasto su `std::fs`.
    let (cestinata, guasto) = vault.trash(&rinominata).unwrap();
    assert!(guasto.is_none(), "il sidecar si è scritto: {guasto:?}");
    assert!(cestinata.as_str().starts_with(".trash/"));
    let voci = vault.list_trash().unwrap();
    assert_eq!(voci.len(), 1);
    assert_eq!(voci[0].original, rinominata, "il sidecar sa da dove veniva");

    // Svuotare toglie le voci **e** i sidecar.
    assert_eq!(vault.empty_trash().unwrap(), 1);
    assert!(vault.list_trash().unwrap().is_empty());
    assert!(
        !storage.exists(Utf8Path::new("/vault/.fub/data/trash")),
        "i sidecar se ne vanno col cestino"
    );
}

// ---------------------------------------------------------------------------
// Il varco del filesystem (0064): chi riceve una cartella vera dal kernel
// ---------------------------------------------------------------------------

/// **`plugin_data_dir` ha solo i chiamanti dichiarati qui.**
///
/// La [0064](../../../docs/decisions/0064-il-supporto-sta-sotto.md) ha
/// dichiarato il buco: `plugin_data_dir` consegna a un provider nativo una
/// vera cartella del filesystem, fuori da `VaultStorage` — lì la cifratura si
/// ferma. È il varco che tantivy esige (mmappa i segmenti e li rilegge quando
/// gli pare, anche dai thread di merge), e a M5 l'equivalente per un componente
/// sarà un preopen WASI sulla stessa radice: un plugin WASM non riceverà mai
/// una cartella dal kernel.
///
/// Un varco dichiarato in un doc non diventa rosso. Questo conto è la metà che
/// lo diventa: elenca **chi** chiama `plugin_data_dir` in tutto il repo e
/// pretende che ogni chiamante sia in questa lista, con la sua ragione. Un
/// chiamante nuovo — un provider che vuole una cartella, un pezzo di kernel
/// che la consegna — trova un banco che nomina la decisione che sta scavalcando,
/// e se la decisione è cambiata questo è il file da cambiare per primo.
///
/// La lista è per (file, argomento): l'argomento è l'id del provider, cioè chi
/// riceve la cartella. `SEARCH_ID` è la ricerca — l'unico provider nativo che
/// mmappa, oggi. `"prova.uno"` è la spia del banco del ciclo di vita
/// (`disattivazione.rs`), che verifica che `close` scriva davvero nello spazio
/// dati. `PLUGIN` in `rinomina_lenta.rs` è il banco 0198/0168: non mmappa,
/// chiede la cartella per posare un byte e vedere se la rinomina spezzata
/// lo porta dietro. Tutti e tre sono chiamanti legittimi, e per questo
/// dichiarati — non allargati in silenzio.
///
/// Il conto non salta i commenti: una prosa che scrivesse la chiamata per
/// esteso diventerebbe rossa, ed è il verso innocuo — la si scrive senza
/// parentesi, come in questo doc.
const CHIAMANTI: &[(&str, &str, &str)] = &[
    (
        "crates/fub-host/src/mount.rs",
        "SEARCH_ID",
        "il montaggio della ricerca: l'unico provider nativo che mmappa (oggi)",
    ),
    (
        "crates/fub-features/tests/canale_dati_e2e.rs",
        "SEARCH_ID",
        "il banco e2e della ricerca",
    ),
    (
        "crates/fub-features/tests/search_e2e.rs",
        "SEARCH_ID",
        "il banco e2e della ricerca",
    ),
    (
        "crates/fub-features/examples/una_ricerca.rs",
        "SEARCH_ID",
        "la seduta della ricerca",
    ),
    (
        "crates/fub-kernel/tests/disattivazione.rs",
        "\"prova.uno\"",
        "il banco del ciclo di vita: `close` scrive nello spazio dati, e il banco lo verifica",
    ),
    (
        "crates/fub-kernel/tests/rinomina_lenta.rs",
        "PLUGIN",
        "il banco 0198/0168: attacca e legge lo spazio per-documento della rinomina spezzata",
    ),
];

/// Le cartelle in cui non si entra.
const NON_SI_ENTRA: &[&str] = &["target", "node_modules", ".git", ".fub"];

fn radice() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Ogni `.rs` del repo, per percorso relativo alla radice.
fn sorgenti() -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    cammina(&radice(), "", &mut out);
    out
}

fn cammina(dir: &Path, rel: &str, out: &mut BTreeMap<String, String>) {
    let voci = std::fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("`{}` non si legge: {e}", dir.display()));
    for voce in voci {
        let voce = voce.unwrap_or_else(|e| panic!("dentro `{}`: {e}", dir.display()));
        let nome = voce
            .file_name()
            .into_string()
            .unwrap_or_else(|n| panic!("nome di file non UTF-8: {n:?}"));
        let percorso = if rel.is_empty() {
            nome.clone()
        } else {
            format!("{rel}/{nome}")
        };
        let tipo = voce
            .file_type()
            .unwrap_or_else(|e| panic!("`{percorso}`: {e}"));
        if tipo.is_dir() {
            if !NON_SI_ENTRA.contains(&nome.as_str()) {
                cammina(&voce.path(), &percorso, out);
            }
        } else if nome.ends_with(".rs") {
            let src = std::fs::read_to_string(voce.path())
                .unwrap_or_else(|e| panic!("`{percorso}` non si legge: {e}"));
            out.insert(percorso, src);
        }
    }
}

/// Chi chiama `plugin_data_dir`, e con quale argomento: `(file, argomento)`.
fn chiamanti() -> Vec<(String, String)> {
    // Il pattern è costruito a pezzi, non scritto per esteso: questo file è
    // nella camminata, e una costante letterale qui dentro sarebbe contata.
    let ago = [".plugin_data", "_dir("].concat();
    let mut out = Vec::new();
    for (file, sorgente) in sorgenti() {
        for (n, riga) in sorgente.lines().enumerate() {
            let mut da = 0;
            while let Some(rel) = riga[da..].find(&ago) {
                let inizio = da + rel + ago.len();
                let resto = &riga[inizio..];
                let fine = resto.find(')').unwrap_or_else(|| {
                    panic!(
                        "`{file}:{}` chiama `plugin_data_dir` su più righe: il conto non aggancia",
                        n + 1
                    )
                });
                let arg = resto[..fine].trim().to_string();
                out.push((file.clone(), arg));
                da = inizio + fine + 1;
            }
        }
    }
    out
}

#[test]
fn il_varco_del_filesystem_ha_solo_i_chiamanti_dichiarati() {
    let trovati = chiamanti();
    let dichiarati: Vec<(String, String)> = CHIAMANTI
        .iter()
        .map(|(f, a, _)| (f.to_string(), a.to_string()))
        .collect();
    let non_dichiarati: Vec<_> = trovati
        .iter()
        .filter(|t| !dichiarati.contains(t))
        .collect();
    assert!(
        non_dichiarati.is_empty(),
        "{} chiamante/i di `plugin_data_dir` non dichiarato/i:\n  {}\n\n\
         `plugin_data_dir` è l'UNICO varco del filesystem fuori da `VaultStorage` \
         (decisione 0064): lì la cifratura si ferma, e chi lo apre deve essere un \
         provider nativo che mmappa — oggi solo la ricerca. Un chiamante nuovo si \
         dichiara qui, con la sua ragione, non si aggiunge in silenzio.",
        non_dichiarati.len(),
        non_dichiarati
            .iter()
            .map(|(f, a)| format!("{f}  ({a})"))
            .collect::<Vec<_>>()
            .join("\n  "),
    );
}

/// Il test del test: `il_varco_del_filesystem_ha_solo_i_chiamanti_dichiarati`
/// è verde anche se il cammino non trova niente. Questo banco aggancia: se un
/// dichiarato sparisse, o se il cammino diventasse cieco, è questo che diventa
/// rosso — perché un presidio che non aggancia è un presidio che non presidia.
#[test]
fn il_conto_aggancia_i_chiamanti_dichiarati() {
    let trovati = chiamanti();
    for (file, arg, ragione) in CHIAMANTI {
        assert!(
            trovati.contains(&(file.to_string(), arg.to_string())),
            "il conto non trova `{file}` con argomento `{arg}` ({ragione}): o il \
             chiamante è sparito, o il cammino non lo vede"
        );
    }
}
