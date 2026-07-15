// Landing-page motion (task 4j). GSAP + ScrollTrigger drive: a sticky-nav shadow, a hero
// raw-speech → formatted-text demo (typewriter + format-resolve), a breathing hero illustration,
// once-only scroll reveals, and a before/after panel wipe.
//
// Progressive enhancement is the rule: the HTML ships fully readable. When motion runs we only ever
// animate FROM a hidden state back TO the natural DOM state (gsap.from / fromTo), and every hidden
// start-state is applied in JS — so no-JS and prefers-reduced-motion users always see real content.
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

const RM_QUERY = '(prefers-reduced-motion: reduce)';
const EASE = 'power2.out';

/**
 * Pure resolver for the reduced-motion decision. Fails safe to REDUCED (true) whenever the platform
 * can't tell us — so we never hide content we can't guarantee we'll reveal.
 */
export function prefersReducedMotion(win: Window | undefined): boolean {
  if (!win || typeof win.matchMedia !== 'function') return true;
  try {
    return win.matchMedia(RM_QUERY).matches;
  } catch {
    return true;
  }
}

/** Sticky-header shadow: a state toggle (not movement), so it runs regardless of motion preference. */
function initStickyNav(): void {
  const header = document.querySelector<HTMLElement>('.site-header');
  if (!header) return;
  const sync = (): void => {
    header.classList.toggle('is-scrolled', window.scrollY > 8);
  };
  window.addEventListener('scroll', sync, { passive: true });
  sync();
}

/** Hero demo: type the raw utterance, then resolve it into the formatted sentence, and loop. */
function initHeroDemo(): void {
  const el = document.querySelector<HTMLElement>('[data-demo-text]');
  const raw = el?.dataset.demoRaw;
  const final = el?.dataset.demoFinal;
  if (!el || !raw || !final) return;

  const state = { n: 0 };
  const tl = gsap.timeline({ repeat: -1, repeatDelay: 2.4 });
  tl.set(el, { autoAlpha: 1 })
    .add(() => {
      el.textContent = '';
    })
    .set(state, { n: 0 })
    .to(state, {
      n: raw.length,
      duration: Math.min(2.6, raw.length * 0.028),
      ease: 'none',
      onUpdate: () => {
        el.textContent = raw.slice(0, Math.round(state.n));
      },
    })
    .to(el, { autoAlpha: 0, duration: 0.28, ease: 'power1.in', delay: 0.9 })
    .add(() => {
      el.textContent = final;
    })
    .to(el, { autoAlpha: 1, duration: 0.36, ease: EASE });
}

/** Breathing hero illustration: the speech wave swells, and the typeset lines resolve in once. */
function initHeroArt(): void {
  const art = document.querySelector<SVGElement>('[data-hero-art]');
  if (!art) return;
  const wave = art.querySelector<SVGElement>('[data-layer="wave"]');
  const lines = art.querySelectorAll<SVGElement>('[data-layer="lines"] > *');

  if (wave) {
    gsap.to(wave, {
      scaleY: 1.14,
      transformOrigin: '50% 50%',
      duration: 2.6,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
    });
  }
  if (lines.length > 0) {
    gsap.from(lines, {
      opacity: 0,
      x: -10,
      duration: 0.5,
      ease: EASE,
      stagger: 0.12,
      scrollTrigger: { trigger: art, start: 'top 80%', once: true },
    });
  }
}

/** Once-only, short (200–400ms) reveals for anything tagged `.reveal`. */
function initScrollReveals(): void {
  const targets = gsap.utils.toArray<HTMLElement>('.reveal');
  targets.forEach((el) => {
    gsap.from(el, {
      opacity: 0,
      y: 20,
      duration: 0.4,
      ease: EASE,
      scrollTrigger: { trigger: el, start: 'top 85%', once: true },
    });
  });
}

/** Before/after: the "what Undertone types" card wipes in from the left when the pair scrolls in. */
function initCompareWipe(): void {
  const out = document.querySelector<HTMLElement>('.compare__card--out');
  const compare = document.querySelector<HTMLElement>('.compare');
  if (!out || !compare) return;
  gsap.fromTo(
    out,
    { clipPath: 'inset(0 100% 0 0)' },
    {
      clipPath: 'inset(0 0% 0 0)',
      duration: 0.6,
      ease: EASE,
      scrollTrigger: { trigger: compare, start: 'top 75%', once: true },
    },
  );
}

/** Wire every landing animation. Safe to call on any page; each piece no-ops when its nodes absent. */
export function initAnimations(win: Window = window): void {
  initStickyNav(); // shadow-on-scroll is a state, not motion — always on.

  if (prefersReducedMotion(win)) return; // everything below is gated: content stays static + visible.

  gsap.registerPlugin(ScrollTrigger);
  initHeroDemo();
  initHeroArt();
  initScrollReveals();
  initCompareWipe();
}
