import React from 'react';
import { cn } from '@/lib/utils';

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("relative flex items-center justify-center", className)}>
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="text-primary shadow-sm drop-shadow-sm"
      >
        <rect width="32" height="32" rx="8" fill="currentColor" />
        {/* Stylized Arrow / Greater Than Symbol */}
        <path
          d="M9 8.5L25 16L9 23.5L13.5 16L9 8.5Z"
          className="fill-primary-foreground"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
