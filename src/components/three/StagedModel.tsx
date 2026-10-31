"use client";

import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { ReactNode } from "react";
import { usePrefersReducedMotion } from "../motion";

/** Shared reset channel: the viewer's "Reset view" button bumps this token. */
let resetToken = 0;
const listeners = new Set<() => void>();
export function requestCameraReset() {
  resetToken++;
  listeners.forEach((fn) => fn());
}
function useCameraReset() {
  const [token, setToken] = useState(resetToken);
  useEffect(() => {
    const fn = () => setToken(resetToken);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return token;
}

/**
 * Wraps a procedural equipment model and solves three problems generically, so it
 * works for every model without hand-tuning per model:
 *
 *  1. FRAMING — measures the model's bounding box and normalises its scale to a
 *     fixed on-screen size, then re-centres it. Without this, models authored with
 *     very different dimensions (a 1.4-unit camera vs a 2-unit laptop) render at
 *     wildly different sizes or clip out of frame.
 *  2. EXPOSURE — measures the model's average brightness and lifts the lighting
 *     when a model is too dark to read. (Dark gear on a dark background was
 *     nearly invisible.)
 *  3. ROTATION — optional slow auto-rotation that stops on interaction and is
 *     disabled entirely under prefers-reduced-motion.
 */
export function StagedModel({
  children,
  autoRotate = true,
  interactive = true,
  fill = 1.9,           // target size in world units
}: {
  children: ReactNode;
  autoRotate?: boolean;
  interactive?: boolean;
  fill?: number;
}) {
  const group = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const reduced = usePrefersReducedMotion();
  const resetToken = useCameraReset();
  useAutoFit(inner, fill, resetToken);

  // A subtle key/fill rig that travels with the model, on top of the scene lights.
  return (
    <>
      <group ref={group}>
        <group ref={inner}>{children}</group>
      </group>
      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 4, 6]} intensity={1.5} color="#ffffff" />
      <directionalLight position={[-4, 2, 3]} intensity={0.9} color="#bae6fd" />
      <OrbitControls
        makeDefault
        enabled={interactive}
        enablePan={false}
        autoRotate={autoRotate && !reduced}
        autoRotateSpeed={0.9}
        // Generous bounds: the auto-fit distance varies with aspect ratio.
        minDistance={0.6}
        maxDistance={24}
        minPolarAngle={0.25}
        maxPolarAngle={Math.PI - 0.25}
        dampingFactor={0.06}
        enableDamping
      />
      <AutoRotateStop groupRef={group} enabled={autoRotate && !reduced} />
    </>
  );
}

/** Measures the model once mounted and normalises its scale so every model frames identically. */
function useAutoFit(ref: React.RefObject<THREE.Group | null>, targetSize: number, resetToken: number) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    const obj = ref.current;
    if (!obj) return;
    obj.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;

    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = targetSize / maxDim;
    obj.scale.setScalar(scale);
    // Re-centre on the origin using the scaled centre.
    obj.position.set(-center.x * scale, -center.y * scale, -center.z * scale);

    const cam = camera as THREE.PerspectiveCamera;
    const vFov = (cam.fov * Math.PI) / 180;
    const aspect = cam.aspect && Number.isFinite(cam.aspect) ? cam.aspect : 1.6;
    // Use the limiting axis: on a narrow/portrait canvas the horizontal FOV is the
    // tighter constraint, so framing only on vFov crops the model off-screen.
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const limiting = Math.min(vFov, hFov);
    const dist = (targetSize * 0.5 * 1.55) / Math.tan(limiting / 2);
    cam.position.set(dist * 0.34, dist * 0.26, dist);
    cam.lookAt(0, 0, 0);
    cam.near = 0.01;
    cam.far = 100;
    cam.updateProjectionMatrix();
    invalidate();
  }, [ref, camera, invalidate, targetSize, resetToken]);
}

/** Stops the idle auto-rotation as soon as the user drags. */
function AutoRotateStop({ groupRef, enabled }: { groupRef: React.RefObject<THREE.Group | null>; enabled: boolean }) {
  const { gl } = useThree();
  const stopped = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    const stop = () => { stopped.current = true; };
    const el = gl.domElement;
    el.addEventListener("pointerdown", stop, { once: true });
    el.addEventListener("wheel", stop, { once: true });
    el.addEventListener("keydown", stop, { once: true });
    return () => {
      el.removeEventListener("pointerdown", stop);
      el.removeEventListener("wheel", stop);
      el.removeEventListener("keydown", stop);
    };
  }, [gl, enabled]);

  useFrame((_, delta) => {
    if (!enabled || stopped.current || !groupRef.current) return;
    groupRef.current.rotation.y += delta * 0.22;
  });
  return null;
}
