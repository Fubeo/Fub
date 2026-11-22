//! L'indice dei comandi del Disegno completo (piano K6, T5;
//! `docs/architecture/disegno-completo.md`, «L'indice e i pezzi pigri»).
//!
//! La mappa (`mappa.tsv`) dice per ogni funzione del motore la famiglia, il
//! posto in Fub e a che punto è. Da lei, senza un elenco scritto a mano:
//!
//! - ogni riga **fatta**, e ogni riga di Fub (`fub`) che ha un posto vero,
//!   diventa una [`SpecMotore`] di K3 e passa da [`fub_motori::importa`] con
//!   lo spazio [`SPAZIO`]: il posto viene dalla colonna `posto`
//!   ([`posto_di`], [`SCHEDE`]), l'effetto da ciò che il motore dice del
//!   comando ([`effetto_di`]), i parametri di un comando con una finestra
//!   ([`ha_finestra`]) dal suo schema, letto con [`NOMI`];
//! - l'etichetta italiana è quella di `it.tsv` (colonna `etichetta_it`)
//!   passata per il glossario (`glossario.tsv`, [`Glossario`]), che mette le
//!   parole di Fub al posto di quelle del motore; l'inglese è quella del
//!   motore, passata per il glossario inglese.
//!
//! Le fonti si importano ognuna per sé: un id può esserci in due fonti (la
//! voce del menu `file.place` e il comando `file.place`), e la voce
//! dell'indice ha fonte e id. Il test `ts_indice` scrive l'indice per il
//! client (`apps/client/src/editors/spatial/completo/indice.generated.json`),
//! il test `copertura` controlla che ogni comando del motore abbia la sua
//! riga e che ogni riga fatta abbia posto ed etichetta.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use fub_motori::{
    importa, Adattamento, ComandoFub, Effetto, Gruppo, Mancanza, Posto, Scheda, SpecMotore, Tipo,
};
use serde_json::Value;

/// Lo spazio dei comandi del disegno: l'id di un comando di Fub è
/// `disegno.«id del motore»`, come nei comandi che `famiglie` serve.
pub const SPAZIO: &str = "disegno";

/// La mappa, letta dal sorgente.
const MAPPA: &str = include_str!("../mappa.tsv");

/// Il glossario, letto dal sorgente.
const GLOSSARIO: &str = include_str!("../glossario.tsv");

// ---------------------------------------------------------------------------
// La mappa intera
// ---------------------------------------------------------------------------

/// Da dove viene una riga della mappa (la colonna `fonte`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum FonteMappa {
    /// Un comando del motore (`cmd!`).
    Motore,
    /// Una voce dell'interfaccia del motore (un menu, un tasto).
    Interfaccia,
    /// Un effetto.
    Effetto,
    /// Uno strumento.
    Strumento,
    /// Un pannello.
    Pannello,
}

impl FonteMappa {
    /// Tutte, nell'ordine dell'indice.
    pub const TUTTE: [FonteMappa; 5] = [
        FonteMappa::Motore,
        FonteMappa::Interfaccia,
        FonteMappa::Effetto,
        FonteMappa::Strumento,
        FonteMappa::Pannello,
    ];

    /// Il nome nella mappa, nei casi e nell'indice.
    pub fn nome(self) -> &'static str {
        match self {
            FonteMappa::Motore => "motore",
            FonteMappa::Interfaccia => "interfaccia",
            FonteMappa::Effetto => "effetto",
            FonteMappa::Strumento => "strumento",
            FonteMappa::Pannello => "pannello",
        }
    }

    /// La fonte con questo nome.
    pub fn da_nome(nome: &str) -> Option<FonteMappa> {
        FonteMappa::TUTTE.into_iter().find(|f| f.nome() == nome)
    }
}

/// A che punto è una riga (la colonna `stato`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stato {
    /// Ha il suo caso in `tests/famiglie/`.
    Fatto,
    /// Ancora da fare.
    DaFare,
    /// La serve una funzione di Fub.
    Fub,
    /// Fub non la offre.
    Escluso,
}

/// Una riga della mappa, con tutte le colonne.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RigaMappa {
    pub fonte: FonteMappa,
    pub id: String,
    /// L'etichetta inglese del motore.
    pub etichetta: String,
    /// Il percorso nel menu del motore (`Object › Path`), diviso.
    pub menu: Vec<String>,
    /// La colonna `famiglia`: una delle 26, `fub` o `escluso`.
    pub famiglia: String,
    pub task: String,
    pub stato: Stato,
    /// La colonna `posto`, intera (`ispettore/design/documento`).
    pub posto: String,
    /// La colonna `pigro`.
    pub pigro: String,
    pub nota: String,
    /// L'etichetta di `it.tsv`, o l'inglese se manca.
    pub etichetta_it: String,
}

impl RigaMappa {
    /// La feature del motore dietro cui sta (`sotto:<feature>` in `pigro`).
    pub fn sotto(&self) -> Option<&str> {
        self.pigro.strip_prefix("sotto:")
    }
}

/// Tutte le righe della mappa, in ordine, lette una volta sola.
///
/// # Panics
///
/// Se la mappa compilata non si legge: la guardia `check-disegno-mappa.mjs`
/// e il test `copertura` lo vedono prima.
pub fn mappa() -> &'static [RigaMappa] {
    static LETTA: OnceLock<Vec<RigaMappa>> = OnceLock::new();
    LETTA.get_or_init(|| leggi_mappa(MAPPA).expect("la mappa compilata si legge"))
}

/// La riga di `id` per la fonte data.
pub fn riga(fonte: FonteMappa, id: &str) -> Option<&'static RigaMappa> {
    static INDICE: OnceLock<BTreeMap<(FonteMappa, &'static str), usize>> = OnceLock::new();
    let indice = INDICE.get_or_init(|| {
        mappa()
            .iter()
            .enumerate()
            .map(|(i, r)| ((r.fonte, r.id.as_str()), i))
            .collect()
    });
    indice.get(&(fonte, id)).map(|&i| &mappa()[i])
}

/// Legge il testo di una mappa: l'intestazione, poi una riga per funzione.
pub fn leggi_mappa(testo: &str) -> Result<Vec<RigaMappa>, String> {
    let mut linee = testo.lines().filter(|l| !l.starts_with('#'));
    let testa: Vec<&str> = linee
        .next()
        .ok_or("la mappa non ha l'intestazione")?
        .split('\t')
        .collect();
    let colonna = |nome: &str| {
        testa
            .iter()
            .position(|c| *c == nome)
            .ok_or_else(|| format!("la mappa non ha la colonna `{nome}`"))
    };
    let c = [
        colonna("fonte")?,
        colonna("id")?,
        colonna("etichetta")?,
        colonna("menu")?,
        colonna("famiglia")?,
        colonna("task")?,
        colonna("stato")?,
        colonna("posto")?,
        colonna("pigro")?,
        colonna("nota")?,
        colonna("etichetta_it")?,
    ];
    let mut righe = Vec::new();
    for (n, linea) in linee.enumerate() {
        if linea.is_empty() {
            continue;
        }
        let celle: Vec<&str> = linea.split('\t').collect();
        let cella = |i: usize| {
            celle
                .get(c[i])
                .copied()
                .ok_or_else(|| format!("la riga {} della mappa è corta", n + 3))
        };
        let fonte = FonteMappa::da_nome(cella(0)?)
            .ok_or_else(|| format!("la riga {} ha la fonte «{}»", n + 3, cella(0).unwrap_or("")))?;
        let stato = match cella(6)? {
            "fatto" => Stato::Fatto,
            "da fare" => Stato::DaFare,
            "fub" => Stato::Fub,
            "escluso" => Stato::Escluso,
            altro => return Err(format!("la riga {} ha lo stato «{altro}»", n + 3)),
        };
        let menu = cella(3)?;
        righe.push(RigaMappa {
            fonte,
            id: cella(1)?.to_string(),
            etichetta: cella(2)?.to_string(),
            menu: if menu.is_empty() {
                Vec::new()
            } else {
                menu.split(" › ").map(str::to_string).collect()
            },
            famiglia: cella(4)?.to_string(),
            task: cella(5)?.to_string(),
            stato,
            posto: cella(7)?.to_string(),
            pigro: cella(8)?.to_string(),
            nota: cella(9)?.to_string(),
            etichetta_it: cella(10)?.to_string(),
        });
    }
    Ok(righe)
}

// ---------------------------------------------------------------------------
// Il glossario
// ---------------------------------------------------------------------------

/// La lingua di una voce del glossario.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lingua {
    /// Le etichette di `it.tsv`.
    It,
    /// Le etichette del motore.
    En,
}

/// Una voce del glossario: una parola (o più) del motore e quella di Fub.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VoceGlossario {
    pub lingua: Lingua,
    pub motore: String,
    pub fub: String,
}

/// Le parole del motore e quelle di Fub (`glossario.tsv`): `lingua`,
/// `motore`, `fub`, `nota`. Le voci si applicano nell'ordine del file, a
/// parola intera e senza badare alle maiuscole; la maiuscola iniziale della
/// parola trovata resta.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Glossario {
    pub voci: Vec<VoceGlossario>,
}

impl Glossario {
    /// Legge il testo del glossario.
    pub fn leggi(testo: &str) -> Result<Glossario, String> {
        let mut voci = Vec::new();
        let mut linee = testo
            .lines()
            .enumerate()
            .filter(|(_, l)| !l.starts_with('#') && !l.trim().is_empty());
        match linee.next() {
            Some((_, testa)) if testa.starts_with("lingua\tmotore\tfub") => {}
            _ => return Err("il glossario non comincia con «lingua, motore, fub, nota»".into()),
        }
        for (n, linea) in linee {
            let celle: Vec<&str> = linea.split('\t').collect();
            let (Some(lingua), Some(motore), Some(fub)) =
                (celle.first(), celle.get(1), celle.get(2))
            else {
                return Err(format!("la riga {} del glossario è corta", n + 1));
            };
            let lingua = match *lingua {
                "it" => Lingua::It,
                "en" => Lingua::En,
                altro => {
                    return Err(format!(
                        "la riga {} del glossario ha la lingua «{altro}»",
                        n + 1
                    ))
                }
            };
            if motore.trim().is_empty() {
                return Err(format!(
                    "la riga {} del glossario non dice la parola del motore",
                    n + 1
                ));
            }
            voci.push(VoceGlossario {
                lingua,
                motore: (*motore).to_string(),
                fub: (*fub).to_string(),
            });
        }
        Ok(Glossario { voci })
    }

    /// `testo` con le parole di Fub.
    pub fn applica(&self, lingua: Lingua, testo: &str) -> String {
        let mut fuori = testo.to_string();
        for voce in self.voci.iter().filter(|v| v.lingua == lingua) {
            fuori = sostituisci(&fuori, &voce.motore, &voce.fub);
        }
        fuori
    }
}

/// Il glossario compilato.
///
/// # Panics
///
/// Se `glossario.tsv` non si legge: il test `ts_indice` lo vede prima.
pub fn glossario() -> &'static Glossario {
    static LETTO: OnceLock<Glossario> = OnceLock::new();
    LETTO.get_or_init(|| Glossario::leggi(GLOSSARIO).expect("il glossario compilato si legge"))
}

/// Un carattere che fa parte di una parola.
fn di_parola(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// `testo` con ogni `cerca`, a parola intera e senza badare alle
/// maiuscole, al posto di `metti`; se la parola trovata comincia con la
/// maiuscola, anche quella messa.
fn sostituisci(testo: &str, cerca: &str, metti: &str) -> String {
    let basso: Vec<char> = testo.chars().flat_map(char::to_lowercase).collect();
    let originale: Vec<char> = testo.chars().collect();
    let cerca: Vec<char> = cerca.chars().flat_map(char::to_lowercase).collect();
    // Le lettere minuscole di questa lingua hanno la stessa lunghezza:
    // altrimenti si lascia il testo com'è.
    if basso.len() != originale.len() || cerca.is_empty() {
        return testo.to_string();
    }
    let mut fuori = String::with_capacity(testo.len());
    let mut i = 0;
    while i < originale.len() {
        let fine = i + cerca.len();
        let combacia = fine <= basso.len()
            && basso[i..fine] == cerca[..]
            && (i == 0 || !di_parola(originale[i - 1]))
            && (fine == originale.len() || !di_parola(originale[fine]));
        if combacia {
            if originale[i].is_uppercase() {
                let mut lettere = metti.chars();
                if let Some(prima) = lettere.next() {
                    fuori.extend(prima.to_uppercase());
                    fuori.extend(lettere);
                }
            } else {
                fuori.push_str(metti);
            }
            i = fine;
        } else {
            fuori.push(originale[i]);
            i += 1;
        }
    }
    fuori
}

// ---------------------------------------------------------------------------
// I posti
// ---------------------------------------------------------------------------

/// Il gruppo delle schede senza gruppi: `finestra`, `banda`, `interno`…
pub const PRINCIPALE: &str = "principale";

const fn g(id: &'static str) -> Gruppo {
    Gruppo { id, solo: false }
}

const fn scheda(id: &'static str, gruppi: &'static [Gruppo]) -> Scheda {
    Scheda {
        id,
        solo: false,
        contesto: None,
        gruppi,
    }
}

/// Le schede e i gruppi dei posti del Disegno completo: sono i posti del
/// modello dei task di famiglia (la regex `POSTO` di
/// `.github/scripts/check-disegno-mappa.mjs`). Un posto di un pezzo solo
/// (`finestra`, `colonna`) ha il gruppo [`PRINCIPALE`]; una sezione
/// dell'ispettore (`ispettore/design/documento`) sta nel gruppo della sua
/// scheda, e la voce dell'indice tiene il posto intero.
pub const SCHEDE: &[Scheda] = &[
    scheda(
        "menu",
        &[
            g("file"),
            g("modifica"),
            g("oggetto"),
            g("testo"),
            g("selezione"),
            g("effetto"),
            g("visualizza"),
        ],
    ),
    scheda(
        "colonna",
        &[
            g(PRINCIPALE),
            g("scegli"),
            g("disegna"),
            g("forme"),
            g("testo"),
            g("trasforma"),
            g("colore"),
            g("oggetti"),
            g("prospettiva"),
            g("misura"),
            g("vista"),
        ],
    ),
    scheda(
        "ispettore",
        &[g("design"), g("livelli"), g("risorse"), g("cronologia")],
    ),
    scheda("finestra", &[g(PRINCIPALE)]),
    scheda("banda", &[g(PRINCIPALE)]),
    scheda("tasto-destro", &[g(PRINCIPALE)]),
    scheda("tavolozza", &[g(PRINCIPALE)]),
    scheda("testata", &[g(PRINCIPALE)]),
    scheda("interno", &[g(PRINCIPALE)]),
];

/// I sottomenu del menu ≡ che hanno un terzo livello (`menu/oggetto/tracciato`),
/// per gruppo: sono i sottomenu del motore che raccolgono più comandi
/// (Object › Path, Object › Transform, Select › Same…). Il `Posto` di K3 resta
/// `menu`/`<gruppo>`; la voce dell'indice tiene il posto intero, e il client ne
/// fa un sottomenu dentro il sottomenu. Va tenuto uguale alla regex `POSTO` di
/// `.github/scripts/check-disegno-mappa.mjs` e ai nomi di `NOMI_PEZZO` in
/// `apps/client/src/editors/spatial/completo/comandi.ts`.
pub const SOTTOMENU: &[(&str, &[&str])] = &[
    ("modifica", &["colori"]),
    (
        "oggetto",
        &[
            "tracciato",
            "elaborazione",
            "trasforma",
            "disponi",
            "fusione",
            "inviluppo",
            "blocca",
            "nascondi",
            "ritaglio",
        ],
    ),
    ("selezione", &["uguale", "oggetto"]),
    ("effetto", &["deforma", "stilizza", "distorci"]),
    ("visualizza", &["guide"]),
];

/// Il `Posto` di K3 della colonna `posto`; `None` per `fub`, `escluso` o un
/// posto che [`SCHEDE`] non ha. Un terzo pezzo vale per una sezione
/// dell'ispettore (qualsiasi nome) e per un sottomenu di [`SOTTOMENU`].
pub fn posto_di(posto: &str) -> Option<Posto> {
    let mut pezzi = posto.split('/');
    let prima = pezzi.next()?;
    let seconda = pezzi.next();
    let terza = pezzi.next();
    if pezzi.next().is_some() || terza.is_some_and(str::is_empty) {
        return None;
    }
    if let Some(sotto) = terza {
        let ammesso = match prima {
            "ispettore" => true,
            "menu" => SOTTOMENU
                .iter()
                .any(|(gruppo, sotti)| Some(*gruppo) == seconda && sotti.contains(&sotto)),
            _ => false,
        };
        if !ammesso {
            return None;
        }
    }
    let s = SCHEDE.iter().find(|s| s.id == prima)?;
    let gruppo = seconda.unwrap_or(PRINCIPALE);
    let gr = s.gruppi.iter().find(|g| g.id == gruppo)?;
    Some(Posto {
        scheda: s.id,
        gruppo: gr.id,
    })
}

// ---------------------------------------------------------------------------
// I comandi
// ---------------------------------------------------------------------------

/// Il tipo dei nomi che gli schemi del motore danno senza valore
/// (`{index}`), per [`fub_motori::Modulo::da_schema`]. Un task di famiglia
/// che fa una riga con una finestra aggiunge qui i nomi del suo schema che
/// mancano: il test `copertura` gli dice quali.
pub const NOMI: &[(&str, Tipo)] = &[
    ("angle", Tipo::Numero),
    ("color", Tipo::Testo),
    ("count", Tipo::Numero),
    ("dx", Tipo::Numero),
    ("dy", Tipo::Numero),
    ("sx", Tipo::Numero),
    ("sy", Tipo::Numero),
    ("dy", Tipo::Numero),
    ("height", Tipo::Numero),
    ("id", Tipo::Testo),
    ("ids", Tipo::Json),
    ("index", Tipo::Numero),
    ("name", Tipo::Testo),
    ("text", Tipo::Testo),
    ("title", Tipo::Testo),
    ("width", Tipo::Numero),
    ("x", Tipo::Numero),
    ("y", Tipo::Numero),
    // Le forme (T13, giro 1): i punti e le misure degli strumenti di forma.
    ("cx", Tipo::Numero),
    ("cy", Tipo::Numero),
    ("x1", Tipo::Numero),
    ("y1", Tipo::Numero),
    ("x2", Tipo::Numero),
    ("y2", Tipo::Numero),
    ("radius", Tipo::Numero),
    ("radius1", Tipo::Numero),
    ("radius2", Tipo::Numero),
    ("sides", Tipo::Numero),
    ("points", Tipo::Numero),
    ("diameter", Tipo::Numero),
    ("decay", Tipo::Numero),
    ("segments", Tipo::Numero),
    ("opacity", Tipo::Numero),
    ("brightness", Tipo::Numero),
    ("growth", Tipo::Numero),
    ("fuzziness", Tipo::Numero),
    ("rays", Tipo::Numero),
    ("longest", Tipo::Numero),
    ("rayFuzziness", Tipo::Numero),
    ("rotation", Tipo::Numero),
    ("pathLength", Tipo::Numero),
    ("rings", Tipo::Numero),
    ("largest", Tipo::Numero),
    ("direction", Tipo::Numero),
    ("seed", Tipo::Numero),
    ("slope", Tipo::Numero),
    ("fill", Tipo::SiNo),
    ("closed", Tipo::SiNo),
    ("clockwise", Tipo::SiNo),
    // Le finestre dei tracciati (T12, giro 3): `FINESTRE_SCRITTE`.
    ("offset", Tipo::Numero),
    ("miterLimit", Tipo::Numero),
    ("level", Tipo::Numero),
    ("cornerAngle", Tipo::Numero),
    ("straightLines", Tipo::SiNo),
    ("object", Tipo::SiNo),
    ("stroke", Tipo::SiNo),
    ("dash", Tipo::Numero),
    ("gap", Tipo::Numero),
    ("fit", Tipo::SiNo),
    ("removeGaps", Tipo::SiNo),
    // Le finestre di Modifica colori (T14, giro 1): Satura e Regola
    // bilanciamento colore.
    ("intensity", Tipo::Numero),
    ("r", Tipo::Numero),
    ("g", Tipo::Numero),
    ("b", Tipo::Numero),
    // Sovrastampa nero.
    ("remove", Tipo::SiNo),
    ("percentage", Tipo::Numero),
    ("includeCmyBlacks", Tipo::SiNo),
    ("includeSpotBlacks", Tipo::SiNo),
    // Le opzioni di un livello (T15, giro 3): occhio e lucchetto.
    ("visible", Tipo::SiNo),
    ("locked", Tipo::SiNo),
];

/// Una finestra che Fub scrive da sé, perché lo schema del motore descrive i
/// parametri a parole (i predefiniti e i limiti fra parentesi, opzioni che
/// la finestra non chiede): i campi nel dialetto di [`fub_motori::Modulo`],
/// i valori di partenza e i limiti, presi dal codice del comando del motore.
pub struct FinestraScritta {
    /// L'id del comando.
    pub id: &'static str,
    /// I campi che la finestra chiede, nell'ordine in cui li mostra.
    pub schema: &'static str,
    /// Il valore di partenza di ogni campo, come il motore lo prende senza.
    pub predefiniti: &'static [(&'static str, &'static str)],
    /// Il minimo e il massimo di un numero, che il motore fa rispettare.
    pub limiti: &'static [(&'static str, Option<f64>, Option<f64>)],
}

/// Le finestre dei tracciati (T12, giro 3), delle trasformazioni (T13,
/// giro 3) e di Modifica colori (T14, giro 1). Tracciati: Semplifica, Leviga, Sposta
/// tracciato, Espandi e Dividi in trattini. Semplifica chiede il cursore
/// (`level`), non la tolleranza in punti: 50 è la tolleranza di serie, 1 pt.
/// Espandi non chiede come espandere le sfumature (`gradient`, `steps`): vale
/// quello del motore, strisce piene.
pub const FINESTRE_SCRITTE: &[FinestraScritta] = &[
    FinestraScritta {
        id: "object.path.simplify",
        schema: "{level, cornerAngle, straightLines}",
        predefiniti: &[
            ("level", "50"),
            ("cornerAngle", "30"),
            ("straightLines", "false"),
        ],
        limiti: &[
            ("level", Some(0.0), Some(100.0)),
            ("cornerAngle", Some(0.0), Some(180.0)),
        ],
    },
    FinestraScritta {
        id: "object.path.smooth",
        schema: "{level}",
        predefiniti: &[("level", "50")],
        limiti: &[("level", Some(0.0), Some(100.0))],
    },
    FinestraScritta {
        id: "object.path.offsetPath",
        schema: "{offset, joins: miter|round|bevel, miterLimit}",
        predefiniti: &[("offset", "10"), ("joins", "miter"), ("miterLimit", "4")],
        limiti: &[
            ("offset", Some(-100_000.0), Some(100_000.0)),
            ("miterLimit", Some(1.0), Some(500.0)),
        ],
    },
    FinestraScritta {
        id: "object.expand",
        schema: "{object, fill, stroke}",
        predefiniti: &[("object", "true"), ("fill", "true"), ("stroke", "true")],
        limiti: &[],
    },
    FinestraScritta {
        id: "addon.pathtools.divideDashes",
        schema: "{dash, gap, fit, removeGaps}",
        predefiniti: &[
            ("dash", "10"),
            ("gap", "0"),
            ("fit", "false"),
            ("removeGaps", "true"),
        ],
        limiti: &[
            ("dash", Some(0.01), Some(1_000_000.0)),
            ("gap", Some(0.0), Some(1_000_000.0)),
        ],
    },
    // Le trasformazioni (T13, giro 3): lo schema del motore porta anche
    // `ids`, `objects`, `patterns`…, che la finestra non chiede e lascia al
    // comando (la selezione, le impostazioni). La scala sta fra 0,01 % e
    // 10000 %.
    FinestraScritta {
        id: "object.move",
        schema: "{dx, dy}",
        predefiniti: &[("dx", "0"), ("dy", "0")],
        limiti: &[],
    },
    FinestraScritta {
        id: "object.rotate",
        schema: "{angle}",
        predefiniti: &[("angle", "0")],
        limiti: &[],
    },
    FinestraScritta {
        id: "object.scale",
        schema: "{sx}",
        predefiniti: &[("sx", "100")],
        limiti: &[("sx", Some(0.01), Some(10_000.0))],
    },
    FinestraScritta {
        id: "object.reflect",
        schema: "{axis: \"vertical\"|\"horizontal\"}",
        predefiniti: &[("axis", "vertical")],
        limiti: &[],
    },
    FinestraScritta {
        id: "object.shear",
        schema: "{angle, axis?: \"horizontal\"|\"vertical\"}",
        predefiniti: &[("angle", "0"), ("axis", "horizontal")],
        limiti: &[],
    },
    // Modifica colori (T14, giro 1): Satura, Regola bilanciamento colore e
    // Sovrastampa nero. Satura chiede solo l'intensità, da -100 %
    // a 100 % (il motore porta un numero fuori al suo estremo). Regola
    // bilanciamento colore chiede i tre canali RGB, da -100 % a 100 % in più
    // per canale, e se cambiare riempimenti e tratti: il metodo è quello dei
    // canali dati (`rgb`), e ogni colore tiene il suo modello (`convert`
    // falso), come nel motore senza.
    FinestraScritta {
        id: "edit.colors.saturate",
        schema: "{intensity}",
        predefiniti: &[("intensity", "0")],
        limiti: &[("intensity", Some(-100.0), Some(100.0))],
    },
    FinestraScritta {
        id: "edit.colors.adjustBalance",
        schema: "{r, g, b, fill, stroke}",
        predefiniti: &[
            ("r", "0"),
            ("g", "0"),
            ("b", "0"),
            ("fill", "true"),
            ("stroke", "true"),
        ],
        limiti: &[
            ("r", Some(-100.0), Some(100.0)),
            ("g", Some(-100.0), Some(100.0)),
            ("b", Some(-100.0), Some(100.0)),
        ],
    },
    // Sovrastampa nero chiede se aggiungere o togliere, da quanto nero, su che
    // cosa e quali neri: non gli oggetti (`ids`), che sono quelli scelti.
    FinestraScritta {
        id: "edit.colors.overprintBlack",
        schema: "{remove, percentage, fill, stroke, includeCmyBlacks, includeSpotBlacks}",
        predefiniti: &[
            ("remove", "false"),
            ("percentage", "100"),
            ("fill", "true"),
            ("stroke", "true"),
            ("includeCmyBlacks", "false"),
            ("includeSpotBlacks", "false"),
        ],
        limiti: &[("percentage", Some(0.0), Some(100.0))],
    },
    // Nuovo livello… e Opzioni livello… (T15, giro 3) chiedono solo ciò che il
    // formato della scena scrive: il nome, l'occhio e il lucchetto. Il colore,
    // il modello, la stampa, l'anteprima e le immagini attenuate non hanno un
    // attributo nel file, e il comando li rifiuta. Il nome di serie di un
    // livello nuovo lo dà Fub (il primo «Livello N» libero); i livelli che le
    // opzioni cambiano (`ids`) li dà il pannello, non la finestra.
    FinestraScritta {
        id: "layer.new",
        schema: "{name?, visible, locked}",
        predefiniti: &[("visible", "true"), ("locked", "false")],
        limiti: &[],
    },
    FinestraScritta {
        id: "layer.setProps",
        schema: "{name?, visible?, locked?}",
        predefiniti: &[],
        limiti: &[],
    },
    // Metodo forma (T13) dal menu chiede il metodo: i membri delle forme
    // composte scelte lo prendono tutti. I pulsanti della sezione «Elaborazione
    // tracciati» lo mandano senza finestra, col metodo del pulsante.
    // Media e Media e unisci (T12): l'asse, e il punto che l'unione lascia.
    // Il motore media su entrambi gli assi senza `axis`; `to` lo vuole.
    FinestraScritta {
        id: "path.average",
        schema: "{axis: \"both\"|\"horizontal\"|\"vertical\"}",
        predefiniti: &[("axis", "both")],
        limiti: &[],
    },
    FinestraScritta {
        id: "path.averageJoin",
        schema: "{to: \"corner\"|\"smooth\"}",
        predefiniti: &[("to", "corner")],
        limiti: &[],
    },
    FinestraScritta {
        id: "object.compoundShape.setMode",
        schema: "{mode: add|subtract|intersect|exclude}",
        predefiniti: &[("mode", "add")],
        limiti: &[],
    },
];

/// La finestra scritta da Fub per il comando `id`, se ne ha una.
pub fn finestra_scritta(id: &str) -> Option<&'static FinestraScritta> {
    FINESTRE_SCRITTE.iter().find(|f| f.id == id)
}

/// I comandi di forma che hanno una finestra delle misure (T13, giro 1): per
/// loro lo schema va ripulito come dice [`schema_pulito`].
pub const COMANDI_DI_FORMA: &[&str] = &[
    "shape.rectangle",
    "shape.ellipse",
    "shape.polygon",
    "shape.star",
    "shape.flare",
    "shape.line",
    "shape.spiral",
    "shape.arc",
];

/// Le misure di una forma che partono da 100 quando lo schema non dà un predefinito (K6 T13,
/// giro 3): una larghezza, un'altezza o un raggio a 0 non è una forma, e OK non deve partire.
pub const MISURE_DI_PARTENZA: &[&str] = &[
    "width", "height", "radius", "radius1", "radius2", "diameter",
];

/// Lo schema di una finestra di forma, dal primo modulo dello schema del
/// motore: senza le note fra parentesi e senza i predefiniti (`sides=6`), che
/// il lettore dello schema non legge e che [`predefiniti`] dà a parte. Un
/// optional numerico senza predefinito non ha un valore che la finestra possa
/// mandare (un `x2` vuoto è un anello sbagliato), e non si chiede: se ne va.
/// L'alternativa dopo il primo modulo (`… or {…}` dell'arco) non si chiede.
pub fn schema_pulito(schema: &str) -> String {
    let (campi, _) = analizza(schema);
    format!("{{{}}}", campi.join(", "))
}

/// I predefiniti che lo schema di una finestra di forma scrive dopo `=`, per
/// nome del campo: `sides=6` dà `("sides", "6")`.
pub fn predefiniti(schema: &str) -> Vec<(String, String)> {
    analizza(schema).1
}

/// I predefiniti del comando di forma `id`, dallo schema del motore, o quelli
/// della sua finestra scritta ([`FINESTRE_SCRITTE`]); vuoti per gli altri.
pub fn predefiniti_del_comando(id: &str) -> Vec<(String, String)> {
    if let Some(finestra) = finestra_scritta(id) {
        return finestra
            .predefiniti
            .iter()
            .map(|(nome, valore)| (nome.to_string(), valore.to_string()))
            .collect();
    }
    if !COMANDI_DI_FORMA.contains(&id) {
        return Vec::new();
    }
    let mut out = vectorcraft_engine::find_command(id)
        .map(|c| predefiniti(c.params))
        .unwrap_or_default();
    for misura in MISURE_DI_PARTENZA {
        if !out.iter().any(|(nome, _)| nome == misura) {
            out.push(((*misura).to_string(), "100".to_string()));
        }
    }
    out
}

/// Analizza il primo modulo di `schema`: i campi che restano (`nome` o
/// `nome?`) e i predefiniti. Un campo che non comincia con un nome passa com'è.
fn analizza(schema: &str) -> (Vec<String>, Vec<(String, String)>) {
    let (Some(inizio), Some(fine)) = (schema.find('{'), schema.find('}')) else {
        return (Vec::new(), Vec::new());
    };
    if fine < inizio {
        return (Vec::new(), Vec::new());
    }
    let mut campi = Vec::new();
    let mut predefiniti = Vec::new();
    for pezzo in dividi_fuori_dalle_parentesi(&schema[inizio + 1..fine]) {
        let pezzo = senza_note(pezzo.trim());
        let nome: String = pezzo
            .chars()
            .take_while(|c| c.is_alphanumeric() || *c == '_')
            .collect();
        if nome.is_empty() {
            continue;
        }
        let mut resto = &pezzo[nome.len()..];
        let facoltativo = resto.starts_with('?');
        if facoltativo {
            resto = &resto[1..];
        }
        let mut predefinito = None;
        if let Some(dopo_uguale) = resto.strip_prefix('=') {
            let valore: String = dopo_uguale
                .chars()
                .take_while(|c| !c.is_whitespace() && *c != ':')
                .collect();
            predefinito = Some(valore.clone());
            predefiniti.push((nome.clone(), valore));
        }
        let numerico = NOMI.iter().any(|(n, t)| *n == nome && *t == Tipo::Numero);
        if facoltativo && numerico && predefinito.is_none() {
            continue;
        }
        campi.push(if facoltativo {
            format!("{nome}?")
        } else {
            nome
        });
    }
    (campi, predefiniti)
}

/// I pezzi di `testo` separati dalle virgole che non stanno fra parentesi.
fn dividi_fuori_dalle_parentesi(testo: &str) -> Vec<&str> {
    let (mut pezzi, mut profondita, mut da) = (Vec::new(), 0usize, 0usize);
    for (i, c) in testo.char_indices() {
        match c {
            '(' => profondita += 1,
            ')' => profondita = profondita.saturating_sub(1),
            ',' if profondita == 0 => {
                pezzi.push(&testo[da..i]);
                da = i + 1;
            }
            _ => {}
        }
    }
    pezzi.push(&testo[da..]);
    pezzi
}

/// Il pezzo senza le note fra parentesi (`decay=80 (%)` diventa `decay=80`).
fn senza_note(pezzo: &str) -> String {
    let mut out = String::new();
    let mut profondita = 0usize;
    for c in pezzo.chars() {
        match c {
            '(' => profondita += 1,
            ')' => profondita = profondita.saturating_sub(1),
            _ if profondita == 0 => out.push(c),
            _ => {}
        }
    }
    out.trim().to_string()
}

/// Il limite minimo di un campo di una finestra di forma: le misure sono
/// positive (il campo mostra due decimali, e lo zero è una forma che non c'è),
/// e i conteggi hanno il loro minimo (un poligono ha almeno tre lati). Nessun
/// massimo: il motore non ne dà uno. Una finestra scritta
/// ([`FINESTRE_SCRITTE`]) dà i suoi limiti.
pub fn minimo_del_campo(comando: &str, campo: &str) -> Option<f64> {
    if let Some(finestra) = finestra_scritta(comando) {
        return finestra
            .limiti
            .iter()
            .find(|(n, ..)| *n == campo)
            .and_then(|(_, min, _)| *min);
    }
    if !COMANDI_DI_FORMA.contains(&comando) {
        return None;
    }
    match campo {
        "width" | "height" | "radius" | "radius1" | "radius2" | "diameter" => Some(0.01),
        "sides" | "points" => Some(3.0),
        "segments" | "rays" | "rings" => Some(1.0),
        _ => None,
    }
}

/// Il limite massimo di un campo di una finestra scritta ([`FINESTRE_SCRITTE`]):
/// le finestre di forma non ne hanno.
pub fn massimo_del_campo(comando: &str, campo: &str) -> Option<f64> {
    finestra_scritta(comando)?
        .limiti
        .iter()
        .find(|(n, ..)| *n == campo)
        .and_then(|(_, _, max)| *max)
}

/// La riga ha una finestra: la nota lo dice, il posto è `finestra`, o
/// l'etichetta del motore finisce coi puntini.
pub fn ha_finestra(riga: &RigaMappa) -> bool {
    riga.posto == "finestra"
        || riga.nota.split([',', ';']).any(|p| p.trim() == "finestra")
        || riga.etichetta.ends_with('…')
}

/// Il prefisso di un id che cambia soltanto ciò che si vede.
fn solo_vista(id: &str) -> bool {
    ["select.", "view.", "window.", "zoom.", "ui."]
        .iter()
        .any(|p| id.starts_with(p))
}

/// Che cosa fa la riga al disegno. Un comando del motore che non va nella
/// sua cronologia legge (o mostra, se è una selezione o una vista); uno che
/// ci va cambia, salvo una selezione o una vista. Uno strumento e un effetto
/// cambiano; un pannello mostra; una voce dell'interfaccia mostra se è una
/// selezione o una vista, se no cambia.
pub fn effetto_di(riga: &RigaMappa) -> Effetto {
    match riga.fonte {
        FonteMappa::Motore => {
            let registra = vectorcraft_engine::find_command(&riga.id).is_none_or(|c| c.journal);
            match (registra, solo_vista(&riga.id)) {
                (_, true) => Effetto::Mostra,
                (true, false) => Effetto::Cambia,
                (false, false) => Effetto::Legge,
            }
        }
        FonteMappa::Effetto | FonteMappa::Strumento => Effetto::Cambia,
        FonteMappa::Pannello => Effetto::Mostra,
        FonteMappa::Interfaccia if solo_vista(&riga.id) => Effetto::Mostra,
        FonteMappa::Interfaccia => Effetto::Cambia,
    }
}

/// Gli effetti del motore, ognuno con lo schema dei suoi valori, come li dà
/// `effect.list`: vuoto se il motore non lo dà.
pub fn effetti_del_motore() -> &'static BTreeMap<String, String> {
    static SCHEMI: OnceLock<BTreeMap<String, String>> = OnceLock::new();
    SCHEMI.get_or_init(|| {
        let elenco = vectorcraft_engine::guard::catch_panic(|| {
            let mut sessione = vectorcraft_engine::Session::new();
            sessione.execute("effect.list", &Value::Object(Default::default()))
        });
        let Ok(Ok(elenco)) = elenco else {
            return BTreeMap::new();
        };
        elenco["catalog"]
            .as_array()
            .map(|voci| {
                voci.iter()
                    .filter_map(|v| {
                        Some((
                            v["id"].as_str()?.to_string(),
                            v["params"].as_str().unwrap_or_default().to_string(),
                        ))
                    })
                    .collect()
            })
            .unwrap_or_default()
    })
}

/// Lo schema del motore per i parametri della riga, vuoto se non ne ha.
pub fn schema_di(riga: &RigaMappa) -> String {
    match riga.fonte {
        FonteMappa::Motore if COMANDI_DI_FORMA.contains(&riga.id.as_str()) => {
            vectorcraft_engine::find_command(&riga.id)
                .map(|c| schema_pulito(c.params))
                .unwrap_or_default()
        }
        FonteMappa::Motore => match finestra_scritta(&riga.id) {
            Some(finestra) => finestra.schema.to_string(),
            None => vectorcraft_engine::find_command(&riga.id)
                .map(|c| c.params.to_string())
                .unwrap_or_default(),
        },
        FonteMappa::Effetto => effetti_del_motore()
            .get(&riga.id)
            .cloned()
            .unwrap_or_default(),
        _ => String::new(),
    }
}

/// Il tasto del motore per la riga, se ne ha uno.
pub fn tasto_di(riga: &RigaMappa) -> Option<&'static str> {
    match riga.fonte {
        FonteMappa::Motore => vectorcraft_engine::find_command(&riga.id).and_then(|c| c.shortcut),
        FonteMappa::Strumento => {
            vectorcraft_tools::catalog::tool_info(&riga.id).and_then(|t| t.shortcut)
        }
        _ => None,
    }
}

/// La `SpecMotore` di K3 della riga: l'etichetta inglese passata per il
/// glossario, il menu del motore, lo schema dei parametri se la riga ha una
/// finestra (gli altri comandi girano senza), e l'effetto.
pub fn spec(riga: &RigaMappa) -> SpecMotore {
    SpecMotore {
        id: riga.id.clone(),
        etichetta: glossario().applica(Lingua::En, &riga.etichetta),
        menu: riga.menu.clone(),
        parametri: if ha_finestra(riga) {
            schema_di(riga)
        } else {
            String::new()
        },
        effetto: effetto_di(riga),
    }
}

/// La riga va nell'indice: è fatta, o è di Fub e ha un posto vero.
pub fn nell_indice(riga: &RigaMappa) -> bool {
    match riga.stato {
        Stato::Fatto => true,
        Stato::Fub => posto_di(&riga.posto).is_some(),
        Stato::DaFare | Stato::Escluso => false,
    }
}

/// Una voce dell'indice: il comando importato e ciò che il client mostra.
#[derive(Debug, Clone, PartialEq)]
pub struct Voce {
    pub fonte: FonteMappa,
    /// L'id della riga (del motore, senza prefisso).
    pub id: String,
    /// Il comando come lo dà `importa`.
    pub comando: ComandoFub,
    /// L'etichetta italiana, passata per il glossario.
    pub etichetta_it: String,
    /// L'etichetta inglese, passata per il glossario.
    pub etichetta_en: String,
    /// La colonna `posto`, intera.
    pub posto: String,
    /// La famiglia (una delle 26, o `fub`).
    pub famiglia: String,
    /// Il tasto del motore.
    pub tasto: Option<&'static str>,
    /// Ha una finestra.
    pub finestra: bool,
    /// La feature del motore dietro cui sta, se c'è.
    pub sotto: Option<String>,
}

/// Le voci delle righe date, importate fonte per fonte.
///
/// # Errors
///
/// Le mancanze di `importa`: un id che non vale, un posto fuori elenco, uno
/// schema che non si legge con [`NOMI`].
pub fn voci_di(righe: &[&RigaMappa]) -> Result<Vec<Voce>, Vec<Mancanza>> {
    let mut voci = Vec::new();
    let mut mancanze = Vec::new();
    for fonte in FonteMappa::TUTTE {
        let della_fonte: Vec<&RigaMappa> =
            righe.iter().copied().filter(|r| r.fonte == fonte).collect();
        if della_fonte.is_empty() {
            continue;
        }
        let specifiche: Vec<SpecMotore> = della_fonte.iter().map(|r| spec(r)).collect();
        let posti: Vec<(&str, Posto)> = della_fonte
            .iter()
            .filter_map(|r| Some((r.id.as_str(), posto_di(&r.posto)?)))
            .collect();
        let adattamento = Adattamento {
            schede: SCHEDE,
            posti: &[],
            posti_del_comando: &posti,
            nomi: NOMI,
            nomi_del_comando: &[],
        };
        match importa(SPAZIO, &specifiche, &adattamento) {
            Ok(comandi) => {
                for (riga, comando) in della_fonte.iter().zip(comandi) {
                    voci.push(Voce {
                        fonte,
                        id: riga.id.clone(),
                        etichetta_it: glossario().applica(Lingua::It, &riga.etichetta_it),
                        etichetta_en: comando.etichetta.clone(),
                        posto: riga.posto.clone(),
                        famiglia: riga.famiglia.clone(),
                        tasto: tasto_di(riga),
                        finestra: ha_finestra(riga),
                        sotto: riga.sotto().map(str::to_string),
                        comando,
                    });
                }
            }
            Err(m) => mancanze.extend(m),
        }
    }
    if mancanze.is_empty() {
        Ok(voci)
    } else {
        Err(mancanze)
    }
}

/// L'indice: una voce per ogni riga della mappa che [`nell_indice`] vuole.
///
/// # Errors
///
/// Come [`voci_di`].
pub fn indice() -> Result<Vec<Voce>, Vec<Mancanza>> {
    let righe: Vec<&RigaMappa> = mappa().iter().filter(|r| nell_indice(r)).collect();
    voci_di(&righe)
}

/// Perché il comando del motore `id` non è nell'indice, o `None` se c'è:
/// lo stato e la nota della sua riga.
pub fn non_servito(id: &str) -> Option<&'static str> {
    let r = riga(FonteMappa::Motore, id)?;
    if nell_indice(r) {
        return None;
    }
    Some(match r.stato {
        Stato::DaFare => "da fare: lo porta il task della sua famiglia",
        Stato::Fub | Stato::Escluso if !r.nota.trim().is_empty() => r.nota.as_str(),
        Stato::Fub => "lo serve una funzione di Fub",
        Stato::Escluso => "Fub non lo offre",
        Stato::Fatto => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn il_glossario_cambia_parole_intere_e_tiene_la_maiuscola() {
        let g = Glossario::leggi(
            "lingua\tmotore\tfub\tnota\nit\ttavola da disegno\ttavola\t\nit\ttraccia\tcontorno\t\n",
        )
        .unwrap();
        assert_eq!(
            g.applica(Lingua::It, "Nuova tavola da disegno"),
            "Nuova tavola"
        );
        assert_eq!(
            g.applica(Lingua::It, "Traccia e tracciato"),
            "Contorno e tracciato"
        );
        assert_eq!(g.applica(Lingua::En, "Traccia"), "Traccia");
        assert!(Glossario::leggi("it\ta\tb\n").is_err());
        assert!(Glossario::leggi("lingua\tmotore\tfub\tnota\nfr\ta\tb\t\n").is_err());
    }

    #[test]
    fn i_posti_del_modello_hanno_scheda_e_gruppo() {
        let p = |s| posto_di(s).map(|p| (p.scheda, p.gruppo));
        assert_eq!(p("menu/oggetto"), Some(("menu", "oggetto")));
        assert_eq!(p("colonna"), Some(("colonna", PRINCIPALE)));
        assert_eq!(p("colonna/forme"), Some(("colonna", "forme")));
        assert_eq!(
            p("ispettore/design/documento"),
            Some(("ispettore", "design"))
        );
        assert_eq!(p("finestra"), Some(("finestra", PRINCIPALE)));
        assert_eq!(p("fub"), None);
        assert_eq!(p("escluso"), None);
        assert_eq!(p("menu/oggetto/tracciato"), Some(("menu", "oggetto")));
        assert_eq!(p("menu/selezione/uguale"), Some(("menu", "selezione")));
        assert_eq!(p("menu/oggetto/altro"), None);
        assert_eq!(p("menu/file/tracciato"), None);
        assert_eq!(p("menu/oggetto/tracciato/punti"), None);
        assert_eq!(p("menu/oggetto/"), None);
        assert_eq!(p("colonna/forme/tracciato"), None);
        // Ogni sottomenu del terzo livello sta in un gruppo del menu ≡.
        let menu = SCHEDE.iter().find(|s| s.id == "menu").unwrap();
        for (gruppo, sotti) in SOTTOMENU {
            assert!(menu.gruppi.iter().any(|g| g.id == *gruppo), "{gruppo}");
            assert!(!sotti.is_empty(), "{gruppo}");
        }
        assert_eq!(p("ispettore/design/"), None);
        assert_eq!(p("menu/nessuno"), None);
    }
}
