// Allows the existing fixture suite to run under the same Node runtime as production.
import assert from "node:assert/strict";
import { test as nodeTest, before, after } from "node:test";
export const beforeAll = before;
export const afterAll = after;
export const test = (name: string, fn: () => unknown) => nodeTest(name, { timeout: 20000 }, fn);
function subset(actual: unknown, expected: unknown): boolean {
  if (!expected || typeof expected !== "object") return Object.is(actual, expected);
  return (
    actual !== null &&
    typeof actual === "object" &&
    Object.entries(expected).every(([key, value]) =>
      subset((actual as Record<string, unknown>)[key], value),
    )
  );
}
type Matchers = {
  readonly not: Matchers;
  readonly rejects: {
    toMatchObject(expected: unknown): Promise<void>;
    toBeDefined(): Promise<void>;
  };
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeNull(): void;
  toBeUndefined(): void;
  toBeDefined(): void;
  toBeGreaterThanOrEqual(expected: number): void;
  toMatchObject(expected: unknown): void;
};
export function expect(actual: unknown, negate = false): Matchers {
  const check = (condition: boolean) => assert.equal(condition, !negate);
  return {
    get not() {
      return expect(actual, !negate);
    },
    get rejects() {
      return {
        async toMatchObject(expected: unknown) {
          await assert.rejects(Promise.resolve(actual), (error: unknown) =>
            subset(error, expected),
          );
        },
        async toBeDefined() {
          await assert.rejects(Promise.resolve(actual), (error: unknown) => error !== undefined);
        },
      };
    },
    toBe(expected: unknown) {
      check(Object.is(actual, expected));
    },
    toEqual(expected: unknown) {
      if (negate) assert.notDeepEqual(actual, expected);
      else assert.deepEqual(actual, expected);
    },
    toBeNull() {
      check(actual === null);
    },
    toBeUndefined() {
      check(actual === undefined);
    },
    toBeDefined() {
      check(actual !== undefined);
    },
    toBeGreaterThanOrEqual(expected: number) {
      check(Number(actual) >= expected);
    },
    toMatchObject(expected: unknown) {
      check(subset(actual, expected));
    },
  };
}
