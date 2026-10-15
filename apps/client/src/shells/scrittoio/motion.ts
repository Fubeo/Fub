// Il movimento della shell: ciò che deve restare acceso quanto lei.
//
// `src/moto` non conosce la shell e non tiene niente in vita da solo. Due cose
// però valgono per tutta la sessione, e qualcuno deve possederle.
import { invalidateSpringTokens, onMotionLevelChange } from "../../moto";
import { on } from "../../state/store";
import type { Lifetime } from "../../ui/lifetime";

export function mountMotion(lifetime: Lifetime): void {
  // Il canale del moto ridotto segue il sistema solo finché qualcuno lo
  // ascolta: con questo ascolto, chi cambia la preferenza del sistema a
  // sessione aperta la ritrova alla corsa successiva. La scelta dell'utente
  // (`appearance.motion`) arriva da `theme/theme.ts`.
  lifetime.add(onMotionLevelChange(() => {}));

  // Le molle sono token della pelle, letti una volta e tenuti: cambiato il
  // tema montato si rileggono alla prossima corsa.
  lifetime.add(on("theme", invalidateSpringTokens));
}
