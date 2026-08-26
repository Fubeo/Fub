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
//! `include_str!` e non `std::fs`, come in `lean_ipc.rs`: se uno dei due file
//! si sposta, questo test **non compila**.

const CAPABILITIES: &str = include_str!("../capabilities/default.json");
const IPC: &str = include_str!("../../../apps/client/src/host/ipc.ts");

/// Il permesso senza cui la `destroy()` di `onCloseRequested` viene rifiutata.
const DESTROY: &str = "core:window:allow-destroy";

#[test]
fn listener_of_close_has_destroy_permission() {
    // La riga di codice, non il commento che la spiega: `onCloseRequested` è
    // nominato più volte nella documentazione di `allaChiusura`, e un test che
    // contasse quelle occorrenze resterebbe verde cancellando la chiamata.
    let listens = IPC.contains(".onCloseRequested(");
    let can_destroy = CAPABILITIES.contains(DESTROY);

    assert!(
        !listens || can_destroy,
        "the shell subscribes to `onCloseRequested` in `apps/client/src/host/ipc.ts`, \
         so the backend cancels the native close and the window dies only with \
         `destroy()`: add `{DESTROY}` to the permissions of \
         `crates/fub-app/capabilities/default.json`, or the X stops closing the \
         app without telling anyone."
    );

    // L'altro verso: il permesso è concesso perché serve a questa riga. Se la
    // shell smette di ascoltare la chiusura, la chiusura torna nativa e questo
    // permesso è superficie IPC regalata senza motivo (§1.3).
    assert!(
        !can_destroy || listens,
        "`{DESTROY}` is in `fub-app`'s permissions but nobody calls \
         `onCloseRequested` in the shell anymore: the close has returned to \
         native and the permission must be removed."
    );
}
