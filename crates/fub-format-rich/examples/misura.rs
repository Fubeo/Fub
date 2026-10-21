//! Il resoconto di misura del controllo dei byte su uno o più `.docx`: ciò che
//! una prova a vuoto del codec perderebbe o aggiungerebbe, chiave per chiave.
//! Serve a progettare la garanzia e a scegliere le normalizzazioni sui file
//! del corpus; non decide niente.
//!
//! ```text
//! cargo run -p fub-format-rich --example misura -- file.docx [altro.docx …]
//! ```

fn main() -> std::process::ExitCode {
    let paths: Vec<String> = std::env::args().skip(1).collect();
    if paths.is_empty() {
        eprintln!("uso: misura file.docx [altro.docx …]");
        return std::process::ExitCode::from(2);
    }
    let mut failed = false;
    for path in paths {
        println!("{path}");
        match std::fs::read(&path)
            .map_err(|error| error.to_string())
            .and_then(|bytes| {
                fub_format_rich::preservation::report(&bytes).map_err(|error| error.to_string())
            }) {
            Ok(report) => print!("{report}"),
            Err(error) => {
                failed = true;
                println!("  illeggibile: {error}");
            }
        }
    }
    println!();
    println!("normalizzazioni dichiarate:");
    for (what, why) in fub_format_rich::preservation::normalizations() {
        println!("  «{what}»: {why}");
    }
    match failed {
        true => std::process::ExitCode::FAILURE,
        false => std::process::ExitCode::SUCCESS,
    }
}
