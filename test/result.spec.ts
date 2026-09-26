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
