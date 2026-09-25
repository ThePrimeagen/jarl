# jarl
Just Another Result Library

Every operation returns `Promise<Result<Value, Error>>`. `map` keeps the value from the last step and unions the error from every step. `error.is` removes the error you handled from that union. Once nothing is left, the error type is `never`, and `value` will accept the result. `unwrap` throws whatever error is still there. Define error classes with `error.define` so each name stays in that union, even when the class has no fields of its own.

The tests in `test/result.spec.ts` are the usage examples.

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
