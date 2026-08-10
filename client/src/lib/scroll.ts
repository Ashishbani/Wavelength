/**
 * Send the page back to the top.
 *
 * `html, body { height: 100% }` plus `overflow-x: hidden` makes <body> the
 * scroll container rather than the viewport, so `window.scrollTo` alone silently
 * does nothing and the previous screen's scroll position carries over. Reset
 * every candidate so this holds whichever element ends up scrolling.
 */
export function scrollToTop(): void {
  window.scrollTo(0, 0);
  document.body.scrollTop = 0;
  document.documentElement.scrollTop = 0;
}
