import { describe, expect, expectTypeOf, it } from "vitest";
import * as jarl from "../index";
import {
  type CheckoutError,
  InvalidOrder,
  OutOfStock,
  PaymentDeclined,
  type Receipt,
  checkout,
  report,
} from "../examples/checkout";

describe("checkout example", () => {
  it("infers the last step's value and the union of all three errors", () => {
    expectTypeOf(checkout).toEqualTypeOf<
      (raw: string) => Promise<jarl.Result<Receipt, CheckoutError>>
    >();
    expectTypeOf<CheckoutError>().toEqualTypeOf<
      InvalidOrder | OutOfStock | PaymentDeclined
    >();
  });

  it("charges an order that every step accepts", async () => {
    const result = await checkout("widget:2");

    if (!jarl.is_ok(result)) {
      throw result.error;
    }
    expect(result.value).toEqual({ reservation: "widget-2", charged: 20 });
    expect(await report("widget:2")).toBe("charged 20 for widget-2");
  });

  it("fails in the first step with InvalidOrder", async () => {
    const result = await checkout("widget");

    if (!jarl.error.is(result, InvalidOrder)) {
      throw new Error("expected InvalidOrder");
    }
    expect(result.error.raw).toBe("widget");
    expect(await report("widget")).toBe('invalid order "widget"');
  });

  it("fails in the second step with OutOfStock", async () => {
    const result = await checkout("gadget:3");

    if (!jarl.error.is(result, OutOfStock)) {
      throw new Error("expected OutOfStock");
    }
    expect(result.error.sku).toBe("gadget");
    expect(result.error.available).toBe(1);
    expect(await report("gadget:3")).toBe("only 1 gadget left");
  });

  it("fails in the third step with PaymentDeclined", async () => {
    const result = await checkout("laptop:1");

    if (!jarl.error.is(result, PaymentDeclined)) {
      throw new Error("expected PaymentDeclined");
    }
    expect(result.error.amount).toBe(900);
    expect(await report("laptop:1")).toBe("card declined for 900");
  });
});
