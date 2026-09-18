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
 * The header follows the scroll the way the rest of the page does: flat and part of
 * the page at the top, a compact floating bar once you are into the page, and out of
 * the way entirely while you scroll down through the animated sections. Scrolling
 * back up brings it straight back, and so does moving focus into it with a keyboard.
 */
export function useStickyHeader(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!enabled) {
      el.classList.remove("is-floating", "is-hidden");
      return;
    }
    let previous = scrollY;
    let queued = false;
    const read = () => {
      queued = false;
      const y = scrollY;
      const down = y > previous + 4;
      const up = y < previous - 4;
      if (down || up) previous = y;
      el.classList.toggle("is-floating", y > 40);
      // Never hide it over the first screen, and never while it holds focus.
      if (down && y > 260 && !el.contains(document.activeElement)) el.classList.add("is-hidden");
      else if (up || y <= 260) el.classList.remove("is-hidden");
    };
    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(read);
    };
    const onFocus = () => el.classList.remove("is-hidden");
    read();
    addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("focusin", onFocus);
    return () => {
      removeEventListener("scroll", onScroll);
      el.removeEventListener("focusin", onFocus);
      el.classList.remove("is-floating", "is-hidden");
    };
  }, [ref, enabled]);
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
      el?.style.setProperty("--progress", "1");
      setState({ progress: 1, step: steps - 1, pinned: false });
      return;
    }
    let pinned = false;
    let tallest = 0;
    let fit = 1;
    let queued = false;
    let last = "";
    // The scroll value is written on the one element that reads it where there is
    // one: setting a custom property on the whole section re-styles everything in
    // it on every frame.
    const painted = el.querySelector<HTMLElement>("[data-progress]") ?? el;

    /**
     * A pinned section locks in place and then moves through its steps, so on a
     * desktop it always pins; content taller than the window is scaled down to fit
     * rather than left to overflow. The decision uses the tallest content seen at
     * this window size and is never reversed except by a resize: pinning changes the
     * page height, so a decision that reacted to the current step made the page jump.
     */
    const decide = () => {
      if (!pin) return;
      const inner = el.firstElementChild as HTMLElement | null;
      if (inner && inner.children.length) {
        const boxes = [...inner.children].map((c) => c.getBoundingClientRect());
        // Undo the scale already applied, so this is the natural height.
        const measured = (Math.max(...boxes.map((r) => r.bottom)) - Math.min(...boxes.map((r) => r.top))) / fit;
        tallest = Math.max(tallest, measured);
      }
      // Below this the text would be too small to read; such a window scrolls normally.
      // The reserved space covers the floating header and a margin under the content.
      const wanted = Math.min(1, (innerHeight - 150) / Math.max(1, tallest));
      const next = innerWidth > 900 && wanted >= 0.72;
      if (next !== pinned || (next && Math.abs(wanted - fit) > 0.005)) {
        pinned = next;
        fit = next ? wanted : 1;
        el.style.setProperty("--fit", fit.toFixed(3));
        read();
      }
    };
    const read = () => {
      queued = false;
      const rect = el.getBoundingClientRect();
      const raw = pinned
        ? -rect.top / Math.max(1, rect.height - innerHeight)
        : (innerHeight * 0.85 - rect.top) / Math.max(1, rect.height * 0.9);
      // A little dwell at both ends, so the first and last steps are readable.
      const progress = Math.min(1, Math.max(0, (raw - 0.04) / 0.9));
      // The smooth part of the motion is a custom property the CSS reads, so
      // following the scroll costs no React render.
      painted.style.setProperty("--progress", progress.toFixed(4));
      const step = Math.min(steps - 1, Math.floor(progress * steps));
      // Half-step granularity: enough for the wordmark and the dots, few enough
      // renders that a heavy section still scrolls at frame rate.
      const q = Math.round(progress * steps * 2) / (steps * 2);
      const key = `${q}|${step}|${pinned}`;
      if (key !== last) {
        last = key;
        setState({ progress: q, step, pinned });
      }
    };
    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(read);
    };
    const onResize = () => {
      tallest = 0;
      decide();
      onScroll();
    };
    // Late web fonts and taller steps change the content height; re-measuring keeps
    // the decision honest, and the running maximum keeps it from oscillating.
    const ro = new ResizeObserver(() => decide());
    if (pin && el.firstElementChild) ro.observe(el.firstElementChild);
    decide();
    read();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onResize);
    return () => {
      ro.disconnect();
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onResize);
      painted.style.removeProperty("--progress");
      el.style.removeProperty("--fit");
    };
  }, [ref, steps, enabled, pin]);
  return state;
}
