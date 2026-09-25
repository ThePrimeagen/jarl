/// <reference types="bun-types" />
import * as jarl from "./index";

class DivideByZero extends jarl.error.define("DivideByZero") {}

const divide = jarl.fn(async (a: number, b: number) => {
  if (b === 0) {
    throw new DivideByZero("cannot divide by zero");
  }
  return a / b;
}, (error) =>
  error instanceof DivideByZero
    ? error
    : new DivideByZero("cannot divide by zero"),
);

const doubled = jarl.map(
  divide,
  jarl.fn(async (n: number) => n * 2, () => new DivideByZero("cannot double")),
);

const result = await doubled(10, 2);

if (jarl.error.is(result, DivideByZero)) {
  console.log("error", result.error.message);
} else {
  console.log(jarl.value(result));
}

const parsed = await jarl.parseJSON<{ n: number }>(Promise.resolve('{"n":1}'));
if (jarl.is_ok(parsed)) {
  console.log("parsed", parsed.value.n);
}
