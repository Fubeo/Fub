//! Il percorso di disegno della webview su Linux (`appearance.rendering`).
//!
//! WebKitGTK sceglie da solo come disegnare, e alcune variabili d'ambiente lo
//! cambiano, ma contano solo se sono scritte **prima che parta GTK**. Qui si
//! fa quel lavoro in tre passi, tutti all'inizio di [`crate::run`]:
//!
//! 1. [`leggi`] guarda solo `/proc`, `/sys`, le cartelle delle librerie e
//!    l'ambiente, e compone una [`Diagnosi`]: la sessione (Wayland o X11), la
//!    scheda primaria, la versione del modulo NVIDIA contro quella delle sue
//!    librerie, se il disegno sarà quasi certamente software (llvmpipe);
//! 2. [`scegli`] applica la tabella dei casi: quali variabili scrivere e quali
//!    avvisi dare alla shell;
//! 3. [`applica`] scrive le variabili, solo quelle che l'utente non ha già
//!    messo.
//!
//! # La tabella dei casi
//!
//! Decisa dalle misure del 16-11-2026 sul PC fisso (Debian 13, niri, RTX 4070,
//! WebKitGTK 2.54, driver disallineato e quindi llvmpipe):
//!
//! | modo | caso | variabili | avviso |
//! |---|---|---|---|
//! | qualunque | modulo NVIDIA ≠ librerie NVIDIA, NVIDIA primaria | nessuna | «riavvia il computer» |
//! | `auto` | NVIDIA < 555 primaria, sotto Wayland, driver allineato, nessuna variabile dell'utente | nessuna | proposta: disegno col processore, movimento calmo |
//! | `auto`, `gpu` | NVIDIA ≥ 555 primaria, sotto Wayland, driver allineato, nessuna variabile dell'utente | `WEBKIT_FORCE_DMABUF_RENDERER=1` e, se l'utente non l'ha messa, `GDK_RENDERING=recording` | nessuno |
//! | `auto`, `gpu` | WebKitGTK dalla 2.53.0 alla 2.54.1, nessuna variabile dell'utente | `WEBKIT_USE_SKIA_FOR_COMPOSITION=0` | nessuno |
//! | `auto` | ogni altro caso (X11, AMD, Intel, VM, nessuna GPU) | nessuna | nessuno |
//! | `gpu` | ogni altro caso | nessuna | solo quello del driver disallineato |
//! | `cpu` | qualunque | `WEBKIT_SKIA_ENABLE_CPU_RENDERING=1`, se l'utente non l'ha messa | solo quello del driver disallineato |
//!
//! Perché `auto` non sceglie il renderer: col disegno software (llvmpipe)
//! Skia CPU è pari al default di WebKit a PC scarico e peggiore sotto carico,
//! e dove la GPU funziona il default è il percorso migliore. Sotto NVIDIA <
//! 555 su Wayland Skia CPU dà più fotogrammi ma lo sfarfallio resta, e
//! l'utente ha scelto che Fub lo **proponga** invece di farlo da solo. Per le
//! VM senza 3D non ci sono misure, e senza misure non si cambia il percorso di
//! nessuno.
//!
//! Le variabili che Fub scrive da sé correggono difetti misurati, senza
//! cambiare renderer:
//!
//! - `WEBKIT_FORCE_DMABUF_RENDERER=1` (misure del 19-11-2026, RTX 4070, 595,
//!   niri): la patch NVIDIA di Debian (`disable-nvidia-dmabuf.patch`) fa
//!   passare ogni fotogramma dalla memoria condivisa, una copia dalla scheda
//!   per fotogramma, e la pagina resta fra 42 e 58 fotogrammi al secondo su
//!   uno schermo a 180 Hz. Con la variabile i fotogrammi restano sulla scheda
//!   e, con l'orologio di GTK allo schermo ([`crate::orologio`]), arrivano a
//!   178. Dove la patch non c'è (la WebKitGTK di webkitgtk.org, il Flatpak)
//!   la variabile non esiste e non cambia niente. Solo dal 555, il primo con
//!   la sincronizzazione esplicita: prima la patch protegge davvero;
//! - `GDK_RENDERING=recording`, insieme alla precedente (misure del
//!   19-11-2026): nel modo GL GTK3 crea a ogni disegno della finestra
//!   un'immagine grande quanto la finestra, la pulisce, ci dipinge lo sfondo
//!   e poi la butta, anche se la webview copre tutto con GL. A tutto schermo
//!   a scala 2 sono 41 MB a fotogramma, sopra la soglia oltre cui glibc li
//!   chiede al kernel ogni volta: con la pagina che anima il thread
//!   principale stava al 98% di un core, tre quarti nel kernel per i page
//!   fault, e la pagina a 105 fotogrammi al secondo; fermo, al 20–30%. Con
//!   la superficie che registra i comandi si rasterizza solo la parte che
//!   GL non copre: 17% di un core e 172–174 fotogrammi, fermo 1–6%;
//! - `WEBKIT_USE_SKIA_FOR_COMPOSITION=0` (dalla 2.53.0 alla 2.54.1): dopo
//!   un'animazione la composizione di Skia rimette sullo schermo per un
//!   istante pezzi di un fotogramma vecchio, corretto a monte nella 2.54.2.
//!   La composizione di TextureMapper non ha il difetto e non abbassa il
//!   ritmo.
//!
//! **Mai** `WEBKIT_DISABLE_DMABUF_RENDERER` né
//! `WEBKIT_DISABLE_COMPOSITING_MODE`: misurate, sono le peggiori in ogni gesto
//! ([`VIETATE`], e un test lo tiene su ogni combinazione).

use std::path::{Path, PathBuf};

/// Il valore di `appearance.rendering`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Modo {
    Auto,
    Gpu,
    Cpu,
}

impl Modo {
    /// Un valore che non è fra quelli offerti vale `auto`, come per lo schema.
    pub fn da(valore: &str) -> Modo {
        match valore {
            "gpu" => Modo::Gpu,
            "cpu" => Modo::Cpu,
            _ => Modo::Auto,
        }
    }
}

/// Il backend che GTK prenderà.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Sessione {
    Wayland,
    X11,
    Sconosciuta,
}

/// Una scheda video di `/sys/class/drm`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Scheda {
    /// `0x10de` è NVIDIA, `0x1002` AMD, `0x8086` Intel.
    pub vendor: String,
    pub driver: Option<String>,
}

/// Ciò che si sa della macchina prima di GTK.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Diagnosi {
    pub sessione: Sessione,
    /// La scheda d'avvio (`boot_vga`), o la prima se nessuna lo dice.
    pub primaria: Option<Scheda>,
    /// C'è almeno un nodo di resa (`renderD*`): senza, niente GPU utilizzabile.
    pub nodo_di_resa: bool,
    /// La versione del modulo del kernel (`/proc/driver/nvidia/version`).
    pub nvidia_modulo: Option<String>,
    /// Le versioni delle librerie NVIDIA installate (`libEGL_nvidia.so.*`,
    /// `libnvidia-glcore.so.*`), distinte e ordinate.
    pub nvidia_librerie: Vec<String>,
    /// `LIBGL_ALWAYS_SOFTWARE` chiede Mesa software.
    pub software_forzato: bool,
}

/// Il vendor PCI di NVIDIA.
const NVIDIA: &str = "0x10de";

/// I driver DRM che non hanno 3D: con loro WebKit disegna con llvmpipe.
const SENZA_3D: [&str; 5] = ["simpledrm", "bochs-drm", "bochs", "cirrus", "qxl"];

impl Diagnosi {
    /// La scheda che disegna è NVIDIA? Senza `/sys` (un contenitore) vale il
    /// modulo caricato.
    pub fn nvidia_primaria(&self) -> bool {
        match &self.primaria {
            Some(scheda) => scheda.vendor == NVIDIA || scheda.driver.as_deref() == Some("nvidia"),
            None => self.nvidia_modulo.is_some(),
        }
    }

    /// Il modulo del kernel e le librerie NVIDIA hanno versioni diverse: il
    /// driver è stato aggiornato e il computer non è stato riavviato. Torna
    /// `(modulo, librerie)`. Una libreria della versione del modulo basta a
    /// dirle allineate: un resto di una versione vecchia non conta.
    pub fn driver_disallineato(&self) -> Option<(&str, &str)> {
        if !self.nvidia_primaria() {
            return None;
        }
        let modulo = self.nvidia_modulo.as_deref()?;
        let ultima = self.nvidia_librerie.last()?;
        (!self.nvidia_librerie.iter().any(|v| v == modulo)).then_some((modulo, ultima.as_str()))
    }

    /// Il numero principale del modulo NVIDIA (`550` per `550.163.01`).
    pub fn nvidia_principale(&self) -> Option<u32> {
        principale(self.nvidia_modulo.as_deref()?)
    }

    /// NVIDIA prima del 555 sotto Wayland: manca la sincronizzazione esplicita
    /// e le animazioni sfarfallano. Col driver disallineato non vale: disegna
    /// llvmpipe, e dopo il riavvio decide la versione nuova.
    pub fn sfarfallio_nvidia(&self) -> bool {
        self.nvidia_primaria()
            && self.sessione == Sessione::Wayland
            && self.driver_disallineato().is_none()
            && self.nvidia_principale().is_some_and(|v| v < 555)
    }

    /// NVIDIA dal 555 sotto Wayland, col driver allineato: la scheda tiene i
    /// fotogrammi di WebKit senza la copia in memoria condivisa.
    pub fn nvidia_dmabuf(&self) -> bool {
        self.nvidia_primaria()
            && self.sessione == Sessione::Wayland
            && !self.disegno_software()
            && self.nvidia_principale().is_some_and(|v| v >= 555)
    }

    /// Il disegno sarà quasi certamente software (llvmpipe). È una stima prima
    /// di GTK: la prova vera è il renderer del processo web.
    pub fn disegno_software(&self) -> bool {
        self.software_forzato
            || self.driver_disallineato().is_some()
            || !self.nodo_di_resa
            || self
                .primaria
                .as_ref()
                .and_then(|scheda| scheda.driver.as_deref())
                .is_some_and(|driver| SENZA_3D.contains(&driver))
    }
}

/// Le variabili che dicono «l'utente ha già scelto il percorso a mano». Con
/// una di loro Fub non propone niente; le sue proprie le scrive solo se
/// l'utente non le ha già.
pub const VARIABILI_UTENTE: [&str; 8] = [
    "WEBKIT_DISABLE_DMABUF_RENDERER",
    "WEBKIT_SKIA_ENABLE_CPU_RENDERING",
    "WEBKIT_DISABLE_COMPOSITING_MODE",
    "WEBKIT_DMABUF_RENDERER_FORCE_SHM",
    "WEBKIT_FORCE_DMABUF_RENDERER",
    "WEBKIT_USE_SKIA_FOR_COMPOSITION",
    "__NV_DISABLE_EXPLICIT_SYNC",
    "GDK_BACKEND",
];

/// Le variabili che Fub non scrive mai, qualunque sia il caso.
pub const VIETATE: [&str; 2] = [
    "WEBKIT_DISABLE_DMABUF_RENDERER",
    "WEBKIT_DISABLE_COMPOSITING_MODE",
];

const SKIA_CPU: &str = "WEBKIT_SKIA_ENABLE_CPU_RENDERING";

/// I fotogrammi sulla scheda anche dove la patch NVIDIA di Debian li manda in
/// memoria condivisa.
const FORZA_DMABUF: &str = "WEBKIT_FORCE_DMABUF_RENDERER";

/// La composizione con TextureMapper invece che con Skia.
const SKIA_COMPOSIZIONE: &str = "WEBKIT_USE_SKIA_FOR_COMPOSITION";

/// Come GTK3 prepara la superficie di ogni disegno di una finestra. GTK la
/// legge in `gdk_init` (`gdk/gdk.c`): `similar` (di serie), `image` o
/// `recording`.
const PITTURA_GTK: &str = "GDK_RENDERING";

/// La superficie che registra i comandi invece di riempire pixel: nel modo GL
/// GTK3 non alloca e non pulisce più un'immagine grande quanto la finestra a
/// ogni fotogramma.
const PITTURA_REGISTRATA: &str = "recording";

/// **La prima WebKitGTK con i fotogrammi vecchi** della composizione di Skia,
/// e con [`SKIA_DIFETTOSA_FINO_A`] l'unico posto in cui l'intervallo è
/// scritto.
pub const SKIA_DIFETTOSA_DA: (u32, u32, u32) = (2, 53, 0);

/// La prima WebKitGTK corretta, esclusa: la 2.54.2 (il commit di WebKit è
/// in `docs/architecture/desktop-webview.md`).
pub const SKIA_DIFETTOSA_FINO_A: (u32, u32, u32) = (2, 54, 2);

/// La WebKitGTK caricata ha i fotogrammi vecchi della composizione di Skia?
pub fn skia_difettosa(webkit: (u32, u32, u32)) -> bool {
    (SKIA_DIFETTOSA_DA..SKIA_DIFETTOSA_FINO_A).contains(&webkit)
}

/// Un avviso per la shell: viaggia come `Event::Custom` col topic
/// [`TOPIC`], tirato con `session_notice`. La shell lo legge in
/// `apps/client/src/ui/rendering-notice.ts`.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Avviso {
    /// Modulo e librerie NVIDIA di versioni diverse: riavviare.
    DriverMismatch { kernel: String, library: String },
    /// NVIDIA < 555 sotto Wayland: si propone il disegno col processore e,
    /// se non è già calmo, il movimento calmo.
    NvidiaFlicker { driver: String, offer_motion: bool },
}

/// Il topic degli avvisi del percorso di disegno. È del core, quindi nudo.
pub const TOPIC: &str = "rendering";

/// Che cosa fare all'avvio.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Scelta {
    pub variabili: Vec<(&'static str, &'static str)>,
    pub avvisi: Vec<Avviso>,
}

/// La tabella dei casi (vedi l'intestazione del modulo). `webkit` è la
/// versione della WebKitGTK caricata, se si legge; `gia_messa` dice se
/// l'utente ha già una variabile nell'ambiente; `movimento_calmo` se
/// `appearance.motion` toglie già le animazioni.
pub fn scegli(
    modo: Modo,
    diagnosi: &Diagnosi,
    webkit: Option<(u32, u32, u32)>,
    gia_messa: &dyn Fn(&str) -> bool,
    movimento_calmo: bool,
) -> Scelta {
    let mut scelta = Scelta::default();
    if let Some((kernel, library)) = diagnosi.driver_disallineato() {
        scelta.avvisi.push(Avviso::DriverMismatch {
            kernel: kernel.to_owned(),
            library: library.to_owned(),
        });
    }
    match modo {
        Modo::Cpu => {
            if !gia_messa(SKIA_CPU) {
                scelta.variabili.push((SKIA_CPU, "1"));
            }
        }
        Modo::Auto | Modo::Gpu => {
            let scelto_a_mano = VARIABILI_UTENTE.iter().any(|name| gia_messa(name));
            if modo == Modo::Auto && diagnosi.sfarfallio_nvidia() && !scelto_a_mano {
                scelta.avvisi.push(Avviso::NvidiaFlicker {
                    driver: diagnosi.nvidia_modulo.clone().unwrap_or_default(),
                    offer_motion: !movimento_calmo,
                });
            }
            if diagnosi.nvidia_dmabuf() && !scelto_a_mano {
                scelta.variabili.push((FORZA_DMABUF, "1"));
                if !gia_messa(PITTURA_GTK) {
                    scelta.variabili.push((PITTURA_GTK, PITTURA_REGISTRATA));
                }
            }
            if webkit.is_some_and(skia_difettosa) && !scelto_a_mano {
                scelta.variabili.push((SKIA_COMPOSIZIONE, "0"));
            }
        }
    }
    debug_assert!(scelta
        .variabili
        .iter()
        .all(|(name, _)| !VIETATE.contains(name)));
    scelta
}

/// Scrive le variabili scelte nell'ambiente del processo.
///
/// # Quando si può chiamare
///
/// Solo come primo passo di [`crate::run`], chiamata da `main`: in quel punto
/// il processo ha un thread solo (né Tauri, né GTK, né il log, né `tokio`
/// sono partiti), e quindi nessuno legge l'ambiente mentre lo si scrive, che è
/// l'unico pericolo di `set_var` (in Rust 2024 è `unsafe` per questo). Prima
/// di lei si leggono solo file e variabili. WebKitGTK legge queste variabili
/// quando crea il primo contesto, cioè dopo.
pub fn applica(scelta: &Scelta) {
    for (name, value) in &scelta.variabili {
        // SAFETY: vedi sopra, il processo ha un thread solo.
        #[allow(unused_unsafe)]
        unsafe {
            std::env::set_var(name, value);
        }
    }
}

/// Legge la diagnosi. `radice` è `/` nell'app e una cartella finta nei test;
/// `env` legge una variabile d'ambiente.
pub fn leggi(radice: &Path, env: &dyn Fn(&str) -> Option<String>) -> Diagnosi {
    let (primaria, nodo_di_resa) = schede(&radice.join("sys/class/drm"));
    Diagnosi {
        sessione: sessione(env),
        primaria,
        nodo_di_resa,
        nvidia_modulo: std::fs::read_to_string(radice.join("proc/driver/nvidia/version"))
            .ok()
            .and_then(|testo| versione_del_modulo(&testo)),
        nvidia_librerie: librerie_nvidia(radice),
        // I valori veri di `env_var_as_boolean` di Mesa, confrontati come
        // fa Mesa (esatti): un valore che Mesa non riconosce vale falso.
        software_forzato: env("LIBGL_ALWAYS_SOFTWARE")
            .is_some_and(|v| matches!(v.as_str(), "1" | "true" | "y" | "yes")),
    }
}

/// Il backend come lo sceglie GTK3: `GDK_BACKEND` (il primo della lista che
/// conosce), poi Wayland se c'è un display Wayland, poi X11.
fn sessione(env: &dyn Fn(&str) -> Option<String>) -> Sessione {
    let presente = |name: &str| env(name).is_some_and(|v| !v.trim().is_empty());
    if let Some(backend) = env("GDK_BACKEND") {
        for voce in backend.split(',').map(str::trim) {
            match voce {
                "wayland" => return Sessione::Wayland,
                "x11" => return Sessione::X11,
                _ => {}
            }
        }
    }
    if presente("WAYLAND_DISPLAY") {
        return Sessione::Wayland;
    }
    match env("XDG_SESSION_TYPE").as_deref().map(str::trim) {
        Some("wayland") => Sessione::Wayland,
        Some("x11") => Sessione::X11,
        _ if presente("DISPLAY") => Sessione::X11,
        _ => Sessione::Sconosciuta,
    }
}

/// Il primo numero con almeno un punto dopo la parola «Module»:
/// `NVRM version: NVIDIA UNIX x86_64 Kernel Module  550.163.01  Tue Apr …`
/// e `NVRM version: NVIDIA UNIX Open Kernel Module for x86_64  595.112.07 …`.
fn versione_del_modulo(testo: &str) -> Option<String> {
    let riga = testo
        .lines()
        .find(|riga| riga.starts_with("NVRM version"))?;
    let dopo = &riga[riga.find("Module")?..];
    dopo.split_whitespace()
        .find(|parola| e_una_versione(parola))
        .map(str::to_owned)
}

/// `550.163.01`, `595.112.07`, `560.35`: almeno due numeri separati da punti.
fn e_una_versione(parola: &str) -> bool {
    let mut parti = parola.split('.');
    let mut quante = 0;
    for parte in parti.by_ref() {
        if parte.is_empty() || !parte.bytes().all(|b| b.is_ascii_digit()) {
            return false;
        }
        quante += 1;
    }
    quante >= 2
}

fn principale(versione: &str) -> Option<u32> {
    versione.split('.').next()?.parse().ok()
}

/// La scheda primaria e se esiste un nodo di resa.
fn schede(drm: &Path) -> (Option<Scheda>, bool) {
    let Ok(voci) = std::fs::read_dir(drm) else {
        return (None, false);
    };
    let mut nomi: Vec<String> = voci
        .filter_map(|voce| voce.ok()?.file_name().into_string().ok())
        .collect();
    nomi.sort();
    let nodo_di_resa = nomi.iter().any(|nome| nome.starts_with("renderD"));
    let mut prima = None;
    for nome in nomi
        .iter()
        .filter(|nome| nome.starts_with("card") && !nome.contains('-'))
    {
        let device = drm.join(nome).join("device");
        let Ok(vendor) = std::fs::read_to_string(device.join("vendor")) else {
            continue;
        };
        let scheda = Scheda {
            vendor: vendor.trim().to_owned(),
            driver: driver_di(&device),
        };
        let avvio = std::fs::read_to_string(device.join("boot_vga"))
            .is_ok_and(|valore| valore.trim() == "1");
        if avvio {
            return (Some(scheda), nodo_di_resa);
        }
        prima.get_or_insert(scheda);
    }
    (prima, nodo_di_resa)
}

/// Il driver collegato: la riga `DRIVER=` di `uevent`, o il nome del
/// collegamento `driver`.
fn driver_di(device: &Path) -> Option<String> {
    if let Ok(uevent) = std::fs::read_to_string(device.join("uevent")) {
        if let Some(driver) = uevent.lines().find_map(|riga| riga.strip_prefix("DRIVER=")) {
            return Some(driver.trim().to_owned());
        }
    }
    let collegamento = std::fs::read_link(device.join("driver")).ok()?;
    Some(collegamento.file_name()?.to_str()?.to_owned())
}

/// Le cartelle in cui le distro mettono le librerie NVIDIA, relative alla
/// radice. Il Flatpak le mette in `GL/<estensione>/lib`, cercate a parte.
const CARTELLE_LIBRERIE: [&str; 8] = [
    "usr/lib/x86_64-linux-gnu",
    "usr/lib/x86_64-linux-gnu/nvidia/current",
    "usr/lib/aarch64-linux-gnu",
    "usr/lib64",
    "usr/lib64/nvidia",
    "usr/lib",
    "usr/lib/nvidia",
    "usr/local/lib",
];

const PREFISSI_LIBRERIE: [&str; 2] = ["libEGL_nvidia.so.", "libnvidia-glcore.so."];

fn librerie_nvidia(radice: &Path) -> Vec<String> {
    let mut cartelle: Vec<PathBuf> = CARTELLE_LIBRERIE.iter().map(|c| radice.join(c)).collect();
    for arch in [
        "usr/lib/x86_64-linux-gnu/GL",
        "usr/lib/aarch64-linux-gnu/GL",
    ] {
        if let Ok(voci) = std::fs::read_dir(radice.join(arch)) {
            cartelle.extend(voci.filter_map(|voce| Some(voce.ok()?.path().join("lib"))));
        }
    }
    let mut versioni: Vec<String> = cartelle
        .iter()
        .filter_map(|cartella| std::fs::read_dir(cartella).ok())
        .flat_map(|voci| voci.filter_map(|voce| voce.ok()?.file_name().into_string().ok()))
        .filter_map(|nome| {
            let versione = PREFISSI_LIBRERIE
                .iter()
                .find_map(|prefisso| nome.strip_prefix(prefisso))?;
            e_una_versione(versione).then(|| versione.to_owned())
        })
        .collect();
    versioni.sort_by(|a, b| confronta(a, b));
    versioni.dedup();
    versioni
}

/// Confronto numerico, parte per parte: `595.112.07` dopo `560.35.03`.
fn confronta(a: &str, b: &str) -> std::cmp::Ordering {
    let numeri = |v: &str| -> Vec<u64> { v.split('.').filter_map(|p| p.parse().ok()).collect() };
    numeri(a).cmp(&numeri(b))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    /// Una macchina finta: `/proc`, `/sys` e le librerie in una cartella
    /// temporanea, l'ambiente in una mappa.
    struct Macchina {
        radice: tempfile::TempDir,
        env: BTreeMap<&'static str, &'static str>,
    }

    impl Macchina {
        fn nuova() -> Self {
            Macchina {
                radice: tempfile::tempdir().expect("cartella temporanea"),
                env: BTreeMap::new(),
            }
        }

        fn file(self, percorso: &str, testo: &str) -> Self {
            let pieno = self.radice.path().join(percorso);
            std::fs::create_dir_all(pieno.parent().expect("genitore")).expect("cartelle");
            std::fs::write(pieno, testo).expect("file");
            self
        }

        fn scheda(self, nome: &str, vendor: &str, driver: &str, avvio: bool) -> Self {
            let device = format!("sys/class/drm/{nome}/device");
            self.file(&format!("{device}/vendor"), &format!("{vendor}\n"))
                .file(
                    &format!("{device}/uevent"),
                    &format!("DRIVER={driver}\nPCI_CLASS=30000\n"),
                )
                .file(
                    &format!("{device}/boot_vga"),
                    if avvio { "1\n" } else { "0\n" },
                )
        }

        fn nodo(self) -> Self {
            self.file("sys/class/drm/renderD128/dev", "226:128\n")
        }

        fn nvidia(self, modulo: &str, librerie: &str) -> Self {
            self.file(
                "proc/driver/nvidia/version",
                &format!(
                    "NVRM version: NVIDIA UNIX x86_64 Kernel Module  {modulo}  Tue Apr  8 12:41:17 UTC 2025\nGCC version:  gcc version 14.2.0 (Debian 14.2.0-19)\n"
                ),
            )
            .file(&format!("usr/lib/x86_64-linux-gnu/libEGL_nvidia.so.{librerie}"), "")
            .file("usr/lib/x86_64-linux-gnu/libEGL_nvidia.so.0", "")
            .file(&format!("usr/lib/x86_64-linux-gnu/libnvidia-glcore.so.{librerie}"), "")
            .scheda("card0", NVIDIA, "nvidia", true)
            .nodo()
        }

        fn env(mut self, nome: &'static str, valore: &'static str) -> Self {
            self.env.insert(nome, valore);
            self
        }

        fn wayland(self) -> Self {
            self.env("WAYLAND_DISPLAY", "wayland-1")
                .env("XDG_SESSION_TYPE", "wayland")
        }

        fn diagnosi(&self) -> Diagnosi {
            leggi(self.radice.path(), &|nome| {
                self.env.get(nome).map(|v| (*v).to_owned())
            })
        }

        /// La scelta con una WebKitGTK corretta (2.54.2): solo la macchina.
        fn scelta(&self, modo: Modo) -> Scelta {
            self.scelta_con(modo, Some((2, 54, 2)))
        }

        fn scelta_con(&self, modo: Modo, webkit: Option<(u32, u32, u32)>) -> Scelta {
            let env = &self.env;
            scegli(
                modo,
                &self.diagnosi(),
                webkit,
                &|nome| env.contains_key(nome),
                false,
            )
        }
    }

    #[test]
    fn driver_disallineato_come_su_questo_pc() {
        let m = Macchina::nuova()
            .nvidia("550.163.01", "595.112.07")
            .wayland();
        let d = m.diagnosi();
        assert_eq!(d.nvidia_modulo.as_deref(), Some("550.163.01"));
        assert_eq!(d.nvidia_librerie, ["595.112.07"]);
        assert_eq!(d.driver_disallineato(), Some(("550.163.01", "595.112.07")));
        assert!(
            d.disegno_software(),
            "senza librerie giuste disegna llvmpipe"
        );
        assert!(!d.sfarfallio_nvidia(), "prima si riavvia");
        for modo in [Modo::Auto, Modo::Gpu, Modo::Cpu] {
            assert_eq!(
                m.scelta(modo).avvisi,
                [Avviso::DriverMismatch {
                    kernel: "550.163.01".into(),
                    library: "595.112.07".into()
                }],
                "{modo:?}"
            );
        }
        assert!(m.scelta(Modo::Auto).variabili.is_empty());
    }

    #[test]
    fn il_modulo_open_si_legge_e_un_resto_vecchio_non_disallinea() {
        let m = Macchina::nuova()
            .nvidia("560.35.03", "560.35.03")
            .file(
                "proc/driver/nvidia/version",
                "NVRM version: NVIDIA UNIX Open Kernel Module for x86_64  560.35.03  Release Build  (dvs-builder@U16-I3-B03-4-3)\n",
            )
            .file("usr/lib/x86_64-linux-gnu/libnvidia-glcore.so.550.163.01", "");
        let d = m.diagnosi();
        assert_eq!(d.nvidia_modulo.as_deref(), Some("560.35.03"));
        assert_eq!(d.nvidia_librerie, ["550.163.01", "560.35.03"]);
        assert_eq!(d.driver_disallineato(), None);
    }

    #[test]
    fn nvidia_550_sotto_wayland_propone_e_non_cambia_niente() {
        let m = Macchina::nuova()
            .nvidia("550.163.01", "550.163.01")
            .wayland();
        let d = m.diagnosi();
        assert!(d.sfarfallio_nvidia());
        assert!(!d.disegno_software());
        let auto = m.scelta(Modo::Auto);
        assert!(auto.variabili.is_empty(), "propone, non lo fa da solo");
        assert_eq!(
            auto.avvisi,
            [Avviso::NvidiaFlicker {
                driver: "550.163.01".into(),
                offer_motion: true
            }]
        );
        let calmo = scegli(Modo::Auto, &d, None, &|_| false, true);
        assert_eq!(
            calmo.avvisi,
            [Avviso::NvidiaFlicker {
                driver: "550.163.01".into(),
                offer_motion: false
            }]
        );
        assert!(
            m.scelta(Modo::Gpu).avvisi.is_empty(),
            "gpu è una scelta: niente proposte"
        );
        assert_eq!(
            m.scelta(Modo::Cpu),
            Scelta {
                variabili: vec![("WEBKIT_SKIA_ENABLE_CPU_RENDERING", "1")],
                avvisi: vec![]
            }
        );
    }

    #[test]
    fn nvidia_550_sotto_x11_non_sfarfalla() {
        let m = Macchina::nuova()
            .nvidia("550.163.01", "550.163.01")
            .wayland()
            .env("GDK_BACKEND", "x11");
        assert_eq!(m.diagnosi().sessione, Sessione::X11);
        assert!(!m.diagnosi().sfarfallio_nvidia());
        // `GDK_BACKEND` è una scelta dell'utente: niente proposte comunque.
        assert_eq!(m.scelta(Modo::Auto), Scelta::default());
        let x11 = Macchina::nuova()
            .nvidia("550.163.01", "550.163.01")
            .env("XDG_SESSION_TYPE", "x11")
            .env("DISPLAY", ":0");
        assert_eq!(x11.diagnosi().sessione, Sessione::X11);
        assert_eq!(x11.scelta(Modo::Auto), Scelta::default());
    }

    #[test]
    fn nvidia_dal_555_tiene_i_fotogrammi_sulla_scheda() {
        let sulla_scheda = Scelta {
            variabili: vec![
                ("WEBKIT_FORCE_DMABUF_RENDERER", "1"),
                ("GDK_RENDERING", "recording"),
            ],
            avvisi: vec![],
        };
        for versione in ["555.42.02", "560.35.03", "595.112.07"] {
            let m = Macchina::nuova().nvidia(versione, versione).wayland();
            let d = m.diagnosi();
            assert!(!d.sfarfallio_nvidia(), "{versione}: niente proposte");
            assert!(d.nvidia_dmabuf(), "{versione}");
            assert_eq!(m.scelta(Modo::Auto), sulla_scheda, "{versione}");
            assert_eq!(m.scelta(Modo::Gpu), sulla_scheda, "{versione}");
            assert_eq!(
                m.scelta(Modo::Cpu).variabili,
                [("WEBKIT_SKIA_ENABLE_CPU_RENDERING", "1")],
                "{versione}: col processore niente scheda"
            );
        }
        // Prima del 555, sotto X11 e col driver disallineato, no.
        let prima = Macchina::nuova()
            .nvidia("550.163.01", "550.163.01")
            .wayland();
        assert!(!prima.diagnosi().nvidia_dmabuf());
        assert!(prima.scelta(Modo::Gpu).variabili.is_empty());
        let x11 = Macchina::nuova()
            .nvidia("595.112.07", "595.112.07")
            .env("XDG_SESSION_TYPE", "x11")
            .env("DISPLAY", ":0");
        assert_eq!(x11.scelta(Modo::Auto), Scelta::default());
        let disallineato = Macchina::nuova()
            .nvidia("595.112.07", "560.35.03")
            .wayland();
        assert!(!disallineato.diagnosi().nvidia_dmabuf());
        assert!(disallineato.scelta(Modo::Auto).variabili.is_empty());
        // Una variabile dell'utente, anche a 0, vince.
        for nome in VARIABILI_UTENTE {
            let m = Macchina::nuova()
                .nvidia("595.112.07", "595.112.07")
                .wayland()
                .env(nome, "0");
            assert!(m.scelta(Modo::Auto).variabili.is_empty(), "{nome}");
        }
    }

    /// La superficie registrata di GTK va con i fotogrammi sulla scheda, e
    /// solo lì: dove GTK3 disegna la finestra con GL.
    #[test]
    fn la_pittura_registrata_solo_con_i_fotogrammi_sulla_scheda() {
        let pc = Macchina::nuova()
            .nvidia("595.112.07", "595.112.07")
            .wayland();
        for modo in [Modo::Auto, Modo::Gpu] {
            assert!(
                pc.scelta(modo)
                    .variabili
                    .contains(&("GDK_RENDERING", "recording")),
                "{modo:?}"
            );
        }
        assert!(
            !pc.scelta(Modo::Cpu)
                .variabili
                .iter()
                .any(|(n, _)| *n == PITTURA_GTK),
            "col processore GTK non disegna con GL"
        );
        // Il valore dell'utente vince, qualunque sia, e la scheda resta.
        for valore in ["similar", "image", "recording", ""] {
            let utente = Macchina::nuova()
                .nvidia("595.112.07", "595.112.07")
                .wayland()
                .env("GDK_RENDERING", valore);
            assert_eq!(
                utente.scelta(Modo::Auto).variabili,
                [("WEBKIT_FORCE_DMABUF_RENDERER", "1")],
                "{valore:?}"
            );
        }
        // Senza fotogrammi sulla scheda decisi da Fub, niente.
        let senza = [
            Macchina::nuova()
                .nvidia("550.163.01", "550.163.01")
                .wayland(),
            Macchina::nuova()
                .nvidia("595.112.07", "595.112.07")
                .env("XDG_SESSION_TYPE", "x11")
                .env("DISPLAY", ":0"),
            Macchina::nuova()
                .scheda("card0", "0x1002", "amdgpu", true)
                .nodo()
                .wayland(),
            Macchina::nuova().wayland(),
        ];
        for m in &senza {
            for modo in [Modo::Auto, Modo::Gpu, Modo::Cpu] {
                assert!(
                    !m.scelta(modo)
                        .variabili
                        .iter()
                        .any(|(n, _)| *n == PITTURA_GTK),
                    "{modo:?} {:?}",
                    m.diagnosi()
                );
            }
        }
    }

    #[test]
    fn la_composizione_di_skia_solo_dove_ha_i_fotogrammi_vecchi() {
        assert!(!skia_difettosa((2, 52, 3)));
        assert!(skia_difettosa((2, 53, 0)));
        assert!(skia_difettosa((2, 54, 0)));
        assert!(skia_difettosa((2, 54, 1)));
        assert!(!skia_difettosa((2, 54, 2)));
        assert!(!skia_difettosa((2, 54, 3)));
        assert!(!skia_difettosa((2, 56, 0)));

        let amd = Macchina::nuova()
            .scheda("card0", "0x1002", "amdgpu", true)
            .nodo()
            .wayland();
        let senza_skia = Scelta {
            variabili: vec![("WEBKIT_USE_SKIA_FOR_COMPOSITION", "0")],
            avvisi: vec![],
        };
        for modo in [Modo::Auto, Modo::Gpu] {
            assert_eq!(
                amd.scelta_con(modo, Some((2, 54, 0))),
                senza_skia,
                "{modo:?}"
            );
            assert_eq!(amd.scelta_con(modo, Some((2, 54, 2))), Scelta::default());
            assert_eq!(
                amd.scelta_con(modo, None),
                Scelta::default(),
                "versione ignota"
            );
        }
        assert_eq!(
            amd.scelta_con(Modo::Cpu, Some((2, 54, 0))).variabili,
            [("WEBKIT_SKIA_ENABLE_CPU_RENDERING", "1")]
        );
        // Come su questo PC: Debian 13, 2.54.0, NVIDIA 595.
        let pc = Macchina::nuova()
            .nvidia("595.112.07", "595.112.07")
            .wayland();
        assert_eq!(
            pc.scelta_con(Modo::Auto, Some((2, 54, 0))).variabili,
            [
                ("WEBKIT_FORCE_DMABUF_RENDERER", "1"),
                ("GDK_RENDERING", "recording"),
                ("WEBKIT_USE_SKIA_FOR_COMPOSITION", "0")
            ]
        );
        // La variabile dell'utente vince, qualunque valore abbia.
        let utente = Macchina::nuova()
            .scheda("card0", "0x1002", "amdgpu", true)
            .nodo()
            .wayland()
            .env("WEBKIT_USE_SKIA_FOR_COMPOSITION", "1");
        assert_eq!(
            utente.scelta_con(Modo::Auto, Some((2, 54, 0))),
            Scelta::default()
        );
    }

    #[test]
    fn nessuna_gpu_e_vm() {
        let vuota = Macchina::nuova().wayland();
        let d = vuota.diagnosi();
        assert_eq!(d.primaria, None);
        assert!(!d.nodo_di_resa);
        assert!(d.disegno_software());
        assert!(!d.nvidia_primaria());
        assert_eq!(vuota.scelta(Modo::Auto), Scelta::default());

        let qemu = Macchina::nuova()
            .scheda("card0", "0x1234", "bochs-drm", true)
            .wayland();
        assert!(qemu.diagnosi().disegno_software());
        assert_eq!(qemu.scelta(Modo::Auto), Scelta::default());

        let virtio = Macchina::nuova()
            .scheda("card0", "0x1af4", "virtio_gpu", true)
            .nodo()
            .wayland();
        assert!(
            !virtio.diagnosi().disegno_software(),
            "virgl può avere il 3D"
        );
        assert_eq!(virtio.scelta(Modo::Auto), Scelta::default());

        let forzato = Macchina::nuova()
            .scheda("card0", "0x8086", "i915", true)
            .nodo()
            .env("LIBGL_ALWAYS_SOFTWARE", "1");
        assert!(forzato.diagnosi().disegno_software());
        for falso in ["0", "false", "FALSE", "no", ""] {
            let m = Macchina::nuova()
                .scheda("card0", "0x8086", "i915", true)
                .nodo()
                .env("LIBGL_ALWAYS_SOFTWARE", falso);
            assert!(!m.diagnosi().disegno_software(), "{falso:?} non lo chiede");
        }
    }

    #[test]
    fn portatile_ibrido_disegna_intel_e_nvidia_non_conta() {
        let m = Macchina::nuova()
            .nvidia("550.163.01", "595.112.07")
            .scheda("card0", NVIDIA, "nvidia", false)
            .scheda("card1", "0x8086", "i915", true)
            .wayland();
        let d = m.diagnosi();
        assert_eq!(
            d.primaria.as_ref().map(|s| s.vendor.as_str()),
            Some("0x8086")
        );
        assert_eq!(d.driver_disallineato(), None);
        assert!(!d.sfarfallio_nvidia());
        assert_eq!(m.scelta(Modo::Auto), Scelta::default());
    }

    #[test]
    fn le_variabili_dell_utente_vincono() {
        // `cpu` con la variabile già messa (anche a 0): Fub non la tocca.
        let m = Macchina::nuova()
            .nvidia("550.163.01", "550.163.01")
            .wayland()
            .env("WEBKIT_SKIA_ENABLE_CPU_RENDERING", "0");
        assert!(m.scelta(Modo::Cpu).variabili.is_empty());
        // Chi ha messo a mano una variabile del percorso non riceve proposte.
        for nome in VARIABILI_UTENTE {
            let m = Macchina::nuova()
                .nvidia("550.163.01", "550.163.01")
                .wayland()
                .env(nome, "1");
            assert!(m.scelta(Modo::Auto).avvisi.is_empty(), "{nome}");
        }
        // Le altre variabili dell'utente restano: `cpu` aggiunge solo la sua.
        let m = Macchina::nuova()
            .nvidia("595.112.07", "595.112.07")
            .wayland()
            .env("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        assert_eq!(
            m.scelta(Modo::Cpu).variabili,
            [("WEBKIT_SKIA_ENABLE_CPU_RENDERING", "1")]
        );
    }

    /// Nessuna combinazione scrive le due variabili che le misure hanno
    /// trovato peggiori in ogni gesto.
    #[test]
    fn mai_dmabuf_spento_ne_composizione_spenta() {
        let macchine = [
            Macchina::nuova()
                .nvidia("550.163.01", "595.112.07")
                .wayland(),
            Macchina::nuova()
                .nvidia("550.163.01", "550.163.01")
                .wayland(),
            Macchina::nuova().nvidia("560.35.03", "560.35.03").wayland(),
            Macchina::nuova().wayland(),
            Macchina::nuova()
                .scheda("card0", "0x1002", "amdgpu", true)
                .nodo(),
        ];
        for m in &macchine {
            let d = m.diagnosi();
            for modo in [Modo::Auto, Modo::Gpu, Modo::Cpu] {
                for calmo in [false, true] {
                    for utente in [&[][..], &VARIABILI_UTENTE[..]] {
                        for webkit in [None, Some((2, 54, 0)), Some((2, 54, 3))] {
                            let scelta =
                                scegli(modo, &d, webkit, &|nome| utente.contains(&nome), calmo);
                            assert!(
                                scelta.variabili.iter().all(|(n, _)| !VIETATE.contains(n)),
                                "{modo:?} {d:?}"
                            );
                            // Fuori da `cpu` solo le due correzioni, mai il
                            // renderer.
                            if modo != Modo::Cpu {
                                assert!(
                                    scelta.variabili.iter().all(|(n, _)| [
                                        FORZA_DMABUF,
                                        PITTURA_GTK,
                                        SKIA_COMPOSIZIONE
                                    ]
                                    .contains(n)),
                                    "{modo:?} {scelta:?}"
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn la_sessione_come_la_sceglie_gtk() {
        let s = |coppie: &[(&str, &str)]| {
            let mappa: BTreeMap<&str, &str> = coppie.iter().copied().collect();
            sessione(&|nome| mappa.get(nome).map(|v| (*v).to_owned()))
        };
        assert_eq!(s(&[("WAYLAND_DISPLAY", "wayland-1")]), Sessione::Wayland);
        assert_eq!(
            s(&[("WAYLAND_DISPLAY", "wayland-1"), ("GDK_BACKEND", "x11")]),
            Sessione::X11
        );
        assert_eq!(s(&[("GDK_BACKEND", "foo,wayland,x11")]), Sessione::Wayland);
        assert_eq!(s(&[("XDG_SESSION_TYPE", "x11")]), Sessione::X11);
        assert_eq!(s(&[("DISPLAY", ":0")]), Sessione::X11);
        assert_eq!(s(&[]), Sessione::Sconosciuta);
    }

    #[test]
    fn i_modi_si_leggono_e_l_ignoto_vale_auto() {
        assert_eq!(Modo::da("auto"), Modo::Auto);
        assert_eq!(Modo::da("gpu"), Modo::Gpu);
        assert_eq!(Modo::da("cpu"), Modo::Cpu);
        assert_eq!(Modo::da("never"), Modo::Auto);
        assert_eq!(Modo::da(""), Modo::Auto);
    }

    /// La forma sul filo: è ciò che legge `rendering-notice.ts`.
    #[test]
    fn gli_avvisi_sul_filo() {
        assert_eq!(
            serde_json::to_value(Avviso::DriverMismatch {
                kernel: "550.163.01".into(),
                library: "595.112.07".into()
            })
            .expect("json"),
            serde_json::json!({ "kind": "driver_mismatch", "kernel": "550.163.01", "library": "595.112.07" })
        );
        assert_eq!(
            serde_json::to_value(Avviso::NvidiaFlicker {
                driver: "550.163.01".into(),
                offer_motion: true
            })
            .expect("json"),
            serde_json::json!({ "kind": "nvidia_flicker", "driver": "550.163.01", "offer_motion": true })
        );
    }

    #[test]
    fn le_versioni() {
        assert!(e_una_versione("550.163.01"));
        assert!(e_una_versione("560.35"));
        assert!(!e_una_versione("0"));
        assert!(!e_una_versione("550.x"));
        assert_eq!(
            confronta("595.112.07", "560.35.03"),
            std::cmp::Ordering::Greater
        );
        assert_eq!(principale("550.163.01"), Some(550));
    }
}
