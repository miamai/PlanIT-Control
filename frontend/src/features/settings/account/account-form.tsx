import { useState } from 'react'
import { useProfile } from '@/hooks/use-profile'
import { Button } from '@/components/ui/button'
import { SignOutDialog } from '@/components/sign-out-dialog'

export function AccountForm() {
  const profile = useProfile()
  const [signOutOpen, setSignOutOpen] = useState(false)
  return (
    <div className='space-y-6'>
      <dl className='divide-y rounded-lg border px-4'>
        {[
          ['Username', profile.username],
          ['Role', profile.roleLabel],
          ['Interface language', 'English'],
          ['Session', 'Signed in · renews automatically'],
        ].map(([label, value]) => (
          <div
            key={label}
            className='grid gap-1 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4'
          >
            <dt className='text-sm text-muted-foreground'>{label}</dt>
            <dd className='text-sm font-medium break-words'>{value}</dd>
          </div>
        ))}
      </dl>
      <p className='text-sm leading-relaxed text-muted-foreground'>
        Accounts and roles are managed by a Precognition administrator. The interface
        is currently available in English only.
      </p>
      <Button variant='outline' onClick={() => setSignOutOpen(true)}>
        Sign out
      </Button>
      <SignOutDialog open={signOutOpen} onOpenChange={setSignOutOpen} />
    </div>
  )
}
