//! **Il documento visto da dentro il confine.**
//!
//! Il ping prova che una capacità risponde; questo prova che risponde *l'albero*.
//! `read-model` è l'unica firma del contratto in cui l'host non passa un numero
//! e nemmeno una stringa: passa `document-model`, cioè blocchi che si annidano,
//! inline dentro gli inline, quattro tabelle piatte e un frontmatter. Di là dal
//! confine quell'albero è un'**arena** — due liste e degli indici, perché il WIT
//! non ha tipi ricorsivi — e questo componente la cammina davvero: conta i
//! blocchi, ricostruisce il testo di un paragrafo seguendo gli `inline-ref`,
//! misura quanto scende l'annidamento.
//!
//! Ciò che risponde è JSON, perché è l'unica forma di prova che attraversa: il
//! test dall'altra parte legge quei numeri e distingue «l'albero è arrivato» da
//! «è arrivato vuoto», che è la differenza che un `unserved` sostituito da uno
//! stub avrebbe nascosto.
//!
//! Non dipende da `fub-abi`: ha in mano il WIT e basta, come un plugin di terzi.

wit_bindgen::generate!({
    path: ["../../crates/fub-abi/wit/fub", "wit"],
    world: "esempio:modello/modello",
    generate_all,
});

use exports::fub::abi::plugin::{Guest, PluginManifest, PluginPermissions};
use fub::abi::errors::PluginError;
use fub::abi::model::{Block, DocumentModel, DocumentTree, Inline, LinkTarget};
use fub::abi::options::OptionEntry;

/// L'id del plugin. Il namespace del §7.4 è suo.
const ID: &str = "demo.modello";

/// La versione del contratto contro cui è scritto: la confronta
/// `abi_compatible` al primo passo del montaggio.
const ABI: &str = "0.1.1";

/// Quanto in giù questo componente accetta di camminare l'arena che riceve.
///
/// Non è il tetto dell'host (quello è dichiarato in `crate::modello` di
/// `fub-wasm-host` e vale 64): è la difesa di **chi legge**. Gli `block-ref`
/// sono indici, e un'arena con un ciclo — un padre che nomina un antenato — non
/// è distinguibile da una sana finché non ci si cammina dentro. L'host di casa
/// non la può produrre (deposita in post-ordine, quindi ogni figlio ha indice
/// minore del padre), ma un guest che si fida di un numero ricevuto è un guest
/// che un giorno gira per sempre.
const DISCESA_MASSIMA: u32 = 256;

struct Componente;

impl Guest for Componente {
    fn manifest() -> PluginManifest {
        PluginManifest {
            id: ID.to_string(),
            name: "Demo Modello (WASM)".to_string(),
            version: "0.1.0".to_string(),
            abi_version: ABI.to_string(),
            permissions: PluginPermissions {
                // Leggere il modello è leggere il vault: è la stessa capacità
                // del `read-document` del ping, sotto lo stesso permesso.
                granted: vec![OptionEntry {
                    key: "fub:read-vault".to_string(),
                    value: "true".to_string(),
                }],
            },
            provides: vec![],
            requires: vec![],
            settings: vec![],
            strings: vec![],
            default_locale: "it".to_string(),
            timers: vec![],
        }
    }

    fn activate() -> Result<(), PluginError> {
        Ok(())
    }

    fn deactivate() -> Result<(), PluginError> {
        Ok(())
    }

    fn run_job(job: String, _payload: String) -> Result<String, PluginError> {
        match job.as_str() {
            // Il documento buono: si chiede il modello e si risponde con ciò
            // che ci si è trovato dentro.
            "modello" => Ok(referto(&fub::abi::host_vault_read::read_model(
                "Modello.md",
            )?)),
            // Il documento malato: qui non c'è niente da riferire, perché
            // `read-model` **non risponde**. Il `?` lascia passare il rifiuto
            // dell'host così com'è, ed è quello che il test vuole vedere
            // arrivare fin qui: un errore che si legge, non un'istanza abbattuta.
            "modello-profondo" => Ok(referto(&fub::abi::host_vault_read::read_model(
                "Profondo.md",
            )?)),
            altro => Err(PluginError::UnknownJob(fub::abi::text::Text::Literal(
                altro.to_string(),
            ))),
        }
    }
}

/// Ciò che il componente ha trovato nel modello, in JSON.
///
/// JSON scritto a mano: `serde_json` sarebbe una dipendenza in più in un
/// componente che deve restare piccolo. Le stringhe passano da [`virgolette`],
/// che è l'unica riga di questo file in cui un contenuto dell'utente diventa
/// sintassi — e il documento di prova contiene apostrofi e accenti apposta.
fn referto(m: &DocumentModel) -> String {
    let albero = &m.body;

    // La profondità vera dell'annidamento, camminata ramo per ramo: è il
    // numero che distingue «i blocchi sono arrivati» da «i blocchi sono
    // arrivati *con dentro i loro figli*».
    let profondita = albero
        .roots
        .iter()
        .map(|r| discesa(albero, *r, DISCESA_MASSIMA))
        .max()
        .unwrap_or(0);

    // Le voci di lista e le task stanno in giro per l'arena a qualunque
    // profondità: l'arena è piatta, quindi contarle è una passata sola. È il
    // vantaggio della forma del contratto, ed è giusto che l'esempio lo mostri.
    let mut voci = 0usize;
    let mut spuntate = 0usize;
    let mut lingua = String::new();
    for b in &albero.blocks {
        match b {
            Block::List(l) => {
                voci += l.items.len();
                for v in &l.items {
                    if let Some(t) = &v.task {
                        if matches!(t.symbol, Some('x') | Some('X')) {
                            spuntate += 1;
                        }
                    }
                }
            }
            Block::CodeBlock(c) => {
                if lingua.is_empty() {
                    lingua = c.lang.clone().unwrap_or_default();
                }
            }
            Block::Heading(_)
            | Block::Paragraph(_)
            | Block::Quote(_)
            | Block::ThematicBreak(_)
            | Block::Custom(_)
            | Block::Table(_)
            | Block::ReferenceDefinition(_) => {}
        }
    }

    // Il testo del primo paragrafo, ricostruito seguendo gli `inline-ref`: è la
    // prova che l'arena degli inline si risolve, e non solo che è lunga.
    let mut primo_paragrafo = String::new();
    for r in &albero.roots {
        if let Some(Block::Paragraph(p)) = albero.blocks.get(*r as usize) {
            testo(albero, &p.inlines, &mut primo_paragrafo);
            break;
        }
    }

    let intestazione = m
        .outline
        .first()
        .map(|h| h.text.clone())
        .unwrap_or_default();
    let livello_massimo = m.outline.iter().map(|h| h.level).max().unwrap_or(0);
    let primo_link = m
        .links
        .first()
        .map(|l| bersaglio(&l.target))
        .unwrap_or_default();

    format!(
        concat!(
            "{{\"id\":{id},",
            "\"frontmatter\":{frontmatter},",
            "\"frontmatter_presente\":{presente},",
            "\"radici\":{radici},",
            "\"blocchi\":{blocchi},",
            "\"inline\":{inline},",
            "\"profondita\":{profondita},",
            "\"intestazioni\":{intestazioni},",
            "\"prima_intestazione\":{intestazione},",
            "\"livello_massimo\":{livello},",
            "\"link\":{link},",
            "\"primo_link\":{primo_link},",
            "\"tag\":{tag},",
            "\"ancore\":{ancore},",
            "\"voci_lista\":{voci},",
            "\"task_spuntate\":{spuntate},",
            "\"lingua_codice\":{lingua},",
            "\"primo_paragrafo\":{paragrafo},",
            "\"testo\":{testo}}}"
        ),
        id = virgolette(&m.id),
        // Il frontmatter è già JSON: entra nel referto **come valore**, non come
        // stringa, così il test dall'altra parte legge una proprietà per nome
        // invece di cercare una sottostringa.
        frontmatter = m.frontmatter,
        presente = m.frontmatter_present,
        radici = albero.roots.len(),
        blocchi = albero.blocks.len(),
        inline = albero.inlines.len(),
        profondita = profondita,
        intestazioni = m.outline.len(),
        intestazione = virgolette(&intestazione),
        livello = livello_massimo,
        link = m.links.len(),
        primo_link = virgolette(&primo_link),
        tag = m.tags.len(),
        ancore = m.anchors.len(),
        voci = voci,
        spuntate = spuntate,
        lingua = virgolette(&lingua),
        paragrafo = virgolette(&primo_paragrafo),
        testo = virgolette(&m.text),
    )
}

/// Quanti livelli scende il sottoalbero che parte da questo blocco (il blocco
/// stesso conta 1).
fn discesa(albero: &DocumentTree, r: u32, giu: u32) -> u32 {
    if giu == 0 {
        return 0;
    }
    let Some(b) = albero.blocks.get(r as usize) else {
        // Un `block-ref` fuori range è un modello malformato, dice il WIT. Chi
        // legge non ha modo di ripararlo: lo conta come niente e va avanti.
        return 0;
    };
    let figli = figli(b);
    1 + figli
        .iter()
        .map(|f| discesa(albero, *f, giu - 1))
        .max()
        .unwrap_or(0)
}

/// I `block-ref` che un blocco porta dentro di sé.
///
/// La `match` è esaustiva anche di qua: un contenitore nuovo che finisse nel
/// ramo muto sbagliato darebbe una profondità più piccola del vero, cioè un
/// numero plausibile invece di un errore di compilazione.
fn figli(b: &Block) -> Vec<u32> {
    match b {
        Block::Quote(q) => q.blocks.clone(),
        Block::Custom(c) => c.blocks.clone(),
        Block::List(l) => l.items.iter().flat_map(|v| v.blocks.clone()).collect(),
        // Questi non portano blocchi: un heading e un paragrafo portano inline,
        // una tabella porta celle di inline, gli altri tre non portano niente.
        Block::Heading(_)
        | Block::Paragraph(_)
        | Block::CodeBlock(_)
        | Block::ThematicBreak(_)
        | Block::Table(_)
        | Block::ReferenceDefinition(_) => Vec::new(),
    }
}

/// Il testo di una sequenza di inline, seguendo gli indici nell'arena.
fn testo(albero: &DocumentTree, refs: &[u32], out: &mut String) {
    for r in refs {
        let Some(i) = albero.inlines.get(*r as usize) else {
            continue;
        };
        match i {
            Inline::Text(s) | Inline::Code(s) => out.push_str(s),
            Inline::Emph(v)
            | Inline::Strong(v)
            | Inline::Superscript(v)
            | Inline::Strikethrough(v) => testo(albero, v, out),
            Inline::Link(l) => match &l.label {
                Some(v) => testo(albero, v, out),
                // Un riferimento senza etichetta si legge dal bersaglio **nudo**
                // — il nome della pagina, l'indirizzo — che è ciò che l'utente
                // vede scritto. La forma con la specie davanti (`wiki:`) serve a
                // chi confronta i bersagli, non a chi legge una frase.
                None => out.push_str(match &l.target {
                    LinkTarget::Wiki(w) => w.page.as_str(),
                    LinkTarget::Url(u) => u.as_str(),
                    LinkTarget::Path(p) => p.as_str(),
                }),
            },
            Inline::TagRef(t) => {
                out.push('#');
                out.push_str(&t.name);
            }
            // Un costrutto che il core non nomina non ha un testo che questo
            // esempio sappia leggere: lo salta invece di inventarne uno.
            Inline::Custom(_) => {}
            Inline::HardBreak | Inline::SoftBreak => out.push(' '),
        }
    }
}

/// Il bersaglio di un link, in una riga leggibile dall'altra parte.
fn bersaglio(t: &LinkTarget) -> String {
    match t {
        LinkTarget::Wiki(w) => {
            let mut s = format!("wiki:{}", w.page);
            if let Some(h) = &w.heading {
                s.push('#');
                s.push_str(h);
            }
            if let Some(b) = &w.block {
                s.push_str("#^");
                s.push_str(b);
            }
            s
        }
        LinkTarget::Url(u) => format!("url:{u}"),
        LinkTarget::Path(p) => format!("path:{p}"),
    }
}

/// Una stringa JSON, con dentro ciò che l'utente ha scritto.
fn virgolette(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

export!(Componente);
