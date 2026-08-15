//! **La X deve chiudere** — e chi si mette in mezzo deve pagarne il permesso.
//!
//! Iscriversi a `tauri://close-requested` dalla shell non è un ascolto passivo:
//! dal momento in cui quell'ascoltatore esiste, il backend di Tauri annulla la
//! chiusura nativa (`api.prevent_close()`, `tauri::manager::window`) e l'unica
//! cosa che chiude ancora la finestra è la `destroy()` che `onCloseRequested`
//! fa in coda al gestore. Quella `destroy()` è un comando IPC come gli altri e
//! vuole il suo permesso, `core:window:allow-destroy`, che **non** è dentro
//! `core:default`.
//!
//! Il guasto che ne nasce non somiglia a un permesso mancante: il rifiuto
//! avviene dentro il gestore di Tauri, dove nessuno lo legge, e ciò che l'utente
//! vede è una X che non fa niente. Il presidio è qui perché le due metà stanno
//! in due file lontani — la shell decide di ascoltare, `fub-app` decide cosa la
//! shell può fare — e nessuno dei due, letto da solo, mostra il legame.
//!
//! `include_str!` e non `std::fs`, come in `dieta_ipc.rs`: se uno dei due file
//! si sposta, questo test **non compila**.

const CAPACITÀ: &str = include_str!("../capabilities/default.json");
const IPC: &str = include_str!("../../../frontend/src/host/ipc.ts");

/// Il permesso senza cui la `destroy()` di `onCloseRequested` viene rifiutata.
const DISTRUGGI: &str = "core:window:allow-destroy";

#[test]
fn chi_ascolta_la_chiusura_ha_il_permesso_di_distruggere() {
    // La riga di codice, non il commento che la spiega: `onCloseRequested` è
    // nominato più volte nella documentazione di `allaChiusura`, e un test che
    // contasse quelle occorrenze resterebbe verde cancellando la chiamata.
    let ascolta = IPC.contains(".onCloseRequested(");
    let può_distruggere = CAPACITÀ.contains(DISTRUGGI);

    assert!(
        !ascolta || può_distruggere,
        "la shell si iscrive a `onCloseRequested` in `frontend/src/host/ipc.ts`, \
         quindi il backend annulla la chiusura nativa e la finestra muore solo \
         con `destroy()`: aggiungi `{DISTRUGGI}` ai permessi di \
         `crates/fub-app/capabilities/default.json`, o la X smette di chiudere \
         l'app senza dirlo a nessuno."
    );

    // L'altro verso: il permesso è concesso perché serve a questa riga. Se la
    // shell smette di ascoltare la chiusura, la chiusura torna nativa e questo
    // permesso è superficie IPC regalata senza motivo (§1.3).
    assert!(
        !può_distruggere || ascolta,
        "`{DISTRUGGI}` è nei permessi di `fub-app` ma nessuno chiama più \
         `onCloseRequested` nella shell: la chiusura è tornata nativa e il \
         permesso va tolto."
    );
}
