import * as React from 'react';
import { cn } from '@/lib/cn';

type Variant = 'default' | 'secondary' | 'ghost' | 'outline' | 'destructive' | 'tool';
type Size = 'sm' | 'md' | 'icon' | 'icon-sm' | 'xs';

const variants: Record<Variant, string> = {
  default: 'bg-sky-600 text-white hover:bg-sky-500 shadow-sm',
  secondary: 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700 border border-zinc-700/60',
  ghost: 'text-zinc-300 hover:bg-zinc-800 hover:text-white',
  outline: 'border border-zinc-700 text-zinc-200 hover:bg-zinc-800',
  destructive: 'bg-red-600/90 text-white hover:bg-red-500',
  tool: 'text-zinc-400 hover:text-zinc-100 data-[active=true]:bg-sky-500/20 data-[active=true]:text-sky-300 border border-transparent data-[active=true]:border-sky-500/40',
};

const sizes: Record<Size, string> = {
  xs: 'h-6 px-1.5 text-[11px] gap-1 rounded-md',
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  md: 'h-8 px-3 text-sm gap-2 rounded-lg',
  icon: 'h-8 w-8 rounded-md',
  'icon-sm': 'h-7 w-7 rounded-md',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  'data-active'?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'secondary', size = 'sm', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex cursor-pointer items-center justify-center font-medium transition-colors focusable disabled:pointer-events-none disabled:opacity-40 no-select',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = 'Button';