'use client';

import { motion, useReducedMotion } from 'motion/react';

export default function PageTransition({ children }) {
  const reducedMotion = useReducedMotion();

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reducedMotion ? 0 : 0.28, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}
