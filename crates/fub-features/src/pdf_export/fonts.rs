//! I caratteri della stampa: quelli di Fub e quelli del vault.
//!
//! La vista disegna le pagine coi caratteri che offre nella sezione
//! «Caratteri» (`apps/client/src/export/sections/fonts.ts`), e il PDF li
//! incorpora: anteprima e file coincidono solo se ogni carattere che la vista
//! offre il core lo sa leggere.
//!
//! - **I caratteri di Fub** sono i file che l'app serve come `/fonts/<nome>`
//!   ([`file_dell_app`]): Inter, Literata e JetBrains Mono, che sono anche
//!   quelli dei disegni, e Newsreader, Hanken Grotesk e IBM Plex Mono, i
//!   caratteri della serie Scrittoio. Ognuno è una copia byte per byte del file
//!   dell'app, accanto al crate (`fonts/`, licenza SIL OFL 1.1): una prova lo
//!   controlla. Un carattere del sistema (Georgia, Palatino) la vista non lo
//!   offre: il core non lo saprebbe leggere, e il PDF uscirebbe con un altro.
//! - **I caratteri del vault** sono i file `.ttf`, `.otf`, `.woff` e `.woff2`
//!   del vault, come per i disegni ([`caratteri_del_vault`]). Il comando
//!   [`PDF_VAULT_FONTS`] li elenca per famiglia, con le facce, se hanno un
//!   corsivo vero e se la licenza lascia incorporarli (`fsType`, la stessa
//!   regola dei disegni e dello scrittore). Un carattere che non lo lascia la
//!   vista lo mostra con l'avviso e non lo usa: il testo resta nel carattere
//!   di Fub, come lo scriverebbe lo scrittore.
//!
//! Solo la prima faccia di un file conta (l'indice 0 di una collezione): è
//! quella che il browser carica e quella che lo scrittore incorpora.

use fub_abi::command::{CommandEffect, CommandOutcome, CommandScope, CommandSpec};
use fub_abi::error::PluginError;
use fub_abi::rules::media::mime_of;
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{EntryKind, IndexQuery, IndexResult, ReadApi, VaultEntry};
use serde::Serialize;

use crate::draw::per_il_pdf;

/// Elenca i caratteri del vault che la stampa può usare.
pub const PDF_VAULT_FONTS: &str = "pdf.vault_fonts";

/// L'effetto dell'esito del comando: il suo `payload` è un
/// [`CaratteriDelVault`].
pub const PDF_VAULT_FONTS_NS: &str = "fub.pdf.vault_fonts";

/// Quanti file di caratteri si leggono al più: oltre, il resto si conta in
/// [`CaratteriDelVault::tralasciati`].
pub const MAX_FILE_CARATTERI: usize = 200;

/// Quanti byte di caratteri si leggono al più in un elenco, tutti i file
/// insieme.
pub const MAX_BYTE_CARATTERI: usize = 256 * 1024 * 1024;

/// I tipi dei file che sono caratteri, come per i disegni.
const TIPI_CARATTERE: [&str; 4] = ["font/ttf", "font/otf", "font/woff", "font/woff2"];

/// I file dell'app che non sono già fra quelli dei disegni: le copie accanto
/// al crate, coi nomi che l'app serve (`apps/client/public/fonts`).
const FILE_SCRITTOIO: [(&str, &[u8]); 8] = [
    (
        "newsreader-latin-opsz-normal.woff2",
        include_bytes!("../../fonts/newsreader-latin-opsz-normal.woff2"),
    ),
    (
        "newsreader-latin-opsz-italic.woff2",
        include_bytes!("../../fonts/newsreader-latin-opsz-italic.woff2"),
    ),
    (
        "hanken-grotesk-latin-wght-normal.woff2",
        include_bytes!("../../fonts/hanken-grotesk-latin-wght-normal.woff2"),
    ),
    (
        "hanken-grotesk-latin-wght-italic.woff2",
        include_bytes!("../../fonts/hanken-grotesk-latin-wght-italic.woff2"),
    ),
    (
        "ibm-plex-mono-latin-400-normal.woff2",
        include_bytes!("../../fonts/ibm-plex-mono-latin-400-normal.woff2"),
    ),
    (
        "ibm-plex-mono-latin-400-italic.woff2",
        include_bytes!("../../fonts/ibm-plex-mono-latin-400-italic.woff2"),
    ),
    (
        "ibm-plex-mono-latin-500-normal.woff2",
        include_bytes!("../../fonts/ibm-plex-mono-latin-500-normal.woff2"),
    ),
    (
        "ibm-plex-mono-latin-600-normal.woff2",
        include_bytes!("../../fonts/ibm-plex-mono-latin-600-normal.woff2"),
    ),
];

/// I byte del file di un carattere di Fub che l'app serve come
/// `/fonts/<nome>`; `None` per un nome che non è fra quelli della stampa.
pub(crate) fn file_dell_app(nome: &str) -> Option<&'static [u8]> {
    per_il_pdf::file_di_fub(nome).or_else(|| {
        FILE_SCRITTOIO
            .iter()
            .find(|(n, _)| *n == nome)
            .map(|(_, byte)| *byte)
    })
}

/// I nomi dei file di Fub che la stampa può incorporare, per le prove.
#[cfg(test)]
pub(crate) fn nomi_dell_app() -> impl Iterator<Item = &'static str> {
    FILE_SCRITTOIO.iter().map(|(n, _)| *n)
}

/// Una faccia di un carattere del vault: un file, con lo stile e i pesi che
/// dà.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct FacciaDelVault {
    /// Il percorso del file nel vault.
    pub file: String,
    /// Vero per un file che dà soltanto il corsivo (o l'obliquo).
    pub corsivo: bool,
    /// I pesi che dà, da… a: uno solo per un file statico.
    pub pesi: [f64; 2],
    /// Se la licenza del file lascia incorporarlo nel PDF.
    pub incorporabile: bool,
}

/// Una famiglia di caratteri del vault, come la sezione «Caratteri» la offre.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct CarattereDelVault {
    /// Il nome della famiglia, quello del menu del file.
    pub famiglia: String,
    /// Il file che il profilo nomina (`carattere_testo`, `carattere_titoli`):
    /// la faccia tonda più vicina al peso 400.
    pub file: String,
    /// Le facce, in ordine di percorso.
    pub facce: Vec<FacciaDelVault>,
    /// Se ha un corsivo vero: senza, il corsivo esce tondo, nella vista come
    /// nel PDF.
    pub corsivo: bool,
    /// Se la licenza di ogni faccia lascia incorporarla nel PDF. Una famiglia
    /// che non lo lascia la vista non la usa.
    pub incorporabile: bool,
}

/// I caratteri del vault per la stampa.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct CaratteriDelVault {
    /// Le famiglie, in ordine di nome.
    pub caratteri: Vec<CarattereDelVault>,
    /// I file con l'estensione di un carattere che non si leggono come tali
    /// (rotti, troppo grandi), per percorso.
    pub illeggibili: Vec<String>,
    /// I file di caratteri che non si sono letti perché oltre i tetti
    /// ([`MAX_FILE_CARATTERI`], [`MAX_BYTE_CARATTERI`]).
    pub tralasciati: usize,
}

impl CaratteriDelVault {
    /// Le famiglie che la licenza non lascia incorporare.
    pub fn chiusi(&self) -> usize {
        self.caratteri.iter().filter(|c| !c.incorporabile).count()
    }
}

/// I file di caratteri del vault, letti e raccolti per famiglia.
pub fn caratteri_del_vault(host: &dyn ReadApi) -> CaratteriDelVault {
    let entries = match host.query_index(IndexQuery::Entries {
        of_kind: Some(EntryKind::Asset),
        within: None,
        page: None,
    }) {
        Ok(IndexResult::Entries(entries)) => entries.items,
        _ => Vec::new(),
    };
    let mut file: Vec<VaultEntry> = entries
        .into_iter()
        .filter(|entry| mime_of(&entry.id).is_some_and(|mime| TIPI_CARATTERE.contains(&mime)))
        .collect();
    file.sort_by(|a, b| a.id.as_str().cmp(b.id.as_str()));

    let mut esito = CaratteriDelVault::default();
    let mut letti = 0usize;
    let mut byte = 0usize;
    let mut facce: Vec<(String, FacciaDelVault)> = Vec::new();
    for entry in file {
        let percorso = entry.id.as_str().to_owned();
        if entry.size > per_il_pdf::MAX_FONT_BYTES as u64 {
            esito.illeggibili.push(percorso);
            continue;
        }
        let peso = entry.size as usize;
        if letti >= MAX_FILE_CARATTERI || byte + peso > MAX_BYTE_CARATTERI {
            esito.tralasciati += 1;
            continue;
        }
        letti += 1;
        byte += peso;
        match faccia_di(host, &entry) {
            Some(faccia) => facce.push(faccia),
            None => esito.illeggibili.push(percorso),
        }
    }
    esito.caratteri = per_famiglia(facce);
    esito
}

/// La prima faccia di un file del vault, con la sua famiglia; `None` per un
/// file che non si legge come carattere.
fn faccia_di(host: &dyn ReadApi, entry: &VaultEntry) -> Option<(String, FacciaDelVault)> {
    let byte = host.read_document_bytes(&entry.id).ok()?;
    if byte.len() > per_il_pdf::MAX_FONT_BYTES {
        return None;
    }
    let sfnt = per_il_pdf::decode(&byte).ok()?;
    let faccia = per_il_pdf::describe(&sfnt)
        .ok()?
        .into_iter()
        .find(|faccia| faccia.index == 0)?;
    let tondo = faccia
        .styles
        .iter()
        .any(|slot| slot.style == per_il_pdf::Style::Normal);
    Some((
        faccia.family.clone(),
        FacciaDelVault {
            file: entry.id.as_str().to_owned(),
            corsivo: !tondo,
            pesi: faccia.weight,
            incorporabile: per_il_pdf::embeddable(&sfnt, 0),
        },
    ))
}

/// Le facce raccolte per famiglia (lo stesso nome, senza badare alle
/// maiuscole), in ordine di nome.
fn per_famiglia(facce: Vec<(String, FacciaDelVault)>) -> Vec<CarattereDelVault> {
    let mut famiglie: Vec<(String, Vec<FacciaDelVault>)> = Vec::new();
    for (famiglia, faccia) in facce {
        match famiglie
            .iter_mut()
            .find(|(nome, _)| nome.to_lowercase() == famiglia.to_lowercase())
        {
            Some((_, facce)) => facce.push(faccia),
            None => famiglie.push((famiglia, vec![faccia])),
        }
    }
    let mut caratteri: Vec<CarattereDelVault> = famiglie
        .into_iter()
        .map(|(famiglia, facce)| {
            // Il file che il profilo nomina: un tondo, il più vicino al 400;
            // una famiglia di soli corsivi nomina il suo primo.
            let distanza = |f: &FacciaDelVault| {
                if f.pesi[0] <= 400.0 && 400.0 <= f.pesi[1] {
                    0.0
                } else {
                    (f.pesi[0] - 400.0).abs().min((f.pesi[1] - 400.0).abs())
                }
            };
            let file = facce
                .iter()
                .filter(|f| !f.corsivo)
                .min_by(|a, b| distanza(a).total_cmp(&distanza(b)))
                .or_else(|| facce.first())
                .map(|f| f.file.clone())
                .unwrap_or_default();
            CarattereDelVault {
                corsivo: facce.iter().any(|f| f.corsivo),
                incorporabile: facce.iter().all(|f| f.incorporabile),
                famiglia,
                file,
                facce,
            }
        })
        .collect();
    caratteri.sort_by(|a, b| {
        a.famiglia
            .to_lowercase()
            .cmp(&b.famiglia.to_lowercase())
            .then_with(|| a.famiglia.cmp(&b.famiglia))
    });
    caratteri
}

// ── Il comando ──────────────────────────────────────────────────────────────

const T_TITLE: &str = "pdf.vault_fonts.title";
const T_DESC: &str = "pdf.vault_fonts.desc";
const D_FOUND: &str = "done_pdf_vault_fonts";
const D_NONE: &str = "done_pdf_vault_fonts_none";

/// La spec del comando: legge e basta.
pub(crate) fn spec() -> CommandSpec {
    CommandSpec::new(PDF_VAULT_FONTS, Text::key(T_TITLE))
        .describing(Text::key(T_DESC))
        .with_scope(CommandScope::read_only())
}

/// Esegue il comando: elenca i caratteri del vault. L'elenco sta
/// nell'effetto ([`PDF_VAULT_FONTS_NS`]); la frase dice quanti sono, per chi
/// lo lancia dallo spazio dei comandi.
pub(crate) fn invoke(host: &dyn ReadApi) -> Result<CommandOutcome, PluginError> {
    let elenco = caratteri_del_vault(host);
    let frase = if elenco.caratteri.is_empty() {
        Text::key(D_NONE)
    } else {
        Text::message(
            D_FOUND,
            vec![
                Arg::int("count", elenco.caratteri.len() as i64),
                Arg::int("closed", elenco.chiusi() as i64),
            ],
        )
    };
    let payload =
        serde_json::to_value(&elenco).map_err(|_| PluginError::Internal(Text::key(T_TITLE)))?;
    Ok(
        CommandOutcome::notify(frase).with_effect(CommandEffect::Custom {
            ns: PDF_VAULT_FONTS_NS.into(),
            payload,
        }),
    )
}

/// Le stringhe del comando in italiano.
pub(crate) fn in_italian(catalog: StringCatalog) -> StringCatalog {
    catalog
        .with(T_TITLE, "Elenca i caratteri del vault per il PDF")
        .with(
            T_DESC,
            "I file di caratteri del vault che l'esportazione in PDF può usare, con \
             quelli che la licenza non lascia incorporare.",
        )
        .with(
            D_FOUND,
            "Caratteri del vault per il PDF: {count}; quelli che non si lasciano \
             incorporare: {closed}.",
        )
        .with(
            D_NONE,
            "Nel vault non ci sono caratteri: metti un file .ttf, .otf, .woff o .woff2 \
             nel vault per usarlo nel PDF.",
        )
}

/// Le stesse stringhe in inglese.
pub(crate) fn in_english(catalog: StringCatalog) -> StringCatalog {
    catalog
        .with(T_TITLE, "List the vault's fonts for PDF")
        .with(
            T_DESC,
            "The font files in the vault that PDF export can use, including those whose \
             license does not allow embedding.",
        )
        .with(
            D_FOUND,
            "Vault fonts for PDF: {count}; those that do not allow embedding: {closed}.",
        )
        .with(
            D_NONE,
            "The vault has no fonts: put a .ttf, .otf, .woff or .woff2 file in the vault \
             to use it in a PDF.",
        )
}

#[cfg(test)]
#[path = "fonts_tests.rs"]
mod tests;
