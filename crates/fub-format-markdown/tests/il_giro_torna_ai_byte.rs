//! **Ciò che rientra dal serializzatore è ciò che era uscito.**
//!
//! # Perché serviva un quarto banco sul giro
//!
//! Del giro `sorgente → modello → sorgente` questo crate chiedeva già tre cose,
//! e nessuna delle tre vede la classe di difetto che sta qui:
//!
//! - `serialize_non_cancella.rs` confronta **due modelli** (`parse(src)` contro
//!   `parse(serialize(parse(src)))`) sulle parole, sulla forma dell'albero e
//!   sulle ancore. È cieco per costruzione a tutto ciò che il *modello* non
//!   distingue: se il parser butta un'informazione, le due passate sono
//!   d'accordo fra loro e in disaccordo col file;
//! - `il_corpus.rs` chiede che il modello **dica il vero sulla sorgente**, cioè
//!   sugli span e sui campi che ci sono — non che la sorgente si sappia
//!   riscrivere;
//! - `il_frontmatter_non_si_perde.rs` chiede la stessa cosa di qui, ma su un
//!   costrutto solo.
//!
//! La domanda di questo file è la più semplice delle quattro e nessuno la
//! faceva: **riscrivendo un documento canonico tornano gli stessi byte?** È
//! l'unica forma in cui si vedono le cinque perdite che l'audit aveva misurato,
//! perché ognuna di esse è un'informazione che stava nel file, che nel modello
//! non aveva un posto (o che la scrittura non guardava), e che il round-trip
//! modello↔modello non poteva rimpiangere:
//!
//! | difetto | cosa si perdeva | dove stava il buco |
//! |---|---|---|
//! | 0213 | il frontmatter presente e senza chiavi | il modello: una mappa vuota non dice «assente» o «vuoto» |
//! | 0214 | l'alias uguale al bersaglio (`[[Nota\|Nota]]`) | il modello: l'etichetta era sintetizzata, non letta |
//! | 0215 | il numero di partenza di una lista ordinata | il modello: il campo non c'era |
//! | 0216 | i blocchi di una nota a piè di pagina, fusi in uno | la scrittura |
//! | 0218 | le destinazioni con spazi o parentesi spaiate | la scrittura |
//!
//! # Cosa questo file NON chiede, e perché la distinzione regge
//!
//! Non chiede il round-trip di *qualunque* markdown: `serialize` resta
//! **lossy per costruzione** ([0059](../../../docs/decisions/0059-la-generazione-non-e-un-round-trip.md))
//! — `_corsivo_` torna `*corsivo*`, l'indentazione scelta non torna. Chiede il
//! round-trip di documenti **già scritti nella forma che il serializer
//! genera**: su quelli non c'è niente da normalizzare, quindi ogni differenza
//! che resta è un'informazione persa e non uno stile cambiato. È il criterio
//! che rende questa proprietà un presidio invece che un'opinione, ed è anche
//! ciò che la tiene stabile: un caso che oggi diverge per lo stile non entra
//! qui, entra nel corpus dell'altro banco con la sua riga di divergenza.
//!
//! # La divergenza trovata montandolo, che resta fuori con la sua ragione
//!
//! Una **riga orizzontale in testa al documento** non si sa riscrivere: `---`
//! da solo in prima riga è un `Block::ThematicBreak`, e riscritto in prima riga
//! è il delimitatore d'apertura di un frontmatter per chiunque lo rilegga, noi
//! compresi. Non è un difetto di questo modulo — è che quei tre caratteri in
//! quella posizione **sono** due sintassi, e sceglierne una è una decisione che
//! si vede da fuori (una riga orizzontale che sparisce, o un frontmatter che
//! diventa una riga). Sta qui scritta perché nessuno la riscopra da capo.

use fub_abi::format::{FormatProvider, ParseContext};
use fub_abi::model::DocumentModel;
use fub_format_markdown::MarkdownProvider;

fn parse(src: &str) -> DocumentModel {
    MarkdownProvider::new()
        .parse(&src.into(), &ParseContext::obsidian("nota.md"))
        .expect("il caso è markdown, e il markdown parsa")
}

fn serialize(model: &DocumentModel) -> String {
    MarkdownProvider::new()
        .serialize(model)
        .expect("il modello si serializza")
}

/// I documenti canonici, con il difetto che ciascuno rende rosso.
///
/// Accanto a ogni caso c'è il suo **controcaso**: la forma vicina che già
/// tornava indietro. Senza, una riparazione che scrivesse *sempre* l'alias, o
/// *sempre* i delimitatori del frontmatter, o *sempre* le parentesi angolari,
/// passerebbe questo banco cambiando il file di tutti gli altri.
fn casi() -> Vec<(&'static str, &'static str)> {
    vec![
        // --- 0213: il frontmatter presente e senza chiavi -------------------
        ("frontmatter vuoto", "---\n\n---\n\ncorpo\n"),
        ("solo frontmatter vuoto", "---\n\n---\n"),
        ("frontmatter con chiavi", "---\na: 1\n---\n\ncorpo\n"),
        ("nessun frontmatter", "corpo\n"),
        // --- 0214: l'alias scritto a mano -----------------------------------
        ("alias uguale al bersaglio", "[[Nota|Nota]]\n"),
        (
            "alias uguale al bersaglio, con heading",
            "[[Nota#Sez|Nota#Sez]]\n",
        ),
        ("alias di un embed", "![[Nota|Alias]]\n"),
        ("alias diverso dal bersaglio", "[[Nota|Altro]]\n"),
        ("nessun alias", "[[Nota]]\n"),
        ("nessun alias, con heading", "[[Nota#Sez]]\n"),
        ("nessun alias, con blocco", "[[Nota#^abc]]\n"),
        ("nessun alias, embed", "![[Nota#Sez]]\n"),
        // --- 0215: il numero di partenza ------------------------------------
        ("lista ordinata che comincia da 3", "3. primo\n4. secondo\n"),
        ("lista ordinata che comincia da 1", "1. primo\n2. secondo\n"),
        ("lista puntata", "- primo\n- secondo\n"),
        // --- 0216: la nota a piè di pagina su più blocchi --------------------
        (
            "nota a piè di pagina su un blocco",
            "testo[^a]\n\n[^a]: la nota\n",
        ),
        (
            "nota a piè di pagina su due paragrafi",
            "testo[^a]\n\n[^a]: primo\n\n    secondo\n",
        ),
        (
            "nota a piè di pagina con un elenco",
            "testo[^a]\n\n[^a]: primo\n\n    - uno\n    - due\n",
        ),
        // La stessa forma nei contenitori vicini: la riga vuota fra due
        // blocchi la scrive una funzione sola, e questi sono i suoi altri
        // chiamanti.
        ("citazione su due paragrafi", "> primo\n>\n> secondo\n"),
        (
            "callout su due paragrafi",
            "> [!note] Titolo\n> primo\n>\n> secondo\n",
        ),
        ("voce d'elenco su due paragrafi", "- primo\n\n  secondo\n"),
        // --- 0218: le destinazioni da racchiudere ---------------------------
        ("destinazione con uno spazio", "[testo](<un file.md>)\n"),
        ("destinazione con una parentesi spaiata", "[testo](<a(b>)\n"),
        ("immagine con uno spazio", "![alt](<foto 1.png>)\n"),
        (
            "destinazione con parentesi bilanciate",
            "[testo](file(1).md)\n",
        ),
        ("destinazione semplice", "[testo](file.md)\n"),
        ("url", "[testo](https://esempio.it/x?a=1)\n"),
    ]
}

/// **La proprietà.** Un documento canonico riscritto è lo stesso file.
#[test]
fn cio_che_rientra_e_cio_che_era_uscito() {
    for (nome, src) in casi() {
        let riscritto = serialize(&parse(src));
        assert_eq!(
            riscritto, src,
            "«{nome}»: il giro ha riscritto il file dell'utente diverso da\n\
             com'era. Ciò che non torna non è degradato, è **perso**: stava nel\n\
             file, e dal file è sparito.\n  \
             sorgente:  {src:?}\n  riscritto: {riscritto:?}"
        );
    }
}

/// **La seconda passata non aggiunge niente.**
///
/// Vale come proprietà a sé perché la prima si può soddisfare anche con una
/// scrittura che *cresce* — l'alias che si riscrive dentro sé stesso, il
/// separatore che si duplica — e un file che si allunga a ogni salvataggio
/// passerebbe l'uguaglianza al primo giro e non al secondo.
#[test]
fn il_secondo_giro_e_fermo() {
    for (nome, src) in casi() {
        let uno = serialize(&parse(src));
        let due = serialize(&parse(&uno));
        assert_eq!(
            due, uno,
            "«{nome}»: la seconda riscrittura non coincide con la prima: il\n\
             documento si muove a ogni salvataggio.\n  \
             primo giro:  {uno:?}\n  secondo giro: {due:?}"
        );
    }
}
