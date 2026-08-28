/* js/hqCityBuilderSVG.js — Isometric SVG City Builder HQ
 * Vanilla JS factory that returns a complete SVG string.
 * 400×400 viewBox, 1:0.5 isometric, chunky 3.5 stroke, CSS-variable theming,
 * every major piece is <g data-part="..."> for future animation.
 */

window.HQCityBuilderSVG = (function(){
  function build(options){
    options = options || {};
    // allow caller to override CSS variable values via JS
    const cssVars = `
      :root{
        --iso-outline: ${options.outline || '#0F172A'};
        --iso-wall-left: ${options.wallLeft || '#F8FAFC'};
        --iso-wall-right: ${options.wallRight || '#E2E8F0'};
        --iso-roof: ${options.roof || '#2563EB'};
        --iso-door: ${options.door || '#1E293B'};
        --iso-orange: ${options.orange || '#F97316'};
        --iso-window: ${options.window || '#BAE6FD'};
        --iso-window-lit: ${options.windowLit || '#FDE68A'};
        --iso-helipad: ${options.helipad || '#1E293B'};
        --iso-beacon: ${options.beacon || '#EF4444'};
        --iso-ac-top: #F1F5F9;
        --iso-ac-side: #CBD5E1;
        --iso-ac-dark: #94A3B8;
      }
    `;

    // simplified: 3 per face, larger, cleaner (was 6)
    const windowsLeft = [
      {x:14,y:14,lit:false},{x:14,y:30,lit:true},{x:14,y:46,lit:false},
    ];
    const windowsRight = [
      {x:14,y:14,lit:true},{x:14,y:30,lit:false},{x:14,y:46,lit:true},
    ];

    const winLeftSVG = windowsLeft.map(w=>`
      <rect x="${w.x}" y="${w.y}" width="14" height="16" rx="2.5" ry="2.5"
        fill="${w.lit?'var(--iso-window-lit)':'var(--iso-window)'}"
        stroke="var(--iso-outline)" stroke-width="1.8"
        stroke-linejoin="round" stroke-linecap="round"/>`).join('');

    const winRightSVG = windowsRight.map(w=>`
      <rect x="${w.x}" y="${w.y}" width="14" height="16" rx="2.5" ry="2.5"
        fill="${w.lit?'var(--iso-window-lit)':'var(--iso-window)'}"
        stroke="var(--iso-outline)" stroke-width="1.8"
        stroke-linejoin="round" stroke-linecap="round"/>`).join('');

    // 10% larger but still fits 400×400 — scale from base center (200,210)
    const svg = `
<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="City Builder HQ"
  style="width:100%;height:auto;display:block" shape-rendering="geometricPrecision">
<style>${cssVars}
  path,rect,circle{stroke-linejoin:round;stroke-linecap:round;shape-rendering:geometricPrecision}
</style>
<g transform="translate(200,210) scale(1.11) translate(-200,-210)">
<!-- BASE: wide foundational block -->
<g data-part="base">
  <!-- left wall -->
  <path d="M 80 210 L 200 270 L 200 320 L 80 260 Z"
    fill="var(--iso-wall-left)" stroke="var(--iso-outline)" stroke-width="3.5"/>
  <!-- right wall -->
  <path d="M 320 210 L 200 270 L 200 320 L 320 260 Z"
    fill="var(--iso-wall-right)" stroke="var(--iso-outline)" stroke-width="3.5"/>
  <!-- roof -->
  <path d="M 80 210 L 200 150 L 320 210 L 200 270 Z"
    fill="var(--iso-roof)" stroke="var(--iso-outline)" stroke-width="3.5"/>
</g>

<!-- GARAGES: oversized doors — simplified to door + single teal stripe (no separate awning band) -->
<g data-part="garage-left" transform="translate(96,238) matrix(1,-0.5,0,1,0,0)">
  <rect x="0" y="4" width="64" height="44" rx="2" fill="var(--iso-door)" stroke="var(--iso-outline)" stroke-width="3.5"/>
  <rect x="0" y="18" width="64" height="9" fill="var(--iso-orange)" stroke="var(--iso-outline)" stroke-width="1.2"/>
</g>
<g data-part="garage-right" transform="translate(232,238) matrix(1,0.5,0,1,0,0)">
  <rect x="0" y="4" width="64" height="44" rx="2" fill="var(--iso-door)" stroke="var(--iso-outline)" stroke-width="3.5"/>
  <rect x="0" y="18" width="64" height="9" fill="var(--iso-orange)" stroke="var(--iso-outline)" stroke-width="1.2"/>
</g>

<!-- LOWER ROOF AC UNIT -->
<g data-part="ac-unit">
  <path d="M 270 178 L 290 166 L 310 178 L 290 190 Z" fill="var(--iso-ac-top)" stroke="var(--iso-outline)" stroke-width="3.5"/>
  <path d="M 270 178 L 290 190 L 290 210 L 270 198 Z" fill="var(--iso-ac-side)" stroke="var(--iso-outline)" stroke-width="3.5"/>
  <path d="M 310 178 L 290 190 L 290 210 L 310 198 Z" fill="var(--iso-ac-dark)" stroke="var(--iso-outline)" stroke-width="3.5"/>
  <ellipse cx="290" cy="180" rx="8" ry="5" fill="var(--iso-outline)"/>
</g>

<!-- TOWER: tall chunky tower centered on base -->
<g data-part="tower">
  <path d="M 145 182.5 L 200 210 L 200 105 L 145 77.5 Z" fill="var(--iso-wall-left)" stroke="var(--iso-outline)" stroke-width="3.5"/>
  <path d="M 255 182.5 L 200 210 L 200 105 L 255 77.5 Z" fill="var(--iso-wall-right)" stroke="var(--iso-outline)" stroke-width="3.5"/>
  <path d="M 145 77.5 L 200 50 L 255 77.5 L 200 105 Z" fill="var(--iso-roof)" stroke="var(--iso-outline)" stroke-width="3.5"/>
</g>

<!-- WINDOWS -->
<g data-part="tower-windows-left" transform="translate(148,108) matrix(1,-0.5,0,1,0,0)">
  ${winLeftSVG}
</g>
<g data-part="tower-windows-right" transform="translate(242,108) matrix(1,0.5,0,1,0,0)">
  ${winRightSVG}
</g>

<!-- HELIPAD — overhanging dark -->
<g data-part="helipad">
  <path d="M 128 42 L 200 0 L 272 42 L 200 84 Z" fill="var(--iso-helipad)" stroke="var(--iso-outline)" stroke-width="3.5"/>
  <path d="M 128 42 L 200 84 L 200 94 L 128 52 Z" fill="#0F172A" stroke="var(--iso-outline)" stroke-width="3.5"/>
  <path d="M 200 84 L 272 42 L 272 52 L 200 94 Z" fill="#1E293B" stroke="var(--iso-outline)" stroke-width="3.5"/>
  <g transform="translate(200,47) scale(1,0.5)">
    <text x="0" y="8" text-anchor="middle" font-family="Baloo 2, system-ui" font-size="32" font-weight="900" fill="var(--iso-window-lit)" stroke="var(--iso-window-lit)" stroke-width="0.6">H</text>
  </g>
</g>

<!-- ANTENNA — thick mast + glowing beacon -->
<g data-part="antenna">
  <path d="M 156 58 L 162 58 L 162 12 L 156 12 Z" fill="var(--iso-outline)" stroke="var(--iso-outline)" stroke-width="3.5"/>
  <circle cx="159" cy="14" r="14" fill="var(--iso-beacon)" opacity="0.22"/>
  <circle cx="159" cy="14" r="9" fill="var(--iso-beacon)" stroke="var(--iso-outline)" stroke-width="3.5"/>
  <circle cx="157" cy="11.5" r="2.5" fill="white" opacity="0.9"/>
</g>

</g>

</svg>`;
    return svg;
  }

  return { build: build, getSVG: build };
})();
