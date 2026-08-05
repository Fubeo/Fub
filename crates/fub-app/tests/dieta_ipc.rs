//! **La superficie IPC è un elenco chiuso** (§16.6).
//!
//! I comandi `#[tauri::command]` sono la sola porta che la shell ha e un plugin
//! no. Ogni volta che ne nasce uno, il progetto perde un pezzo della proprietà
//! che dichiara di avere — *«una feature ufficiale è ciò che scriverà un
//! plugin»* — e lo perde in silenzio, perché aggiungere una riga a
//! `generate_handler!` non rompe niente e non chiede il permesso a nessuno.
//! Questo test è il permesso: aggiungerne uno costa una riga qui sotto, e quella
//! riga porta **la ragione per cui non poteva essere un comando del registro,
//! una view o una query**.
//!
//! Non è un test di comportamento: è un test sul **sorgente**. Legge
//! `src/lib.rs` con `include_str!` — che è anche ciò che lo fa ricompilare
//! quando quel file cambia — e ne estrae due insiemi che ricava per strade
//! indipendenti:
//!
//! 1. **i comandi definiti**, cioè i nomi di funzione che seguono un vero
//!    `#[tauri::command]`;
//! 2. **i comandi registrati**, cioè i nomi dentro `tauri::generate_handler!`.
//!
//! **Questo test sa di `lib.rs`, e di nient'altro** — ed è la sua zona cieca,
//! misurata provandola: una seconda superficie IPC dichiarata in un altro file
//! dello stesso crate e montata con un `.plugin()` che porti il proprio
//! `generate_handler!` passerebbe di qui **verde**, e sarebbe raggiungibile dal
//! webview come `plugin:<nome>|<comando>`. Un presidio che legge un file sa quel
//! file; a vedere gli altri è un conto che cammina la cartella, e i file di
//! `crates/fub-app/src` in cui compare un `#[tauri::command]` o un
//! `generate_handler!` sono **uno** [conta: file-con-superficie-ipc]. È la stessa
//! zona cieca che la [0106](../../../docs/decisions/0106-un-formato-si-presenta.md)
//! ha misurato sul presidio che da qui ha copiato la forma, e ha la stessa
//! risposta: il conto prende ciò che sta fuori dal file che il test legge.
//!
//! Poi li confronta fra loro e con l'allowlist, **in tutte e due le direzioni**
//! ogni volta. La direzione che si vede subito è «ne è comparso uno»; quella che
//! conta quasi altrettanto è «ne è sparito uno», perché un elenco che resta
//! lungo mentre il codice si accorcia smette di essere una fotografia e diventa
//! un ricordo — la stessa disciplina di `ALLOWED_TRANSITIVE_ABI` in
//! `crates/fub-abi/tests/dependency_invariant.rs`.
//!
//! **L'estrattore salta la prosa, ed è la trappola per cui esiste il test del
//! test qui in fondo.** Un `grep` ingenuo di `#[tauri::command]` su `src/lib.rs`
//! ne conta **trentanove**: due sono dentro il doc-comment di modulo, che quel
//! confine lo *descrive*. Un'allowlist che nascesse contando anche quelle
//! nascerebbe già rotta, e — peggio — nascerebbe rotta di due righe che nessuno
//! andrebbe a cercare, perché un elenco di trentanove nomi lo si legge una volta
//! sola. Le righe di commento non sono codice, e qui è letteralmente vero: sono
//! il posto in cui il file spiega perché quel confine è fatto così.

use std::collections::{BTreeMap, BTreeSet};

/// Il sorgente che questo test giudica. `include_str!` e non `std::fs`: così il
/// legame è una dipendenza di compilazione e non un path da tenere aggiornato a
/// mano — se il file si sposta, non compila.
const SORGENTE: &str = include_str!("../src/lib.rs");

/// Il contratto, letto per una ragione sola: una riga dell'allowlist che dice
/// «questa è la capacità `X`» deve nominare una `X` che **esiste**.
///
/// È la sesta specie del §16.7 — la *garanzia dichiarata che non è mai esistita*
/// — presa dal verso in cui si può presidiare: una frase che rimanda a qualcosa
/// di meccanico deve rimandare a un nome che una macchina sa cercare.
const CONTRATTO: &str = include_str!("../../fub-abi/src/traits.rs");

// ---------------------------------------------------------------------------
// Le ragioni
// ---------------------------------------------------------------------------

/// **Perché quel comando non poteva essere altro.**
///
/// L'allowlist non è un elenco di nomi: un elenco di nomi si allunga di una riga
/// senza pensare, ed è esattamente il gesto da rendere costoso. Ogni riga porta
/// una di queste sei ragioni, e sceglierla è il lavoro — se nessuna si applica,
/// la risposta non è inventarne una settima: è che quel comando doveva essere un
/// comando del registro, una view o una query.
///
/// La riga che divide, e che va usata per prima, è della
/// [decisione 0013](../../../docs/decisions/0013-elenco-delle-capacita.md): *un
/// comando fa accadere qualcosa e risponde con un messaggio e un effetto; ciò
/// che risponde con **dati** non può essere un comando — un `CommandOutcome` non
/// li porta — e resta sul canale di lettura.*
#[derive(Debug, PartialEq, Eq)]
enum Perche {
    /// **La superficie dell'app**: finestre, dialoghi, ciclo di vita di un
    /// vault, la memoria che questa macchina ha dei vault, e ciò che *compone*
    /// il kernel invece di viverci dentro.
    ///
    /// Non esiste un registro a cui chiederlo, perché è il registro stesso a
    /// vivere dentro un vault aperto: queste righe stanno o **prima** (aprire),
    /// o **sopra** (sceglierne uno fra due, ricordarseli fra un avvio e
    /// l'altro), o **attorno** (accendere un componente, fermare un lavoro che
    /// gira di fianco). Un `plugins.set-enabled` nel registro sarebbe la porta
    /// con cui il registro modifica sé stesso, e potrebbe spegnere il provider
    /// che lo sta eseguendo; un `job.cancel` nel registro chiederebbe al kernel
    /// di fermare qualcosa che il kernel non fa girare — è sincrono e non
    /// possiede thread, e chi ha i thread è l'app (0013, 0032).
    SuperficieDellApp,
    /// **Il ponte generico**: è il comando con cui la shell raggiunge il
    /// registro, il canale dati o le view. Uno solo per canale, e non cresce con
    /// le feature — è precisamente ciò che l'allowlist esiste per preservare.
    ///
    /// Sono sei e non tre perché ogni canale ha la sua metà *discovery* accanto
    /// alla sua metà *invoke*: la shell non cabla nessun id, disegna ciò che
    /// legge. Il canale dati la discovery non ce l'ha, ed è la ragione per cui
    /// `query_index` è uno solo: la domanda è un dato anche lei.
    Ponte,
    /// **La capacità e la sua porta.** L'atto è già nell'elenco chiuso
    /// dell'`HostApi` (0013), e la shell **non è un plugin**: non ha un manifest
    /// a cui concederlo, quindi lo raggiunge da una porta col suo nome invece
    /// che dal trait.
    ///
    /// È la categoria che si può tenere senza paura, perché non cresce da sola:
    /// cresce solo se cresce l'elenco delle capacità, che dal freeze in poi è una
    /// minor da discutere una per una. Il payload dice **quale** capacità c'è
    /// dall'altra parte, così la simmetria è controllabile a occhio: se un nome
    /// qui non corrisponde a niente nel contratto, la riga è una bugia.
    CapacitaDelContratto(&'static str),
    /// **La porta è la credenziale.** Ciò che rende legittimo l'atto è *chi
    /// bussa*, e una porta generica lascerebbe che a dirlo fosse chiunque.
    ///
    /// È la [decisione 0012](../../../docs/decisions/0012-origine-degli-eventi.md)
    /// applicata alla configurazione e allo stato di vista: da qui passa **la
    /// persona davanti allo schermo** — che ha cliccato su un interruttore — e da
    /// `settings.set` del registro passa un *programma*, che tocca solo le chiavi
    /// dichiarate scrivibili da un programma. Se fossero la stessa strada, o
    /// l'utente non potrebbe cambiare le proprie impostazioni di privacy, o un
    /// plugin potrebbe. Per lo stato di vista è la stessa riga un piano più in
    /// giù: proprietario ed esemplare li timbra **questa porta**, e se
    /// arrivassero da JS una pagina qualunque potrebbe rileggere lo stato di
    /// vista di un provider (0035, 0037). E il contesto attivo e il locale di
    /// sistema sono fatti che **solo la shell sa**: quale nota si sta guardando è
    /// una decisione dell'app e non una capacità
    /// ([0007](../../../docs/decisions/0007-contesto-di-sessione.md)), e `Intl` ce
    /// l'ha il webview.
    LaPortaEUnaCredenziale,
    /// **Aspetta un cliente.** Passerebbe la riga che divide come comando — fa
    /// accadere qualcosa e non risponde con dati — ma il registro non lo può
    /// servire: un `CommandProvider` ha in mano l'`HostApi` e nient'altro, e per
    /// queste scritture una capacità **non c'è**.
    ///
    /// E non c'è per decisione, non per dimenticanza: *una capacità concessa a
    /// nessuno è superficie da mantenere e sandboxare per sempre* (0013), e
    /// nessun plugin ha ancora chiesto di appuntare una nota o di dare un'icona a
    /// una cartella. Il prezzo è dichiarato e va guardato in faccia: oggi
    /// `IndexQuery::Organization` lascia **leggere** l'organizzazione a chiunque
    /// e queste quattro porte lasciano **scrivere** solo alla shell, che è
    /// l'asimmetria che il canale dati esiste per non avere. Il giorno che
    /// qualcuno la chiede, la capacità entra (additiva) e queste diventano
    /// comandi del registro come le cinque strutturali.
    AspettaUnCliente,
    /// **Debito dichiarato**: risponde con DATI, quindi per la riga che divide
    /// (0013) non può essere un comando e va sul canale di lettura; oppure è un
    /// comando vero ma bespoke, e va nel registro.
    ///
    /// `verso` è la destinazione, e il conto di questi è presidiato da un test a
    /// parte: migrarne uno costringe a toccare un numero, e chiudere l'ultimo
    /// costringe ad accorgersene.
    DaMigrare { verso: &'static str },
}

// ---------------------------------------------------------------------------
// L'allowlist
// ---------------------------------------------------------------------------

/// **I comandi Tauri di Fub, tutti e soli, con la loro ragione.**
///
/// Fotografia, non ricordo: un nome che compare qui senza un comando vero è
/// rosso quanto un comando vero che non compare qui.
const ALLOWLIST: &[(&str, Perche)] = &[
    // --- prima, sopra e attorno al kernel -----------------------------------
    //
    // Aprire un vault è *montare* il kernel: finché non è montato non c'è un
    // registro a cui chiedere, e la domanda «quali vault ci sono» non appartiene
    // a nessuno dei vault che nomina.
    ("open_vault", Perche::SuperficieDellApp),
    ("close_vault", Perche::SuperficieDellApp),
    ("list_vaults", Perche::SuperficieDellApp),
    ("set_current_vault", Perche::SuperficieDellApp),
    ("initial_vault", Perche::SuperficieDellApp),
    // L'anagrafe della macchina (§11.1): esiste prima di ogni vault, e sopravvive
    // a tutti. Un vault dimenticato non ha un indice che se ne ricordi.
    ("known_vaults", Perche::SuperficieDellApp),
    ("set_vault_favorite", Perche::SuperficieDellApp),
    ("set_vault_look", Perche::SuperficieDellApp),
    ("forget_vault", Perche::SuperficieDellApp),
    // Chi questo host sa montare, e chi è acceso: «spento» e «non c'è» sono due
    // stati diversi, e il secondo è l'unico che il kernel sappia dire (0031).
    ("list_bundles", Perche::SuperficieDellApp),
    ("set_plugin_enabled", Perche::SuperficieDellApp),
    // Fermare un lavoro lungo (§10.3): *elencarli* è una query (`IndexQuery::Jobs`,
    // sono dati), fermarne uno no — e il runner è dell'app, non del kernel (0032).
    ("cancel_job", Perche::SuperficieDellApp),
    // I tasti che un vault propone e che nessuno ha guardato (§23.13). È la
    // stessa riga di `known_vaults`, e il primo dei tre è quello che vale la
    // pena difendere perché **risponde con dei dati**: la regola direbbe
    // `query_index`, e non regge qui, perché la risposta non si ricava dal
    // vault. Si ricava mettendo il file del vault accanto a ciò che **questa
    // macchina** ha già visto, che è nel registro dei vault — cioè fuori da ogni
    // vault, per la ragione della 0029: un elenco di vault non sta in nessun
    // vault. Un `IndexQuery` che rispondesse sarebbe il canale dati di un vault
    // che legge l'installazione. Gli altri due sono la risposta della persona
    // davanti allo schermo, e scrivono nello stesso registro.
    ("pending_keybindings", Perche::SuperficieDellApp),
    ("adopt_keybindings", Perche::SuperficieDellApp),
    ("discard_keybindings", Perche::SuperficieDellApp),
    // --- i tre ponti, in due metà ciascuno ----------------------------------
    ("list_views", Perche::Ponte),
    ("render_view", Perche::Ponte),
    ("view_action", Perche::Ponte),
    ("list_commands", Perche::Ponte),
    ("invoke_command", Perche::Ponte),
    ("query_index", Perche::Ponte),
    // --- le capacità dell'elenco chiuso, affacciate sull'IPC ----------------
    (
        "read_document",
        Perche::CapacitaDelContratto("VaultRead::read_document"),
    ),
    (
        "write_document",
        Perche::CapacitaDelContratto("VaultWrite::write_document"),
    ),
    // Qui stavano `list_trash` e `propose_free_name`, ed erano due righe
    // legittime: due capacità del contratto affacciate alla shell. Se ne sono
    // andate col pannello cestino, che dal §1.2 è un `ViewProvider` e le chiede
    // dall'altro lato del confine. Non è una migrazione — non hanno cambiato
    // canale, hanno perso il chiamante — ed è il modo in cui questo elenco
    // accorcia più spesso: non spostando una porta, ma smettendo di averne
    // bisogno.
    // --- ciò che vale perché lo dice questa porta ---------------------------
    ("set_active_context", Perche::LaPortaEUnaCredenziale),
    ("set_system_locale", Perche::LaPortaEUnaCredenziale),
    ("set_setting", Perche::LaPortaEUnaCredenziale),
    ("reset_setting", Perche::LaPortaEUnaCredenziale),
    ("view_state", Perche::LaPortaEUnaCredenziale),
    ("set_view_state", Perche::LaPortaEUnaCredenziale),
    // --- l'organizzazione del vault (§11.3): scritture senza richiedente ----
    ("set_icon", Perche::AspettaUnCliente),
    ("set_pinned", Perche::AspettaUnCliente),
    ("set_space", Perche::AspettaUnCliente),
    ("set_order", Perche::AspettaUnCliente),
    // --- il buffer di crash (§15.2): la stessa forma, e una ragione in più ---
    //
    // Passerebbero la riga che divide — fanno accadere qualcosa, rispondono con
    // niente — e il registro non le può servire perché una capacità non c'è. Qui
    // però l'assenza non è «nessuno l'ha ancora chiesta»: è **deliberata e
    // definitiva**. Il testo che l'utente non ha ancora salvato è il dato più
    // privato che un vault contenga, e una capacità `draft_write` lo
    // consegnerebbe a ogni plugin montato — compresi quelli che a M5 non
    // scriviamo noi. Chi ha bisogno di scriverci è la shell, che non è un
    // plugin: qui la porta **non** aspetta un cliente, aspetta di non averne mai.
    // La lettura invece è già sul canale di tutti (`IndexQuery::Drafts`), perché
    // leggere ciò che si stava scrivendo è ciò che un pannello di recupero fa.
    ("save_draft", Perche::AspettaUnCliente),
    ("discard_draft", Perche::AspettaUnCliente),
    // --- il debito, che il §16.6 nomina e che qui si conta ------------------
    //
    // Il versioning **non è più qui**, e le sue tre righe sono la lezione più
    // utile che questo elenco abbia dato finora. Erano classificate «due letture
    // → `IndexQuery`» e «un comando → il registro», e la classificazione era
    // giusta a metà: il comando è diventato davvero un comando del registro
    // (`version.restore`), ma le due letture non sono migrate da nessuna parte —
    // sono **sparite**, perché chi le faceva era il pannello cronologia di
    // questa shell, e dal §1.2 la cronologia è un `ViewProvider` della feature
    // versioning, che legge dal proprio spazio dati.
    //
    // Cioè: la domanda giusta davanti a un bespoke non è sempre *su che canale
    // lo sposto*, è prima *chi lo chiama, e da che parte del confine dovrebbe
    // stare*. Un `IndexQuery::Versions` scritto a suo tempo sarebbe oggi una
    // rotta del contratto che nessuno percorre.
    // Restano due, che il §16.6 **non** nominava, trovate applicando lo stesso metro.
    //
    // `render_preview` risponde con un `RenderedDocument` e `render_embed` con un
    // `EmbedContent`: sono dati, e nessuna delle due è il ponte generico, una
    // capacità dell'elenco chiuso o un fatto che solo la shell sappia. La
    // conseguenza è quella di sempre — un `ViewProvider` che volesse mostrare un
    // documento reso non ha nessuna porta, mentre la shell ce l'ha — ed è la
    // stessa asimmetria che ha portato `search`, `list_tags`, `graph_data`,
    // `backlinks` e `resolve_link` dentro `query_index`.
    //
    // Il precedente esatto è `IndexQuery::Outline`, che sta lì per essere «il
    // modo con cui una view legge la struttura parsata senza avere un
    // `FormatProvider`»: un documento reso è la stessa domanda un passo più in
    // là, senza avere un `RendererProvider`. La
    // [decisione 0018](../../../docs/decisions/0018-chi-vede-il-modello-parsato.md)
    // ha confermato `render_preview` come «fast-path della lettura», ma
    // rispondeva a un'altra domanda — *il modello attraversa l'IPC?*, e la
    // risposta è no — non a *da quale porta passa la lettura*.
    (
        "render_preview",
        Perche::DaMigrare {
            verso: "IndexQuery",
        },
    ),
    (
        "render_embed",
        Perche::DaMigrare {
            verso: "IndexQuery",
        },
    ),
];

/// L'allowlist per nome, con il rifiuto dei doppioni: due righe con lo stesso
/// comando vorrebbero dire due ragioni per la stessa cosa, e la seconda
/// resterebbe non letta per sempre.
fn allowlist() -> BTreeMap<&'static str, &'static Perche> {
    let mut out = BTreeMap::new();
    for (nome, perche) in ALLOWLIST {
        assert!(
            out.insert(*nome, perche).is_none(),
            "`{nome}` compare due volte nell'allowlist: la seconda ragione non la\n\
             leggerà mai nessuno."
        );
    }
    out
}

// ---------------------------------------------------------------------------
// I due estrattori
// ---------------------------------------------------------------------------

/// `true` se la riga è **prosa**: un commento di riga, di documentazione o di
/// modulo.
///
/// È la sola regola che separa il codice dal discorso sul codice in questo file,
/// e basta perché `src/lib.rs` non contiene nessun commento a blocco — cosa che
/// [`nessun_commento_a_blocco`] verifica, invece di darla per buona. Se un
/// giorno ne comparisse uno, quel test diventa rosso **prima** che questo si
/// metta a contare male: è l'ordine giusto dei due, perché un estrattore che
/// conta male non fallisce, dice un numero.
fn e_prosa(riga: &str) -> bool {
    riga.trim_start().starts_with("//")
}

/// **I comandi definiti**: i nomi di funzione che seguono un vero
/// `#[tauri::command]`.
///
/// Fra l'attributo e la firma può starcene un altro (`view_action` porta un
/// `#[allow(clippy::too_many_arguments)]`), e quelli si saltano. Tutto il resto è
/// un errore e non un'omissione: se dopo l'attributo non arriva una `fn`, questo
/// test si ferma invece di indovinare. Un estrattore che ignora ciò che non
/// capisce trasforma un comando in un comando *assente*, e l'assenza è proprio
/// ciò che qui si deve saper vedere.
fn comandi_definiti(src: &str) -> BTreeSet<&str> {
    let mut out = BTreeSet::new();
    let mut atteso: Option<usize> = None;

    for (n, riga) in src.lines().enumerate() {
        if e_prosa(riga) {
            continue;
        }
        let t = riga.trim();

        if t.starts_with("#[tauri::command") {
            assert!(
                atteso.is_none(),
                "riga {}: due `#[tauri::command]` di fila senza una `fn` in mezzo",
                n + 1
            );
            atteso = Some(n + 1);
            continue;
        }
        assert!(
            !t.contains("#[tauri::command"),
            "riga {}: `#[tauri::command]` non è all'inizio della riga, e questo\n\
             estrattore non sa leggerlo:\n  {t}",
            n + 1
        );

        let Some(riga_attributo) = atteso else {
            continue;
        };
        // Altri attributi fra l'`#[tauri::command]` e la firma.
        if t.starts_with("#[") {
            continue;
        }

        let firma = t.strip_prefix("pub ").unwrap_or(t);
        let resto = firma.strip_prefix("fn ").unwrap_or_else(|| {
            panic!(
                "riga {riga_attributo}: dopo `#[tauri::command]` non c'è una `fn`, ma:\n  {t}\n\
                 Se la forma è legittima, allarga l'estrattore — non lasciare che un\n\
                 comando sparisca da un elenco che serve a vedere ciò che compare."
            )
        });
        let nome = resto
            .split(|c: char| !(c.is_alphanumeric() || c == '_'))
            .next()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| panic!("riga {}: `fn` senza un nome:\n  {t}", n + 1));

        assert!(
            out.insert(nome),
            "il comando `{nome}` è definito due volte (riga {})",
            n + 1
        );
        atteso = None;
    }

    assert!(
        atteso.is_none(),
        "il file finisce con un `#[tauri::command]` (riga {}) che non ha una firma sotto",
        atteso.unwrap_or(0)
    );
    out
}

/// **I comandi registrati**: i nomi dentro `tauri::generate_handler![ … ]`.
///
/// Il blocco dev'essere uno solo. Con due, uno dei due sarebbe la superficie
/// vera e l'altro un elenco che questo test non guarda — che è il modo più
/// comodo di aggiungere un comando senza che nessuno lo veda.
fn comandi_registrati(src: &str) -> BTreeSet<&str> {
    const APERTURA: &str = "tauri::generate_handler![";

    let righe: Vec<(usize, &str)> = src
        .lines()
        .enumerate()
        .filter(|(_, r)| !e_prosa(r) && r.contains(APERTURA))
        .collect();
    assert_eq!(
        righe.len(),
        1,
        "in `src/lib.rs` i blocchi `{APERTURA}` sono {}, e dev'essercene esattamente\n\
         uno: è la superficie che questo test presidia.",
        righe.len()
    );
    let prima = righe[0].0;

    let mut out = BTreeSet::new();
    let mut dentro = false;
    for (n, riga) in src.lines().enumerate().skip(prima) {
        if e_prosa(riga) {
            continue;
        }
        let mut t = riga.trim();
        if !dentro {
            let Some((_, coda)) = t.split_once(APERTURA) else {
                continue;
            };
            dentro = true;
            t = coda;
        }
        let chiusura = t.contains(']');
        for pezzo in t.trim_end_matches([']', ')']).split(',') {
            let nome = pezzo.trim();
            if nome.is_empty() {
                continue;
            }
            assert!(
                nome.chars().all(|c| c.is_alphanumeric() || c == '_'),
                "riga {}: dentro `generate_handler!` c'è `{nome}`, che non è un nome di\n\
                 funzione. Questo estrattore legge un elenco di identificatori separati\n\
                 da virgole, e si ferma su tutto il resto.",
                n + 1
            );
            assert!(
                out.insert(nome),
                "riga {}: `{nome}` è registrato due volte",
                n + 1
            );
        }
        if chiusura {
            return out;
        }
    }
    panic!("`{APERTURA}` non si chiude mai: manca la `]`");
}

/// Come si scrive un insieme in un messaggio d'errore: in ordine, sulla stessa
/// riga, senza le virgolette del `Debug` — sono nomi di funzione, e chi legge li
/// deve poter cercare.
fn elenca(nomi: &BTreeSet<&str>) -> String {
    nomi.iter().copied().collect::<Vec<_>>().join(", ")
}

// ---------------------------------------------------------------------------
// Le reti
// ---------------------------------------------------------------------------

/// La rete che non costa niente e che va tesa lo stesso.
///
/// Un comando **registrato e non definito** non compilerebbe, quindi questa metà
/// è gratis e non prende mai niente. L'altra invece prende: un comando
/// **definito e mai registrato** compila benissimo, non lo chiama nessuno, e
/// resta lì a somigliare a codice vivo — di solito perché qualcuno l'ha tolto da
/// `generate_handler!` senza toglierlo dal file. Nessun altro presidio lo vede,
/// perché `cargo` una `fn` privata inutilizzata dentro un `lib` che la esporta ai
/// suoi test non la nomina.
#[test]
fn definiti_e_registrati_sono_lo_stesso_insieme() {
    let definiti = comandi_definiti(SORGENTE);
    let registrati = comandi_registrati(SORGENTE);

    let orfani: BTreeSet<&str> = definiti.difference(&registrati).copied().collect();
    assert!(
        orfani.is_empty(),
        "questi comandi hanno un `#[tauri::command]` e non sono in `generate_handler!`:\n  \
         {}\n\
         Dal webview non li raggiunge nessuno: o si registrano, o si cancellano. Un\n\
         comando che nessuno può invocare è codice morto vestito da superficie.",
        elenca(&orfani)
    );

    let fantasmi: BTreeSet<&str> = registrati.difference(&definiti).copied().collect();
    assert!(
        fantasmi.is_empty(),
        "questi nomi sono in `generate_handler!` e non sono definiti in questo file:\n  \
         {}\n\
         (Non dovrebbe compilare: se sei qui, l'estrattore ha letto male.)",
        elenca(&fantasmi)
    );
}

/// **Il cuore**: la superficie registrata è l'allowlist, nei due versi.
#[test]
fn la_superficie_ipc_e_un_elenco_chiuso() {
    let registrati = comandi_registrati(SORGENTE);
    let dichiarati: BTreeSet<&str> = allowlist().keys().copied().collect();

    let nuovi: BTreeSet<&str> = registrati.difference(&dichiarati).copied().collect();
    assert!(
        nuovi.is_empty(),
        "la superficie IPC è cresciuta di: {}\
         \n\
         \nVa **dichiarata**, e dichiararla vuol dire scrivere in `ALLOWLIST`\
         \n(crates/fub-app/tests/dieta_ipc.rs) perché quel comando non poteva essere:\
         \n\
         \n  - un **comando del registro** — dichiaralo in un `CommandProvider` e\
         \n    arriva alla palette, alla tastiera, alle macro e alla CLI da solo,\
         \n    con i suoi parametri e il suo raggio;\
         \n  - una **view** — se disegna qualcosa, è un `ViewProvider` e passa da\
         \n    `render_view`/`view_action`, come il pannello backlink;\
         \n  - una **query** — se risponde con dei DATI non può essere un comando:\
         \n    un `CommandOutcome` porta un messaggio e un effetto, non dati, e i\
         \n    dati hanno un canale solo (`query_index`, decisione 0013).\
         \n\
         \nSe davvero non poteva essere nessuna delle tre, la ragione è una riga\
         \nnell'enum `Perche` — e se nessuna delle sei che ci sono si applica, la\
         \nrisposta quasi sempre è che poteva.",
        elenca(&nuovi)
    );

    let spariti: BTreeSet<&str> = dichiarati.difference(&registrati).copied().collect();
    assert!(
        spariti.is_empty(),
        "l'allowlist dichiara {} che in `generate_handler!` non c'è più.\n\
         Toglilo da `ALLOWLIST`: l'elenco è una fotografia, non un ricordo. Se è stato\n\
         migrato, il posto giusto in cui festeggiarlo è il conteggio dei `DaMigrare`.",
        elenca(&spariti)
    );
}

/// **Il debito residuo del §16.6 è un numero, non una riga di prosa.**
///
/// La voce di roadmap che ha generato questo test si accusa da sola di avere un
/// conto scritto a mano che è diventato falso senza che nessuno se ne accorgesse
/// — «38 oggi», mentre i comandi sono trentasette. Un numero in un documento non
/// diventa mai rosso. Questo sì: migrarne uno obbliga a toccarlo, e chiudere
/// l'ultimo obbliga ad accorgersene, che è il momento in cui questa voce si può
/// barrare.
#[test]
fn il_debito_dichiarato_e_un_numero_presidiato() {
    let da_migrare: Vec<String> = ALLOWLIST
        .iter()
        .filter_map(|(nome, perche)| match perche {
            Perche::DaMigrare { verso } => Some(format!("{nome} → {verso}")),
            _ => None,
        })
        .collect();

    assert_eq!(
        da_migrare.len(),
        2,
        "i comandi ancora da migrare sono {} e non 2:\n  {}\n\
         Aggiorna il numero in questo test. Se sei arrivato a zero, il §16.6 ha finito\n\
         il suo debito e questa asserzione è la riga che te lo dice.",
        da_migrare.len(),
        da_migrare.join("\n  ")
    );
}

/// **Le capacità nominate esistono davvero.**
///
/// Una riga che dice «questo comando è la porta di `VaultRead::list_trash`» è
/// una garanzia, e una garanzia che nomina un metodo scomparso è peggio di
/// nessuna garanzia: chi la legge smette di controllare. Il §16.7 ha una specie
/// apposta per questo difetto, ed è quella che le batte tutte perché *il motivo
/// per cui si scrive una garanzia è smettere di doverci pensare*.
///
/// Il presidio è quello che la voce stessa indica: il nome deve essere una cosa
/// che si cerca meccanicamente. Qui si cerca il metodo **dentro** il suo trait,
/// non in tutto il file — o spostare `list_trash` da `VaultRead` a
/// `VaultStructure` resterebbe verde, e la riga direbbe la cosa sbagliata con
/// l'aria di dirla giusta.
#[test]
fn ogni_capacita_nominata_esiste_nel_contratto() {
    for (comando, perche) in ALLOWLIST {
        let Perche::CapacitaDelContratto(capacita) = perche else {
            continue;
        };
        let (tratto, metodo) = capacita.split_once("::").unwrap_or_else(|| {
            panic!("`{comando}`: `{capacita}` non è nella forma `Trait::metodo`")
        });

        let apertura = format!("pub trait {tratto}");
        let inizio = CONTRATTO
            .lines()
            .position(|r| r.starts_with(&apertura))
            .unwrap_or_else(|| {
                panic!(
                    "`{comando}` dichiara la capacità `{capacita}`, ma nel contratto non\n\
                     c'è nessun `{apertura}`. Il trait è stato rinominato o smembrato:\n\
                     aggiorna la riga, o togli la capacità e cambia la ragione."
                )
            });
        let firma = format!("fn {metodo}(");
        let trovata = CONTRATTO
            .lines()
            .skip(inizio + 1)
            .take_while(|r| !r.starts_with('}'))
            .any(|r| r.trim_start().starts_with(&firma));
        assert!(
            trovata,
            "`{comando}` dichiara la capacità `{capacita}`, e `{tratto}` non ha nessun\n\
             `{firma}`. O il metodo è stato rinominato, o è migrato in un altro trait —\n\
             in tutti e due i casi questa riga sta garantendo una simmetria che non c'è."
        );
    }
}

// ---------------------------------------------------------------------------
// I test dei test
// ---------------------------------------------------------------------------

/// La regola «la prosa non conta» vale finché i commenti sono di riga. Un
/// `/* … */` la aggirerebbe in silenzio — e in silenzio è la parola importante:
/// l'estrattore non fallirebbe, direbbe un numero.
#[test]
fn nessun_commento_a_blocco() {
    for (n, riga) in SORGENTE.lines().enumerate() {
        assert!(
            !riga.contains("/*"),
            "riga {}: `src/lib.rs` ha un commento a blocco, e `e_prosa` sa saltare solo\n\
             quelli di riga. O il commento diventa `//`, o l'estrattore impara i blocchi.",
            n + 1
        );
    }
}

/// **La trappola, messa in un banco.** Il doc-comment di modulo di `src/lib.rs`
/// nomina `#[tauri::command]` due volte parlando del confine, e altri quattro
/// file del workspace fanno lo stesso: un estrattore che conta la prosa conta
/// trentanove dove ce ne sono trentasette, e l'allowlist nasce sbagliata di due
/// righe che nessuno andrà a cercare.
#[test]
fn l_estrattore_non_conta_la_prosa() {
    let finto = "\
//! Un modulo che parla di `#[tauri::command]` e ne descrive uno:\n\
//! #[tauri::command]\n\
//! fn non_esisto() {}\n\
\n\
/// Il doc di una funzione, che cita `#[tauri::command]` per spiegarsi.\n\
#[tauri::command]\n\
fn vero(host: State<Host>) -> bool { true }\n\
\n\
    // #[tauri::command]\n\
    // fn commentato_via() {}\n\
\n\
#[tauri::command]\n\
#[allow(clippy::too_many_arguments)]\n\
pub fn con_un_attributo_in_mezzo() {}\n\
\n\
        .invoke_handler(tauri::generate_handler![\n\
            vero,\n\
            // non_esisto,\n\
            con_un_attributo_in_mezzo,\n\
        ])\n";

    let attesi = BTreeSet::from(["vero", "con_un_attributo_in_mezzo"]);
    assert_eq!(comandi_definiti(finto), attesi);
    assert_eq!(comandi_registrati(finto), attesi);
}

/// E deve fermarsi su ciò che non capisce, invece di far sparire un comando.
#[test]
#[should_panic(expected = "dopo `#[tauri::command]` non c'è una `fn`")]
fn l_estrattore_rifiuta_cio_che_non_sa_leggere() {
    comandi_definiti("#[tauri::command]\nstruct QualcosaDiNuovo;\n");
}

/// Il ponte è il ponte: se un giorno ne comparisse un secondo per lo stesso
/// canale, questo test non se ne accorgerebbe da solo — ma l'allowlist sì,
/// perché il nome nuovo sarebbe da dichiarare. Qui si presidia la sola cosa che
/// il ponte promette e che si può contare: **uno per metà di canale**, sei in
/// tutto, e non cresce con le feature.
#[test]
fn i_ponti_restano_sei() {
    let ponti: Vec<&str> = ALLOWLIST
        .iter()
        .filter(|(_, p)| *p == Perche::Ponte)
        .map(|(n, _)| *n)
        .collect();
    assert_eq!(
        ponti.len(),
        6,
        "i comandi-ponte sono {}: {ponti:?}.\n\
         Sono tre canali per due metà (elenca / usa): view, comandi e — il canale\n\
         dati, che la metà discovery non ce l'ha perché la domanda è un dato anche\n\
         lei. Un settimo ponte vuol dire un canale nuovo, e un canale nuovo è una\n\
         decisione da mettere a verbale, non una riga in più qui.",
        ponti.len()
    );
}
