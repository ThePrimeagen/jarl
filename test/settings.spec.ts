import { describe, expect, expectTypeOf, it } from "vitest";
import * as jarl from "../index";
import {
  FileMissing,
  FileUnreadable,
  type Settings,
  type SettingsError,
  SettingsInvalid,
  describe as describeSettings,
  loadSettings,
  problem,
  settingsOrDefaults,
} from "../examples/settings";

describe("settings example", () => {
  it("loads with the union of all three errors", () => {
    expectTypeOf(loadSettings).toEqualTypeOf<
      (path: string) => Promise<jarl.Result<Settings, SettingsError>>
    >();
    expectTypeOf<SettingsError>().toEqualTypeOf<
      FileMissing | FileUnreadable | SettingsInvalid
    >();
  });

  it("unwraps the settings once FileMissing is handled", async () => {
    expect(await settingsOrDefaults("settings.json")).toEqual({ theme: "dark" });
  });

  it("falls back to defaults for the error it handled", async () => {
    expect(await settingsOrDefaults("missing.json")).toEqual({ theme: "light" });
  });

  it("lets unwrap throw each error error.is left behind", async () => {
    await expect(settingsOrDefaults("locked.json")).rejects.toBeInstanceOf(FileUnreadable);
    await expect(settingsOrDefaults("broken.json")).rejects.toBeInstanceOf(SettingsInvalid);
  });

  it("splits what is left into the value and the two unhandled errors", async () => {
    expect(await describeSettings("settings.json")).toBe("settings.json picks the dark theme");
    expect(await describeSettings("missing.json")).toBe("no missing.json, using the light theme");
    expect(await describeSettings("locked.json")).toBe(
      "cannot use locked.json: locked.json cannot be read",
    );
    expect(await describeSettings("broken.json")).toBe(
      "cannot use broken.json: broken.json: theme must be a string",
    );
  });

  it("names the unhandled error through is_err", async () => {
    expect(await problem("settings.json")).toBeUndefined();
    expect(await problem("missing.json")).toBeUndefined();
    expect(await problem("locked.json")).toBe("FileUnreadable");
    expect(await problem("broken.json")).toBe("SettingsInvalid");
  });
});
