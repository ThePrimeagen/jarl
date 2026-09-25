/// <reference types="bun-types" />
import * as jarl from "../index";

// Loading settings can fail three ways. The caller handles one of them with
// error.is, then hands what is left straight to unwrap, is_ok and is_err.

class FileMissing extends jarl.error.define("FileMissing") {
  constructor(readonly path: string) {
    super(`${path} is missing`);
  }
}

class FileUnreadable extends jarl.error.define("FileUnreadable") {
  constructor(readonly path: string) {
    super(`${path} cannot be read`);
  }
}

class SettingsInvalid extends jarl.error.define("SettingsInvalid") {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`${path}: ${reason}`);
  }
}

type SettingsError = FileMissing | FileUnreadable | SettingsInvalid;

type Settings = { theme: string };

const DEFAULTS: Settings = { theme: "light" };

// null stands for a file that is there but refuses to open.
const disk: Record<string, string | null> = {
  "settings.json": '{"theme":"dark"}',
  "locked.json": null,
  "broken.json": '{"theme":7}',
};

const loadSettings = jarl.fn(
  async (path: string): Promise<Settings> => {
    const text = disk[path];
    if (text === undefined) {
      throw new FileMissing(path);
    }
    if (text === null) {
      throw new FileUnreadable(path);
    }
    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("theme" in parsed) ||
      typeof parsed.theme !== "string"
    ) {
      throw new SettingsInvalid(path, "theme must be a string");
    }
    return { theme: parsed.theme };
  },
  (error, path) =>
    error instanceof FileMissing ||
    error instanceof FileUnreadable ||
    error instanceof SettingsInvalid
      ? error
      : new SettingsInvalid(path, String(error)),
);

type Equal<A, B> =
  (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2
    ? true
    : false;
type Assert<T extends true> = T;

// A missing file means defaults. Anything else is still the caller's problem,
// so unwrap throws it: unwrap sees both errors error.is left behind.
async function settingsOrDefaults(path: string): Promise<Settings> {
  const result = await loadSettings(path);
  if (jarl.error.is(result, FileMissing)) {
    return DEFAULTS;
  }

  const proof: Assert<
    Equal<typeof result, jarl.Result<Settings, FileUnreadable | SettingsInvalid>>
  > = true;
  void proof;

  const settings = jarl.unwrap(result);
  const unwrapped: Assert<Equal<typeof settings, Settings>> = true;
  void unwrapped;
  return settings;
}

// is_ok and is_err split what error.is left: the value on one side, exactly
// the two unhandled errors on the other.
async function describe(path: string): Promise<string> {
  const result = await loadSettings(path);
  if (jarl.error.is(result, FileMissing)) {
    return `no ${path}, using the ${DEFAULTS.theme} theme`;
  }

  if (jarl.is_ok(result)) {
    const proof: Assert<Equal<typeof result.value, Settings>> = true;
    void proof;
    return `${path} picks the ${result.value.theme} theme`;
  }

  const proof: Assert<Equal<typeof result.error, FileUnreadable | SettingsInvalid>> = true;
  void proof;

  // Never called: FileMissing was handled, so it is gone from what is left.
  void (() => {
    // @ts-expect-error what is left is FileUnreadable | SettingsInvalid, not FileMissing too
    const wrong: Assert<Equal<typeof result.error, SettingsError>> = true;
    return wrong;
  });

  return `cannot use ${path}: ${result.error.message}`;
}

// The same split from the other side: is_err keeps the errors, and what fails
// it is the value.
async function problem(path: string): Promise<string | undefined> {
  const result = await loadSettings(path);
  if (jarl.error.is(result, FileMissing)) {
    return undefined;
  }

  if (!jarl.is_err(result)) {
    const proof: Assert<Equal<typeof result.value, Settings>> = true;
    void proof;
    return undefined;
  }

  const proof: Assert<Equal<typeof result.error, FileUnreadable | SettingsInvalid>> = true;
  void proof;

  // Never called: value is refused while two errors are still possible.
  // @ts-expect-error the error type is FileUnreadable | SettingsInvalid, not never
  void (() => jarl.value(result));

  return result.error.name;
}

if (import.meta.main) {
  for (const path of ["settings.json", "missing.json", "locked.json", "broken.json"]) {
    console.log(path.padEnd(14), "->", await describe(path));
  }
}

export {
  FileMissing,
  FileUnreadable,
  type Settings,
  type SettingsError,
  SettingsInvalid,
  describe,
  loadSettings,
  problem,
  settingsOrDefaults,
};
