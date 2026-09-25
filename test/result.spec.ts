import { beforeEach, describe, expect, expectTypeOf, it } from "vitest";
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

describe("pipe", () => {
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

  const pipeline = jarl.pipe(length, label);

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

  it("replaces map, which is no longer exported", () => {
    expect(jarl.pipe).toBeTypeOf("function");
    expect(Object.keys(jarl)).not.toContain("map");
    // @ts-expect-error map was renamed to pipe
    expect(jarl.map).toBeUndefined();
  });

  describe("with three steps", () => {
    class Forbidden extends jarl.error.define("Forbidden") {
      constructor(readonly user: string) {
        super(`${user} is not allowed in`);
      }
    }

    type User = { id: number; name: string };
    type Badge = { badge: string };

    const calls: string[] = [];
    beforeEach(() => {
      calls.length = 0;
    });

    const count = jarl.fn(async (input: string) => {
      calls.push("count");
      if (input.length === 0) {
        throw new Invalid("empty");
      }
      return input.length;
    }, (error) => (error instanceof Invalid ? error : new Invalid("unknown")));

    const lookup = jarl.fn(async (id: number): Promise<User> => {
      calls.push("lookup");
      if (id > 5) {
        throw new NotFound(String(id));
      }
      return { id, name: id === 4 ? "mallory" : "alice" };
    }, (error) => (error instanceof NotFound ? error : new NotFound("unknown")));

    const admit = jarl.fn(async (user: User): Promise<Badge> => {
      calls.push("admit");
      if (user.name === "mallory") {
        throw new Forbidden(user.name);
      }
      return { badge: `${user.name}-${user.id}` };
    }, (error) => (error instanceof Forbidden ? error : new Forbidden("unknown")));

    const badgeFor = jarl.pipe(count, lookup, admit);

    it("infers the last value and the union of every step's error", async () => {
      expectTypeOf(badgeFor).toEqualTypeOf<
        (input: string) => Promise<jarl.Result<Badge, Invalid | NotFound | Forbidden>>
      >();
      expectTypeOf(badgeFor).parameters.toEqualTypeOf<[string]>();
      expectTypeOf(badgeFor).returns.resolves.toEqualTypeOf<
        jarl.Result<Badge, Invalid | NotFound | Forbidden>
      >();

      const result = await badgeFor("hey");

      if (!jarl.is_ok(result)) {
        throw result.error;
      }
      expect(result.value).toEqual({ badge: "alice-3" });
      expect(calls).toEqual(["count", "lookup", "admit"]);
    });

    it("stops at the first step's error", async () => {
      const result = await badgeFor("");

      if (!jarl.error.is(result, Invalid)) {
        throw new Error("expected Invalid");
      }
      expect(result.error.reason).toBe("empty");
      expect(calls).toEqual(["count"]);
    });

    it("stops at the second step's error", async () => {
      const result = await badgeFor("too-long");

      if (!jarl.error.is(result, NotFound)) {
        throw new Error("expected NotFound");
      }
      expect(result.error.id).toBe("8");
      expect(calls).toEqual(["count", "lookup"]);
    });

    it("returns the third step's error", async () => {
      const result = await badgeFor("four");

      if (!jarl.error.is(result, Forbidden)) {
        throw new Error("expected Forbidden");
      }
      expect(result.error.user).toBe("mallory");
      expect(calls).toEqual(["count", "lookup", "admit"]);
    });

    it("rejects a step whose input is not the previous step's value", () => {
      // @ts-expect-error admit takes a User, but count produces a number
      jarl.pipe(count, admit);
      // @ts-expect-error lookup takes a number, but lookup produces a User
      jarl.pipe(count, lookup, lookup);
    });

    it("only allows value once all three errors are handled", async () => {
      const result = await badgeFor("hey");

      expect(() => {
        // @ts-expect-error Invalid, NotFound and Forbidden are all still possible
        jarl.value(result);
      }).not.toThrow();

      if (jarl.error.is(result, Invalid)) {
        throw result.error;
      }
      if (jarl.error.is(result, NotFound)) {
        throw result.error;
      }

      expect(() => {
        // @ts-expect-error Forbidden is still possible
        jarl.value(result);
      }).not.toThrow();

      if (jarl.error.is(result, Forbidden)) {
        throw result.error;
      }

      expectTypeOf(result).toEqualTypeOf<jarl.Result<Badge, never>>();
      expect(jarl.value(result)).toEqual({ badge: "alice-3" });
    });
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

    const load = jarl.pipe(read, (text) => jarl.parseJSON<{ n: number }>(text));
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

    const load = jarl.pipe(read, (text) => jarl.parseJSON<{ n: number }>(text));
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

  describe("on a union of three errors", () => {
    class Red extends jarl.error.define("Red") {}
    class Green extends jarl.error.define("Green") {}
    class Blue extends jarl.error.define("Blue") {}

    const paint = (
      color: "red" | "green" | "blue" | "none",
    ): jarl.Result<"none", Red | Green | Blue> => {
      if (color === "red") {
        return jarl.err(new Red());
      }
      if (color === "green") {
        return jarl.err(new Green());
      }
      if (color === "blue") {
        return jarl.err(new Blue());
      }
      return jarl.ok(color);
    };

    it("removes one error at a time until only the value is left", () => {
      const result = paint("none");

      if (jarl.error.is(result, Red)) {
        throw result.error;
      }
      expectTypeOf(result).toEqualTypeOf<jarl.Result<"none", Green | Blue>>();

      if (jarl.error.is(result, Green)) {
        expectTypeOf(result.error).toEqualTypeOf<Green>();
        throw result.error;
      }
      expectTypeOf(result).toEqualTypeOf<jarl.Result<"none", Blue>>();

      if (jarl.error.is(result, Blue)) {
        expectTypeOf(result.error).toEqualTypeOf<Blue>();
        throw result.error;
      }
      expectTypeOf(result).toEqualTypeOf<jarl.Result<"none", never>>();
      expect(jarl.value(result)).toBe("none");
    });

    it("narrows to the error that is actually there", () => {
      const result = paint("blue");

      if (jarl.error.is(result, Red)) {
        throw new Error("expected Blue");
      }
      if (jarl.error.is(result, Green)) {
        throw new Error("expected Blue");
      }
      if (!jarl.error.is(result, Blue)) {
        throw new Error("expected Blue");
      }
      expectTypeOf(result.error).toEqualTypeOf<Blue>();
      expect(result.error).toBeInstanceOf(Blue);
    });

    it("lets unwrap read the value once error.is has removed an error", () => {
      const result = paint("none");
      if (jarl.error.is(result, Red)) {
        throw result.error;
      }
      expectTypeOf(jarl.unwrap(result)).toEqualTypeOf<"none">();
      expect(jarl.unwrap(result)).toBe("none");
    });

    it("lets unwrap throw an error error.is left behind", () => {
      const result = paint("blue");
      if (jarl.error.is(result, Red)) {
        throw new Error("expected Blue");
      }
      expect(() => jarl.unwrap(result)).toThrow(Blue);
    });

    it("lets is_ok split what error.is left into the value and the other errors", () => {
      const result = paint("green");
      if (jarl.error.is(result, Red)) {
        throw new Error("expected Green");
      }
      if (jarl.is_ok(result)) {
        expectTypeOf(result.value).toEqualTypeOf<"none">();
        throw new Error("expected Green");
      }
      expectTypeOf(result.error).toEqualTypeOf<Green | Blue>();
      expect(result.error).toBeInstanceOf(Green);
    });

    it("lets is_err narrow what error.is left to the other errors", () => {
      const result = paint("blue");
      if (jarl.error.is(result, Red)) {
        throw new Error("expected Blue");
      }
      if (!jarl.is_err(result)) {
        expectTypeOf(result.value).toEqualTypeOf<"none">();
        throw new Error("expected Blue");
      }
      expectTypeOf(result.error).toEqualTypeOf<Green | Blue>();
      expect(result.error).toBeInstanceOf(Blue);
    });
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
