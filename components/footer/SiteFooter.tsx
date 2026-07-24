import { LINKS } from "@/config/token";

const SOURCES = ["DexScreener", "GeckoTerminal", "Helius", "RugCheck", "X"] as const;

export function SiteFooter() {
  return (
    <footer className="mt-10 border-t border-violet/25">
      <div className="mx-auto w-full max-w-7xl px-4 py-8 text-center md:px-6">
        <div className="wiz-rule mx-auto max-w-xs text-[10px]">
          <span aria-hidden>✳</span>
        </div>
        <p className="mt-5 text-xs text-muted">
          Data:{" "}
          {SOURCES.map((source, i) => (
            <span key={source}>
              {i > 0 && <span aria-hidden> ◆ </span>}
              {source}
            </span>
          ))}
        </p>
        <p className="mt-3 text-xs text-muted">
          community-built · unofficial · informational only · not financial advice ·
          DYOR
        </p>
        {/* The source is public: every figure on this page can be traced to the
            code that computed it. That auditability is the point of the link. */}
        <p className="mt-3 text-xs">
          <a
            href={LINKS.github}
            target="_blank"
            rel="noopener noreferrer"
            className="text-violet-soft underline decoration-violet/40 underline-offset-2 transition-colors hover:text-ink"
          >
            Source on GitHub
          </a>
        </p>
      </div>
    </footer>
  );
}
