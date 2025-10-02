'use client';

import * as React from 'react';
import { cva } from 'class-variance-authority';

import { cn } from '../../lib/utils.js';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border border-transparent px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-secondary text-secondary-foreground border-secondary/40',
        outline: 'border-border/60 text-foreground bg-transparent',
        success: 'bg-emerald-500/20 text-emerald-100 border-emerald-500/50',
        warning: 'bg-amber-500/20 text-amber-100 border-amber-500/40',
        destructive: 'bg-destructive/20 text-destructive-foreground border-destructive/50'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
);

const Badge = React.forwardRef(({ className, variant, ...props }, ref) => (
  <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
));
Badge.displayName = 'Badge';

export { Badge, badgeVariants };
