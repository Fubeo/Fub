//! L'ospite: carica a runtime i componenti che trova in una cartella, li fa
//! lavorare e dice su una riga JSON che cosa ha visto.
//!
//!   ospite CARTELLA     carica ogni libreria della cartella
//!   ospite --statico    (con la feature `statico`) i due componenti incorporati

use std::ffi::CStr;
use std::path::Path;

use comune::{ABI, Descrizione, serde_json};

/// Un componente caricato: la libreria resta aperta finché serve la
/// descrizione.
struct Caricato {
    _libreria: libloading::Library,
    descrizione: Descrizione,
}

fn carica(percorso: &Path) -> Result<Caricato, String> {
    // SAFETY: la libreria è un componente compilato da questa stessa release,
    // con lo stesso compilatore; il simbolo ha la firma di `comune`.
    unsafe {
        let libreria =
            libloading::Library::new(percorso).map_err(|e| format!("caricamento: {e}"))?;
        let ingresso: libloading::Symbol<extern "C" fn() -> Descrizione> = libreria
            .get(comune::SIMBOLO)
            .map_err(|e| format!("simbolo: {e}"))?;
        let descrizione = ingresso();
        if descrizione.abi != ABI {
            return Err(format!("abi {} invece di {ABI}", descrizione.abi));
        }
        Ok(Caricato {
            _libreria: libreria,
            descrizione,
        })
    }
}

fn di_componente(percorso: &Path) -> bool {
    let nome = percorso.file_name().and_then(|n| n.to_str()).unwrap_or("");
    nome.contains("componente_")
        && matches!(
            percorso.extension().and_then(|e| e.to_str()),
            Some("so" | "dylib" | "dll")
        )
}

fn main() {
    let argomento = std::env::args().nth(1).unwrap_or_default();
    let mut visti = Vec::new();
    let mut errori = Vec::new();
    if argomento == "--statico" {
        #[cfg(feature = "statico")]
        {
            visti.push(serde_json::json!({ "nome": "componente-a", "risultato": componente_a::lavora(1000) }));
            visti.push(serde_json::json!({ "nome": "componente-b", "risultato": componente_b::lavora(1000) }));
        }
    } else {
        let mut file: Vec<_> = std::fs::read_dir(&argomento)
            .unwrap_or_else(|e| panic!("la cartella {argomento}: {e}"))
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| di_componente(p))
            .collect();
        file.sort();
        for percorso in file {
            match carica(&percorso) {
                Ok(caricato) => {
                    // SAFETY: il nome è una stringa statica del componente,
                    // terminata da zero; la libreria è ancora aperta.
                    let nome = unsafe { CStr::from_ptr(caricato.descrizione.nome) }
                        .to_string_lossy()
                        .into_owned();
                    let risultato = (caricato.descrizione.lavora)(1000);
                    visti.push(serde_json::json!({ "nome": nome, "risultato": risultato }));
                }
                Err(e) => errori.push(
                    serde_json::json!({ "file": percorso.display().to_string(), "errore": e }),
                ),
            }
        }
    }
    // Se i componenti hanno contato nella stessa libreria comune dell'ospite,
    // `chiamate` è uguale al numero di componenti.
    let riga = serde_json::json!({
        "componenti": visti,
        "errori": errori,
        "chiamate_viste_dall_ospite": comune::chiamate(),
    });
    println!("{riga}");
}
