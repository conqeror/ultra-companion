/**
 * Generate app icon and splash screen assets from SVG templates.
 * Run: node scripts/generate-assets.mjs
 */
import { Resvg } from "@resvg/resvg-js";
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(__dirname, "..", "assets", "images");

function renderSvgToPng(svgString, width, height, outputPath) {
  const resvg = new Resvg(svgString, {
    fitTo: { mode: "width", value: width },
  });
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();
  writeFileSync(outputPath, pngBuffer);
  console.log(`  ✓ ${outputPath} (${width}x${height})`);
}

// ── App Icon SVG (1024x1024) ──
// Teal topographic contour lines with geometric road bike
const ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <clipPath id="roundedClip">
      <rect width="1024" height="1024" rx="224" ry="224"/>
    </clipPath>
  </defs>
  <g clip-path="url(#roundedClip)">
    <!-- Background -->
    <rect width="1024" height="1024" fill="#0E0E0C"/>

    <!-- Topographic contour lines - organic flowing curves -->
    <!-- Outermost contours -->
    <path d="M-80 720 Q 200 680, 350 740 Q 500 800, 650 720 Q 800 640, 1000 700 Q 1100 730, 1120 750"
          fill="none" stroke="#1C1B18" stroke-width="2.5" opacity="0.9"/>
    <path d="M-80 680 Q 180 630, 340 700 Q 500 770, 660 680 Q 820 590, 1000 660 Q 1100 700, 1120 710"
          fill="none" stroke="#1C1B18" stroke-width="2.5" opacity="0.9"/>
    <path d="M-80 640 Q 160 580, 330 650 Q 500 730, 670 640 Q 840 550, 1000 620 Q 1100 660, 1120 670"
          fill="none" stroke="#1C1B18" stroke-width="2.5" opacity="0.9"/>

    <!-- Mid contours - teal tinted -->
    <path d="M-80 600 Q 140 530, 310 600 Q 490 680, 680 590 Q 850 500, 1000 570 Q 1100 620, 1120 630"
          fill="none" stroke="#0D9488" stroke-width="2" opacity="0.2"/>
    <path d="M-80 560 Q 130 490, 300 560 Q 480 640, 690 550 Q 860 460, 1000 530 Q 1100 580, 1120 590"
          fill="none" stroke="#0D9488" stroke-width="2" opacity="0.25"/>
    <path d="M-80 520 Q 120 440, 290 520 Q 470 610, 700 510 Q 870 420, 1000 490 Q 1100 540, 1120 550"
          fill="none" stroke="#0D9488" stroke-width="2" opacity="0.3"/>
    <path d="M-80 480 Q 110 400, 280 470 Q 460 560, 710 470 Q 880 380, 1000 450 Q 1100 500, 1120 510"
          fill="none" stroke="#0D9488" stroke-width="2" opacity="0.35"/>

    <!-- Inner contours - brighter teal -->
    <path d="M-50 440 Q 120 360, 270 430 Q 450 520, 720 430 Q 880 340, 1000 410 Q 1080 460, 1100 470"
          fill="none" stroke="#14B8A6" stroke-width="2" opacity="0.3"/>
    <path d="M-30 400 Q 140 320, 270 390 Q 440 480, 730 390 Q 890 300, 1020 370 Q 1070 420, 1080 430"
          fill="none" stroke="#14B8A6" stroke-width="2" opacity="0.35"/>
    <path d="M0 360 Q 160 280, 280 350 Q 430 440, 740 350 Q 890 270, 1020 330 Q 1060 370, 1070 380"
          fill="none" stroke="#14B8A6" stroke-width="2" opacity="0.4"/>
    <path d="M30 330 Q 180 250, 300 320 Q 430 410, 740 310 Q 880 240, 1000 300 Q 1040 340, 1050 350"
          fill="none" stroke="#14B8A6" stroke-width="2" opacity="0.4"/>

    <!-- Upper contours -->
    <path d="M-80 280 Q 100 200, 260 260 Q 420 340, 620 280 Q 780 220, 940 270 Q 1060 310, 1120 340"
          fill="none" stroke="#0D9488" stroke-width="2" opacity="0.2"/>
    <path d="M-80 240 Q 100 160, 260 220 Q 420 300, 620 240 Q 780 180, 940 230 Q 1060 270, 1120 290"
          fill="none" stroke="#0D9488" stroke-width="2" opacity="0.15"/>
    <path d="M-80 200 Q 100 130, 260 180 Q 420 260, 620 200 Q 780 140, 940 190 Q 1060 220, 1120 240"
          fill="none" stroke="#1C1B18" stroke-width="2.5" opacity="0.9"/>

    <!-- Road bike - minimal geometric side view -->
    <!-- Positioned center, slightly above middle -->
    <g transform="translate(512, 460)" fill="none" stroke="#F0EDE8" stroke-linecap="round" stroke-linejoin="round">
      <!-- Wheels - two circles -->
      <circle cx="-135" cy="40" r="88" stroke-width="6" opacity="0.9"/>
      <circle cx="135" cy="40" r="88" stroke-width="6" opacity="0.9"/>

      <!-- Wheel hubs -->
      <circle cx="-135" cy="40" r="4" fill="#F0EDE8" stroke="none" opacity="0.7"/>
      <circle cx="135" cy="40" r="4" fill="#F0EDE8" stroke="none" opacity="0.7"/>

      <!-- Frame - diamond shape -->
      <!-- Seat tube: seat to bottom bracket -->
      <line x1="-20" y1="-65" x2="5" y2="40" stroke-width="7" opacity="0.95"/>
      <!-- Down tube: head tube to bottom bracket -->
      <line x1="75" y1="-55" x2="5" y2="40" stroke-width="7" opacity="0.95"/>
      <!-- Top tube: seat to head tube -->
      <line x1="-20" y1="-65" x2="75" y2="-55" stroke-width="7" opacity="0.95"/>
      <!-- Chain stay: bottom bracket to rear axle -->
      <line x1="5" y1="40" x2="-135" y2="40" stroke-width="5" opacity="0.9"/>
      <!-- Seat stay: seat to rear axle -->
      <line x1="-20" y1="-65" x2="-135" y2="40" stroke-width="5" opacity="0.9"/>

      <!-- Fork: head tube to front axle -->
      <line x1="75" y1="-55" x2="135" y2="40" stroke-width="6" opacity="0.95"/>

      <!-- Handlebar - drop bar simplified -->
      <line x1="75" y1="-55" x2="105" y2="-70" stroke-width="6" opacity="0.9"/>
      <line x1="105" y1="-70" x2="110" y2="-50" stroke-width="5" opacity="0.85"/>

      <!-- Seat -->
      <line x1="-35" y1="-72" x2="-5" y2="-72" stroke-width="7" stroke-linecap="round" opacity="0.9"/>

      <!-- Seat post -->
      <line x1="-20" y1="-72" x2="-20" y2="-65" stroke-width="5" opacity="0.9"/>
    </g>

    <!-- Teal accent line - a single prominent contour that flows through -->
    <path d="M-80 510 Q 100 420, 280 480 Q 440 550, 700 450 Q 870 360, 1040 430 Q 1100 470, 1120 480"
          fill="none" stroke="#14B8A6" stroke-width="4" opacity="0.7"/>
  </g>
</svg>
`;

// ── Splash Icon SVG (centered mark on transparent bg) ──
const SPLASH_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <!-- Just the bike mark, no background - splash bg set in app.config -->
  <g transform="translate(256, 240)" fill="none" stroke="#0D9488" stroke-linecap="round" stroke-linejoin="round">
    <!-- Wheels -->
    <circle cx="-100" cy="30" r="66" stroke-width="4.5" opacity="0.9"/>
    <circle cx="100" cy="30" r="66" stroke-width="4.5" opacity="0.9"/>

    <!-- Hubs -->
    <circle cx="-100" cy="30" r="3" fill="#0D9488" stroke="none" opacity="0.7"/>
    <circle cx="100" cy="30" r="3" fill="#0D9488" stroke="none" opacity="0.7"/>

    <!-- Frame -->
    <line x1="-15" y1="-49" x2="4" y2="30" stroke-width="5.5" opacity="0.95"/>
    <line x1="56" y1="-41" x2="4" y2="30" stroke-width="5.5" opacity="0.95"/>
    <line x1="-15" y1="-49" x2="56" y2="-41" stroke-width="5.5" opacity="0.95"/>
    <line x1="4" y1="30" x2="-100" y2="30" stroke-width="4" opacity="0.9"/>
    <line x1="-15" y1="-49" x2="-100" y2="30" stroke-width="4" opacity="0.9"/>
    <line x1="56" y1="-41" x2="100" y2="30" stroke-width="4.5" opacity="0.95"/>

    <!-- Handlebar -->
    <line x1="56" y1="-41" x2="78" y2="-52" stroke-width="4.5" opacity="0.9"/>
    <line x1="78" y1="-52" x2="82" y2="-37" stroke-width="4" opacity="0.85"/>

    <!-- Seat -->
    <line x1="-26" y1="-54" x2="-4" y2="-54" stroke-width="5.5" stroke-linecap="round" opacity="0.9"/>
    <line x1="-15" y1="-54" x2="-15" y2="-49" stroke-width="4" opacity="0.9"/>
  </g>

  <!-- Subtle contour lines around the bike -->
  <path d="M30 340 Q 130 310, 200 330 Q 280 360, 350 320 Q 420 290, 490 310"
        fill="none" stroke="#0D9488" stroke-width="1.5" opacity="0.25"/>
  <path d="M20 360 Q 120 330, 200 350 Q 280 380, 360 340 Q 430 310, 500 330"
        fill="none" stroke="#0D9488" stroke-width="1.5" opacity="0.2"/>
  <path d="M10 380 Q 110 350, 200 370 Q 290 400, 370 360 Q 440 330, 510 350"
        fill="none" stroke="#0D9488" stroke-width="1.5" opacity="0.15"/>
</svg>
`;

// ── Android Adaptive Icon Foreground (bike only, centered in safe zone) ──
const ANDROID_FG_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="432" height="432">
  <!-- Android adaptive icon: 108x108 with 66x66 safe zone centered at 54,54 -->
  <g transform="translate(54, 50)" fill="none" stroke="#F0EDE8" stroke-linecap="round" stroke-linejoin="round">
    <!-- Wheels -->
    <circle cx="-16" cy="5" r="10.5" stroke-width="1" opacity="0.9"/>
    <circle cx="16" cy="5" r="10.5" stroke-width="1" opacity="0.9"/>

    <!-- Frame -->
    <line x1="-2.5" y1="-8" x2="0.5" y2="5" stroke-width="1" opacity="0.95"/>
    <line x1="9" y1="-6.5" x2="0.5" y2="5" stroke-width="1" opacity="0.95"/>
    <line x1="-2.5" y1="-8" x2="9" y2="-6.5" stroke-width="1" opacity="0.95"/>
    <line x1="0.5" y1="5" x2="-16" y2="5" stroke-width="0.8" opacity="0.9"/>
    <line x1="-2.5" y1="-8" x2="-16" y2="5" stroke-width="0.8" opacity="0.9"/>
    <line x1="9" y1="-6.5" x2="16" y2="5" stroke-width="0.9" opacity="0.95"/>

    <!-- Handlebar -->
    <line x1="9" y1="-6.5" x2="12.5" y2="-8.5" stroke-width="0.9" opacity="0.9"/>
    <line x1="12.5" y1="-8.5" x2="13" y2="-6" stroke-width="0.8" opacity="0.85"/>

    <!-- Seat -->
    <line x1="-4.5" y1="-9" x2="-0.5" y2="-9" stroke-width="1" stroke-linecap="round" opacity="0.9"/>
  </g>
</svg>
`;

// ── Android Adaptive Icon Background (topo lines) ──
const ANDROID_BG_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="432" height="432">
  <rect width="108" height="108" fill="#0E0E0C"/>

  <!-- Topographic contour lines scaled for 108x108 -->
  <path d="M-8 75 Q 20 70, 37 77 Q 54 84, 68 75 Q 84 67, 105 73 Q 114 76, 116 78"
        fill="none" stroke="#1C1B18" stroke-width="0.6" opacity="0.9"/>
  <path d="M-8 70 Q 18 64, 35 72 Q 54 80, 70 70 Q 86 61, 105 68 Q 114 72, 116 74"
        fill="none" stroke="#1C1B18" stroke-width="0.6" opacity="0.9"/>
  <path d="M-8 65 Q 16 58, 33 66 Q 52 76, 72 65 Q 88 56, 105 63 Q 114 68, 116 69"
        fill="none" stroke="#0D9488" stroke-width="0.5" opacity="0.25"/>
  <path d="M-8 60 Q 14 52, 31 60 Q 50 70, 74 60 Q 90 51, 105 58 Q 114 63, 116 64"
        fill="none" stroke="#0D9488" stroke-width="0.5" opacity="0.3"/>
  <path d="M-8 55 Q 12 46, 29 55 Q 48 65, 76 55 Q 92 46, 105 53 Q 114 58, 116 59"
        fill="none" stroke="#14B8A6" stroke-width="0.5" opacity="0.35"/>
  <path d="M-5 50 Q 14 42, 29 50 Q 46 58, 74 50 Q 88 42, 105 49 Q 112 54, 114 55"
        fill="none" stroke="#14B8A6" stroke-width="0.6" opacity="0.5"/>
  <path d="M-5 45 Q 14 37, 30 44 Q 46 52, 74 44 Q 88 37, 105 43 Q 112 48, 114 49"
        fill="none" stroke="#14B8A6" stroke-width="0.5" opacity="0.35"/>
  <path d="M-8 40 Q 12 32, 28 38 Q 46 46, 72 38 Q 88 30, 105 37 Q 114 42, 116 44"
        fill="none" stroke="#0D9488" stroke-width="0.5" opacity="0.25"/>
  <path d="M-8 35 Q 12 28, 28 34 Q 46 42, 72 34 Q 88 26, 105 32 Q 114 36, 116 38"
        fill="none" stroke="#0D9488" stroke-width="0.5" opacity="0.2"/>
  <path d="M-8 30 Q 12 23, 28 29 Q 46 36, 72 29 Q 88 22, 105 28 Q 114 32, 116 33"
        fill="none" stroke="#1C1B18" stroke-width="0.6" opacity="0.9"/>
</svg>
`;

// ── Android Monochrome Icon ──
const ANDROID_MONO_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="432" height="432">
  <g transform="translate(54, 50)" fill="none" stroke="#000000" stroke-linecap="round" stroke-linejoin="round">
    <!-- Wheels -->
    <circle cx="-16" cy="5" r="10.5" stroke-width="1"/>
    <circle cx="16" cy="5" r="10.5" stroke-width="1"/>

    <!-- Frame -->
    <line x1="-2.5" y1="-8" x2="0.5" y2="5" stroke-width="1"/>
    <line x1="9" y1="-6.5" x2="0.5" y2="5" stroke-width="1"/>
    <line x1="-2.5" y1="-8" x2="9" y2="-6.5" stroke-width="1"/>
    <line x1="0.5" y1="5" x2="-16" y2="5" stroke-width="0.8"/>
    <line x1="-2.5" y1="-8" x2="-16" y2="5" stroke-width="0.8"/>
    <line x1="9" y1="-6.5" x2="16" y2="5" stroke-width="0.9"/>

    <!-- Handlebar -->
    <line x1="9" y1="-6.5" x2="12.5" y2="-8.5" stroke-width="0.9"/>
    <line x1="12.5" y1="-8.5" x2="13" y2="-6" stroke-width="0.8"/>

    <!-- Seat -->
    <line x1="-4.5" y1="-9" x2="-0.5" y2="-9" stroke-width="1" stroke-linecap="round"/>

    <!-- Subtle contour lines -->
    <path d="M-24 14 Q -8 10, 0 13 Q 10 17, 24 12" fill="none" stroke-width="0.5" opacity="0.4"/>
    <path d="M-26 18 Q -8 14, 0 17 Q 12 21, 26 16" fill="none" stroke-width="0.5" opacity="0.3"/>
  </g>
</svg>
`;

// ── Favicon SVG (48x48) ──
const FAVICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
  <rect width="48" height="48" rx="10" fill="#0E0E0C"/>

  <!-- Simplified bike at small size -->
  <g transform="translate(24, 22)" fill="none" stroke="#14B8A6" stroke-linecap="round" stroke-linejoin="round">
    <!-- Wheels -->
    <circle cx="-8" cy="3" r="6.5" stroke-width="1.2"/>
    <circle cx="8" cy="3" r="6.5" stroke-width="1.2"/>

    <!-- Frame - simplified -->
    <line x1="-1" y1="-5" x2="1" y2="3" stroke-width="1.2"/>
    <line x1="5" y1="-4" x2="1" y2="3" stroke-width="1.2"/>
    <line x1="-1" y1="-5" x2="5" y2="-4" stroke-width="1.2"/>
    <line x1="1" y1="3" x2="-8" y2="3" stroke-width="1"/>
    <line x1="-1" y1="-5" x2="-8" y2="3" stroke-width="1"/>
    <line x1="5" y1="-4" x2="8" y2="3" stroke-width="1.1"/>

    <!-- Handlebar -->
    <line x1="5" y1="-4" x2="7" y2="-5.5" stroke-width="1"/>

    <!-- Seat -->
    <line x1="-3" y1="-6" x2="1" y2="-6" stroke-width="1.2"/>
  </g>

  <!-- One topo line -->
  <path d="M2 35 Q 12 31, 24 34 Q 36 38, 46 33" fill="none" stroke="#14B8A6" stroke-width="0.8" opacity="0.4"/>
</svg>
`;

// ── Generate all assets ──
console.log("Generating app assets...\n");

const assets = [
  { svg: ICON_SVG, width: 1024, height: 1024, file: "icon.png" },
  { svg: SPLASH_SVG, width: 512, height: 512, file: "splash-icon.png" },
  { svg: ANDROID_FG_SVG, width: 432, height: 432, file: "android-icon-foreground.png" },
  { svg: ANDROID_BG_SVG, width: 432, height: 432, file: "android-icon-background.png" },
  { svg: ANDROID_MONO_SVG, width: 432, height: 432, file: "android-icon-monochrome.png" },
  { svg: FAVICON_SVG, width: 48, height: 48, file: "favicon.png" },
];

for (const { svg, width, height, file } of assets) {
  renderSvgToPng(svg, width, height, join(ASSETS_DIR, file));
}

console.log("\nDone! All assets generated.");
