//! Modificare **un pezzo** di documento: l'edit come primitiva del contratto.
//!
//! Fino a qui l'unico modo di cambiare un documento era
//! [`VaultWrite::write_document`](crate::traits::VaultWrite::write_document), cioè
//! riscrivere il file intero. Funziona per chi il file intero ce l'ha in mano —
//! l'editor che salva il proprio buffer, un importer che crea una nota — e non
//! funziona per nessun altro: spuntare un task (10.1), scrivere una proprietà
//! (8.2), correggere un link rotto (7.2), inserire un template col cursore dove
//! serve (16.1), riscrivere la selezione (22.2), accettare una modifica
//! suggerita (19.2). Tutte queste, senza una primitiva, fanno la stessa cosa:
//! leggono tutto, ricompongono tutto, riscrivono tutto. E **non si compongono**
//! — due automazioni che riscrivono lo stesso documento si sovrascrivono a
//! vicenda, e chi perde non lo sa.
//!
//! # La firma dice su cosa si applica
//!
//! Un edit è una coppia (dove, cosa): [`TextEdit`]. Ma una lista di edit senza
//! altro non è una modifica applicabile, è un'ipotesi: gli offset valgono per
//! **un** testo, e fra il momento in cui sono stati calcolati e quello in cui si
//! applicano il documento può essere cambiato. Per questo l'unità che attraversa
//! il confine è [`EditRequest`], che porta la [`Revision`] su cui gli edit sono
//! stati calcolati, e **non è opzionale**: un edit senza base è esattamente la
//! corsa che questa primitiva esiste per rendere visibile. Se la base non è più
//! quella, l'host risponde [`PluginError::Conflict`] e non scrive niente — chi
//! ha calcolato ricalcola.
//!
//! # La revisione è opaca
//!
//! Di una [`Revision`] è contratto **solo l'uguaglianza**. Non è un numero
//! d'ordine (non si confronta con `<`), non è un contenuto (non ci si legge
//! dentro), e come l'host la deriva non è promesso a nessuno: un host che
//! usasse un digest, un contatore o `mtime+size` sarebbe conforme uguale. Chi
//! deve prepararla la **chiede**
//! ([`VaultRead::document_revision`](crate::traits::VaultRead::document_revision));
//! [`Revision::of`] è come la deriva *questo* host — sta qui perché il kernel e
//! i doppi dei test ne abbiano una sola implementazione, non perché un provider
//! debba ricalcolarla per conto proprio.
//!
//! # Coordinate, e la disciplina che l'host applica
//!
//! Ogni [`Span`] della richiesta è in byte UTF-8 **del sorgente della base**, e
//! non nel testo che si sta via via producendo: gli edit sono un insieme, non
//! una sequenza di passi, e chi li calcola non deve tenere il conto degli
//! spostamenti. L'host li ordina, ne verifica la disciplina — dentro il
//! sorgente, su confini di carattere e di terminatore di riga, senza
//! sovrapposizioni e senza due edit nello stesso punto — e li applica in un
//! colpo solo. Ciò che non rispetta la disciplina è [`PluginError::BadArgs`],
//! non un edit applicato a metà.
//!
//! Cosa *sia* quel sorgente è scritto accanto a [`Span`]: i byte del file
//! decodificati, integralmente, BOM e terminatori compresi. Non è un dettaglio
//! di implementazione dell'host — è la premessa senza la quale un offset
//! calcolato da un provider e un offset applicato dall'host non sono lo stesso
//! numero.
//!
//! # Il confine di un `\r\n`
//!
//! `\r` e `\n` sono due caratteri ASCII, quindi l'offset che sta **fra** loro è
//! un confine di carattere valido e `is_char_boundary` lo accetta. Un edit che
//! ci finisce sopra spezza un terminatore di riga in due e lascia un `\r`
//! orfano: il file resta UTF-8 valido, e una riga che nessuno aveva nominato è
//! cambiata — che è esattamente ciò che «nessuna modifica fuori dallo span
//! dichiarato» (§2.4) vieta. Un `\r\n` è un terminatore solo, e i suoi due byte
//! non si separano più di quanto si separino i due byte di una `à`: la regola è
//! [`text_policy::splits_newline`](crate::rules::text_policy::splits_newline) e
//! il rifiuto è `BadArgs` come per il carattere tagliato a metà.
//!
//! # Il rapporto è nelle coordinate nuove, e l'inverso di un edit è un edit
//!
//! [`EditReport`] dice dov'è finito ciò che è stato scritto (le coordinate
//! servono a chi deve poi mettere il cursore: 16.1) e **cosa c'era prima**.
//! Sono i due pezzi con cui [`EditReport::inverse`] costruisce la modifica che
//! riporta il documento com'era: una [`EditRequest`] come le altre. Non è l'undo
//! (di chi sia la proprietà dell'undo è il §13.3 del piano, e non lo decide
//! questa firma): è la *forma* senza la quale quella decisione nascerebbe già
//! zoppa.
//!
//! # Cosa resta deliberatamente fuori
//!
//! - **Il lotto su più documenti** (decisione 0011): una richiesta nomina un documento
//!   solo, e N documenti sono N scritture con N eventi. Il lotto è una lista di
//!   edit *sopra* questa firma, non una firma diversa.
//! - **L'edit sull'evento** (decisione 0012): chi riceve `DocumentChanged` sa che il
//!   documento è cambiato, non *come*. Finché è così, una shell che ha il
//!   documento aperto non può applicare al proprio buffer la modifica che il
//!   kernel ha appena fatto — deve ricaricare, e ricaricare costa il cursore.
//! - **La fusione di due edit concorrenti** (18.1): qui il conflitto si
//!   **dichiara**, non si risolve. Un CRDT, se arriverà, avrà bisogno di questa
//!   forma per esprimersi; il contrario non è vero.

use serde::{Deserialize, Serialize};

use crate::error::PluginError;
use crate::model::Span;
use crate::rules::text_policy;

/// L'identità del sorgente su cui un edit è stato calcolato.
///
/// Opaca: solo l'uguaglianza è contratto (vedi il doc del modulo). La si ottiene
/// dall'host ([`VaultRead::document_revision`](crate::traits::VaultRead::document_revision));
/// [`Revision::of`] è la derivazione di *questo* host, non una promessa del
/// confine.
/// FNV-1a a 64 bit: un'impronta stabile legacy e non di sicurezza.
///
/// [`Revision`] non la usa più per i nuovi valori: resta qui per i sottosistemi
/// che hanno bisogno di una piccola impronta stabile e per riconoscere revisioni
/// persistite prima della migrazione a SHA-256. `DefaultHasher` non è adatto
/// nemmeno a questi usi perché non promette stabilità fra versioni e piattaforme.
///
/// Sta qui e non in una scatola di utilità perché la casa di questa regola è
/// chi ha il diritto di imporla: [`Revision::of_bytes`] è l'impronta che il
/// confine dichiara, e chi ne vuole il numero grezzo — perché lo scrive in un
/// suo archivio, non lo mostra — deve prendere *quella*, non riscriverla con le
/// stesse due costanti. Le due costanti compaiono una volta sola in tutto il
/// repo, ed è questo tipo.
///
/// Si mangia a pezzi perché chi impronta un documento non ha un unico blocco di
/// byte ma una sequenza di campi da separare:
///
/// ```
/// use fub_abi::Fnv1a;
/// let mut h = Fnv1a::new();
/// h.update(b"note/a.md");
/// h.update(&[0]);
/// h.update(b"testo");
/// assert_eq!(h.value(), Fnv1a::hash(b"note/a.md\0testo"));
/// ```
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Fnv1a(u64);

impl Fnv1a {
    const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;

    pub fn new() -> Self {
        Fnv1a(Self::OFFSET)
    }

    /// Aggiunge byte a ciò che è già stato mangiato.
    pub fn update(&mut self, bytes: &[u8]) {
        for b in bytes {
            self.0 ^= *b as u64;
            self.0 = self.0.wrapping_mul(Self::PRIME);
        }
    }

    /// Il numero grezzo di ciò che è stato mangiato finora.
    pub fn value(self) -> u64 {
        self.0
    }

    /// L'impronta di un blocco solo, per chi non ha pezzi da separare.
    pub fn hash(bytes: &[u8]) -> u64 {
        let mut h = Fnv1a::new();
        h.update(bytes);
        h.value()
    }
}

impl Default for Fnv1a {
    fn default() -> Self {
        Fnv1a::new()
    }
}

/// SHA-256 usato dalle revisioni. È privato: il contratto espone la revisione
/// come valore opaco, non l'algoritmo come API da riutilizzare altrove.
fn sha256(bytes: &[u8]) -> [u8; 32] {
    const H0: [u32; 8] = [
        0x6a09_e667,
        0xbb67_ae85,
        0x3c6e_f372,
        0xa54f_f53a,
        0x510e_527f,
        0x9b05_688c,
        0x1f83_d9ab,
        0x5be0_cd19,
    ];
    const K: [u32; 64] = [
        0x428a_2f98,
        0x7137_4491,
        0xb5c0_fbcf,
        0xe9b5_dba5,
        0x3956_c25b,
        0x59f1_11f1,
        0x923f_82a4,
        0xab1c_5ed5,
        0xd807_aa98,
        0x1283_5b01,
        0x2431_85be,
        0x550c_7dc3,
        0x72be_5d74,
        0x80de_b1fe,
        0x9bdc_06a7,
        0xc19b_f174,
        0xe49b_69c1,
        0xefbe_4786,
        0x0fc1_9dc6,
        0x240c_a1cc,
        0x2de9_2c6f,
        0x4a74_84aa,
        0x5cb0_a9dc,
        0x76f9_88da,
        0x983e_5152,
        0xa831_c66d,
        0xb003_27c8,
        0xbf59_7fc7,
        0xc6e0_0bf3,
        0xd5a7_9147,
        0x06ca_6351,
        0x1429_2967,
        0x27b7_0a85,
        0x2e1b_2138,
        0x4d2c_6dfc,
        0x5338_0d13,
        0x650a_7354,
        0x766a_0abb,
        0x81c2_c92e,
        0x9272_2c85,
        0xa2bf_e8a1,
        0xa81a_664b,
        0xc24b_8b70,
        0xc76c_51a3,
        0xd192_e819,
        0xd699_0624,
        0xf40e_3585,
        0x106a_a070,
        0x19a4_c116,
        0x1e37_6c08,
        0x2748_774c,
        0x34b0_bcb5,
        0x391c_0cb3,
        0x4ed8_aa4a,
        0x5b9c_ca4f,
        0x682e_6ff3,
        0x748f_82ee,
        0x78a5_636f,
        0x84c8_7814,
        0x8cc7_0208,
        0x90be_fffa,
        0xa450_6ceb,
        0xbef9_a3f7,
        0xc671_78f2,
    ];

    let bit_len = (bytes.len() as u64).wrapping_mul(8);
    let mut padded = bytes.to_vec();
    padded.push(0x80);
    while padded.len() % 64 != 56 {
        padded.push(0);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());

    let mut h = H0;
    for chunk in padded.chunks_exact(64) {
        let mut w = [0u32; 64];
        for (slot, word) in w[..16].iter_mut().zip(chunk.chunks_exact(4)) {
            *slot = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = h;
        for (&k, &word) in K.iter().zip(w.iter()) {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let choice = (e & f) ^ ((!e) & g);
            let t1 = hh
                .wrapping_add(s1)
                .wrapping_add(choice)
                .wrapping_add(k)
                .wrapping_add(word);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let majority = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(majority);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }
        for (slot, value) in h.iter_mut().zip([a, b, c, d, e, f, g, hh]) {
            *slot = slot.wrapping_add(value);
        }
    }

    let mut out = [0u8; 32];
    for (slot, value) in out.chunks_exact_mut(4).zip(h) {
        slot.copy_from_slice(&value.to_be_bytes());
    }
    out
}

fn sha256_text(bytes: &[u8]) -> String {
    use std::fmt::Write as _;

    let mut out = String::with_capacity(7 + 64);
    out.push_str("sha256:");
    for byte in sha256(bytes) {
        write!(&mut out, "{byte:02x}").expect("scrivere dentro String non fallisce");
    }
    out
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Revision(pub String);

impl Revision {
    pub fn new(raw: impl Into<String>) -> Self {
        Revision(raw.into())
    }

    /// L'impronta di un sorgente, come la deriva questo host: SHA-256 con
    /// prefisso `sha256:`. Il prefisso rende esplicito il formato persistito e
    /// permette alla migrazione di distinguere le vecchie revisioni FNV-1a.
    ///
    /// È **contenuto**, non tempo né ordine, e la differenza si vede in un caso
    /// vero: chi scrive un carattere e lo cancella riporta il documento al testo
    /// di prima, e un edit calcolato allora è ancora valido adesso — un
    /// contatore direbbe di no e farebbe ricalcolare per niente.
    ///
    /// La forma della stringa non è contratto: chi la confronta con una sua
    /// dipende da questo host, e ciò che il confine promette è solo che due
    /// revisioni uguali sono lo stesso sorgente.
    pub fn of(source: &str) -> Self {
        Revision::of_bytes(source.as_bytes())
    }

    /// La stessa impronta, presa sui byte.
    ///
    /// Serve a chi ha una sorgente che **non è testo**: un documento che il suo
    /// provider vuole a byte ([`SourceKind::Bytes`](crate::format::SourceKind))
    /// non si può decodificare per prenderne l'impronta, e non deve — chi
    /// indicizza confronta impronte, non testi. Per una sorgente UTF-8 le due
    /// funzioni danno lo stesso valore, che è la ragione per cui è la stessa
    /// famiglia e non una seconda: un documento non cambia impronta il giorno
    /// che qualcuno lo rivendica a byte.
    pub fn of_bytes(source: &[u8]) -> Self {
        Revision(sha256_text(source))
    }

    /// Verifica una revisione contro i byte reali. Accetta la forma SHA-256
    /// corrente e, soltanto durante la migrazione, la vecchia FNV-1a a 16 cifre.
    /// Ogni valore nuovo emesso dall'host resta comunque SHA-256.
    pub fn matches_bytes(&self, source: &[u8]) -> bool {
        if self.0.starts_with("sha256:") {
            return self.0 == sha256_text(source);
        }
        self.0.len() == 16
            && self.0.bytes().all(|byte| byte.is_ascii_hexdigit())
            && self
                .0
                .eq_ignore_ascii_case(&format!("{:016x}", Fnv1a::hash(source)))
    }

    pub fn matches(&self, source: &str) -> bool {
        self.matches_bytes(source.as_bytes())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for Revision {
    /// La revisione del documento vuoto: è la base con cui si scrive dentro una
    /// nota appena creata, non un segnaposto da riempire.
    fn default() -> Self {
        Revision::of("")
    }
}

/// **Da cosa parte** una riscrittura totale: o discende da una revisione, o è
/// dettata.
///
/// È il parametro di
/// [`write_document`](crate::traits::VaultWrite::write_document), e i suoi due
/// casi sono due significati, non un valore e la sua assenza.
///
/// # Perché non è un `Option<Revision>`
///
/// Perché lo è stato, e il difetto si è visto. Una guardia contro la
/// sovrascrittura che si ottiene **passando** qualcosa e si perde
/// **omettendola** protegge chi si ricorda di attivarla, cioè non protegge:
/// scrivere ciechi era il default, e il default non lo sceglie nessuno. Con due
/// casi nominati scrivere ciechi resta possibile — deve restarlo, un importer
/// non discende da niente — ma diventa una cosa che si **dichiara**, e una
/// dichiarazione la si legge in review.
///
/// È il criterio della
/// [0007](../../../docs/decisions/README.md): *«un flag che
/// chiunque può dimenticare di leggere protegge meno di un campo che, quando
/// non è vero, non c'è»*. Qui il campo non manca mai, e allora la stessa regola
/// dice l'altra metà: **quando c'è una scelta, la si nomina**.
///
/// # I due casi, e a chi appartengono
///
/// [`DescendsFrom`](WriteBase::DescendsFrom) è di chi ha **letto** il testo di
/// prima e ne sta consegnando una versione modificata: l'editor che salva il
/// proprio buffer. Se il file non è più quello, l'host risponde
/// [`Conflict`](crate::error::PluginError::Conflict) e non scrive niente.
///
/// [`Dictated`](WriteBase::Dictated) è di chi il testo lo **produce**: un
/// importer che crea una nota, un template che scrive la nota di oggi, il
/// ripristino di una versione, l'utente che ha visto il conflitto e ha risposto
/// «vince il mio testo». Nessuno di loro sta correggendo un testo che ha letto,
/// e obbligarli a esibire una base vorrebbe dire farsela inventare — una base
/// inventata è una guardia che dice sempre di sì.
///
/// L'ordine dei casi è il discriminante al confine e non si tocca:
/// `descends-from` sta per primo perché è quello **guardato**, cioè quello che
/// una firma su cui si può sbagliare deve nominare per primo.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
// Tag adiacente come [`LinkTarget`](crate::model::LinkTarget): un caso porta uno
// scalare e l'altro niente, e col tag interno `serde_json` non li
// serializzerebbe entrambi.
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum WriteBase {
    /// «Scrivi solo se il file è ancora quello da cui sono partito.»
    DescendsFrom(Revision),
    /// «Scrivi: questo testo non discende da un testo di prima, e se ne copre
    /// uno è voluto.»
    Dictated,
}

impl WriteBase {
    /// La revisione attesa, se questa scrittura ne ha una.
    ///
    /// Non è un ritorno all'`Option`: è la lettura che serve a chi la guardia la
    /// **applica** — un punto solo, dentro l'host — e che a chiamare
    /// `write_document` non serve mai.
    pub fn expected(&self) -> Option<&Revision> {
        match self {
            WriteBase::DescendsFrom(r) => Some(r),
            WriteBase::Dictated => None,
        }
    }
}

/// Una sostituzione: i byte dentro `span` diventano `text`.
///
/// Le tre operazioni sono la stessa cosa vista da tre parti: inserire è uno span
/// vuoto, cancellare è un testo vuoto, sostituire è nessuno dei due. Un enum a
/// tre casi avrebbe costretto ogni consumatore a distinguerle per poi trattarle
/// uguali.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextEdit {
    /// Dove, in **byte UTF-8 del sorgente della base** — mai del testo in corso
    /// di produzione.
    pub span: Span,
    pub text: String,
}

impl TextEdit {
    pub fn replace(span: Span, text: impl Into<String>) -> Self {
        TextEdit {
            span,
            text: text.into(),
        }
    }

    /// Inserisce a `at` senza togliere niente.
    pub fn insert(at: usize, text: impl Into<String>) -> Self {
        TextEdit {
            span: Span::new(at, at),
            text: text.into(),
        }
    }

    /// Toglie i byte di `span` senza metterci niente.
    pub fn delete(span: Span) -> Self {
        TextEdit {
            span,
            text: String::new(),
        }
    }
}

/// Una modifica chirurgica a un documento: gli edit, e il sorgente su cui sono
/// stati calcolati.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EditRequest {
    /// La revisione del sorgente in cui gli `span` degli edit sono veri. Non è
    /// opzionale: vedi il doc del modulo.
    pub base: Revision,
    /// Un insieme, non una sequenza: l'ordine in cui li si elenca non conta, e
    /// due edit non possono contendersi lo stesso punto.
    pub edits: Vec<TextEdit>,
}

impl EditRequest {
    pub fn new(base: Revision, edits: Vec<TextEdit>) -> Self {
        EditRequest { base, edits }
    }

    /// Applica la richiesta a `source`, restituendo il testo nuovo e il rapporto.
    ///
    /// È qui, e non nei chiamanti, che la base viene verificata: un host che
    /// dovesse ricordarsi di controllarla prima di chiamare, prima o poi non se
    /// lo ricorderebbe. Non scrive niente e non conosce il vault — è la parte
    /// pura dell'operazione, condivisa fra il kernel e i doppi dei test.
    ///
    /// `Err(Conflict)` = il sorgente non è più quello su cui gli edit sono stati
    /// calcolati; `Err(BadArgs)` = gli edit non rispettano la disciplina (fuori
    /// dal sorgente, a metà di un carattere, sovrapposti, o due nello stesso
    /// punto). In entrambi i casi non c'è un risultato parziale.
    pub fn apply_to(&self, source: &str) -> Result<(String, EditReport), PluginError> {
        let current = Revision::of(source);
        if !self.base.matches(source) {
            return Err(PluginError::Conflict(
                format!(
                    "il sorgente è cambiato: l'edit è stato calcolato su {}, ora è {}",
                    self.base.as_str(),
                    current.as_str()
                )
                .into(),
            ));
        }

        let mut ordered: Vec<&TextEdit> = self.edits.iter().collect();
        ordered.sort_by_key(|and| and.span.start);
        let mut previous: Option<Span> = None;
        for edit in &ordered {
            let span = edit.span;
            if span.start > span.end {
                return Err(PluginError::BadArgs(
                    format!("span rovesciato: {}..{}", span.start, span.end).into(),
                ));
            }
            if span.end > source.len() {
                return Err(PluginError::BadArgs(
                    format!(
                        "span fuori dal sorgente: {}..{} su {} byte",
                        span.start,
                        span.end,
                        source.len()
                    )
                    .into(),
                ));
            }
            if !source.is_char_boundary(span.start) || !source.is_char_boundary(span.end) {
                // Tagliare un carattere UTF-8 a metà non produce un documento
                // sbagliato: produce byte che non sono testo, e il documento
                // non si riapre più.
                return Err(PluginError::BadArgs(
                    format!("span a metà di un carattere: {}..{}", span.start, span.end).into(),
                ));
            }
            if text_policy::splits_newline(source, span.start)
                || text_policy::splits_newline(source, span.end)
            {
                // L'altro confine, quello che `is_char_boundary` non vede: fra
                // il `\r` e il `\n` di una coppia. Qui non si perde la validità
                // del testo, si perde una riga che nessuno aveva nominato — e
                // in silenzio, perché il file resta perfettamente leggibile.
                return Err(PluginError::BadArgs(
                    format!(
                        "span a metà di un terminatore di riga: {}..{}",
                        span.start, span.end
                    )
                    .into(),
                ));
            }
            if let Some(prev) = previous {
                if span.start < prev.end {
                    return Err(PluginError::BadArgs(
                        format!(
                            "edit sovrapposti: {}..{} e {}..{}",
                            prev.start, prev.end, span.start, span.end
                        )
                        .into(),
                    ));
                }
                if span.start == prev.start {
                    // Due edit che cominciano nello stesso punto (tipicamente
                    // due inserimenti) hanno un esito che dipende dall'ordine, e
                    // l'ordine qui non è dato: chi vuole due cose in un punto
                    // solo scrive un edit solo.
                    return Err(PluginError::BadArgs(
                        format!("due edit nello stesso punto: {}", span.start).into(),
                    ));
                }
            }
            previous = Some(span);
        }

        let capacity = ordered.iter().fold(source.len(), |len, edit| {
            len - (edit.span.end - edit.span.start) + edit.text.len()
        });
        let mut out = String::with_capacity(capacity);
        let mut applied = Vec::with_capacity(ordered.len());
        let mut pos = 0usize;
        for edit in ordered {
            out.push_str(&source[pos..edit.span.start]);
            let start = out.len();
            out.push_str(&edit.text);
            applied.push(AppliedEdit {
                span: Span::new(start, out.len()),
                replaced: source[edit.span.start..edit.span.end].to_string(),
            });
            pos = edit.span.end;
        }
        out.push_str(&source[pos..]);

        let report = EditReport {
            revision: Revision::of(&out),
            applied,
        };
        Ok((out, report))
    }
}

/// Un edit applicato: dov'è finito nel testo **nuovo**, e cosa c'era prima.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppliedEdit {
    /// Il testo inserito, nelle coordinate del sorgente **dopo** la modifica.
    /// Vuoto (`start == end`) quando l'edit ha solo cancellato.
    pub span: Span,
    /// I byte che c'erano al suo posto. Vuoto quando l'edit ha solo inserito.
    pub replaced: String,
}

/// L'esito di una modifica chirurgica: la revisione nuova e cosa è stato fatto.
///
/// La revisione nuova non è un di più: è ciò che permette di concatenare un
/// secondo edit senza rileggere il documento — e senza rileggerlo *sperando*
/// che nel frattempo non sia cambiato.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct EditReport {
    pub revision: Revision,
    /// In ordine di documento, qualunque fosse l'ordine della richiesta.
    pub applied: Vec<AppliedEdit>,
}

impl EditReport {
    /// La modifica che riporta il documento com'era prima.
    ///
    /// Gli edit tornano già nelle coordinate del testo nuovo e restano
    /// disgiunti, quindi sono una richiesta come le altre: `base` è la revisione
    /// prodotta da questo rapporto, ed è il modo in cui un annullamento si
    /// accorge che qualcuno ha scritto nel frattempo, invece di cancellargli il
    /// lavoro.
    pub fn inverse(&self) -> EditRequest {
        let mut edits: Vec<TextEdit> = Vec::with_capacity(self.applied.len());
        for a in &self.applied {
            match edits.last_mut() {
                // Due edit applicati possono condividere il punto di partenza, e
                // succede appena uno di essi ha solo cancellato: nel testo nuovo
                // ciò che ha tolto non occupa spazio. I loro inversi quel punto
                // non possono condividerlo (sarebbero due edit nello stesso
                // punto) e non devono: là il documento ha una cosa sola da
                // riavere, ed è la somma delle due nell'ordine in cui stavano.
                Some(last) if last.span.start == a.span.start => {
                    last.span.end = last.span.end.max(a.span.end);
                    last.text.push_str(&a.replaced);
                }
                _ => edits.push(TextEdit {
                    span: a.span,
                    text: a.replaced.clone(),
                }),
            }
        }
        EditRequest {
            base: self.revision.clone(),
            edits,
        }
    }

    /// La modifica non ha toccato niente (nessun edit)?
    pub fn is_empty(&self) -> bool {
        self.applied.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(source: &str, edits: Vec<TextEdit>) -> EditRequest {
        EditRequest::new(Revision::of(source), edits)
    }

    #[test]
    fn revision_uses_sha256_and_reads_legacy_fnv_during_migration() {
        assert_eq!(
            Revision::of("").as_str(),
            "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            Revision::of("abc").as_str(),
            "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            Revision::of("foobar").as_str(),
            "sha256:c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2"
        );

        let legacy = Revision::new(format!("{:016x}", Fnv1a::hash(b"foobar")));
        assert!(legacy.matches("foobar"));
        assert!(!legacy.matches("barfoo"));
        let request = EditRequest::new(legacy, vec![TextEdit::insert(6, "!")]);
        assert_eq!(request.apply_to("foobar").unwrap().0, "foobar!");
    }

    #[test]
    fn the_edits_are_a_set_and_the_result_does_not_depend_on_their_order() {
        let source = "uno due tre";
        // Elencati al contrario: gli span sono nelle coordinate della base, e
        // chi li calcola non deve tenere il conto di quanto si è spostato il
        // testo per via degli altri.
        let req = request(
            source,
            vec![
                TextEdit::replace(Span::new(8, 11), "TRE"),
                TextEdit::replace(Span::new(0, 3), "UNO"),
            ],
        );
        let (out, report) = req.apply_to(source).unwrap();
        assert_eq!(out, "UNO due TRE");
        assert_eq!(
            report
                .applied
                .iter()
                .map(|a| (a.span.start, a.span.end, a.replaced.as_str()))
                .collect::<Vec<_>>(),
            vec![(0, 3, "uno"), (8, 11, "tre")],
            "il rapporto è in ordine di documento, non di richiesta"
        );
    }

    #[test]
    fn insert_and_delete_are_replace_seen_from_two_sides() {
        let source = "ab";
        let (out, report) = request(source, vec![TextEdit::insert(1, "-X-")])
            .apply_to(source)
            .unwrap();
        assert_eq!(out, "a-X-b");
        assert_eq!(report.applied[0].span, Span::new(1, 4));
        assert!(
            report.applied[0].replaced.is_empty(),
            "an insertion removed nothing"
        );

        let (out, report) = request(source, vec![TextEdit::delete(Span::new(0, 1))])
            .apply_to(source)
            .unwrap();
        assert_eq!(out, "b");
        assert_eq!(
            (report.applied[0].span, report.applied[0].replaced.as_str()),
            (Span::new(0, 0), "a"),
            "a deletion leaves an empty span where the text no longer is"
        );
    }

    #[test]
    fn a_stale_base_is_a_conflict_and_produces_nothing() {
        let req = request("first", vec![TextEdit::insert(0, "x")]);
        let err = req.apply_to("first, then more").unwrap_err();
        assert!(
            matches!(err, PluginError::Conflict(_)),
            "a base that does not match is a conflict, not `BadArgs`: {err:?}"
        );
    }

    #[test]
    fn the_discipline_of_the_spans_is_checked_before_anything_is_produced() {
        let source = "0123456789";
        let cases: Vec<(&str, Vec<TextEdit>)> = vec![
            (
                "outside source",
                vec![TextEdit::replace(Span::new(8, 12), "x")],
            ),
            ("reversed", vec![TextEdit::replace(Span::new(6, 3), "x")]),
            (
                "sovrapposti",
                vec![
                    TextEdit::replace(Span::new(0, 5), "a"),
                    TextEdit::replace(Span::new(3, 7), "b"),
                ],
            ),
            (
                "two at the same point",
                vec![TextEdit::insert(2, "a"), TextEdit::insert(2, "b")],
            ),
        ];
        for (name, edits) in cases {
            let err = request(source, edits).apply_to(source).unwrap_err();
            assert!(
                matches!(err, PluginError::BadArgs(_)),
                "{name}: atteso BadArgs, ottenuto {err:?}"
            );
        }
    }

    #[test]
    fn a_span_in_the_middle_of_a_character_is_refused() {
        // "è" sono due byte: 1..2 è dentro il carattere.
        let source = "è vero";
        let err = request(source, vec![TextEdit::replace(Span::new(1, 2), "x")])
            .apply_to(source)
            .unwrap_err();
        assert!(
            matches!(err, PluginError::BadArgs(_)),
            "cutting a character in half does not produce text: {err:?}"
        );

        // Sul confine giusto, invece, si applica: gli span del modello sono in
        // byte, e i byte di un accento sono due.
        let (out, _) = request(source, vec![TextEdit::replace(Span::new(0, 2), "e")])
            .apply_to(source)
            .unwrap();
        assert_eq!(out, "e vero");
    }

    #[test]
    fn a_span_in_the_middle_of_a_line_ending_is_refused() {
        // Il caso ostile del §15.5: `\r` e `\n` sono due caratteri ASCII, quindi
        // l'offset fra loro passa `is_char_boundary` e il testo che ne uscirebbe
        // è UTF-8 valido. Ciò che si perde è una riga che nessuno ha nominato.
        let source = "prima\r\ndopo\r\n";
        let between = source.find('\n').expect("there is a \\n");
        assert!(
            source.is_char_boundary(between),
            "for `str` it is a valid boundary"
        );

        for span in [Span::new(between, source.len()), Span::new(0, between)] {
            let err = request(source, vec![TextEdit::replace(span, "x")])
                .apply_to(source)
                .unwrap_err();
            assert!(
                matches!(err, PluginError::BadArgs(_)),
                "{span:?}: breaking a `\\r\\n` is not an edit: {err:?}"
            );
        }

        // Il terminatore intero, invece, si sostituisce: è un edit che dichiara
        // di toccare la fine della riga, e la tocca tutta.
        let (out, _) = request(source, vec![TextEdit::replace(Span::new(5, 7), "\n")])
            .apply_to(source)
            .unwrap();
        assert_eq!(out, "prima\ndopo\r\n");
    }

    #[test]
    fn an_edit_on_a_crlf_file_does_not_normalize_other_lines() {
        // La fedeltà del §2.4 vista dalla primitiva: chi modifica una parola in
        // un file CRLF lascia i terminatori dove sono, tutti.
        let source = "one\r\ntwo\r\nthree\r\n";
        let start = source.find("two").expect("there is `two`");
        let (out, report) = request(
            source,
            vec![TextEdit::replace(Span::new(start, start + 3), "second")],
        )
        .apply_to(source)
        .unwrap();
        assert_eq!(out, "one\r\nsecond\r\nthree\r\n");
        assert_eq!(
            text_policy::Newline::of(&out),
            text_policy::Newline::Crlf,
            "the file was CRLF and stays CRLF: no line outside the span"
        );
        // E l'inverso riporta ai byte esatti di prima, terminatori compresi.
        // Due edit adiacenti di cui il primo cancella finiscono nel testo nuovo
        let (returned, _) = report.inverse().apply_to(&out).unwrap();
        assert_eq!(returned, source);
    }

    #[test]
    fn no_edits_is_not_an_error_and_changes_nothing() {
        let source = "intatto";
        let (out, report) = request(source, vec![]).apply_to(source).unwrap();
        assert_eq!(out, source);
        assert!(report.is_empty());
        assert_eq!(
            report.revision,
            Revision::of(source),
            "without edits the revision stays the same"
        );
    }

    #[test]
    fn the_inverse_of_an_edit_is_an_edit_that_puts_it_back() {
        let source = "# Titolo\n\nnota su [[Vecchia]] e altro.\n";
        let req = request(
            source,
            vec![
                TextEdit::replace(Span::new(20, 27), "Nuova"),
                TextEdit::insert(source.len(), "coda\n"),
            ],
        );
        let (nuovo, report) = req.apply_to(source).unwrap();
        assert!(nuovo.contains("[[Nuova]]") && nuovo.ends_with("coda\n"));

        let indietro = report.inverse();
        assert_eq!(
            indietro.base, report.revision,
            "l'inverso si applica al testo che il rapporto descrive"
        );
        let (tornato, _) = indietro.apply_to(&nuovo).unwrap();
        assert_eq!(tornato, source, "andata e ritorno, byte per byte");
    }

    #[test]
    fn the_inverse_survives_edits_that_collapse_onto_the_same_point() {
        // **nello stesso punto**: ciò che è stato tolto lì non occupa spazio. I
        // loro inversi non possono stare tutti e due lì, e devono comunque
        // riportare il documento intero.
        // Scrivere una lettera e cancellarla riporta il documento a com'era: un
        let source = "abcdefghi";
        for edits in [
            vec![
                TextEdit::delete(Span::new(0, 5)),
                TextEdit::delete(Span::new(5, 8)),
            ],
            vec![TextEdit::delete(Span::new(0, 5)), TextEdit::insert(5, "X")],
        ] {
            let (new_text, report) = request(source, edits).apply_to(source).unwrap();
            let (returned, _) = report.inverse().apply_to(&new_text).unwrap();
            assert_eq!(returned, source, "from \"{new_text}\" we must come back");
        }
    }

    #[test]
    fn a_revision_is_content_not_time() {
        assert_eq!(Revision::of("uguale"), Revision::of("uguale"));
        assert_ne!(Revision::of("uguale"), Revision::of("diverso"));
        // Scrivere una lettera e cancellarla riporta il documento a com'era: un
        // edit calcolato allora vale ancora adesso.
        let req = request("testo", vec![TextEdit::insert(0, "x")]);
        assert!(req.apply_to("testo").is_ok());
    }

    ///
    /// Sono l'unica cosa che tiene ferma l'impronta il giorno che qualcuno la
    /// «semplifica»: da quando l'indice di ricerca e lo store delle versioni
    /// passano di qui (difetto 0223), cambiare una delle due costanti non fa
    /// più fallire niente per conto suo — ogni archivio resta coerente con sé
    /// stesso — ma rende illeggibile ciò che è già su disco.
    // Mangiata a pezzi o in un blocco solo è lo stesso numero: è ciò su cui
    #[test]
    fn the_fingerprint_not_is_moves() {
        assert_eq!(Fnv1a::hash(b""), 0xcbf2_9ce4_8422_2325);
        assert_eq!(Fnv1a::hash(b"a"), 0xaf63_dc4c_8601_ec8c);
        // conta chi impronta un documento campo per campo.
        // E la revisione del confine è quel numero in esadecimale, non un'altra
        let mut h = Fnv1a::new();
        h.update(b"fo");
        h.update(b"obar");
        assert_eq!(h.value(), Fnv1a::hash(b"foobar"));
        // famiglia di impronte.
        // famiglia di impronte.
        assert_eq!(
            Revision::of("foobar").as_str(),
            "sha256:c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2"
        );
    }

    #[test]
    fn a_request_survives_the_json_boundary() {
        let req = EditRequest::new(
            Revision::of("sorgente"),
            vec![TextEdit::replace(Span::new(1, 3), "ab")],
        );
        let json = serde_json::to_string(&req).unwrap();
        assert_eq!(serde_json::from_str::<EditRequest>(&json).unwrap(), req);

        let report = EditReport {
            revision: Revision::of("new"),
            applied: vec![AppliedEdit {
                span: Span::new(1, 3),
                replaced: "xy".into(),
            }],
        };
        let json = serde_json::to_string(&report).unwrap();
        assert_eq!(serde_json::from_str::<EditReport>(&json).unwrap(), report);
    }
}
