import React from 'react';
import { cn } from '@/lib/utils';

export function Logo({ className }: { className?: string }) {
  return (
    <img
      src="/roots.png"
      alt="Root"
      className={cn("object-contain", className)}
    />
  );
}
