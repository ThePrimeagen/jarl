# jarl
Just Another Result Library

Every operation returns `Promise<Result<Value, Error>>`. `pipe` keeps the value from the last step and unions the error from every step. `all` calls every function with the same arguments at once and resolves to a tuple holding each function's own `Result`, so `jarl.all(user, posts)` is `(id: string) => Promise<[Result<User, NotFound>, Result<Post[], Timeout>]>`. One failing does not stop or change the others. `error.is` removes the error you handled from that union. Once nothing is left, the error type is `never`, and `value` will accept the result. `unwrap` throws whatever error is still there. Define error classes with `error.define` so each name stays in that union, even when the class has no fields of its own.

`exec` is `fn` without the extra call. `jarl.exec(query, failed)` is the same as `jarl.fn(query, failed)()`: it calls `query()` once and resolves to `Promise<Result<Value, Error>>`. `failed` is optional and only receives the caught error. Without it, the error is whatever was thrown, typed `unknown`.

`forget` is for work nobody waits on. `jarl.forget(save, id, draft)` calls `save(id, draft)` and returns `void` straight away. It only takes a function that returns a promise, and the arguments after it must be exactly that function's parameters. Whether `save` rejects or throws before it returns its promise, the error is ignored.

The tests in `test/result.spec.ts` are the usage examples. `examples/checkout.ts` pipes three steps that each fail with a different error and proves at compile time that the result is `Promise<Result<Receipt, InvalidOrder | OutOfStock | PaymentDeclined>>`. Run it with `bun examples/checkout.ts`. `examples/settings.ts` handles one of three errors with `error.is` and hands what is left to `unwrap`, `is_ok` and `is_err`, proving at compile time that each sees exactly the two errors still possible. Run it with `bun examples/settings.ts`.

```ts
import * as jarl from "jarl";

class DivideByZero extends jarl.error.define("DivideByZero") {}

const divide = jarl.fn(async (a: number, b: number) => {
  if (b === 0) throw new DivideByZero("cannot divide by zero");
  return a / b;
}, (error) =>
  error instanceof DivideByZero
    ? error
    : new DivideByZero("cannot divide by zero"),
);

const result = await divide(10, 2);

if (jarl.error.is(result, DivideByZero)) {
  console.log(result.error.message);
} else {
  console.log(jarl.value(result));
}
```
