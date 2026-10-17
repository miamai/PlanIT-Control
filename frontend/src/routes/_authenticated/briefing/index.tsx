import { createFileRoute } from '@tanstack/react-router'
import { BriefingPage } from '@/features/briefing'

export const Route = createFileRoute('/_authenticated/briefing/')({
  component: BriefingPage,
})
