import { Fragment, useEffect, useState, type CSSProperties } from "react";
import "./motion.css";

/**
 * Turns scroll motion on for the whole app unless the visitor asked for calm motion
 * (in settings or through the OS reduced-motion setting). Motion CSS is scoped to
 * `:root.motion-on`, so with it off every element renders in its final, static state.
 */
export function useMotion(calm: boolean) {
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  const on = !calm && !reduced;

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
