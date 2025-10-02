'use client';

import { Alert, AlertDescription, AlertTitle } from './ui/alert.jsx';

export default function ErrorBanner({ title, message, hint }) {
  if (!title && !message) return null;

  return (
    <Alert variant="destructive" className="my-4">
      {title && <AlertTitle>{title}</AlertTitle>}
      <AlertDescription>
        {message}
        {hint && <span className="mt-2 block text-xs text-destructive-foreground/80">Hint: {hint}</span>}
      </AlertDescription>
    </Alert>
  );
}
