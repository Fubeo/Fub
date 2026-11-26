//! Il ponte che inoltra gli eventi del kernel al webview su `fub://event`.

use super::*;

/// Il ponte eventi verso il webview: l'unica implementazione di [`EventSink`]
/// che ha bisogno di Tauri, ed è per questo che sta qui e non nell'host.
///
/// L'handle arriva in ritardo, e la `OnceLock` è quel ritardo reso esplicito.
/// L'ordine di Tauri è: costruzione → finestre della configurazione → `setup`,
/// e l'`AppHandle` esiste solo dall'ultimo passo. Ma lo stato gestito va
/// dichiarato al **primo**, o una `invoke` che arrivasse da una finestra già
/// aperta troverebbe `State<Host>` non gestito — che in Tauri è un panico, non
/// un errore. Quindi l'host si registra subito con questo sink vuoto, e il
/// `setup` ci mette dentro l'handle.
///
/// **Ciò che succede in quella finestra adesso si dice.** Prima erano due rami
/// vuoti — `if let Some(app)` senza `else`, e un `let _ =` sulla consegna — e
/// due rami vuoti sono la stessa frase: *l'evento non è uscito, e nessuno lo
/// saprà*. Il commento che stava qui diceva che nella finestra non c'è nessun
/// vault aperto che possa emettere, ed è probabilmente vero oggi; ma «probabile»
/// è un argomento, non un presidio, e la seconda strada — una consegna che torna
/// con un errore — non ha nemmeno quell'argomento. Adesso tutte e due rendono
/// [`Consegna::Persa`], il ponte le conta, e chi riceve prende un `Overflow`
/// appena l'uscita torna a funzionare.
#[derive(Default)]
pub(crate) struct WebviewEvents(pub(crate) std::sync::OnceLock<AppHandle>);

impl EventSink for WebviewEvents {
    fn emit(&self, notice: &Notice, vault: Option<&str>) -> Delivery {
        let Some(app) = self.0.get() else {
            tracing::warn!(
                target: "fub.app",
                event = ?notice.kind(),
                "an event was born before the webview existed: nobody will see it, \
                 and subscribers will get an Overflow as soon as the exit opens"
            );
            return Delivery::Dropped;
        };
        // Events can contain vault data: never broadcast them to a document
        // surface or a remote viewer. The main webview is the only host.
        // Il vault viaggia col fatto (#216): l'host tiene aperti anche vault
        // che la shell non mostra (la demo lascia aperto quello di prima, e un
        // vault lasciato chiude dopo che il nuovo è già aperto), e la shell
        // scarta da sé ciò che non è del vault che mostra.
        match app.emit_to("main", "fub://event", ShellNotice { notice, vault }) {
            Ok(()) => Delivery::Done,
            Err(and) => {
                // Un notice che non attraversa l'IPC è un **bug del programma**,
                // non un guasto d'ambiente: la forma è nostra, e `Event::Custom`
                // porta un `serde_json::Value`, che si serializza sempre. Per
                // questo non è un `expect`, che trasformerebbe il bug di un
                // plugin in un'app che cade, e non è un ramo vuoto, che lo
                // trasformerebbe in una shell ferma senza motivo: si dice, e si
                // conta.
                tracing::error!(
                    target: "fub.app",
                    event = ?notice.kind(),
                    error = %and,
                    "an event did not cross the IPC: the receiver falls behind by \
                     this fact and will reconcile on the next successful delivery"
                );
                Delivery::Dropped
            }
        }
    }
}
