//! Le fixture della scena per la superficie TypeScript: SVG generati
//! qui, ognuno con ciò che Rust ne legge, perché i due lettori classifichino
//! allo stesso modo.
//!
//! Rigenera con `UPDATE_MIRROR=1 cargo test -p fub-scene --test mirror`.
//! Senza la variabile il test confronta i file byte per byte e fallisce alla
//! prima differenza.
//!
//! In `apps/client/src/__fixtures__/scene/`:
//!
//! - `sparse`: un disegno FubDraw in forma canonica (§7), con ogni ruolo di
//!   §4 e ogni forma sintetica di §6, tratti che si ridisegnano e tratti che
//!   no, un blocco estraneo dentro un gruppo, un livello bloccato e nascosto,
//!   e dentro un livello un gruppo bloccato con una forma nascosta, un
//!   collegamento e una forma col loro `title`. Una lunghezza in pollici
//!   resta com'è, come FubDraw copia i valori che non tocca;
//! - `foreign`: un SVG di un altro programma, senza `fub:version`, con un
//!   esempio di ogni motivo per cui un elemento è estraneo, contenuto attivo,
//!   prologo ed epilogo;
//! - `crlf-bom`: un disegno FubDraw con BOM e righe CRLF, testo fuori dal piano
//!   base di Unicode e un commento su più righe: gli span UTF-16 si allontanano
//!   dai byte;
//! - `doctype`: un disegno con `DOCTYPE` ed entità interne, in sola lettura;
//! - `resources`: un disegno con la sua `defs` (formato della scena, risorse),
//!   ogni tipo di risorsa, private e condivise, e gli oggetti che le usano coi
//!   riempimenti, i marcatori, i ritagli, le maschere e i filtri; una risorsa
//!   estranea, un riferimento del tipo sbagliato e uno a un id che manca;
//! - `swatches`: un disegno coi campioni del documento (formato della scena,
//!   risorse): come li scrive FubDraw e come li scrive Inkscape, uno che
//!   nessuno usa, uno nel contenuto di un motivo, e una sfumatura per ogni
//!   modo di dirsi campione senza esserlo;
//! - `text`: un disegno col testo in area e su tracciato (formato della scena,
//!   testo): due paragrafi in una cornice, con le righe che vanno a capo fra
//!   le parole e dentro una parola, una larghezza che non si legge, due testi
//!   su tracciato con `href` e `xlink:href`, e due estranei, un testo su
//!   tracciato con `x` e uno che segue un tracciato con una trasformazione;
//! - `boards`: un disegno con le tavole (formato della scena, tavole): coi
//!   nomi, senza nome e con un nome già usato, le carte di ogni tavola, e una
//!   carta per ogni modo di non andare con la sua tavola; un esempio di ogni
//!   motivo per cui un `view` è estraneo;
//! - `legend`: un disegno dove il colore fa da codice (S017): su una carta
//!   colorata, riquadri dello stesso colore che si distinguono soltanto per la
//!   tinta, scritti in chiaro, con un campione e con un'opacità di gruppo, e
//!   riquadri dello stesso colore che non contano, perché il loro colore non
//!   si sa, non hanno area o sono tratti a penna;
//! - `connectors`: un disegno coi connettori (formato della scena,
//!   connettori): tre rettangoli uniti da un gomito agganciato ai due capi,
//!   da una curva e da una linea dritta con un capo libero, una punta
//!   come marcatore, l'etichetta di un connettore, e tre scritture fuori
//!   grammatica: un `fub:geom`, un capo e un'etichetta; un'ellisse con la
//!   sua etichetta in un gruppo (formato della scena, etichette) e una
//!   `fub:inside` fuori grammatica;
//! - `styles`: un disegno con gli stili del documento (formato della scena,
//!   stili): due di testo, uno col colore di un campione, e due grafici, uno
//!   con una sfumatura privata, un marcatore e la fusione, l'altro che nessuno
//!   segue; un esempio di ogni modo di dirsi stile senza esserlo; i testi, le
//!   forme e un gruppo che li seguono, uno per ogni modo di seguire uno stile
//!   che non c'è (S018), e un collegamento e un livello, che non ne seguono;
//! - `symbols`: un disegno coi simboli (formato della scena, simboli): uno
//!   con una sfumatura privata scritta dopo di lui e un testo bianco e
//!   minuscolo, uno copiato da una libreria con un'istanza del primo e una
//!   parte estranea, uno che usa un simbolo estraneo; un simbolo che contiene
//!   sé stesso, due che si contengono a vicenda e due con un attributo che
//!   non va; le istanze con `href` e con
//!   `xlink:href`, ruotata e con un titolo, una nascosta, un testo bianco
//!   sopra un'istanza, e un esempio di ogni modo di non essere un'istanza;
//! - `repeats`: un disegno con le ripetizioni (formato della scena,
//!   ripetizioni): un fiore radiale che ha per originale l'istanza di un
//!   simbolo, a sua volta con una ripetizione dentro; una griglia spostata,
//!   con una copia scritta con `xlink:href` e un titolo; uno specchio che ha
//!   per originale un gruppo con dentro un'altra ripetizione, e un testo
//!   bianco sopra la copia riflessa; un esempio di ogni modo di non essere
//!   una ripetizione o una copia;
//!
//! Ogni `<nome>.svg` ha accanto `<nome>.json`: la [`Scene`] serializzata, con
//! due spazi di rientro e un a capo finale.
//!
//! Le fixture grandi, `dense` e `ink`, non si committano: si generano qui da un
//! seme fisso con mulberry32, lo stesso generatore di
//! `apps/client/bench/graph-fixture.ts`, e `generated.json` ne fissa la
//! lunghezza, l'impronta FNV-1a a 32 bit, il riepilogo e la diagnostica. Chi
//! le rigenera in TypeScript con l'algoritmo descritto su [`dense`] e [`ink`]
//! deve ottenere la stessa impronta. Sono solo ASCII: l'impronta sui byte e
//! quella sulle unità UTF-16 coincidono.

mod common;

use std::collections::BTreeMap;
use std::path::PathBuf;

use common::check_lossless;
use fub_scene::connectors::{Anchor, ConnectorEnd, ConnectorKind};
use fub_scene::ink::INK_MAX_SAMPLES;
use fub_scene::repeat::Repeat;
use fub_scene::{
    read, Ink, Item, Lifecycle, Motif, Role, Sample, Scale, Scene, StyleFacts, StyleKind, Swatch,
    FUB_NS, MAX_ELEMENTS, STYLE_GRAPHIC_POINTS, SVG_NS,
};
use serde_json::json;

#[path = "mirror/connectors.rs"]
mod connectors;
#[path = "mirror/drawings.rs"]
mod drawings;
#[path = "mirror/generated.rs"]
mod generated;
#[path = "mirror/reading.rs"]
mod reading;
#[path = "mirror/resources.rs"]
mod resources;
#[path = "mirror/styles.rs"]
mod styles;
#[path = "mirror/symbols.rs"]
mod symbols;
#[path = "mirror/text.rs"]
mod text;
#[path = "mirror/write.rs"]
mod write;

use connectors::connectors;
use drawings::{crlf_bom, doctype, foreign, sparse};
use resources::{resources, swatch, swatches};
use styles::{line, styles};
use symbols::{repeats, symbols};
use text::{boards, legend, text};
use write::{decimal, document, drawn, layer, paper, stroke, svg, El, BRUSH};
// ---------------------------------------------------------------------------
// Il confronto con i file.
// ---------------------------------------------------------------------------

/// La cartella delle fixture, dalla radice del crate.
fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps/client/src/__fixtures__/scene")
}

const REGENERATE: &str = "rigenera con UPDATE_MIRROR=1 cargo test -p fub-scene --test mirror";

fn updating() -> bool {
    std::env::var_os("UPDATE_MIRROR").is_some()
}

/// Scrive `actual` in `name` con `UPDATE_MIRROR`; altrimenti pretende che il
/// file abbia esattamente quei byte.
fn mirror(name: &str, actual: &str) {
    let path = fixtures().join(name);
    if updating() {
        std::fs::create_dir_all(fixtures()).unwrap();
        std::fs::write(&path, actual).unwrap();
    }
    let expected = std::fs::read(&path)
        .unwrap_or_else(|error| panic!("{name} non si legge ({error}): {REGENERATE}"));
    let actual = actual.as_bytes();
    if expected != actual {
        let at = expected
            .iter()
            .zip(actual)
            .position(|(a, b)| a != b)
            .unwrap_or(expected.len().min(actual.len()));
        let context = |bytes: &[u8]| {
            let end = (at + 60).min(bytes.len());
            String::from_utf8_lossy(&bytes[at.saturating_sub(20).min(end)..end]).into_owned()
        };
        panic!(
            "{name} differisce dal byte {at} ({} byte attesi, {} generati)\n\
             atteso:   {:?}\n\
             generato: {:?}\n\
             {REGENERATE}",
            expected.len(),
            actual.len(),
            context(&expected),
            context(actual),
        );
    }
}

/// La scena come la fixture la conserva.
fn expected_json(scene: &Scene) -> String {
    format!("{}\n", serde_json::to_string_pretty(scene).unwrap())
}

/// Legge `source`, ne verifica la copertura e scrive la coppia di fixture.
fn fixture(name: &str, source: &str) -> Scene {
    let scene = read(source).unwrap_or_else(|e| panic!("{name}: {e}"));
    check_lossless(source, &scene);
    mirror(&format!("{name}.svg"), source);
    mirror(&format!("{name}.json"), &expected_json(&scene));
    scene
}
