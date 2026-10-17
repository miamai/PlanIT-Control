import { Link } from '@tanstack/react-router'
import { usePreferencesStore } from '@/stores/preferences-store'
import { DELIVERY_CHANNELS } from '@/lib/notification-channels'
import { toastError, toastSuccess } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

export function NotificationsForm() {
  const preferences = usePreferencesStore((state) => state.notifications)
  const save = usePreferencesStore((state) => state.saveNotifications)

  function update(next: typeof preferences) {
    try {
      save(next)
      toastSuccess('Notification preferences saved on this browser')
    } catch {
      toastError(
        'Could not save preferences',
        'Browser storage is unavailable. Your changes have not been saved.'
      )
    }
  }

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between gap-4 rounded-lg border p-4'>
        <div className='space-y-1'>
          <Label htmlFor='alert-banners'>In-app alert banners</Label>
          <p
            id='alert-banners-description'
            className='text-sm leading-relaxed text-muted-foreground'
          >
            Show pop-up banners for new alerts and lightning countdown resets
            while this app is open.
          </p>
        </div>
        <Switch
          id='alert-banners'
          aria-describedby='alert-banners-description'
          checked={preferences.enabled}
          onCheckedChange={(enabled) => update({ ...preferences, enabled })}
        />
      </div>
      <div className='space-y-2'>
        <Label htmlFor='minimum-severity'>Minimum banner severity</Label>
        <select
          id='minimum-severity'
          value={preferences.minimumSeverity}
          disabled={!preferences.enabled}
          onChange={(event) =>
            update({
              ...preferences,
              minimumSeverity: event.target
                .value as typeof preferences.minimumSeverity,
            })
          }
          className='h-10 w-full rounded-md border bg-background px-3 text-sm disabled:opacity-50 sm:w-64'
        >
          <option value='critical'>Critical only</option>
          <option value='warning'>Warning and critical</option>
          <option value='info'>All severities</option>
        </select>
      </div>
      <p className='text-sm leading-relaxed text-muted-foreground'>
        These preferences affect optional banners only. All alerts and stop-work
        countdowns remain available in{' '}
        <Link
          to='/alerts'
          className='font-medium text-foreground underline underline-offset-4'
        >
          Alerts
        </Link>
        .
      </p>
      <Button
        variant='outline'
        disabled={!preferences.enabled}
        onClick={() =>
          toastSuccess(
            'Test notification',
            'In-app banners are enabled on this browser.'
          )
        }
      >
        Show test banner
      </Button>
      <section
        aria-labelledby='delivery-heading'
        className='space-y-3 border-t pt-5'
      >
        <h3 id='delivery-heading' className='text-sm font-semibold'>
          External delivery
        </h3>
        <dl className='divide-y rounded-lg border px-4'>
          {DELIVERY_CHANNELS.filter((channel) => channel.id !== 'in-app').map(
            (channel) => (
              <div
                key={channel.id}
                className='flex flex-wrap items-center justify-between gap-2 py-3 text-sm'
              >
                <dt>{channel.label}</dt>
                <dd className='text-muted-foreground'>
                  {channel.available ? 'Available' : 'Not connected'}
                </dd>
              </div>
            )
          )}
        </dl>
        <p className='text-xs leading-relaxed text-muted-foreground'>
          External delivery is unavailable in this demo. Saving these
          preferences does not subscribe you to SMS, email, or browser push.
        </p>
      </section>
    </div>
  )
}
