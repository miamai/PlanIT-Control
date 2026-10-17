import { createFileRoute } from '@tanstack/react-router'
import { Sites } from '@/features/sites'

export const Route = createFileRoute('/_authenticated/sites/')({
  component: Sites,
})
