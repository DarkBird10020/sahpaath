import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { BookOpen, ScanText, X } from "lucide-react";
import { goToChapter, storyChapters } from "./DiagramStory";

/** Chapters that the story tells better than a menu entry can. */
const SKIP = ["Structure", "Shared vocabulary"];

type Action = { label: string; hint: string; icon: typeof ScanText; run: () => void; current?: boolean };
type Leaving = null | "fade" | "wipe";
type Tone = { rgb: string; dark: boolean };

/**
 * The colour of the page behind the menu. The menu has no colour of its own: like
 * cornrevolution.resn.global, whose menu is the current chapter's scene blurred
 * until only its colours are left, this one takes the section it opens over.
 * Nine points are averaged, which is what a very wide blur would leave anyway.
 */
function toneBehind(menu: HTMLElement | null): Tone {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (const fx of [0.2, 0.5, 0.8])
    for (const fy of [0.25, 0.5, 0.75]) {
      for (const el of document.elementsFromPoint(innerWidth * fx, innerHeight * fy)) {
        if (menu?.contains(el)) continue;
        let node: Element | null = el;
        let found: number[] | null = null;
        while (node && !found) {
          const m = getComputedStyle(node).backgroundColor.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/);
          if (m && (m[4] === undefined || Number(m[4]) > 0.5)) found = [+m[1], +m[2], +m[3]];
          node = node.parentElement;
        }
        if (found) {
          r += found[0];
          g += found[1];
          b += found[2];
          n++;
        }
        break;
      }
    }
  const [cr, cg, cb] = n ? [r / n, g / n, b / n] : [243, 238, 229];
  const lin = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(cr) + 0.7152 * lin(cg) + 0.0722 * lin(cb);
  return { rgb: `${Math.round(cr)} ${Math.round(cg)} ${Math.round(cb)}`, dark: luminance < 0.3 };
}

/**
 * The whole site in one panel, opened from the header without leaving the page.
 * Built after the cornrevolution.resn.global menu, studied in the live site:
 * the page behind blurs until only its colour remains, the menu is words on that
 * colour, and choosing a place sets it up behind the menu and wipes the menu away
 * diagonally to reveal it.
 */
export default function NavMenu({
  open,
  onClose,
  onHome,
  actions,
  settingsOpen,
  signOut,
}: {
  open: boolean;
  onClose: () => void;
  onHome: () => boolean;
  actions: Action[];
  settingsOpen: () => void;
  signOut?: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  // How the next close looks: a plain close fades the blur back out; choosing a
  // destination wipes the menu away over the place it set up.
  const exit = useRef<Exclude<Leaving, null>>("fade");
  const [shown, setShown] = useState(open);
  const [leaving, setLeaving] = useState<Leaving>(null);
  const [tone, setTone] = useState<Tone>({ rgb: "10 19 34", dark: true });

  // Read the colour before the first paint of an opening, so it never flashes.
  useLayoutEffect(() => {
    if (open) setTone(toneBehind(panel.current));
  }, [open]);

  useEffect(() => {
    if (open) {
      setShown(true);
      setLeaving(null);
      exit.current = "fade";
      return;
    }
    if (!shown) return;
    if (!document.documentElement.classList.contains("motion-on")) {
      setShown(false);
      return;
    }
    const mode = exit.current;
    setLeaving(mode);
    // Stays on screen while it animates away; inert meanwhile.
    const timer = setTimeout(() => {
      setShown(false);
      setLeaving(null);
    }, mode === "wipe" ? 1000 : 700);
    return () => clearTimeout(timer);
  }, [open, shown]);

  useEffect(() => {
    if (!open) return;
    const returnTo = document.activeElement as HTMLElement | null;
    close.current?.focus();
    // The page behind must not scroll while the menu covers it.
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      // Focus stays inside the menu while it is open.
      const stops = [...panel.current.querySelectorAll<HTMLElement>("button, a[href]")].filter((el) => el.offsetParent);
      if (!stops.length) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = previous;
      returnTo?.focus?.();
    };
  }, [open, onClose]);

  // `open` alone must render it: waiting a render for `shown` left nothing on the
  // page when the focus effect ran, and keyboard focus never reached the menu.
  if (!open && !shown) return null;

  /** Sets the chapter up behind the menu, then wipes the menu away to reveal it. */
  function chapter(index: number) {
    exit.current = "wipe";
    const already = onHome();
    onClose();
    // A page change needs a frame before the story is in the document.
    if (already) goToChapter(index, true);
    else requestAnimationFrame(() => requestAnimationFrame(() => goToChapter(index, true)));
  }
  function go(run: () => void) {
    exit.current = "wipe";
    onClose();
    run();
  }

  // The last action is the one to take next (sign in, or your account) and reads
  // as a link under the buttons; more than four buttons share two columns so the
  // menu fits one screen, signed in or not.
  const buttons = actions.length > 1 ? actions.slice(0, -1) : actions;
  const link = actions.length > 1 ? actions[actions.length - 1] : null;
  const cols = buttons.length > 4 ? 2 : 1;

  return (
    <div
      className={`nav-menu${leaving ? ` is-leaving is-${leaving}` : ""}`}
      data-tone={tone.dark ? "dark" : "light"}
      style={{ "--ground": tone.rgb, "--cols": cols } as CSSProperties}
      role="dialog"
      aria-modal="true"
      aria-label="Menu"
      aria-hidden={leaving ? true : undefined}
      inert={leaving ? true : undefined}
      ref={panel}
    >
      <div className="menu-head">
        <span className="menu-brand">
          <span className="brand-mark" aria-hidden="true">
            <BookOpen size={22} />
          </span>
          {/* One piece, so the gap between mark and name does not split off the dot. */}
          <span>
            SahPaath<span className="brand-dot">.</span>
          </span>
        </span>
        <button className="menu-close" onClick={onClose} ref={close} aria-label="Close menu">
          <X size={22} aria-hidden="true" />
        </button>
      </div>

      <div className="menu-body">
        <nav className="menu-chapters" aria-labelledby="menu-story">
          <p className="menu-kicker" id="menu-story">
            Walk through the story
          </p>
          <ol>
            {storyChapters
              .map((label, index) => ({ label, index }))
              .filter(({ label }) => !SKIP.includes(label))
              .map(({ label, index }, i) => (
                <li key={label} style={{ "--i": i } as CSSProperties}>
                  <button onClick={() => chapter(index)}>
                    {/* Counted within this list, 01 to 05. The story's own numbers skip
                        the chapters left out here, and a list reading 01, 03, 04 looks
                        broken; the button still travels to the right chapter by index. */}
                    <span className="menu-num">Chapter {String(i + 1).padStart(2, "0")}</span>
                    <span className="menu-title">{label}</span>
                  </button>
                </li>
              ))}
          </ol>
        </nav>

        <div className="menu-side">
          <p className="menu-kicker">{signOut ? "Your classroom" : "Use it now"}</p>
          <div className="menu-actions">
            {buttons.map((action, i) => (
              <button
                key={action.label}
                aria-current={action.current ? "page" : undefined}
                aria-describedby={`menu-hint-${i}`}
                className="menu-action"
                style={{ "--i": i } as CSSProperties}
                onClick={() => go(action.run)}
              >
                {action.label}
                {/* What it is for, read out with the button; the reference shows labels only. */}
                <span id={`menu-hint-${i}`} hidden>
                  {action.hint}
                </span>
              </button>
            ))}
          </div>
          {link && (
            <button
              className="menu-cta"
              aria-current={link.current ? "page" : undefined}
              aria-describedby="menu-hint-cta"
              style={{ "--i": buttons.length } as CSSProperties}
              onClick={() => go(link.run)}
            >
              {link.label}
              <span id="menu-hint-cta" hidden>
                {link.hint}
              </span>
            </button>
          )}
        </div>
      </div>

      <div className="menu-foot">
        <span>Runs on this computer. Nothing leaves the classroom.</span>
        <span className="menu-foot-links">
          <button
            className="menu-link"
            onClick={() => {
              onClose();
              settingsOpen();
            }}
          >
            Accessibility settings
          </button>
          {signOut && (
            <button className="menu-link" onClick={() => go(signOut)}>
              Leave classroom
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
