import { describe, expect, expectTypeOf, it } from "vitest";
import * as jarl from "../index";

class Invalid extends jarl.error.define("Invalid") {
  constructor(readonly reason: string) {
    super(reason);
  }
}

class NotFound extends jarl.error.define("NotFound") {
  constructor(readonly id: string) {
    super(`missing ${id}`);
  }
}

describe("fn", () => {
  it("returns the value a promise resolves to", async () => {
    const hello = jarl.fn(async (name: string) => `hello ${name}`);
    const result = await hello("jarl");

    if (!jarl.is_ok(result)) {
      throw result.error;
    }

    expect(result.value).toBe("hello jarl");
  });

  it("returns the specific error you map a rejection to", async () => {
    const find = jarl.fn(async (id: string) => {
      if (id === "") {
        throw new NotFound(id);
      }
      return { id };
    }, (error) => (error instanceof NotFound ? error : new NotFound("unknown")));

    const missing = await find("");
    const found = await find("7");

    expectTypeOf(missing).toEqualTypeOf<jarl.Result<{ id: string }, NotFound>>();

    if (jarl.error.is(missing, NotFound)) {
      expect(missing.error.id).toBe("");
    } else {
      throw new Error("expected NotFound");
    }

    if (!jarl.is_ok(found)) {
      throw found.error;
    }
    expect(found.value).toEqual({ id: "7" });
  });
});

describe("map", () => {
  const length = jarl.fn(async (input: string) => {
    if (input.length === 0) {
      throw new Invalid("empty");
    }
    return input.length;
  }, (error) => (error instanceof Invalid ? error : new Invalid("unknown")));

  const label = jarl.fn(async (count: number) => {
    if (count > 5) {
      throw new NotFound(String(count));
    }
    return `#${count}`;
  }, (error) => (error instanceof NotFound ? error : new NotFound("unknown")));

  const pipeline = jarl.map(length, label);

  it("chains each resolved value into the next promise", async () => {
    const result = await pipeline("hey");

    expectTypeOf(result).toEqualTypeOf<jarl.Result<string, Invalid | NotFound>>();

    if (jarl.error.is(result, Invalid)) {
      throw result.error;
    } else if (jarl.error.is(result, NotFound)) {
      throw result.error;
    } else {
      expectTypeOf(result).toEqualTypeOf<jarl.Result<string, never>>();
      expect(jarl.value(result)).toBe("#3");
    }
  });

  it("unions every error, and error.is removes the one you handle", async () => {
    const empty = await pipeline("");
    const missing = await pipeline("too-long");

    if (jarl.error.is(empty, Invalid)) {
      expect(empty.error.reason).toBe("empty");
      expectTypeOf(empty.error).toEqualTypeOf<Invalid>();
    } else if (jarl.error.is(empty, NotFound)) {
      expectTypeOf(empty.error).toEqualTypeOf<NotFound>();
      throw new Error("expected Invalid");
    } else {
      expectTypeOf(empty.value).toEqualTypeOf<string>();
      throw new Error("expected Invalid");
    }

    if (jarl.error.is(missing, NotFound)) {
      expect(missing.error.id).toBe("8");
      expectTypeOf(missing.error).toEqualTypeOf<NotFound>();
    } else if (jarl.error.is(missing, Invalid)) {
      expectTypeOf(missing.error).toEqualTypeOf<Invalid>();
      throw new Error("expected NotFound");
    } else {
      expectTypeOf(missing.value).toEqualTypeOf<string>();
      throw new Error("expected NotFound");
    }
  });
});

describe("parseJSON", () => {
  it("parses json from a promise", async () => {
    const result = await jarl.parseJSON<{ n: number }>(
      Promise.resolve('{"n":1}'),
    );

    expectTypeOf(result).toEqualTypeOf<jarl.Result<{ n: number }, jarl.JsonError>>();

    if (!jarl.is_ok(result)) {
      throw result.error;
    }
    expect(result.value.n).toBe(1);
  });

  it("returns JsonError for invalid json", async () => {
    const result = await jarl.parseJSON(Promise.resolve("{"));

    if (jarl.error.is(result, jarl.JsonError)) {
      expect(result.error).toBeInstanceOf(jarl.JsonError);
    } else {
      throw new Error("expected JsonError");
    }
  });

  it("adds JsonError beside the errors already on a result", async () => {
    const read = jarl.fn(async (raw: string) => {
      if (raw === "") {
        throw new Invalid("empty");
      }
      return raw;
    }, (error) => (error instanceof Invalid ? error : new Invalid("unknown")));

    const load = jarl.map(read, (text) => jarl.parseJSON<{ n: number }>(text));
    const parsed = await load("");
    const broken = await load("{");

    expectTypeOf(parsed).toEqualTypeOf<
      jarl.Result<{ n: number }, Invalid | jarl.JsonError>
    >();

    if (jarl.error.is(parsed, Invalid)) {
      expect(parsed.error.reason).toBe("empty");
    } else if (jarl.error.is(parsed, jarl.JsonError)) {
      expectTypeOf(parsed.error).toEqualTypeOf<jarl.JsonError>();
      throw new Error("expected Invalid");
    } else {
      expectTypeOf(parsed.value).toEqualTypeOf<{ n: number }>();
      throw new Error("expected Invalid");
    }

    if (jarl.error.is(broken, jarl.JsonError)) {
      expect(broken.error).toBeInstanceOf(jarl.JsonError);
    } else {
      throw new Error("expected JsonError");
    }
  });

  it("stays distinct from other built-in errors", async () => {
    const read = jarl.fn(async (raw: string) => {
      if (raw === "") {
        throw new TypeError("empty");
      }
      return raw;
    }, (error) =>
      error instanceof TypeError ? error : new TypeError(String(error)),
    );

    const load = jarl.map(read, (text) => jarl.parseJSON<{ n: number }>(text));
    const broken = await load("{");

    expectTypeOf(broken).toEqualTypeOf<
      jarl.Result<{ n: number }, TypeError | jarl.JsonError>
    >();

    if (jarl.error.is(broken, TypeError)) {
      throw new Error("expected JsonError");
    }

    expect(() => {
      // @ts-expect-error JsonError is still possible
      jarl.value(broken);
    }).toThrow(jarl.JsonError);
  });
});

describe("value", () => {
  it("returns the value when no error remains", () => {
    expect(jarl.value(jarl.ok("yes"))).toBe("yes");
  });

  it("is a type error while an error is still possible", () => {
    const missing = jarl.err(new NotFound("7"));

    expect(() => {
      // @ts-expect-error value requires the error type to be never
      jarl.value(missing);
    }).toThrow(NotFound);
  });

  it("throws if an error is still present at runtime", () => {
    const missing = jarl.err(new NotFound("7")) as jarl.Result<string, never>;
    expect(() => jarl.value(missing)).toThrow(NotFound);
  });
});

describe("error.define", () => {
  class Left extends jarl.error.define("Left") {}
  class Right extends jarl.error.define("Right") {}

  const pick = jarl.fn(async (side: "left" | "right" | "ok") => {
    if (side === "left") {
      throw new Left("left");
    }
    if (side === "right") {
      throw new Right("right");
    }
    return side;
  }, (error) => {
    if (error instanceof Left || error instanceof Right) {
      return error;
    }
    return new Left("unknown");
  });

  it("keeps empty error classes in the union until each one is handled", async () => {
    const right = await pick("right");

    if (jarl.error.is(right, Left)) {
      throw new Error("expected Right");
    }

    expect(() => {
      // @ts-expect-error Right is still possible, so the error type is not never
      jarl.value(right);
    }).toThrow(Right);

    if (!jarl.error.is(right, Right)) {
      throw new Error("expected Right");
    }
    expect(right.error).toBeInstanceOf(Right);

    const ok = await pick("ok");
    if (jarl.error.is(ok, Left)) {
      throw ok.error;
    } else if (jarl.error.is(ok, Right)) {
      throw ok.error;
    } else {
      expectTypeOf(ok).toEqualTypeOf<jarl.Result<"ok", never>>();
      expect(jarl.value(ok)).toBe("ok");
    }
  });
});

describe("error.is", () => {
  it("matches an error that also has result-shaped fields", () => {
    class Weird extends Error {
      ok = false;
      error = new Error("nested");
    }

    expect(jarl.error.is(new Weird("weird"), Weird)).toBe(true);
  });
});

describe("unwrap", () => {
  const find = jarl.fn(async (id: string) => {
    if (id === "") {
      throw new NotFound(id);
    }
    return id;
  }, (error) => (error instanceof NotFound ? error : new NotFound("unknown")));

  it("returns the value", async () => {
    expect(await jarl.unwrap(find("7"))).toBe("7");
  });

  it("throws when the result you already have is an error", () => {
    const missing = jarl.err(new NotFound("7"));
    expect(() => jarl.unwrap(missing)).toThrow(NotFound);
  });

  it("unwraps a result implemented by an error instance", () => {
    class Wrapped extends Error {
      readonly ok = false as const;
      readonly error = new NotFound("7");
    }

    expect(() => jarl.unwrap(new Wrapped("wrapped"))).toThrow(NotFound);
  });

  it("throws the error so you can narrow it", async () => {
    try {
      await jarl.unwrap(find(""));
      throw new Error("expected unwrap to throw");
    } catch (caught) {
      if (!jarl.error.is(caught, NotFound)) {
        throw caught;
      }
      expect(caught.id).toBe("");
    }
  });
});

describe("or_else", () => {
  const find = jarl.fn(async (id: string) => {
    if (id === "") {
      throw new NotFound(id);
    }
    return id;
  }, (error) => (error instanceof NotFound ? error : new NotFound("unknown")));

  it("returns the value", async () => {
    expect(await jarl.or_else(find("7"), "fallback")).toBe("7");
  });

  it("returns the fallback for an error", async () => {
    expect(await jarl.or_else(find(""), "fallback")).toBe("fallback");
  });
});

describe("ok and err", () => {
  it("builds a success that is_ok narrows to the value", () => {
    const result = jarl.ok("yes");

    expectTypeOf(result).toEqualTypeOf<jarl.Result<string, never>>();

    if (jarl.is_ok(result)) {
      expect(result.value).toBe("yes");
    } else {
      throw new Error("expected ok");
    }
  });

  it("builds a failure that is_err narrows to the error", () => {
    const result = jarl.err(new Invalid("no"));

    if (!jarl.is_err(result)) {
      throw new Error("expected err");
    }
    expect(result.error.reason).toBe("no");
    expectTypeOf(result.error).toEqualTypeOf<Invalid>();
  });
});
