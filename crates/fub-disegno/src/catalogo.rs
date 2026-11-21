//! L'indice dei comandi del Disegno completo (piano K6, T5;
//! `docs/architecture/disegno.md`, «L'indice e i pezzi pigri»).
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

/// Il `Posto` di K3 della colonna `posto`; `None` per `fub`, `escluso` o un
/// posto che [`SCHEDE`] non ha.
pub fn posto_di(posto: &str) -> Option<Posto> {
    let mut pezzi = posto.split('/');
    let prima = pezzi.next()?;
    let seconda = pezzi.next();
    // Una sezione dell'ispettore ha un terzo pezzo; nient'altro.
    let terza = pezzi.next();
    if pezzi.next().is_some() || (terza.is_some() && prima != "ispettore") {
        return None;
    }
    if terza.is_some_and(str::is_empty) {
        return None;
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
];

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
        FonteMappa::Motore => vectorcraft_engine::find_command(&riga.id)
            .map(|c| c.params.to_string())
            .unwrap_or_default(),
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
        assert_eq!(p("menu/oggetto/altro"), None);
        assert_eq!(p("ispettore/design/"), None);
        assert_eq!(p("menu/nessuno"), None);
    }
}
