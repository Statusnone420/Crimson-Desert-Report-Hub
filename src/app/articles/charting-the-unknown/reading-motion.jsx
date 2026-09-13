'use client';
import {motion, useScroll} from 'motion/react';

export default function ReadingMotion() {
  const {scrollYProgress} = useScroll();
  return <motion.div aria-hidden="true" className="reading-progress" style={{scaleX:scrollYProgress}} />;
}
