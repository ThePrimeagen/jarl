import { describe, expect, expectTypeOf, it } from "vitest";
import * as jarl from "../index";
import { type CheckoutError, type Receipt, checkout } from "../examples/checkout";

describe("checkout example", () => {
  it("charges an order that every step accepts", async () => {
    const result = await checkout("widget:2");

    expectTypeOf(result).toEqualTypeOf<jarl.Result<Receipt, CheckoutError>>();
    expect(jarl.unwrap(result)).toEqual({ reservation: "widget-2", charged: 20 });
  });
});
