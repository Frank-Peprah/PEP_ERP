/**
 * Core components. Every screen is assembled from these; no screen styles its own buttons,
 * cards or badges. Pressables scale to 0.97 on press; nothing animates on keyboard actions.
 */
import { forwardRef, type ComponentProps, type ReactNode } from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './cn';

export const buttonStyles = cva(
  'pressable inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] font-semibold select-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-navy-900 text-white hover-lift',
        gold: 'bg-gold-500 text-navy-950',
        secondary: 'border border-line bg-surface text-ink hover-lift',
        ghost: 'text-ink-2 hover-row',
        danger: 'border border-line bg-surface text-loss-700 hover-lift',
        approve: 'bg-gain-600 text-white',
      },
      size: { sm: 'h-8 px-3 text-[12.5px]', md: 'h-10 px-4 text-[13.5px]', icon: 'size-10', 'icon-sm': 'size-8' },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);
type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonStyles> & { asChild?: boolean };
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, type, ...p }, ref) => {
  const Comp: any = asChild ? Slot.Root : 'button';
  return <Comp ref={ref} type={asChild ? undefined : type ?? 'button'} className={cn(buttonStyles({ variant, size }), className)} {...p} />;
});
Button.displayName = 'Button';

export function Card({ className, ...p }: ComponentProps<'section'>) {
  return <section className={cn('rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]', className)} {...p} />;
}
export function CardHeader({ title, action, className, id }: { title: ReactNode; action?: ReactNode; className?: string; id?: string }) {
  return (
    <header className={cn('flex items-center justify-between gap-3 px-5 pt-4', className)}>
      <h2 id={id} className="text-[14.5px] font-bold tracking-[-0.01em] text-ink">{title}</h2>
      {action}
    </header>
  );
}

const badgeTones = {
  neutral: 'bg-[#eef1f6] text-ink-2', gain: 'bg-gain-50 text-gain-700', loss: 'bg-loss-50 text-loss-700',
  warn: 'bg-warn-50 text-warn-700', action: 'bg-action-50 text-action-600', gold: 'bg-gold-50 text-gold-800',
} as const;
export function Badge({ tone = 'neutral', className, ...p }: ComponentProps<'span'> & { tone?: keyof typeof badgeTones }) {
  return <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold [&_svg]:size-3.5', badgeTones[tone], className)} {...p} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton h-4 w-full', className)} />;
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      {icon && <div className="mb-3 grid size-11 place-items-center rounded-full bg-navy-50 text-navy-800 [&_svg]:size-5">{icon}</div>}
      <p className="text-[14px] font-semibold text-ink">{title}</p>
      {children && <p className="mt-1 max-w-[52ch] text-[13px] text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="whitespace-nowrap rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10.5px] text-muted">{children}</kbd>;
}

export function Alert({ tone = 'warn', children, icon }: { tone?: 'warn' | 'loss' | 'gain' | 'action'; children: ReactNode; icon?: ReactNode }) {
  const t = { warn: 'bg-warn-50 text-[#8a4b05]', loss: 'bg-loss-50 text-[#8e1b1b]', gain: 'bg-gain-50 text-[#11632f]', action: 'bg-action-50 text-[#1d3f99]' }[tone];
  return <div role={tone === 'loss' ? 'alert' : 'status'} className={cn('flex items-start gap-2.5 rounded-[10px] px-3.5 py-3 text-[13px] [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0', t)}>{icon}{children}</div>;
}
