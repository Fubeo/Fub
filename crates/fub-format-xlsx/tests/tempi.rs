//! I tempi della lettura e della proiezione delle cartelle di una cartella del
//! disco: `FUB_XLSX_TEMPI=<cartella> cargo test --release -p fub-format-xlsx
//! --test tempi -- --ignored --nocapture`.

use std::time::Instant;

#[test]
#[ignore = "misura i tempi dei file di FUB_XLSX_TEMPI"]
fn tempi() {
    let Ok(dir) = std::env::var("FUB_XLSX_TEMPI") else {
        return;
    };
    let mut paths: Vec<_> = std::fs::read_dir(dir)
        .expect("cartella")
        .map(|entry| entry.expect("voce").path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "xlsx"))
        .collect();
    paths.sort();
    for path in paths {
        let bytes = std::fs::read(&path).expect("file");
        let start = Instant::now();
        let read = fub_format_xlsx::read(&bytes).map(|_| ());
        let read_time = start.elapsed();
        let start = Instant::now();
        let open = fub_format_xlsx::open(&bytes).map(|json| json.len());
        let open_time = start.elapsed();
        println!(
            "{:<24} {:>9} B  lettura {:>10.2?} {:?}  proiezione {:>10.2?} {:?}",
            path.file_name().unwrap().to_string_lossy(),
            bytes.len(),
            read_time,
            read.err(),
            open_time,
            open,
        );
    }
}
