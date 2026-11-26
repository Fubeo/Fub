// Il motore della griglia: i tasti. Metodi della classe `GridEngine`,
// montati sul suo prototipo da `engine.ts` (`editors/core/mix-methods.ts`).

import { resolvedLanguage } from "../../i18n/strings";
import { covers, withRange } from "../../tabella/selection";
import { addRangesKey, wholeKey } from "../../tabella/keys";
import { currencyFormat, namedKey, shortcutCommand, shortcutDialog } from "./shortcuts";
import { tableRange } from "./engine-geometry";
import { typingOpens } from "./engine-parts";
import type { GridEngine } from "./engine";

export const keysMethods = {
  _keydown(this: GridEngine, event: KeyboardEvent): void {
    if (!this._workbook || event.defaultPrevented) return;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) this.redo(); else this.undo();
      return;
    }
    if (modifier && event.key.toLowerCase() === "y") {
      event.preventDefault();
      this.redo();
      return;
    }
    if (this._objectKeydown(event)) {
      event.preventDefault();
      return;
    }
    // Ctrl+Alt+5, come in Excel: dalle celle al primo oggetto del foglio.
    if (modifier && event.altKey && event.code === "Digit5") {
      event.preventDefault();
      this._stepObject(1);
      return;
    }
    if (this._commands.length && !this._readOnly) {
      const context = {
        ...covers(tableRange(this._selectedRange()), {
          r0: this._edgeVisible("row", false),
          c0: this._edgeVisible("column", false),
          r1: this._edgeVisible("row", true),
          c1: this._edgeVisible("column", true),
        }),
        currency: currencyFormat(resolvedLanguage()),
      };
      const shortcut = shortcutCommand(event, context);
      if (shortcut) {
        event.preventDefault();
        this.command(shortcut.id, shortcut.params);
        return;
      }
      const asked = this._options.onDialog ? shortcutDialog(event, context) : null;
      if (asked) {
        event.preventDefault();
        this.openDialog(asked.dialog, asked.params);
        return;
      }
    }
    if (modifier && (event.key === "PageDown" || event.key === "PageUp")) {
      event.preventDefault();
      this._stepSheet(event.key === "PageDown" ? 1 : -1);
      return;
    }
    const whole = wholeKey(event);
    if (whole) {
      event.preventDefault();
      if (whole === "table") this._selectAll();
      else this._selectWhole(whole);
      return;
    }
    if (modifier && event.key.startsWith("Arrow")) {
      event.preventDefault();
      const steps: Record<string, readonly [-1 | 0 | 1, -1 | 0 | 1]> = {
        ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
      };
      const [rowStep, columnStep] = steps[event.key] ?? [0, 0];
      if (rowStep || columnStep) this._jump(rowStep, columnStep, event.shiftKey);
      return;
    }
    if (modifier && event.key.toLowerCase() === "a") {
      event.preventDefault();
      this._selectAll();
      return;
    }
    if (modifier && event.key === "Backspace") {
      event.preventDefault();
      this._ensureVisible(this._active());
      return;
    }
    const extend = event.shiftKey;
    switch (namedKey(event)) {
      case "ArrowUp": this._move(-1, 0, extend); break;
      case "ArrowDown": this._move(1, 0, extend); break;
      case "ArrowLeft": this._move(0, -1, extend); break;
      case "ArrowRight": this._move(0, 1, extend); break;
      // Invio e Tab spostano la cella attiva, dentro la selezione se è più
      // di una cella; Tab sull'ultima colonna va a capo, e oltre l'ultima
      // cella lascia andare il fuoco.
      case "Tab": if (!this._advance(extend ? "left" : "right") && !this._tab(extend ? -1 : 1)) return; break;
      case "Enter": if (!event.altKey && !modifier) this._advance(extend ? "up" : "down"); break;
      case "F2": this._beginEditing("cell", this._active(), undefined, "edit"); break;
      // Maiusc+F8 aggiunge alla selezione: ciò che è scelto resta, e ci si
      // sposta per scegliere un altro intervallo; di nuovo, o Esc, smette.
      case "F8":
        if (!addRangesKey(event)) return;
        this._adding = !this._adding;
        if (this._adding) {
          this._others = this._rangesOf(withRange(this._others.map(tableRange), tableRange(this._selectedRange())));
        }
        this._render();
        break;
      case "Home": this._select({
        row: modifier ? this._edgeVisible("row", false) : (extend ? this._selection.focus : this._active()).row,
        column: this._edgeVisible("column", false),
      }, extend); break;
      case "End": this._select({
        row: modifier ? this._edgeVisible("row", true) : (extend ? this._selection.focus : this._active()).row,
        column: this._edgeVisible("column", true),
      }, extend); break;
      case "PageUp": this._page(event.altKey ? "column" : "row", -1, extend); break;
      case "PageDown": this._page(event.altKey ? "column" : "row", 1, extend); break;
      case "Delete":
      case "Backspace": this._clearSelection(); break;
      case "Escape":
        this._copied = null;
        if (!this._cutMark && !this._copyMark && !this._adding) return;
        this._cutMark = null;
        this._copyMark = null;
        this._adding = false;
        this._render();
        break;
      default: {
        const typing = this._readOnly ? null : typingOpens(event);
        if (typing === "browser") {
          // Il fuoco va nel campo durante il keydown e il tasto non si
          // ferma: il carattere, il tasto morto o la composizione arrivano al
          // campo dal browser, come li manda il sistema.
          this._beginEditing("cell", this._active(), "");
          if (this._editing?.owner === "cell") this._cellEditor.focus();
          return;
        }
        if (typing === "seed") {
          this._beginEditing("cell", this._active(), event.key);
          break;
        }
        return;
      }
    }
    event.preventDefault();
  },
};
export type KeysMethods = typeof keysMethods;
