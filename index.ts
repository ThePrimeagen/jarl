export type Result<T, E> = { ok: true; value: T } | Err<E>;

// One `{ ok: false }` branch per error, so `error.is` can drop that error
// from the union and leave the rest.
type Err<E> = E extends any ? { ok: false; error: E } : never;

type ResultFn<A extends readonly unknown[], T, E> = (
  ...args: A
) => Promise<Result<T, E>>;

type Step<In, Out, E> = ResultFn<[In], Out, E>;

type Ctor<T> = abstract new (...args: any[]) => T;

// Read off the result rather than inferred through `Err<E>`: inference picks
// a single candidate from a union of `{ ok: false }` branches, not all of them.
type ErrorOf<R> = R extends { ok: false; error: infer E } ? E : never;

// The value, read off the result for the same reason. Functions that take a
// result take the whole of it as R, so one error.is has narrowed still fits.
type ValueOf<R> = R extends { ok: true; value: infer T } ? T : never;

// The branches of R whose error is C. A C that only subclasses one of the
// errors narrows that branch to C.
type Narrow<R, C> = R extends { ok: false; error: infer E }
  ? [E] extends [C]
    ? R
    : [C] extends [E]
      ? R & Err<C>
      : never
  : never;

function isResult(value: unknown): value is Result<unknown, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (!("ok" in value) || typeof value.ok !== "boolean") {
    return false;
  }

  if (value.ok) {
    return "value" in value;
  }

  return "error" in value;
}

function fn<A extends unknown[], T, E>(
  inner: (...args: A) => Promise<T>,
  mapError: (error: unknown, ...args: A) => E,
): ResultFn<A, T, E>;

function fn<A extends unknown[], T>(
  inner: (...args: A) => Promise<T>,
): ResultFn<A, T, unknown>;

function fn<A extends unknown[], T, E>(
  inner: (...args: A) => Promise<T>,
  mapError?: (error: unknown, ...args: A) => E,
): ResultFn<A, T, E | unknown> {
  return async (...args) => {
    try {
      const value = await inner(...args);
      return { ok: true, value };
    } catch (caught) {
      const error = mapError ? mapError(caught, ...args) : caught;
      return { ok: false, error } as Result<T, E | unknown>;
    }
  };
}

function exec<T, E>(
  inner: () => Promise<T>,
  mapError: (error: unknown) => E,
): Promise<Result<T, E>>;

function exec<T>(inner: () => Promise<T>): Promise<Result<T, unknown>>;

function exec<T, E>(
  inner: () => Promise<T>,
  mapError?: (error: unknown) => E,
): Promise<Result<T, E | unknown>> {
  return mapError ? fn(inner, mapError)() : fn(inner)();
}

function pipe<A extends unknown[], T, E>(
  first: ResultFn<A, T, E>,
): ResultFn<A, T, E>;

function pipe<A extends unknown[], T, E, T1, E1>(
  first: ResultFn<A, T, E>,
  step1: Step<T, T1, E1>,
): ResultFn<A, T1, E | E1>;

function pipe<A extends unknown[], T, E, T1, E1, T2, E2>(
  first: ResultFn<A, T, E>,
  step1: Step<T, T1, E1>,
  step2: Step<T1, T2, E2>,
): ResultFn<A, T2, E | E1 | E2>;

function pipe<A extends unknown[], T, E, T1, E1, T2, E2, T3, E3>(
  first: ResultFn<A, T, E>,
  step1: Step<T, T1, E1>,
  step2: Step<T1, T2, E2>,
  step3: Step<T2, T3, E3>,
): ResultFn<A, T3, E | E1 | E2 | E3>;

function pipe<A extends unknown[], T, E, T1, E1, T2, E2, T3, E3, T4, E4>(
  first: ResultFn<A, T, E>,
  step1: Step<T, T1, E1>,
  step2: Step<T1, T2, E2>,
  step3: Step<T2, T3, E3>,
  step4: Step<T3, T4, E4>,
): ResultFn<A, T4, E | E1 | E2 | E3 | E4>;

function pipe<
  A extends unknown[],
  T,
  E,
  T1,
  E1,
  T2,
  E2,
  T3,
  E3,
  T4,
  E4,
  T5,
  E5,
>(
  first: ResultFn<A, T, E>,
  step1: Step<T, T1, E1>,
  step2: Step<T1, T2, E2>,
  step3: Step<T2, T3, E3>,
  step4: Step<T3, T4, E4>,
  step5: Step<T4, T5, E5>,
): ResultFn<A, T5, E | E1 | E2 | E3 | E4 | E5>;

function pipe(
  first: (...args: never[]) => Promise<Result<unknown, unknown>>,
  ...rest: Array<(value: never) => Promise<Result<unknown, unknown>>>
): (...args: never[]) => Promise<Result<unknown, unknown>> {
  return async (...args) => {
    let current = await first(...args);

    for (const step of rest) {
      if (!current.ok) {
        return current;
      }
      current = await step(current.value as never);
    }

    return current;
  };
}

type AnyResultFn = (...args: never[]) => Promise<Result<unknown, unknown>>;

// Each function's own result, read off its return type so its errors stay
// exactly as that function declared them.
type Results<Fns extends readonly AnyResultFn[]> = {
  -readonly [K in keyof Fns]: Awaited<ReturnType<Fns[K]>>;
};

// The parameters of the first function every function can be called with.
// Computed rather than inferred: inference cannot choose between `[]` and
// `[id: string]`, though a function taking nothing accepts either. When none
// fits, the first function's parameters make the mismatch an argument error.
type SharedArgs<
  Fns extends readonly AnyResultFn[],
  Rest extends readonly AnyResultFn[] = Fns,
> = Rest extends readonly [
  infer F extends AnyResultFn,
  ...infer Tail extends readonly AnyResultFn[],
]
  ? Fns[number] extends (...args: Parameters<F>) => unknown
    ? Parameters<F>
    : SharedArgs<Fns, Tail>
  : Parameters<Fns[0]>;

function all<Fns extends readonly [AnyResultFn, ...AnyResultFn[]]>(
  ...fns: Fns &
    readonly ((
      ...args: SharedArgs<Fns>
    ) => Promise<Result<unknown, unknown>>)[]
): (...args: SharedArgs<Fns>) => Promise<Results<Fns>>;

function all(
  ...fns: AnyResultFn[]
): (...args: never[]) => Promise<Result<unknown, unknown>[]> {
  return async (...args) => Promise.all(fns.map((call) => call(...args)));
}

async function parseJSON<T = unknown>(
  input: string | Promise<string>,
): Promise<Result<T, JsonError>> {
  let text: string;
  try {
    text = await input;
  } catch (caught) {
    return { ok: false, error: jsonError(caught) };
  }

  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch (caught) {
    return { ok: false, error: jsonError(caught) };
  }
}

function jsonError(caught: unknown): JsonError {
  if (caught instanceof JsonError) {
    return caught;
  }
  return new JsonError(caught);
}

function value<T>(result: Result<T, never>): T {
  // `never` has no error branch in the type system. The cast keeps a runtime
  // check for errors TypeScript collapsed into the success path.
  const settled = result as Result<T, unknown>;
  if (!settled.ok) {
    throw settled.error;
  }
  return settled.value;
}

function unwrap<R extends Result<unknown, unknown>>(result: R): ValueOf<R>;
function unwrap<R extends Result<unknown, unknown>>(
  result: Promise<R>,
): Promise<ValueOf<R>>;
function unwrap(
  result: Result<unknown, unknown> | Promise<Result<unknown, unknown>>,
): unknown {
  if (isResult(result)) {
    if (result.ok) {
      return result.value;
    }
    throw result.error;
  }

  return result.then((settled) => {
    if (settled.ok) {
      return settled.value;
    }
    throw settled.error;
  });
}

async function or_else<T, E>(
  result: Promise<Result<T, E>>,
  fallback: T,
): Promise<T> {
  try {
    const settled = await result;
    if (settled.ok) {
      return settled.value;
    }
  } catch {
    // A rejected promise is the same outcome as an error result.
  }
  return fallback;
}

function forget<A extends unknown[]>(
  inner: (...args: A) => Promise<unknown>,
  ...args: A
): void {
  // Called inside an async function so a synchronous throw is caught too.
  void (async () => {
    try {
      await inner(...args);
    } catch {
      // Nobody is waiting for the outcome.
    }
  })();
}

function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

function err<E>(error: E): Result<never, E> {
  return { ok: false, error } as Result<never, E>;
}

function is_ok<R extends Result<unknown, unknown>>(
  result: R,
): result is Extract<R, { ok: true }> {
  return result.ok;
}

function is_err<R extends Result<unknown, unknown>>(
  result: R,
): result is Extract<R, { ok: false }> {
  return !result.ok;
}

function is<R extends Result<unknown, unknown>, C extends ErrorOf<R>>(
  result: R,
  ctor: Ctor<C>,
): result is Narrow<R, C>;

function is<C>(error: unknown, ctor: Ctor<C>): error is C;

function is(value: unknown, ctor: Ctor<unknown>): boolean {
  if (value instanceof ctor) {
    return true;
  }
  if (isResult(value)) {
    return !value.ok && value.error instanceof ctor;
  }
  return false;
}

// A private field keeps different names apart. The same name is one type:
// two classes that both call define("NotFound") collapse together.
function define<const Name extends string>(name: Name) {
  return class JarlError extends Error {
    readonly #kind: Name;
    constructor(message?: string) {
      super(message);
      this.name = name;
      this.#kind = name;
    }
    get [Symbol.toStringTag]() {
      return this.#kind;
    }
  };
}

// Not an `Error` subclass: built-in errors are structurally identical, so a
// `SyntaxError` in the union would disappear when another one was handled.
class JsonError {
  readonly #kind = "JsonError" as const;
  readonly message: string;
  readonly caught: unknown;

  constructor(caught: unknown) {
    this.caught = caught;
    this.message = caught instanceof Error ? caught.message : String(caught);
  }

  get [Symbol.toStringTag]() {
    return this.#kind;
  }
}

const error = { define, is };

export {
  JsonError,
  all,
  err,
  error,
  exec,
  fn,
  forget,
  is_err,
  is_ok,
  ok,
  or_else,
  parseJSON,
  pipe,
  unwrap,
  value,
};
