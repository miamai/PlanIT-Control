import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function CardActions({
  to,
  label = 'View all',
}: {
  to: '/hazards' | '/alerts' | '/briefing' | '/sites'
  label?: string
}) {
  return (
    <Button
      asChild
      variant='ghost'
      size='sm'
      className='h-7 gap-1 px-2 text-xs'
    >
      <Link to={to}>
        {label}
        <ArrowRight className='size-3.5' />
      </Link>
    </Button>
  )
}
