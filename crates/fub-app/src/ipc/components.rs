//! Comandi IPC della mappa dei componenti e dei profili da applicare.

use super::*;

/// Una riga della pagina «Componenti»: la riga del vault
/// ([`componenti::RigaNelVault`], appiattita) con ciò che la mappa dice di lei.
///
/// Sul filo `nome` è **già nella lingua di chi guarda** (la lingua del vault,
/// con quella del sistema come ripiego), non la chiave del catalogo che la
/// riga del vault porta: la shell quel catalogo non ce l'ha. Una chiave che
/// manca dà l'id. `gruppo` è sempre uno di [`ComponentsMap::gruppi`]: le righe
/// che non ne dicono uno stanno in `altro`.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ComponentRow {
    #[serde(flatten)]
    pub riga: componenti::RigaNelVault,
    /// Che cosa fa per chi usa Fub, in una frase, risolta come il nome; vuota
    /// se il catalogo non l'ha.
    pub descrizione: String,
    /// Modo, motore, servizio o dati.
    pub tipo: fub_abi::ComponentKind,
    /// I pezzi del client che la riga carica, cartelle sotto
    /// `apps/client/src/` (`editors/media`): gli stessi di `manifest.ui`.
    pub ui: Vec<String>,
    /// I requisiti diretti, già risolti in id di righe (`provides` compresi).
    pub richiede: Vec<String>,
    /// Gli «usa se c'è» che in questa build sono righe: non accendono niente.
    pub usa: Vec<String>,
}

/// Un profilo di [`componenti::profili`], come lo mostra la pagina.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ComponentProfile {
    pub nome: String,
    /// Il nome da mostrare, nella lingua di chi guarda; il nome interno se il
    /// catalogo non l'ha.
    pub etichetta: String,
    pub componenti: Vec<String>,
    /// I componenti che il profilo aspetta e che non esistono ancora.
    pub arriva_con: Vec<String>,
    /// Se aspetta qualcosa: allora non si applica («più avanti»).
    pub piu_avanti: bool,
}

/// Un gruppo della pagina «Componenti», come la pagina lo intitola.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ComponentGroup {
    pub id: String,
    /// Il nome nella lingua di chi guarda; l'id se il catalogo non l'ha.
    pub nome: String,
}

/// Ciò che `components_map` risponde: i gruppi, le righe, lo stato, il
/// profilo attivo (`None` = personalizzato), i profili e gli id che le chiavi
/// nominano a vuoto.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ComponentsMap {
    /// I gruppi che la pagina disegna, nel suo ordine: solo quelli che in
    /// questa build hanno righe.
    pub gruppi: Vec<ComponentGroup>,
    pub righe: Vec<ComponentRow>,
    pub stato: componenti::Stato,
    pub profilo: Option<String>,
    pub profili: Vec<ComponentProfile>,
    pub mancanti: Vec<componenti::Mancante>,
}

/// Ciò che `components_apply` risponde: l'esito della scelta, o il rifiuto
/// tipato. Il rifiuto **non** è un errore dell'IPC: è una risposta, e la
/// shell la dice con le sue parole; l'errore resta per ciò che non è una
/// scelta (il vault non aperto, l'host che non risponde).
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "risposta", rename_all = "snake_case")]
pub enum ComponentsApplied {
    Esito(componenti::Esito),
    Rifiuto(componenti::Rifiuto),
}

/// La mappa dei componenti di `vault` per la shell: ciò che serve
/// `components_map`, con gli errori nella lingua di chi guarda.
pub fn components_map_for(host: &Host, vault: Option<&str>) -> Result<ComponentsMap, PluginError> {
    let result = host.components(vault).map(|nel_vault| {
        let testi = host.component_texts(vault);
        let definizioni = componenti::righe();
        let mappa = componenti::mappa();
        let righe = nel_vault
            .righe
            .into_iter()
            // Le righe del vault nascono dalla mappa: una senza definizione
            // non esiste, e se esistesse la pagina non saprebbe disegnarla.
            .filter_map(|mut riga| {
                let definizione = definizioni
                    .iter()
                    .find(|definizione| definizione.id == riga.id)?;
                riga.nome = testi.nome(definizione);
                Some(ComponentRow {
                    descrizione: testi.descrizione(definizione),
                    tipo: definizione.kind,
                    ui: definizione.ui.iter().map(|ui| ui.to_string()).collect(),
                    richiede: mappa.richiesti(&riga.id).to_vec(),
                    usa: definizione
                        .uses
                        .iter()
                        .filter(|id| mappa.componente(id).is_some())
                        .map(|id| id.to_string())
                        .collect(),
                    riga,
                })
            })
            .collect();
        let profili = componenti::profili()
            .into_iter()
            .map(|profilo| ComponentProfile {
                piu_avanti: profilo.piu_avanti(),
                nome: profilo.nome.to_string(),
                etichetta: testi.profilo(&profilo),
                componenti: profilo.componenti.iter().map(|id| id.to_string()).collect(),
                arriva_con: profilo.arriva_con.iter().map(|id| id.to_string()).collect(),
            })
            .collect();
        let gruppi = componenti::gruppi()
            .into_iter()
            .map(|gruppo| ComponentGroup {
                id: gruppo.to_string(),
                nome: testi.gruppo(gruppo),
            })
            .collect();
        ComponentsMap {
            gruppi,
            righe,
            stato: nel_vault.stato,
            profilo: nel_vault.profilo,
            profili,
            mancanti: nel_vault.mancanti,
        }
    });
    for_the_shell(host, vault, result)
}

/// Applica una scelta sui componenti, o con `apply` falso dice che cosa
/// cambierebbe: ciò che serve `components_apply`. La regola è quella della
/// CLI e di MCP ([`Host::apply_components`]).
pub fn components_apply_for(
    host: &Host,
    vault: Option<&str>,
    azione: componenti::Azione,
    apply: bool,
) -> Result<ComponentsApplied, PluginError> {
    let result = host
        .apply_components(vault, azione, apply)
        .map(|risposta| match risposta {
            Ok(esito) => ComponentsApplied::Esito(esito),
            Err(rifiuto) => ComponentsApplied::Rifiuto(rifiuto),
        });
    for_the_shell(host, vault, result)
}

/// La mappa dei componenti di un vault, con lo stato e i profili (A7). Fuori
/// dal thread principale (`host_read`), come `components_apply`: la pagina
/// rilegge la mappa dopo aver aspettato la scelta.
#[tauri::command]
pub(crate) async fn components_map(
    app: AppHandle,
    vault: Option<String>,
) -> Result<ComponentsMap, PluginError> {
    host_read(app, "component map", move |host| {
        components_map_for(host, vault.as_deref())
    })
    .await
}

/// Applica una scelta sui componenti (A7). Senza `apply` è una prova: dice
/// che cosa cambierebbe e non scrive niente, come la CLI. Come
/// `set_plugin_enabled` gira fuori dal thread dei comandi: spegnere o
/// riaccendere la lavagna rimonta il vault, e la riapertura riscandisce.
/// Non è `program_writable`: lo stato dei componenti lo cambia solo la shell.
#[tauri::command]
pub(crate) async fn components_apply(
    app: AppHandle,
    vault: Option<String>,
    azione: componenti::Azione,
    apply: Option<bool>,
) -> Result<ComponentsApplied, PluginError> {
    tauri::async_runtime::spawn_blocking(move || {
        let host = app.state::<Host>();
        components_apply_for(&host, vault.as_deref(), azione, apply.unwrap_or(false))
    })
    .await
    .map_err(|error| unfinished("component choice", error))?
}
