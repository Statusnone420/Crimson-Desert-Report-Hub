'use client';
import {motion, useScroll, useReducedMotion} from 'motion/react';

export default function ReadingMotion() {
  const {scrollYProgress} = useScroll();
  const reducedMotion = useReducedMotion();
  return reducedMotion ? null : <motion.div aria-hidden="true" className="reading-progress" style={{scaleX:scrollYProgress}} />;
}
