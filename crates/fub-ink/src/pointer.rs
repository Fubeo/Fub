//! Il campione del puntatore: ciò che un adattatore di piattaforma (gli eventi
//! del puntatore del browser, Tauri, un toolkit nativo) consegna al nucleo.
//!
//! È l'unico tipo che attraversa il confine fra la piattaforma e il nucleo.
//! L'adattatore lo riempie dal suo evento, già nello spazio in cui il tratto
//! deve vivere (la scena, non i pixel del client), e il nucleo non sa da dove
//! viene: niente DOM, niente camera, niente prodotto.

/// Che puntatore è. Un tipo che il motore non sa dire si comporta come il
/// mouse: meglio un puntatore che disegna di uno che non fa niente.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum PointerKind {
    Pen,
    Mouse,
    Touch,
}

impl PointerKind {
    /// Il nome che Pointer Events dà al tipo (`pointerType`).
    pub fn name(self) -> &'static str {
        match self {
            PointerKind::Pen => "pen",
            PointerKind::Mouse => "mouse",
            PointerKind::Touch => "touch",
        }
    }

    /// Il tipo di un `pointerType` qualunque: `pen` e `touch` si riconoscono,
    /// ogni altro valore è il mouse.
    pub fn from_name(name: &str) -> PointerKind {
        match name {
            "pen" => PointerKind::Pen,
            "touch" => PointerKind::Touch,
            _ => PointerKind::Mouse,
        }
    }
}

/// L'inclinazione come la dà il dispositivo. Pointer Events la dà in due forme
/// e alcuni motori solo nella prima: `altitude` e `azimuth` in radianti,
/// `tilt_x` e `tilt_y` in gradi. Un campo che manca è `None`.
#[derive(Copy, Clone, Debug, Default, PartialEq)]
pub struct Tilt {
    pub tilt_x: Option<f64>,
    pub tilt_y: Option<f64>,
    pub altitude: Option<f64>,
    pub azimuth: Option<f64>,
}

/// La vista nel momento dell'evento. Non fa parte del dispositivo ma del
/// foglio su cui si scrive, e cambia da un campione all'altro: l'adattatore
/// la rilegge a ogni evento, così un cambio di vista vale da subito.
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct View {
    /// L'angolo della vista, in gradi in senso orario.
    pub turn: f64,
    /// I pixel dello schermo per unità della scena.
    pub scale: f64,
}

impl Default for View {
    fn default() -> View {
        View {
            turn: 0.0,
            scale: 1.0,
        }
    }
}

/// Un campione del puntatore.
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct PointerSample {
    /// L'identità del puntatore, stabile finché è giù.
    pub pointer_id: i64,
    pub kind: PointerKind,
    /// La posizione nello spazio del tratto. Un valore non finito scarta il
    /// campione.
    pub x: f64,
    pub y: f64,
    /// La pressione come la dà il dispositivo, da 0 a 1. Pointer Events vuole
    /// 0,5 per un dispositivo che non la misura; un valore non finito vale 0,5.
    pub pressure: f64,
    pub tilt: Tilt,
    /// La rotazione della penna sul suo asse, in gradi. Il nucleo la tiene ma
    /// il formato dei tratti non la scrive.
    pub twist: f64,
    /// I tasti premuti ora (`PointerEvent.buttons`: il bit 1 è il principale).
    pub buttons: u32,
    /// Il tasto che ha causato l'evento (`PointerEvent.button`).
    pub button: i32,
    /// Il tempo dell'evento in millisecondi, su un orologio monotono.
    pub time: f64,
    pub view: View,
}

impl PointerSample {
    /// Un campione del tipo `kind` in `(x, y)` al tempo `time`, col tasto
    /// principale giù e tutto il resto ai valori di un dispositivo senza
    /// sensori. Serve a chi costruisce i campioni a mano, come i test.
    pub fn new(pointer_id: i64, kind: PointerKind, x: f64, y: f64, time: f64) -> PointerSample {
        PointerSample {
            pointer_id,
            kind,
            x,
            y,
            pressure: 0.5,
            tilt: Tilt::default(),
            twist: 0.0,
            buttons: 1,
            button: 0,
            time,
            view: View::default(),
        }
    }
}
