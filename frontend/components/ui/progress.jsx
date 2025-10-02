'use client';

import * as React from 'react';

import { cn } from '../../lib/utils.js';

const Progress = React.forwardRef(({ className, value = 0, max = 100, indicatorClassName, ...props }, ref) => {
  const clamped = Math.min(Math.max(value, 0), max);
  const percentage = max === 0 ? 0 : (clamped / max) * 100;

  return (
    <div
      ref={ref}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      {...props}
    >
      <div
        className={cn('h-full w-full origin-left rounded-full bg-primary transition-all', indicatorClassName)}
        style={{ transform: `scaleX(${percentage / 100})` }}
      />
    </div>
  );
});
Progress.displayName = 'Progress';

export { Progress };
