/// <reference types="bun-types" />
import * as jarl from "../index";

// Each step can fail with exactly one error of its own.

class InvalidOrder extends jarl.error.define("InvalidOrder") {
  constructor(readonly raw: string) {
    super(`invalid order "${raw}"`);
  }
}

class OutOfStock extends jarl.error.define("OutOfStock") {
  constructor(
    readonly sku: string,
    readonly available: number,
  ) {
    super(`only ${available} ${sku} left`);
  }
}

class PaymentDeclined extends jarl.error.define("PaymentDeclined") {
  constructor(readonly amount: number) {
    super(`card declined for ${amount}`);
  }
}

type CheckoutError = InvalidOrder | OutOfStock | PaymentDeclined;

type Order = { sku: string; quantity: number };
type Reservation = { id: string; total: number };
type Receipt = { reservation: string; charged: number };

const catalog: Record<string, { price: number; available: number }> = {
  widget: { price: 10, available: 5 },
  gadget: { price: 25, available: 1 },
  laptop: { price: 900, available: 3 },
};

const CARD_LIMIT = 500;

// string -> Order
const parseOrder = jarl.fn(
  async (raw: string): Promise<Order> => {
    const [sku, count] = raw.split(":");
    const quantity = Number(count);
    if (!sku || !Number.isInteger(quantity) || quantity <= 0) {
      throw new InvalidOrder(raw);
    }
    return { sku, quantity };
  },
  (error, raw) => (error instanceof InvalidOrder ? error : new InvalidOrder(raw)),
);

// Order -> Reservation
const reserve = jarl.fn(
  async (order: Order): Promise<Reservation> => {
    const item = catalog[order.sku];
    if (!item || item.available < order.quantity) {
      throw new OutOfStock(order.sku, item?.available ?? 0);
    }
    return {
      id: `${order.sku}-${order.quantity}`,
      total: item.price * order.quantity,
    };
  },
  (error, order) =>
    error instanceof OutOfStock ? error : new OutOfStock(order.sku, 0),
);

// Reservation -> Receipt
const charge = jarl.fn(
  async (reservation: Reservation): Promise<Receipt> => {
    if (reservation.total > CARD_LIMIT) {
      throw new PaymentDeclined(reservation.total);
    }
    return { reservation: reservation.id, charged: reservation.total };
  },
  (error, reservation) =>
    error instanceof PaymentDeclined
      ? error
      : new PaymentDeclined(reservation.total),
);

// No annotation: the value comes from `charge`, the error union from all three.
const checkout = jarl.pipe(parseOrder, reserve, charge);

// Compile-time proof. `tsgo --noEmit` fails if any of these stop holding.
type Equal<A, B> =
  (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2
    ? true
    : false;
type Assert<T extends true> = T;

type Outcome = Awaited<ReturnType<typeof checkout>>;

export type Proof = [
  Assert<Equal<typeof parseOrder, (raw: string) => Promise<jarl.Result<Order, InvalidOrder>>>>,
  Assert<Equal<typeof reserve, (order: Order) => Promise<jarl.Result<Reservation, OutOfStock>>>>,
  Assert<Equal<typeof charge, (reservation: Reservation) => Promise<jarl.Result<Receipt, PaymentDeclined>>>>,
  Assert<Equal<typeof checkout, (raw: string) => Promise<jarl.Result<Receipt, CheckoutError>>>>,
  Assert<Equal<Outcome, jarl.Result<Receipt, InvalidOrder | OutOfStock | PaymentDeclined>>>,
  Assert<Equal<Extract<Outcome, { ok: false }>["error"], CheckoutError>>,
];

export type Disproof = [
  // @ts-expect-error the union is missing PaymentDeclined
  Assert<Equal<Outcome, jarl.Result<Receipt, InvalidOrder | OutOfStock>>>,
  // @ts-expect-error the value is the last step's Receipt, not the first step's Order
  Assert<Equal<Outcome, jarl.Result<Order, CheckoutError>>>,
];

async function report(raw: string): Promise<string> {
  const result = await checkout(raw);

  if (jarl.error.is(result, InvalidOrder)) {
    return result.error.message;
  }
  if (jarl.error.is(result, OutOfStock)) {
    return `only ${result.error.available} ${result.error.sku} left`;
  }

  // Never called: it only shows that value is refused while PaymentDeclined
  // is still possible.
  // @ts-expect-error the error type is PaymentDeclined, not never
  void (() => jarl.value(result));

  if (jarl.error.is(result, PaymentDeclined)) {
    return `card declined for ${result.error.amount}`;
  }

  // Every error has been handled, so the error type is now never.
  const receipt = jarl.value(result);
  return `charged ${receipt.charged} for ${receipt.reservation}`;
}

if (import.meta.main) {
  for (const raw of ["widget:2", "widget", "gadget:3", "laptop:1"]) {
    console.log(raw.padEnd(10), "->", await report(raw));
  }
}

export {
  type CheckoutError,
  InvalidOrder,
  OutOfStock,
  PaymentDeclined,
  type Receipt,
  checkout,
  report,
};
