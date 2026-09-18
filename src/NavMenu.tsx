import { useEffect, useRef, type CSSProperties } from "react";
import { ArrowRight, BookOpen, Captions, LogOut, ScanText, Settings2, X } from "lucide-react";
import { goToChapter, storyChapters } from "./DiagramStory";

/** Chapters that the story tells better than a menu entry can. */
const SKIP = ["Structure", "Shared vocabulary"];

type Action = { label: string; hint: string; icon: typeof ScanText; run: () => void; current?: boolean };

/**
 * The whole site in one panel, opened from the header without leaving the page.
 * Chapters travel through the scroll story; the actions are the same ones the
 * header carries, with room to say what each one is for.
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

  if (!open) return null;

  /** Travels to a chapter of the story, going back to the landing page first. */
  function chapter(index: number) {
    const already = onHome();
    onClose();
    // A page change needs a frame before the story is in the document.
    if (already) goToChapter(index);
    else requestAnimationFrame(() => requestAnimationFrame(() => goToChapter(index)));
  }

  return (
    <div className="nav-menu" role="dialog" aria-modal="true" aria-label="Menu" ref={panel}>
      <div className="menu-head">
        <span className="menu-brand">
          <span className="brand-mark" aria-hidden="true">
            <BookOpen size={22} />
          </span>
          SahPaath<span className="brand-dot">.</span>
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
                    {/* The story's own number, so the chapter you land on is the one you picked. */}
                    <span className="menu-num">Chapter {String(index + 1).padStart(2, "0")}</span>
                    <span className="menu-title">{label}</span>
                  </button>
                </li>
              ))}
          </ol>
        </nav>

        <div className="menu-side">
          <p className="menu-kicker">{signOut ? "Your classroom" : "Use it now"}</p>
          {actions.map((action, i) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                aria-current={action.current ? "page" : undefined}
                className={`menu-action${!signOut && i === actions.length - 1 ? " is-primary" : ""}`}
                style={{ "--i": i } as CSSProperties}
                onClick={() => {
                  onClose();
                  action.run();
                }}
              >
                <Icon size={18} aria-hidden="true" />
                <span>
                  {action.label}
                  <small>{action.hint}</small>
                </span>
                <ArrowRight size={17} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </div>

      <div className="menu-foot">
        <span>
          <Captions size={14} aria-hidden="true" /> Runs on this computer. Nothing leaves the classroom.
        </span>
        <span className="menu-foot-links">
          <button
            className="menu-link"
            onClick={() => {
              onClose();
              settingsOpen();
            }}
          >
            <Settings2 size={15} aria-hidden="true" /> Accessibility settings
          </button>
          {signOut && (
            <button
              className="menu-link"
              onClick={() => {
                onClose();
                signOut();
              }}
            >
              <LogOut size={15} aria-hidden="true" /> Leave classroom
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
