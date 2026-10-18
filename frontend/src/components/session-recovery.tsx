import { useRouter } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'

/** A service outage must not send a still-valid cookie back to sign-in. */
export function SessionRecovery() {
  const router = useRouter()
  return (
    <main className='mx-auto max-w-lg space-y-4 p-8'>
      <h1 className='text-xl font-semibold'>Unable to load your workspace</h1>
      <p className='text-sm text-muted-foreground'>
        The service may be temporarily unavailable. Check your connection and
        try again.
      </p>
      <Button onClick={() => void router.invalidate()}>Try again</Button>
    </main>
  )
}
