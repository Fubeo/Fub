//! **Il veleno del kernel ha due porte, e nessuna terza risposta improvvisata.**
//!
//! Il difetto che questo banco presidia non era un panico — nessuno dei sei
//! `.expect("campanello avvelenato")` di `dispatcher.rs` né dei due
//! `.expect("file di log")` di `log.rs` era raggiungibile, e questo va detto
//! perché è metà della diagnosi. Il difetto era che **la ragione stava in una
//! frase**: una frase ripetuta otto volte sembra una decisione presa, e non lo
//! è; e soprattutto **il nono `expect` non eredita niente**. La riparazione è
//! una porta ([`fub_kernel::veleno`]), e una porta rende inesprimibile la forma
//! vecchia solo per chi ci passa: niente impedirebbe di scrivere accanto un
//! secondo `Mutex` con la sua politica improvvisata, e il compilatore direbbe di
//! sì perché non c'è niente di illegale da dire. È la zona cieca misurata
//! addosso alla [0120](../../../docs/decisions/0120-un-lucchetto-avvelenato-si-dice-una-volta.md),
//! dove quattordici siti erano rimasti col codice vecchio a crate verde.
//!
//! Quindi due conti, che guardano due cose diverse.
//!
//! 1. **Nei due file riparati un lucchetto nudo non c'è più.** Chi vuole un
//!    lucchetto in `dispatcher.rs` o in `log.rs` passa da `Ricovero`/`Condizione`.
//! 2. **La politica del veleno, in tutto il kernel, sta in due file soli.** Le
//!    parole con cui si risponde a un `PoisonError` — `clear_poison`,
//!    `into_inner`, `PoisonError` — compaiono in `bus.rs` (la porta della
//!    [0126](../../../docs/decisions/0126-un-bus-che-tace-non-lo-scopre-nessuno.md))
//!    e in `veleno.rs`, e in nessun altro posto. Una terza risposta scritta a
//!    mano in un terzo file è rossa **per nome**, ed è il verso giusto in cui
//!    sbagliare: costringe a dichiararla invece di lasciarla passare.
//!
//! # Cosa questo banco **non** vede, dichiarato
//!
//! **Gli altri file del kernel tengono ancora i loro lucchetti nudi.** Sono
//! **sei** [conta: lucchetti-nudi-del-kernel], e restano fuori dal primo conto
//! **apposta**: è lo stesso buco che la 0120 aveva dichiarato («il conto vede
//! `fub-host` e `fub-app`, non gli altri crate») e che la 0126 aveva rifiutato
//! di chiudere, perché estenderlo vorrebbe dire un'allowlist lunga come
//! l'elenco che dovrebbe restringere. Ciò che è cambiato è che adesso la porta
//! **c'è**: convertirne uno costa una riga, e la domanda «con quale delle due
//! politiche?» ha già le sue due risposte scritte.
//!
//! Il numero sta fra parentesi quadre e non fra i trattini perché **prima era
//! una frase, e la frase era falsa**. Diceva «sono nove» e li nominava:
//! `journal.rs`, `drafts.rs` e `ignore.rs` erano nell'elenco e non hanno mai
//! avuto un lucchetto, mentre `vault.rs` ne ha uno — di banco, quindi fuori dal
//! taglio di [`codice`] e giustamente fuori dal conto — e nell'elenco non
//! c'era. Nessuno se n'era accorto per la ragione che rende questa specie
//! peggiore delle altre: **il motivo per cui si scrive un elenco è smettere di
//! doverlo rifare**. Un elenco a mano dentro una zona dichiarata cieca non ha
//! nessun attore che lo guardi — non il compilatore, che non legge i commenti,
//! e non un banco, perché il banco è qui sotto e guarda altre due cose.
//! Adesso l'attore c'è, è `check-prosa`, e la stessa zona vista sui tre crate
//! che il conto della 0120 non attraversa
//! vale **otto** file [conta: lucchetti-fuori-dal-conto].
//!
//! Il secondo conto invece li attraversa tutti, perché la domanda è diversa: non
//! «hai un lucchetto?» ma «ne hai improvvisato la politica?».

use std::collections::BTreeSet;

/// I due file che il primo conto giudica. `include_str!` e non `std::fs`: così
/// il legame è una dipendenza di compilazione e non un path da tenere
/// aggiornato a mano — se un file si sposta, questo banco non compila.
const RIPARATI: &[(&str, &str)] = &[
    ("dispatcher.rs", include_str!("../src/dispatcher.rs")),
    ("log.rs", include_str!("../src/log.rs")),
];

/// I due file in cui la politica del veleno può stare, e sono porte.
const LE_PORTE: &[&str] = &["bus.rs", "veleno.rs"];

/// Le righe di **codice** di un sorgente: la prosa si salta sempre.
///
/// Che un commento non sia codice è la trappola misurata da `dieta_ipc.rs` — in
/// un repo in cui i file spiegano sé stessi, un `grep` ingenuo conta le
/// spiegazioni, e questo file ne è pieno: la testa di `JobBell` *nomina* i sei
/// `expect` che non ci sono più.
///
/// Il modulo di test si taglia via: un lucchetto costruito a mano in un banco è
/// roba del banco, e i due banchi qui riparati **devono** poter prendere il
/// prestito per avvelenarlo. Il taglio presuppone che il `#[cfg(test)]` stia in
/// fondo al file; se un giorno non lo fosse, il conto guarderebbe di meno e non
/// di più.
fn codice(sorgente: &str) -> Vec<(usize, &str)> {
    let fine = sorgente.find("\n#[cfg(test)]\n").unwrap_or(sorgente.len());
    sorgente[..fine]
        .lines()
        .enumerate()
        .map(|(n, riga)| (n + 1, riga.trim()))
        .filter(|(_, riga)| !riga.starts_with("//"))
        .collect()
}

/// Le parole che, in un file riparato, vogliono dire «qui c'è un lucchetto senza
/// politica». `Condvar` è nell'elenco perché è la ragione per cui `Condizione`
/// esiste: una condizione scritta a mano si porta dietro il suo `Mutex` nudo.
const NUDI: &[&str] = &["Mutex<", "RwLock<", "Condvar", ".lock()", "PoisonError"];

/// L'unica `.lock()` che non è un lucchetto avvelenabile: `StderrLock` non ha un
/// veleno da avere, e `StderrSink` è il posto dove si scrive quando non c'è un
/// posto dove scrivere. Sta qui e non nell'elenco generale perché un'eccezione
/// va **nominata**: se domani `stderr()` sparisse da `log.rs` questa riga
/// resterebbe a indicare qualcosa che non c'è, e [`i_file_che_i_conti_nominano_esistono_davvero`]
/// non la vedrebbe — quindi la si controlla qui, dove si usa.
const NON_E_UN_LUCCHETTO: &str = "std::io::stderr().lock()";

#[test]
fn nei_file_riparati_non_resta_un_lucchetto_nudo() {
    let mut colpe = Vec::new();
    for (nome, sorgente) in RIPARATI {
        let mut eccezione_vista = false;
        for (n, riga) in codice(sorgente) {
            if riga.contains(NON_E_UN_LUCCHETTO) {
                eccezione_vista = true;
                continue;
            }
            for parola in NUDI {
                if riga.contains(parola) {
                    colpe.push(format!("{nome}:{n} `{parola}` — {riga}"));
                }
            }
        }
        assert!(
            eccezione_vista || *nome != "log.rs",
            "`{NON_E_UN_LUCCHETTO}` non è più in `log.rs`: l'eccezione è un \
             ricordo, e va tolta invece di restare a coprire una riga futura"
        );
    }
    assert!(
        colpe.is_empty(),
        "un lucchetto senza politica è tornato nei file riparati. La porta è \
         `fub_kernel::veleno`: `Ricovero` per un dato, `Condizione` per un dato \
         con una `Condvar` sopra.\n{}",
        colpe.join("\n")
    );
}

/// Il gemello del caso qui sopra, e serve perché il primo non basta: la porta
/// toglie il lucchetto nudo, non l'`expect` con una frase. Un `expect` che
/// *nomina* il veleno è la forma precisa che questo giro ha chiuso, e riscriverla
/// altrove nel kernel sarebbe riaprire la domanda in un posto nuovo.
#[test]
fn nessuno_riscrive_una_ragione_al_posto_di_una_politica() {
    let mut colpe = Vec::new();
    for (nome, sorgente) in sorgenti() {
        if LE_PORTE.contains(&nome.as_str()) {
            continue;
        }
        for (n, riga) in codice(&sorgente) {
            let dichiara = riga.contains("expect(") || riga.contains("unwrap_or_else(");
            if dichiara && (riga.contains("avvelenat") || riga.contains("poison")) {
                colpe.push(format!("{nome}:{n} — {riga}"));
            }
        }
    }
    assert!(
        colpe.is_empty(),
        "una ragione sul veleno scritta in una frase invece che in una porta:\n{}",
        colpe.join("\n")
    );
}

#[test]
fn la_politica_del_veleno_sta_in_due_file_soli() {
    let mut fuori = Vec::new();
    for (nome, sorgente) in sorgenti() {
        if LE_PORTE.contains(&nome.as_str()) {
            continue;
        }
        for (n, riga) in codice(&sorgente) {
            for parola in ["clear_poison", "PoisonError", "into_inner()"] {
                if riga.contains(parola) {
                    fuori.push(format!("{nome}:{n} `{parola}` — {riga}"));
                }
            }
        }
    }
    assert!(
        fuori.is_empty(),
        "la risposta a un lucchetto avvelenato è scritta a mano fuori dalle due \
         porte ({}). Le due politiche del kernel sono decise (0126, e la 0120 \
         per l'host): un terzo posto che ne improvvisa una terza è il difetto \
         che le due decisioni esistono per impedire.\n{}",
        LE_PORTE.join(", "),
        fuori.join("\n")
    );
}

/// **L'elenco dei file riparati è una fotografia, e va confrontata con la
/// cartella vera.**
///
/// Un presidio che legge un elenco sa quell'elenco: senza questo caso, un file
/// tolto da `RIPARATI` renderebbe verde il conto invece che rosso — che è il
/// modo in cui un'allowlist smette di essere una fotografia e diventa un
/// ricordo.
#[test]
fn i_file_che_i_conti_nominano_esistono_davvero() {
    let sul_disco: BTreeSet<String> = sorgenti().into_iter().map(|(nome, _)| nome).collect();
    for nome in RIPARATI
        .iter()
        .map(|(n, _)| *n)
        .chain(LE_PORTE.iter().copied())
    {
        assert!(
            sul_disco.contains(nome),
            "`{nome}` è nominato da questo banco e non è più in `src/`: \
             l'elenco è un ricordo, non una fotografia"
        );
    }
}

/// Tutti i sorgenti di `crates/fub-kernel/src`, letti dal disco: `(nome, testo)`.
///
/// È l'unico posto di questo file che usa `std::fs` invece di `include_str!`, e
/// la ragione è il contrario di quella che vale per [`RIPARATI`]: `include_str!`
/// lega il banco a un file **che qualcuno ha nominato**, e ciò che serve al
/// secondo conto è vedere i file che nessuno ha nominato.
fn sorgenti() -> Vec<(String, String)> {
    let radice = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut fuori = Vec::new();
    cammina(&radice, &mut fuori);
    fuori.sort();
    fuori
}

fn cammina(dir: &std::path::Path, dentro: &mut Vec<(String, String)>) {
    for voce in std::fs::read_dir(dir).expect("la cartella dei sorgenti") {
        let path = voce.expect("una voce della cartella").path();
        if path.is_dir() {
            cammina(&path, dentro);
        } else if path.extension().is_some_and(|e| e == "rs") {
            let nome = path
                .file_name()
                .expect("un file ha un nome")
                .to_string_lossy()
                .into_owned();
            dentro.push((nome, std::fs::read_to_string(&path).expect("un sorgente")));
        }
    }
}
