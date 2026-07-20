/**
 * Unit tests for the pump.fun fee-share decoder (M9, plan §8 "unit against saved
 * live fixtures"). The fixture is the real creator account for $WIZARD, recorded
 * via Helius getAccountInfo during the M9 research spike.
 *
 * The decoder's job is as much REFUSAL as decoding: the layout is reverse-
 * engineered from account bytes (pump.fun publishes no IDL for the fee-share
 * program), so anything that contradicts the layout must yield null rather than a
 * plausible-looking split. Mimo's Tribute states on-screen how the fee is divided;
 * a wrong split there would be exactly the unverified claim M9 exists to prevent.
 * The negative cases below are therefore the point of this file, not filler.
 */

import { describe, expect, it } from "vitest";
import {
  decodeFeeShareConfig,
  toBase58,
  PUMP_FEE_SHARE_PROGRAM,
} from "@/lib/sources/creator-fees";
import { TOKEN } from "@/config/token";
import raw from "./fixtures/pumpfun-fee-config-account.json";

const CREATOR = "3ecXTre9LyqzjheLKpiBbsEm29aLLLfm2KidrVjfAAkM";

/** Deep-clone the fixture so a mutation in one case can't leak into another. */
const clone = () => JSON.parse(JSON.stringify(raw));

/** Rebuild a fixture whose account data is `bytes`. */
function withBytes(bytes: Uint8Array) {
  const f = clone();
  f.result.value.data[0] = Buffer.from(bytes).toString("base64");
  return f;
}

function fixtureBytes(): Uint8Array {
  return Uint8Array.from(Buffer.from(clone().result.value.data[0], "base64"));
}

describe("toBase58", () => {
  it("round-trips a known Solana address", () => {
    // The mint is embedded at offset 11 of the fixture — decoding it back to the
    // configured mint proves the encoder against a value we already trust.
    const bytes = fixtureBytes().subarray(11, 43);
    expect(toBase58(bytes)).toBe(TOKEN.mint);
  });

  it("encodes leading zero bytes as leading '1's", () => {
    expect(toBase58(new Uint8Array(32))).toBe("1".repeat(32));
  });
});

describe("decodeFeeShareConfig — the live $WIZARD account", () => {
  const config = decodeFeeShareConfig(clone(), CREATOR);

  it("decodes the account the coin actually points at", () => {
    expect(config).not.toBeNull();
    expect(config!.address).toBe(CREATOR);
    expect(config!.mint).toBe(TOKEN.mint);
  });

  it("is owned by pump.fun's fee-share program, not a wallet", () => {
    // The premise of the card: the coin's "creator" is a program account.
    expect(clone().result.value.owner).toBe(PUMP_FEE_SHARE_PROGRAM);
  });

  it("splits the fee between two recipients, 50/50", () => {
    expect(config!.recipients).toHaveLength(2);
    expect(config!.recipients.map((r) => r.address)).toEqual([
      "3Ee23hHUyG6QdurRrFei2dGHiD1TwWnciVNtRughUYiC",
      "HyPT5NYEztNVKoJFr8Bf4mVs9ZqV4dccaeqmmqmF6Lnd",
    ]);
    expect(config!.recipients.map((r) => r.bps)).toEqual([5000, 5000]);
    expect(config!.recipients.map((r) => r.pct)).toEqual([50, 50]);
  });

  it("reports shares that sum to a whole", () => {
    expect(config!.totalBps).toBe(10_000);
    expect(config!.recipients.reduce((s, r) => s + r.pct, 0)).toBeCloseTo(100, 10);
  });

  it("exposes the admin that can reconfigure the split", () => {
    expect(config!.admin).toBe("3Ee23hHUyG6QdurRrFei2dGHiD1TwWnciVNtRughUYiC");
  });
});

describe("decodeFeeShareConfig — refuses anything it cannot prove", () => {
  it("returns null for a foreign owner program", () => {
    const f = clone();
    f.result.value.owner = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
    expect(decodeFeeShareConfig(f, CREATOR)).toBeNull();
  });

  it("returns null when the embedded mint is not ours (layout mis-read)", () => {
    expect(decodeFeeShareConfig(clone(), CREATOR, "SomeOtherMint1111111111111111111111111111111")).toBeNull();
  });

  it("returns null when the account does not exist", () => {
    const f = clone();
    f.result.value = null;
    expect(decodeFeeShareConfig(f, CREATOR)).toBeNull();
  });

  it("returns null on a truncated buffer", () => {
    expect(decodeFeeShareConfig(withBytes(fixtureBytes().subarray(0, 90)), CREATOR)).toBeNull();
  });

  it("returns null when the shares do not sum to 10000 bps", () => {
    const bytes = fixtureBytes();
    // Halve the first recipient's share → 2500 + 5000 = 7500, an impossible split.
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(112, 2500, true);
    expect(decodeFeeShareConfig(withBytes(bytes), CREATOR)).toBeNull();
  });

  it("returns null on an implausible recipient count", () => {
    const bytes = fixtureBytes();
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(76, 9999, true);
    expect(decodeFeeShareConfig(withBytes(bytes), CREATOR)).toBeNull();
  });

  it("returns null on a zero recipient count", () => {
    const bytes = fixtureBytes();
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(76, 0, true);
    expect(decodeFeeShareConfig(withBytes(bytes), CREATOR)).toBeNull();
  });

  it("returns null on a malformed RPC envelope", () => {
    expect(decodeFeeShareConfig({ nope: true }, CREATOR)).toBeNull();
    expect(decodeFeeShareConfig(null, CREATOR)).toBeNull();
  });
});
