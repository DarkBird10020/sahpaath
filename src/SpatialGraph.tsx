import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { DiagramMap } from "../shared/schema";

export default function SpatialGraph({
  map,
  selected,
}: {
  map: DiagramMap;
  selected: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    let renderer: THREE.WebGLRenderer;
    try {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("webgl2");
      if (!context) {
        setFailed(true);
        return;
      }
      renderer = new THREE.WebGLRenderer({
        canvas,
        context,
        antialias: true,
        alpha: true,
      });
    } catch {
      setFailed(true);
      return;
    }
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setSize(300, 260);
    host.current.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-hidden", "true");
    const resources: { dispose: () => void }[] = [];
    const positions = new Map<string, THREE.Vector3>();
    map.parts.forEach((p, i) => {
      const angle = (i * Math.PI * 2) / map.parts.length;
      const v = new THREE.Vector3(
        Math.cos(angle) * 2,
        Math.sin(angle) * 2,
        Math.sin(angle * 2) * 0.6,
      );
      positions.set(p.id, v);
      const geometry = new THREE.SphereGeometry(
        p.id === selected ? 0.3 : 0.17,
        12,
        8,
      );
      const material = new THREE.MeshBasicMaterial({
        color: p.id === selected ? "#bf8224" : "#163b69",
      });
      const sphere = new THREE.Mesh(geometry, material);
      sphere.position.copy(v);
      scene.add(sphere);
      resources.push(geometry, material);
    });
    map.relations.forEach((r) => {
      const a = positions.get(r.from);
      const b = positions.get(r.to);
      if (!a || !b) return;
      const geometry = new THREE.BufferGeometry().setFromPoints([a, b]);
      const material = new THREE.LineBasicMaterial({ color: "#678299" });
      scene.add(new THREE.Line(geometry, material));
      resources.push(geometry, material);
    });
    const resize = () => {
      if (!host.current) return;
      const width = host.current.clientWidth;
      renderer.setSize(width, 260);
      camera.aspect = width / 260;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    resize();
    const lost = (e: Event) => {
      e.preventDefault();
      setFailed(true);
    };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    return () => {
      observer.disconnect();
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      resources.forEach((r) => r.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [map, selected]);
  return (
    <div className="spatial-graph">
      {failed ? (
        <p>3D is unavailable. Use the concept tree and diagram above.</p>
      ) : (
        <>
          <div ref={host} aria-hidden="true" />
          <p className="small">
            Optional static concept graph. Amber marks the selected concept. All
            connections are available in the text view.
          </p>
        </>
      )}
    </div>
  );
}
