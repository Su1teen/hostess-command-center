import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import {
  calculate,
  toMinor,
  normalizePhone,
  assertTransition,
  priceLines,
  quoteInput,
  type Snapshot,
} from "../src/server/dine-in/domain";
import { qrPng, qrSvg, zipFiles, crc32, tableUrl, printPanels } from "../src/server/dine-in/qr";
const now = Date.now(),
  id = "11111111-1111-4111-8111-111111111111";
const sample: Snapshot = {
  status: "ok",
  generatedAt: new Date(now).toISOString(),
  currentRound: { id: "round", endsAt: new Date(now + 600000).toISOString() },
  products: [{ id, name: "Drink", price: 1590, currency: "KZT", isAvailable: true }],
};
describe("exact money and loyalty", () => {
  test("4770 minus 1000 earns 113 whole KZT", () =>
    expect(calculate(477000, 100000, 100000)).toEqual({
      subtotalMinor: 477000,
      discountMinor: 100000,
      payableMinor: 377000,
      cashbackMinor: 11300,
    }));
  test("fully redeemed earns zero", () =>
    expect(calculate(477000, 999999, 477000).cashbackMinor).toBe(0));
  test("redemption cannot exceed balance", () =>
    expect(calculate(477000, 999999, 4500).discountMinor).toBe(4500));
  test("cashback rounds down whole KZT", () => expect(calculate(1999, 0, 0).cashbackMinor).toBe(0));
  test("decimal price exact", () => {
    expect(toMinor("1590.29")).toBe(159029);
    expect(toMinor(0.01)).toBe(1);
  });
  test.each(["1.001", "-1", "Infinity", "1e+20", "10000000000000"])("invalid price %s", (p) =>
    expect(() => toMinor(p)).toThrow(),
  );
  test.each(["87011234567", "+7 (701) 123-45-67", "7011234567"])("KZ phone %s", (p) =>
    expect(normalizePhone(p)).toBe("+77011234567"),
  );
  test("invalid phone", () => expect(() => normalizePhone("123")).toThrow());
});
describe("quote and service state", () => {
  test("current snapshot price and TTL", () => {
    const p = priceLines(sample, [{ productId: id, quantity: 3 }], now);
    expect(p.lines[0].totalMinor).toBe(477000);
    expect(Date.parse(p.expiresAt)).toBe(now + 120000);
  });
  test("round boundary limits expiry", () =>
    expect(
      Date.parse(
        priceLines(
          { ...sample, currentRound: { id: "r", endsAt: new Date(now + 10000).toISOString() } },
          [],
          now,
        ).expiresAt,
      ),
    ).toBe(now + 10000));
  test("last five seconds require requote", () =>
    expect(() =>
      priceLines(
        { ...sample, currentRound: { id: "r", endsAt: new Date(now + 4000).toISOString() } },
        [],
        now,
      ),
    ).toThrow());
  test("stale snapshot", () =>
    expect(() =>
      priceLines({ ...sample, generatedAt: new Date(now - 61000).toISOString() }, [], now),
    ).toThrow());
  test("unavailable product", () =>
    expect(() =>
      priceLines(
        { ...sample, products: [{ ...sample.products[0], isAvailable: false }] },
        [{ productId: id, quantity: 1 }],
        now,
      ),
    ).toThrow());
  test("browser cannot assert guest or price", () =>
    expect(
      quoteInput.safeParse({
        qrToken: "a".repeat(43),
        items: [{ productId: id, quantity: 1 }],
        guestId: id,
        unitPrice: 1,
      }).success,
    ).toBe(false));
  test("duplicate products", () =>
    expect(
      quoteInput.safeParse({
        qrToken: "a".repeat(43),
        items: [
          { productId: id, quantity: 1 },
          { productId: id, quantity: 2 },
        ],
      }).success,
    ).toBe(false));
  test("valid state transition", () =>
    expect(() => assertTransition("new", "accepted")).not.toThrow());
  test("skip, cancel shortcut and reopen rejected", () => {
    expect(() => assertTransition("new", "closed")).toThrow();
    expect(() => assertTransition("new", "cancelled")).toThrow();
    expect(() => assertTransition("cancelled", "closed")).toThrow();
  });
});
describe("real QR exports", () => {
  const url = "https://hostess.online/v/xoxo/t/03/" + "a".repeat(64);
  test("SVG modules and quiet zone", () => {
    const svg = qrSvg(url);
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain("M4,4");
  });
  test("PNG checksums and pixel buffer", () => {
    const png = qrPng(url);
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    let p = 8,
      width = 0,
      image = Buffer.alloc(0);
    while (p < png.length) {
      const n = png.readUInt32BE(p),
        type = png.subarray(p + 4, p + 8).toString(),
        bytes = png.subarray(p + 8, p + 8 + n);
      expect(png.readUInt32BE(p + 8 + n)).toBe(crc32(png.subarray(p + 4, p + 8 + n)));
      if (type === "IHDR") width = bytes.readUInt32BE(0);
      if (type === "IDAT") image = Buffer.concat([image, bytes]);
      p += n + 12;
    }
    expect(inflateSync(image).length).toBe((width + 1) * width);
  });
  test("ZIP local and central directories", () => {
    const zip = zipFiles([{ name: "one.svg", data: Buffer.from(qrSvg(url)) }]);
    expect(zip.readUInt32LE()).toBe(0x04034b50);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    expect(zip.readUInt16LE(zip.length - 14)).toBe(1);
  });
  test("print markup escapes labels", () => {
    const html = printPanels([{ code: "<script>", url, enabled: false }]);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("@page");
  });
  test("permanent public URL", () => {
    process.env.HOSTESS_PUBLIC_ORIGIN = "https://hostess.online";
    expect(tableUrl("03", "a".repeat(43))).toBe(
      "https://hostess.online/v/xoxo/t/03/" + "a".repeat(43),
    );
  });
});
