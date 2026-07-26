/**
 * The VHS overlay's on/off state, shared by every control that can flip it.
 *
 * Two controls exist — the header toggle and the cmd+K palette — and they must
 * never disagree, so neither owns the state: the DOM does. `data-grain="off"`
 * on <html> is the single source of truth (it is also what the CSS reads, see
 * `.wiz-grain` in globals.css), localStorage only persists the choice across
 * visits, and a DOM event lets a control that did not make the change hear
 * about it.
 *
 * Reading from the DOM rather than React state is deliberate: the attribute is
 * applied before hydration by the inline script in layout.tsx, so there is no
 * flash of the wrong state on load, and nothing to keep in sync afterwards.
 */

export const VHS_STORAGE_KEY = "wizard:grain";
export const VHS_CHANGE_EVENT = "wizard:vhs-change";

/** Default is on; only an explicit "off" turns it off. */
export function vhsIsOn(): boolean {
  if (typeof document === "undefined") return true;
  return document.documentElement.dataset.grain !== "off";
}

/** The persisted preference, for the pre-hydration script and first render. */
export function vhsStoredPreference(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(VHS_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

/**
 * Apply and persist. Notifies other controls via a DOM event — this is an
 * external system update, not React state, so a control that did not make the
 * change still re-renders with the right label.
 */
export function setVhs(on: boolean): void {
  if (typeof document === "undefined") return;
  if (on) delete document.documentElement.dataset.grain;
  else document.documentElement.dataset.grain = "off";
  try {
    localStorage.setItem(VHS_STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Private mode or blocked storage — the toggle still works for this visit.
  }
  window.dispatchEvent(new CustomEvent(VHS_CHANGE_EVENT, { detail: { on } }));
}

/** Subscribe to changes made by any control. Returns an unsubscribe function. */
export function onVhsChange(listener: () => void): () => void {
  window.addEventListener(VHS_CHANGE_EVENT, listener);
  return () => window.removeEventListener(VHS_CHANGE_EVENT, listener);
}
