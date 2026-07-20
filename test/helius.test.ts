import { describe, expect, it } from "vitest";
import {
  mapSupply,
  mapTokenAccountsPage,
  aggregateByOwner,
} from "@/lib/sources/helius";
import supplyRaw from "./fixtures/helius-token-supply.json";
import page1 from "./fixtures/helius-token-accounts-page1.json";

/**
 * Recorded live 2026-07-19 from the Helius RPC (getTokenSupply + the first DAS
 * getTokenAccounts page, §5 "record a real first-page response"). The mappers must
 * parse them into the shapes the scan aggregates.
 */

describe("mapSupply — live circulating supply", () => {
  it("reads raw supply + decimals (live supply, not the 1B fallback)", () => {
    const s = mapSupply(supplyRaw);
    expect(s.supplyRaw).toBe(999_767_807_726_302);
    expect(s.decimals).toBe(6);
    // Live supply is BELOW the nominal 1B — some was burned (§ orchestrator note).
    expect(s.supplyRaw / 10 ** s.decimals).toBeLessThan(1_000_000_000);
  });

  it("rejects a response with no positive supply", () => {
    expect(() => mapSupply({ result: { value: { amount: "0", decimals: 6 } } })).toThrow();
  });
});

describe("mapTokenAccountsPage — one DAS page", () => {
  const page = mapTokenAccountsPage(page1);

  it("returns exactly the recorded page's accounts, positive balances only", () => {
    expect(page.rawCount).toBe(1000);
    expect(page.accounts.length).toBeGreaterThan(0);
    expect(page.accounts.length).toBeLessThanOrEqual(1000);
    for (const a of page.accounts) {
      expect(typeof a.owner).toBe("string");
      expect(a.amount).toBeGreaterThan(0);
    }
  });

  it("tolerates a missing/empty token_accounts array", () => {
    expect(mapTokenAccountsPage({ result: {} }).accounts).toEqual([]);
    expect(mapTokenAccountsPage({ result: { token_accounts: [] } }).rawCount).toBe(0);
  });

  it("drops zero-balance and owner-less rows", () => {
    const raw = {
      result: {
        token_accounts: [
          { address: "a", owner: "alice", amount: "100" },
          { address: "b", owner: "bob", amount: "0" },
          { address: "c", amount: "50" }, // no owner
        ],
      },
    };
    const mapped = mapTokenAccountsPage(raw);
    expect(mapped.rawCount).toBe(3);
    expect(mapped.accounts).toEqual([{ owner: "alice", amount: 100 }]);
  });
});

describe("aggregateByOwner", () => {
  it("sums an owner's multiple token accounts into one holder", () => {
    const holders = aggregateByOwner([
      { owner: "alice", amount: 100 },
      { owner: "bob", amount: 30 },
      { owner: "alice", amount: 25 },
    ]);
    const byOwner = Object.fromEntries(holders.map((h) => [h.owner, h.amount]));
    expect(byOwner).toEqual({ alice: 125, bob: 30 });
  });

  it("aggregating the recorded page yields distinct owners ≤ the account count", () => {
    const page = mapTokenAccountsPage(page1);
    const owners = aggregateByOwner(page.accounts);
    expect(owners.length).toBeLessThanOrEqual(page.accounts.length);
    expect(owners.every((o) => o.amount > 0)).toBe(true);
  });
});
