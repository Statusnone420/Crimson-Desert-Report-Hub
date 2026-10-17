'use client';

import { motion, useReducedMotion } from 'motion/react';

export default function PageTransition({ children }) {
  const reducedMotion = useReducedMotion();

  return (
    <motion.div
      // Server-rendered reading must remain visible if JavaScript is delayed
      // or unavailable. Never hide the whole page behind hydration.
      initial={false}
      animate={{ opacity: 1 }}
      transition={{ duration: reducedMotion ? 0 : 0.28, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}
