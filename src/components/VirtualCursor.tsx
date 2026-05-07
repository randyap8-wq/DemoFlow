/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion } from 'motion/react';
import { MousePointer2 } from 'lucide-react';

interface VirtualCursorProps {
  x: number;
  y: number;
  isClicking?: boolean;
}

export function VirtualCursor({ x, y, isClicking }: VirtualCursorProps) {
  return (
    <motion.div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        zIndex: 50,
        pointerEvents: 'none',
      }}
      animate={{
        x: `${x}%`,
        y: `${y}%`,
        scale: isClicking ? 0.8 : 1,
      }}
      transition={{
        type: 'spring',
        // Tuned for fast convergence: with these params the spring settles
        // within ~1–2 frames at 60 fps, so the visible cursor position stays
        // in lock-step with the logical click point used to trigger the
        // ripple. Looser springs (lower stiffness / higher mass) noticeably
        // undershoot for fast click keyframes and put the visual click out
        // of sync with the keyframe.
        damping: 40,
        stiffness: 400,
        mass: 0.3
      }}
    >
      <div className="relative">
        <MousePointer2 
          className="text-brand drop-shadow-[0_0_8px_rgba(0,255,194,0.5)] fill-black" 
          size={24} 
        />
        {isClicking && (
          <motion.div
            initial={{ scale: 0, opacity: 1 }}
            animate={{ scale: 3, opacity: 0 }}
            className="absolute top-0 left-0 w-6 h-6 border-2 border-brand rounded-full"
            style={{ x: -8, y: -8 }}
          />
        )}
      </div>
    </motion.div>
  );
}
