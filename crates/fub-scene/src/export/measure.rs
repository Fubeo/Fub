//! La misura di un'immagine raster: quanti pixel, e a che scala.
//!
//! Il conto è a 32 bit, come quello di `resvg`, e il client lo rifà con
//! `Math.fround` per dire nella finestra «Esporta» la misura del file: i
//! vettori di `measure.json` lo provano nei due linguaggi.

/// Il lato più lungo di un'immagine, in pixel.
pub const SIDE_MAX: u32 = 16_384;
/// Quanti pixel può avere un'immagine: 32 milioni, cioè 128 MiB di pixmap.
pub const AREA_MAX: u32 = 33_554_432;
/// La scala più grande che si può chiedere.
pub const SCALE_MAX: f32 = 8.0;

/// Come si chiede la misura: una scala, o una larghezza in pixel.
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum Size {
    /// I pixel dell'immagine per unità del disegno.
    Scale(f32),
    /// La larghezza dell'immagine in pixel.
    Pixels(u32),
}

/// La misura di un'immagine: la scala a cui si disegna, i pixel, e se la
/// scala chiesta è stata ridotta per stare nei limiti.
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct Measure {
    pub scale: f32,
    pub width: u32,
    pub height: u32,
    pub reduced: bool,
}

/// Vero se un'immagine di `w` × `h` pixel sta nei limiti.
fn fits_pixels(w: f32, h: f32) -> bool {
    let side = SIDE_MAX as f32;
    w <= side && h <= side && w * h <= AREA_MAX as f32
}

/// I pixel di un lato `side` alla scala `scale`.
fn pixels(side: f32, scale: f32) -> f32 {
    (side * scale).ceil()
}

/// La scala a cui `width` × `height` sta nei limiti: `asked`, o la più grande
/// sotto di lei che ci sta.
fn fitting_scale(width: f32, height: f32, asked: f32) -> f32 {
    let fits = |scale: f32| fits_pixels(pixels(width, scale), pixels(height, scale));
    if fits(asked) {
        return asked;
    }
    let side = SIDE_MAX as f32;
    let mut scale = (side / width)
        .min(side / height)
        .min((AREA_MAX as f32 / (width * height)).sqrt())
        .min(asked);
    // L'arrotondamento per eccesso dei lati può sforare di un pixel.
    while !fits(scale) && scale > 0.0 {
        scale *= 0.999;
    }
    scale
}

/// La misura di un'immagine del rettangolo `width` × `height`, in unità del
/// disegno e maggiori di 0, chiesta con `size`. Con una larghezza in pixel
/// l'immagine è larga esattamente così, se ci sta nei limiti; con una scala,
/// la più grande fino a quella chiesta che ci sta.
pub fn measure(width: f32, height: f32, size: Size) -> Measure {
    let measured = |scale: f32| (pixels(width, scale) as u32, pixels(height, scale) as u32);
    match size {
        Size::Pixels(wide) => {
            let scale = wide as f32 / width;
            let tall = pixels(height, scale);
            if fits_pixels(wide as f32, tall) {
                return Measure {
                    scale,
                    width: wide,
                    height: tall as u32,
                    reduced: false,
                };
            }
            let fitted = fitting_scale(width, height, scale);
            let (width, height) = measured(fitted);
            Measure {
                scale: fitted,
                width,
                height,
                reduced: true,
            }
        }
        Size::Scale(asked) => {
            let scale = fitting_scale(width, height, asked);
            let (width, height) = measured(scale);
            Measure {
                scale,
                width,
                height,
                reduced: scale < asked,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_scale_stays_within_the_pixel_limits() {
        let m = measure(800.0, 600.0, Size::Scale(2.0));
        assert_eq!((m.width, m.height, m.reduced), (1600, 1200, false));
        let m = measure(20_000.0, 10.0, Size::Scale(1.0));
        assert!(m.reduced && m.width <= SIDE_MAX);
        let m = measure(10_000.0, 10_000.0, Size::Scale(1.0));
        assert!(m.reduced && u64::from(m.width) * u64::from(m.height) <= u64::from(AREA_MAX));
    }

    #[test]
    fn a_width_gives_exactly_those_pixels() {
        let m = measure(793.7, 1122.5, Size::Pixels(1000));
        assert_eq!((m.width, m.reduced), (1000, false));
        assert_eq!(m.height, (1122.5f32 * (1000.0 / 793.7f32)).ceil() as u32);
        let m = measure(10.0, 1000.0, Size::Pixels(1000));
        assert!(m.reduced && m.height <= SIDE_MAX);
    }
}
