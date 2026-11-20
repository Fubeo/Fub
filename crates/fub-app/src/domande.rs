//! Le domande al canale dati (`query_index`), i disegni delle view
//! (`render_view`) e le altre porte che possono lavorare a lungo fuori dal
//! thread principale, **in fila**.
//!
//! Un comando sincrono di Tauri gira sul thread principale, lo stesso che
//! presenta i fotogrammi della finestra: una domanda lunga — il correttore che
//! controlla una nota di 30 KB ci mette 0,7 s — ferma la finestra per tutto
//! quel tempo, anche se la pagina è libera. Qui ogni domanda va a un thread
//! suo, e la finestra continua.
//!
//! Sul thread principale le domande uscivano una dopo l'altra, nell'ordine in
//! cui arrivavano, e la shell ci conta: chi cerca mentre si scrive manda «ab»
//! e poi «abc», e applica le risposte come arrivano. Perciò le domande non
//! girano in parallelo, ma in **corsie**: una fila, servita da un thread suo,
//! che risponde nell'ordine in cui le domande sono entrate. L'indice ha la sua
//! corsia, e ogni spazio dei nomi di un plugin (`IndexQuery::Custom { ns }`)
//! la sua, così il controllo lungo di una nota non fa aspettare la struttura
//! della nota dopo. Due domande mandate dalla shell nello stesso istante
//! entrano in un ordine qualsiasi; una mandata dopo che l'altra è partita
//! esce dopo.
//!
//! Le corsie sono al più [`MAX_CORSIE`]: lo spazio dei nomi arriva dalla UI,
//! che non è fidata, e un nome nuovo oltre il tetto va nella corsia comune
//! delle altre (`CORSIA_ALTRE`). Una domanda che va in panico risponde
//! `Internal` e la corsia continua.
//!
//! I disegni delle view hanno una corsia loro (`CORSIA_VISTE`), che c'è
//! sempre. Arrivano a raffica: un salvataggio invecchia una ventina di view
//! (struttura, collegamenti, statistiche, cronologia…) e la shell le ridisegna
//! tutte nello stesso giro. Ognuna costa pochi millisecondi, ma in fila sul
//! thread principale erano 100 ms in cui la finestra non presentava
//! fotogrammi. In corsia i disegni restano in fila fra loro e non aspettano le
//! domande dell'indice né il correttore.
//!
//! Anche le porte del foglio sui byte (`open_grid_bytes`, `grid_bytes_window`,
//! `apply_grid_bytes`, `grid_bytes_commands`, `grid_bytes_command`,
//! `close_grid_bytes`) hanno una corsia loro (`CORSIA_GRIGLIA`), che c'è
//! sempre. Scorrendo il foglio la shell chiede una finestra a ogni blocco di
//! righe nuove: sul thread principale ogni lettura toglieva fotogrammi allo
//! scorrimento. La fila tiene l'ordine che il thread principale dava: una
//! finestra chiesta prima di una modifica si legge prima della modifica, e il
//! catalogo dei comandi chiesto dopo esce dopo. In parallelo non guadagnerebbe
//! niente: il provider di una superficie risponde a una chiamata per volta.
//! Anche l'elenco delle superfici (`list_grid_surfaces`) passa di lì: legge il
//! workspace, e sul thread principale aspetterebbe chi lo sta scrivendo.
//!
//! Le altre porte che leggono o scrivono il workspace, chiamano un provider o
//! toccano il disco hanno corsie loro, che ci sono sempre e tengono l'ordine
//! d'arrivo che il thread principale dava:
//!
//! - `set_active_context` va nella corsia del contesto (`CORSIA_CONTESTO`).
//!   La shell pubblica il contesto senza aspettare la risposta precedente (il
//!   cursore, il cambio di nota): due pubblicazioni in parallelo potrebbero
//!   arrivare invertite, e il kernel resterebbe sul contesto vecchio. In fila
//!   vince l'ultima. Non sta con le viste perché non deve aspettare una
//!   ventina di disegni per dire quali view sono invecchiate.
//! - `view_action` va nella corsia delle viste, con i disegni: un'azione e il
//!   disegno della stessa view chiesto dopo restano in quell'ordine, e le
//!   risposte escono nell'ordine in cui lo stato del provider è cambiato.
//! - `invoke_command` va nella corsia dei comandi (`CORSIA_COMANDI`): un
//!   comando può durare secondi (una pagina web da catturare, un'esportazione
//!   di cartella), e due comandi mandati di fila si applicano in quell'ordine.
//! - `view_state` e `set_view_state` vanno nella corsia dello stato di vista
//!   (`CORSIA_STATO`): ogni scrittura rilegge e riscrive un file. In fila la
//!   seconda scrittura della stessa chiave non è mai coperta dalla prima, e
//!   una lettura chiesta dopo una scrittura la vede.
//!
//! Le letture senza un ordine da tenere (`list_views`, `list_commands`,
//! `components_map`) escono dal thread principale senza corsia
//! (`host_read` in `lib.rs`).

use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;

use fub_abi::traits::IndexQuery;
use fub_abi::PluginError;

/// Quante corsie al più per le domande: l'indice, la comune delle altre e i
/// plugin. Quelle delle viste e del foglio stanno fuori dal conto.
pub(crate) const MAX_CORSIE: usize = 16;
const CORSIA_INDICE: &str = "indice";
const CORSIA_ALTRE: &str = "altre";
/// La corsia dei disegni delle view. Nessuna domanda ci finisce per errore:
/// quelle dei plugin si chiamano `custom:…`.
pub(crate) const CORSIA_VISTE: &str = "viste";
/// La corsia delle porte del foglio. Come quella delle viste, non è un
/// prefisso che una domanda possa scegliere.
pub(crate) const CORSIA_GRIGLIA: &str = "griglia";
/// La corsia del contesto del pannello con il focus (`set_active_context`).
pub(crate) const CORSIA_CONTESTO: &str = "contesto";
/// La corsia dei comandi del registro (`invoke_command`).
pub(crate) const CORSIA_COMANDI: &str = "comandi";
/// La corsia dello stato di vista della shell (`view_state`,
/// `set_view_state`).
pub(crate) const CORSIA_STATO: &str = "stato";
/// Le corsie che ci sono sempre e stanno fuori dal tetto delle domande.
const CORSIE_FISSE: [&str; 5] = [
    CORSIA_VISTE,
    CORSIA_GRIGLIA,
    CORSIA_CONTESTO,
    CORSIA_COMANDI,
    CORSIA_STATO,
];

type Lavoro = Box<dyn FnOnce() + Send + 'static>;

/// Le corsie aperte, ognuna col capo della sua fila.
#[derive(Default)]
pub(crate) struct Corsie {
    file: Mutex<HashMap<String, Sender<Lavoro>>>,
}

/// La corsia di una domanda: quella del suo plugin, o quella dell'indice.
pub(crate) fn corsia(query: &IndexQuery) -> String {
    match query {
        IndexQuery::Custom { ns, .. } => format!("custom:{ns}"),
        _ => CORSIA_INDICE.to_string(),
    }
}

impl Corsie {
    /// Mette `lavoro` in fondo alla corsia `nome` e ne aspetta la risposta.
    /// `cosa` nomina il lavoro negli errori.
    pub(crate) async fn chiedi<T, F>(
        &self,
        cosa: &'static str,
        nome: String,
        lavoro: F,
    ) -> Result<T, PluginError>
    where
        T: Send + 'static,
        F: FnOnce() -> Result<T, PluginError> + Send + 'static,
    {
        let (risposta, attesa) = tokio::sync::oneshot::channel();
        let compito: Lavoro = Box::new(move || {
            let esito = catch_unwind(AssertUnwindSafe(lavoro))
                .unwrap_or_else(|_| Err(crate::unfinished(cosa, "it panicked")));
            // Chi aspetta può essersene andato: la risposta non serve più.
            let _ = risposta.send(esito);
        });
        self.accoda(cosa, nome, compito)?;
        attesa
            .await
            .map_err(|_| crate::unfinished(cosa, "its lane closed"))?
    }

    fn accoda(&self, cosa: &'static str, nome: String, compito: Lavoro) -> Result<(), PluginError> {
        let mut file = self
            .file
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let fisse = CORSIE_FISSE
            .iter()
            .filter(|fissa| file.contains_key(**fissa))
            .count();
        let domande = file.len() - fisse;
        let nome = if file.contains_key(&nome)
            || domande < MAX_CORSIE - 1
            || nome == CORSIA_ALTRE
            || CORSIE_FISSE.contains(&nome.as_str())
        {
            nome
        } else {
            CORSIA_ALTRE.to_string()
        };
        let compito = match file.get(&nome) {
            Some(fila) => match fila.send(compito) {
                Ok(()) => return Ok(()),
                // Il thread della corsia non c'è più: se ne apre un altro.
                Err(rimasto) => rimasto.0,
            },
            None => compito,
        };
        let fila =
            apri_corsia(&nome).map_err(|_| crate::unfinished(cosa, "its lane did not start"))?;
        // Il thread appena aperto riceve: l'invio non fallisce.
        let _ = fila.send(compito);
        file.insert(nome, fila);
        Ok(())
    }
}

fn apri_corsia(nome: &str) -> std::io::Result<Sender<Lavoro>> {
    let (fila, arrivi) = channel::<Lavoro>();
    std::thread::Builder::new()
        .name(nome_thread(nome))
        .spawn(move || {
            for compito in arrivi {
                compito();
            }
        })?;
    Ok(fila)
}

/// Il nome del thread di una corsia, per i profiler: solo caratteri innocui,
/// perché lo spazio dei nomi arriva dalla UI e un NUL farebbe fallire il
/// thread.
fn nome_thread(nome: &str) -> String {
    let pulito: String = nome
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || ".:-_".contains(c) {
                c
            } else {
                '_'
            }
        })
        .take(48)
        .collect();
    format!("fub-domande-{pulito}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }

    #[test]
    fn una_corsia_risponde_nell_ordine_in_cui_le_domande_entrano() {
        let corsie = Arc::new(Corsie::default());
        let ordine = Arc::new(Mutex::new(Vec::new()));
        runtime().block_on(async {
            let lenta = {
                let ordine = Arc::clone(&ordine);
                corsie.chiedi("index query", "indice".into(), move || {
                    std::thread::sleep(Duration::from_millis(150));
                    ordine.lock().unwrap().push("ab");
                    Ok("ab")
                })
            };
            let svelta = {
                let ordine = Arc::clone(&ordine);
                corsie.chiedi("index query", "indice".into(), move || {
                    ordine.lock().unwrap().push("abc");
                    Ok("abc")
                })
            };
            let (a, b) = tokio::join!(lenta, svelta);
            assert_eq!((a.unwrap(), b.unwrap()), ("ab", "abc"));
        });
        assert_eq!(*ordine.lock().unwrap(), ["ab", "abc"]);
    }

    #[test]
    fn una_corsia_lenta_non_fa_aspettare_le_altre() {
        let corsie = Corsie::default();
        runtime().block_on(async {
            let partenza = Instant::now();
            let lenta = corsie.chiedi("index query", "custom:fub.proof".into(), || {
                std::thread::sleep(Duration::from_millis(400));
                Ok(())
            });
            let svelta = async {
                let esito = corsie
                    .chiedi("index query", "indice".into(), || Ok(()))
                    .await;
                (esito, partenza.elapsed())
            };
            let (_, (esito, dopo)) = tokio::join!(lenta, svelta);
            esito.unwrap();
            assert!(
                dopo < Duration::from_millis(300),
                "l'indice ha aspettato il correttore: {dopo:?}"
            );
        });
    }

    #[test]
    fn una_domanda_in_panico_risponde_internal_e_la_corsia_continua() {
        let corsie = Corsie::default();
        runtime().block_on(async {
            let caduta: Result<(), _> = corsie
                .chiedi("index query", "indice".into(), || panic!("prova"))
                .await;
            assert!(matches!(caduta, Err(PluginError::Internal(_))));
            assert_eq!(
                corsie
                    .chiedi("index query", "indice".into(), || Ok(7))
                    .await
                    .unwrap(),
                7
            );
        });
    }

    #[test]
    fn oltre_il_tetto_i_nomi_nuovi_vanno_nella_corsia_comune() {
        let corsie = Corsie::default();
        runtime().block_on(async {
            for i in 0..MAX_CORSIE * 4 {
                corsie
                    .chiedi("index query", format!("custom:ns{i}"), || Ok(()))
                    .await
                    .unwrap();
            }
        });
        let file = corsie.file.lock().unwrap();
        assert_eq!(file.len(), MAX_CORSIE);
        assert!(file.contains_key(CORSIA_ALTRE));
    }

    #[test]
    fn la_corsia_delle_viste_c_e_anche_a_tetto_pieno_e_non_toglie_posti() {
        let corsie = Corsie::default();
        runtime().block_on(async {
            corsie
                .chiedi("view render", CORSIA_VISTE.into(), || Ok(()))
                .await
                .unwrap();
            for i in 0..MAX_CORSIE * 4 {
                corsie
                    .chiedi("index query", format!("custom:ns{i}"), || Ok(()))
                    .await
                    .unwrap();
            }
            assert_eq!(
                corsie
                    .chiedi("view render", CORSIA_VISTE.into(), || Ok(3))
                    .await
                    .unwrap(),
                3
            );
        });
        let file = corsie.file.lock().unwrap();
        assert_eq!(file.len(), MAX_CORSIE + 1);
        assert!(file.contains_key(CORSIA_VISTE));
        assert!(file.contains_key(CORSIA_ALTRE));
    }

    #[test]
    fn la_corsia_del_foglio_c_e_anche_a_tetto_pieno_e_non_toglie_posti() {
        let corsie = Corsie::default();
        runtime().block_on(async {
            for fissa in CORSIE_FISSE {
                corsie
                    .chiedi("grid", fissa.into(), || Ok(()))
                    .await
                    .unwrap();
            }
            for i in 0..MAX_CORSIE * 4 {
                corsie
                    .chiedi("index query", format!("custom:ns{i}"), || Ok(()))
                    .await
                    .unwrap();
            }
            assert_eq!(
                corsie
                    .chiedi("grid window", CORSIA_GRIGLIA.into(), || Ok(5))
                    .await
                    .unwrap(),
                5
            );
        });
        let file = corsie.file.lock().unwrap();
        assert_eq!(file.len(), MAX_CORSIE + CORSIE_FISSE.len());
        assert!(file.contains_key(CORSIA_GRIGLIA));
        assert!(file.contains_key(CORSIA_ALTRE));
    }

    /// Come sul thread principale: una finestra entrata in corsia prima di
    /// una modifica legge la revisione da cui la modifica parte, anche se è
    /// lenta, e la modifica che segue non la scavalca.
    #[test]
    fn nel_foglio_una_finestra_chiesta_prima_di_una_modifica_si_legge_prima() {
        let corsie = Corsie::default();
        let revisione = Arc::new(Mutex::new(1u32));
        runtime().block_on(async {
            let finestra = {
                let revisione = Arc::clone(&revisione);
                corsie.chiedi("grid window", CORSIA_GRIGLIA.into(), move || {
                    std::thread::sleep(Duration::from_millis(150));
                    Ok(*revisione.lock().unwrap())
                })
            };
            let modifica = {
                let revisione = Arc::clone(&revisione);
                corsie.chiedi("grid apply", CORSIA_GRIGLIA.into(), move || {
                    let mut revisione = revisione.lock().unwrap();
                    *revisione += 1;
                    Ok(*revisione)
                })
            };
            let (letta, scritta) = tokio::join!(finestra, modifica);
            assert_eq!((letta.unwrap(), scritta.unwrap()), (1, 2));
        });
    }

    #[test]
    fn una_finestra_lenta_del_foglio_non_fa_aspettare_indice_e_viste() {
        let corsie = Corsie::default();
        runtime().block_on(async {
            let partenza = Instant::now();
            let lenta = corsie.chiedi("grid window", CORSIA_GRIGLIA.into(), || {
                std::thread::sleep(Duration::from_millis(400));
                Ok(())
            });
            let svelte = async {
                let indice = corsie
                    .chiedi("index query", "indice".into(), || Ok(()))
                    .await;
                let vista = corsie
                    .chiedi("view render", CORSIA_VISTE.into(), || Ok(()))
                    .await;
                (indice, vista, partenza.elapsed())
            };
            let (_, (indice, vista, dopo)) = tokio::join!(lenta, svelte);
            indice.unwrap();
            vista.unwrap();
            assert!(
                dopo < Duration::from_millis(300),
                "l'indice e le viste hanno aspettato il foglio: {dopo:?}"
            );
        });
    }

    /// Come sul thread principale: un contesto pubblicato prima, anche se ci
    /// mette di più, non copre quello pubblicato dopo.
    #[test]
    fn un_contesto_lento_pubblicato_prima_non_copre_quello_dopo() {
        let corsie = Corsie::default();
        let contesto = Arc::new(Mutex::new("nessuno"));
        runtime().block_on(async {
            let primo = {
                let contesto = Arc::clone(&contesto);
                corsie.chiedi("active context", CORSIA_CONTESTO.into(), move || {
                    std::thread::sleep(Duration::from_millis(150));
                    *contesto.lock().unwrap() = "Uno";
                    Ok(())
                })
            };
            let secondo = {
                let contesto = Arc::clone(&contesto);
                corsie.chiedi("active context", CORSIA_CONTESTO.into(), move || {
                    *contesto.lock().unwrap() = "Due";
                    Ok(())
                })
            };
            let (a, b) = tokio::join!(primo, secondo);
            a.unwrap();
            b.unwrap();
        });
        assert_eq!(*contesto.lock().unwrap(), "Due");
    }

    /// Un comando lungo (una pagina da catturare) o un disegno lento non
    /// fanno aspettare il contesto e lo stato di vista, né fra loro.
    #[test]
    fn comandi_viste_contesto_e_stato_non_si_aspettano() {
        let corsie = Corsie::default();
        runtime().block_on(async {
            let partenza = Instant::now();
            let comando = corsie.chiedi("command", CORSIA_COMANDI.into(), || {
                std::thread::sleep(Duration::from_millis(400));
                Ok(())
            });
            let disegno = corsie.chiedi("view render", CORSIA_VISTE.into(), || {
                std::thread::sleep(Duration::from_millis(400));
                Ok(())
            });
            let svelte = async {
                let contesto = corsie
                    .chiedi("active context", CORSIA_CONTESTO.into(), || Ok(()))
                    .await;
                let stato = corsie
                    .chiedi("view state", CORSIA_STATO.into(), || Ok(()))
                    .await;
                (contesto, stato, partenza.elapsed())
            };
            let (_, _, (contesto, stato, dopo)) = tokio::join!(comando, disegno, svelte);
            contesto.unwrap();
            stato.unwrap();
            assert!(
                dopo < Duration::from_millis(300),
                "contesto e stato hanno aspettato un comando o un disegno: {dopo:?}"
            );
        });
    }

    /// Due comandi mandati di fila si applicano in quell'ordine anche se il
    /// primo è lento.
    #[test]
    fn due_comandi_di_fila_si_applicano_in_ordine() {
        let corsie = Corsie::default();
        let ordine = Arc::new(Mutex::new(Vec::new()));
        runtime().block_on(async {
            let primo = {
                let ordine = Arc::clone(&ordine);
                corsie.chiedi("command", CORSIA_COMANDI.into(), move || {
                    std::thread::sleep(Duration::from_millis(150));
                    ordine.lock().unwrap().push("rinomina");
                    Ok(())
                })
            };
            let secondo = {
                let ordine = Arc::clone(&ordine);
                corsie.chiedi("command", CORSIA_COMANDI.into(), move || {
                    ordine.lock().unwrap().push("sposta");
                    Ok(())
                })
            };
            let (a, b) = tokio::join!(primo, secondo);
            a.unwrap();
            b.unwrap();
        });
        assert_eq!(*ordine.lock().unwrap(), ["rinomina", "sposta"]);
    }

    #[test]
    fn un_disegno_lento_non_fa_aspettare_l_indice() {
        let corsie = Corsie::default();
        runtime().block_on(async {
            let partenza = Instant::now();
            let lenta = corsie.chiedi("view render", CORSIA_VISTE.into(), || {
                std::thread::sleep(Duration::from_millis(400));
                Ok(())
            });
            let svelta = async {
                let esito = corsie
                    .chiedi("index query", "indice".into(), || Ok(()))
                    .await;
                (esito, partenza.elapsed())
            };
            let (_, (esito, dopo)) = tokio::join!(lenta, svelta);
            esito.unwrap();
            assert!(
                dopo < Duration::from_millis(300),
                "l'indice ha aspettato le viste: {dopo:?}"
            );
        });
    }

    #[test]
    fn uno_spazio_dei_nomi_qualsiasi_apre_la_sua_corsia() {
        let corsie = Corsie::default();
        let strano = format!("custom:a\0b{}", "x".repeat(500));
        let esito = runtime().block_on(corsie.chiedi("index query", strano, || Ok(1)));
        assert_eq!(esito.unwrap(), 1);
        assert_eq!(nome_thread("custom:a\0b/c"), "fub-domande-custom:a_b_c");
    }

    #[test]
    fn le_domande_dell_indice_e_dei_plugin_hanno_corsie_diverse() {
        let custom = IndexQuery::Custom {
            ns: "fub.proof".into(),
            query: serde_json::Value::Null,
        };
        assert_eq!(corsia(&custom), "custom:fub.proof");
        assert_eq!(corsia(&IndexQuery::Settings { plugin: None }), "indice");
    }
}
