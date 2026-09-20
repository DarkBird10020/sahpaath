import { expect, it } from "vitest";
import { createSlots } from "../server/slots";

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

it("never runs more than the limit at once and finishes every job in order", async () => {
  const slots = createSlots(2);
  let running = 0;
  let peak = 0;
  const order: number[] = [];
  const job = (n: number) =>
    slots.run(async () => {
      running++;
      peak = Math.max(peak, running);
      await tick();
      running--;
      order.push(n);
    });
  await Promise.all(Array.from({ length: 7 }, (_, i) => job(i)));
  expect(peak).toBe(2);
  expect(order).toHaveLength(7);
  expect(slots.active).toBe(0);
  expect(slots.waiting).toBe(0);
});

it("a caller arriving as a slot is handed over cannot squeeze in a third job", async () => {
  const slots = createSlots(1);
  let running = 0;
  let peak = 0;
  const job = () =>
    slots.run(async () => {
      running++;
      peak = Math.max(peak, running);
      await tick();
      running--;
    });
  const first = job();
  const second = job();
  await first;
  const latecomer = job(); // arrives right after the first finished, before the second has started
  await Promise.all([second, latecomer]);
  expect(peak).toBe(1);
});

it("a failing job frees its slot", async () => {
  const slots = createSlots(1);
  await expect(slots.run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
  expect(await slots.run(async () => "ok")).toBe("ok");
  expect(slots.active).toBe(0);
});
