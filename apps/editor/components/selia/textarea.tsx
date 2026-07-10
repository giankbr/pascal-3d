'use client';

import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

export const textareaVariants = cva(
  [
    'w-full resize-none px-3.5 py-3 text-foreground placeholder:text-dimmed transition-[box-shadow,background-color] duration-150 ease-out rounded-xl',
    'ring ring-input-border hover:not-[[disabled],[data-disabled]]:not-[:focus]:ring-input-accent-border focus:outline-0 focus:ring-primary focus:ring-2 min-h-28',
    'disabled:opacity-70 disabled:cursor-not-allowed',
  ],
  {
    variants: {
      variant: {
        default: 'bg-input',
        subtle: 'bg-accent/70',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export function Textarea({
  className,
  variant,
  ...props
}: React.ComponentProps<'textarea'> & VariantProps<typeof textareaVariants>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(textareaVariants({ variant, className }))}
      {...props}
    />
  );
}