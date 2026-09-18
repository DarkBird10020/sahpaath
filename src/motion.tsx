import { Fragment, useEffect, useState, type CSSProperties, type RefObject } from "react";
import "./motion.css";

/**
 * Turns scroll motion on for the whole app unless the visitor chose calm motion in
 * the accessibility settings. Motion CSS is scoped to `:root.motion-on`, so with it
 * off every element renders in its final, static state.
 */
export function useMotion(calm: boolean) {
  // Motion is on by default, even when the operating system asks for reduced
  // motion (many machines have Windows animations off by default). The visitor
  // turns it off here with the "Calm motion" setting instead.
  const on = !calm;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("motion-on", on);
    // Browsers without scroll-driven animations get the same reveals, played once on entry.
    const scrollDriven = CSS.supports("animation-timeline: view()");
    root.classList.toggle("motion-fallback", on && !scrollDriven);
    if (!on || scrollDriven) return;
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        }),
      { rootMargin: "0px 0px -8% 0px" },
    );
    const watch = () =>
      document.querySelectorAll("[data-reveal]:not(.is-in), .words:not(.words-time):not(.is-in)").forEach((el) => io.observe(el));
    watch();
    const mo = new MutationObserver(watch);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, [on]);
  return on;
}

/**
 * Splits text into words that each animate on their own. Assistive technology reads the
 * plain sentence from the visually hidden copy; the animated words are aria-hidden.
 * `timed` plays on mount (for pinned content), otherwise the words follow the scroll.
 * Lines are separated with "\n".
 */
export function Words({ text, timed = false, delay = 0 }: { text: string; timed?: boolean; delay?: number }) {
  let index = 0;
  return (
    <>
      <span className="sr-only">{text.replace(/\n/g, " ")}</span>
      <span className={`words${timed ? " words-time" : ""}`} aria-hidden="true">
        {text.split("\n").map((line, li) => (
          <Fragment key={li}>
            {li > 0 && <br />}
            {line.split(" ").map((word, wi) => {
              const i = index++;
              return (
                <Fragment key={wi}>
                  {wi > 0 && " "}
                  <span className="w" style={{ "--i": i + delay } as CSSProperties}>
                    <span className="w-in">{word}</span>
                  </span>
                </Fragment>
              );
            })}
          </Fragment>
        ))}
      </span>
    </>
  );
}

/**
 * Scroll progress (0..1) through a section and the step it points at.
 * With `pin`, the section is tall and its content is sticky, so scrolling
 * moves through the steps while the content stays on screen. Pinning is only
 * used on screens tall and wide enough for the content; otherwise progress
 * follows the section as it passes through the viewport.
 */
export function useScrollSteps(ref: RefObject<HTMLElement | null>, steps: number, enabled: boolean, pin = true) {
  const [state, setState] = useState({ progress: enabled ? 0 : 1, step: enabled ? 0 : steps - 1, pinned: false });
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) {
      setState({ progress: 1, step: steps - 1, pinned: false });
      return;
    }
    let frame = 0;
    let last = "";
    const tick = () => {
      // Pin only when the content fits on screen; otherwise its bottom would be hidden.
      // Measured from the content itself, so pinned padding and min-height do not matter.
      const inner = el.firstElementChild as HTMLElement | null;
      let contentHeight = 0;
      if (inner && inner.children.length) {
        const boxes = [...inner.children].map((c) => c.getBoundingClientRect());
        contentHeight = Math.max(...boxes.map((r) => r.bottom)) - Math.min(...boxes.map((r) => r.top));
      }
      const pinned = pin && innerWidth > 900 && contentHeight + 100 <= innerHeight;
      const rect = el.getBoundingClientRect();
      const raw = pinned
        ? -rect.top / Math.max(1, rect.height - innerHeight)
        : (innerHeight * 0.85 - rect.top) / Math.max(1, rect.height * 0.9);
      // A little dwell at both ends, so the first and last steps are readable.
      const progress = Math.min(1, Math.max(0, (raw - 0.04) / 0.9));
      const q = Math.round(progress * 200) / 200;
      const step = Math.min(steps - 1, Math.floor(q * steps));
      const key = `${q}|${pinned}`;
      if (key !== last) {
        last = key;
        setState({ progress: q, step, pinned });
      }
      frame = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(([entry]) => {
      cancelAnimationFrame(frame);
      if (entry.isIntersecting) frame = requestAnimationFrame(tick);
    });
    io.observe(el);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      io.disconnect();
    };
  }, [ref, steps, enabled, pin]);
  return state;
}
