//! Ciò che le prove dei motori hanno in comune: l'orologio, la memoria del
//! processo e il referto, una riga JSON su stdout.

use std::time::Instant;

use serde_json::{Map, Value, json};

/// La memoria del processo in MiB: residente adesso (`VmRSS`) e il picco
/// (`VmHWM`). Soltanto Linux; altrove `None`, e il referto lo dice.
pub fn memory() -> Option<(f64, f64)> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    let kib = |name: &str| -> Option<f64> {
        let line = status.lines().find(|l| l.starts_with(name))?;
        line.split_whitespace().nth(1)?.parse::<f64>().ok()
    };
    let mib = |k: f64| (k / 1024.0 * 10.0).round() / 10.0;
    Some((mib(kib("VmRSS:")?), mib(kib("VmHWM:")?)))
}

/// Il referto di una prova: i passi in ordine, ognuno col suo tempo e la
/// memoria dopo.
pub struct Referto {
    started: Instant,
    last: Instant,
    fields: Map<String, Value>,
    steps: Vec<Value>,
}

impl Referto {
    pub fn new(motore: &str, revisione: &str) -> Self {
        let now = Instant::now();
        let mut fields = Map::new();
        fields.insert("motore".into(), json!(motore));
        fields.insert("revisione".into(), json!(revisione));
        fields.insert("sistema".into(), json!(std::env::consts::OS));
        fields.insert("memoria_iniziale".into(), mem_json());
        Referto { started: now, last: now, fields, steps: Vec::new() }
    }

    pub fn set(&mut self, key: &str, value: Value) {
        self.fields.insert(key.into(), value);
    }

    /// Chiude un passo: quanto è durato dall'ultimo e la memoria adesso.
    pub fn step(&mut self, name: &str) {
        let now = Instant::now();
        let ms = now.duration_since(self.last).as_secs_f64() * 1000.0;
        self.last = now;
        self.steps.push(json!({ "passo": name, "ms": (ms * 10.0).round() / 10.0, "memoria": mem_json() }));
    }

    /// Stampa il referto e lo consuma.
    pub fn print(mut self) {
        let total = self.started.elapsed().as_secs_f64() * 1000.0;
        self.fields.insert("passi".into(), Value::Array(self.steps));
        self.fields.insert("totale_ms".into(), json!((total * 10.0).round() / 10.0));
        println!("{}", Value::Object(self.fields));
    }
}

fn mem_json() -> Value {
    match memory() {
        Some((rss, peak)) => json!({ "rss_mib": rss, "picco_mib": peak }),
        None => Value::Null,
    }
}

/// Il primo argomento: il file da aprire.
pub fn file_argument() -> std::path::PathBuf {
    match std::env::args_os().nth(1) {
        Some(path) => path.into(),
        None => {
            eprintln!("uso: prova-<motore> FILE");
            std::process::exit(2);
        }
    }
}

/// Rende al sistema la memoria che l'allocatore tiene libera (glibc
/// `malloc_trim`). Dopo «chiudi tutto» distingue ciò che il motore tiene
/// ancora da ciò che l'allocatore non ha restituito. Altrove non fa nulla.
pub fn trim() {
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    {
        unsafe extern "C" {
            fn malloc_trim(pad: usize) -> i32;
        }
        // SAFETY: `malloc_trim` di glibc non ha precondizioni.
        unsafe {
            malloc_trim(0);
        }
    }
}
