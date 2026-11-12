//! Il job: il varco per il lavoro lungo (`JobSpec`, `JobId`, `JobProgress`, `JobStatus`).

use super::*;

// ---------------------------------------------------------------------------
// Job: il varco per il lavoro lungo. Le chiamate dei trait sono sincrone e
// devono restare brevi (a M5 una deadline le tronca); tutto ciò che è lento —
// rete, calcolo pesante, camminare il vault intero — passa da qui e gira FUORI
// dal giro sincrono del kernel. Vedi ../../../docs/architecture/plugin-runtime.md,
// "Lavoro lungo: i job".
// ---------------------------------------------------------------------------

/// Richiesta di lavoro in background. `job` è il nome dell'entry point del
/// plugin ([`Plugin::run_job`]); `payload` porta i suoi **argomenti** — quale
/// cartella esportare, quale URL importare — non il suo input.
///
/// Fino alla decisione 0027 portava anche l'input, e non per scelta: dentro al
/// job non c'era `HostApi`, quindi tutto ciò che il job avrebbe letto doveva
/// leggerlo il **chiamante**, nel giro sincrono, e passarglielo qui dentro. Un
/// export del vault intero era un `payload` grande quanto il vault, letto in
/// esclusiva sul workspace: cioè il lavoro lungo fatto esattamente dove il job
/// serviva a non farlo. Adesso il vault il job se lo legge da sé
/// ([`Plugin::run_job`]), e qui restano gli argomenti.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct JobSpec {
    pub job: String,
    pub payload: serde_json::Value,
}

/// Identità di un job lanciato: chi lo lancia la conserva e riconosce il
/// proprio esito in [`Event::JobDone`](crate::Event::JobDone).
///
/// Sul confine JSON (IPC verso il frontend) viaggia come **stringa**: è un
/// u64 pieno usato come identità, e `JSON.parse` perde i bit oltre 2⁵³ in
/// silenzio — vedi la regola in [`crate::ipc`]. Nel WIT resta `u64` nativo,
/// che non ha il problema.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct JobId(pub u64);

impl Serialize for JobId {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        crate::ipc::u64_string::serialize(&self.0, s)
    }
}

impl<'de> Deserialize<'de> for JobId {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        crate::ipc::u64_string::deserialize(d).map(JobId)
    }
}

/// **A che punto è** un lavoro lungo (§10.3, decisione 0035).
///
/// Un record solo, e lo usano tutti e due i modi di sapere a che punto è un
/// job: l'evento [`Event::JobProgress`](crate::Event::JobProgress) — che lo dice
/// quando cambia — e [`JobStatus`] — che lo dice a chi arriva dopo e chiede.
/// Due definizioni di "progresso" sarebbero due idee di cosa mostrare, e la
/// seconda si accorgerebbe di essere diversa dalla prima solo davanti
/// all'utente.
///
/// Non c'è nessun campo che dica «finito»: un job finisce con
/// [`Event::JobDone`](crate::Event::JobDone), che porta l'esito, ed è l'unica
/// cosa che vuol dire finire. Un `done == total` è una barra piena, non un
/// lavoro concluso.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct JobProgress {
    /// Quante unità sono state fatte. Cosa sia un'unità lo decide il job: note
    /// esportate, byte scaricati, file letti.
    pub done: u64,
    /// Quante ne saranno in tutto, **se il job lo sa**. Assente = indeterminato,
    /// che è un caso vero (uno scaricamento senza `Content-Length`, una
    /// scansione che non ha ancora finito di contare) e non un dato mancante:
    /// chi disegna mostra un'attesa senza barra invece di una barra che mente.
    pub total: Option<u64>,
    /// Cosa sta facendo adesso, per chi guarda: «esportando `Diario/2026.md`».
    ///
    /// È prosa composta dal job, come [`VaultStatus::last_sync_error`] e come il
    /// messaggio di un [`PluginError`]: quando il §12.1 dirà come si localizza
    /// una stringa al confine, lo dirà anche per questa.
    pub label: Option<String>,
}

/// Un lavoro lungo **vivo**: la risposta a [`IndexQuery::Jobs`] (§10.3).
///
/// «Vivo» va dal momento in cui il job è stato accettato
/// ([`Event::JobStarted`](crate::Event::JobStarted)) a quello in cui ne è
/// tornato l'esito ([`Event::JobDone`](crate::Event::JobDone)): comprende quindi
/// anche i job che aspettano un thread libero, ed è deliberato — un job in coda
/// si annulla come uno in volo (decisione 0032), quindi chi guarda deve poterlo
/// vedere per poterlo fermare.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct JobStatus {
    pub id: JobId,
    /// Il nome dell'entry point (`JobSpec::job`).
    pub job: String,
    /// Chi lo ha chiesto, e con le cui capacità gira.
    pub plugin: String,
    /// Quando è stato accettato, in millisecondi dall'epoca UNIX: è ciò che
    /// permette a chi guarda di dire «da tre minuti» senza tenere un cronometro
    /// per ogni riga.
    pub since: u64,
    /// L'ultimo progresso riferito, se il job ne ha riferito uno. Assente non
    /// vuol dire fermo: vuol dire che quel job non racconta.
    pub progress: Option<JobProgress>,
}
