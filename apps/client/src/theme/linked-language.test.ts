// @vitest-environment happy-dom
//
// Il tema collegato parla la lingua della shell (PA T37): i motivi di un
// rimontaggio non riuscito arrivano dal catalogo i18n, non da frasi fisse in
// italiano. Qui `t()` risponde col catalogo inglese, e il motivo di un fascio
// che non si legge deve essere inglese.
import { beforeEach, expect, it, vi } from "vitest";
import type { SettingEntry, ThemeInfo, ThemePayload } from "../host/contract";
import type { FakeHost, ThemeFolderFake } from "../host/fake";

const box = vi.hoisted(() => ({ host: null as FakeHost | null }));

vi.mock("../host/ipc", () => ({
  api: new Proxy(
    {},
    {
      get: (_target, name: string) => (...args: unknown[]) => {
        if (!box.host) throw new Error("host finto non montato");
        const method = box.host.module.api[name as keyof typeof box.host.module.api] as (
          ...values: unknown[]
        ) => unknown;
        return method(...args);
      },
    },
  ),
}));
vi.mock("../state/kernel", () => ({ onEvent: () => () => {} }));
vi.mock("../ui/notify", () => ({ notify: vi.fn(), reportThemeTrouble: vi.fn() }));
vi.mock("../i18n/strings", async (importOriginal) => {
  const real = await importOriginal<typeof import("../i18n/strings")>();
  const english = real.catalogFor("en");
  return {
    ...real,
    t: (key: string, args: Record<string, string | number> = {}) => real.expand(english[key] ?? key, args),
  };
});

const { createFakeHost, developerModeSetting, extendingTheme } = await import("../host/fake");
const { linkedTheme, mountTheme } = await import("./theme");
const { openLifetime } = await import("../ui/lifetime");

const FOLDER = "/temi/carta";
const ID = "acme.carta";

function carta(): ThemeFolderFake {
  const manifest: ThemeInfo["manifest"] = { ...extendingTheme(ID).info.manifest, name: "Carta", version: "0.1.0" };
  const skin = ".shell-tooltip { white-space: nowrap; }\n";
  const payload = (light: "light" | "dark"): ThemePayload => ({ manifest, light, sheet: null, skin, assets: {} });
  return {
    info: { manifest, trust: "community" },
    payloads: { [`${ID}:light`]: payload("light"), [`${ID}:dark`]: payload("dark") },
  };
}

function entry(key: string, value: string): SettingEntry {
  return {
    spec: {
      key,
      label: key,
      description: "",
      group: "Aspetto",
      scope: "machine",
      kind: { kind: "text", default: "" },
      program_writable: false,
    },
    value,
    source: "machine",
  };
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.documentElement.dataset.theme = "light";
  localStorage.clear();
});

it("il motivo di un fascio che non si legge viene dal catalogo, nella lingua della shell", async () => {
  box.host = createFakeHost({
    settings: [developerModeSetting(true), entry("appearance.theme", "light"), entry("appearance.theme-id", ID)],
    themeFolders: { [FOLDER]: carta() },
    linkedThemeFolder: FOLDER,
  });
  const lifetime = openLifetime();
  mountTheme(lifetime, () => {});
  await vi.waitFor(() => expect(linkedTheme()?.goodAt ?? null).not.toBeNull());

  box.host.fault("readTheme");
  box.host.themeFolderChanged(["skin.css"]);
  await vi.waitFor(() => expect(linkedTheme()!.rejection).not.toBeNull());
  expect(linkedTheme()!.rejection!.reasons[0]).toMatch(/^bundle not readable: /);
  lifetime.close();
});
