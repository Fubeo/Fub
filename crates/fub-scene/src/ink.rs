//! Il codec di `fub:ink` (§5): i campioni di un tratto come interi, il primo
//! assoluto e gli altri in differenze dal precedente.
//!
//! ```text
//! 1 s100 cxypt 12050,3020,128,0 25,-3,2,8 31,-5,0,8
//! ```
//!
//! [`Ink`] tiene i valori assoluti, già quantizzati: è ciò che si rilegge da un
//! file e ciò che si scrive. La quantizzazione dai numeri del dispositivo è
//! [`Ink::quantize`], con la regola `floor(v × scala + 0,5)` che usa anche
//! TypeScript (`apps/client/src/editors/spatial/ink/sample.ts`): i delta si
//! calcolano sugli interi, e chi rilegge ottiene gli stessi interi di chi ha
//! scritto.
//!
//! Ogni intero, assoluto o differenza, sta entro ±(2⁵³ − 1): oltre, un motore
//! JavaScript non lo rappresenterebbe esatto, e i due lati del formato
//! leggerebbero tratti diversi.

use std::fmt;

/// Quanti campioni può avere un tratto (§5, §11).
pub const INK_MAX_SAMPLES: usize = 10_000;
/// Quanti byte può avere un `fub:ink` (§5, §11).
pub const INK_MAX_BYTES: usize = 512 * 1024;
/// Il più grande intero che un `f64` rappresenta esatto insieme a tutti i
/// precedenti: `Number.MAX_SAFE_INTEGER`.
pub const MAX_SAFE_INTEGER: i64 = (1 << 53) - 1;
/// I passi della pressione: `p = round(pressione × 255)`.
pub const PRESSURE_STEPS: f64 = 255.0;

/// I canali che §5 conosce, nell'ordine in cui FubDraw li scrive. Ogni altra
/// lettera è un canale sconosciuto (S010).
pub const KNOWN_CHANNELS: &str = "xyptaz";

/// La scala delle coordinate.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum Scale {
    /// `s10`: decimi di unità.
    S10,
    /// `s100`: centesimi di unità, l'errore è al massimo 0,005.
    S100,
}

impl Scale {
    /// Il fattore per cui si moltiplicano `x` e `y`.
    pub fn factor(self) -> f64 {
        match self {
            Scale::S10 => 10.0,
            Scale::S100 => 100.0,
        }
    }

    fn token(self) -> &'static str {
        match self {
            Scale::S10 => "s10",
            Scale::S100 => "s100",
        }
    }
}

/// Perché un `fub:ink` non si legge, o non si scrive: ognuno produce S004.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum InkError {
    /// Un tratto senza `fub:ink`.
    Missing,
    /// Oltre [`INK_MAX_BYTES`].
    TooLarge,
    /// Le parti non sono separate da uno spazio singolo, o ne manca una.
    Syntax,
    /// La versione non è `1`.
    Version,
    /// La scala non è `s10` né `s100`.
    Scale,
    /// I canali non cominciano con `cxy`, contengono altro che lettere o
    /// ripetono una lettera.
    Channels,
    /// `a` senza `z`, o `z` senza `a`: compaiono sempre insieme.
    Tilt,
    /// Nessun campione.
    NoSamples,
    /// Oltre [`INK_MAX_SAMPLES`] campioni.
    TooManySamples,
    /// Il campione ha più o meno valori dei canali.
    Arity { sample: usize },
    /// Un valore non è un intero: `-` facoltativo e cifre.
    Integer { sample: usize },
    /// Un valore, o la somma dei delta, esce da ±(2⁵³ − 1).
    Overflow { sample: usize },
    /// Il primo campione non ha `t = 0`.
    FirstTime,
    /// Un canale noto esce dal suo intervallo: `p` 0…255, `a` 0…90, `z`
    /// 0…359.
    Range { sample: usize, channel: char },
    /// Quantizzando: un valore non finito.
    NonFinite { sample: usize },
    /// Quantizzando: un campione con canali diversi dal primo.
    MixedChannels { sample: usize },
}

impl InkError {
    /// Il nome dell'errore, in kebab-case: è il dettaglio di S004.
    pub fn kind(self) -> &'static str {
        match self {
            InkError::Missing => "missing",
            InkError::TooLarge => "too-large",
            InkError::Syntax => "syntax",
            InkError::Version => "version",
            InkError::Scale => "scale",
            InkError::Channels => "channels",
            InkError::Tilt => "tilt",
            InkError::NoSamples => "no-samples",
            InkError::TooManySamples => "too-many-samples",
            InkError::Arity { .. } => "arity",
            InkError::Integer { .. } => "integer",
            InkError::Overflow { .. } => "overflow",
            InkError::FirstTime => "first-time",
            InkError::Range { .. } => "range",
            InkError::NonFinite { .. } => "non-finite",
            InkError::MixedChannels { .. } => "mixed-channels",
        }
    }

    /// Il campione dell'errore, contando da 0, se l'errore ne ha uno.
    pub fn sample(self) -> Option<usize> {
        match self {
            InkError::Arity { sample }
            | InkError::Integer { sample }
            | InkError::Overflow { sample }
            | InkError::Range { sample, .. }
            | InkError::NonFinite { sample }
            | InkError::MixedChannels { sample } => Some(sample),
            _ => None,
        }
    }
}

impl fmt::Display for InkError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = match self {
            InkError::Missing => "il tratto non ha fub:ink",
            InkError::TooLarge => "fub:ink supera 512 KiB",
            InkError::Syntax => "fub:ink non rispetta la grammatica",
            InkError::Version => "versione di fub:ink sconosciuta",
            InkError::Scale => "scala di fub:ink diversa da s10 e s100",
            InkError::Channels => "canali di fub:ink non validi",
            InkError::Tilt => "i canali a e z compaiono insieme",
            InkError::NoSamples => "fub:ink senza campioni",
            InkError::TooManySamples => "fub:ink supera 10 000 campioni",
            InkError::Arity { .. } => "un campione non ha un valore per canale",
            InkError::Integer { .. } => "un valore di fub:ink non è un intero",
            InkError::Overflow { .. } => "un valore di fub:ink supera 2^53 - 1",
            InkError::FirstTime => "il primo campione non ha t = 0",
            InkError::Range { .. } => "un canale esce dal suo intervallo",
            InkError::NonFinite { .. } => "un campione ha un valore non finito",
            InkError::MixedChannels { .. } => "un campione ha canali diversi dal primo",
        };
        f.write_str(text)?;
        if let Some(sample) = self.sample() {
            write!(f, " (campione {sample})")?;
        }
        Ok(())
    }
}

impl std::error::Error for InkError {}

/// Un campione come arriva dal dispositivo, in unità locali dell'elemento.
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct Sample {
    pub x: f64,
    pub y: f64,
    /// Pressione 0…1; `None` per mouse e tocco.
    pub p: Option<f64>,
    /// Millisecondi dal primo campione, che vale 0.
    pub t: f64,
    /// Altitudine e azimut in gradi, se il dispositivo li dà.
    pub tilt: Option<(f64, f64)>,
}

/// I campioni di un tratto, quantizzati e assoluti.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Ink {
    scale: Scale,
    /// Le lettere dei canali, `x` e `y` per prime.
    channels: String,
    /// I valori assoluti, un campione dopo l'altro.
    values: Vec<i64>,
}

/// `floor(v × factor + 0,5)`, la regola di §5 e §7.
pub fn round_half_up(value: f64, factor: f64) -> f64 {
    (value * factor + 0.5).floor()
}

/// Un intero di `fub:ink`: `-` facoltativo, almeno una cifra, entro
/// ±(2⁵³ − 1).
enum Int {
    Value(i64),
    Malformed,
    Overflow,
}

fn parse_int(text: &str) -> Int {
    let digits = text.strip_prefix('-').unwrap_or(text);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return Int::Malformed;
    }
    // Gli zeri in testa non contano, e la grammatica li ammette.
    let significant = digits.trim_start_matches('0');
    if significant.len() > 16 {
        return Int::Overflow;
    }
    let magnitude: i64 = significant.parse().unwrap_or(0);
    if magnitude > MAX_SAFE_INTEGER {
        return Int::Overflow;
    }
    Int::Value(if text.starts_with('-') {
        -magnitude
    } else {
        magnitude
    })
}

/// Controlla i canali: `x` e `y` per primi, lettere, nessuna ripetuta, `a` e
/// `z` insieme.
fn check_channels(channels: &str) -> Result<(), InkError> {
    if !channels.starts_with("xy") || !channels.bytes().all(|b| b.is_ascii_alphabetic()) {
        return Err(InkError::Channels);
    }
    let mut seen = [false; 128];
    for b in channels.bytes() {
        if std::mem::replace(&mut seen[usize::from(b)], true) {
            return Err(InkError::Channels);
        }
    }
    if seen[usize::from(b'a')] != seen[usize::from(b'z')] {
        return Err(InkError::Tilt);
    }
    Ok(())
}

impl Ink {
    /// Un inchiostro dai suoi valori assoluti. Controlla i canali, il numero
    /// dei campioni, gli intervalli dei canali noti e che ogni valore e ogni
    /// delta stia entro ±(2⁵³ − 1), cioè che il testo scritto si possa
    /// rileggere.
    pub fn new(scale: Scale, channels: &str, values: Vec<i64>) -> Result<Ink, InkError> {
        check_channels(channels)?;
        let width = channels.len();
        if values.is_empty() {
            return Err(InkError::NoSamples);
        }
        if values.len() % width != 0 {
            return Err(InkError::Arity {
                sample: values.len() / width,
            });
        }
        let ink = Ink {
            scale,
            channels: channels.to_owned(),
            values,
        };
        if ink.len() > INK_MAX_SAMPLES {
            return Err(InkError::TooManySamples);
        }
        for (i, sample) in ink.values.chunks(width).enumerate() {
            for (j, &value) in sample.iter().enumerate() {
                let delta = match i {
                    0 => Some(value),
                    _ => value.checked_sub(ink.values[(i - 1) * width + j]),
                };
                let safe = |v: i64| v.unsigned_abs() <= MAX_SAFE_INTEGER.unsigned_abs();
                if !safe(value) || !delta.is_some_and(safe) {
                    return Err(InkError::Overflow { sample: i });
                }
            }
        }
        ink.check_ranges()?;
        Ok(ink)
    }

    /// Legge un `fub:ink`.
    pub fn decode(text: &str) -> Result<Ink, InkError> {
        if text.len() > INK_MAX_BYTES {
            return Err(InkError::TooLarge);
        }
        let mut parts = text.split(' ');
        let (Some(version), Some(scale), Some(channels)) =
            (parts.next(), parts.next(), parts.next())
        else {
            return Err(InkError::Syntax);
        };
        if version.is_empty() || scale.is_empty() || channels.is_empty() {
            return Err(InkError::Syntax);
        }
        if version != "1" {
            return Err(InkError::Version);
        }
        let scale = match scale {
            "s10" => Scale::S10,
            "s100" => Scale::S100,
            _ => return Err(InkError::Scale),
        };
        let channels = channels.strip_prefix('c').ok_or(InkError::Channels)?;
        check_channels(channels)?;
        let width = channels.len();
        let mut values: Vec<i64> = Vec::new();
        for (i, sample) in parts.enumerate() {
            if i == INK_MAX_SAMPLES {
                return Err(InkError::TooManySamples);
            }
            if sample.is_empty() {
                return Err(InkError::Syntax);
            }
            let mut count = 0;
            for (j, field) in sample.split(',').enumerate() {
                if j == width {
                    return Err(InkError::Arity { sample: i });
                }
                let value = match parse_int(field) {
                    Int::Value(value) => value,
                    Int::Malformed => return Err(InkError::Integer { sample: i }),
                    Int::Overflow => return Err(InkError::Overflow { sample: i }),
                };
                let absolute = match i {
                    0 => value,
                    _ => values[(i - 1) * width + j] + value,
                };
                if absolute.abs() > MAX_SAFE_INTEGER {
                    return Err(InkError::Overflow { sample: i });
                }
                values.push(absolute);
                count += 1;
            }
            if count != width {
                return Err(InkError::Arity { sample: i });
            }
        }
        if values.is_empty() {
            return Err(InkError::NoSamples);
        }
        let ink = Ink {
            scale,
            channels: channels.to_owned(),
            values,
        };
        ink.check_ranges()?;
        Ok(ink)
    }

    /// Controlla gli intervalli dei canali noti e il `t` del primo campione.
    fn check_ranges(&self) -> Result<(), InkError> {
        if let Some(t) = self.channel('t') {
            if self.values[t] != 0 {
                return Err(InkError::FirstTime);
            }
        }
        for (channel, max) in [('p', 255), ('a', 90), ('z', 359)] {
            let Some(j) = self.channel(channel) else {
                continue;
            };
            let width = self.channels.len();
            if let Some(sample) =
                (0..self.len()).find(|&i| !(0..=max).contains(&self.values[i * width + j]))
            {
                return Err(InkError::Range { sample, channel });
            }
        }
        Ok(())
    }

    /// Scrive il `fub:ink` canonico: il primo campione assoluto, gli altri in
    /// delta. Il testo può superare [`INK_MAX_BYTES`]: chi scrive divide il
    /// tratto prima (§5).
    pub fn encode(&self) -> String {
        let width = self.channels.len();
        let mut text = format!("1 {} c{}", self.scale.token(), self.channels);
        for (i, sample) in self.values.chunks(width).enumerate() {
            for (j, &value) in sample.iter().enumerate() {
                let delta = match i {
                    0 => value,
                    _ => value - self.values[(i - 1) * width + j],
                };
                text.push(if j == 0 { ' ' } else { ',' });
                text.push_str(&delta.to_string());
            }
        }
        text
    }

    /// Quantizza i campioni del dispositivo, come `quantizeInk` di
    /// TypeScript: `x` e `y` per la scala, la pressione portata in 0…1 e per
    /// 255, i millisecondi, l'altitudine portata in 0…90, l'azimut modulo
    /// 360. I canali sono quelli del primo campione, nell'ordine `x y p t a
    /// z`, e ogni campione deve averli tutti.
    pub fn quantize(samples: &[Sample], scale: Scale) -> Result<Ink, InkError> {
        let first = samples.first().ok_or(InkError::NoSamples)?;
        if samples.len() > INK_MAX_SAMPLES {
            return Err(InkError::TooManySamples);
        }
        if first.t != 0.0 {
            return Err(InkError::FirstTime);
        }
        let pressure = first.p.is_some();
        let tilt = first.tilt.is_some();
        let mut channels = String::from("xy");
        if pressure {
            channels.push('p');
        }
        channels.push('t');
        if tilt {
            channels.push_str("az");
        }
        let mut values = Vec::with_capacity(samples.len() * channels.len());
        for (i, sample) in samples.iter().enumerate() {
            if sample.p.is_some() != pressure || sample.tilt.is_some() != tilt {
                return Err(InkError::MixedChannels { sample: i });
            }
            let mut raw = vec![sample.x, sample.y, sample.t];
            raw.extend(sample.p);
            if let Some((a, z)) = sample.tilt {
                raw.extend([a, z]);
            }
            if raw.iter().any(|v| !v.is_finite()) {
                return Err(InkError::NonFinite { sample: i });
            }
            let integer = |v: f64| {
                if v.abs() > MAX_SAFE_INTEGER as f64 {
                    Err(InkError::Overflow { sample: i })
                } else {
                    Ok(v as i64)
                }
            };
            values.push(integer(round_half_up(sample.x, scale.factor()))?);
            values.push(integer(round_half_up(sample.y, scale.factor()))?);
            if let Some(p) = sample.p {
                values.push(integer(round_half_up(p.clamp(0.0, 1.0), PRESSURE_STEPS))?);
            }
            values.push(integer(round_half_up(sample.t, 1.0))?);
            if let Some((a, z)) = sample.tilt {
                values.push(integer(round_half_up(a.clamp(0.0, 90.0), 1.0))?);
                values.push(integer(round_half_up(z, 1.0))?.rem_euclid(360));
            }
        }
        Ink::new(scale, &channels, values)
    }

    pub fn scale(&self) -> Scale {
        self.scale
    }

    /// Le lettere dei canali, senza la `c` iniziale.
    pub fn channels(&self) -> &str {
        &self.channels
    }

    /// Il numero di campioni.
    pub fn len(&self) -> usize {
        self.values.len() / self.channels.len()
    }

    /// Sempre falso: un inchiostro ha almeno un campione.
    pub fn is_empty(&self) -> bool {
        self.values.is_empty()
    }

    /// I valori assoluti del campione `i`, nell'ordine dei canali.
    pub fn sample(&self, i: usize) -> &[i64] {
        let width = self.channels.len();
        &self.values[i * width..(i + 1) * width]
    }

    /// La colonna del canale `letter`, se c'è.
    pub fn channel(&self, letter: char) -> Option<usize> {
        self.channels.find(letter)
    }

    /// Il punto del campione `i` in unità locali: gli interi divisi per la
    /// scala.
    pub fn point(&self, i: usize) -> [f64; 2] {
        let sample = self.sample(i);
        let factor = self.scale.factor();
        [sample[0] as f64 / factor, sample[1] as f64 / factor]
    }

    /// I canali che §5 non conosce, nell'ordine in cui compaiono: un tratto
    /// che ne ha non si ridisegna (S010).
    pub fn unknown_channels(&self) -> String {
        self.channels
            .chars()
            .filter(|c| !KNOWN_CHANNELS.contains(*c))
            .collect()
    }

    /// La durata in millisecondi: il `t` dell'ultimo campione, se c'è il
    /// canale `t`.
    pub fn duration(&self) -> Option<i64> {
        let t = self.channel('t')?;
        Some(self.sample(self.len() - 1)[t])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_example_of_the_spec_decodes() {
        let ink = Ink::decode("1 s100 cxypt 12050,3020,128,0 25,-3,2,8 31,-5,0,8").unwrap();
        assert_eq!(ink.scale(), Scale::S100);
        assert_eq!(ink.channels(), "xypt");
        assert_eq!(ink.len(), 3);
        assert_eq!(ink.sample(1), [12075, 3017, 130, 8]);
        assert_eq!(ink.sample(2), [12106, 3012, 130, 16]);
        assert_eq!(ink.point(0), [120.5, 30.2]);
        assert_eq!(ink.duration(), Some(16));
        assert_eq!(
            ink.encode(),
            "1 s100 cxypt 12050,3020,128,0 25,-3,2,8 31,-5,0,8"
        );
    }

    #[test]
    fn integers_follow_the_grammar() {
        assert!(matches!(parse_int("0"), Int::Value(0)));
        assert!(matches!(parse_int("-0"), Int::Value(0)));
        assert!(matches!(parse_int("007"), Int::Value(7)));
        assert!(matches!(
            parse_int("9007199254740991"),
            Int::Value(MAX_SAFE_INTEGER)
        ));
        assert!(matches!(parse_int("-9007199254740991"), Int::Value(v) if v == -MAX_SAFE_INTEGER));
        assert!(matches!(
            parse_int("0000000000000000000009007199254740991"),
            Int::Value(_)
        ));
        assert!(matches!(parse_int("9007199254740992"), Int::Overflow));
        assert!(matches!(
            parse_int("99999999999999999999999"),
            Int::Overflow
        ));
        for malformed in ["", "-", "+1", "1.0", "1e3", " 1", "--1", "0x10", "١"] {
            assert!(
                matches!(parse_int(malformed), Int::Malformed),
                "{malformed:?}"
            );
        }
    }
}
