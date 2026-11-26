// I tipi del confine per la sessione live del tablet
// (rispecchiati a mano dal Rust; `contract.ts` li ri-esporta).

// --- la sessione live (ADR 0205, rispecchia fub_live::host) -----------------
//
// Un tablet scrive sul disegno aperto in questa finestra. L'host tiene la rete
// e controlla solo forma, misura e ritmo dei messaggi; le operazioni le valida
// e le applica la shell, che risponde a ogni commit con `ack` o `nack`. Il
// canale degli eventi non è autorevole: un commit resta in `liveStatus` finché
// la shell non risponde. I contatori `u64` sono stringhe decimali, come nel
// protocollo.

/** Un contatore del protocollo live: un `u64` come stringa decimale. */
export type LiveCounter = string;

/** Un'operazione della scena, opaca per l'host: la valida la shell. */
export type LiveOp = { op: string } & Record<string, unknown>;

/** La richiesta di `live_start`. */
export interface LiveStart {
  document: { id: string; title: string };
  /** Il documento com'è all'avvio, in SVG. */
  snapshot: { seq: LiveCounter; text: string };
  /** Un indirizzo di `LiveStarted.addresses`; senza, quello della rotta predefinita. */
  address?: string;
}

/** Dove ascolta la sessione e con che certificato. */
export interface LiveSessionInfo {
  session: string;
  /** `ip:porta`. */
  addr: string;
  /** L'impronta SHA-256 del certificato, in base64url. */
  fingerprint: string;
  hostName: string | null;
}

/** Il QR da mostrare. Porta il segreto: si mostra solo sul PC. */
export interface LivePairing {
  payload: string;
  /** Il QR in SVG, un modulo per unità di `viewBox`. */
  qrSvg: string;
  expiresInMs: number;
}

/** Un indirizzo privato del PC su cui una sessione può ascoltare. */
export interface LiveAddress {
  addr: string;
  interface: string;
  defaultRoute: boolean;
}

export interface LiveStarted {
  session: LiveSessionInfo;
  pairing: LivePairing;
  /** Quello della rotta predefinita per primo. */
  addresses: LiveAddress[];
}

export interface LiveDevice {
  name: string;
  kind: string;
}

export interface LiveCaps {
  pressure: boolean;
  tilt: boolean;
  coalesced: boolean;
  predicted: boolean;
}

/** Lo scarto fra gli orologi: `offsetMs` si somma a quello dello scrittore. */
export interface LiveClock {
  offsetMs: number;
  rttMs: number | null;
}

/** La vista dello scrittore, in coordinate del documento. */
export interface LiveView {
  x: number;
  y: number;
  scale: number;
  w: number;
  h: number;
}

export type LiveLeaveReason =
  | "lost"
  | "heartbeat"
  | "writerBye"
  | "sessionEnded"
  | "congested"
  | "tooMuchTraffic"
  | { violation: { code: number } };

export type LiveReleaseReason = "resumeExpired" | "pairingRenewed";

/** Perché la sessione finisce; è anche il motivo di `live_stop`. */
export type LiveEndReason = "hostClosing" | "terminated" | "documentClosed" | "readOnly";

/** Un evento del canale. Arrivano a gruppi, nell'ordine d'arrivo. */
export type LiveEvent =
  | { t: "writerConnected"; writer: LiveCounter; device: LiveDevice; caps: LiveCaps; resumed: boolean }
  | { t: "writerDisconnected"; writer: LiveCounter; reason: LiveLeaveReason; resumable: boolean }
  | { t: "writerReleased"; writer: LiveCounter; reason: LiveReleaseReason }
  | {
      t: "inkBegin";
      s: string;
      layer: string;
      tool: "pen" | "highlighter";
      fill: string;
      fillOpacity: number;
      brush: string;
    }
  /** `[x, y, pressione, timeStamp]`, con il tempo sull'orologio dello scrittore. */
  | { t: "inkPoints"; s: string; pts: [number, number, number, number][] }
  | { t: "inkEnd"; s: string }
  | { t: "inkCancel"; s: string }
  /** L'inchiostro in coda di questi tratti è caduto: il loro commit lo sostituisce. */
  | { t: "inkGap"; strokes: string[] }
  | ({ t: "view" } & LiveView)
  | { t: "commit"; writer: LiveCounter; c: LiveCounter; ops: LiveOp[] }
  | ({ t: "clock" } & LiveClock)
  | { t: "pairingExpired" }
  | { t: "snapshotWanted" }
  | { t: "ended"; reason: LiveEndReason };

/** I motivi di `nack`: quelli del motore delle operazioni. */
export type LiveNackReason =
  | "missing-target"
  | "missing-parent"
  | "missing-anchor"
  | "duplicate-id"
  | "in-use"
  | "invalid-elem"
  | "locked"
  | "foreign"
  | "cycle"
  | "limit"
  | "read-only";

/** Ciò che la shell manda allo scrittore con `live_send`. */
export type LiveShellMessage =
  | { t: "ack"; writer: LiveCounter; c: LiveCounter; seq: LiveCounter; echo: LiveOp[]; duplicate: boolean }
  | {
      t: "nack";
      writer: LiveCounter;
      c: LiveCounter;
      reason: LiveNackReason;
      detail: string;
      index: number | null;
    }
  | { t: "ops"; seq: LiveCounter; ops: LiveOp[] }
  | { t: "snapshot"; seq: LiveCounter; text: string };

export interface LiveWriterStatus {
  writer: LiveCounter;
  device: LiveDevice;
  caps: LiveCaps;
  connected: boolean;
  /** Fuori dalla connessione: quanto resta alla ripresa. */
  resumeExpiresInMs: number | null;
  lastC: LiveCounter;
  clock: LiveClock | null;
}

/** Un commit che aspetta la risposta della shell. */
export interface LivePendingCommit {
  writer: LiveCounter;
  c: LiveCounter;
  ops: LiveOp[];
}

export interface LiveStats {
  accepted: LiveCounter;
  refused: LiveCounter;
  admitted: LiveCounter;
  rejected: LiveCounter;
  commits: LiveCounter;
  answered: LiveCounter;
}

export interface LiveStatus {
  ended: boolean;
  seq: LiveCounter;
  /** `null` se il segreto del QR è già usato o scaduto. */
  pairingExpiresInMs: number | null;
  writer: LiveWriterStatus | null;
  pending: LivePendingCommit[];
  stats: LiveStats;
}

/** Ciò che resta alla fine: i commit a cui la shell non ha risposto. */
export interface LiveStopReport {
  pending: LivePendingCommit[];
}
