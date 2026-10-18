import { type ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Logo({
  className,
  ...props
}: Omit<ComponentProps<'img'>, 'src'>) {
  return (
    <img
      src='/images/planit-icon.png'
      alt='Precognition'
      height={32}
      width={32}
      className={cn('size-8 shrink-0 object-contain', className)}
      {...props}
    />
  )
}
