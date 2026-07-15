// Barrel for the dashboard motion layer. Components import `motion`, `AnimatePresence`, the
// `useReducedMotion` gate, and the shared presets from here so the wiring stays in one place.
export { motion, AnimatePresence } from 'motion/react';
export { useReducedMotion, resolveReducedMotion } from './reduced-motion';
export { rise, listItem, word, tick } from './presets';
