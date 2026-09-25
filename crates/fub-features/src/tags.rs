//! Il pannello **tag** come `ViewProvider`, terzo provider vero.
//!
//! Come l'outline, legge dal kernel via il canale metadata: i tag dell'intero
//! vault con la loro frequenza li aggrega il kernel dai modelli
//! ([`IndexQuery::Tags`]) — una view non parsa e non conosce l'intero vault.
//! Cliccare un tag chiede una ricerca ([`ViewUpdate::RunSearch`]): il pannello
//! non ha un indice suo, riusa quello di ricerca com'è (i tag sono un campo
//! indicizzato).
//!
//! # È il collaudo del §2.4, e non per modo di dire
//!
//! Questo pannello ha un **filtro**, cioè un campo di testo il cui contenuto
//! deve sopravvivere fra due chiamate a `render_view`. Prima della seduta 2 non
//! era esprimibile in nessuna delle due metà del protocollo: non c'erano nodi di
//! input, e `on_action` prendeva `&self` — quindi il filtro corrente non aveva
//! dove stare se non dietro un `Mutex` che questo provider si sarebbe dovuto
//! inventare. La seduta 2 lo mise in un campo di questa struct, come in
//! qualunque oggetto vivo, e la firma lo permette perché il kernel estrae il
//! provider per la durata dell'azione.
//!
//! # …ed è anche il primo cliente dello stato di vista (§11.2)
//!
//! Quel campo aveva due difetti che si vedevano solo usandolo. Moriva alla
//! chiusura: si ridigitava lo stesso filtro a ogni avvio. Ed era **uno per
//! provider e non per pannello**, perché il provider è uno solo: due esemplari
//! dello stesso pannello — che il §7.4 permette dal giorno in cui una view ha un
//! esemplare — avrebbero condiviso il filtro credendo di averne uno per uno.
//!
//! Ora il filtro sta nello stato di vista, dove la chiave la compone l'host con
//! dentro l'esemplare, e questa struct non ha più campi. È la stessa distinzione
//! che il §11.2 fa fra i tre stati: il filtro **non** è un'impostazione (non lo
//! decide l'utente in un pannello, si deposita mentre si guarda) e **non** è un
//! blob (non è un fatto sul vault: non deve viaggiare con lui).
//!
//! Il giro completo che ne esce è quello che il §2.8 esiste per proteggere: si
//! digita → `on_action` con i `fields` → il provider filtra e risponde
//! `Replace` → la shell **riconcilia** invece di ricostruire, e il campo di
//! testo non perde il focus. Con l'albero ricostruito da zero, scrivere due
//! lettere di fila sarebbe impossibile.

use fub_abi::error::PluginError;
use fub_abi::event::{EventKind, EventMask};
use fub_abi::query::QueryExpr;
use fub_abi::session::ContextMask;
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{
    HostApi, IndexQuery, IndexResult, ReadApi, TagCount, ViewInstance, ViewInterests, ViewProvider,
    ViewSpec, ViewSurface,
};
use fub_abi::ui::{ActionRef, Intent, UiAction, UiKind, UiNode, ViewUpdate};

/// Id del provider (spazio dati/registrazione) e id della view che offre.
pub const TAGS_ID: &str = "fub.tags";
/// Id della `ViewSpec`: è ciò con cui la shell chiede questa view al kernel.
pub const TAGS_VIEW: &str = "tags";

/// L'azione di ricerca per tag; il nome del tag (senza `#`) sta nel payload.
const SEARCH: &str = "search";
/// La chiave del payload di [`SEARCH`].
const TAG: &str = "tag";
/// L'azione del campo filtro, e il nome del campo che porta ciò che si è
/// digitato. Sono due cose diverse — *cosa è successo* e *da dove viene il
/// valore* — e la separazione è il §2.7.
const FILTER: &str = "filter";
const FILTER_FIELD: &str = "filter";
/// La chiave sotto cui il filtro **resta scritto** nello stato di vista (§11.2).
///
/// Vale oggi la stessa stringa del campo, e resta una costante sua: quello è il
/// nome di un campo dentro un albero `UiNode` — roba di questo disegno, che si
/// rinomina il giorno che il pannello cambia forma — questa è una chiave che sta
/// su disco e che qualcuno ha già scritto. Con una costante sola, rinominare il
/// campo avrebbe cambiato in silenzio la chiave salvata, e il filtro di chiunque
/// sarebbe sparito senza che nessuno avesse toccato lo stato di vista.
const FILTER_STATE: &str = "filter";
/// Come si mostra l'elenco: piatta o ad albero. Stessa separazione di
/// [`FILTER_STATE`]: è stato di vista per esemplare (non impostazione, non
/// blob), quindi due pannelli aperti possono guardare lo stesso vault in due
/// modi senza litigare.
const MODE_STATE: &str = "mode";
/// Come si ordina: per nome (l'ordine canonico del kernel) o per conteggio.
const SORT_STATE: &str = "sort";
/// I tag selezionati, come array JSON di nomi interi (`a/b` resta un pezzo
/// solo). Serve alla «selezione di più tag» (F11): si spunta, poi si cerca la
/// combinazione con un gesto solo invece di N click.
const SELECTION_STATE: &str = "selection";
/// L'azione che cambia il modo (il valore sta nel payload sotto [`MODE_KEY]).
const MODE: &str = "mode";
/// La chiave del payload di [`MODE`]: `"flat"` o `"tree"`.
const MODE_KEY: &str = "mode";
/// L'azione che cambia l'ordinamento (valore nel payload sotto [`SORT_KEY]).
const SORT: &str = "sort";
/// La chiave del payload di [`SORT`]: `"name"` o `"count"`.
const SORT_KEY: &str = "sort";
/// Il modo piatto: l'elenco di sempre.
const MODE_FLAT: &str = "flat";
/// Il modo albero: `a/b/c` sotto `a` sotto radice.
const MODE_TREE: &str = "tree";
/// Ordina per nome (canonico del kernel, stabile e paginabile).
const SORT_NAME: &str = "name";
/// Ordina per conteggio (decrescente, a parità per nome).
const SORT_COUNT: &str = "count";
/// L'azione che spunta/rimuove un tag dalla selezione; il nome sta nel payload
/// sotto [`TAG`], come per [`SEARCH`].
const SELECT: &str = "select";
/// L'azione che dimentica la selezione intera (come il filtro vuoto dimentica
/// la chiave invece di scrivere `""`).
const CLEAR_SELECTION: &str = "clear_selection";
/// L'azione che cerca la combinazione selezionata con un gesto solo.
const SEARCH_SELECTED: &str = "search_selected";

/// Il titolo del pannello. Era l'unica stringa di questo file rimasta fuori dal
/// catalogo, ed era anche la più visibile: un pannello si vede sempre, il suo
/// segnaposto solo quando è vuoto.
const VIEW_TITLE: &str = "view_title";
/// Il testo grigio dentro il campo filtro.
const FILTER_PLACEHOLDER: &str = "filter_placeholder";
/// Il vault non ha nessun tag.
const EMPTY: &str = "empty";
/// I tag ci sono, ma nessuno passa il filtro. È un altro stato, e lo dice
/// diversamente: cancellare il filtro è un'azione, creare un tag è un'altra.
const NO_MATCH: &str = "no_match";

/// Etichetta del selettore di modo (piatta o ad albero).
const MODE_LABEL: &str = "mode_label";
/// Etichetta del selettore di ordinamento.
const SORT_LABEL: &str = "sort_label";
/// Voce «piatta» del selettore di modo.
const MODE_FLAT_LABEL: &str = "mode_flat";
/// Voce «albero» del selettore di modo.
const MODE_TREE_LABEL: &str = "mode_tree";
/// Voce «per nome» del selettore di ordinamento.
const SORT_NAME_LABEL: &str = "sort_name";
/// Voce «per conteggio» del selettore di ordinamento.
const SORT_COUNT_LABEL: &str = "sort_count";
/// Quanti tag sono selezionati (`{n}`).
const SELECTED_LABEL: &str = "selected";
/// Pulsante che cerca la combinazione selezionata con un gesto solo.
const SEARCH_SELECTED_LABEL: &str = "search_selected_label";
/// Pulsante che dimentica la selezione intera.
const CLEAR_SELECTION_LABEL: &str = "clear_selection_label";

/// Le stringhe del pannello tag. Vedi
/// [`backlinks::catalog`](crate::backlinks::catalog) per il perché stia nel
/// componente e non nella shell.
pub fn catalog() -> Vec<StringCatalog> {
    vec![
        StringCatalog::new("it")
            .with(VIEW_TITLE, "Tag")
            .with(FILTER_PLACEHOLDER, "filtra i tag")
            .with(EMPTY, "Nessun tag.")
            .with(NO_MATCH, "Nessun tag col filtro.")
            .with(MODE_LABEL, "Vista")
            .with(MODE_FLAT_LABEL, "Piatta")
            .with(MODE_TREE_LABEL, "Albero")
            .with(SORT_LABEL, "Ordina")
            .with(SORT_NAME_LABEL, "Nome")
            .with(SORT_COUNT_LABEL, "Conteggio")
            .with(SELECTED_LABEL, "Selezionati: {n}")
            .with(SEARCH_SELECTED_LABEL, "Cerca i selezionati")
            .with(CLEAR_SELECTION_LABEL, "Azzera"),
        StringCatalog::new("en")
            .with(VIEW_TITLE, "Tags")
            .with(FILTER_PLACEHOLDER, "filter tags")
            .with(EMPTY, "No tags.")
            .with(NO_MATCH, "No tags match the filter.")
            .with(MODE_LABEL, "View")
            .with(MODE_FLAT_LABEL, "Flat")
            .with(MODE_TREE_LABEL, "Tree")
            .with(SORT_LABEL, "Sort")
            .with(SORT_NAME_LABEL, "Name")
            .with(SORT_COUNT_LABEL, "Count")
            .with(SELECTED_LABEL, "Selected: {n}")
            .with(SEARCH_SELECTED_LABEL, "Search selected")
            .with(CLEAR_SELECTION_LABEL, "Clear"),
    ]
}

/// Il pannello tag.
///
/// **Senza campi**: il filtro sta nello stato di vista dell'esemplare (§11.2),
/// che è il primo cliente vero di quella capacità. Prima stava in un campo di
/// questa struct, e quel campo aveva due difetti che si vedevano solo usandolo:
/// moriva alla chiusura — si ridigitava lo stesso filtro a ogni avvio — ed era
/// **uno per provider e non per pannello**, quindi due esemplari dello stesso
/// pannello avrebbero condiviso il filtro credendo di averne uno per uno. Lo
/// stato di vista li risolve entrambi perché la chiave che l'host compone porta
/// dentro l'esemplare.
pub struct TagPanelView;

impl ViewProvider for TagPanelView {
    fn interests(&self, _instance: &ViewInstance) -> ViewInterests {
        ViewInterests {
            // I tag sono aggregati vault-wide: invecchiano a ogni modifica
            // dell'indice, non al cambio di nota.
            refresh: EventMask::of([EventKind::IndexUpdated, EventKind::BatchEnded]),
            // …e non invecchiano per niente col contesto: la distribuzione dei
            // tag del vault è la stessa da qualunque nota la si guardi. È il
            // caso che la maschera esiste per servire — senza, questo pannello
            // si ridisegnerebbe a ogni movimento del cursore.
            follows: ContextMask::default(),
        }
    }

    fn views(&self) -> Vec<ViewSpec> {
        vec![
            // Finché il posto era lettera morta la shell metteva il pannello a
            // destra per conoscenza privata; ora che il montaggio lo rispetta,
            // la dichiarazione dice la stessa cosa.
            ViewSpec::new(TAGS_VIEW, Text::key(VIEW_TITLE), ViewSurface::RightSidebar)
                .with_icon("tag")
                .ordered(2)
                .open_by_default(),
        ]
    }

    fn render_view(
        &self,
        _instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        tree(host)
    }

    fn on_action(
        &mut self,
        _instance: &ViewInstance,
        action: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        match action.action.0.as_str() {
            // Il filtro è cambiato: lo si **ricorda** e si ridisegna. Il valore
            // arriva dai `fields`, che è dove la shell mette ciò che l'utente
            // ha digitato — il `payload` è dell'altro proprietario.
            //
            // Un filtro vuoto si **dimentica** invece di scrivere `""`: la
            // chiave torna a non esserci, che è ciò che significa, e il file non
            // si porta dietro una riga per ogni pannello che qualcuno ha aperto
            // e ripulito.
            FILTER => {
                let filter = action.text_field(FILTER_FIELD).unwrap_or_default();
                let value = (!filter.is_empty()).then(|| serde_json::Value::from(filter));
                host.set_view_state(FILTER_STATE, value)?;
                Ok(ViewUpdate::Replace { root: tree(host)? })
            }
            // RunSearch porta la stringa che la barra saprebbe leggere:
            // `tag:nome`, la stessa sintassi che l'utente scrive.
            SEARCH => match action.payload.get(TAG).and_then(|v| v.as_str()) {
                Some(name) => Ok(ViewUpdate::RunSearch {
                    query: selection_query(&[name.to_string()]),
                }),
                None => Ok(ViewUpdate::None),
            },
            // Il modo (piatta o ad albero) cambia per esemplare: si ricorda e
            // si ridisegna, come il filtro. Un valore fuori dalle due voci
            // legge come il default alla prossima lettura, senza rifiutare qui.
            MODE => {
                let mode = action.payload.get(MODE_KEY).and_then(|v| v.as_str());
                let value = match mode {
                    Some(MODE_TREE) => Some(serde_json::Value::from(MODE_TREE)),
                    Some(MODE_FLAT) => None,
                    _ => return Ok(ViewUpdate::None),
                };
                host.set_view_state(MODE_STATE, value)?;
                Ok(ViewUpdate::Replace { root: tree(host)? })
            }
            // L'ordinamento cambia per esemplare: stessa forma del modo.
            SORT => {
                let sort = action.payload.get(SORT_KEY).and_then(|v| v.as_str());
                let value = match sort {
                    Some(SORT_COUNT) => Some(serde_json::Value::from(SORT_COUNT)),
                    Some(SORT_NAME) => None,
                    _ => return Ok(ViewUpdate::None),
                };
                host.set_view_state(SORT_STATE, value)?;
                Ok(ViewUpdate::Replace { root: tree(host)? })
            }
            // Spunta o rimuove un tag dalla selezione: la chiave di riga resta
            // il nome intero (`a/b` è un pezzo solo), e la selezione è in stato
            // di vista — due pannelli aperti spuntano due insiemi diversi.
            SELECT => {
                let Some(name) = action.payload.get(TAG).and_then(|v| v.as_str()) else {
                    return Ok(ViewUpdate::None);
                };
                let mut selection = selection_of(host)?;
                if selection.iter().any(|s| s == name) {
                    selection.retain(|s| s != name);
                } else {
                    selection.push(name.to_string());
                }
                remember_selection(host, &selection)?;
                Ok(ViewUpdate::Replace { root: tree(host)? })
            }
            // Dimentica la selezione intera: come il filtro vuoto, la chiave
            // torna a non esserci invece di scrivere un array vuoto.
            CLEAR_SELECTION => {
                host.set_view_state(SELECTION_STATE, None)?;
                Ok(ViewUpdate::Replace { root: tree(host)? })
            }
            // Cerca la combinazione selezionata con un gesto solo: una
            // congiunzione di foglie tag, cioè la stessa domanda che N click
            // farebbero uno alla volta, detta una volta sola.
            SEARCH_SELECTED => {
                let selection = selection_of(host)?;
                if selection.is_empty() {
                    return Ok(ViewUpdate::None);
                }
                Ok(ViewUpdate::RunSearch {
                    query: selection_query(&selection),
                })
            }
            _ => Ok(ViewUpdate::None),
        }
    }
}

/// Lo stato di presentazione di questo esemplare: modo, ordinamento, selezione.
/// Il modo di questo esemplare: `"tree"` o `"flat"` (default). Un valore che
/// non è una stringa — o una stringa diversa dalle due — legge come il default,
/// per la stessa promessa di [`filter_of`]: il file si apre con un editor di
/// testo e una sciocchezza scritta a mano non spegne il pannello.
fn mode_of(host: &dyn ReadApi) -> Result<String, PluginError> {
    let mode = host
        .view_state(MODE_STATE)?
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| MODE_FLAT.to_string());
    if mode == MODE_TREE {
        Ok(MODE_TREE.to_string())
    } else {
        Ok(MODE_FLAT.to_string())
    }
}

/// L'ordinamento di questo esemplare: `"count"` o `"name"` (default). Stessa
/// tolleranza di [`mode_of`]: ciò che non si capisce è il default, non un
/// errore.
fn sort_of(host: &dyn ReadApi) -> Result<String, PluginError> {
    let sort = host
        .view_state(SORT_STATE)?
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| SORT_NAME.to_string());
    if sort == SORT_COUNT {
        Ok(SORT_COUNT.to_string())
    } else {
        Ok(SORT_NAME.to_string())
    }
}

/// I tag selezionati di questo esemplare, nell'ordine in cui sono stati
/// spuntati. Un valore che non è un array di stringhe legge come vuoto — mai
/// un pannello che smette di funzionare per una riga scritta a mano.
fn selection_of(host: &dyn ReadApi) -> Result<Vec<String>, PluginError> {
    let Some(value) = host.view_state(SELECTION_STATE)? else {
        return Ok(Vec::new());
    };
    let Some(names) = value.as_array() else {
        return Ok(Vec::new());
    };
    Ok(names
        .iter()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect())
}

/// Ricorda la selezione; vuota si **dimentica** (come il filtro vuoto), così il
/// file non si porta dietro una riga per ogni selezione azzerata.
fn remember_selection(host: &mut dyn HostApi, selection: &[String]) -> Result<(), PluginError> {
    let value = (!selection.is_empty()).then(|| serde_json::Value::from(selection.to_vec()));
    host.set_view_state(SELECTION_STATE, value)
}

/// L'albero del pannello: i tag del vault, filtrati da ciò che si è digitato.
///
/// Prende un `&dyn ReadApi` e non un `&mut`: serve a entrambi i percorsi — il
/// render (lettura) e la risposta a un'azione — e prenderlo in sola lettura è
/// ciò che rende ovvio che disegnare non scrive. È anche la ragione per cui lo
/// stato di vista ha **due** famiglie invece di una: qui si rilegge il filtro da
/// sotto un prestito condiviso, e da qui non si deve poter scrivere.
///
/// Non è più un metodo: questo provider non ha più niente di suo da leggere.
fn tree(host: &dyn ReadApi) -> Result<UiNode, PluginError> {
    // Senza finestra: il pannello mostra la distribuzione intera, ed è la
    // ragione per cui la `Page` è opzionale invece che obbligatoria.
    let tags = match host.query_index(IndexQuery::Tags {
        matching: QueryExpr::all(),
        page: None,
    })? {
        IndexResult::Tags(t) => t,
        other => {
            return Err(PluginError::Internal(
                format!("query tag: risposta fuori tema: {other:?}").into(),
            ))
        }
    };
    Ok(build_tags_tree(
        &tags.items,
        &filter_of(host)?,
        &mode_of(host)?,
        &sort_of(host)?,
        &selection_of(host)?,
    ))
}

/// Il filtro che questo esemplare aveva lasciato scritto.
///
/// Assente è vuoto — il caso normale del primo disegno — e **anche un valore che
/// non è una stringa lo è**: questo file lo si può aprire con un editor di testo
/// (è la stessa promessa fatta alle impostazioni nella 0036), e un numero
/// scritto a mano dentro `filter` non vale un pannello che smette di funzionare.
fn filter_of(host: &dyn ReadApi) -> Result<String, PluginError> {
    Ok(host
        .view_state(FILTER_STATE)?
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default())
}

/// `name` contiene `find` — che arriva **già minuscolo** — a meno del caso.
///
/// Vuol dire *esattamente* `name.to_lowercase().contains(find)`, che è la riga
/// che c'era: qui non si è cambiata la regola, si è tolta la copia. Quella riga
/// allocava una `String` **per tag e per battuta** — su un vault da cinquecento
/// tag sono cinquecento allocazioni ogni volta che si preme un tasto nel campo
/// filtro, cioè un decimo di tutte quelle del ridisegno.
///
/// **Perché due corsie e non una che confronta i caratteri minuscoli uno a uno.**
/// Perché quella è sbagliata, e in questo repo ha già un numero suo: la 0070 la
/// registra su `prefix_len_ci`. `str::to_lowercase` non è
/// `chars().flat_map(char::to_lowercase)` — è **sensibile al contesto**
/// (`ΟΔΟΣ` finisce in `οδος`, non in `οδοσ`) e sa allungare (`İ` diventa due
/// caratteri). Un filtro riscritto carattere per carattere smetterebbe di
/// trovare un tag greco cercandolo per intero, ed è un difetto di correttezza
/// vestito da ottimizzazione.
///
/// Quindi: **la corsia veloce vale solo dove è dimostrabilmente la stessa
/// risposta**, cioè quando il nome del tag è tutto ASCII — lì
/// `to_lowercase` *è* `to_ascii_lowercase`, non c'è contesto da guardare e non
/// c'è niente che si allunghi. Fuori da lì si passa dalla riga di prima, che è
/// l'unica che sa il sigma finale. Un filtro non ASCII contro un nome ASCII non
/// combacia in nessuna delle due corsie, e non ha bisogno di un caso suo: un
/// byte sopra `0x7F` non è mai uguale a un byte ASCII.
fn matches_case_insensitive(name: &str, find: &str) -> bool {
    if !name.is_ascii() {
        return name.to_lowercase().contains(find);
    }
    let (haystack, needle) = (name.as_bytes(), find.as_bytes());
    // `windows(0)` va in panico, e non è un caso da non avere: il chiamante di
    // oggi filtra il vuoto un rigo sopra, il prossimo può non farlo.
    needle.is_empty()
        || haystack
            .windows(needle.len())
            .any(|w| w.eq_ignore_ascii_case(needle))
}

/// Costruisce l'albero `UiNode` del pannello tag. Separato dal provider perché è
/// pura trasformazione dati→UI: si prova senza un host. I tag arrivano già
/// ordinati per nome dal kernel.
///
/// Resta la forma di sempre (campo + elenco piatto): i presidi esistenti — il
/// banco delle allocazioni per battuta e le prove di struttura — leggono
/// questa forma. La vista estesa (modo, ordinamento, selezione) è
/// [`build_tags_tree`], usata da `tree`.
pub fn build_tags_view(tags: &[TagCount], filter: &str) -> UiNode {
    let find = filter.trim().to_lowercase();
    let visible: Vec<&TagCount> = tags
        .iter()
        .filter(|t| find.is_empty() || matches_case_insensitive(&t.name, &find))
        .collect();

    // Il campo c'è sempre, anche quando l'elenco è vuoto: se sparisse appena il
    // filtro non trova niente, cancellare l'ultima lettera sarebbe impossibile.
    let field = UiNode::new(UiKind::TextInput {
        field: FILTER_FIELD.to_string(),
        label: None,
        value: filter.to_string(),
        placeholder: Some(Text::key(FILTER_PLACEHOLDER)),
        action: Some(ActionRef::new(FILTER)),
    })
    // La chiave è ciò che dice al riconciliatore «questo campo è lo stesso di
    // prima»: senza, ogni ridisegno gli toglierebbe il focus di sotto.
    .with_key(FILTER_FIELD);

    let body = if visible.is_empty() {
        UiNode::empty_state(Text::key(if tags.is_empty() { EMPTY } else { NO_MATCH }))
    } else {
        UiNode::list(
            visible
                .iter()
                .map(|t| {
                    UiNode::list_item(
                        format!("#{}", t.name),
                        Some(Text::from(t.count.to_string())),
                        Some(ActionRef::with(SEARCH, serde_json::json!({ TAG: t.name }))),
                    )
                    .with_key(t.name.clone())
                })
                .collect(),
        )
    };

    UiNode::column(4, vec![field, body])
}
/// La ricerca dei tag scelti, scritta **come la scriverebbe chi usa la barra**:
/// `tag:rust tag:"a b"`. La barra la legge con la stessa grammatica di
/// `rules::search_syntax` (e la shell con la sua gemella), quindi cliccare un
/// tag e digitarlo danno gli stessi risultati — sotto-tag compresi — e chi
/// ritocca la query ritocca parole, non JSON.
pub(crate) fn selection_query(selection: &[String]) -> String {
    selection
        .iter()
        .map(|name| {
            let plain = !name.is_empty()
                && name
                    .chars()
                    .all(|c| !c.is_whitespace() && !matches!(c, '"' | '(' | ')' | '[' | ']'));
            if plain {
                format!("tag:{name}")
            } else {
                format!("tag:\"{}\"", name.replace('"', ""))
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// L'albero completo: filtro, modo (piatta/albero), ordinamento (nome/conteggio)
/// e selezione multipla. Pura come [`build_tags_view`]: `mode`, `sort` e
/// `selection` arrivano dallo stato di vista dell'esemplare, letti da `tree`.
///
/// L'ordinamento per conteggio non sposta il costo sul kernel: i tag arrivano
/// già aggregati e ordinati per nome, e riordinare una distribuzione (centinaia
/// di voci) costa il sort locale — non una seconda interrogazione. I filtri
/// multipli sono coerenti perché restano foglie della stessa semantica che la
/// ricerca usa: `tags:a tags:b` in AND seleziona le note che portano entrambi.
pub fn build_tags_tree(
    tags: &[TagCount],
    filter: &str,
    mode: &str,
    sort: &str,
    selection: &[String],
) -> UiNode {
    let find = filter.trim().to_lowercase();
    let mut visible: Vec<&TagCount> = tags
        .iter()
        .filter(|t| find.is_empty() || matches_case_insensitive(&t.name, &find))
        .collect();
    if sort == SORT_COUNT {
        visible.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.name.cmp(&b.name)));
    }

    // Il campo c'è sempre, anche quando l'elenco è vuoto: se sparisse appena il
    // filtro non trova niente, cancellare l'ultima lettera sarebbe impossibile.
    let field = UiNode::new(UiKind::TextInput {
        field: FILTER_FIELD.to_string(),
        label: None,
        value: filter.to_string(),
        placeholder: Some(Text::key(FILTER_PLACEHOLDER)),
        action: Some(ActionRef::new(FILTER)),
    })
    // La chiave è ciò che dice al riconciliatore «questo campo è lo stesso di
    // prima»: senza, ogni ridisegno gli toglierebbe il focus di sotto.
    .with_key(FILTER_FIELD);

    // Due selettori, non uno: modo e ordinamento sono dimensioni diverse, e un
    // selettore che li fondesse («piatta-per-nome», «albero-per-conteggio») ha
    // quattro voci invece di due+due — e sei alla terza dimensione.
    let controls = UiNode::row(
        2,
        vec![
            UiNode::button(
                Text::key(if mode == MODE_TREE {
                    MODE_TREE_LABEL
                } else {
                    MODE_FLAT_LABEL
                }),
                Intent::Neutral,
                ActionRef::with(
                    MODE,
                    serde_json::json!({ MODE_KEY: if mode == MODE_TREE { MODE_FLAT } else { MODE_TREE } }),
                ),
            )
            .with_key(MODE),
            UiNode::button(
                Text::key(if sort == SORT_COUNT {
                    SORT_COUNT_LABEL
                } else {
                    SORT_NAME_LABEL
                }),
                Intent::Neutral,
                ActionRef::with(
                    SORT,
                    serde_json::json!({ SORT_KEY: if sort == SORT_COUNT { SORT_NAME } else { SORT_COUNT } }),
                ),
            )
            .with_key(SORT),
        ],
    );

    let selection_row = if selection.is_empty() {
        UiNode::separator()
    } else {
        UiNode::row(
            2,
            vec![
                UiNode::text(Text::message(
                    SELECTED_LABEL,
                    vec![Arg::int("n", selection.len() as i64)],
                )),
                UiNode::button(
                    Text::key(SEARCH_SELECTED_LABEL),
                    Intent::Primary,
                    ActionRef::new(SEARCH_SELECTED),
                )
                .with_key(SEARCH_SELECTED),
                UiNode::button(
                    Text::key(CLEAR_SELECTION_LABEL),
                    Intent::Neutral,
                    ActionRef::new(CLEAR_SELECTION),
                )
                .with_key(CLEAR_SELECTION),
            ],
        )
    };

    let body = if visible.is_empty() {
        UiNode::empty_state(Text::key(if tags.is_empty() { EMPTY } else { NO_MATCH }))
    } else if mode == MODE_TREE {
        tree_body(&visible, selection)
    } else {
        flat_body(&visible, selection)
    };

    UiNode::column(4, vec![field, controls, selection_row, body])
}

/// L'elenco piatto di sempre, con la spunta di selezione su ogni riga: il
/// titolo porta `#nome` e il conteggio, e due azioni distinte — cercare il
/// singolo tag ([`SEARCH`]) o aggiungerlo alla selezione ([`SELECT`]) — perché
/// sono due gesti diversi e fonderli vorrebbe dire che spuntare cerca.
fn flat_body(visible: &[&TagCount], selection: &[String]) -> UiNode {
    UiNode::list(
        visible
            .iter()
            .map(|t| {
                let selected = selection.iter().any(|s| s == &t.name);
                UiNode::row(
                    1,
                    vec![
                        UiNode::list_item(
                            format!("#{}", t.name),
                            Some(Text::from(t.count.to_string())),
                            Some(ActionRef::with(SEARCH, serde_json::json!({ TAG: t.name }))),
                        )
                        .with_key(t.name.clone()),
                        UiNode::button(
                            Text::from(if selected { "[x]" } else { "[ ]" }),
                            Intent::Neutral,
                            ActionRef::with(SELECT, serde_json::json!({ TAG: t.name })),
                        )
                        .with_key(format!("select:{}", t.name)),
                    ],
                )
                .with_key(t.name.clone())
            })
            .collect(),
    )
}

/// La vista ad albero: `a/b/c` sotto `a/b` sotto `a`, con i conteggi del
/// kernel alle foglie e i rami come intestazioni non cliccabili. I rami non
/// cercano niente — cercare `a` è un gesto sul tag `a`, non sul prefisso che
/// lo contiene — e i tag senza `/` restano voci piatte: un albero con una sola
/// radice per voce è l'elenco di prima con un'altra indentazione.
fn tree_body(visible: &[&TagCount], selection: &[String]) -> UiNode {
    UiNode::new(UiKind::Tree {
        roots: tree_roots(visible, selection),
    })
}

/// Le radici dell'albero: raggruppa per primo segmento, ordina per nome dentro
/// ogni livello (l'ordine del kernel, non un secondo ranking), e mantiene la
/// selezione anche qui — spuntare da una vista e cercare dall'altra non deve
/// perdere il gesto.
fn tree_roots(visible: &[&TagCount], selection: &[String]) -> Vec<UiNode> {
    use std::collections::BTreeMap;
    let mut roots: BTreeMap<String, Vec<&TagCount>> = BTreeMap::new();
    let mut plain: Vec<&TagCount> = Vec::new();
    for tag in visible {
        match tag.name.split_once('/') {
            Some((head, _)) => roots.entry(head.to_string()).or_default().push(*tag),
            None => plain.push(*tag),
        }
    }
    let mut out: Vec<UiNode> = Vec::new();
    for tag in plain {
        out.push(tag_leaf(tag, selection));
    }
    for (head, leaves) in roots {
        let children: Vec<UiNode> = leaves.iter().map(|t| tag_leaf(t, selection)).collect();
        out.push(
            UiNode::new(UiKind::TreeItem {
                label: Text::from(head.clone()),
                expanded: true,
                action: None,
                selected: false,
                children,
            })
            .with_key(format!("tree:{head}")),
        );
    }
    out
}

/// Una foglia dell'albero: la stessa riga della vista piatta (cerca + spunta),
/// dentro un `TreeItem` senza figli così la chiave resta il nome intero.
fn tag_leaf(tag: &TagCount, selection: &[String]) -> UiNode {
    let selected = selection.iter().any(|s| s == &tag.name);
    UiNode::new(UiKind::TreeItem {
        label: Text::from(format!("#{} ({})", tag.name, tag.count)),
        expanded: true,
        action: Some(ActionRef::with(
            SEARCH,
            serde_json::json!({ TAG: tag.name }),
        )),
        selected,
        children: vec![UiNode::button(
            Text::from(if selected { "[x]" } else { "[ ]" }),
            Intent::Neutral,
            ActionRef::with(SELECT, serde_json::json!({ TAG: tag.name })),
        )
        .with_key(format!("select:{}", tag.name))],
    })
    .with_key(tag.name.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::query::QueryPredicate;
    use fub_abi::traits::{ViewStateRead, ViewStateWrite};
    use fub_sdk::testing::MemoryHost;

    fn tag(name: &str, count: u32) -> TagCount {
        TagCount {
            name: name.into(),
            count,
        }
    }

    /// I titoli delle voci, in ordine.
    fn entries(tree: &UiNode) -> Vec<String> {
        fn walk(node: &UiNode, out: &mut Vec<String>) {
            match &node.kind {
                UiKind::ListItem { title, .. } => out.push(title.to_string()),
                UiKind::Stack { children, .. } => children.iter().for_each(|c| walk(c, out)),
                UiKind::List { items } => items.iter().for_each(|c| walk(c, out)),
                UiKind::Row { cells, .. } => cells.iter().for_each(|c| walk(c, out)),
                _ => {}
            }
        }
        let mut out = Vec::new();
        walk(tree, &mut out);
        out
    }

    #[test]
    fn empty_shows_placeholder_and_keeps_the_filter_field() {
        let tree = build_tags_view(&[], "");
        let UiKind::Stack { children, .. } = &tree.kind else {
            panic!("stack")
        };
        assert!(matches!(&children[0].kind, UiKind::TextInput { .. }));
        assert!(matches!(&children[1].kind, UiKind::EmptyState { .. }));
    }

    #[test]
    fn lists_tags_with_counts_and_search_payloads() {
        let tags = [tag("rust", 3), tag("a/b", 1)];
        let json = serde_json::to_string(&build_tags_view(&tags, "")).unwrap();
        assert!(json.contains("#rust"));
        assert!(json.contains("#a/b"));
        assert!(json.contains(r#""tag":"rust""#));
        assert!(!json.contains("tag:rust"), "l'id non porta più il nome");
    }

    #[test]
    fn render_asks_the_host_for_the_vault_tags() {
        let host = MemoryHost::new().with_tags(&[("rust", 2), ("note", 5)]);
        let tree = TagPanelView
            .render_view(&ViewInstance::only(TAGS_VIEW), &host)
            .unwrap();
        assert_eq!(entries(&tree), ["#rust", "#note"]);
    }

    #[test]
    fn clicking_a_tag_asks_for_a_search() {
        let mut host = MemoryHost::new();
        let update = TagPanelView
            .on_action(
                &ViewInstance::only(TAGS_VIEW),
                UiAction::new(SEARCH).with_payload(serde_json::json!({TAG: "rust"})),
                &mut host,
            )
            .unwrap();
        let ViewUpdate::RunSearch { query } = update else {
            panic!("search");
        };
        assert_eq!(query, "tag:rust");
        assert_eq!(
            fub_abi::rules::search_syntax::parse(&query, false).unwrap(),
            QueryExpr::of(QueryPredicate::Tag {
                name: "rust".into(),
                descendants: true,
            })
        );
    }

    /// Digita `text` nel campo filtro e torna l'albero ridisegnato.
    fn type_text(view: &mut TagPanelView, host: &mut MemoryHost, text: &str) -> UiNode {
        let update = view
            .on_action(
                &ViewInstance::only(TAGS_VIEW),
                UiAction::new(FILTER).with_fields(vec![fub_abi::ui::FieldValue {
                    field: FILTER_FIELD.into(),
                    value: fub_abi::ui::UiValue::Text(text.into()),
                }]),
                host,
            )
            .unwrap();
        let ViewUpdate::Replace { root } = update else {
            panic!("filtrare ridisegna")
        };
        root
    }

    /// Il valore mostrato dal campo di testo.
    fn field(tree: &UiNode) -> String {
        let UiKind::Stack { children, .. } = &tree.kind else {
            panic!("stack")
        };
        let UiKind::TextInput { value, .. } = &children[0].kind else {
            panic!("il primo figlio è il campo")
        };
        value.clone()
    }

    /// Il collaudo del §2.4, ora sullo stato di vista: ciò che si digita
    /// sopravvive al ridisegno.
    #[test]
    fn the_filter_survives_between_two_renders() {
        let mut host = MemoryHost::new()
            .with_tags(&[("rust", 2), ("ruggine", 1), ("note", 5)])
            .with_instance("uno");
        let mut view = TagPanelView;
        let instance = ViewInstance::only(TAGS_VIEW);

        assert_eq!(entries(&type_text(&mut view, &mut host, "rus")), ["#rust"]);

        // Il ridisegno che arriva dopo — un `IndexUpdated`, un cambio di nota —
        // non riparte da zero: il filtro è dove l'utente lo ha lasciato.
        let tree = view.render_view(&instance, &host).unwrap();
        assert_eq!(entries(&tree), ["#rust"]);
        assert_eq!(field(&tree), "rus", "the field shows what was typed");
    }

    /// Il guadagno del §11.2, e la ragione per cui la chiave porta l'esemplare:
    /// due pannelli aperti sullo stesso vault hanno **due filtri**. Col filtro in
    /// un campo del provider — che è uno solo — questa prova non poteva passare.
    #[test]
    fn two_instances_of_the_panel_filter_apart() {
        let mut host = MemoryHost::new()
            .with_tags(&[("rust", 2), ("note", 5)])
            .with_instance("uno");
        let mut view = TagPanelView;
        let instance = ViewInstance::only(TAGS_VIEW);

        assert_eq!(entries(&type_text(&mut view, &mut host, "rus")), ["#rust"]);

        // Lo stesso pannello, aperto una seconda volta: il filtro dell'altro non
        // è suo.
        host.switch_to_instance("due");
        let tree = view.render_view(&instance, &host).unwrap();
        assert_eq!(entries(&tree), ["#rust", "#note"]);
        assert_eq!(field(&tree), "");

        // …e filtrare qui non tocca quello di là.
        assert_eq!(entries(&type_text(&mut view, &mut host, "not")), ["#note"]);
        host.switch_to_instance("uno");
        assert_eq!(
            entries(&view.render_view(&instance, &host).unwrap()),
            ["#rust"],
            "the first instance still has its own"
        );
    }

    /// Un filtro ripulito **dimentica** la chiave invece di scriverci `""`: è
    /// ciò che «nessun filtro» significa, e tiene il file dalla parte di chi lo
    /// pota. Provata dal di fuori — dal comportamento — perché il posto in cui
    /// finisce è dell'host.
    #[test]
    fn clearing_the_filter_forgets_it() {
        let mut host = MemoryHost::new()
            .with_tags(&[("rust", 2), ("note", 5)])
            .with_instance("uno");
        let mut view = TagPanelView;
        type_text(&mut view, &mut host, "rus");
        assert_eq!(
            entries(&type_text(&mut view, &mut host, "")),
            ["#rust", "#note"]
        );
        assert_eq!(host.view_state(FILTER_STATE).unwrap(), None);
    }

    /// Fuori da un esemplare **non si scrive**: il pannello dice che non ha
    /// ricordato, invece di far credere all'utente che il filtro sia salvo.
    #[test]
    fn filtering_outside_an_instance_says_so() {
        let mut host = MemoryHost::new().with_tags(&[("rust", 2)]);
        let and = TagPanelView
            .on_action(
                &ViewInstance::only(TAGS_VIEW),
                UiAction::new(FILTER).with_fields(vec![fub_abi::ui::FieldValue {
                    field: FILTER_FIELD.into(),
                    value: fub_abi::ui::UiValue::Text("rus".into()),
                }]),
                &mut host,
            )
            .expect_err("no instance, no view state");
        assert!(matches!(and, PluginError::BadArgs(_)), "{and:?}");
    }

    /// Un valore scritto a mano che non è una stringa non fa cadere il pannello:
    /// il file si apre con un editor di testo, ed è una promessa che si mantiene
    /// anche quando qualcuno ci scrive dentro una sciocchezza.
    #[test]
    fn a_filter_that_is_not_a_string_reads_as_empty() {
        let mut host = MemoryHost::new()
            .with_tags(&[("rust", 2), ("note", 5)])
            .with_instance("uno");
        host.set_view_state(FILTER_STATE, Some(serde_json::json!(42)))
            .unwrap();
        let tree = TagPanelView
            .render_view(&ViewInstance::only(TAGS_VIEW), &host)
            .unwrap();
        assert_eq!(entries(&tree), ["#rust", "#note"]);
    }

    /// **Il presidio della corsia ASCII.** Il filtro ignora il caso: `#Rust` si
    /// trova scrivendo `RUS`, e `#Città` scrivendo `città` — con l'accento, che
    /// è la lettera che l'utente ha davvero digitato.
    ///
    /// *Era verde anche prima della corsia ASCII*, ed è il punto: presidia la
    /// risposta, che il taglio delle allocazioni non doveva toccare. Quello che
    /// **non** era verde prima è il conteggio, e sta in
    /// `tests/il_filtro_non_alloca.rs`.
    #[test]
    fn the_filter_ignores_the_case() {
        let tags = [
            tag("Rust", 1),
            tag("progetto/Città", 2),
            tag("NOTE", 3),
            tag("altro", 4),
        ];
        for (filter, expected) in [
            ("RUS", vec!["#Rust"]),
            ("rust", vec!["#Rust"]),
            ("città", vec!["#progetto/Città"]),
            ("CITTÀ", vec!["#progetto/Città"]),
            ("note", vec!["#NOTE"]),
            ("O", vec!["#progetto/Città", "#NOTE", "#altro"]),
        ] {
            assert_eq!(
                entries(&build_tags_view(&tags, filter)),
                expected,
                "{filter:?}"
            );
        }
    }

    /// **Il presidio che la corsia ASCII non diventi un confronto carattere per
    /// carattere.** `"ΟΔΟΣ".to_lowercase()` è `"οδος"` — con il sigma finale —
    /// mentre `chars().flat_map(char::to_lowercase)` dà `"οδοσ"`: il caso è
    /// sensibile al contesto, ed è la stessa forma del difetto 0070 su
    /// `prefix_len_ci`. Chi un giorno «finisse il lavoro» estendendo la corsia
    /// veloce fuori dall'ASCII fa cadere questo test.
    ///
    /// *Provato in rosso* sostituendo il corpo di `contiene_a_meno_del_caso` con
    /// la versione carattere per carattere: la prima riga fallisce.
    #[test]
    fn outside_from_ascii_the_case_remains_that_of_to_lowercase() {
        let tags = [tag("ΟΔΟΣ", 1)];
        assert_eq!(
            entries(&build_tags_view(&tags, "οδος")),
            ["#ΟΔΟΣ"],
            "the final lowercase sigma is ς, and searching the whole word finds the tag"
        );
        assert!(
            entries(&build_tags_view(&tags, "οδοσ")).is_empty(),
            "the non-final sigma is not what `to_lowercase` produces at the end"
        );
        assert_eq!(
            entries(&build_tags_view(&tags, "οδο")),
            ["#ΟΔΟΣ"],
            "and the prefix, which has no sigma, is found anyway"
        );
    }

    /// Un ago fuori dall'ASCII non combacia dentro un nome ASCII, e non gli
    /// serve un caso a parte: nessun byte sopra `0x7F` è un byte ASCII.
    #[test]
    fn a_filter_accented_not_finds_a_tag_ascii() {
        assert!(entries(&build_tags_view(&[tag("citta", 1)], "città")).is_empty());
    }

    /// Un filtro che non trova niente non fa sparire il campo: senza, cancellare
    /// l'ultima lettera sarebbe impossibile.
    #[test]
    fn a_filter_that_matches_nothing_keeps_the_field() {
        let tree = build_tags_view(&[tag("rust", 1)], "zzz");
        let UiKind::Stack { children, .. } = &tree.kind else {
            panic!("stack")
        };
        assert!(matches!(&children[0].kind, UiKind::TextInput { .. }));
        assert!(matches!(&children[1].kind, UiKind::EmptyState { .. }));
    }
}
#[cfg(test)]
mod presentation_tests {
    use super::*;
    use fub_abi::query::QueryPredicate;
    use fub_abi::traits::ViewStateWrite;

    fn tag(name: &str, count: u32) -> TagCount {
        TagCount {
            name: name.into(),
            count,
        }
    }

    fn titles(tree: &UiNode) -> Vec<String> {
        fn walk(node: &UiNode, out: &mut Vec<String>) {
            match &node.kind {
                UiKind::ListItem { title, .. } => out.push(title.to_string()),
                UiKind::TreeItem {
                    label, children, ..
                } => {
                    out.push(label.to_string());
                    children.iter().for_each(|c| walk(c, out));
                }
                UiKind::Stack { children, .. } => children.iter().for_each(|c| walk(c, out)),
                UiKind::List { items } => items.iter().for_each(|c| walk(c, out)),
                UiKind::Tree { roots } => roots.iter().for_each(|c| walk(c, out)),
                _ => {}
            }
        }
        let mut out = Vec::new();
        walk(tree, &mut out);
        out
    }
    #[test]
    fn flat_stays_compatible_with_the_old_builder() {
        let tags = [tag("rust", 3), tag("a/b", 1)];
        let old = build_tags_view(&tags, "");
        let flat = build_tags_tree(&tags, "", MODE_FLAT, SORT_NAME, &[]);
        // La vista estesa aggiunge controlli e selezione: i titoli delle voci
        // restano gli stessi, in testa c'è di più.
        let titles_old = titles(&old);
        let titles_flat = titles(&flat);
        assert!(titles_flat.len() >= titles_old.len(), "{titles_flat:?}");
        for title in titles_old {
            assert!(
                titles_flat.contains(&title),
                "{title} sparito da {titles_flat:?}"
            );
        }
    }

    #[test]
    fn sort_by_count_breaks_ties_by_name() {
        let tags = [tag("b", 1), tag("a", 1), tag("c", 5)];
        let tree = build_tags_tree(&tags, "", MODE_FLAT, SORT_COUNT, &[]);
        let got = titles(&tree);
        assert!(got.iter().any(|t| t.contains("#c")), "{got:?}");
        let first = got.iter().position(|t| t.contains("#c")).unwrap();
        let second = got.iter().position(|t| t.contains("#a")).unwrap();
        let third = got.iter().position(|t| t.contains("#b")).unwrap();
        assert!(first < second && second < third, "{got:?}");
    }

    #[test]
    fn tree_groups_by_first_segment_and_keeps_plain_tags_flat() {
        let tags = [tag("a/b", 1), tag("a/c", 2), tag("solo", 3)];
        let tree = build_tags_tree(&tags, "", MODE_TREE, SORT_NAME, &[]);
        let got = titles(&tree);
        assert!(got.iter().any(|t| t == "a"), "{got:?}");
        assert!(got.iter().any(|t| t.contains("#a/b")), "{got:?}");
        assert!(got.iter().any(|t| t.contains("#solo")), "{got:?}");
    }

    #[test]
    fn selection_query_is_a_conjunction_of_tag_operators() {
        let query = selection_query(&["rust".into(), "a/b".into()]);
        assert_eq!(query, "tag:rust tag:a/b");
        let expr = fub_abi::rules::search_syntax::parse(&query, false).unwrap();
        assert_eq!(expr.any.len(), 1);
        assert_eq!(expr.any[0].all.len(), 2);
        assert_eq!(
            expr.any[0].all[1].predicate,
            QueryPredicate::Tag {
                name: "a/b".into(),
                descendants: true,
            }
        );
    }

    #[test]
    fn null_and_garbage_view_state_reads_as_defaults() {
        let mut host = fub_sdk::testing::MemoryHost::new()
            .with_tags(&[("rust", 2)])
            .with_instance("uno");
        host.set_view_state(MODE_STATE, Some(serde_json::json!(42)))
            .unwrap();
        host.set_view_state(SORT_STATE, Some(serde_json::json!({"no": true})))
            .unwrap();
        host.set_view_state(SELECTION_STATE, Some(serde_json::json!("rust")))
            .unwrap();
        assert_eq!(mode_of(&host).unwrap(), MODE_FLAT);
        assert_eq!(sort_of(&host).unwrap(), SORT_NAME);
        assert!(selection_of(&host).unwrap().is_empty());
    }
}
