//! **`serialize` non è la strada per riscrivere un documento che esiste.**
//!
//! Il doc di [`FormatProvider::serialize`](fub_abi::FormatProvider::serialize)
//! lo dice alla lettera — *«il kernel non riscrive mai un file esistente passando
//! da qui»* — e fino a questo file era **solo una frase**. È la sesta specie del
//! [§16.8](../../../docs/roadmap/16-crate-sdk-banchi-di-prova.md): la *garanzia
//! dichiarata*, quella che batte tutte le altre perché il motivo per cui si
//! scrive una garanzia è smettere di doverci pensare — un conteggio qualcuno
//! prima o poi lo ricontrolla, una rete che si crede tesa non la guarda nessuno.
//!
//! # Il danno, e chi lo causerà
//!
//! Il modello è **lossy per costruzione**: non conserva i commenti dello YAML,
//! l'ordine delle chiavi del frontmatter, lo stile delle virgolette, la
//! spaziatura dei blocchi, lo stile dell'enfasi. Sono, una per una, le voci del
//! secondo gruppo della §2.4 di [FEATURES.md](../../../docs/FEATURES.md) — *cosa
//! si preserva quando invece si scrive*.
//!
//! `edit.rs` elenca fra i clienti di `apply_edit` «scrivere una proprietà (8.2)»,
//! «spuntare un task (10.1)», «correggere un link rotto (7.2)». Nessuno dei tre è
//! implementato, e il giorno che qualcuno li implementa la strada comoda è
//! `read_model` → muta il `frontmatter` → `serialize` → `write_document`: quattro
//! chiamate che esistono tutte e che **compilano**. Il risultato è che ogni nota
//! toccata perde tutto quell'elenco, e non c'è niente di rosso da nessuna parte.
//! Chi se ne accorge è chi tiene il vault sotto git.
//!
//! La strada giusta è la [decisione
//! 0008](../../../docs/decisions/0008-modifica-chirurgica.md): una patch
//! chirurgica sulla sorgente, guidata dagli `Span`, con la revisione su cui è
//! stata calcolata — [`EditRequest`](fub_abi::edit::EditRequest).
//!
//! # La forma: un elenco chiuso dei punti di chiamata
//!
//! È la **seconda rete** di `dependency_invariant.rs` — l'allowlist delle
//! dipendenze dirette —
//! applicata a una funzione invece che a una dipendenza, e per la stessa ragione:
//! *intercetta il gesto*. Aggiungere una chiamata a `serialize` diventa una
//! modifica a questo file, cioè una decisione presa e non un gesto distratto.
//!
//! Non è la maglia più fine possibile — quella sarebbe una barriera di tipo, e
//! costa una firma diversa nel contratto, che è additivo e vicino al freeze. È la
//! maglia che il repo sa già tessere, e che nasce **verde**: oggi nessun codice
//! di produzione chiama `FormatProvider::serialize` fuori dal provider che lo
//! implementa, ed è il momento giusto per tenderla.
//!
//! # Cosa guarda, e cosa non guarda
//!
//! Guarda ogni `.rs` sotto una cartella `src/`, ovunque nel repo — non un elenco
//! di crate scritto a mano, che sarebbe il difetto della §16.7 dentro al presidio
//! che lo cura. Non guarda i `tests/`: un test che chiama `serialize` per
//! verificare cosa `serialize` genera è esattamente ciò che deve fare, e la
//! garanzia riguarda ciò che viene spedito. Non guarda i moduli `#[cfg(test)]`
//! dentro i `src/`, per la stessa ragione.
//!
//! **Le maglie che lasciano passare, dette qui e non altrove.** Questo test legge
//! i sorgenti come *testo*, quindi lo aggirano: un `use … as` con un alias, una
//! macro che compone la chiamata, un puntatore a funzione preso senza nominare il
//! metodo. Restano fuori portata anche i moduli di prova qui sopra. Ciò che
//! **non** lo aggira è il gesto vero — `provider.serialize(&model)` scritto nel
//! kernel, in `fub-host`, in `fub-app` o in una feature ufficiale — perché
//! quella è la strada comoda, ed è comoda proprio perché non ci si mette
//! ingegno. Una rete a maglie larghe messa dove il pesce passa vale più di una
//! rete stretta messa altrove; dichiararlo serve a non credere che copra il
//! resto (§16.7, il *limite dichiarato*: se una copertura ha un limite, il limite
//! va scritto accanto alla copertura).
//!
//! # Il test è più stretto della frase che presidia
//!
//! La frase vieta di riscrivere un file **esistente**; questo test vieta al
//! kernel di *nominare* `serialize`, punto. La differenza è deliberata: «questo
//! sorgente finisce in un file che non c'era» non è una proprietà che si legga in
//! un `.rs`. Il giorno in cui il kernel genererà davvero un documento nuovo — un
//! template, «crea nota» — quella riga sarà rossa, e la risposta giusta sarà
//! aggiungerla all'allowlist con una ragione nuova nell'enum [`Perche`]. Cioè una
//! decisione, che è il punto.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

/// Il contratto, letto per una ragione sola: questo file presidia **una frase**,
/// e una frase che sparisce lascerebbe in piedi un test che difende una regola
/// che nessuno dichiara più.
///
/// `include_str!` e non `std::fs`: così il legame è una dipendenza di
/// compilazione: se `format.rs` si sposta, questo test non compila.
const CONTRATTO: &str = include_str!("../src/format.rs");

/// La frase, alla lettera.
const LA_GARANZIA: &str = "Il kernel non riscrive mai un file esistente passando da qui";

/// La prosa di un sorgente Rust, tolti i marcatori di commento e appiattita su
/// una riga sola.
///
/// Serve perché una frase di doc-comment sta su più righe, e dove vada a capo
/// dipende da `rustfmt` e dalla larghezza della colonna: cercarla come sta
/// scritta vorrebbe dire un presidio che diventa rosso quando qualcuno aggiunge
/// una parola tre righe più su. Ciò che si presidia è la **frase**, non
/// l'impaginazione.
fn prosa_normalizzata(sorgente: &str) -> String {
    let mut out = String::new();
    for riga in sorgente.lines() {
        let t = riga.trim_start();
        let Some(testo) = t
            .strip_prefix("///")
            .or_else(|| t.strip_prefix("//!"))
            .or_else(|| t.strip_prefix("//"))
        else {
            continue;
        };
        for parola in testo.split_whitespace() {
            if !out.is_empty() {
                out.push(' ');
            }
            out.push_str(parola);
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Le ragioni
// ---------------------------------------------------------------------------

/// **Perché quel punto di codice può nominare `serialize`.**
///
/// Sono due, e nessuna delle due è «sto modificando un documento». Se la ragione
/// che ti serve non è qui dentro, la risposta quasi sempre non è aggiungerne una
/// terza: è che quella modifica va fatta con
/// [`HostApi::apply_edit`](fub_abi::traits::HostApi::apply_edit).
#[derive(Debug)]
enum Perche {
    /// **Non è questo `serialize`.** È l'altro — quello di `serde::Serializer`,
    /// che ha lo stesso nome e nessun rapporto con i documenti: qui sono i
    /// `u64_string::serialize` con cui un id numerico attraversa l'IPC come
    /// stringa (JavaScript non ha i 64 bit interi).
    ///
    /// Sta nell'allowlist e non in un'esclusione dell'estrattore perché
    /// distinguerli a occhio è ciò che il presidio deve costringere a fare: un
    /// filtro che togliesse «i serialize di serde» dovrebbe indovinare quale sia
    /// quale, e indovinerebbe in silenzio.
    UnAltroSerialize,
    /// **Il formato che lo implementa.** È il *corpo* del metodo del trait, che
    /// delega alla funzione libera del proprio modulo: non una chiamata a
    /// `FormatProvider::serialize`, ma ciò che quel metodo fa. E da lì un file
    /// non si riscrive comunque — un provider non ha un `HostApi` fra le mani.
    IlFormatoCheLoImplementa,
}

// ---------------------------------------------------------------------------
// L'allowlist
// ---------------------------------------------------------------------------

/// **Chi può nominare `serialize` nel codice di produzione, tutti e soli.**
///
/// Ogni riga è `(file, forma, quante volte, perché)`. Il conteggio c'è perché la
/// coppia file+forma da sola lascerebbe passare una *seconda* chiamata identica
/// nello stesso file — e una riga in più senza pensarci è precisamente il gesto
/// che questo elenco esiste per rendere costoso.
///
/// Fotografia, non ricordo: una riga qui senza una chiamata vera è rossa quanto
/// una chiamata vera senza la sua riga.
const ALLOWLIST: &[(&str, &str, usize, Perche)] = &[
    (
        "crates/fub-abi/src/event.rs",
        "u64_string::serialize",
        1,
        Perche::UnAltroSerialize,
    ),
    (
        "crates/fub-abi/src/traits.rs",
        "u64_string::serialize",
        1,
        Perche::UnAltroSerialize,
    ),
    (
        // Due, non uno: `SourceHandle` e `ArtifactHandle` (decisione 0102).
        // Stessa ragione degli altri due — sono chiavi opache che al confine
        // JSON viaggiano come stringhe.
        "crates/fub-abi/src/transfer.rs",
        "u64_string::serialize",
        2,
        Perche::UnAltroSerialize,
    ),
    (
        "crates/fub-format-markdown/src/lib.rs",
        "serialize::serialize",
        1,
        Perche::IlFormatoCheLoImplementa,
    ),
];

/// L'allowlist per chiave, col rifiuto dei doppioni: due righe per lo stesso
/// punto vorrebbero dire due ragioni per la stessa cosa, e la seconda non la
/// leggerebbe mai nessuno.
fn allowlist() -> BTreeMap<(&'static str, &'static str), (usize, &'static Perche)> {
    let mut out = BTreeMap::new();
    for (file, forma, quante, perche) in ALLOWLIST {
        assert!(
            out.insert((*file, *forma), (*quante, perche)).is_none(),
            "`{file}` + `{forma}` compare due volte nell'allowlist: somma i conteggi\n\
             in una riga sola, o la seconda ragione resta lettera morta."
        );
    }
    out
}

// ---------------------------------------------------------------------------
// I sorgenti di produzione
// ---------------------------------------------------------------------------

/// Le cartelle in cui non si entra: non contengono sorgenti del progetto, e una
/// di esse (`target`) ne contiene di generati che direbbero il falso.
const NON_SI_ENTRA: &[&str] = &["target", "node_modules", ".git", ".fub"];

/// La radice del repo, dedotta dal manifest di questo crate.
fn radice() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Ogni `.rs` che sta sotto una cartella `src/`, per percorso relativo alla
/// radice del repo e con i separatori sempre `/`.
///
/// Non c'è un elenco di crate: un crate nuovo entra nel presidio perché esiste,
/// non perché qualcuno si è ricordato di scriverlo qui. Che il cammino funzioni
/// davvero non è dato per buono — lo verifica
/// [`il_cammino_trova_il_contratto`], e prima ancora lo verifica il confronto
/// nei due versi: se questa funzione tornasse a vuoto, le tre righe
/// dell'allowlist risulterebbero tutte sparite.
fn sorgenti_di_produzione() -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    cammina(&radice(), "", &mut out);
    out
}

fn cammina(dir: &Path, rel: &str, out: &mut BTreeMap<String, String>) {
    let voci =
        std::fs::read_dir(dir).unwrap_or_else(|e| panic!("`{}` non si legge: {e}", dir.display()));
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
        } else if nome.ends_with(".rs") && percorso.contains("/src/") {
            let src = std::fs::read_to_string(voce.path())
                .unwrap_or_else(|e| panic!("`{percorso}` non si legge: {e}"));
            out.insert(percorso, src);
        }
    }
}

// ---------------------------------------------------------------------------
// L'estrattore
// ---------------------------------------------------------------------------

/// `true` se la riga è **prosa**: un commento di riga, di documentazione o di
/// modulo.
///
/// Non è un dettaglio: metà delle occorrenze di `serialize` nel repo stanno in
/// doc-comment che spiegano *questa stessa regola* — `serialize.rs` scrive
/// `FormatProvider::serialize` nel proprio doc di modulo. Un estrattore che
/// contasse la prosa nascerebbe con dei falsi positivi nell'allowlist, cioè con
/// delle righe che dichiarano legittimo qualcosa che non esiste.
///
/// Vale solo per i commenti di riga. Un `/* … */` che nominasse `serialize`
/// produrrebbe un **falso positivo** — il verso innocuo: qualcuno guarda e
/// toglie la riga, invece di non accorgersi di niente.
fn e_prosa(riga: &str) -> bool {
    riga.trim_start().starts_with("//")
}

fn e_ident(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// Dove finisce un `#[cfg(test)] mod … { … }` scritto a colonna zero, se è di
/// quella forma.
///
/// La regola è volutamente minuscola: l'attributo a colonna zero, un `mod … {` a
/// colonna zero subito sotto, e la prima riga uguale a `}`. Tiene perché
/// `cargo fmt --all --check` è verde — dentro un blocco indentato non c'è
/// nessun'altra `}` in prima colonna. `None` quando la forma è un'altra
/// (`#[cfg(test)]` su una funzione: succede due volte nel repo), e allora non si
/// salta niente: contare di più è il verso innocuo.
fn fine_del_modulo_di_prova(righe: &[&str], attributo: usize) -> Option<usize> {
    let apertura = righe.get(attributo + 1)?;
    if !(apertura.starts_with("mod ") && apertura.ends_with('{')) {
        return None;
    }
    let fine = righe
        .iter()
        .enumerate()
        .skip(attributo + 2)
        .find(|(_, r)| **r == "}")
        .map(|(n, _)| n);
    Some(fine.unwrap_or_else(|| {
        panic!(
            "il `mod` di prova aperto a riga {} non si chiude con una `}}` in prima\n\
             colonna: l'estrattore non sa dove finisce.",
            attributo + 2
        )
    }))
}

/// Le **forme** con cui una riga nomina `serialize` come funzione.
///
/// Conta un'occorrenza quando `serialize` è un identificatore intero e:
///
/// - è preceduto da `::` → forma `qualcuno::serialize` (chiamata per percorso,
///   `use`, o metodo preso in UFCS);
/// - è preceduto da `.` → forma `.serialize` — **il gesto pericoloso**, la
///   chiamata di metodo su un provider;
/// - è seguito da `(` → forma `serialize` (chiamata libera, dopo un `use`).
///
/// Non la conta quando è una **definizione** (`fn serialize`) o una
/// **dichiarazione di modulo** (`mod serialize`): quelle sono ciò che rende il
/// metodo esistente, non chi lo usa — e un provider deve poterlo implementare.
///
/// Ciò che non rientra in nessuno di questi casi non è una chiamata: la parola
/// dentro una stringa (`"serialize fallito"`), o il nome di un modulo dentro un
/// percorso più lungo.
fn forme(riga: &str) -> Vec<String> {
    const AGO: &str = "serialize";
    let mut out = Vec::new();
    let mut da = 0;

    while let Some(scostamento) = riga[da..].find(AGO) {
        let i = da + scostamento;
        da = i + AGO.len();

        let prima = &riga[..i];
        let dopo = &riga[i + AGO.len()..];
        // Confini di identificatore: `deserialize` e `serialize_with` non sono
        // questa funzione.
        if prima.chars().next_back().is_some_and(e_ident)
            || dopo.chars().next().is_some_and(e_ident)
        {
            continue;
        }
        if prima.ends_with("fn ") || prima.ends_with("mod ") {
            continue;
        }

        if let Some(percorso) = prima.strip_suffix("::") {
            let qualificatore: String = percorso
                .chars()
                .rev()
                .take_while(|c| e_ident(*c))
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            out.push(format!("{qualificatore}::{AGO}"));
        } else if prima.ends_with('.') {
            out.push(format!(".{AGO}"));
        } else if dopo.starts_with('(') {
            out.push(AGO.to_string());
        }
    }
    out
}

/// Le forme di un intero sorgente, con quante volte ciascuna compare.
fn citazioni(sorgente: &str) -> BTreeMap<String, usize> {
    let righe: Vec<&str> = sorgente.lines().collect();
    let mut out: BTreeMap<String, usize> = BTreeMap::new();
    let mut n = 0;

    while n < righe.len() {
        let riga = righe[n];
        if e_prosa(riga) {
            n += 1;
            continue;
        }
        if riga == "#[cfg(test)]" {
            if let Some(fine) = fine_del_modulo_di_prova(&righe, n) {
                n = fine + 1;
                continue;
            }
        }
        for forma in forme(riga) {
            *out.entry(forma).or_default() += 1;
        }
        n += 1;
    }
    out
}

/// Tutte le citazioni del codice di produzione, per `(file, forma)`.
fn citazioni_di_produzione() -> BTreeMap<(String, String), usize> {
    let mut out = BTreeMap::new();
    for (file, sorgente) in sorgenti_di_produzione() {
        for (forma, quante) in citazioni(&sorgente) {
            out.insert((file.clone(), forma), quante);
        }
    }
    out
}

fn elenca(punti: &BTreeSet<(String, String)>) -> String {
    punti
        .iter()
        .map(|(f, forma)| format!("  {f} — `{forma}`"))
        .collect::<Vec<_>>()
        .join("\n")
}

// ---------------------------------------------------------------------------
// La rete
// ---------------------------------------------------------------------------

/// **Il cuore**: chi nomina `serialize` è l'allowlist, nei due versi e col
/// conteggio.
#[test]
fn serialize_non_e_la_strada_per_riscrivere_un_documento() {
    let trovate = citazioni_di_produzione();
    let dichiarate = allowlist();

    let viste: BTreeSet<(String, String)> = trovate.keys().cloned().collect();
    let attese: BTreeSet<(String, String)> = dichiarate
        .keys()
        .map(|(f, forma)| (f.to_string(), forma.to_string()))
        .collect();

    let nuove: BTreeSet<(String, String)> = viste.difference(&attese).cloned().collect();
    assert!(
        nuove.is_empty(),
        "questi punti del codice di produzione nominano `serialize`, e l'allowlist\n\
         non li conosce:\n\
         {}\n\
         \n\
         Se stai **modificando un documento che esiste**, questa è la strada\n\
         sbagliata, e non c'è una riga da aggiungere qui: il modello è lossy per\n\
         costruzione — perde i commenti dello YAML, l'ordine delle chiavi, lo\n\
         stile delle virgolette, la spaziatura, lo stile dell'enfasi — quindi\n\
         `read_model` → `serialize` → `write_document` riscrive per intero un file\n\
         che l'utente vedrà cambiato dappertutto. La strada è `apply_edit` con una\n\
         `EditRequest`: gli `Span` del modello dicono dove intervenire, e la\n\
         `Revision` dice su quale testo (decisione 0008).\n\
         \n\
         Se stai **generando un documento nuovo** (un template, «crea nota») o se\n\
         è un `serialize` che con i documenti non c'entra (serde), allora la riga\n\
         qui va aggiunta — con la sua ragione nell'enum `Perche`, che oggi ne ha\n\
         due e nessuna delle due copre la generazione. Aggiungerne una terza è la\n\
         decisione da prendere, ed è il motivo per cui questo file esiste.",
        elenca(&nuove)
    );

    let sparite: BTreeSet<(String, String)> = attese.difference(&viste).cloned().collect();
    assert!(
        sparite.is_empty(),
        "l'allowlist dichiara punti di chiamata che nel codice non ci sono più:\n\
         {}\n\
         Toglili: l'elenco è una fotografia, non un ricordo. (Se sono spariti\n\
         tutti insieme, guarda prima il cammino dei sorgenti: è il modo in cui\n\
         questo presidio potrebbe smettere di guardare qualcosa.)",
        elenca(&sparite)
    );

    for (chiave, quante) in &trovate {
        let Some((attese, perche)) = dichiarate.get(&(chiave.0.as_str(), chiave.1.as_str())) else {
            continue;
        };
        assert_eq!(
            quante, attese,
            "in `{}` la forma `{}` compare {quante} volte e l'allowlist ne dichiara\n\
             {attese} ({perche:?}). Se la chiamata in più è legittima, aggiorna il\n\
             conteggio: è la riga che costringe a guardarla.",
            chiave.0, chiave.1
        );
    }
}

/// **La frase presidiata esiste ancora, ed è là dove il contratto la fa.**
///
/// Senza questa, il giorno in cui qualcuno riscrivesse il doc di `serialize`
/// resterebbe in piedi un test che difende una regola che nessun documento
/// dichiara più — e chi lo trovasse rosso non saprebbe da dove viene. È la sesta
/// specie presa dal verso in cui si presidia, come in `dieta_ipc.rs`: una
/// garanzia meccanica deve rimandare a una frase che una macchina sa cercare.
#[test]
fn la_garanzia_e_ancora_scritta_nel_contratto() {
    assert!(
        prosa_normalizzata(CONTRATTO).contains(LA_GARANZIA),
        "in `crates/fub-abi/src/format.rs` non c'è più la frase\n  «{LA_GARANZIA}»\n\
         che questo test rende meccanica. O è stata riscritta — e allora va\n\
         riscritta anche qui — oppure la regola è cambiata, e allora prima si\n\
         cambia il contratto e questo presidio si toglie con un verbale."
    );
}

// ---------------------------------------------------------------------------
// I test del test
// ---------------------------------------------------------------------------

/// Il cammino guarda davvero i sorgenti: se sbagliasse radice tornerebbe a
/// vuoto, e un insieme vuoto non contraddice nessuna allowlist dal verso che si
/// guarda per primo.
#[test]
fn il_cammino_trova_il_contratto() {
    let sorgenti = sorgenti_di_produzione();
    assert!(
        sorgenti.contains_key("crates/fub-abi/src/format.rs"),
        "il cammino dei sorgenti non ha trovato `crates/fub-abi/src/format.rs`, che\n\
         è il file in cui `serialize` è dichiarato. Sta guardando il posto sbagliato:\n\
         ne ha visti {}.",
        sorgenti.len()
    );
    assert!(
        !sorgenti.keys().any(|f| f.contains("/tests/")),
        "il cammino ha raccolto dei file sotto `tests/`: là `serialize` si chiama, ed\n\
         è giusto che si chiami."
    );
}

/// **La rete deve sapersi chiudere**: l'estrattore vede la strada sbagliata.
///
/// È la prova che si è fatta a mano una volta — mettendo la funzione nel kernel e
/// guardando il presidio diventare rosso — resa permanente. Un presidio che non
/// può diventare rosso è la sesta specie con un nome nuovo.
#[test]
fn l_estrattore_vede_la_strada_sbagliata() {
    let finto = "\
impl Workspace {\n\
    pub fn scrivi_una_proprieta(&mut self, id: &DocId, chiave: &str) -> Result<()> {\n\
        let mut model = self.read_model(id)?;\n\
        model.frontmatter.0.insert(chiave.to_string(), Value::Bool(true));\n\
        let source = self.docs.provider_for(id)?.serialize(&model)?;\n\
        self.write_document(id, &source, WriteBase::Dictated)\n\
    }\n\
}\n";
    assert_eq!(
        citazioni(finto),
        BTreeMap::from([(".serialize".to_string(), 1)]),
        "la chiamata di metodo è il gesto che questo presidio esiste per vedere"
    );
}

/// E deve distinguere ciò che nomina `serialize` da ciò che lo **è**, senza
/// contare la prosa che ne parla.
#[test]
fn l_estrattore_distingue_la_definizione_dalla_chiamata() {
    let finto = "\
//! Un modulo che parla di `FormatProvider::serialize` e di `provider.serialize(&m)`.\n\
mod serialize;\n\
use fub_abi::traits::serialize;\n\
\n\
impl FormatProvider for Finto {\n\
    /// Il doc, che cita `.serialize(` per spiegarsi.\n\
    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {\n\
        Ok(serialize::serialize(model))\n\
    }\n\
}\n\
\n\
fn altro(x: &X) -> String {\n\
    let a = crate::ipc::u64_string::serialize(&x.0, s);\n\
    let b = serialize(&x.1);\n\
    let c = FormatProvider::serialize;\n\
    format!(\"serialize fallito: {a}{b}{c:?}\")\n\
}\n\
\n\
#[cfg(test)]\n\
mod tests {\n\
    #[test]\n\
    fn la_prova_del_serializer() {\n\
        assert!(MarkdownProvider::new().serialize(&doc).is_ok());\n\
    }\n\
}\n";

    assert_eq!(
        citazioni(finto),
        BTreeMap::from([
            // Il `use`: passa dal `::`, ed è il modo in cui una chiamata libera
            // arriva senza nominare nessuno.
            ("traits::serialize".to_string(), 1),
            // La delega del provider al proprio modulo.
            ("serialize::serialize".to_string(), 1),
            // L'altro `serialize`, quello di serde.
            ("u64_string::serialize".to_string(), 1),
            // La chiamata libera, e il metodo preso senza parentesi (UFCS): due
            // forme che un estrattore ingenuo lascerebbe passare.
            ("serialize".to_string(), 1),
            ("FormatProvider::serialize".to_string(), 1),
        ]),
        "attese cinque citazioni: `mod serialize;`, le due `fn serialize`, la prosa\n\
         e tutto il modulo `#[cfg(test)]` non si contano"
    );
}

/// Un `#[cfg(test)]` che non apre un modulo non fa saltare niente: succede due
/// volte nel repo, ed è il caso in cui saltare sarebbe **il verso sbagliato**.
#[test]
fn un_cfg_test_su_una_funzione_non_apre_un_modulo() {
    let finto = "\
#[cfg(test)]\n\
fn aiuto(p: &dyn FormatProvider, m: &DocumentModel) -> String {\n\
    p.serialize(m).unwrap()\n\
}\n";
    assert_eq!(citazioni(finto), BTreeMap::from([(".serialize".into(), 1)]));
}
