import { createFileRoute } from '@tanstack/react-router'
import { Hazards } from '@/features/hazards'

export const Route = createFileRoute('/_authenticated/hazards/')({
  component: Hazards,
})
