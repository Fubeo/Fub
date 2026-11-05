//! Il modulo dei parametri di un comando, letto dalla forma a parole che il
//! motore dà.
//!
//! I motori copiati descrivono i parametri di ogni comando con uno schema a
//! parole, pensato per chi legge: `{cell, word, to, all?: bool}`,
//! `{range?, preset: bottom|top|none, style?: thin|medium|…, color?}`,
//! `{sheet: index | name}`. [`Modulo::da_schema`] lo legge in campi con un
//! nome, un [`Tipo`] e il segno del facoltativo, da cui la shell genera la
//! finestra dei parametri.
//!
//! Il dialetto ammesso è quello che i comandi usano davvero, e una forma che
//! non si capisce è un errore ([`ErroreSchema`]), non un campo di testo
//! silenzioso: un comando nuovo con una forma nuova si fa vedere nel test
//! dell'adattatore, prima di arrivare alla shell.
//!
//! # Il dialetto
//!
//! - Lo schema è un oggetto `{…}`; il testo che lo segue è una descrizione
//!   (`→ {risultato}`, una frase, una nota fra parentesi) e non dà campi,
//!   tranne `or …: {…}`, che è un'altra forma degli stessi parametri
//!   ([`Modulo::altre_forme`]). Uno schema vuoto è un modulo senza campi.
//! - Dentro l'oggetto i campi si separano con la virgola: `nome`, `nome?`
//!   (facoltativo), `nome: valore`, `nome?: valore`, con note fra parentesi
//!   dopo il nome o dopo il valore. Un pezzo che non comincia con un nome
//!   continua la descrizione del campo prima (`2–8,760`, una frase con una
//!   virgola dentro).
//! - `a | b` fra campi (`path | text`, `rows? | cols? | by?`,
//!   `chart? | kind: shape`) dice che se ne dà uno: i campi hanno lo stesso
//!   [`Campo::uno_fra`].
//! - `…tool params` (un pezzo che comincia con `…` o `..`) dice che il comando
//!   accetta altri parametri, descritti a parole ([`Modulo::aperto`]).
//! - Il valore dà il tipo. Le parole del tipo (`bool`, `number`, `n`,
//!   `index`, `pages`, `percent`, `text`, `string`, `name`, `id`, `hex`,
//!   `field`, `cell`, `range`), `true`/`false`, i numeri e gli intervalli di
//!   numeri (`11`, `1-7`, `10..400`, `1–32767`), le stringhe fra virgolette
//!   (una cella o un intervallo come `"B2"` e `"A1:D10"` danno il loro tipo,
//!   le altre sono esempi di testo), `[…]` e `{…}` (un valore JSON), gli
//!   elenchi di parole `a|b|c` (una scelta, aperta se finisce con `…`), le
//!   alternative con `|` e con ` or `, una frase (il tipo della sua ultima
//!   parola, se è una parola del tipo, se no testo), `null` (si ignora).
//!   ` = …` e le note fra parentesi dopo un valore sono descrizioni; una nota
//!   tutta maiuscola (`B4 (ISO)`) fa parte del valore.
//! - Un campo senza valore prende il tipo dal lessico del motore (i nomi
//!   ricorrenti: `range`, `sheet`, `password`); un nome che il lessico non
//!   conosce è un errore. Il lessico affina anche un valore vago: `sheet?:
//!   name` è un foglio, `range?: "A1"` un intervallo.

use std::collections::BTreeSet;

/// Il tipo di un campo del modulo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Tipo {
    /// Un testo libero.
    Testo,
    /// Un testo da non mostrare mentre si scrive: una password.
    Segreto,
    /// Un numero.
    Numero,
    /// Sì o no.
    SiNo,
    /// Una cella del foglio: `"B2"`, `"Foglio2!A1"`.
    Cella,
    /// Un intervallo del foglio: `"A1:D10"`, `"B:D"`, `"2:5"`, `"B2,D4"`.
    Intervallo,
    /// Un foglio della cartella, per nome o per posizione.
    Foglio,
    /// Uno dei valori dati dallo schema; `aperta` se lo schema dice che ce
    /// ne sono altri (`thin|medium|…`).
    Scelta {
        /// I valori, nell'ordine dello schema e senza doppioni.
        valori: Vec<String>,
        /// Vero se lo schema ammette anche valori che non elenca.
        aperta: bool,
    },
    /// Un valore JSON: un elenco, un oggetto, o un valore che può essere di
    /// tipi diversi (`"auto" | 0`).
    Json,
}

impl Tipo {
    /// Il nome del tipo nel catalogo per la shell.
    pub fn nome(&self) -> &'static str {
        match self {
            Tipo::Testo => "testo",
            Tipo::Segreto => "segreto",
            Tipo::Numero => "numero",
            Tipo::SiNo => "sino",
            Tipo::Cella => "cella",
            Tipo::Intervallo => "intervallo",
            Tipo::Foglio => "foglio",
            Tipo::Scelta { .. } => "scelta",
            Tipo::Json => "json",
        }
    }

    fn riferimento(&self) -> bool {
        matches!(self, Tipo::Cella | Tipo::Intervallo | Tipo::Foglio)
    }
}

/// Un campo del modulo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Campo {
    /// Il nome del parametro, come il motore lo legge.
    pub nome: String,
    /// Il suo tipo.
    pub tipo: Tipo,
    /// Vero se si può lasciare vuoto (`nome?`).
    pub facoltativo: bool,
    /// I campi con lo stesso numero sono alternative: se ne dà uno
    /// (`path | text`). Il numero vale dentro la sua forma.
    pub uno_fra: Option<usize>,
}

/// I parametri di un comando, letti dallo schema del motore.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Modulo {
    /// I campi della forma principale, nell'ordine dello schema.
    pub campi: Vec<Campo>,
    /// Le altre forme degli stessi parametri (`{…} or one section: {…}`).
    pub altre_forme: Vec<Vec<Campo>>,
    /// Vero se il comando accetta altri parametri che lo schema descrive a
    /// parole (`…tool params`): la finestra generata non li conosce.
    pub aperto: bool,
}

/// Una forma dello schema che non si capisce.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("lo schema non si legge vicino a «{vicino}»: {motivo}")]
pub struct ErroreSchema {
    /// Il pezzo dello schema dove la lettura si è fermata.
    pub vicino: String,
    /// Perché.
    pub motivo: String,
}

fn errore(vicino: &str, motivo: impl Into<String>) -> ErroreSchema {
    let mut vicino = vicino.trim().to_owned();
    if vicino.chars().count() > 80 {
        vicino = vicino.chars().take(80).collect::<String>() + "…";
    }
    ErroreSchema {
        vicino,
        motivo: motivo.into(),
    }
}

type Esito<T> = Result<T, ErroreSchema>;

impl Modulo {
    /// Legge lo schema `schema` di un comando. `lessico` dà il tipo dei campi
    /// che lo schema nomina senza valore (`{cell, word, to}`), e affina
    /// quello dei valori vaghi: si veda la pagina del modulo.
    pub fn da_schema(schema: &str, lessico: &[(&str, Tipo)]) -> Result<Modulo, ErroreSchema> {
        let schema = schema.trim();
        if schema.is_empty() {
            return Ok(Modulo::default());
        }
        if !schema.starts_with('{') {
            return Err(errore(schema, "lo schema non comincia con «{»"));
        }
        let mut modulo = Modulo::default();
        let mut resto = schema;
        let mut prima = true;
        loop {
            let fine = chiusa(resto, 0)?;
            let corpo = &resto[1..fine];
            let (campi, aperto) = forma(corpo, lessico)?;
            modulo.aperto |= aperto;
            if prima {
                modulo.campi = campi;
                prima = false;
            } else {
                modulo.altre_forme.push(campi);
            }
            resto = resto[fine + 1..].trim_start();
            match altra_forma(resto) {
                Some(da) => resto = &resto[da..],
                None => break,
            }
        }
        Ok(modulo)
    }
}

/// Dove comincia un'altra forma nel testo dopo uno schema: `or …: {…}`,
/// prima di ogni `→`.
fn altra_forma(resto: &str) -> Option<usize> {
    let parola = resto.split_whitespace().next()?;
    if parola != "or" {
        return None;
    }
    let graffa = resto.find('{')?;
    match resto.find('→') {
        Some(freccia) if freccia < graffa => None,
        _ => Some(graffa),
    }
}

// ------------------------------------------------------------- il lettore

/// La posizione della parentesi che chiude quella aperta in `inizio`.
/// Le virgolette (con `\"`) sono opache; dentro una nota fra parentesi
/// tonde contano soltanto le tonde, perché una nota può dire `Ctrl+Shift+[`.
fn chiusa(testo: &str, inizio: usize) -> Esito<usize> {
    let mut pila: Vec<char> = Vec::new();
    let mut virgolette = false;
    let mut fuga = false;
    for (at, c) in testo[inizio..].char_indices() {
        let at = at + inizio;
        if virgolette {
            match (fuga, c) {
                (true, _) => fuga = false,
                (false, '\\') => fuga = true,
                (false, '"') => virgolette = false,
                _ => {}
            }
            continue;
        }
        let in_nota = pila.last() == Some(&')');
        match c {
            '"' => virgolette = true,
            '(' => pila.push(')'),
            '[' if !in_nota => pila.push(']'),
            '{' if !in_nota => pila.push('}'),
            ')' | ']' | '}' if in_nota && c != ')' => {}
            ')' | ']' | '}' => {
                if pila.pop() != Some(c) {
                    return Err(errore(&testo[inizio..], format!("«{c}» non chiude niente")));
                }
                if pila.is_empty() {
                    return Ok(at);
                }
            }
            _ => {}
        }
    }
    Err(errore(
        &testo[inizio..],
        "una parentesi o delle virgolette non si chiudono",
    ))
}

/// Divide `testo` dove compare `separatore` fuori da parentesi e virgolette.
fn dividi<'a>(testo: &'a str, separatore: &str) -> Esito<Vec<&'a str>> {
    let mut pezzi = Vec::new();
    let mut da = 0;
    let mut at = 0;
    let bytes = testo.as_bytes();
    while at < testo.len() {
        let c = testo[at..].chars().next().unwrap_or(' ');
        match c {
            '"' => {
                at = virgolette_chiuse(testo, at)? + 1;
                continue;
            }
            '(' | '[' | '{' => {
                at = chiusa(testo, at)? + 1;
                continue;
            }
            ')' | ']' | '}' => return Err(errore(testo, format!("«{c}» non chiude niente"))),
            _ => {}
        }
        if bytes[at..].starts_with(separatore.as_bytes()) {
            pezzi.push(&testo[da..at]);
            at += separatore.len();
            da = at;
            continue;
        }
        at += c.len_utf8();
    }
    pezzi.push(&testo[da..]);
    Ok(pezzi)
}

/// La posizione delle virgolette che chiudono quelle aperte in `inizio`.
fn virgolette_chiuse(testo: &str, inizio: usize) -> Esito<usize> {
    let mut fuga = false;
    for (at, c) in testo[inizio + 1..].char_indices() {
        match (fuga, c) {
            (true, _) => fuga = false,
            (false, '\\') => fuga = true,
            (false, '"') => return Ok(inizio + 1 + at),
            _ => {}
        }
    }
    Err(errore(&testo[inizio..], "le virgolette non si chiudono"))
}

/// Toglie dal testo le note fra parentesi tonde fuori dalle virgolette,
/// tranne quelle tutte maiuscole (`B4 (ISO)`), che sono parte del valore.
fn senza_note(testo: &str) -> Esito<String> {
    let mut out = String::new();
    let mut at = 0;
    while at < testo.len() {
        let c = testo[at..].chars().next().unwrap_or(' ');
        match c {
            '"' => {
                let fine = virgolette_chiuse(testo, at)?;
                out.push_str(&testo[at..=fine]);
                at = fine + 1;
            }
            '(' => {
                let fine = chiusa(testo, at)?;
                let nota = &testo[at + 1..fine];
                if nota.len() >= 2 && nota.chars().all(|c| c.is_ascii_uppercase()) {
                    out.push_str(&testo[at..=fine]);
                }
                at = fine + 1;
            }
            '[' | '{' => {
                let fine = chiusa(testo, at)?;
                out.push_str(&testo[at..=fine]);
                at = fine + 1;
            }
            _ => {
                out.push(c);
                at += c.len_utf8();
            }
        }
    }
    Ok(out.split_whitespace().collect::<Vec<_>>().join(" "))
}

fn identificatore(testo: &str) -> usize {
    let mut fine = 0;
    for (at, c) in testo.char_indices() {
        let ok = if at == 0 {
            c.is_ascii_alphabetic()
        } else {
            c.is_ascii_alphanumeric() || c == '_'
        };
        if !ok {
            break;
        }
        fine = at + c.len_utf8();
    }
    fine
}

/// La testa di un campo: `nome`, `nome?`, con note fra parentesi e poi `:`.
struct Testa<'a> {
    nome: &'a str,
    facoltativo: bool,
    /// Il valore dopo i due punti, se c'è.
    valore: Option<&'a str>,
}

/// Legge la testa di un campo in `pezzo`. `segnata` chiede anche che il nome
/// sia seguito da `?` o da `:` (per distinguere un campo alternativo da una
/// parola del valore). `None` se il pezzo non comincia con un campo.
fn testa(pezzo: &str, segnata: bool) -> Esito<Option<Testa<'_>>> {
    let pezzo = pezzo.trim();
    let fine = identificatore(pezzo);
    if fine == 0 {
        return Ok(None);
    }
    let nome = &pezzo[..fine];
    let mut resto = &pezzo[fine..];
    let facoltativo = resto.starts_with('?');
    if facoltativo {
        resto = &resto[1..];
    }
    let mut segno = facoltativo;
    loop {
        resto = resto.trim_start();
        if resto.starts_with('(') {
            let chiude = chiusa(resto, 0)?;
            resto = &resto[chiude + 1..];
        } else {
            break;
        }
    }
    let valore = if let Some(dopo) = resto.strip_prefix(':') {
        segno = true;
        Some(dopo)
    } else if resto.is_empty() {
        None
    } else {
        return Ok(None);
    };
    if segnata && !segno {
        return Ok(None);
    }
    Ok(Some(Testa {
        nome,
        facoltativo,
        valore,
    }))
}

/// Un campo letto, prima del tipo.
struct Grezzo {
    nome: String,
    facoltativo: bool,
    valore: Vec<String>,
    ha_valore: bool,
    uno_fra: Option<usize>,
}

/// Legge il corpo di un oggetto dello schema: i campi, e se è aperto.
fn forma(corpo: &str, lessico: &[(&str, Tipo)]) -> Esito<(Vec<Campo>, bool)> {
    let mut aperto = false;
    let mut grezzi: Vec<Grezzo> = Vec::new();
    let mut gruppi = 0;
    if corpo.trim().is_empty() {
        return Ok((Vec::new(), false));
    }
    let mut pezzi = Vec::new();
    for (n, sezione) in dividi(corpo, ";")?.into_iter().enumerate() {
        // `…; trendline: series?: index, …`: dopo un punto e virgola i campi
        // possono avere davanti il nome della parte a cui servono.
        let sezione = match (n, sezione.trim_start().split_once(':')) {
            (1.., Some((etichetta, resto)))
                if identificatore(etichetta) == etichetta.len()
                    && !etichetta.is_empty()
                    && testa(dividi(resto, ",")?[0], true)?.is_some() =>
            {
                resto
            }
            // `…}; a text value is matched as text`: una frase dopo il punto e
            // virgola descrive, non dà campi.
            (1.., _) if testa(dividi(sezione, ",")?[0], false)?.is_none() => continue,
            _ => sezione,
        };
        pezzi.extend(dividi(sezione, ",")?);
    }
    for pezzo in pezzi {
        let pulito = pezzo.trim();
        if pulito.starts_with('…') || pulito.starts_with("..") {
            aperto = true;
            continue;
        }
        if pulito.is_empty() {
            return Err(errore(corpo, "un campo vuoto fra due virgole"));
        }
        let alternative = dividi(pulito, "|")?;
        let Some(prima) = testa(alternative[0], false)? else {
            // Il seguito del valore del campo prima: una frase o un numero
            // con una virgola dentro.
            match grezzi.last_mut() {
                Some(ultimo) if ultimo.ha_valore => {
                    let coda = ultimo.valore.pop().unwrap_or_default();
                    ultimo.valore.push(format!("{coda},{pezzo}"));
                    continue;
                }
                _ => {
                    return Err(errore(
                        pulito,
                        "il pezzo non comincia con il nome di un campo",
                    ))
                }
            }
        };
        let mut questi = vec![nuovo(&prima)];
        for alternativa in &alternative[1..] {
            let corrente = questi.last_mut().map(|c| c.ha_valore).unwrap_or(false);
            if let Some(altra) = testa(alternativa, corrente)? {
                questi.push(nuovo(&altra));
            } else if let (true, Some(ultimo)) = (corrente, questi.last_mut()) {
                ultimo.valore.push((*alternativa).to_owned());
            } else {
                return Err(errore(alternativa, "un'alternativa che non è un campo"));
            }
        }
        if questi.len() > 1 {
            for campo in &mut questi {
                campo.uno_fra = Some(gruppi);
            }
            gruppi += 1;
        }
        grezzi.extend(questi);
    }
    let mut visti = BTreeSet::new();
    let mut campi = Vec::new();
    for grezzo in grezzi {
        if !visti.insert(grezzo.nome.clone()) {
            return Err(errore(
                &grezzo.nome,
                "il campo compare due volte nella stessa forma",
            ));
        }
        let tipo = tipo_del_campo(&grezzo, lessico)?;
        campi.push(Campo {
            nome: grezzo.nome,
            tipo,
            facoltativo: grezzo.facoltativo,
            uno_fra: grezzo.uno_fra,
        });
    }
    Ok((campi, aperto))
}

fn nuovo(testa: &Testa<'_>) -> Grezzo {
    Grezzo {
        nome: testa.nome.to_owned(),
        facoltativo: testa.facoltativo,
        valore: testa.valore.map(|v| vec![v.to_owned()]).unwrap_or_default(),
        ha_valore: testa.valore.is_some(),
        uno_fra: None,
    }
}

// ------------------------------------------------------------ i tipi

/// Che cosa dice un'alternativa del valore.
#[derive(Debug, Clone, PartialEq)]
enum Pezzo {
    /// Una parola del tipo (`bool`, `index`, `name`): il tipo, se è un nome
    /// generico che il lessico può affinare, e la parola.
    Parola(Tipo, bool, String),
    /// Una parola che non è del tipo: un valore di una scelta.
    Valore(String),
    /// Una frase: il tipo della sua ultima parola.
    Frase(String, Tipo),
    /// Una stringa fra virgolette che non è un riferimento né un esempio.
    Letterale(String),
    /// Un tipo certo: un numero, sì/no, un riferimento, un esempio, JSON.
    Certo(Tipo),
    /// `null`: si ignora.
    Nullo,
}

/// Le parole del tipo che non possono essere anche un valore di una scelta:
/// `bool|top|none` è un sì/no o una parola, `range|newSheet` due parole.
fn solo_tipo(parola: &str) -> bool {
    matches!(
        parola,
        "bool" | "number" | "n" | "index" | "pages" | "percent" | "string" | "hex"
    )
}

fn parola_del_tipo(parola: &str) -> Option<(Tipo, bool)> {
    Some(match parola {
        "bool" => (Tipo::SiNo, false),
        "number" | "n" | "index" | "pages" | "percent" => (Tipo::Numero, false),
        "text" | "string" | "hex" => (Tipo::Testo, false),
        "name" | "id" | "field" => (Tipo::Testo, true),
        "cell" => (Tipo::Cella, false),
        "range" => (Tipo::Intervallo, false),
        _ => return None,
    })
}

fn numero(testo: &str) -> bool {
    let testo = testo.strip_prefix('-').unwrap_or(testo);
    let mut parti = testo.splitn(2, '.');
    let intero = parti.next().unwrap_or("");
    let decimali = parti.next();
    let intero_ok = !intero.is_empty()
        && (intero.chars().all(|c| c.is_ascii_digit())
            || intero.split(',').enumerate().all(|(i, g)| {
                g.chars().all(|c| c.is_ascii_digit())
                    && (if i == 0 {
                        !g.is_empty() && g.len() <= 3
                    } else {
                        g.len() == 3
                    })
            }));
    intero_ok && decimali.is_none_or(|d| !d.is_empty() && d.chars().all(|c| c.is_ascii_digit()))
}

/// `11`, `-0.25`, `1-7`, `10..400`, `-90..90`, `1–32767`, `2–8,760`.
fn numerico(testo: &str) -> bool {
    if numero(testo) {
        return true;
    }
    for separatore in ["..", "–", "-"] {
        let inizio = usize::from(testo.starts_with('-'));
        if let Some(at) = testo[inizio..].find(separatore) {
            let (a, b) = (
                &testo[..inizio + at],
                &testo[inizio + at + separatore.len()..],
            );
            if numero(a.trim()) && numero(b.trim()) {
                return true;
            }
        }
    }
    false
}

/// Una cella sola (`B2`, `$A$1`) o un riferimento (`A1:D10`, `B:D`,
/// `2:5`), con o senza foglio davanti.
fn riferimento(parte: &str) -> Option<bool> {
    let parte = match parte.rfind('!') {
        Some(at) if at > 0 => &parte[at + 1..],
        Some(_) => return None,
        None => parte,
    };
    let parte: String = parte.chars().filter(|c| *c != '$').collect();
    let colonna = |s: &str| (1..=3).contains(&s.len()) && s.chars().all(|c| c.is_ascii_uppercase());
    let riga =
        |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit()) && !s.starts_with('0');
    let cella = |s: &str| {
        let at = s.find(|c: char| c.is_ascii_digit()).unwrap_or(s.len());
        colonna(&s[..at]) && riga(&s[at..])
    };
    match parte.split_once(':') {
        None => cella(&parte).then_some(true),
        Some((a, b)) => {
            ((cella(a) && cella(b)) || (colonna(a) && colonna(b)) || (riga(a) && riga(b)))
                .then_some(false)
        }
    }
}

/// Il tipo di una stringa fra virgolette: un riferimento, un esempio, o un
/// letterale (un valore possibile di una scelta).
fn virgolettato(contenuto: &str) -> Pezzo {
    let parti: Vec<&str> = contenuto.split(',').map(str::trim).collect();
    let rif: Vec<Option<bool>> = parti.iter().map(|p| riferimento(p)).collect();
    if rif.iter().all(Option::is_some) {
        return if parti.len() == 1 && rif[0] == Some(true) {
            Pezzo::Certo(Tipo::Cella)
        } else {
            Pezzo::Certo(Tipo::Intervallo)
        };
    }
    if contenuto.is_empty()
        || contenuto.contains('…')
        || contenuto.contains("...")
        || contenuto.starts_with('#')
    {
        return Pezzo::Certo(Tipo::Testo);
    }
    Pezzo::Letterale(contenuto.to_owned())
}

/// `accent1..accent6` → `accent1`, …, `accent6`.
fn espandi(parola: &str) -> Option<Vec<String>> {
    let (a, b) = parola.split_once("..")?;
    let radice = a.trim_end_matches(|c: char| c.is_ascii_digit());
    let da: u32 = a[radice.len()..].parse().ok()?;
    let fino: u32 = b.strip_prefix(radice)?.parse().ok()?;
    (!radice.is_empty() && da < fino && fino - da < 64)
        .then(|| (da..=fino).map(|n| format!("{radice}{n}")).collect())
}

/// Legge un'alternativa del valore. `aperta` diventa vero se finisce con `…`.
fn pezzo(alternativa: &str, aperta: &mut bool, valori: &mut Vec<String>) -> Esito<Option<Pezzo>> {
    let mut testo = alternativa.trim().to_owned();
    // ` = descrizione` fuori dalle virgolette.
    if let Some(at) = dividi(&testo, " = ")?.first().map(|p| p.len()) {
        testo.truncate(at);
    }
    let mut testo = senza_note(&testo)?;
    if matches!(testo.as_str(), "…" | "..." | "..") {
        *aperta = true;
        return Ok(None);
    }
    if let Some(prima) = testo.strip_suffix('…') {
        *aperta = true;
        testo = prima.trim_end().to_owned();
    }
    let Some(prima) = testo.chars().next() else {
        return Err(errore(alternativa, "un valore vuoto"));
    };
    let pezzo = match prima {
        '"' => {
            let fine = virgolette_chiuse(&testo, 0)?;
            if !testo[fine + 1..].trim().is_empty() {
                return Err(errore(
                    alternativa,
                    "un valore che non si capisce: del testo dopo le virgolette",
                ));
            }
            virgolettato(&testo[1..fine])
        }
        '[' | '{' => {
            chiusa(&testo, 0)?;
            Pezzo::Certo(Tipo::Json)
        }
        _ => match testo.as_str() {
            "true" | "false" => Pezzo::Certo(Tipo::SiNo),
            "null" => Pezzo::Nullo,
            t if numerico(t) => Pezzo::Certo(Tipo::Numero),
            t => {
                if let Some((tipo, vago)) = parola_del_tipo(t) {
                    Pezzo::Parola(tipo, vago, t.to_owned())
                } else if let Some(espansi) = espandi(t) {
                    valori.extend(espansi);
                    return Ok(None);
                } else if t.contains(' ') {
                    if t.contains(['{', '[', '"', '|']) {
                        return Err(errore(alternativa, "una frase con dentro una struttura"));
                    }
                    let ultima = t.rsplit(' ').next().unwrap_or(t);
                    let tipo = parola_del_tipo(ultima).map_or(Tipo::Testo, |(tipo, _)| tipo);
                    Pezzo::Frase(t.to_owned(), tipo)
                } else if t
                    .chars()
                    .all(|c| c.is_alphanumeric() || matches!(c, '_' | '.' | '#' | '-' | '/'))
                {
                    Pezzo::Valore(t.to_owned())
                } else {
                    return Err(errore(alternativa, "un valore che non si capisce"));
                }
            }
        },
    };
    Ok(Some(pezzo))
}

fn tipo_del_campo(grezzo: &Grezzo, lessico: &[(&str, Tipo)]) -> Esito<Tipo> {
    let dal_lessico = lessico
        .iter()
        .find(|(nome, _)| *nome == grezzo.nome)
        .map(|(_, tipo)| tipo.clone());
    if !grezzo.ha_valore {
        return dal_lessico.ok_or_else(|| {
            errore(
                &grezzo.nome,
                "il campo non ha un valore che ne dica il tipo, e il lessico del motore non lo conosce",
            )
        });
    }
    let mut aperta = false;
    let mut espansi = Vec::new();
    let mut pezzi = Vec::new();
    for alternativa in &grezzo.valore {
        let parti = dividi(alternativa, " or ")?;
        let mut gruppo = Vec::new();
        for parte in &parti {
            if let Some(p) = pezzo(parte, &mut aperta, &mut espansi)? {
                gruppo.push(p);
            }
        }
        // `caption or source field`: una frase che nomina più cose, non dei
        // valori; vale il tipo della sua ultima parte.
        if parti.len() > 1 && gruppo.iter().any(|p| matches!(p, Pezzo::Frase(..))) {
            let tipo = match gruppo.last() {
                Some(Pezzo::Frase(_, tipo) | Pezzo::Parola(tipo, ..) | Pezzo::Certo(tipo)) => {
                    tipo.clone()
                }
                _ => Tipo::Testo,
            };
            pezzi.push(Pezzo::Frase(alternativa.trim().to_owned(), tipo));
        } else {
            pezzi.extend(gruppo);
        }
    }
    let tipo = combina(&grezzo.nome, pezzi, espansi, aperta)?;
    Ok(affina(tipo, dal_lessico))
}

/// Il tipo di un valore dalle sue alternative.
enum Combinato {
    Tipo(Tipo),
    /// Un nome generico (`name`, `id`) o tipi scalari diversi: il lessico
    /// può dire meglio.
    Vago(Tipo),
}

fn combina(nome: &str, pezzi: Vec<Pezzo>, espansi: Vec<String>, aperta: bool) -> Esito<Combinato> {
    let pezzi: Vec<Pezzo> = pezzi.into_iter().filter(|p| *p != Pezzo::Nullo).collect();
    if pezzi.is_empty() && espansi.is_empty() {
        return Err(errore(nome, "il valore non dice niente"));
    }
    // Una scelta: tutte parole (almeno una che non è del tipo) e frasi, o
    // tutte stringhe fra virgolette (almeno due, o aperta).
    // Una parola del tipo in mezzo ai valori di una scelta è un valore
    // anche lei (`numbers|text`), tranne quelle che sono soltanto un tipo:
    // `bool|top|none` è un sì/no o una parola, un valore JSON.
    let di_parole = pezzi
        .iter()
        .all(|p| matches!(p, Pezzo::Valore(_) | Pezzo::Parola(..) | Pezzo::Frase(..)))
        && (pezzi.iter().any(|p| matches!(p, Pezzo::Valore(_))) || !espansi.is_empty());
    if di_parole
        && pezzi
            .iter()
            .any(|p| matches!(p, Pezzo::Parola(_, _, parola) if solo_tipo(parola)))
    {
        return Ok(Combinato::Tipo(Tipo::Json));
    }
    let scelta_di_parole = di_parole;
    let scelta_di_letterali = !pezzi.is_empty()
        && pezzi.iter().all(|p| matches!(p, Pezzo::Letterale(_)))
        && (pezzi.len() >= 2 || aperta);
    if scelta_di_parole || scelta_di_letterali {
        let mut valori: Vec<String> = Vec::new();
        let mut vedi = |v: String| {
            if !valori.contains(&v) {
                valori.push(v);
            }
        };
        for p in pezzi {
            match p {
                Pezzo::Valore(v)
                | Pezzo::Parola(_, _, v)
                | Pezzo::Frase(v, _)
                | Pezzo::Letterale(v) => vedi(v),
                Pezzo::Certo(_) | Pezzo::Nullo => unreachable!("filtrati sopra"),
            }
        }
        for v in espansi {
            vedi(v);
        }
        return Ok(Combinato::Tipo(Tipo::Scelta { valori, aperta }));
    }
    if !espansi.is_empty() {
        return Err(errore(nome, "un elenco di valori mescolato con altro"));
    }
    let mut vago = false;
    let mut tipi: Vec<Tipo> = Vec::new();
    for p in pezzi {
        let tipo = match p {
            Pezzo::Parola(tipo, generico, _) => {
                vago |= generico;
                tipo
            }
            Pezzo::Valore(_) | Pezzo::Letterale(_) => Tipo::Testo,
            Pezzo::Frase(_, tipo) | Pezzo::Certo(tipo) => tipo,
            Pezzo::Nullo => continue,
        };
        if !tipi.contains(&tipo) {
            tipi.push(tipo);
        }
    }
    let ha = |t: &Tipo| tipi.contains(t);
    let tipo = if tipi.len() == 1 {
        tipi.remove(0)
    } else if tipi
        .iter()
        .all(|t| matches!(t, Tipo::Cella | Tipo::Intervallo))
    {
        Tipo::Intervallo
    } else if tipi
        .iter()
        .all(|t| matches!(t, Tipo::Cella | Tipo::Intervallo | Tipo::Testo))
    {
        Tipo::Testo
    } else if ha(&Tipo::Json) {
        Tipo::Json
    } else {
        // Scalari diversi (`index | name`, `"auto" | 0`): un valore JSON, se
        // il lessico non dice meglio.
        return Ok(Combinato::Vago(Tipo::Json));
    };
    Ok(if vago {
        Combinato::Vago(tipo)
    } else {
        Combinato::Tipo(tipo)
    })
}

fn affina(tipo: Combinato, lessico: Option<Tipo>) -> Tipo {
    match (tipo, lessico) {
        (Combinato::Vago(_), Some(dal_lessico)) if dal_lessico.riferimento() => dal_lessico,
        (Combinato::Tipo(Tipo::Cella), Some(Tipo::Intervallo)) => Tipo::Intervallo,
        (Combinato::Tipo(Tipo::Testo), Some(Tipo::Segreto)) => Tipo::Segreto,
        (Combinato::Tipo(tipo) | Combinato::Vago(tipo), _) => tipo,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn i_numeri() {
        for sì in [
            "11",
            "-0.25",
            "1-7",
            "10..400",
            "-90..90",
            "1–32767",
            "2–8,760",
            "0.001",
        ] {
            assert!(numerico(sì), "{sì}");
        }
        for no in ["", "-", "1.", "a1", "1..b", "12,34"] {
            assert!(!numerico(no), "{no}");
        }
    }

    #[test]
    fn i_riferimenti() {
        assert_eq!(riferimento("B2"), Some(true));
        assert_eq!(riferimento("$A$1"), Some(true));
        assert_eq!(riferimento("Sheet2!A1"), Some(true));
        assert_eq!(riferimento("A1:D10"), Some(false));
        assert_eq!(riferimento("B:D"), Some(false));
        assert_eq!(riferimento("2:5"), Some(false));
        assert_eq!(riferimento("Sheet1!$A$1:$E$200"), Some(false));
        for no in ["B", "=SUM(A1:A3)", "Book.xlsx", "A0", "!A1", "ABCD1"] {
            assert_eq!(riferimento(no), None, "{no}");
        }
    }

    #[test]
    fn le_parentesi() {
        assert_eq!(chiusa("{a (Ctrl+Shift+[) b}", 0), Ok(19));
        assert_eq!(chiusa("{a: \"}\"}", 0), Ok(7));
        assert!(chiusa("{a: [1, 2}", 0).is_err());
        assert!(chiusa("{a", 0).is_err());
    }

    #[test]
    fn le_note() {
        assert_eq!(senza_note("64 (pixels)").as_deref(), Ok("64"));
        assert_eq!(senza_note("B4 (ISO)").as_deref(), Ok("B4 (ISO)"));
        assert_eq!(
            senza_note("\"A1\" (default (nested))").as_deref(),
            Ok("\"A1\"")
        );
    }

    #[test]
    fn le_scelte_con_le_cifre() {
        assert_eq!(
            espandi("accent1..accent3"),
            Some(vec!["accent1".into(), "accent2".into(), "accent3".into()])
        );
        assert_eq!(espandi("1..3"), None);
        assert_eq!(espandi("a1..b3"), None);
    }
}
