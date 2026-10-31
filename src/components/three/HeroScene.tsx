"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Float } from "@react-three/drei";
import * as THREE from "three";
import { CameraModel, MicrophoneModel, PrinterModel, RobotArmModel } from "./models";

const nodes: { label: string; position: [number, number, number]; color: string }[] = [
  { label: "college", position: [-3.1, 1.4, -1.2], color: "#38bdf8" },
  { label: "company", position: [3.0, 0.9, -0.6], color: "#22d3ee" },
  { label: "community", position: [-2.4, -1.5, 0.4], color: "#0ea5e9" },
  { label: "individual", position: [2.7, -1.6, 0.8], color: "#7dd3fc" },
];

function NodeField() {
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (group.current) group.current.rotation.y = clock.getElapsedTime() * 0.06;
  });
  return (
    <group ref={group}>
      {nodes.map((n, i) => (
        <group key={i} position={n.position}>
          <mesh>
            <sphereGeometry args={[0.075, 16, 16]} />
            <meshStandardMaterial color={n.color} emissive={n.color} emissiveIntensity={1.2} />
          </mesh>
          <mesh>
            <sphereGeometry args={[0.2, 16, 16]} />
            <meshBasicMaterial color={n.color} transparent opacity={0.12} />
          </mesh>
        </group>
      ))}
      {/* connecting lines between provider nodes */}
      {nodes.map((a, i) =>
        nodes.slice(i + 1).map((b, j) => {
          const start = new THREE.Vector3(...a.position);
          const end = new THREE.Vector3(...b.position);
          const mid = start.clone().lerp(end, 0.5);
          const len = start.distanceTo(end);
          const quat = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            end.clone().sub(start).normalize()
          );
          return (
            <mesh key={`${i}-${j}`} position={mid} quaternion={quat}>
              <cylinderGeometry args={[0.004, 0.004, len, 6]} />
              <meshBasicMaterial color="#38bdf8" transparent opacity={0.24} />
            </mesh>
          );
        })
      )}
    </group>
  );
}

function OrbitingEquipment() {
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (group.current) group.current.rotation.y = clock.getElapsedTime() * 0.09;
  });
  return (
    <group ref={group}>
      <group position={[0, 2.05, 0]} scale={0.42}>
        <Float speed={1.1} floatIntensity={0.5} rotationIntensity={0.35}>
          <CameraModel />
        </Float>
      </group>
      <group position={[-2.35, 1.15, 0.9]} scale={0.3} rotation={[0.2, 0.6, 0]}>
        <Float speed={1.5} floatIntensity={0.6} rotationIntensity={0.4}>
          <RobotArmModel />
        </Float>
      </group>
      <group position={[2.7, 1.5, 0.45]} scale={0.3} rotation={[0.1, -0.5, 0]}>
        <Float speed={1.3} floatIntensity={0.55} rotationIntensity={0.3}>
          <MicrophoneModel />
        </Float>
      </group>
      <group position={[1.05, -2.4, -0.2]} scale={0.3} rotation={[0.15, 0.4, 0]}>
        <Float speed={1.7} floatIntensity={0.5} rotationIntensity={0.35}>
          <PrinterModel />
        </Float>
      </group>
    </group>
  );
}

export function HeroScene({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <>
      <group position={[0, 0, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.9, 0]}>
          <circleGeometry args={[7.5, 64]} />
          <meshStandardMaterial color="#08182a" metalness={0.9} roughness={0.5} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.88, 0]}>
          <ringGeometry args={[3.4, 3.44, 96]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.32} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.87, 0]}>
          <ringGeometry args={[5.2, 5.23, 96]} />
          <meshBasicMaterial color="#22d3ee" transparent opacity={0.16} />
        </mesh>
      </group>
      <NodeField />
      <OrbitingEquipment />
      {!reducedMotion && (
        <Float speed={1.4} rotationIntensity={0.2} floatIntensity={0.4}>
          <group position={[0, 0.1, 0]} scale={0.62}>
            <CameraModel />
          </group>
        </Float>
      )}
      {reducedMotion && (
        <group position={[0, 0.1, 0]} scale={0.62}>
          <CameraModel />
        </group>
      )}
    </>
  );
}
