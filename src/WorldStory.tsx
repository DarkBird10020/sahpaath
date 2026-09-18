import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUpRight, BookOpen, Check, MessageCircle, Network, TextCursorInput, Waves } from "lucide-react";
import "./world-story.css";

const scenes = [
  { id: "lesson", label: "One lesson", title: "It starts with something worth sharing.", body: "A diagram. A concept. A lesson the whole class deserves to be part of.", detail: "One source, kept alongside its structured description.", icon: BookOpen },
  { id: "review", label: "Teacher review", title: "Trust is a human decision.", body: "Proposed parts and connections are checked by code, then reviewed by a teacher before students see them.", detail: "Propose → validate → review → publish", icon: Check },
  { id: "explore", label: "See & explore", title: "Find your own way through an idea.", body: "Move from part to part with the keyboard. Read what each part does, hear its description, and follow its connections.", detail: "A structured map, with a conventional text alternative.", icon: Network },
  { id: "captions", label: "Hear & read", title: "Keep the words. Keep the meaning.", body: "Approved vocabulary connects classroom transcripts to definitions and the same concepts in the explorer.", detail: "Local version: imported transcripts and teacher notes. Live recognition comes later.", icon: Waves },
  { id: "communicate", label: "Ask & connect", title: "A question belongs in the lesson.", body: "Ask for a repeat, more time, or help with this exact concept. A short phrase carries the context with it.", detail: "One or two interactions to reach the teacher inbox.", icon: MessageCircle },
  { id: "together", label: "Shared vocabulary", title: "Different ways in. One shared understanding.", body: "A term approved once becomes the common thread through exploration, reading, listening, and asking.", detail: "Same lesson. Your way in.", icon: TextCursorInput },
];
const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** React adaptation of the user-supplied scroll-world workflow: real video time
 * follows scroll; all meaning stays in ordinary DOM sections. No WebGL required. */
export default function WorldStory() {
  const root = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const target = useRef(0);
  const [active, setActive] = useState(0);
  const [staticView, setStaticView] = useState(false);
  const [canAnimate, setCanAnimate] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [near, setNear] = useState(false);
  const animate = canAnimate && !staticView;

  useEffect(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const desktop = matchMedia("(min-width: 1000px) and (pointer: fine)");
    const update = () => setCanAnimate(!motion.matches && desktop.matches);
    update();
    motion.addEventListener("change", update);
    desktop.addEventListener("change", update);
    return () => { motion.removeEventListener("change", update); desktop.removeEventListener("change", update); };
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { rootMargin: "500px" });
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!animate) return;
    let frame = 0;
    const read = () => {
      const element = track.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const segmentHeight = (rect.height - innerHeight * .78) / scenes.length;
      const position = Math.max(0, -rect.top + 104) / Math.max(1, segmentHeight);
      const index = Math.min(scenes.length - 1, Math.floor(position));
      setActive(index);
      target.current = clamp(position - index);
      frame = 0;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(read); };
    read();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); };
  }, [animate]);

  useEffect(() => {
    setReady(false);
    setError(false);
    if (!animate || !near) return;
    const controller = new AbortController();
    const element = video.current;
    let objectUrl = "";
    let frame = 0;
    const seek = () => {
      if (element && Number.isFinite(element.duration) && !element.seeking) {
        const time = target.current * Math.max(0, element.duration - 1 / 24);
        if (Math.abs(element.currentTime - time) > .035) element.currentTime = time;
      }
      frame = requestAnimationFrame(seek);
    };
    // A Blob provides seekable playback even on hosts without range responses.
    void fetch(`/assets/world/leg-${active}.mp4`, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error("Video unavailable"); return response.blob(); })
      .then(blob => {
        if (controller.signal.aborted || !element) return;
        objectUrl = URL.createObjectURL(blob);
        element.src = objectUrl;
        element.load();
        frame = requestAnimationFrame(seek);
      }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => {
      controller.abort(); cancelAnimationFrame(frame);
      if (element) { element.pause(); element.removeAttribute("src"); element.load(); }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [active, animate, near, retry]);

  return <section ref={root} id="lesson-world" className={`world-story ${animate ? "world-animated" : "world-static"}`} aria-labelledby="world-title">
    <div className="world-heading">
      <div><span className="section-kicker">A small world. A shared lesson.</span><h2 id="world-title">Come inside the lesson.</h2></div>
      <div className="world-controls">
        {canAnimate && <label><input type="checkbox" checked={staticView} onChange={e => setStaticView(e.target.checked)} /> Use still images</label>}
        <a href="#how-it-works">Skip the story <ArrowDown size={17} aria-hidden="true" /></a>
      </div>
    </div>
    <nav className="world-nav" aria-label="Lesson story chapters">{scenes.map((scene, i) => <a key={scene.id} href={`#world-${scene.id}`} aria-current={animate && active === i ? "step" : undefined}><span aria-hidden="true">0{i + 1}</span>{scene.label}</a>)}</nav>
    <div className="world-track" ref={track}>
      {animate && <div className="world-stage" aria-hidden="true">
        <img src={`/assets/world/poster-${active}.webp`} alt="" />
        <video ref={video} muted playsInline preload="none" disablePictureInPicture tabIndex={-1} className={ready && !error ? "painted" : ""} onLoadedData={() => setReady(true)} onError={() => { setError(true); setReady(false); }} />
        <div className="world-scene-number">0{active + 1}<span>/ 06</span></div>
      </div>}
      <div className="world-chapters">{scenes.map((scene, i) => <article id={`world-${scene.id}`} key={scene.id} className="world-chapter">
        {!animate && <img className="world-still" src={`/assets/world/poster-${i}.webp`} alt="" loading="lazy" width={1280} height={720} />}
        <div className="world-copy"><span className="world-eyebrow"><scene.icon size={18} aria-hidden="true" /> {scene.label}</span><h3>{scene.title}</h3><p>{scene.body}</p><div className="world-detail">{scene.detail}</div>{i === scenes.length - 1 && <a className="world-link" href="#how-it-works">Find your way in <ArrowUpRight size={19} aria-hidden="true" /></a>}</div>
      </article>)}</div>
    </div>
    {error && animate && <p className="world-error" role="status">The moving artwork could not load. The still image and lesson story remain available. <button onClick={() => setRetry(value => value + 1)}>Retry artwork</button></p>}
    <p className="world-art-credit">Conceptual artwork made with Higgsfield. The classroom tools below use reviewed lesson content.</p>
  </section>;
}
