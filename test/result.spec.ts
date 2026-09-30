import { describe, expect, expectTypeOf, it } from "vitest";
import * as jarl from "../index";

type Equal<A, B> =
  (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2
    ? true
    : false;
type Assert<T extends true> = T;

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
});

describe("exec", () => {
  it("calls the function once with no arguments and resolves to its value", async () => {
    const calls: unknown[][] = [];
    const query = async (...args: unknown[]) => {
      calls.push(args);
      return "rows";
    };

    const result = await jarl.exec(query);

    expect(calls).toEqual([[]]);
    expect(jarl.unwrap(result)).toBe("rows");
  });

  it("turns a rejection into the error mapError returns", async () => {
    const caught: unknown[] = [];
    const failed = (error: unknown) => {
      caught.push(error);
      return new NotFound("7");
    };

    const result = await jarl.exec(async () => {
      throw new Invalid("bad row");
    }, failed);

    if (!jarl.is_err(result)) {
      throw new Error("expected err");
    }
    expect(result.error).toBeInstanceOf(NotFound);
    expect(result.error.id).toBe("7");
    expect(caught).toHaveLength(1);
    expect(caught[0]).toBeInstanceOf(Invalid);
  });

  it("keeps the caught value as the error without mapError", async () => {
    const thrown = new Invalid("bad row");

    const result = await jarl.exec(async () => {
      throw thrown;
    });

    expectTypeOf(result).toEqualTypeOf<jarl.Result<never, unknown>>();
    if (!jarl.is_err(result)) {
      throw new Error("expected err");
    }
    expect(result.error).toBe(thrown);
  });

  it("resolves to an error when the function throws before returning its promise", async () => {
    const explode = (): Promise<string> => {
      throw new Invalid("sync");
    };

    const result = await jarl.exec(explode, () => new NotFound("7"));

    expect(jarl.error.is(result, NotFound)).toBe(true);
  });

  it("rejects when mapError itself throws, like fn", async () => {
    const broken = new Error("mapError broke");
    const failing = async () => {
      throw new Invalid("bad row");
    };
    const mapError = () => {
      throw broken;
    };

    await expect(jarl.exec(failing, mapError)).rejects.toBe(broken);
    await expect(jarl.fn(failing, mapError)()).rejects.toBe(broken);
  });

  it("is typed the same as calling fn straight away", () => {
    const query = async () => [{ id: "7" }];
    const failed = () => new NotFound("7");

    expectTypeOf(jarl.exec(query, failed)).toEqualTypeOf<
      Promise<jarl.Result<{ id: string }[], NotFound>>
    >();
    expectTypeOf(jarl.exec(query, failed)).toEqualTypeOf(
      jarl.fn(query, failed)(),
    );
    expectTypeOf(jarl.exec(query)).toEqualTypeOf(jarl.fn(query)());
  });

  it("only accepts an async function that takes no arguments", () => {
    const misuse = () => {
      // @ts-expect-error the function must return a promise
      jarl.exec(() => "rows");
      // @ts-expect-error there are no arguments to pass it
      jarl.exec(async (id: string) => id);
      // @ts-expect-error mapError only receives the caught error
      jarl.exec(async () => "rows", (_error: unknown, id: string) => id);
      // @ts-expect-error there is no curried call
      jarl.exec(async () => "rows")();
    };

    expect(misuse).toBeTypeOf("function");
  });
});

describe("pipe", () => {
  it("chains each resolved value into the next step", async () => {
    const length = jarl.fn(
      async (input: string) => input.length,
      () => new Invalid("unknown"),
    );
    const label = jarl.fn(
      async (count: number) => `#${count}`,
      () => new NotFound("unknown"),
    );

    const result = await jarl.pipe(length, label)("hey");

    expectTypeOf(result).toEqualTypeOf<jarl.Result<string, Invalid | NotFound>>();
    expect(jarl.unwrap(result)).toBe("#3");
  });
});

describe("all", () => {
  class Timeout extends jarl.error.define("Timeout") {}

  type User = { id: string; name: string };
  type Post = { title: string };

  const user = jarl.fn(
    async (id: string): Promise<User> => ({ id, name: `user ${id}` }),
    (_error, id) => new NotFound(id),
  );
  const posts = jarl.fn(
    async (id: string): Promise<Post[]> => [{ title: `post by ${id}` }],
    () => new Timeout(),
  );
  const score = jarl.fn(
    async (id: string | number) => String(id).length,
    () => new Invalid("unknown"),
  );

  const profile = jarl.all(user, posts, score);

  it("calls every function with the same arguments and keeps their order", async () => {
    const [found, written, scored] = await profile("7");

    expect(jarl.unwrap(found)).toEqual({ id: "7", name: "user 7" });
    expect(jarl.unwrap(written)).toEqual([{ title: "post by 7" }]);
    expect(jarl.unwrap(scored)).toBe(1);
  });

  it("is typed as one result per function, in order", () => {
    const proof: Assert<
      Equal<
        typeof profile,
        (
          id: string,
        ) => Promise<
          [
            jarl.Result<User, NotFound>,
            jarl.Result<Post[], Timeout>,
            jarl.Result<number, Invalid>,
          ]
        >
      >
    > = true;

    expect(proof).toBe(true);
  });
});

describe("parseJSON", () => {
  it("parses json from a promise", async () => {
    const result = await jarl.parseJSON<{ n: number }>(
      Promise.resolve('{"n":1}'),
    );

    expectTypeOf(result).toEqualTypeOf<jarl.Result<{ n: number }, jarl.JsonError>>();
    expect(jarl.unwrap(result).n).toBe(1);
  });
});

describe("value", () => {
  it("returns the value when no error remains", () => {
    expect(jarl.value(jarl.ok("yes"))).toBe("yes");
  });
});

describe("error.define", () => {
  it("makes an error class with its own name", () => {
    class Left extends jarl.error.define("Left") {}
    const left = new Left("went left");

    expect(left).toBeInstanceOf(Error);
    expect(left.name).toBe("Left");
    expect(left.message).toBe("went left");
  });
});

describe("error.is", () => {
  class Red extends jarl.error.define("Red") {}
  class Green extends jarl.error.define("Green") {}

  const paint = (): jarl.Result<"none", Red | Green> => jarl.ok("none");

  it("removes each handled error until only the value is left", () => {
    const result = paint();

    if (jarl.error.is(result, Red)) {
      throw result.error;
    }
    if (jarl.error.is(result, Green)) {
      throw result.error;
    }

    expectTypeOf(result).toEqualTypeOf<jarl.Result<"none", never>>();
    expect(jarl.value(result)).toBe("none");
  });
});

describe("unwrap", () => {
  it("returns the value", async () => {
    const find = jarl.fn(async (id: string) => id);
    expect(await jarl.unwrap(find("7"))).toBe("7");
  });
});

describe("or_else", () => {
  it("returns the value", async () => {
    const find = jarl.fn(async (id: string) => id);
    expect(await jarl.or_else(find("7"), "fallback")).toBe("7");
  });
});

describe("ok and err", () => {
  it("builds a success that is_ok narrows to the value", () => {
    const result = jarl.ok("yes");

    if (!jarl.is_ok(result)) {
      throw new Error("expected ok");
    }
    expect(result.value).toBe("yes");
  });

  it("builds a failure that is_err narrows to the error", () => {
    const result = jarl.err(new Invalid("no"));

    if (!jarl.is_err(result)) {
      throw new Error("expected err");
    }
    expect(result.error.reason).toBe("no");
  });
});

describe("forget", () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("calls the function with the arguments and returns before it finishes", async () => {
    const release = Promise.withResolvers<void>();
    const calls: Array<[string, number]> = [];
    let finished = false;
    const save = async (id: string, count: number) => {
      calls.push([id, count]);
      await release.promise;
      finished = true;
    };

    const returned = jarl.forget(save, "7", 3);

    expect(returned).toBeUndefined();
    expect(calls).toEqual([["7", 3]]);
    expect(finished).toBe(false);

    release.resolve();
    await settle();
    expect(finished).toBe(true);
  });

  it("ignores a rejected promise", async () => {
    const unhandled: unknown[] = [];
    const track = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", track);

    try {
      jarl.forget(async (id: string) => {
        throw new NotFound(id);
      }, "7");
      await settle();
    } finally {
      process.off("unhandledRejection", track);
    }

    expect(unhandled).toEqual([]);
  });

  it("ignores a function that throws before returning its promise", () => {
    const explode = (id: string): Promise<void> => {
      throw new NotFound(id);
    };

    expect(() => jarl.forget(explode, "7")).not.toThrow();
  });

  it("returns void", () => {
    const proof: Assert<Equal<ReturnType<typeof jarl.forget>, void>> = true;

    expect(proof).toBe(true);
  });

  it("only accepts an async function and exactly its arguments", () => {
    const save = async (_id: string, _count: number) => {};

    const misuse = () => {
      // @ts-expect-error the function must return a promise
      jarl.forget((id: string) => id, "7");
      // @ts-expect-error every argument is required
      jarl.forget(save, "7");
      // @ts-expect-error the arguments must match the parameters
      jarl.forget(save, 7, 3);
      // @ts-expect-error no arguments beyond the parameters
      jarl.forget(save, "7", 3, true);
    };

    expect(misuse).toBeTypeOf("function");
  });
});
