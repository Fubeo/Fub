// Lo stato del documento accanto al percorso: si scrive tutto, in parte o per
// niente, perché, e che cosa si può fare. La shell disegna il chip e il suo
// riquadro (`panels/standing.ts`); qui si decide che cosa dicono.
//
// Le ragioni sono quelle del formato: la sola lettura arriva con la
// proiezione, i blocchi chiusi e il solo corpo anche (`closed.ts`).
import type { SurfaceStandingAction, SurfaceStandingState } from "../core/registry";
import { plural, t, type Key } from "../../i18n/strings";
import { closedPlaces, goToBlock, type ClosedPlace } from "./closed";
import type { RichEngine } from "./engine";
import type { ReadOnlyReason } from "./projection";
import { setTracking } from "./track";

const READ_ONLY_KEYS: Readonly<Record<ReadOnlyReason, Key>> = {
  revisions: "rich.readonly.revisions",
  track_changes: "rich.readonly.track_changes",
  protected: "rich.readonly.protected",
  projection: "rich.readonly.projection",
  codec: "rich.readonly.codec",
  import: "rich.readonly.import",
};

/// I formati che hanno un nome da dire.
const FORMAT_KEYS: Readonly<Record<string, Key>> = {
  docx: "rich.prop.format.docx",
  odt: "rich.prop.format.odt",
  rtf: "rich.prop.format.rtf",
  doc: "rich.prop.format.doc",
};

export interface RichStandingHost {
  /// Il formato del file (`docx`), per dire dove si salva.
  readonly format?: string;
  /// Il formato registra le modifiche: il riquadro offre di accenderle.
  readonly review?: boolean;
  /// Apre la ricerca del documento.
  find(): void;
}

/// Che cosa dice il chip del documento di `engine`; `null` finché il
/// documento non si legge.
export function richStanding(engine: RichEngine, host: RichStandingHost): () => SurfaceStandingState | null {
  const place = (at: ClosedPlace): SurfaceStandingAction => {
    const what =
      at.kind === "table"
        ? t("rich.standing.place.table")
        : at.excerpt
          ? t("rich.standing.place.para", { excerpt: at.excerpt })
          : t("rich.standing.place.empty");
    const page = engine.sheetFor(at.pos);
    return {
      label: page === null ? what : t("rich.standing.place.page", { place: what, page }),
      run: () => void engine.browse(goToBlock(at.pos)),
    };
  };
  return () => {
    const intake = engine.intake();
    if (intake.kind !== "ok") return null;
    const recording = engine.tracking();
    const sign = { recording, recordingHint: t("rich.track.notice") };
    const formatKey = host.format ? FORMAT_KEYS[host.format] : undefined;
    const format = formatKey ? t(formatKey) : null;
    if (intake.readonly) {
      return {
        kind: "readonly",
        text: t("rich.standing.readonly"),
        title: t("rich.standing.readonly.title"),
        body: t("rich.standing.readonly.body"),
        source: t("rich.standing.reason", { reason: t(READ_ONLY_KEYS[intake.readonly]) }),
        actions: [{ label: t("rich.standing.find"), run: host.find }],
        ...sign,
      };
    }
    const closed = engine.read((state) => closedPlaces(state.doc));
    if (closed.length > 0) {
      const count = closed.length;
      return {
        kind: "closed",
        text: plural(count, "rich.standing.closed.one", "rich.standing.closed", { count }),
        title: plural(count, "rich.standing.closed.title.one", "rich.standing.closed.title", { count }),
        body: t("rich.standing.closed.body"),
        source: t("rich.standing.closed.source"),
        places: closed.map(place),
        actions: [{ label: t("rich.standing.closed.first"), run: () => void engine.browse(goToBlock(closed[0]!.pos)) }],
        ...sign,
      };
    }
    if (engine.bodyOnly()) {
      return {
        kind: "body",
        text: t("rich.standing.body"),
        title: t("rich.standing.body.title"),
        body: t("rich.standing.body.body"),
        ...(format ? { source: t("rich.standing.body.source", { format }) } : {}),
        ...sign,
      };
    }
    const flip = setTracking(!recording);
    const actions: SurfaceStandingAction[] =
      host.review && engine.allows(flip)
        ? [{ label: t(recording ? "rich.standing.track.stop" : "rich.standing.track"), run: () => void engine.apply(setTracking(!engine.tracking())) }]
        : [];
    return {
      kind: "writes",
      text: t("rich.standing.writes"),
      title: t("rich.standing.writes.title"),
      body: t("rich.standing.writes.body"),
      ...(format ? { source: t("rich.standing.writes.source", { format }) } : {}),
      actions,
      ...sign,
    };
  };
}
