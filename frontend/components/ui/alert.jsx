'use client';

import * as React from 'react';

import { cn } from '../../lib/utils.js';

const alertVariants = {
  default: 'border-border/60 text-foreground',
  destructive: 'border-destructive/60 text-destructive-foreground bg-destructive/10',
  warning: 'border-amber-500/50 text-amber-100 bg-amber-500/10',
  info: 'border-accent/40 text-accent-foreground bg-accent/10',
  success: 'border-emerald-500/50 text-emerald-100 bg-emerald-500/10'
};

const Alert = React.forwardRef(({ className, variant = 'default', ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn('relative w-full rounded-lg border px-4 py-3 pr-10 text-sm', alertVariants[variant], className)}
    {...props}
  />
));
Alert.displayName = 'Alert';

const AlertTitle = React.forwardRef(({ className, ...props }, ref) => (
  <h5 ref={ref} className={cn('mb-1 text-sm font-semibold uppercase tracking-wide', className)} {...props} />
));
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('text-sm opacity-90', className)} {...props} />
));
AlertDescription.displayName = 'AlertDescription';

export { Alert, AlertTitle, AlertDescription };
