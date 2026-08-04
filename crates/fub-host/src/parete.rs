//! **La seconda sorgente di tempo** (§22.4, decisione 0091): il tempo di
//! *parete*, accanto a quello *trascorso* che lo scheduler aveva già.
//!
//! # Perché sono due e non si possono mescolare
//!
//! Lo scheduler delle sveglie ([`crate::runner`]) è costruito su un
//! [`Instant`](std::time::Instant), e lo dice di sé: è la ragione per cui «ogni
//! ora» vuol dire un'ora anche se qualcuno sposta l'orologio della macchina.
//! Quella proprietà è **il motivo per cui `every` e `after` sono giusti**, e
//! sarebbe da buttare via se un orario di parete si fosse fatto passare per un
//! intervallo.
//!
//! Un `Instant` non ha un calendario: non sa cosa sia un lunedì, e non può
//! saperlo, perché non è ancorato a niente che si possa datare. Un
//! [`SystemTime`](std::time::SystemTime) ha un calendario e salta quando
//! l'utente sposta l'orologio. Le due sorgenti quindi convivono e **reggono cose
//! diverse**:
//!
//! - il tempo **trascorso** (`Instant`) regge `every` e `after`, e regge anche
//!   *l'attesa* di tutti — perché aspettare è sempre «per quanto», mai «fino a
//!   quando»;
//! - il tempo **di parete** (`SystemTime`, letto attraverso un fuso) regge
//!   *quando* accade un'occorrenza di `at-wall-clock`.
//!
//! Il punto in cui si toccano è uno solo, ed è questo modulo: si chiede al
//! calendario *fra quanti secondi* accade un'ora civile, e da lì in poi si torna
//! ad aspettare con l'orologio monotono. Un orologio spostato all'indietro
//! allunga o accorcia una singola attesa e poi si ricalcola: nessuna sveglia si
//! perde e nessuna si sdoppia, perché a decidere se una ha già suonato non è
//! l'orologio ma la sua **data civile**.
//!
//! # Il database dei fusi
//!
//! Sta qui e **solo** qui. `fub-abi` non ha e non deve avere una dipendenza di
//! date: la regola del contratto ([`WallClock::next_after`]) è aritmetica su ore
//! civili, e le ore civili non hanno bisogno di sapere cosa sia l'ora legale.
//! Cosa sia l'ora legale serve in due conversioni sole — istante → ora civile e
//! ora civile → istante — e sono queste.

use std::time::Duration;

use fub_abi::traits::{CivilTime, WallClock};
use jiff::civil;
use jiff::tz::TimeZone;
use jiff::Timestamp;

/// Il calendario di un fuso: la sola cosa che sta fra un `Instant` e un lunedì.
///
/// Si costruisce una volta per sveglia e per giro. Costruirlo non è gratis — un
/// nome IANA si risolve leggendo il database — ma il giro in cui succede è
/// quello in cui il pool stava per addormentarsi, cioè lo stesso in cui la
/// [0069](../../../docs/decisions/0069-cosa-sa-dire-un-abbonamento.md) ha già
/// deciso di poter leggere un orologio.
pub(crate) struct Fuso(TimeZone);

impl Fuso {
    /// Il fuso di una sveglia: quello che dichiara, o quello della macchina.
    ///
    /// `macchina` è il nome IANA che il locale risolve — cioè
    /// [`locale.timezone`](fub_kernel::locale::TIMEZONE), che vale «quello del
    /// sistema» quando è vuoto. Vuoto qui vuol dire che nemmeno il sistema lo
    /// sa, e allora si prende quello del sistema per la via di `jiff`.
    ///
    /// `None` = **il nome non si risolve**, e chi chiama non fa suonare la
    /// sveglia. È deliberato e non è un ripiego mancato: cadere su UTC vorrebbe
    /// dire onorare la dichiarazione con un'altra sveglia, all'ora sbagliata,
    /// senza che nessuno se ne accorga — la specie di bugia che la
    /// [0077](../../../docs/decisions/0077-una-scorciatoia-e-una-chiave.md)
    /// rifiuta nel registro dei comandi.
    pub(crate) fn della(sveglia: &WallClock, macchina: &str) -> Option<Self> {
        match sveglia.zone.as_deref().unwrap_or(macchina) {
            "" => Some(Fuso(TimeZone::system())),
            nome => TimeZone::get(nome).ok().map(Fuso),
        }
    }

    /// Che ora civile è adesso, qui.
    pub(crate) fn adesso(&self, ora: Timestamp) -> CivilTime {
        let z = ora.to_zoned(self.0.clone());
        CivilTime {
            year: i32::from(z.year()),
            month: z.month() as u8,
            day: z.day() as u8,
            hour: z.hour() as u8,
            minute: z.minute() as u8,
            second: z.second() as u8,
        }
    }

    /// L'istante in cui accade un'ora civile, qui.
    ///
    /// **Le due ore storte dell'ora legale si decidono in questa riga.**
    /// `compatible` è la disambiguazione di RFC 5545, cioè quella di ogni
    /// calendario: un'ora che non esiste si sposta in avanti della durata del
    /// salto (le 2:30 diventano le 3:30, e la sveglia non perde il giorno);
    /// un'ora che esiste due volte prende la prima. Che la seconda non suoni una
    /// seconda volta non dipende da qui — dipende dall'invariante di chi chiama,
    /// che tiene l'ultima occorrenza *civile* onorata.
    pub(crate) fn istante(&self, quando: CivilTime) -> Option<Timestamp> {
        let dt = civil::datetime(
            i16::try_from(quando.year).ok()?,
            i8::try_from(quando.month).ok()?,
            i8::try_from(quando.day).ok()?,
            i8::try_from(quando.hour).ok()?,
            i8::try_from(quando.minute).ok()?,
            i8::try_from(quando.second).ok()?,
            0,
        );
        self.0
            .to_ambiguous_zoned(dt)
            .compatible()
            .ok()
            .map(|z| z.timestamp())
    }
}

/// Dove sta una sveglia di parete: le due occorrenze che la descrivono.
///
/// Sono due campi e non uno perché rispondono a due domande che si somigliano e
/// non coincidono — *cosa ho già considerato* e *cosa sto aspettando* — e
/// confonderle è precisamente il difetto in cui questa implementazione è caduta
/// alla prima stesura: con la sola [`ultima`](Self::ultima) una sveglia
/// puntuale con `catch_up_seconds = 0` non suonava **mai**, perché ogni suonata
/// sarebbe stata un recupero e la finestra era zero.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Posizione {
    /// L'ultima occorrenza *civile* considerata: onorata, oppure **consumata
    /// senza suonare** perché fuori dalla finestra.
    ///
    /// Consumata senza suonare è la metà che conta. Senza di lei un'occorrenza
    /// saltata resterebbe la «prossima passata» per sempre e ogni giro la
    /// riesaminerebbe; con lei si guarda una volta e si passa oltre, che è anche
    /// il modo in cui una macchina riaccesa dopo due giorni suona zero volte
    /// invece di due.
    pub(crate) ultima: Option<CivilTime>,
    /// L'occorrenza per cui si sta aspettando. Quando arriva si suona **senza
    /// consultare la finestra**: la finestra dice fino a quanto tardi ha senso
    /// recuperare ciò che nessuno aspettava, non se onorare ciò che era in
    /// calendario.
    pub(crate) attesa: Option<CivilTime>,
}

/// Cosa fa una sveglia di parete **adesso**.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Verdetto {
    /// Suona adesso?
    pub(crate) suona: bool,
    /// Dov'è arrivata, da riscrivere nel quadrante.
    pub(crate) dove: Posizione,
    /// Fra quanto la prossima. `None` = nessuna occorrenza futura, cioè una
    /// sveglia che non suonerà più (orario fuori scala, o elenco di giorni
    /// impossibile).
    pub(crate) fra: Option<Duration>,
}

/// Applica la regola del contratto a un istante concreto.
///
/// La divisione del lavoro è quella della decisione: il contratto dice **quali**
/// occorrenze esistono ([`WallClock::next_after`] e
/// [`WallClock::latest_upto`]), questa funzione dice **quando** accadono e cosa
/// farne. Non legge l'orologio — lo riceve — ed è ciò che la rende provabile
/// senza aspettare le nove.
pub(crate) fn verdetto(
    sveglia: &WallClock,
    fuso: &Fuso,
    ora: Timestamp,
    dove: Posizione,
) -> Verdetto {
    let civile = fuso.adesso(ora);
    let mut esito = Verdetto {
        suona: false,
        dove,
        fra: None,
    };

    if let Some(passata) = sveglia.latest_upto(civile) {
        // `is_none_or`: al primo giro non c'è niente di già considerato, e
        // l'occorrenza di stamattina non è «persa» — è successa prima che questa
        // sveglia esistesse per lo scheduler. Farla suonare all'avvio dell'app
        // per il solo fatto che sono le dieci e lei era delle nove sarebbe un
        // recupero di qualcosa che nessuno aveva mancato.
        if dove.ultima.is_none_or(|u| passata > u) {
            esito.dove.ultima = Some(passata);
            // Due modi di meritare una suonata, e il primo non passa dalla
            // finestra: era l'occorrenza in calendario.
            let attesa = dove.attesa == Some(passata);
            let recupero = dove.ultima.is_some()
                && sveglia.catch_up_seconds > 0
                && fuso.istante(passata).is_some_and(|q| {
                    let ritardo = ora.as_second() - q.as_second();
                    ritardo >= 0 && ritardo as u64 <= sveglia.catch_up_seconds
                });
            esito.suona = attesa || recupero;
        }
    }

    // Quando torna a suonare. Si riscrive a ogni giro e non si tiene: la
    // prossima di un orario di parete non è una funzione di quante volte ha
    // suonato, è una funzione di che giorno è.
    let prossima = sveglia.next_after(civile);
    esito.dove.attesa = prossima;
    esito.fra = prossima
        .and_then(|p| fuso.istante(p))
        .map(|q| Duration::from_secs((q.as_second() - ora.as_second()).max(0) as u64));
    esito
}

#[cfg(test)]
mod prove {
    use super::*;
    use fub_abi::locale::Weekday;

    fn ts(s: &str) -> Timestamp {
        s.parse().expect("timestamp")
    }

    /// **Un nome che il database non conosce non fa suonare la sveglia**, e non
    /// ripiega su UTC: è la riga che tiene la dichiarazione onesta.
    #[test]
    fn un_fuso_inventato_non_ripiega_su_utc() {
        assert!(Fuso::della(&WallClock::daily(9, 0).anchored("Europa/Roma"), "").is_none());
        assert!(Fuso::della(&WallClock::daily(9, 0), "Mars/Olympus").is_none());
    }

    /// La sveglia dichiara il proprio fuso: **vince su quello della macchina**.
    /// È la metà che rende dicibile «le 9 dell'ufficio di Roma» a chi legge da
    /// Tokyo.
    #[test]
    fn il_fuso_dichiarato_vince_su_quello_della_macchina() {
        let sveglia = WallClock::daily(9, 0).anchored("Europe/Rome");
        let fuso = Fuso::della(&sveglia, "Asia/Tokyo").expect("fuso");
        // Le 9 di Roma del 15 gennaio sono le 08:00 UTC.
        let v = verdetto(
            &sveglia,
            &fuso,
            ts("2026-01-15T00:00:00Z"),
            Posizione::default(),
        );
        assert_eq!(v.fra, Some(Duration::from_secs(8 * 3600)));
    }

    /// Senza dichiarazione si usa quello della macchina, e sono ore diverse.
    #[test]
    fn senza_dichiarazione_e_quello_della_macchina() {
        let sveglia = WallClock::daily(9, 0);
        let fuso = Fuso::della(&sveglia, "Asia/Tokyo").expect("fuso");
        // Le 9 di Tokyo del 15 gennaio sono le 00:00 UTC.
        let v = verdetto(
            &sveglia,
            &fuso,
            ts("2026-01-14T23:00:00Z"),
            Posizione::default(),
        );
        assert_eq!(v.fra, Some(Duration::from_secs(3600)));
    }

    /// **Il giorno in cui l'ora legale entra, le 2:30 non esistono.** La sveglia
    /// non salta il giorno: si sposta in avanti della durata del salto.
    ///
    /// In Italia il cambio è l'ultima domenica di marzo — nel 2026 il 29 — alle
    /// 2:00, e le 2:30 diventano le 3:30, cioè le 01:30 UTC.
    #[test]
    fn lora_che_non_esiste_si_sposta_in_avanti() {
        let sveglia = WallClock::daily(2, 30).anchored("Europe/Rome");
        let fuso = Fuso::della(&sveglia, "").expect("fuso");
        let v = verdetto(
            &sveglia,
            &fuso,
            ts("2026-03-29T00:00:00Z"),
            Posizione::default(),
        );
        let fra = v.fra.expect("una prossima c'è");
        assert_eq!(
            fra,
            Duration::from_secs(90 * 60),
            "le 2:30 che non esistono devono diventare le 3:30, non sparire"
        );
    }

    /// **Il giorno in cui l'ora legale esce, le 2:30 esistono due volte, e la
    /// sveglia suona una volta.** Non è un campo: è l'invariante «un'occorrenza
    /// è la sua data civile», e si vede qui — dopo la prima delle due 2:30
    /// l'occorrenza risulta consumata, e la seconda non ne produce un'altra.
    ///
    /// Nel 2026 l'uscita è il 25 ottobre alle 3:00: le 2:30 accadono alle 00:30
    /// UTC e di nuovo alle 01:30 UTC.
    #[test]
    fn lora_che_esiste_due_volte_suona_una_volta() {
        let sveglia = WallClock::daily(2, 30)
            .anchored("Europe/Rome")
            .catching_up(3600);
        let fuso = Fuso::della(&sveglia, "").expect("fuso");

        // Prima delle due: l'occorrenza si consuma.
        let primo = verdetto(
            &sveglia,
            &fuso,
            ts("2026-10-25T00:31:00Z"),
            Posizione::default(),
        );
        let consumata = primo.dove.ultima.expect("consumata");
        assert_eq!((consumata.day, consumata.hour), (25, 2));

        // Un'ora dopo le 2:30 accadono di nuovo, ed è la **stessa data civile**:
        // niente da onorare, e la prossima è quella di domani.
        let secondo = verdetto(&sveglia, &fuso, ts("2026-10-25T01:31:00Z"), primo.dove);
        assert!(
            !secondo.suona,
            "la seconda volta che accadono le 2:30 è la stessa occorrenza"
        );
        assert_eq!(secondo.dove.ultima, primo.dove.ultima);
    }

    /// **Il recupero suona dentro la finestra e tace fuori**, ed è la stessa
    /// riga che risponde alla macchina che ha dormito due giorni.
    #[test]
    fn il_recupero_ha_una_finestra() {
        let stretta = WallClock::daily(9, 0).anchored("Europe/Rome");
        let larga = WallClock::daily(9, 0)
            .anchored("Europe/Rome")
            .catching_up(3600);
        let fuso = Fuso::della(&larga, "").expect("fuso");

        // Il giro prima ha visto le 9 di ieri, e aspettava quelle di **oggi**:
        // il recupero riguarda ciò che non era in calendario, quindi l'attesa si
        // mette altrove apposta.
        let alle_nove = |giorno| CivilTime {
            year: 2026,
            month: 1,
            day: giorno,
            hour: 9,
            minute: 0,
            second: 0,
        };
        // `attesa: None` è il caso vero del recupero: la macchina dormiva, o
        // l'app è ripartita, e nessuno stava aspettando niente. Un'occorrenza
        // che era in calendario suona per la sua strada, senza finestra.
        let ieri = Posizione {
            ultima: Some(alle_nove(14)),
            attesa: None,
        };

        // Venti minuti di ritardo, finestra di un'ora: suona.
        let v = verdetto(&larga, &fuso, ts("2026-01-15T08:20:00Z"), ieri);
        assert!(v.suona, "venti minuti dentro un'ora di finestra");

        // Stesso ritardo, nessuna finestra: tace.
        let v = verdetto(&stretta, &fuso, ts("2026-01-15T08:20:00Z"), ieri);
        assert!(!v.suona, "senza finestra non si recupera niente");

        // **Due giorni di macchina spenta, e il risveglio prima delle nove.**
        // Le due occorrenze perse cadono fuori dalla finestra: zero suonate, non
        // due. La più recente si consuma lo stesso — è il campo `ultima` a
        // impedire che la si riesamini per sempre — e la prossima è quella di
        // stamattina, che suonerà per la sua strada.
        let v = verdetto(&larga, &fuso, ts("2026-01-17T05:00:00Z"), ieri);
        assert!(!v.suona, "venti ore sono fuori da un'ora di finestra");
        let consumata = v.dove.ultima.expect("consumata");
        assert_eq!(
            (consumata.day, consumata.hour),
            (16, 9),
            "l'occorrenza saltata si consuma lo stesso, o la si riesaminerebbe per sempre"
        );
        assert_eq!(
            v.dove.attesa.map(|a| a.day),
            Some(17),
            "e si torna ad aspettare quella di stamattina"
        );
    }

    /// **Al primo giro non si recupera niente.** Una sveglia appena registrata
    /// non ha perso l'occorrenza di stamattina: non esisteva.
    #[test]
    fn al_primo_giro_non_si_recupera() {
        let sveglia = WallClock::daily(9, 0)
            .anchored("Europe/Rome")
            .catching_up(86_400);
        let fuso = Fuso::della(&sveglia, "").expect("fuso");
        let v = verdetto(
            &sveglia,
            &fuso,
            ts("2026-01-15T08:20:00Z"),
            Posizione::default(),
        );
        assert!(!v.suona, "l'app è appena partita, non ha perso niente");
        assert!(v.dove.ultima.is_some(), "ma l'occorrenza risulta consumata");
    }

    /// I giorni della settimana: `days` vuoto è ogni giorno, e un elenco salta.
    #[test]
    fn i_giorni_dichiarati_si_saltano() {
        // Il 15 gennaio 2026 è un giovedì.
        let lunedi = WallClock::daily(9, 0)
            .anchored("Europe/Rome")
            .on([Weekday::Monday]);
        let fuso = Fuso::della(&lunedi, "").expect("fuso");
        let v = verdetto(
            &lunedi,
            &fuso,
            ts("2026-01-15T00:00:00Z"),
            Posizione::default(),
        );
        // Dal giovedì al lunedì: quattro giorni, più le nove del mattino.
        assert_eq!(v.fra, Some(Duration::from_secs(4 * 86_400 + 8 * 3600)));
    }

    /// Un orario fuori scala non suona, e non fa fallire niente.
    #[test]
    fn un_orario_impossibile_non_suona() {
        let storta = WallClock::daily(25, 0).anchored("Europe/Rome");
        let fuso = Fuso::della(&storta, "").expect("fuso");
        let v = verdetto(
            &storta,
            &fuso,
            ts("2026-01-15T00:00:00Z"),
            Posizione::default(),
        );
        assert_eq!(v.fra, None);
        assert!(!v.suona);
        assert_eq!(v.dove.ultima, None);
    }
}
