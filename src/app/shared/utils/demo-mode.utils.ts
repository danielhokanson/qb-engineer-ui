import { environment } from '../../../environments/environment';

/**
 * Initialize demo-mode tells that don't belong in a component template:
 *   • `[DEMO]` prefix on the document title (obvious).
 *   • Zero-width joiner appended after the title (subtle — copy/paste tell).
 *   • `<html data-demo="true">` (subtle — inspectable attribute).
 *   • Styled console banner (obvious to anyone with devtools open).
 *
 * Must be called exactly once, as early as AppComponent can do it. Guards
 * itself with `environment.demoMode` so calling in non-demo builds is a no-op.
 */
export function initDemoMode(): void {
  if (!environment.demoMode) return;

  try {
    document.documentElement.setAttribute('data-demo', 'true');
  } catch { /* ssr-only paths */ }

  try {
    const base = document.title || 'QB Engineer';
    // Zero-width joiner (U+200D) is invisible in rendered text but shows up in
    // copy/paste and HTML source — a quiet way to verify a screenshot's origin.
    const ZWJ = '\u200D';
    document.title = `[DEMO] ${base}${ZWJ}`;
  } catch { /* defensive */ }

  // Keep the prefix sticky — Angular Router / feature code updates document.title
  // on navigation. Observe and re-apply.
  try {
    const titleEl = document.querySelector('title');
    if (titleEl) {
      const ZWJ = '\u200D';
      const observer = new MutationObserver(() => {
        const current = document.title;
        if (!current.startsWith('[DEMO]')) {
          document.title = `[DEMO] ${current}${ZWJ}`;
        }
      });
      observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
    }
  } catch { /* defensive */ }

  try {
     
    console.log(
      '%cQB Engineer · DEMO MODE',
      'background:#ffc107;color:#7a4a00;padding:6px 14px;font:600 14px monospace;border-radius:2px;',
    );
     
    console.log(
      '%cNot production data. All changes are local to this browser tab and reset on refresh.',
      'color:#7a4a00;font:12px monospace;',
    );
  } catch { /* defensive */ }

  swapFavicon();
}

/**
 * Swap the bare favicon.ico link for an inline SVG that paints a tiny amber
 * "D" badge over the base QB mark. Runtime swap (vs a separate binary file)
 * keeps the demo build from needing an extra asset and guarantees the tell
 * shows up even if a reverse proxy rewrites asset paths.
 */
function swapFavicon(): void {
  try {
    const svg = `
<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>
  <rect width='64' height='64' fill='#0d9488'/>
  <text x='32' y='42' text-anchor='middle' font-family='monospace' font-size='34' font-weight='700' fill='#fff'>Q</text>
  <rect x='36' y='36' width='26' height='26' fill='#ffc107'/>
  <text x='49' y='57' text-anchor='middle' font-family='monospace' font-size='22' font-weight='800' fill='#7a4a00'>D</text>
</svg>`.trim();
    const href = 'data:image/svg+xml;base64,' + btoa(svg);

    // Remove any existing icon links so the browser picks up ours.
    document.querySelectorAll("link[rel~='icon']").forEach(el => el.remove());

    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    link.href = href;
    document.head.appendChild(link);
  } catch { /* defensive */ }
}
