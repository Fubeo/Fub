//! # Le regole del contratto, in un posto solo
//!
//! Una **regola** è la parte di una risposta che non dipende da chi la dà: come
//! si confrontano due `PropertyValue`, dove ordina chi non ha la chiave, quando
//! un path relativo diventa un `DocId`, cosa conta come link rotto, quale tag
//! sta sotto quale. Sono la risposta a domande che il contratto pone — la
//! risposta a [`IndexQuery::Documents`] è la stessa domanda per chiunque la
//! serva — e finché vivevano in moduli privati del kernel c'era **un posto
//! solo** soltanto finché l'implementazione era una.
//!
//! Da qui in avanti non lo è più: la decisione 0019 ha aperto il canale dati a
//! indici di terzi, e un indice di terzi non ha `fub-kernel` fra le mani —
//! `fub-features` non ci dipende *per invariante*, e un guest WASM a M5
//! nemmeno. Il secondo che rifacesse queste funzioni risponderebbe diversamente
//! alla stessa query, e la differenza non la vedrebbe nessun test, perché i due
//! non si confrontano mai.
//!
//! Stanno in `fub-abi` e non nell'SDK perché l'SDK è comodo ma facoltativo, e
//! una regola facoltativa non è una regola: chi vuole essere d'accordo col
//! kernel non deve dover adottare anche un toolkit. È lo stesso spostamento che
//! la decisione 0003 aveva fatto per `heading_slug` e `canonical_tag` — da
//! funzioni private del provider markdown a funzioni del contratto — applicato
//! al kernel invece che a un provider.
//!
//! ## La mappa
//!
//! - [`ids`] — **di chi è un id**: la regola dei namespace, per tutti e otto
//!   gli spazi di nomi del contratto (§7.4);
//! - [`doc_data`] — **dove sta ciò che è attaccato a una nota**: il prefisso
//!   che il kernel migra al rename e raccoglie alla cancellazione (§13.2);
//! - [`events`] — **chi riceve cosa**: la maschera di un abbonamento, col
//!   prefisso di topic e il soggetto (§10.1), e **cosa resta sopra il tetto**
//!   quando un canale è pieno (§20.5);
//! - [`media`] — **che specie di file è**: documento, allegato o ignoto, e che
//!   tipo di contenuto porta (§14.1);
//! - [`path`] — la chiave di risoluzione (trim, NFC, minuscolo), i link
//!   markdown relativi, il percent-encoding;
//! - [`path_policy`] — **quali nomi** un vault può far nascere, che è una
//!   domanda diversa da quali ne contiene (§15.5);
//! - [`text_policy`] — **che forma hanno i byte** di un file: BOM, terminatori
//!   di riga, UTF-8. Rileva e dichiara, non converte (§15.5);
//! - [`properties`] — filtro, ordinamento e faccette sul frontmatter;
//! - [`tag`] — la gerarchia dei tag, accanto alla forma canonica del nome;
//! - [`health`] — cosa conta come link rotto, e cosa no.
//!
//! Le regole che erano **già** nel contratto restano dove sono e si raggiungono
//! anche da qui, perché il posto in cui si cerca «la regola X» dev'essere uno:
//! [`canonical_tag`], [`canonical_anchor`], [`valid_anchor`], [`heading_slug`] e
//! il metodo [`DocId::page_name`](crate::model::DocId::page_name).
//!
//! ## Ciò che NON è una regola condivisa
//!
//! L'**ordine di presentazione**. Il kernel ordina per `DocId` — ordine di
//! byte — e non è una scelta estetica: una risposta paginata che cambiasse
//! ordine fra una pagina e l'altra ripeterebbe e salterebbe righe, quindi
//! serve un ordine **totale, stabile e calcolabile senza un locale**. La
//! sidebar ordina con un collatore italiano (`Intl.Collator`), che è l'ordine
//! di lettura di un umano e dipende dalla lingua di chi guarda. Non sono due
//! copie della stessa regola: sono **due requisiti che devono divergere**, e
//! una fixture che li legasse nascerebbe rossa e resterebbe rossa. Chi vuole
//! l'ordine dell'umano lo chiede a chi conosce l'umano — cioè alla shell, dopo
//! aver ricevuto la pagina.
//!
//! [`IndexQuery::Documents`]: crate::traits::IndexQuery::Documents

pub mod doc_data;
pub mod events;
pub mod health;
pub mod ids;
pub mod media;
pub mod path;
pub mod path_policy;
pub mod properties;
pub mod tag;
pub mod text_policy;

pub use crate::model::{canonical_anchor, canonical_tag, heading_slug, valid_anchor};
