// Ciò che la shell ricorda **per vault**, finché la finestra è aperta (#237 R07).
//
// La barra laterale ha due cose che sono di chi le guarda e non del vault: la
// vista scelta (File, Ricerca, una view della barra) e la ricerca scritta. Il
// vault non le salva, e non deve: nessuna delle due è un dato. Però sono *di
// quel vault* — la query «fattura 2024» cerca in un archivio, non nell'altro —
// e quindi:
//
// - un vault che si apre non eredita quelle del vault di prima;
// - un vault in cui si torna, o che si riapre (il watcher che riparte, il
//   «Riapri»), ritrova le sue.
//
// La memoria vive in RAM: chiudere la finestra la dimentica, come il resto
// dello stato di sessione che non ha un posto nel vault.

/// Quanti vault si ricordano: una sessione ne apre pochi, e il tetto tiene
/// finita la mappa anche per chi ne apre e chiude a decine.
export const PER_VAULT_LIMIT = 32;

/// Un valore per vault, con un valore «pulito» per il vault mai visto.
export class PerVault<T> {
  private readonly values = new Map<string, T>();
  private current = "";

  constructor(private readonly clean: T) {}

  /// Si entra in `root` lasciando il vault corrente com'era (`leaving`):
  /// rende il valore di `root`, o quello pulito se non ci si era mai stati.
  /// `""` è la finestra senza vault: non si ricorda niente, e parte pulita.
  enter(root: string, leaving: T): T {
    if (this.current !== "") this.keep(this.current, leaving);
    this.current = root;
    if (root === "") return this.clean;
    return this.values.get(root) ?? this.clean;
  }

  private keep(root: string, value: T): void {
    // Il più recente in fondo: la mappa tiene l'ordine d'inserimento, e il
    // primo è quello da più tempo non visitato.
    this.values.delete(root);
    if (value === this.clean) return;
    this.values.set(root, value);
    if (this.values.size > PER_VAULT_LIMIT) {
      const oldest = this.values.keys().next().value;
      if (oldest !== undefined) this.values.delete(oldest);
    }
  }
}
