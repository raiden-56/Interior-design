import * as React from 'react';
import { cn } from '@/lib/cn';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'h-7 w-full rounded-md border border-zinc-700 bg-zinc-900/70 px-2 text-xs text-zinc-100 focus:border-sky-500 focus:outline-none focusable no-select',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';

export const Label = ({ className, children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
  <label className={cn('mb-1 block text-[11px] font-medium tracking-wide text-zinc-400', className)} {...props}>
    {children}
  </label>
);