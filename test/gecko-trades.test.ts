import { describe, expect, it } from "vitest";
import { mapPoolTrades, type PoolInput } from "@/lib/sources/gecko-trades";
import { TOKEN, THRESHOLDS } from "@/config/token";
import pumpswapRaw from "./fixtures/geckoterminal-trades-pumpswap.json";

const PUMPSWAP: PoolInput = {
  pool: "Dw4kAH8LhdmgfW1cgyvnWSwSDqkt37jeY7pW4oFkbGTu",
  poolLabel: "PumpSwap",
  quoteSymbol: "SOL",
};

const SOL = "So11111111111111111111111111111111111111112";

describe("mapPoolTrades — recorded PumpSwap fixture", () => {
  const trades = mapPoolTrades(pumpswapRaw, PUMPSWAP);

  it("maps every WIZARD leg in the fixture (99 trades)", () => {
    expect(trades).toHaveLength(99);
  });

  it("carries the pool's labels onto each trade", () => {
    for (const t of trades) {
      expect(t.pool).toBe(PUMPSWAP.pool);
      expect(t.poolLabel).toBe("PumpSwap");
      expect(t.quoteSymbol).toBe("SOL");
    }
  });

  it("derives side, amount and price from WIZARD's position — not `kind`", () => {
    // Fixture's newest leg: WIZARD -> SOL, so WIZARD was SPENT ⇒ SELL.
    const first = trades[0];
    expect(first.side).toBe("sell");
    expect(first.wizardAmount).toBeCloseTo(973365.782651, 3);
    expect(first.priceUsd).toBeGreaterThan(0);
    expect(first.usd).toBeCloseTo(196.4392938, 3);
    expect(first.wallet).toBe("DYT8RFBNpU3rW1UnTJoxQ65sbFKmrM88aAcGfiBFqK4z");
  });

  it("flags whales exactly at the configured threshold", () => {
    for (const t of trades) {
      expect(t.whale).toBe(t.usd >= THRESHOLDS.whaleUsd);
    }
  });

  it("produces finite timestamps and non-negative USD everywhere", () => {
    for (const t of trades) {
      expect(Number.isFinite(t.ts)).toBe(true);
      expect(t.usd).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("mapPoolTrades — side logic is pool-orientation-safe", () => {
  // A synthetic pool where WIZARD is the QUOTE (base is some other token). The
  // WIZARD-position rule must still classify side correctly, and GeckoTerminal's
  // `kind` (relative to the OTHER base token) must be ignored.
  const OTHER = "USD2xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
  const raw = {
    data: [
      {
        // WIZARD received ⇒ BUY, regardless of `kind: "sell"` (base = OTHER sold).
        attributes: {
          block_timestamp: "2026-07-18T05:00:00Z",
          kind: "sell",
          tx_hash: "BUYHASH",
          tx_from_address: "walletA",
          from_token_address: OTHER,
          to_token_address: TOKEN.mint,
          from_token_amount: "10",
          to_token_amount: "5000",
          price_from_in_usd: "1",
          price_to_in_usd: "0.0002",
          volume_in_usd: "600",
        },
      },
      {
        // WIZARD spent ⇒ SELL, regardless of `kind: "buy"`.
        attributes: {
          block_timestamp: "2026-07-18T05:01:00Z",
          kind: "buy",
          tx_hash: "SELLHASH",
          tx_from_address: "walletB",
          from_token_address: TOKEN.mint,
          to_token_address: OTHER,
          from_token_amount: "3000",
          to_token_amount: "6",
          price_from_in_usd: "0.0002",
          price_to_in_usd: "1",
          volume_in_usd: "120",
        },
      },
      {
        // Neither side is WIZARD — dropped.
        attributes: {
          block_timestamp: "2026-07-18T05:02:00Z",
          kind: "buy",
          tx_hash: "DROPHASH",
          tx_from_address: "walletC",
          from_token_address: OTHER,
          to_token_address: SOL,
          from_token_amount: "1",
          to_token_amount: "1",
          price_from_in_usd: "1",
          price_to_in_usd: "1",
          volume_in_usd: "1",
        },
      },
    ],
  };

  const trades = mapPoolTrades(raw, { pool: "P", poolLabel: "Meteora", quoteSymbol: "USD2" });

  it("classifies WIZARD-received as BUY and WIZARD-spent as SELL", () => {
    expect(trades).toHaveLength(2);
    const buy = trades.find((t) => t.txHash === "BUYHASH")!;
    const sell = trades.find((t) => t.txHash === "SELLHASH")!;
    expect(buy.side).toBe("buy");
    expect(buy.wizardAmount).toBe(5000);
    expect(buy.priceUsd).toBe(0.0002);
    expect(buy.whale).toBe(true); // $600 ≥ $500
    expect(sell.side).toBe("sell");
    expect(sell.wizardAmount).toBe(3000);
    expect(sell.whale).toBe(false); // $120 < $500
  });

  it("drops legs that do not involve WIZARD", () => {
    expect(trades.some((t) => t.txHash === "DROPHASH")).toBe(false);
  });
});
