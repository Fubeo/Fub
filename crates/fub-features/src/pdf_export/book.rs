//! Più note in un PDF: il libro (E28, T78).
//!
//! Una cartella o una scelta di note diventa un PDF solo: ogni nota un
//! capitolo, nell'ordine dell'albero o della scelta. La vista impagina ogni
//! nota come per il PDF di una nota sola e manda un [`Libro`]: i capitoli in
//! fila, ognuno col suo [elenco delle pagine](super::ElencoPagine) e i suoi
//! [rimandi](Rimando), i collegamenti che nella nota portano a un'altra nota.
//! Il libro può avere anche capitoli senza nota (il frontespizio, l'indice
//! unico del libro): sono pagine come le altre, e i loro rimandi portano alle
//! note.
//!
//! [`componi`] ne fa un elenco solo, quello che lo scrittore conosce:
//!
//! - le pagine dei capitoli una dopo l'altra, e i collegamenti dentro una nota
//!   spostati con le sue pagine;
//! - le facce dei caratteri di tutti i capitoli in una tavola sola;
//! - un segnalibro per nota, col suo titolo, e sotto i titoli della nota:
//!   l'indice del lettore è uno solo. Due note con lo stesso titolo si
//!   distinguono col percorso;
//! - ogni rimando a una nota del libro diventa un collegamento interno, al
//!   punto della sezione se il rimando la nomina; un rimando a una nota che il
//!   libro non ha resta verso fuori, se la vista gli dà un indirizzo, se no
//!   resta testo e lo dice un avviso.
//!
//! Il comando [`PDF_WRITE_BOOK`] compone il libro e passa l'elenco al comando
//! di una nota ([`lavoro`](super::lavoro)): il lavoro è uno solo, quello che
//! scrive le pagine, con la sua barra nel centro attività e il suo
//! annullamento, e il file arriva intero o non arriva.

use std::collections::{BTreeMap, BTreeSet};

use fub_abi::command::{
    Args, Choice, CommandEffect, CommandOutcome, CommandReach, CommandScope, CommandSpec,
    InvokeMode, ParamKind, ParamSpec,
};
use fub_abi::error::PluginError;
use fub_abi::model::heading_slug;
use fub_abi::rules::path::resolution_key;
use fub_abi::rules::path_policy;
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{CommandProvider, HostApi};
use serde::{Deserialize, Serialize};

use super::writer::valida;
use super::{
    Collegamento, Destinazione, ElencoPagine, ErroreEsportazione, Faccia, Pezzo, Segnalibro,
    MAX_ELENCO_BYTE, MAX_LIVELLO_SEGNALIBRO, MAX_TESTO_DATI, VERSIONE,
};

/// Scrive nel vault il PDF di più note, una per capitolo.
pub const PDF_WRITE_BOOK: &str = "pdf.write_book";

/// La versione del formato del libro.
pub const VERSIONE_LIBRO: u32 = 1;

/// Quanti capitoli al più: le note di una cartella grande ci stanno, e le
/// pagine hanno comunque il loro tetto ([`MAX_PAGINE`](super::MAX_PAGINE)).
pub const MAX_CAPITOLI: usize = 2_000;

/// Quanto possono differire due misure di pagina, in pixel CSS, per dirsi la
/// stessa: la vista le scrive tutte dallo stesso profilo.
const TOLLERANZA_MISURA: f64 = 0.01;

/// Più note da scrivere in un PDF solo.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Libro {
    /// [`VERSIONE_LIBRO`].
    pub versione: u32,
    /// Il titolo del PDF (la cartella, o ciò che la persona ha scritto).
    #[serde(default)]
    pub titolo: String,
    #[serde(default)]
    pub autore: String,
    #[serde(default)]
    pub lingua: String,
    /// I capitoli, nell'ordine in cui escono.
    pub capitoli: Vec<Capitolo>,
}

/// Un capitolo: le pagine di una nota, o pagine del libro (il frontespizio,
/// l'indice) se non nomina una nota.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Capitolo {
    /// Il percorso della nota nel vault: i rimandi la trovano per questo.
    #[serde(default)]
    pub nota: Option<String>,
    /// Il titolo del capitolo nei segnalibri; vuoto, quello dell'elenco, e
    /// poi il nome del file.
    #[serde(default)]
    pub titolo: String,
    /// Le pagine del capitolo, come la vista le manda per una nota sola: i
    /// collegamenti interni contano le pagine del capitolo, dalla sua prima.
    pub pagine: ElencoPagine,
    /// I collegamenti verso altre note.
    #[serde(default)]
    pub rimandi: Vec<Rimando>,
}

/// Un collegamento di un capitolo verso una nota: un riquadro della pagina
/// che il libro risolve.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rimando {
    /// La pagina del capitolo, dalla sua prima, che è la 0.
    pub pagina: usize,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    /// Il percorso della nota a cui porta.
    pub nota: String,
    /// Il titolo della sezione della nota, se il collegamento la nomina
    /// (`[[Nota#Sezione]]`).
    #[serde(default)]
    pub sezione: Option<String>,
    /// Dove porta se la nota non è nel libro: un indirizzo che il PDF apre
    /// (`http`, `https`, `mailto`). Senza, il testo resta e il clic no.
    #[serde(default)]
    pub url: Option<String>,
}

/// Il libro composto: l'elenco da scrivere e ciò che non è andato come la
/// vista lo mostrava.
#[derive(Debug)]
pub struct Composto {
    pub elenco: ElencoPagine,
    pub avvisi: Vec<AvvisoLibro>,
}

/// Ciò che il libro ha di diverso dalle note, detto per nome: non ferma la
/// scrittura.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(tag = "avviso", rename_all = "snake_case")]
pub enum AvvisoLibro {
    /// Collegamenti a una nota che il libro non ha, senza un indirizzo verso
    /// fuori: il testo resta, il clic no.
    NotaNonEsportata { nota: String },
    /// Un collegamento a una sezione che la nota non ha (o non ha più): porta
    /// all'inizio della nota.
    SezioneNonTrovata { nota: String, sezione: String },
}

/// Perché un libro non diventa un elenco.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "errore", rename_all = "snake_case")]
pub enum ErroreLibro {
    /// Il JSON del libro non si legge come un libro di questa versione.
    Illeggibile { motivo: String },
    /// Il JSON del libro pesa più di [`MAX_ELENCO_BYTE`].
    TroppoGrande { byte: u64 },
    /// Un libro di un'altra versione del formato.
    Versione { trovata: u32 },
    /// Nessun capitolo, o più di [`MAX_CAPITOLI`].
    NumeroCapitoli { capitoli: usize },
    /// Un capitolo con la pagina di un'altra misura: il PDF ha una misura sola.
    MisureDiverse { capitolo: usize },
    /// La stessa nota in due capitoli.
    NotaRipetuta { nota: String },
    /// Le pagine di un capitolo non sono un elenco valido.
    Capitolo {
        capitolo: usize,
        nota: Option<String>,
        motivo: ErroreEsportazione,
    },
    /// Un rimando con una misura che non è un numero, o su una pagina che il
    /// capitolo non ha.
    RimandoRotto {
        capitolo: usize,
        nota: Option<String>,
        rimando: usize,
    },
}

/// Il percorso di una nota nella forma in cui il libro le confronta.
fn chiave(nota: &str) -> String {
    path_policy::from_outside(nota)
}

/// Il nome del file senza cartella né estensione.
fn stelo(nota: &str) -> &str {
    let nome = nota.rsplit('/').next().unwrap_or(nota);
    nome.rsplit_once('.').map_or(nome, |(stelo, _)| stelo)
}

/// Il percorso senza l'estensione del file, per distinguere due titoli
/// uguali: un punto in una cartella non è un'estensione.
fn senza_estensione(nota: &str) -> &str {
    let cartella = nota.rfind('/').map_or(0, |i| i + 1);
    match nota[cartella..].rfind('.') {
        Some(punto) if punto > 0 => &nota[..cartella + punto],
        _ => nota,
    }
}

/// Un testo tagliato a `max` caratteri.
fn al_piu(testo: &str, max: usize) -> String {
    testo.chars().take(max).collect()
}

/// Il `sezione` di un rimando nomina questo titolo? La stessa regola di un
/// `[[Nota#Sezione]]` ([`heading_matches`](fub_abi::model::heading_matches)):
/// lo slug, o il titolo com'è, con la chiave di risoluzione dei nomi.
fn titolo_uguale(sezione: &str, titolo: &str) -> bool {
    heading_slug(sezione) == heading_slug(titolo)
        || resolution_key(sezione) == resolution_key(titolo)
}

fn misura_valida(valori: [f64; 4]) -> bool {
    valori.iter().all(|v| v.is_finite()) && valori[2] >= 0.0 && valori[3] >= 0.0
}

/// Il libro dal suo JSON, dopo il controllo del peso.
pub fn leggi(json: &str) -> Result<Libro, ErroreLibro> {
    if json.len() > MAX_ELENCO_BYTE {
        return Err(ErroreLibro::TroppoGrande {
            byte: json.len() as u64,
        });
    }
    serde_json::from_str(json).map_err(|e| ErroreLibro::Illeggibile {
        motivo: e.to_string(),
    })
}

/// Compone il libro in un elenco solo. I limiti dell'elenco intero (le
/// pagine, i collegamenti, i segnalibri) li controlla chi lo scrive, come per
/// una nota sola.
pub fn componi(libro: &Libro) -> Result<Composto, ErroreLibro> {
    if libro.versione != VERSIONE_LIBRO {
        return Err(ErroreLibro::Versione {
            trovata: libro.versione,
        });
    }
    let n = libro.capitoli.len();
    if n == 0 || n > MAX_CAPITOLI {
        return Err(ErroreLibro::NumeroCapitoli { capitoli: n });
    }
    let primo = &libro.capitoli[0].pagine;
    let (larghezza, altezza) = (primo.larghezza, primo.altezza);

    // Le note del libro, con la pagina dove comincia ognuna.
    let mut inizio = Vec::with_capacity(n);
    let mut note: BTreeMap<String, usize> = BTreeMap::new();
    let mut pagine_prima = 0usize;
    for (i, capitolo) in libro.capitoli.iter().enumerate() {
        valida(&capitolo.pagine).map_err(|motivo| ErroreLibro::Capitolo {
            capitolo: i,
            nota: capitolo.nota.clone(),
            motivo,
        })?;
        if (capitolo.pagine.larghezza - larghezza).abs() > TOLLERANZA_MISURA
            || (capitolo.pagine.altezza - altezza).abs() > TOLLERANZA_MISURA
        {
            return Err(ErroreLibro::MisureDiverse { capitolo: i });
        }
        if let Some(nota) = &capitolo.nota {
            let k = chiave(nota);
            if note.insert(k.clone(), i).is_some() {
                return Err(ErroreLibro::NotaRipetuta { nota: k });
            }
        }
        inizio.push(pagine_prima);
        pagine_prima += capitolo.pagine.pagine.len();
    }

    let etichette = etichette(libro);
    let mut facce: Vec<Faccia> = Vec::new();
    let mut pagine = Vec::with_capacity(pagine_prima);
    let mut segnalibri = Vec::new();
    let mut avvisi = BTreeSet::new();

    for (i, capitolo) in libro.capitoli.iter().enumerate() {
        let parte = inizio[i];
        // Le facce del capitolo nella tavola del libro: due capitoli con lo
        // stesso carattere ne incorporano uno.
        let mappa: Vec<usize> = capitolo
            .pagine
            .facce
            .iter()
            .map(|faccia| match facce.iter().position(|f| f == faccia) {
                Some(k) => k,
                None => {
                    facce.push(faccia.clone());
                    facce.len() - 1
                }
            })
            .collect();
        let primo_nuovo = pagine.len();
        for pagina in &capitolo.pagine.pagine {
            let mut pagina = pagina.clone();
            for pezzo in &mut pagina.pezzi {
                if let Pezzo::Testo { faccia, .. } = pezzo {
                    *faccia = mappa[*faccia];
                }
            }
            for collegamento in &mut pagina.collegamenti {
                if let Destinazione::Dentro { pagina, .. } = &mut collegamento.destinazione {
                    *pagina += parte;
                }
            }
            pagine.push(pagina);
        }
        for (r, rimando) in capitolo.rimandi.iter().enumerate() {
            let rotto = ErroreLibro::RimandoRotto {
                capitolo: i,
                nota: capitolo.nota.clone(),
                rimando: r,
            };
            if rimando.pagina >= capitolo.pagine.pagine.len()
                || !misura_valida([rimando.x, rimando.y, rimando.w, rimando.h])
            {
                return Err(rotto);
            }
            let destinazione = match risolvi(libro, &note, &inizio, rimando, &mut avvisi) {
                Some(destinazione) => destinazione,
                None => continue,
            };
            pagine[primo_nuovo + rimando.pagina]
                .collegamenti
                .push(Collegamento {
                    x: rimando.x,
                    y: rimando.y,
                    w: rimando.w,
                    h: rimando.h,
                    destinazione,
                });
        }
        // Un segnalibro per nota, e i suoi titoli un livello sotto; le pagine
        // del libro (frontespizio, indice) tengono i loro.
        let sotto = u8::from(capitolo.nota.is_some());
        if capitolo.nota.is_some() {
            segnalibri.push(Segnalibro {
                titolo: etichette[i].clone(),
                livello: 1,
                pagina: parte,
                y: 0.0,
            });
        }
        for segnalibro in &capitolo.pagine.segnalibri {
            segnalibri.push(Segnalibro {
                titolo: segnalibro.titolo.clone(),
                livello: segnalibro
                    .livello
                    .saturating_add(sotto)
                    .min(MAX_LIVELLO_SEGNALIBRO),
                pagina: segnalibro.pagina + parte,
                y: segnalibro.y,
            });
        }
    }

    Ok(Composto {
        elenco: ElencoPagine {
            versione: VERSIONE,
            larghezza,
            altezza,
            titolo: libro.titolo.clone(),
            autore: libro.autore.clone(),
            lingua: libro.lingua.clone(),
            facce,
            pagine,
            segnalibri,
        },
        avvisi: avvisi.into_iter().collect(),
    })
}

/// Il titolo di ogni capitolo nei segnalibri: il suo, o quello del suo
/// elenco, o il nome del file. Due note con lo stesso titolo prendono accanto
/// il percorso, così nell'indice del lettore si distinguono.
fn etichette(libro: &Libro) -> Vec<String> {
    let base: Vec<String> = libro
        .capitoli
        .iter()
        .map(|capitolo| {
            let scelto = [capitolo.titolo.trim(), capitolo.pagine.titolo.trim()]
                .into_iter()
                .find(|t| !t.is_empty())
                .map(str::to_owned);
            scelto.unwrap_or_else(|| {
                capitolo
                    .nota
                    .as_deref()
                    .map(|nota| stelo(&chiave(nota)).to_owned())
                    .unwrap_or_default()
            })
        })
        .collect();
    let mut quanti: BTreeMap<String, usize> = BTreeMap::new();
    for (capitolo, titolo) in libro.capitoli.iter().zip(&base) {
        if capitolo.nota.is_some() {
            *quanti.entry(resolution_key(titolo)).or_default() += 1;
        }
    }
    libro
        .capitoli
        .iter()
        .zip(base)
        .map(|(capitolo, titolo)| {
            let doppio = quanti.get(&resolution_key(&titolo)).is_some_and(|n| *n > 1);
            let titolo = match (&capitolo.nota, doppio) {
                (Some(nota), true) => {
                    format!("{titolo} ({})", senza_estensione(&chiave(nota)))
                }
                _ => titolo,
            };
            al_piu(&titolo, MAX_TESTO_DATI)
        })
        .collect()
}

/// Dove porta un rimando: dentro il libro se la nota c'è, fuori se ha un
/// indirizzo, da nessuna parte (con l'avviso) se no.
fn risolvi(
    libro: &Libro,
    note: &BTreeMap<String, usize>,
    inizio: &[usize],
    rimando: &Rimando,
    avvisi: &mut BTreeSet<AvvisoLibro>,
) -> Option<Destinazione> {
    let k = chiave(&rimando.nota);
    let Some(&capitolo) = note.get(&k) else {
        return match rimando.url.as_deref().map(str::trim) {
            Some(url) if !url.is_empty() => Some(Destinazione::Fuori {
                url: url.to_owned(),
            }),
            _ => {
                avvisi.insert(AvvisoLibro::NotaNonEsportata { nota: k });
                None
            }
        };
    };
    let parte = inizio[capitolo];
    let sezione = rimando
        .sezione
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let Some(sezione) = sezione else {
        return Some(Destinazione::Dentro {
            pagina: parte,
            y: 0.0,
        });
    };
    let trovato = libro.capitoli[capitolo]
        .pagine
        .segnalibri
        .iter()
        .find(|s| titolo_uguale(&s.titolo, sezione));
    match trovato {
        Some(segnalibro) => Some(Destinazione::Dentro {
            pagina: parte + segnalibro.pagina,
            y: segnalibro.y,
        }),
        None => {
            avvisi.insert(AvvisoLibro::SezioneNonTrovata {
                nota: k,
                sezione: sezione.to_owned(),
            });
            Some(Destinazione::Dentro {
                pagina: parte,
                y: 0.0,
            })
        }
    }
}

// -- Il comando ---------------------------------------------------------------

const P_BOOK: &str = "book";
const P_TARGET: &str = "target";
const P_IMAGES: &str = "images";
const P_REPLACE: &str = "replace";

const T_TITLE: &str = "pdf.write_book.title";
const T_DESC: &str = "pdf.write_book.desc";
const T_BOOK: &str = "pdf.write_book.book.title";
const T_BOOK_DESC: &str = "pdf.write_book.book.desc";
const T_TARGET: &str = "pdf.write_book.target.title";
const T_TARGET_DESC: &str = "pdf.write_book.target.desc";
const T_IMAGES: &str = "pdf.write_book.images.title";
const T_IMAGES_DESC: &str = "pdf.write_book.images.desc";
const T_IMAGES_FULL: &str = "pdf.write_book.images.full";
const T_IMAGES_LIGHT: &str = "pdf.write_book.images.light";
const T_REPLACE: &str = "pdf.write_book.replace.title";
const T_REPLACE_DESC: &str = "pdf.write_book.replace.desc";

const E_UNREADABLE: &str = "e_pdf_book_unreadable";
const E_TOO_BIG: &str = "e_pdf_book_too_big";
const E_VERSION: &str = "e_pdf_book_version";
const E_CHAPTERS: &str = "e_pdf_book_chapters";
const E_SIZES: &str = "e_pdf_book_sizes";
const E_REPEATED: &str = "e_pdf_book_repeated";
const E_CHAPTER: &str = "e_pdf_book_chapter";
const E_PAGES_CHAPTER: &str = "e_pdf_book_pages_chapter";
const E_LINK: &str = "e_pdf_book_link";

/// Le stringhe in italiano, aggiunte al catalogo del bundle dei disegni.
fn in_italian(catalog: StringCatalog) -> StringCatalog {
    catalog
        .with(T_TITLE, "Scrivi il PDF di più note")
        .with(
            T_DESC,
            "Scrive nel vault un PDF solo con più note, una per capitolo: un indice \
             solo, e i collegamenti fra le note che portano dentro il PDF.",
        )
        .with(T_BOOK, "Libro")
        .with(
            T_BOOK_DESC,
            "I capitoli con le pagine che la vista ha impaginato, in JSON.",
        )
        .with(T_TARGET, "PDF")
        .with(
            T_TARGET_DESC,
            "Dove scrivere il PDF nel vault, con l'estensione `.pdf`.",
        )
        .with(T_IMAGES, "Immagini")
        .with(
            T_IMAGES_DESC,
            "Piene come sono, o alleggerite alla risoluzione che serve per stamparle.",
        )
        .with(T_IMAGES_FULL, "Piene")
        .with(T_IMAGES_LIGHT, "Alleggerite")
        .with(T_REPLACE, "Sostituisci")
        .with(T_REPLACE_DESC, "Se il PDF c'è già, lo sostituisce.")
        .with(
            E_UNREADABLE,
            "Le note da scrivere non si leggono. Riapri l'esportazione e riprova.",
        )
        .with(
            E_TOO_BIG,
            "Le note sono troppe per un PDF solo: le pagine superano {max} MiB. \
             Esportane meno alla volta.",
        )
        .with(
            E_VERSION,
            "Le note vengono da una versione di Fub diversa ({found}, serve la {expected}). \
             Riapri l'esportazione e riprova.",
        )
        .with(
            E_CHAPTERS,
            "Il PDF avrebbe {chapters} note: se ne scrivono da 1 a {max}. Esportane meno \
             alla volta.",
        )
        .with(
            E_SIZES,
            "Le note non hanno tutte la stessa misura di pagina. Riapri l'esportazione \
             e riprova.",
        )
        .with(
            E_REPEATED,
            "La nota «{doc}» c'è due volte: ogni nota entra nel PDF una volta sola.",
        )
        .with(
            E_CHAPTER,
            "La nota «{doc}» non si è impaginata bene e il PDF non si è scritto. Riapri \
             l'esportazione e riprova.",
        )
        .with(
            E_PAGES_CHAPTER,
            "Le pagine in testa al PDF non si sono impaginate bene e il PDF non si è \
             scritto. Riapri l'esportazione e riprova.",
        )
        .with(
            E_LINK,
            "Un collegamento della nota «{doc}» non porta a un punto valido e il PDF non \
             si è scritto. Riapri l'esportazione e riprova.",
        )
}

/// Le stesse stringhe in inglese.
fn in_english(catalog: StringCatalog) -> StringCatalog {
    catalog
        .with(T_TITLE, "Write the PDF of several notes")
        .with(
            T_DESC,
            "Writes into the vault one PDF with several notes, one per chapter: one \
             table of contents, and links between the notes that lead inside the PDF.",
        )
        .with(T_BOOK, "Book")
        .with(
            T_BOOK_DESC,
            "The chapters with the pages the view laid out, as JSON.",
        )
        .with(T_TARGET, "PDF")
        .with(
            T_TARGET_DESC,
            "Where to write the PDF in the vault, ending in `.pdf`.",
        )
        .with(T_IMAGES, "Images")
        .with(
            T_IMAGES_DESC,
            "Full as they are, or lightened to the resolution needed to print them.",
        )
        .with(T_IMAGES_FULL, "Full")
        .with(T_IMAGES_LIGHT, "Lightened")
        .with(T_REPLACE, "Replace")
        .with(T_REPLACE_DESC, "If the PDF already exists, replace it.")
        .with(
            E_UNREADABLE,
            "The notes to write cannot be read. Reopen the export and try again.",
        )
        .with(
            E_TOO_BIG,
            "Too many notes for one PDF: the pages exceed {max} MiB. Export fewer at a time.",
        )
        .with(
            E_VERSION,
            "The notes come from a different version of Fub ({found}, {expected} is \
             needed). Reopen the export and try again.",
        )
        .with(
            E_CHAPTERS,
            "The PDF would have {chapters} notes: from 1 to {max} can be written. Export \
             fewer at a time.",
        )
        .with(
            E_SIZES,
            "The notes do not all have the same page size. Reopen the export and try again.",
        )
        .with(
            E_REPEATED,
            "The note «{doc}» appears twice: each note goes into the PDF once.",
        )
        .with(
            E_CHAPTER,
            "The note «{doc}» was not laid out correctly and the PDF was not written. \
             Reopen the export and try again.",
        )
        .with(
            E_PAGES_CHAPTER,
            "The pages at the start of the PDF were not laid out correctly and the PDF \
             was not written. Reopen the export and try again.",
        )
        .with(
            E_LINK,
            "A link of the note «{doc}» does not lead to a valid place and the PDF was \
             not written. Reopen the export and try again.",
        )
}

/// Le stringhe del comando aggiunte ai cataloghi di un bundle, lingua per
/// lingua: l'inventario le monta nel bundle dei disegni, con quelle del PDF
/// di una nota.
pub fn con_le_stringhe(catalogs: Vec<StringCatalog>) -> Vec<StringCatalog> {
    catalogs
        .into_iter()
        .map(|catalog| match catalog.locale.as_str() {
            "it" => in_italian(catalog),
            "en" => in_english(catalog),
            _ => catalog,
        })
        .collect()
}

/// Un fornitore di comandi con in più `pdf.write_book`. Come
/// [`ConIlPdf`](super::lavoro::ConIlPdf), lo compone l'inventario.
pub struct ConIlLibro<P>(pub P);

impl<P: CommandProvider> CommandProvider for ConIlLibro<P> {
    fn commands(&self) -> Vec<CommandSpec> {
        let mut specs = self.0.commands();
        specs.push(spec());
        specs
    }

    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        if command == PDF_WRITE_BOOK {
            return invoke(args, mode, host);
        }
        self.0.invoke(command, args, mode, host)
    }
}

/// La spec del comando.
pub(crate) fn spec() -> CommandSpec {
    CommandSpec::new(PDF_WRITE_BOOK, Text::key(T_TITLE))
        .describing(Text::key(T_DESC))
        .with_param(
            ParamSpec::new(P_BOOK, Text::key(T_BOOK), ParamKind::Text)
                .describing(Text::key(T_BOOK_DESC))
                .required(),
        )
        .with_param(
            ParamSpec::new(P_TARGET, Text::key(T_TARGET), ParamKind::Text)
                .describing(Text::key(T_TARGET_DESC))
                .required(),
        )
        .with_param(
            ParamSpec::new(
                P_IMAGES,
                Text::key(T_IMAGES),
                ParamKind::Choice(vec![
                    Choice::new("full", Text::key(T_IMAGES_FULL)),
                    Choice::new("light", Text::key(T_IMAGES_LIGHT)),
                ]),
            )
            .describing(Text::key(T_IMAGES_DESC)),
        )
        .with_param(
            ParamSpec::new(P_REPLACE, Text::key(T_REPLACE), ParamKind::Bool)
                .describing(Text::key(T_REPLACE_DESC)),
        )
        .with_scope(CommandScope::writing(CommandReach::Document))
}

/// Esegue il comando: compone il libro e passa l'elenco al comando del PDF di
/// una nota, che controlla la destinazione e accoda il lavoro. Gli avvisi del
/// libro tornano nell'effetto, accanto all'id del lavoro (`warnings`).
pub(crate) fn invoke(
    args: serde_json::Value,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let letti = Args::new(&args);
    let libro = leggi(letti.text(P_BOOK).unwrap_or_default()).map_err(errore)?;
    let composto = componi(&libro).map_err(errore)?;
    // L'elenco composto è fatto di pezzi già letti: si riscrive sempre.
    let pages = serde_json::to_string(&composto.elenco)
        .map_err(|_| PluginError::BadArgs(Text::key(E_UNREADABLE)))?;
    let mut avanti = serde_json::json!({
        "pages": pages,
        "target": letti.text(P_TARGET).unwrap_or_default(),
        "replace": letti.flag(P_REPLACE, false),
    });
    if let Some(images) = letti.text(P_IMAGES) {
        avanti["images"] = serde_json::Value::String(images.to_owned());
    }
    let mut esito = super::lavoro::invoke(avanti, mode, host)?;
    if let CommandEffect::Custom { payload, .. } = &mut esito.effect {
        payload["warnings"] = serde_json::to_value(&composto.avvisi).unwrap_or_default();
    }
    Ok(esito)
}

/// L'errore del libro come lo vede chi ha chiesto il PDF.
fn errore(e: ErroreLibro) -> PluginError {
    let doc = |nota: &str| Arg::text("doc", nota);
    let testo = match e {
        ErroreLibro::Illeggibile { .. } => Text::key(E_UNREADABLE),
        ErroreLibro::TroppoGrande { .. } => Text::message(
            E_TOO_BIG,
            vec![Arg::int("max", (MAX_ELENCO_BYTE >> 20) as i64)],
        ),
        ErroreLibro::Versione { trovata } => Text::message(
            E_VERSION,
            vec![
                Arg::int("found", i64::from(trovata)),
                Arg::int("expected", i64::from(VERSIONE_LIBRO)),
            ],
        ),
        ErroreLibro::NumeroCapitoli { capitoli } => Text::message(
            E_CHAPTERS,
            vec![
                Arg::int("chapters", capitoli as i64),
                Arg::int("max", MAX_CAPITOLI as i64),
            ],
        ),
        ErroreLibro::MisureDiverse { .. } => Text::key(E_SIZES),
        ErroreLibro::NotaRipetuta { nota } => Text::message(E_REPEATED, vec![doc(&nota)]),
        ErroreLibro::Capitolo {
            nota: Some(nota), ..
        } => Text::message(E_CHAPTER, vec![doc(&nota)]),
        ErroreLibro::Capitolo { nota: None, .. } => Text::key(E_PAGES_CHAPTER),
        ErroreLibro::RimandoRotto {
            nota: Some(nota), ..
        } => Text::message(E_LINK, vec![doc(&nota)]),
        ErroreLibro::RimandoRotto { nota: None, .. } => Text::key(E_PAGES_CHAPTER),
    };
    PluginError::BadArgs(testo)
}
