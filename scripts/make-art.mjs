// Generates self-contained SVG art used as resource imagery.
// Everything is inline vector work: no external requests, instant load.
import fs from "node:fs";
import path from "node:path";

const OUT = path.join(process.cwd(), "public", "img");
fs.mkdirSync(OUT, { recursive: true });

const A = { from: "#0b2a4a", to: "#071426", accent: "#38bdf8", accent2: "#22d3ee" };

function frame(inner, a = A) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600" role="img">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${a.from}"/><stop offset="1" stop-color="${a.to}"/>
  </linearGradient>
  <radialGradient id="glow" cx="50%" cy="42%" r="55%">
    <stop offset="0" stop-color="${a.accent}" stop-opacity=".35"/>
    <stop offset="1" stop-color="${a.accent}" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="metal" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#e6f3ff" stop-opacity=".95"/><stop offset="1" stop-color="#7f9db8" stop-opacity=".75"/>
  </linearGradient>
  <filter id="soft"><feGaussianBlur stdDeviation="14"/></filter>
</defs>
<rect width="800" height="600" fill="url(#bg)"/>
<circle cx="400" cy="260" r="230" fill="url(#glow)"/>
<g stroke="${a.accent}" stroke-opacity=".14" stroke-width="1">
  ${Array.from({ length: 11 }, (_, i) => `<line x1="0" y1="${i * 60}" x2="800" y2="${i * 60}"/>`).join("")}
  ${Array.from({ length: 14 }, (_, i) => `<line x1="${i * 60}" y1="0" x2="${i * 60}" y2="600"/>`).join("")}
</g>
<ellipse cx="400" cy="470" rx="190" ry="26" fill="#000" opacity=".35" filter="url(#soft)"/>
${inner}
</svg>`;
}

const art = {
  camera: frame(`
    <rect x="250" y="270" width="300" height="170" rx="26" fill="url(#metal)"/>
    <rect x="250" y="230" width="110" height="52" rx="12" fill="#cbd9e6"/>
    <circle cx="430" cy="355" r="78" fill="#0a2038"/><circle cx="430" cy="355" r="58" fill="#123a5c"/>
    <circle cx="430" cy="355" r="34" fill="#0a1a2b"/><circle cx="452" cy="333" r="11" fill="#7dd3fc" opacity=".85"/>
    <rect x="278" y="292" width="60" height="16" rx="8" fill="#94a9bd"/>
    <circle cx="520" cy="252" r="10" fill="${A.accent}"/>`),
  laptop: frame(`
    <rect x="200" y="200" width="400" height="248" rx="16" fill="#0d1b2e" stroke="url(#metal)" stroke-width="4"/>
    <rect x="220" y="220" width="360" height="208" rx="8" fill="#0a2b4a"/>
    <g fill="${A.accent}" opacity=".75">${[0, 1, 2, 3, 4].map((i) => `<rect x="${240 + i * 64}" y="${300 - i * 16}" width="36" height="${90 + i * 16}" rx="6"/>`).join("")}</g>
    <path d="M150 460 L650 460 L690 500 L110 500 Z" fill="url(#metal)"/>
    <rect x="330" y="470" width="140" height="10" rx="5" fill="#8fa6bb"/>`),
  projector: frame(`
    <rect x="240" y="250" width="330" height="150" rx="24" fill="url(#metal)"/>
    <circle cx="300" cy="325" r="42" fill="#0b2036"/><circle cx="300" cy="325" r="26" fill="#7dd3fc" opacity=".9"/>
    <path d="M300 325 L700 200 L700 400 Z" fill="${A.accent}" opacity=".18"/>
    <rect x="420" y="292" width="110" height="14" rx="7" fill="#8fa6bb"/>
    <rect x="420" y="322" width="70" height="14" rx="7" fill="#8fa6bb"/>
    <circle cx="540" cy="370" r="9" fill="${A.accent2}"/>`),
  printer: frame(`
    <rect x="220" y="240" width="360" height="210" rx="18" fill="#0f2338" stroke="url(#metal)" stroke-width="4"/>
    <rect x="265" y="190" width="270" height="60" rx="10" fill="url(#metal)"/>
    <rect x="300" y="300" width="200" height="110" rx="8" fill="#0a1a2b" stroke="${A.accent}" stroke-opacity=".5"/>
    <path d="M330 380 h140 M330 350 h100" stroke="${A.accent}" stroke-width="8" stroke-linecap="round"/>
    <rect x="250" y="460" width="300" height="20" rx="10" fill="#12293f"/>
    <circle cx="540" cy="270" r="13" fill="${A.accent2}"/>`),
  robotics: frame(`
    <rect x="300" y="330" width="200" height="130" rx="16" fill="url(#metal)"/>
    <rect x="330" y="250" width="140" height="70" rx="12" fill="#0f2338" stroke="${A.accent}" stroke-width="3"/>
    <circle cx="370" cy="285" r="12" fill="${A.accent}"/><circle cx="420" cy="285" r="12" fill="${A.accent}"/>
    <g stroke="${A.accent2}" stroke-width="6" stroke-linecap="round">
      <line x1="340" y1="410" x2="250" y2="450"/><line x1="460" y1="410" x2="550" y2="450"/>
      <line x1="400" y1="250" x2="400" y2="180"/></g>
    <circle cx="400" cy="168" r="14" fill="${A.accent2}"/>
    <g fill="${A.accent}" opacity=".5">${[0, 1, 2].map((i) => `<rect x="${330 + i * 45}" y="355" width="26" height="26" rx="5"/>`).join("")}</g>`),
  microphone: frame(`
    <rect x="360" y="150" width="80" height="200" rx="40" fill="url(#metal)"/>
    <g stroke="#0a1a2b" stroke-width="3" opacity=".55">${Array.from({ length: 9 }, (_, i) => `<line x1="368" y1="${180 + i * 18}" x2="432" y2="${180 + i * 18}"/>`).join("")}</g>
    <path d="M300 330 q100 130 200 0" stroke="${A.accent}" stroke-width="10" fill="none" stroke-linecap="round"/>
    <line x1="400" y1="400" x2="400" y2="470" stroke="${A.accent}" stroke-width="10"/>
    <rect x="330" y="468" width="140" height="16" rx="8" fill="#8fa6bb"/>`),
  flask: frame(`
    <path d="M350 180 h100 v90 l90 170 a24 24 0 0 1 -22 34 h-236 a24 24 0 0 1 -22 -34 l90 -170 z" fill="#0d2136" stroke="url(#metal)" stroke-width="5"/>
    <path d="M295 380 h210 l45 80 a24 24 0 0 1 -22 24 h-256 a24 24 0 0 1 -22 -24 z" fill="${A.accent}" opacity=".45"/>
    <circle cx="370" cy="430" r="12" fill="${A.accent2}" opacity=".8"/>
    <circle cx="430" cy="455" r="8" fill="${A.accent2}" opacity=".7"/>
    <rect x="340" y="168" width="120" height="16" rx="8" fill="#8fa6bb"/>`),
  room: frame(`
    <rect x="170" y="150" width="460" height="330" rx="14" fill="#0d2136" stroke="url(#metal)" stroke-width="5"/>
    <rect x="210" y="190" width="380" height="150" rx="8" fill="${A.accent}" opacity=".18"/>
    <rect x="230" y="360" width="340" height="40" rx="10" fill="url(#metal)"/>
    <g fill="#8fa6bb">${[0, 1, 2, 3].map((i) => `<rect x="${250 + i * 85}" y="410" width="55" height="46" rx="8"/>`).join("")}</g>
    <circle cx="400" cy="265" r="34" fill="${A.accent}" opacity=".55"/>`),
  door: frame(`
    <rect x="280" y="140" width="240" height="360" rx="12" fill="#0d2136" stroke="url(#metal)" stroke-width="5"/>
    <rect x="305" y="170" width="190" height="150" rx="8" fill="${A.accent}" opacity=".22"/>
    <circle cx="480" cy="340" r="12" fill="${A.accent2}"/>
    <path d="M520 500 h140 M240 500 h-140" stroke="#8fa6bb" stroke-width="8" stroke-linecap="round"/>`),
  van: frame(`
    <path d="M170 330 h300 l70 70 h90 v90 h-460 z" fill="url(#metal)"/>
    <path d="M200 350 h150 v60 h-150 z" fill="#0a2b4a"/>
    <circle cx="270" cy="495" r="46" fill="#0a1a2b" stroke="${A.accent}" stroke-width="6"/>
    <circle cx="540" cy="495" r="46" fill="#0a1a2b" stroke="${A.accent}" stroke-width="6"/>
    <rect x="400" y="380" width="80" height="50" rx="8" fill="${A.accent}" opacity=".35"/>`),
  chip: frame(`
    <rect x="290" y="230" width="220" height="220" rx="18" fill="#0d2136" stroke="${A.accent}" stroke-width="4"/>
    <rect x="340" y="280" width="120" height="120" rx="10" fill="${A.accent}" opacity=".35"/>
    <g stroke="${A.accent2}" stroke-width="7" stroke-linecap="round">
      ${[0, 1, 2, 3].map((i) => `<line x1="${290}" y1="${275 + i * 45}" x2="230" y2="${275 + i * 45}"/><line x1="510" y1="${275 + i * 45}" x2="570" y2="${275 + i * 45}"/>`).join("")}
      ${[0, 1, 2].map((i) => `<line x1="${340 + i * 50}" y1="230" x2="${340 + i * 50}" y2="175"/><line x1="${340 + i * 50}" y1="450" x2="${340 + i * 50}" y2="505"/>`).join("")}
    </g>`),
  drill: frame(`
    <path d="M280 200 h180 a40 40 0 0 1 40 40 v90 h-160 l-60 80 v-80 a40 40 0 0 1 0 -130 z" fill="url(#metal)"/>
    <rect x="470" y="250" width="150" height="26" rx="13" fill="#8fa6bb"/>
    <rect x="600" y="238" width="60" height="50" rx="8" fill="${A.accent}"/>
    <rect x="300" y="380" width="120" height="130" rx="14" fill="#0d2136" stroke="${A.accent}" stroke-width="3"/>
    <circle cx="330" cy="240" r="10" fill="${A.accent2}"/>`),
  drone: frame(`
    <circle cx="400" cy="320" r="70" fill="url(#metal)"/>
    <g stroke="${A.accent}" stroke-width="12" stroke-linecap="round">
      <line x1="330" y1="250" x2="220" y2="180"/><line x1="470" y1="250" x2="580" y2="180"/>
      <line x1="330" y1="390" x2="220" y2="460"/><line x1="470" y1="390" x2="580" y2="460"/></g>
    <g fill="${A.accent}" opacity=".55">
      <ellipse cx="220" cy="180" rx="60" ry="12"/><ellipse cx="580" cy="180" rx="60" ry="12"/>
      <ellipse cx="220" cy="460" rx="60" ry="12"/><ellipse cx="580" cy="460" rx="60" ry="12"/></g>
    <circle cx="400" cy="320" r="26" fill="#0a1a2b"/>`),
};

for (const [name, svg] of Object.entries(art)) {
  fs.writeFileSync(path.join(OUT, `${name}.svg`), svg);
}

// Logo mark
fs.writeFileSync(
  path.join(OUT, "logomark.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#38bdf8"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs>
  <rect width="64" height="64" rx="16" fill="#081726"/>
  <path d="M18 44V22a6 6 0 0 1 6-6h10l12 12v16a6 6 0 0 1-6 6H24a6 6 0 0 1-6-6z" fill="none" stroke="url(#g)" stroke-width="3.5"/>
  <circle cx="32" cy="34" r="7" fill="none" stroke="url(#g)" stroke-width="3.5"/>
  <path d="M32 27v-6" stroke="url(#g)" stroke-width="3.5" stroke-linecap="round"/>
</svg>`
);

console.log(`[art] wrote ${Object.keys(art).length + 1} SVG assets to public/img`);
