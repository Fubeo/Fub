//! Il vblank emulato di WebKitGTK (ADR 0246) funziona solo se l'eseguibile
//! `fub` mette il suo `drmWaitVBlank` nella tabella dei simboli dinamici:
//! senza, il linker dinamico dà a WebKit quello di libdrm e l'emulazione
//! resta muta (il log d'avvio direbbe `NonInterposta`). GNU ld lo esporta
//! perché `libwebkit2gtk-4.1` lo usa, e il build script lo chiede anche in
//! modo esplicito; questa prova guarda il risultato sull'eseguibile vero con
//! `nm` (binutils, presente dove c'è il linker che l'ha collegato), qualunque
//! sia la via.
#![cfg(target_os = "linux")]

use std::process::Command;

#[test]
fn l_eseguibile_esporta_solo_drm_wait_vblank() {
    let exe = env!("CARGO_BIN_EXE_fub");
    let uscita = Command::new("nm")
        .args(["-D", "--defined-only", exe])
        .output()
        .expect("nm (binutils) serve a leggere i simboli dinamici dell'eseguibile");
    assert!(
        uscita.status.success(),
        "nm: {}",
        String::from_utf8_lossy(&uscita.stderr)
    );
    let testo = String::from_utf8_lossy(&uscita.stdout);
    let funzioni: Vec<&str> = testo
        .lines()
        .filter_map(|riga| {
            let mut parti = riga.split_whitespace().rev();
            let nome = parti.next()?;
            let tipo = parti.next()?;
            (tipo == "T").then_some(nome)
        })
        .collect();
    assert_eq!(
        funzioni,
        ["drmWaitVBlank"],
        "l'eseguibile deve esportare drmWaitVBlank e nessun'altra funzione"
    );
}
