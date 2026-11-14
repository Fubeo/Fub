//! Le domande al canale dati (`query_index`) fuori dal thread principale,
//! **in fila**.
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

use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;

use fub_abi::traits::IndexQuery;
use fub_abi::PluginError;

/// Quante corsie al più: l'indice, la comune delle altre e i plugin.
pub(crate) const MAX_CORSIE: usize = 16;
const CORSIA_INDICE: &str = "indice";
const CORSIA_ALTRE: &str = "altre";

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
    pub(crate) async fn chiedi<T, F>(&self, nome: String, lavoro: F) -> Result<T, PluginError>
    where
        T: Send + 'static,
        F: FnOnce() -> Result<T, PluginError> + Send + 'static,
    {
        let (risposta, attesa) = tokio::sync::oneshot::channel();
        let compito: Lavoro = Box::new(move || {
            let esito = catch_unwind(AssertUnwindSafe(lavoro))
                .unwrap_or_else(|_| Err(crate::unfinished("index query", "it panicked")));
            // Chi aspetta può essersene andato: la risposta non serve più.
            let _ = risposta.send(esito);
        });
        self.accoda(nome, compito)?;
        attesa
            .await
            .map_err(|_| crate::unfinished("index query", "its lane closed"))?
    }

    fn accoda(&self, nome: String, compito: Lavoro) -> Result<(), PluginError> {
        let mut file = self
            .file
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let nome =
            if file.contains_key(&nome) || file.len() < MAX_CORSIE - 1 || nome == CORSIA_ALTRE {
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
        let fila = apri_corsia(&nome)
            .map_err(|_| crate::unfinished("index query", "its lane did not start"))?;
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
                corsie.chiedi("indice".into(), move || {
                    std::thread::sleep(Duration::from_millis(150));
                    ordine.lock().unwrap().push("ab");
                    Ok("ab")
                })
            };
            let svelta = {
                let ordine = Arc::clone(&ordine);
                corsie.chiedi("indice".into(), move || {
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
            let lenta = corsie.chiedi("custom:fub.proof".into(), || {
                std::thread::sleep(Duration::from_millis(400));
                Ok(())
            });
            let svelta = async {
                let esito = corsie.chiedi("indice".into(), || Ok(())).await;
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
            let caduta: Result<(), _> = corsie.chiedi("indice".into(), || panic!("prova")).await;
            assert!(matches!(caduta, Err(PluginError::Internal(_))));
            assert_eq!(corsie.chiedi("indice".into(), || Ok(7)).await.unwrap(), 7);
        });
    }

    #[test]
    fn oltre_il_tetto_i_nomi_nuovi_vanno_nella_corsia_comune() {
        let corsie = Corsie::default();
        runtime().block_on(async {
            for i in 0..MAX_CORSIE * 4 {
                corsie
                    .chiedi(format!("custom:ns{i}"), || Ok(()))
                    .await
                    .unwrap();
            }
        });
        let file = corsie.file.lock().unwrap();
        assert_eq!(file.len(), MAX_CORSIE);
        assert!(file.contains_key(CORSIA_ALTRE));
    }

    #[test]
    fn uno_spazio_dei_nomi_qualsiasi_apre_la_sua_corsia() {
        let corsie = Corsie::default();
        let strano = format!("custom:a\0b{}", "x".repeat(500));
        let esito = runtime().block_on(corsie.chiedi(strano, || Ok(1)));
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
