"use client";

/**
 * cmd+K command palette (IMPLEMENTATION_PLAN.md §4 "Cross-cutting", §7).
 *
 * Actions: copy CA · open Solscan / DexScreener / GeckoTerminal / RugCheck /
 * pump.fun / Bubblemaps · jump to any module (anchor ids live on every card) ·
 * toggle the film-grain overlay.
 *
 * Dependency-light on purpose (no `cmdk`): the needs here — a filtered list, arrow
 * navigation, a focus trap, and focus restore — are ~an accessible combobox, which
 * is a well-trodden ARIA pattern in a couple hundred lines. Pulling a library for
 * it would add a dependency the plan explicitly asks us to avoid.
 *
 * A11y: role="dialog" + aria-modal with an accessible name; the input is a
 * combobox driving a listbox via aria-activedescendant (focus stays on the input,
 * arrows move the active option); Escape closes; focus is trapped while open and
 * restored to the trigger on close; an aria-live region announces each action.
 *
 * Opened by cmd/ctrl+K anywhere, or by the header "⌘K" affordance which dispatches
 * the `wizard:open-command` event this component listens for.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LINKS, TOKEN } from "@/config/token";

export const OPEN_COMMAND_EVENT = "wizard:open-command";
const GRAIN_KEY = "wizard:grain";

type RunResult = string | void;
type CommandGroup = "Actions" | "Open" | "Jump to";

type Command = {
  id: string;
  label: string;
  group: CommandGroup;
  /** Right-aligned affordance hint, e.g. "copy", "open ↗", "jump". */
  hint: string;
  keywords?: string;
  /** Returns an optional announcement string; the palette closes after. */
  run: () => RunResult;
  /** Keep the palette open after running (grain toggle re-labels live). */
  keepOpen?: boolean;
};

/** Every module's anchor id (present on each CardFrame) → its palette label. */
const MODULES: ReadonlyArray<readonly [string, string]> = [
  ["ledger", "The Wizard’s Ledger"],
  ["chart", "The Scrying Glass"],
  ["holders", "Council of Holders"],
  ["pools", "The Cauldrons"],
  ["tape", "The Ledger of Deeds"],
  ["flow", "Flow of Mana"],
  ["safety", "Wards & Protections"],
  ["feed", "The Prophecy Feed"],
  ["origin", "The Origin Scroll"],
  ["tribute", "Mimo’s Tribute"],
  ["verdict", "The Wizard’s Verdict"],
  ["top", "Back to top"],
];

const EXPLORERS: ReadonlyArray<readonly [string, string]> = [
  ["Solscan", LINKS.explorers.solscan],
  ["DexScreener", LINKS.explorers.dexscreener],
  ["GeckoTerminal", LINKS.explorers.geckoterminal],
  ["RugCheck", LINKS.explorers.rugcheck],
  ["pump.fun", LINKS.buy.pumpFun],
  ["Bubblemaps", LINKS.explorers.bubblemaps],
];

function jumpTo(id: string): RunResult {
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    history.replaceState(null, "", `#${id}`);
  }
  return undefined;
}

function openExternal(href: string): RunResult {
  window.open(href, "_blank", "noopener,noreferrer");
  return undefined;
}

async function copyCa(): Promise<string> {
  try {
    await navigator.clipboard.writeText(TOKEN.mint);
    return "Contract address copied.";
  } catch {
    return "Clipboard unavailable — copy the CA chip in the header instead.";
  }
}

/** Read/apply the persisted grain preference; returns whether grain is on. */
function grainIsOn(): boolean {
  return document.documentElement.dataset.grain !== "off";
}
function applyGrain(on: boolean) {
  if (on) {
    delete document.documentElement.dataset.grain;
    try {
      localStorage.setItem(GRAIN_KEY, "on");
    } catch {}
  } else {
    document.documentElement.dataset.grain = "off";
    try {
      localStorage.setItem(GRAIN_KEY, "off");
    } catch {}
  }
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [announce, setAnnounce] = useState("");
  // Lazy-init from the persisted preference (SSR-safe: no DOM access on the server,
  // and this component renders nothing until opened, so no hydration mismatch).
  const [grainOn, setGrainOn] = useState<boolean>(() => {
    if (typeof document === "undefined") return true;
    try {
      return localStorage.getItem(GRAIN_KEY) !== "off";
    } catch {
      return true;
    }
  });

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const openRef = useRef(false);
  const announceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Sync the persisted grain preference to the DOM once on mount — an external
  // system update (no React state change → no cascading render).
  useEffect(() => {
    applyGrain(grainOn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closePalette = useCallback(() => {
    openRef.current = false;
    setOpen(false);
    setQuery("");
    setActive(0);
    restoreFocusRef.current?.focus?.();
  }, []);

  const openPalette = useCallback(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    openRef.current = true;
    setGrainOn(grainIsOn());
    setOpen(true);
    setQuery("");
    setActive(0);
  }, []);

  // Global open shortcut (cmd/ctrl+K) + the header affordance event.
  //
  // Escape is handled HERE, on the window, not only on the input. The input's own
  // handler covers the common case, but focus does not always live there: clicking
  // the backdrop (or anything else outside the field) moves it to <body>, and from
  // then on a key pressed anywhere never reaches the input — the palette looked
  // stuck open. Listening on the window makes Escape work regardless of focus.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        if (!openRef.current) openPalette(); // already open → the dialog owns its keys
        return;
      }
      if (e.key === "Escape" && openRef.current) {
        e.preventDefault();
        closePalette();
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_COMMAND_EVENT, openPalette);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_COMMAND_EVENT, openPalette);
    };
  }, [openPalette, closePalette]);

  // Focus the input when opened; lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  useEffect(() => () => clearTimeout(announceTimer.current), []);

  const say = useCallback((msg: string) => {
    if (!msg) return;
    setAnnounce(msg);
    clearTimeout(announceTimer.current);
    announceTimer.current = setTimeout(() => setAnnounce(""), 2500);
  }, []);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      {
        id: "copy-ca",
        label: "Copy contract address",
        group: "Actions",
        hint: "copy",
        keywords: "ca mint address clipboard",
        run: () => copyCa() as unknown as RunResult, // async; announcement handled in run()
      },
      {
        id: "toggle-grain",
        label: grainOn ? "Turn film grain off" : "Turn film grain on",
        group: "Actions",
        hint: grainOn ? "on" : "off",
        keywords: "grain texture film noise overlay",
        keepOpen: true,
        run: () => {
          const next = !grainIsOn();
          applyGrain(next);
          setGrainOn(next);
          return next ? "Film grain on." : "Film grain off.";
        },
      },
      ...EXPLORERS.map(
        ([name, href]): Command => ({
          id: `open-${name}`,
          label: `Open ${name}`,
          group: "Open",
          hint: "open ↗",
          keywords: `${name} explorer link external ${name.toLowerCase()}`,
          run: () => openExternal(href),
        }),
      ),
      ...MODULES.map(
        ([id, name]): Command => ({
          id: `jump-${id}`,
          label: name,
          group: "Jump to",
          hint: "jump",
          keywords: `${name} ${id} module card section`,
          run: () => jumpTo(id),
        }),
      ),
    ];
    return list;
  }, [grainOn]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.group.toLowerCase().includes(q) ||
        (c.keywords ?? "").toLowerCase().includes(q),
    );
  }, [commands, query]);

  // Clamp the active index to the current results at render time (no effect, no
  // cascading re-render as the filter narrows).
  const activeIndex = filtered.length === 0 ? -1 : Math.min(active, filtered.length - 1);

  const runCommand = useCallback(
    async (cmd: Command | undefined) => {
      if (!cmd) return;
      // The copy command is async and returns its own announcement.
      if (cmd.id === "copy-ca") {
        const msg = await copyCa();
        say(msg);
        closePalette();
        return;
      }
      const msg = cmd.run();
      if (typeof msg === "string") say(msg);
      if (!cmd.keepOpen) closePalette();
    },
    [say, closePalette],
  );

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(filtered.length ? (activeIndex + 1) % filtered.length : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(filtered.length ? (activeIndex - 1 + filtered.length) % filtered.length : 0);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(Math.max(0, filtered.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0) void runCommand(filtered[activeIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closePalette();
    } else if (e.key === "Tab") {
      // Only the input is focusable inside the dialog — trap focus on it.
      e.preventDefault();
    }
  }

  // Scroll the active option into view (external DOM read/scroll — no setState).
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  if (!open) return null;

  // Group the filtered list while keeping a flat index for aria-activedescendant.
  let flatIndex = -1;
  const groups: CommandGroup[] = ["Actions", "Open", "Jump to"];

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center px-4 pt-[12vh]"
      role="presentation"
      onMouseDown={(e) => {
        // Covers the padding strip around the dialog; the backdrop below covers
        // the rest. Both close — clicking anywhere off the dialog dismisses it.
        if (e.target === e.currentTarget) closePalette();
      }}
    >
      <div
        aria-hidden
        className="absolute inset-0 bg-canvas/80 backdrop-blur-sm"
        onMouseDown={closePalette}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="wiz-card relative z-10 w-full max-w-lg overflow-hidden p-0"
      >
        <div className="flex items-center gap-2 border-b border-violet/20 px-3">
          <span aria-hidden className="text-violet-soft">
            ✦
          </span>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="wiz-cmd-list"
            aria-activedescendant={filtered[activeIndex] ? `wiz-cmd-${filtered[activeIndex].id}` : undefined}
            aria-label="Search commands"
            autoComplete="off"
            spellCheck={false}
            placeholder="Search — copy CA, open a source, jump to a module…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKeyDown}
            className="w-full bg-transparent py-3 text-sm text-ink placeholder:text-muted focus:outline-none"
          />
          <kbd className="hidden shrink-0 rounded border border-violet/25 px-1.5 py-0.5 font-mono text-[10px] text-muted sm:inline">
            esc
          </kbd>
        </div>

        <ul
          ref={listRef}
          id="wiz-cmd-list"
          role="listbox"
          aria-label="Commands"
          className="max-h-[52vh] overflow-y-auto py-1.5"
        >
          {filtered.length === 0 && (
            <li role="option" aria-selected="false" className="px-3 py-6 text-center">
              <span className="wiz-caption">No spell by that name — try another word.</span>
            </li>
          )}
          {groups.map((group) => {
            const items = filtered.filter((c) => c.group === group);
            if (items.length === 0) return null;
            return (
              <li key={group} role="presentation">
                <div
                  aria-hidden
                  className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-[0.16em] text-muted"
                >
                  {group}
                </div>
                <ul role="presentation">
                  {items.map((cmd) => {
                    flatIndex += 1;
                    const idx = flatIndex;
                    const isActive = idx === activeIndex;
                    return (
                      <li
                        key={cmd.id}
                        id={`wiz-cmd-${cmd.id}`}
                        role="option"
                        aria-selected={isActive}
                        data-index={idx}
                        onMouseMove={() => setActive(idx)}
                        onMouseDown={(e) => {
                          e.preventDefault(); // keep focus on the input
                          void runCommand(cmd);
                        }}
                        className={`mx-1.5 flex cursor-pointer items-center justify-between gap-3 rounded px-2.5 py-2 text-sm ${
                          isActive ? "bg-violet/20 text-ink" : "text-ink/90"
                        }`}
                      >
                        <span className="truncate">{cmd.label}</span>
                        <span
                          className={`shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] ${
                            isActive ? "text-violet-soft" : "text-muted"
                          }`}
                        >
                          {cmd.hint}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-between border-t border-violet/20 px-3 py-2 text-[10px] text-muted">
          <span className="font-mono">
            {TOKEN.symbol} · ↑↓ navigate · ↵ run · esc close
          </span>
          <span aria-hidden>✳</span>
        </div>
      </div>

      <div aria-live="polite" role="status" className="sr-only">
        {announce}
      </div>
    </div>
  );
}
