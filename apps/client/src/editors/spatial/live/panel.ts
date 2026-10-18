// Il pannello della sessione live: il QR da inquadrare, lo stato del tablet e
// la diagnostica.
//
// Il QR porta il segreto dell'abbinamento, e si mostra solo qui, sul PC. Il
// pannello si apre con la sessione e si chiude da sé quando il tablet entra:
// da lì in poi basta l'indicatore sopra il foglio, che lo riapre. Se dopo un
// minuto nessuno si è collegato, il pannello dice perché può succedere; la
// diagnostica è chiusa finché non la si apre.

import { onLanguage, resolvedLanguage, t } from "../../../i18n/strings";
import { openFrame } from "../../../ui/dialogs";
import { openLifetime } from "../../../ui/lifetime";
import { statusText } from "./badge";
import type { LiveControl, LiveState } from "./session";
import { formatLeft, formatMs } from "./stats";

/// Il lato del QR sullo schermo, al più: un multiplo intero dei moduli, così
/// ogni modulo cade su pixel interi.
const QR_PX = 232;

export interface LivePanel {
  close(): void;
  focus(): void;
}

/// I moduli per lato del QR, dal suo `viewBox`: uno per unità.
export function qrModules(svg: string): number | null {
  const match = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+[\d.]+\s*["']/.exec(svg);
  const side = match === null ? Number.NaN : Number(match[1]);
  return Number.isFinite(side) && side > 0 ? side : null;
}

const NONE = "—";

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  return node;
}

export function openLivePanel(control: LiveControl, onClosed: () => void): LivePanel {
  const life = openLifetime();
  const frame = openFrame(t("live.title"), () => life.close());
  life.add(() => frame.close());
  life.add(onClosed);

  const status = element("p", "palette-label");
  const scan = element("p");
  const qr = element("div", "live-qr");
  const image = element("img");
  image.decoding = "sync";
  qr.append(image);
  const expiry = element("p", "palette-summary");
  const unused = element("p", "palette-summary");

  const network = element("label", "palette-label");
  const networkText = element("span");
  const select = element("select");
  network.append(networkText, select);

  const diagnostics = element("details", "live-diagnostics");
  const summary = element("summary");
  const list = element("dl");
  diagnostics.append(summary, list);

  const actions = element("div", "palette-actions");
  const renew = element("button");
  renew.type = "button";
  const end = element("button", "danger");
  end.type = "button";
  const close = element("button");
  close.type = "button";
  actions.append(renew, end, close);

  frame.box.append(status, scan, qr, expiry, unused, network, diagnostics, actions);

  let shownQr: string | null = null;
  let shownAddresses = "";

  // Le righe nascono una volta e cambiano solo il testo: chi le sta
  // leggendo non perde il segno a ogni secondo.
  const rows = new Map<string, { readonly term: HTMLElement; readonly value: HTMLElement }>();
  const row = (term: string, value: string): void => {
    let entry = rows.get(term);
    if (entry === undefined) {
      entry = { term: element("dt"), value: element("dd") };
      entry.term.textContent = term;
      rows.set(term, entry);
      list.append(entry.term, entry.value);
    }
    if (entry.value.textContent !== value) entry.value.textContent = value;
  };

  const showQr = (state: LiveState): void => {
    const svg = state.pairing?.qrSvg ?? null;
    qr.hidden = svg === null;
    if (svg === null || svg === shownQr) return;
    shownQr = svg;
    const modules = qrModules(svg);
    const side = modules === null ? QR_PX : modules * Math.max(1, Math.floor(QR_PX / modules));
    image.width = side;
    image.height = side;
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  };

  const showNetwork = (state: LiveState): void => {
    // Scegliere un'altra rete apre una sessione nuova: solo prima che un
    // tablet si abbini, e solo se c'è una scelta.
    network.hidden = state.addresses.length < 2 || state.phase === "ended";
    const key = state.addresses.map((address) => `${address.interface}\u0000${address.addr}`).join("\u0001");
    if (key !== shownAddresses) {
      shownAddresses = key;
      select.replaceChildren(...state.addresses.map((address) => {
        const option = element("option");
        option.value = address.addr;
        option.textContent = `${address.interface} · ${address.addr}`;
        return option;
      }));
    }
    select.value = state.addr.slice(0, state.addr.lastIndexOf(":"));
    select.disabled = state.writer !== null;
  };

  const showDiagnostics = (state: LiveState, language: string): void => {
    const ms = (value: number | null): string => (value === null ? NONE : formatMs(value, language));
    const host = state.addr.slice(0, state.addr.lastIndexOf(":"));
    const via = state.addresses.find((address) => address.addr === host);
    const caps = state.writer === null
      ? NONE
      : Object.entries(state.writer.caps).filter(([, on]) => on).map(([name]) => name).join(", ") || NONE;
    if (rows.size > 0 && rows.keys().next().value !== t("live.diag.latency")) {
      // La lingua è cambiata: le etichette si rifanno.
      rows.clear();
      list.replaceChildren();
    }
    row(t("live.diag.latency"), state.median === null ? NONE : `${ms(state.median)} · ${ms(state.p95)}`);
    row(t("live.diag.rtt"), ms(state.rtt));
    row(t("live.diag.lost"), String(state.lost));
    row(t("live.diag.applied"), String(state.applied));
    row(t("live.diag.refused"), String(state.refused));
    row(t("live.diag.path"), via === undefined ? state.addr : `${state.addr} (${via.interface})`);
    row(t("live.diag.device"), state.writer === null ? NONE : `${state.writer.device.name} · ${state.writer.device.kind}`);
    row(t("live.diag.caps"), caps);
  };

  const render = (): void => {
    if (life.closed) return;
    const state = control.state();
    const language = resolvedLanguage();
    status.textContent = statusText(state, language);
    const waiting = state.phase === "waiting" || state.phase === "away";
    const pairing = waiting && state.pairing !== null;
    scan.textContent = t("live.scan");
    image.alt = t("live.qr");
    scan.hidden = !pairing;
    showQr(pairing ? state : { ...state, pairing: null });
    expiry.hidden = !waiting;
    expiry.textContent = pairing ? t("live.expires", { time: formatLeft(state.pairingLeftMs ?? 0) }) : t("live.expired");
    unused.hidden = !state.unused;
    unused.textContent = t("live.unused");
    networkText.textContent = t("live.network");
    showNetwork(state);
    summary.textContent = t("live.diag");
    showDiagnostics(state, language);
    renew.textContent = t("live.renew");
    renew.hidden = !waiting;
    renew.className = pairing ? "" : "primary";
    end.textContent = t("live.stop");
    end.hidden = state.phase === "ended";
    close.textContent = t("app.close");
  };

  life.listen(renew, "click", () => void control.renew());
  life.listen(end, "click", () => {
    life.close();
    void control.stop();
  });
  life.listen(close, "click", () => life.close());
  life.listen(select, "change", () => void control.chooseAddress(select.value));
  life.add(control.subscribe(render));
  life.add(onLanguage(render));
  const tick = setInterval(render, 1000);
  life.add(() => clearInterval(tick));

  render();
  close.focus();

  return {
    close: () => life.close(),
    focus: () => {
      if (!frame.overlay.contains(document.activeElement)) close.focus();
    },
  };
}
