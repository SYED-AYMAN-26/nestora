"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Procedural equipment models built from primitives at runtime.
 *
 * Honest disclosure: these are REAL interactive 3D meshes (rotate / zoom with a
 * pointer or keyboard), but they are stylised procedural approximations, not
 * manufacturer-accurate CAD models. Where a resource has no `model_3d` key the
 * UI shows a 2D photo instead and says so — we never claim a flat image is 3D.
 */

const metal = { color: "#dceaf7", metalness: 0.5, roughness: 0.3 };
const dark = { color: "#1e3d5c", metalness: 0.4, roughness: 0.55 };
const accentMat = { color: "#38bdf8", emissive: "#0ea5e9", emissiveIntensity: 0.55, metalness: 0.3, roughness: 0.3 };

function Lens({ position = [0, 0, 0.62] as [number, number, number] }) {
  return (
    <group position={position}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.34, 0.38, 0.5, 40]} />
        <meshStandardMaterial {...dark} />
      </mesh>
      <mesh position={[0, 0, 0.26]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.3, 0.34, 0.06, 40]} />
        <meshStandardMaterial color="#17334d" metalness={0.9} roughness={0.12} />
      </mesh>
      <mesh position={[0, 0, 0.3]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.19, 0.19, 0.02, 40]} />
        <meshStandardMaterial color="#7dd3fc" transparent opacity={0.55} emissive="#38bdf8" emissiveIntensity={0.6} />
      </mesh>
    </group>
  );
}

export function CameraModel() {
  return (
    <group>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[1.4, 0.9, 0.62]} />
        <meshStandardMaterial color="#2d4d6d" metalness={0.55} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.05, 0.34]} castShadow>
        <boxGeometry args={[1.44, 0.5, 0.1]} />
        <meshStandardMaterial color="#3a6285" metalness={0.6} roughness={0.35} />
      </mesh>
      <Lens />
      {/* viewfinder hump */}
      <mesh position={[0, 0.55, 0]}>
        <boxGeometry args={[0.5, 0.32, 0.5]} />
        <meshStandardMaterial {...metal} />
      </mesh>
      <mesh position={[0, 0.74, 0]}>
        <cylinderGeometry args={[0.1, 0.1, 0.12, 20]} />
        <meshStandardMaterial color="#2f5071" metalness={0.55} roughness={0.4} />
      </mesh>
      {/* shutter button + dial */}
      <mesh position={[0.52, 0.5, 0.16]}>
        <cylinderGeometry args={[0.09, 0.09, 0.06, 20]} />
        <meshStandardMaterial {...accentMat} />
      </mesh>
      <mesh position={[-0.52, 0.5, 0.1]}>
        <cylinderGeometry args={[0.14, 0.14, 0.09, 24]} />
        <meshStandardMaterial color="#8aa6c0" metalness={0.8} roughness={0.25} />
      </mesh>
      {/* flash */}
      <mesh position={[-0.42, 0.46, 0.36]}>
        <boxGeometry args={[0.22, 0.12, 0.04]} />
        <meshStandardMaterial color="#e6f6ff" emissive="#bae6fd" emissiveIntensity={0.5} />
      </mesh>
    </group>
  );
}

export function LaptopModel() {
  return (
    <group rotation={[0.2, 0, 0]}>
      <mesh position={[0, 0, 0]} castShadow>
        <boxGeometry args={[2, 0.09, 1.3]} />
        <meshStandardMaterial {...metal} />
      </mesh>
      <mesh position={[0, -0.06, 0]}>
        <boxGeometry args={[1.6, 0.16, 0.9]} />
        <meshStandardMaterial color="#2b4c6b" metalness={0.5} roughness={0.5} />
      </mesh>
      <group position={[0, 0.06, -0.62]} rotation={[-1.85, 0, 0]}>
        <mesh position={[0, 0.62, 0]}>
          <boxGeometry args={[2, 1.24, 0.06]} />
          <meshStandardMaterial color="#2f5a7d" metalness={0.6} roughness={0.35} />
        </mesh>
        <mesh position={[0, 0.62, 0.04]}>
          <planeGeometry args={[1.84, 1.08]} />
          <meshStandardMaterial color="#1d5b85" emissive="#0ea5e9" emissiveIntensity={0.32} />
        </mesh>
        <mesh position={[0, 0.34, 0.055]}>
          <planeGeometry args={[1.2, 0.06]} />
          <meshBasicMaterial color="#7dd3fc" />
        </mesh>
        <mesh position={[-0.5, 0.2, 0.055]}>
          <planeGeometry args={[0.5, 0.06]} />
          <meshBasicMaterial color="#22d3ee" />
        </mesh>
      </group>
    </group>
  );
}

export function ProjectorModel() {
  return (
    <group>
      <mesh castShadow>
        <boxGeometry args={[1.7, 0.52, 1.1]} />
        <meshStandardMaterial {...metal} />
      </mesh>
      <mesh position={[-0.62, 0, 0.56]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.26, 0.3, 0.22, 32]} />
        <meshStandardMaterial color="#244863" metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[-0.62, 0, 0.7]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.19, 0.19, 0.03, 32]} />
        <meshStandardMaterial color="#f0faff" emissive="#38bdf8" emissiveIntensity={1.1} transparent opacity={0.9} />
      </mesh>
      <mesh position={[0.42, 0.28, 0]}>
        <cylinderGeometry args={[0.12, 0.12, 0.06, 24]} />
        <meshStandardMaterial {...accentMat} />
      </mesh>
      <mesh position={[0.42, -0.27, 0]}>
        <cylinderGeometry args={[0.07, 0.07, 0.06, 16]} />
        <meshStandardMaterial color="#8aa6c0" metalness={0.8} roughness={0.25} />
      </mesh>
    </group>
  );
}

export function RobotArmModel() {
  const arm2 = useRef<THREE.Group>(null);
  const arm3 = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (arm2.current) arm2.current.rotation.z = Math.sin(t * 0.7) * 0.28;
    if (arm3.current) arm3.current.rotation.z = Math.sin(t * 0.7 + 1.1) * 0.34;
  });
  return (
    <group position={[0, -0.5, 0]}>
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[0.85, 0.95, 0.24, 40]} />
        <meshStandardMaterial color="#31536f" metalness={0.6} roughness={0.4} />
      </mesh>
      <group ref={arm2} position={[0, 0.24, 0]}>
        <mesh position={[0, 0.55, 0]}>
          <cylinderGeometry args={[0.16, 0.2, 1.1, 24]} />
          <meshStandardMaterial {...metal} />
        </mesh>
        <group ref={arm3} position={[0, 1.1, 0]}>
          <mesh position={[0, 0.42, 0]}>
            <boxGeometry args={[0.2, 0.9, 0.24]} />
            <meshStandardMaterial color="#3a6285" metalness={0.6} roughness={0.35} />
          </mesh>
          <mesh position={[0, 0.9, 0]}>
            <sphereGeometry args={[0.16, 24, 24]} />
            <meshStandardMaterial {...accentMat} />
          </mesh>
          <mesh position={[0, 0.46, 0.16]}>
            <boxGeometry args={[0.28, 0.3, 0.1]} />
            <meshStandardMaterial color="#17334d" metalness={0.8} roughness={0.2} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.1, 0.22, 0.16]} rotation={[0, 0, s * 0.25]}>
              <boxGeometry args={[0.05, 0.3, 0.05]} />
              <meshStandardMaterial {...accentMat} />
            </mesh>
          ))}
        </group>
      </group>
      <mesh position={[0.7, 0.06, 0.5]} rotation={[0, 0, 0]}>
        <boxGeometry args={[0.5, 0.12, 0.36]} />
        <meshStandardMaterial color="#1e3d5c" emissive="#0ea5e9" emissiveIntensity={0.25} />
      </mesh>
    </group>
  );
}

export function MicrophoneModel() {
  return (
    <group position={[0, -0.2, 0]}>
      <mesh position={[0, 0.9, 0]}>
        <capsuleGeometry args={[0.22, 0.5, 12, 28]} />
        <meshStandardMaterial color="#dbeafe" metalness={0.85} roughness={0.22} />
      </mesh>
      <mesh position={[0, 1.22, 0]}>
        <sphereGeometry args={[0.22, 28, 20, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#9fb8d0" metalness={0.9} roughness={0.2} />
      </mesh>
      <mesh position={[0, 0.55, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 0.3, 16]} />
        <meshStandardMaterial {...accentMat} />
      </mesh>
      <mesh position={[0, 0.2, 0]}>
        <torusGeometry args={[0.34, 0.045, 12, 40, Math.PI]} />
        <meshStandardMaterial color="#8aa6c0" metalness={0.8} roughness={0.25} />
      </mesh>
      <mesh position={[0, -0.15, 0]} rotation={[0, 0, 0]}>
        <cylinderGeometry args={[0.42, 0.47, 0.1, 40]} />
        <meshStandardMaterial color="#31536f" metalness={0.7} roughness={0.4} />
      </mesh>
    </group>
  );
}

export function PrinterModel() {
  return (
    <group position={[0, -0.2, 0]}>
      <mesh>
        <boxGeometry args={[1.5, 1.2, 1.5]} />
        <meshStandardMaterial color="#294c68" metalness={0.5} roughness={0.45} />
      </mesh>
      <mesh position={[0, 0.62, 0]}>
        <boxGeometry args={[1.56, 0.14, 1.56]} />
        <meshStandardMaterial {...metal} />
      </mesh>
      <mesh position={[0, 0.1, 0]}>
        <boxGeometry args={[1.2, 0.06, 1.2]} />
        <meshStandardMaterial color="#16304a" metalness={0.7} roughness={0.3} />
      </mesh>
      {/* gantry */}
      <mesh position={[0, 0.4, 0]}>
        <boxGeometry args={[1.3, 0.06, 0.08]} />
        <meshStandardMaterial {...accentMat} />
      </mesh>
      <mesh position={[0.25, 0.34, 0]}>
        <boxGeometry args={[0.22, 0.2, 0.26]} />
        <meshStandardMaterial color="#3a6285" metalness={0.7} roughness={0.3} />
      </mesh>
      {/* print */}
      <mesh position={[0.25, 0.19, 0]}>
        <boxGeometry args={[0.3, 0.22, 0.3]} />
        <meshStandardMaterial color="#38bdf8" transparent opacity={0.6} emissive="#22d3ee" emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[0, -0.6, 0.55]}>
        <boxGeometry args={[0.7, 0.14, 0.3]} />
        <meshStandardMaterial color="#17334d" emissive="#0ea5e9" emissiveIntensity={0.35} />
      </mesh>
    </group>
  );
}

export function ChipModel() {
  return (
    <group>
      <mesh>
        <boxGeometry args={[1.4, 0.14, 1.4]} />
        <meshStandardMaterial color="#0f3a2e" metalness={0.3} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.18, 0]}>
        <boxGeometry args={[0.7, 0.22, 0.7]} />
        <meshStandardMaterial color="#16304a" metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.3, 0]}>
        <boxGeometry args={[0.42, 0.03, 0.42]} />
        <meshStandardMaterial {...accentMat} />
      </mesh>
      {Array.from({ length: 8 }).map((_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.45, 0.18, Math.sin(a) * 0.45]} rotation={[0, -a, 0]}>
            <boxGeometry args={[0.28, 0.05, 0.08]} />
            <meshStandardMaterial color="#c8b273" metalness={0.95} roughness={0.28} />
          </mesh>
        );
      })}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.78, 0.02, 0]}>
          <boxGeometry args={[0.18, 0.03, 1.2]} />
          <meshStandardMaterial color="#35618a" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

export function DrillModel() {
  return (
    <group rotation={[0, 0, 0.12]}>
      <mesh>
        <capsuleGeometry args={[0.3, 0.9, 8, 24]} />
        <meshStandardMaterial color="#f0b429" metalness={0.4} roughness={0.45} />
      </mesh>
      <mesh position={[0, 0.55, 0]}>
        <boxGeometry args={[0.2, 0.4, 0.2]} />
        <meshStandardMaterial color="#31536f" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.78, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.12, 0.12, 0.6, 24]} />
        <meshStandardMaterial {...metal} />
      </mesh>
      <mesh position={[0, 1.1, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.06, 0.34, 20]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.95} roughness={0.2} />
      </mesh>
      <mesh position={[0, -0.5, 0]}>
        <boxGeometry args={[0.34, 0.5, 0.4]} />
        <meshStandardMaterial color="#1e3d5c" metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[0, -0.28, 0.2]}>
        <boxGeometry args={[0.16, 0.1, 0.06]} />
        <meshStandardMaterial {...accentMat} />
      </mesh>
    </group>
  );
}

export function DroneModel() {
  const props = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (props.current) props.current.children.forEach((c, i) => (c.rotation.y = clock.getElapsedTime() * (i % 2 ? 14 : -14)));
  });
  return (
    <group>
      <mesh>
        <boxGeometry args={[0.7, 0.22, 0.7]} />
        <meshStandardMaterial color="#2f5a7d" metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position={[0, -0.14, 0]}>
        <sphereGeometry args={[0.16, 24, 24]} />
        <meshStandardMaterial color="#17334d" metalness={0.8} roughness={0.15} />
      </mesh>
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z], i) => (
        <group key={i} position={[x * 0.62, 0, z * 0.62]}>
          <mesh position={[-x * 0.3, 0.02, -z * 0.3]}>
            <boxGeometry args={[0.66, 0.07, 0.09]} />
            <meshStandardMaterial color="#3a6285" metalness={0.6} roughness={0.4} />
          </mesh>
          <mesh position={[0, 0.1, 0]}>
            <cylinderGeometry args={[0.1, 0.1, 0.12, 20]} />
            <meshStandardMaterial color="#8aa6c0" metalness={0.8} roughness={0.25} />
          </mesh>
          <group ref={i === 0 ? props : undefined} position={[0, 0.17, 0]}>
            <mesh>
              <boxGeometry args={[0.66, 0.012, 0.07]} />
              <meshStandardMaterial color="#7dd3fc" transparent opacity={0.75} />
            </mesh>
          </group>
        </group>
      ))}
      <mesh position={[0, 0.14, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 0.08, 16]} />
        <meshStandardMaterial {...accentMat} />
      </mesh>
    </group>
  );
}

export function FlaskModel() {
  return (
    <group position={[0, -0.35, 0]}>
      <mesh position={[0, 1.05, 0]}>
        <cylinderGeometry args={[0.24, 0.24, 0.5, 28, 1, true]} />
        <meshStandardMaterial color="#bfe6ff" transparent opacity={0.4} metalness={0.2} roughness={0.1} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.55, 0]}>
        <coneGeometry args={[0.72, 0.9, 32, 1, true]} />
        <meshStandardMaterial color="#bfe6ff" transparent opacity={0.35} metalness={0.2} roughness={0.08} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.32, 0]}>
        <coneGeometry args={[0.58, 0.5, 32]} />
        <meshStandardMaterial color="#22d3ee" transparent opacity={0.55} emissive="#22d3ee" emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[0, 1.33, 0]}>
        <cylinderGeometry args={[0.27, 0.27, 0.06, 28]} />
        <meshStandardMaterial color="#9fb8d0" metalness={0.85} roughness={0.2} />
      </mesh>
      <mesh position={[0, 0.06, 0]}>
        <cylinderGeometry args={[0.72, 0.78, 0.1, 40]} />
        <meshStandardMaterial color="#31536f" metalness={0.6} roughness={0.4} />
      </mesh>
      {[0.1, -0.1].map((x, i) => (
        <mesh key={i} position={[x, 0.5 + i * 0.16, 0]}>
          <sphereGeometry args={[0.07, 16, 16]} />
          <meshStandardMaterial color="#7dd3fc" transparent opacity={0.8} />
        </mesh>
      ))}
    </group>
  );
}

export function RoomModel() {
  return (
    <group position={[0, -0.4, 0]}>
      <mesh position={[0, 0, 0]} receiveShadow>
        <boxGeometry args={[2.2, 0.08, 1.8]} />
        <meshStandardMaterial color="#2a4d6a" metalness={0.4} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.8, -0.86]}>
        <boxGeometry args={[2.2, 1.6, 0.08]} />
        <meshStandardMaterial color="#254a67" metalness={0.4} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.75, -0.8]}>
        <planeGeometry args={[1.5, 0.85]} />
        <meshStandardMaterial color="#1d5b85" emissive="#0ea5e9" emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[0, 0.28, 0.18]}>
        <boxGeometry args={[1.7, 0.1, 0.7]} />
        <meshStandardMaterial {...metal} />
      </mesh>
      {[-0.62, -0.2, 0.22, 0.64].map((x, i) => (
        <group key={i} position={[x, 0.14, 0.62]}>
          <mesh>
            <boxGeometry args={[0.34, 0.06, 0.32]} />
            <meshStandardMaterial color="#3a6285" metalness={0.4} roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.18, -0.16]}>
            <boxGeometry args={[0.34, 0.36, 0.06]} />
            <meshStandardMaterial color="#2f5a7d" metalness={0.4} roughness={0.5} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.95, 0.1]}>
        <sphereGeometry args={[0.14, 24, 24]} />
        <meshStandardMaterial {...accentMat} />
      </mesh>
    </group>
  );
}

export function VanModel() {
  return (
    <group>
      <mesh position={[0, 0.2, 0]}>
        <boxGeometry args={[2.6, 0.9, 1.15]} />
        <meshStandardMaterial color="#dbeafe" metalness={0.55} roughness={0.35} />
      </mesh>
      <mesh position={[0.35, 0.82, 0]}>
        <boxGeometry args={[1.6, 0.24, 1.05]} />
        <meshStandardMaterial color="#c7dcef" metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[1.2, 0.42, 0.59]}>
        <boxGeometry args={[0.5, 0.34, 0.02]} />
        <meshStandardMaterial color="#1f4a6d" metalness={0.7} roughness={0.2} />
      </mesh>
      {[-0.85, 0.85].map((x) => (
        <group key={x}>
          {[-0.62, 0.62].map((z) => (
            <mesh key={z} position={[x, -0.2, z]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.3, 0.3, 0.18, 28]} />
              <meshStandardMaterial color="#16304a" metalness={0.4} roughness={0.6} />
            </mesh>
          ))}
        </group>
      ))}
      <mesh position={[-1.31, 0.25, 0.3]}>
        <boxGeometry args={[0.04, 0.2, 0.24]} />
        <meshStandardMaterial color="#fb7185" emissive="#fb7185" emissiveIntensity={0.6} />
      </mesh>
    </group>
  );
}

export function GenericModel() {
  return (
    <group>
      <mesh>
        <icosahedronGeometry args={[0.95, 1]} />
        <meshStandardMaterial color="#2a5272" metalness={0.7} roughness={0.35} flatShading />
      </mesh>
      <mesh>
        <icosahedronGeometry args={[1.02, 1]} />
        <meshBasicMaterial color="#38bdf8" wireframe transparent opacity={0.22} />
      </mesh>
      <mesh position={[0, 1.15, 0]}>
        <boxGeometry args={[0.6, 0.5, 0.6]} />
        <meshStandardMaterial {...accentMat} />
      </mesh>
    </group>
  );
}

export const MODELS: Record<string, () => React.JSX.Element> = {
  camera: CameraModel,
  laptop: LaptopModel,
  projector: ProjectorModel,
  robotics: RobotArmModel,
  microphone: MicrophoneModel,
  printer: PrinterModel,
  chip: ChipModel,
  drill: DrillModel,
  drone: DroneModel,
  flask: FlaskModel,
  room: RoomModel,
  door: RoomModel,
  van: VanModel,
  generic: GenericModel,
};

export const MODEL_LABEL: Record<string, string> = {
  camera: "DSLR camera", laptop: "Laptop", projector: "Projector", robotics: "Robotic arm",
  microphone: "Studio microphone", printer: "3D printer", chip: "Circuit board", drill: "Power drill",
  drone: "Drone", flask: "Lab flask", room: "Room layout", door: "Room layout", van: "Van", generic: "Equipment",
};
