fn main() {
    // Il vblank emulato di WebKitGTK (ADR 0246, `src/vblank.rs`): il solo
    // `drmWaitVBlank` dell'eseguibile va nella tabella dei simboli dinamici,
    // perché il linker dinamico lo preferisca a quello di libdrm. GNU ld lo
    // esporta già, perché `libwebkit2gtk-4.1` è collegata e lo usa; questa
    // riga lo chiede in modo esplicito, per i linker e i collegamenti dove
    // non succede. Nient'altro è esportato, e solo sull'eseguibile `fub` per
    // Linux.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux") {
        println!("cargo:rustc-link-arg-bin=fub=-Wl,--export-dynamic-symbol=drmWaitVBlank");
    }
    tauri_build::build();
}
