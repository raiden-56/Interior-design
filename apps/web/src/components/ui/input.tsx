import * as React from 'react';
import { cn } from '@/lib/cn';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-7 w-full rounded-md border border-zinc-700 bg-zinc-900/70 px-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-sky-500 focus:outline-none focusable',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';