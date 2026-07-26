/**
 * Mimo's Tribute — where creator fees actually go (plan §4 module 10, M9/M11).
 *
 * M9 shipped this WITHOUT a total, on purpose: the coin's on-chain "creator" is
 * a pump.fun fee-SHARE program account that forks every lamport between two
 * accounts, and nothing on-chain says whose they are. Printing a sum under a
 * real person's name on that evidence would have been a claim we could not
 * support.
 *
 * The total is shown now (2026-07-26) because the missing half arrived from
 * outside the chain: the token team identified both wallets and the product
 * owner confirmed it. So the card states each source of belief separately — the
 * chain proves the money and the split, the team names the wallets — rather
 * than letting the reader assume one vouches for the other. Labels live in
 * `FEE_RECIPIENT_LABELS` (config/token.ts); drop one and that recipient falls
 * back to a bare address.
 *
 * The route is still the card's spine: the fork is the interesting part, and
 * the total means little without it. Everything structural is read live from
 * chain state (the split is decoded per-request from the creator account), so
 * the card cannot drift into asserting a split that has since changed.
 *
 * Not a client component: there is nothing to poll. The split is structural and
 * changes only when the creator reconfigures it, so page.tsx seeds it server-side
 * and the card renders once (cf. The Origin Scroll).
 */

import { CardFrame } from "@/components/wizard/CardFrame";
import { fmtAddr } from "@/lib/format";
import { FEE_RECIPIENT_LABELS, LINKS } from "@/config/token";
import type { CreatorFeeResult, CreatorFeeTotal } from "@/lib/sources/creator-fees";

function Solscan({ address, label }: { address: string; label?: string }) {
  return (
    <a
      href={`https://solscan.io/account/${address}`}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono tabular-nums text-violet-soft transition-colors hover:text-ink"
      title={address}
    >
      {label ?? fmtAddr(address)} ↗
    </a>
  );
}

/**
 * One leg of the fee route. The number is a step index, not a metric — the
 * content genuinely is a sequence (a fee moving from trade to recipient), which
 * is what earns the numbering.
 */
function Leg({
  step,
  heading,
  last = false,
  children,
}: {
  step: number;
  heading: string;
  /** The final leg draws no connector rail — there is nothing below to join. */
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="relative pl-7">
      {/* Connector rail — the route is a chain, so it reads as one. */}
      {!last && (
        <span
          aria-hidden
          className="absolute left-[9px] top-5 bottom-[-14px] w-px bg-violet/20"
        />
      )}
      <span
        aria-hidden
        className="absolute left-0 top-0.5 flex h-[19px] w-[19px] items-center justify-center rounded-full border border-violet/35 bg-panel-2 font-mono text-[10px] text-violet-soft"
      >
        {step}
      </span>
      <p className="text-sm text-ink">{heading}</p>
      <div className="mt-1 text-xs text-muted">{children}</div>
    </li>
  );
}

export function MimosTribute({
  route,
  total,
  className = "",
}: {
  route: CreatorFeeResult;
  /** Cumulative creator fees; null when pump.fun is unreachable and we have no cached figure. */
  total: CreatorFeeTotal | null;
  className?: string;
}) {
  const config = route.data;
  const recipients = config?.recipients ?? [];

  return (
    <CardFrame
      id="tribute"
      title="Mimo’s Tribute"
      subtitle="where creator fees actually go"
      source="on-chain · pump.fun fee-share program"
      className={className}
    >
      <p className="text-sm leading-relaxed text-ink">
        Every $WIZARD trade pays a creator fee. The tower can follow that fee to
        the door it goes through — but not to the hand that opens it.
      </p>

      <ol className="mt-4 space-y-3.5">
        <Leg step={1} heading="A fee is charged on every trade">
          Collected by pump.fun’s bonding curve before graduation, and by the
          PumpSwap pool since — both pay the coin’s registered creator account.
        </Leg>

        <Leg step={2} heading="It accrues to the coin’s creator account">
          {config ? (
            <>
              For $WIZARD that is <Solscan address={config.address} />, confirmed
              on-chain in the bonding curve and the PumpSwap pool alike.
            </>
          ) : (
            <>
              Set at launch and changeable by the creator; read live from the
              RugCheck report and verifiable on Solscan.
            </>
          )}
        </Leg>

        <Leg step={3} last heading="That account is a fee-share program, not a wallet">
          {config ? (
            <>
              It is owned by pump.fun’s fee-sharing program, and it splits every
              lamport between{" "}
              <span className="text-ink">{recipients.length} recipients</span> —
              so no single wallet receives the fees.
            </>
          ) : (
            <>
              The creator account could not be read just now, so the current split
              is not shown. Verify it directly on Solscan.
            </>
          )}
        </Leg>
      </ol>

      {config && recipients.length > 0 && (
        <div className="mt-4 rounded border border-violet/15 bg-panel-2/60 p-3">
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted">
            Current split — read from chain, not stored by us
          </p>
          <ul className="mt-2.5 space-y-2">
            {recipients.map((r) => (
              <li key={r.address} className="flex items-center gap-2.5">
                <Solscan address={r.address} label={FEE_RECIPIENT_LABELS[r.address]} />
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-violet/10">
                  <div
                    className="h-full rounded-full bg-violet/70"
                    style={{ width: `${Math.min(100, Math.max(1, r.pct))}%` }}
                  />
                </div>
                <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-ink">
                  {r.pct.toFixed(r.pct % 1 === 0 ? 0 : 1)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The total. The chain proves the money; the team named the wallets. */}
      {total && (
        <div className="mt-4 border-t border-violet/15 pt-3">
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted">
            Paid to creators since launch
          </p>
          <p className="mt-1 font-mono text-3xl font-semibold tabular-nums text-ink">
            {total.cumulativeSol.toLocaleString("en-US", { maximumFractionDigits: 0 })}{" "}
            <span className="text-lg text-muted">SOL</span>
          </p>
          <p className="wiz-caption mt-2">
            As pump.fun’s own ledger reports it
            {total.numTrades
              ? `, across ${total.numTrades.toLocaleString("en-US")} trades`
              : ""}
            . Independently reproducible: summing every outflow from the
            creator-vault account gave 843.97 SOL against their 845 on 26 Jul —
            the difference is fees not yet claimed out of the pool.
          </p>
        </div>
      )}

      <p className="mt-3 text-xs">
        <a
          href={LINKS.buy.pumpFun}
          target="_blank"
          rel="noopener noreferrer"
          className="text-violet-soft transition-colors hover:text-ink"
        >
          Creator rewards on pump.fun ↗
        </a>
        <span aria-hidden className="text-muted"> ◆ </span>
        <a
          href={
            config
              ? `https://solscan.io/account/${config.address}`
              : LINKS.explorers.solscan
          }
          target="_blank"
          rel="noopener noreferrer"
          className="text-violet-soft transition-colors hover:text-ink"
        >
          Creator account on Solscan ↗
        </a>
      </p>
    </CardFrame>
  );
}
