'use client';

import { Alert } from './ui/alert.jsx';

const variantMap = {
  error: 'destructive',
  warning: 'warning',
  info: 'info'
};

export default function GlobalAlert({ type = 'info', message }) {
  if (!message) return null;

  const variant = variantMap[type] || 'info';

  return (
    <Alert variant={variant} className="mb-4 font-semibold">
      {message}
    </Alert>
  );
}
