"use client";

import { Canvas } from "@react-three/fiber";
import { AdaptiveDpr, Environment, Float, Preload } from "@react-three/drei";
import * as THREE from "three";
import type { ReactNode } from "react";

/**
 * The single three.js canvas used by the app. Kept deliberately light:
 *  - no external HDRs or textures (OffscreenCanvas-generated environment)
 *  - capped device pixel ratio
 *  - dpr adaptation for weaker GPUs
 */
export default function Scene({
  children,
  height = 420,
  reducedMotion = false,
  cameraPosition = [0, 0.6, 4.2],
  fov = 42,
}: {
  children: ReactNode;
  height?: number;
  reducedMotion?: boolean;
  cameraPosition?: [number, number, number];
  fov?: number;
}) {
  return (
    <div style={{ height }} className="h-full w-full">
      <Canvas
        dpr={[1, 1.75]}
        shadows={false}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        camera={{ position: cameraPosition, fov }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.25;
        }}
        frameloop={reducedMotion ? "demand" : "always"}
      >
        <color attach="background" args={["#050d18"]} />
        <fog attach="fog" args={["#050d18", 9, 20]} />
        <ambientLight intensity={0.9} />
        <directionalLight position={[4, 6, 5]} intensity={2.6} color="#e8f6ff" />
        <directionalLight position={[-5, 2, -4]} intensity={1.6} color="#22d3ee" />
        <pointLight position={[0, -2, 3]} intensity={12} color="#0ea5e9" distance={12} />
        <Environment resolution={64} frames={1}>
          <mesh scale={30}>
            <sphereGeometry args={[1, 16, 16]} />
            <meshBasicMaterial color="#0a1a2d" side={THREE.BackSide} />
          </mesh>
        </Environment>
        {children}
        <AdaptiveDpr pixelated={false} />
        <Preload all />
      </Canvas>
    </div>
  );
}

export function FloatWrap({ children, speed = 1.2, rotationIntensity = 0.5, floatIntensity = 0.7, enabled = true }: {
  children: ReactNode; speed?: number; rotationIntensity?: number; floatIntensity?: number; enabled?: boolean;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <Float speed={speed} rotationIntensity={rotationIntensity} floatIntensity={floatIntensity}>
      {children}
    </Float>
  );
}
