/**
 * prisma/decorativeAssets.ts — ShopRoom decorative SVG asset registry.
 *
 * Premium, illustration-grade art: veined foliage, layered clouds, a true 3D
 * podium and glinting sparkles. Every asset tints via `currentColor` and layers
 * white/black overlays for depth, so one asset recolours per scene theme.
 * Purely atmospheric fills (radial glow, vignette) stay CSS — see CSS_ASSETS.
 */

// A single veined leaf, drawn from the stem origin so it can be rotated in place.
const LEAF_PATH = "M0 0C-11 -26 -11 -56 0 -84 11 -56 11 -26 0 0Z";
const leafVeins = (h: number) =>
  `<path d="M0 -6V${-h + 10}" stroke="#fff" stroke-opacity=".42" stroke-width="2.4" fill="none" stroke-linecap="round"/>` +
  `<g stroke="#fff" stroke-opacity=".26" stroke-width="1.6" fill="none" stroke-linecap="round">` +
  `<path d="M0 ${-h * 0.34}c-6 5-9 11-10 18"/><path d="M0 ${-h * 0.34}c6 5 9 11 10 18"/>` +
  `<path d="M0 ${-h * 0.58}c-5 5-8 10-9 16"/><path d="M0 ${-h * 0.58}c5 5 8 10 9 16"/>` +
  `<path d="M0 ${-h * 0.78}c-4 4-6 8-7 13"/><path d="M0 ${-h * 0.78}c4 4 6 8 7 13"/></g>`;

export const SVG_ASSETS: Record<string, string> = {
  // ── Foliage ────────────────────────────────────────────────────────────────
  "leaf": `<svg viewBox="-40 -100 80 104" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><g fill="currentColor"><path d="${LEAF_PATH}"/></g>${leafVeins(84)}</svg>`,

  "leaf-sprig": `<svg viewBox="-60 -130 120 134" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><path d="M0 0C-2 -40 -1 -80 0 -120" stroke="currentColor" stroke-width="4" fill="none" stroke-linecap="round"/><g fill="currentColor"><g transform="translate(0,-118) scale(.42)"><path d="${LEAF_PATH}"/></g><g transform="translate(0,-78) rotate(-42) scale(.55)"><path d="${LEAF_PATH}"/></g><g transform="translate(0,-78) rotate(42) scale(.55)"><path d="${LEAF_PATH}"/></g><g transform="translate(0,-36) rotate(-56) scale(.62)" opacity=".9"><path d="${LEAF_PATH}"/></g><g transform="translate(0,-36) rotate(56) scale(.62)" opacity=".9"><path d="${LEAF_PATH}"/></g></g></svg>`,

  "leaf-cluster": `<svg viewBox="-90 -160 180 165" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><g fill="currentColor"><g transform="rotate(-58) scale(.72)"><path d="${LEAF_PATH}"/></g><g transform="rotate(-30) scale(.9)" opacity=".95"><path d="${LEAF_PATH}"/></g><g transform="scale(1.05)"><path d="${LEAF_PATH}"/></g><g transform="rotate(30) scale(.9)" opacity=".95"><path d="${LEAF_PATH}"/></g><g transform="rotate(58) scale(.72)"><path d="${LEAF_PATH}"/></g></g><g transform="scale(1.05)">${leafVeins(84)}</g><g transform="rotate(-30) scale(.9)" opacity=".7">${leafVeins(84)}</g><g transform="rotate(30) scale(.9)" opacity=".7">${leafVeins(84)}</g></svg>`,

  "plant": `<svg viewBox="-90 -170 180 175" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><g stroke="currentColor" stroke-width="3.5" fill="none" stroke-linecap="round" opacity=".75"><path d="M0 0C-4 -40 -18 -66 -40 -88"/><path d="M0 0C4 -42 18 -70 42 -92"/><path d="M0 0C-2 -50 -6 -84 -10 -112"/></g><g fill="currentColor"><g transform="translate(-40,-88) rotate(-38) scale(.68)"><path d="${LEAF_PATH}"/></g><g transform="translate(42,-92) rotate(38) scale(.68)"><path d="${LEAF_PATH}"/></g><g transform="translate(-10,-112) rotate(-6) scale(.8)"><path d="${LEAF_PATH}"/></g><g transform="translate(-58,-52) rotate(-72) scale(.5)" opacity=".85"><path d="${LEAF_PATH}"/></g><g transform="translate(60,-56) rotate(72) scale(.5)" opacity=".85"><path d="${LEAF_PATH}"/></g></g><g transform="translate(-10,-112) rotate(-6) scale(.8)">${leafVeins(84)}</g></svg>`,

  "fern": `<svg viewBox="-50 -150 100 155" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><path d="M0 2C-3 -46 -2 -96 0 -142" stroke="currentColor" stroke-width="3.5" fill="none" stroke-linecap="round"/><g fill="currentColor">${Array.from({ length: 9 }, (_, i) => {
    const y = -14 - i * 14;
    const s = (0.46 - i * 0.04).toFixed(2);
    return `<g transform="translate(0,${y}) rotate(-62) scale(${s})"><path d="${LEAF_PATH}"/></g><g transform="translate(0,${y}) rotate(62) scale(${s})"><path d="${LEAF_PATH}"/></g>`;
  }).join("")}</g></svg>`,

  "monstera": `<svg viewBox="-70 -140 140 145" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><path d="M0 2V-58" stroke="currentColor" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M0 -58C-46 -58 -66 -84 -62 -108c3-18 22-30 40-28 8-14 30-14 44-4 18 12 20 40 6 60-10 14-28 22-48 22Z" fill="currentColor"/><g stroke="#fff" stroke-opacity=".45" stroke-width="3" fill="none" stroke-linecap="round"><path d="M-2 -60c-14-10-26-22-34-36"/><path d="M2 -62c10-12 18-24 22-38"/><path d="M-6 -74c-16-4-30-6-44-4"/><path d="M8 -78c14-2 26-8 36-16"/></g></svg>`,

  "palm": `<svg viewBox="-80 -130 160 135" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><path d="M0 2C-4 -30 -4 -60 0 -92" stroke="currentColor" stroke-width="4" fill="none" stroke-linecap="round"/><g fill="currentColor" opacity=".95">${[-74, -50, -25, 0, 25, 50, 74].map((r, i) => `<g transform="translate(0,-92) rotate(${r}) scale(${(0.5 + (3 - Math.abs(i - 3)) * 0.1).toFixed(2)})"><path d="${LEAF_PATH}"/></g>`).join("")}</g></svg>`,

  "branch": `<svg viewBox="-60 -140 120 145" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><path d="M0 2C-6 -40 -4 -92 2 -134" stroke="currentColor" stroke-width="3.5" fill="none" stroke-linecap="round"/><g fill="currentColor">${[[-30, -48, 0.42], [-70, 46, 0.4], [-92, -44, 0.36], [-116, 40, 0.32]].map(([y, r, s]) => `<g transform="translate(0,${y}) rotate(${r}) scale(${s})"><path d="${LEAF_PATH}"/></g>`).join("")}</g></svg>`,

  "grass": `<svg viewBox="-80 -90 160 95" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><g stroke="currentColor" stroke-width="6" stroke-linecap="round" fill="none"><path d="M-54 2C-54 -26 -60 -48 -70 -66"/><path d="M-28 2C-28 -32 -30 -56 -38 -80"/><path d="M-4 2C-4 -36 0 -60 8 -84"/><path d="M22 2C22 -30 28 -52 40 -70"/><path d="M50 2C50 -24 58 -42 70 -56"/></g></svg>`,

  "flower": `<svg viewBox="0 0 120 120" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><g fill="currentColor">${[0, 45, 90, 135, 180, 225, 270, 315].map((r) => `<ellipse cx="60" cy="30" rx="13" ry="26" transform="rotate(${r} 60 60)"/>`).join("")}</g><circle cx="60" cy="60" r="16" fill="#FBBF24"/><circle cx="60" cy="60" r="9" fill="#F59E0B" opacity=".6"/></svg>`,

  // ── Atmosphere ─────────────────────────────────────────────────────────────
  "cloud": `<svg viewBox="0 0 240 120" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><g fill="currentColor"><ellipse cx="72" cy="78" rx="52" ry="30"/><ellipse cx="126" cy="60" rx="62" ry="42"/><ellipse cx="180" cy="80" rx="46" ry="28"/><rect x="66" y="80" width="120" height="26" rx="13"/></g><g fill="#fff" opacity=".35"><ellipse cx="118" cy="48" rx="44" ry="24"/><ellipse cx="76" cy="66" rx="26" ry="14"/></g></svg>`,

  "cloud-soft": `<svg viewBox="0 0 240 100" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><g fill="currentColor" opacity=".85"><ellipse cx="80" cy="62" rx="60" ry="30"/><ellipse cx="150" cy="56" rx="70" ry="34"/><rect x="76" y="60" width="140" height="28" rx="14"/></g></svg>`,

  "mist": `<svg viewBox="0 0 240 70" width="100%" height="100%" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><g fill="currentColor"><rect x="8" y="8" width="170" height="10" rx="5" opacity=".55"/><rect x="46" y="30" width="180" height="10" rx="5" opacity=".4"/><rect x="18" y="52" width="130" height="10" rx="5" opacity=".3"/></g></svg>`,

  "light-ray": `<svg viewBox="0 0 140 190" width="100%" height="100%" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><g fill="currentColor"><path d="M64 0h14l26 190H42Z" opacity=".38"/><path d="M18 0h9l-8 190H4Z" opacity=".22"/><path d="M116 0h9l12 190h-16Z" opacity=".22"/></g></svg>`,

  // ── Landscape ──────────────────────────────────────────────────────────────
  "mountain": `<svg viewBox="0 0 200 120" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><path d="M2 116 68 16l40 56 26-30 62 74Z" fill="currentColor"/><path d="M68 16l24 34-24 18-22-18Z" fill="#fff" opacity=".4"/><path d="M134 42l16 18-16 12-14-12Z" fill="#fff" opacity=".28"/></svg>`,

  "hill": `<svg viewBox="0 0 240 100" width="100%" height="100%" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><path d="M0 100C46 34 96 34 132 60c34 24 70 8 108-26v66Z" fill="currentColor"/><path d="M0 100c50-40 92-40 126-16 30 22 66 12 114-20v36Z" fill="#fff" opacity=".18"/></svg>`,

  // ── Product environment ────────────────────────────────────────────────────
  "pedestal": `<svg viewBox="0 0 240 96" width="100%" height="100%" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><ellipse cx="120" cy="66" rx="116" ry="24" fill="currentColor" opacity=".3"/><path d="M4 34v18a116 24 0 0 0 232 0V34Z" fill="currentColor"/><path d="M4 34v18a116 24 0 0 0 232 0V34Z" fill="#000" opacity=".16"/><ellipse cx="120" cy="34" rx="116" ry="24" fill="currentColor"/><ellipse cx="120" cy="34" rx="116" ry="24" fill="#fff" opacity=".2"/><ellipse cx="120" cy="29" rx="82" ry="15" fill="#fff" opacity=".16"/></svg>`,

  "platform": `<svg viewBox="0 0 240 80" width="100%" height="100%" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><ellipse cx="120" cy="44" rx="116" ry="26" fill="currentColor"/><ellipse cx="120" cy="40" rx="116" ry="26" fill="#fff" opacity=".22"/><ellipse cx="120" cy="36" rx="76" ry="14" fill="#fff" opacity=".16"/></svg>`,

  // ── Shapes ─────────────────────────────────────────────────────────────────
  "ring": `<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" stroke-width="5"/><circle cx="50" cy="50" r="30" fill="none" stroke="currentColor" stroke-width="2" opacity=".45"/></svg>`,
  "wave": `<svg viewBox="0 0 240 50" width="100%" height="100%" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><path d="M0 26 Q30 4 60 26 T120 26 T180 26 T240 26" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M0 38 Q30 18 60 38 T120 38 T180 38 T240 38" fill="none" stroke="currentColor" stroke-width="2.5" opacity=".5" stroke-linecap="round"/></svg>`,
  "blob": `<svg viewBox="0 0 140 140" width="100%" height="100%" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><path d="M72 6c28 0 58 16 62 44s-16 50-34 66-48 26-66 12S8 84 12 60 44 6 72 6Z" fill="currentColor"/></svg>`,
  "triangle": `<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><path d="M50 8 94 92H6Z" fill="currentColor" stroke="currentColor" stroke-width="6" stroke-linejoin="round"/></svg>`,
  "arc": `<svg viewBox="0 0 120 70" width="100%" height="100%" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 64a54 54 0 0 1 108 0" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/></svg>`,
  "bubble": `<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="44" fill="currentColor" opacity=".5"/><circle cx="50" cy="50" r="44" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="2"/><ellipse cx="35" cy="33" rx="13" ry="9" fill="#fff" opacity=".55" transform="rotate(-28 35 33)"/></svg>`,

  // ── Particles ──────────────────────────────────────────────────────────────
  "sparkle": `<svg viewBox="0 0 120 120" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><g fill="currentColor"><path d="M60 4C67 44 76 53 116 60 76 67 67 76 60 116 53 76 44 67 4 60 44 53 53 44 60 4Z"/><path d="M22 12c2.6 13 5.6 16 18.6 18.6C27.6 33 24.6 36 22 49 19.4 36 16.4 33 3.4 30.6 16.4 28 19.4 25 22 12Z" opacity=".7" transform="translate(72,66) scale(.5)"/></g></svg>`,
  "star": `<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><path d="M50 5 61 39 97 39 68 61 79 95 50 74 21 95 32 61 3 39 39 39Z" fill="currentColor"/><path d="M50 22 56 42 76 42 60 54 66 74 50 62 34 74 40 54 24 42 44 42Z" fill="#fff" opacity=".22"/></svg>`,
  "dots": `<svg viewBox="0 0 110 110" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><g fill="currentColor">${[0, 1, 2, 3].flatMap((r) => [0, 1, 2, 3].map((c) => `<circle cx="${12 + c * 28}" cy="${12 + r * 28}" r="${5 - r * 0.7}" opacity="${(1 - r * 0.18).toFixed(2)}"/>`)).join("")}</g></svg>`,
  "particles": `<svg viewBox="0 0 140 140" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><g fill="currentColor"><circle cx="20" cy="30" r="3.6" opacity=".85"/><circle cx="58" cy="14" r="2.2" opacity=".6"/><circle cx="104" cy="34" r="4" opacity=".75"/><circle cx="34" cy="78" r="2.8" opacity=".6"/><circle cx="86" cy="66" r="2.2" opacity=".5"/><circle cx="122" cy="90" r="3.4" opacity=".7"/><circle cx="66" cy="108" r="2.8" opacity=".62"/><circle cx="16" cy="116" r="2.2" opacity=".5"/><circle cx="128" cy="18" r="2" opacity=".45"/><circle cx="46" cy="46" r="1.8" opacity=".4"/></g></svg>`,
  "confetti": `<svg viewBox="0 0 140 140" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><g><rect x="12" y="20" width="12" height="12" rx="3" fill="#F59E0B" transform="rotate(22 18 26)"/><circle cx="108" cy="18" r="6" fill="#EC4899"/><rect x="66" y="8" width="10" height="10" rx="3" fill="#10B981" transform="rotate(35 71 13)"/><circle cx="32" cy="96" r="5" fill="#3B82F6"/><rect x="112" y="82" width="11" height="11" rx="3" fill="#8B5CF6" transform="rotate(16 117 87)"/><circle cx="84" cy="114" r="5.5" fill="#F43F5E"/><rect x="46" y="60" width="9" height="9" rx="2" fill="#22C55E" transform="rotate(28 50 64)"/><rect x="92" y="46" width="8" height="8" rx="2" fill="#FBBF24" transform="rotate(-18 96 50)"/><circle cx="18" cy="60" r="4" fill="#A855F7"/></g></svg>`,

  // ── Sale ───────────────────────────────────────────────────────────────────
  "sale-burst": `<svg viewBox="0 0 120 120" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><path d="M60 2l10 18 19-9-3 21 21 3-14 15 14 15-21 3 3 21-19-9-10 18-10-18-19 9 3-21-21-3 14-15-14-15 21-3-3-21 19 9Z" fill="currentColor"/><circle cx="60" cy="60" r="26" fill="#fff" opacity=".18"/></svg>`,
  "lightning": `<svg viewBox="0 0 70 120" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><path d="M40 2 8 66h24l-10 52 42-70H38Z" fill="currentColor"/><path d="M40 2 8 66h24l-10 52 42-70H38Z" fill="#fff" opacity=".22" transform="translate(3,4) scale(.86)" transform-origin="35 60"/></svg>`,
  "price-tag": `<svg viewBox="0 0 120 120" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><path d="M62 8h44a6 6 0 0 1 6 6v44L58 112 8 62Z" fill="currentColor"/><circle cx="90" cy="30" r="10" fill="#fff"/><circle cx="90" cy="30" r="4" fill="currentColor" opacity=".5"/></svg>`,
  "ribbon": `<svg viewBox="0 0 140 70" width="100%" height="100%" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 12h120l-16 23 16 23H10l16-23Z" fill="currentColor"/><path d="M26 35h96" stroke="#fff" stroke-opacity=".25" stroke-width="3"/></svg>`,
};

/** Assets the renderer paints with CSS instead of SVG (soft atmospheric fills). */
export const CSS_ASSETS = new Set([
  "glow", "radial-light", "spotlight", "product-glow", "gradient-orb",
  "product-shadow", "soft-shadow", "vignette",
]);

