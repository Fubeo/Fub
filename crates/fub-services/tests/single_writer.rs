//! Due processi non condividono una data dir (STR-02): il secondo avvio sulla
//! stessa cartella esce con un errore esplicito anche con un bind diverso,
//! prima di leggere un solo registro.

use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};

#[test]
fn a_second_process_on_the_same_data_dir_exits_even_on_another_port() {
    let dir = std::env::temp_dir().join(format!("fub-services-writer-{}", uuid::Uuid::new_v4()));
    let bin = env!("CARGO_BIN_EXE_fub-services");
    let mut first = Command::new(bin)
        .args(["--data-dir", dir.to_str().unwrap(), "--bind", "127.0.0.1:0"])
        .stderr(Stdio::piped())
        .spawn()
        .expect("first process");
    let mut banner = String::new();
    BufReader::new(first.stderr.take().unwrap())
        .read_line(&mut banner)
        .unwrap();
    assert!(
        banner.contains("fub-services/"),
        "first did not start: {banner}"
    );

    let second = Command::new(bin)
        .args(["--data-dir", dir.to_str().unwrap(), "--bind", "127.0.0.1:0"])
        .output()
        .expect("second process");
    let _ = first.kill();
    let _ = first.wait();
    let stderr = String::from_utf8_lossy(&second.stderr);
    assert_eq!(second.status.code(), Some(1), "{stderr}");
    assert!(
        stderr.contains("in use by another fub-services process"),
        "{stderr}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}
