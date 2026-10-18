import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { updateAlertStatus } from '@/api'
import { ApiError } from '@/api/client'
import { type Alert } from '@/api/types'
import { hasRole, useAuthStore } from '@/stores/auth-store'
import { toastSuccess } from '@/lib/toast'
import { planitKeys, useCountdown } from '@/hooks/use-planit'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/confirm-dialog'

export function AlertControls({ alert }: { alert: Alert }) {
  const user = useAuthStore((state) => state.auth.user)
  return hasRole(user, 'admin') && alert.status !== 'resolved' ? (
    <AdminAlertControls alert={alert} />
  ) : null
}

function AdminAlertControls({ alert }: { alert: Alert }) {
  const client = useQueryClient()
  const [action, setAction] = useState<'ACKNOWLEDGED' | 'RESOLVED' | null>(null)
  const [reason, setReason] = useState('')
  const remaining = useCountdown(alert.allClearAt)
  const lightningStop =
    alert.type === 'lightning' && alert.actionCode === 'STOP_WORK'
  // Countdown alone never grants eligibility. The server must have advanced
  // the alert, and checks it again under lock when the admin confirms.
  const canResolve =
    !lightningStop ||
    (alert.status === 'all-clear' && !!alert.allClearAt && remaining <= 0)
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: planitKeys.alerts }),
      client.invalidateQueries({ queryKey: planitKeys.site(alert.siteId) }),
      client.invalidateQueries({ queryKey: planitKeys.rankings }),
      client.invalidateQueries({ queryKey: planitKeys.briefings }),
    ])
  }
  const mutation = useMutation({
    mutationFn: updateAlertStatus,
    onSuccess: async () => {
      setAction(null)
      setReason('')
      toastSuccess('Alert updated')
      await refresh()
    },
    onError: () => {
      void refresh()
    },
  })
  function open(next: 'ACKNOWLEDGED' | 'RESOLVED') {
    mutation.reset()
    setReason('')
    setAction(next)
  }
  return (
    <>
      <div className='flex flex-wrap items-center gap-2 pt-2'>
        {!alert.acknowledged && alert.status !== 'all-clear' ? (
          <Button
            variant='outline'
            size='sm'
            onClick={() => open('ACKNOWLEDGED')}
          >
            Acknowledge
          </Button>
        ) : null}
        {alert.acknowledged ? (
          <span className='text-xs text-muted-foreground'>Acknowledged</span>
        ) : null}
        <Button
          variant='outline'
          size='sm'
          disabled={!canResolve}
          onClick={() => open('RESOLVED')}
        >
          {lightningStop ? 'Sign off & clear' : 'Resolve alert'}
        </Button>
        {lightningStop && !canResolve ? (
          <span className='text-xs text-muted-foreground'>
            Waiting for server all-clear eligibility
          </span>
        ) : null}
      </div>
      <ConfirmDialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setAction(null)
        }}
        title={
          action === 'ACKNOWLEDGED'
            ? 'Acknowledge alert'
            : lightningStop
              ? 'Sign off & clear lightning alert'
              : 'Resolve alert'
        }
        desc={
          action === 'ACKNOWLEDGED'
            ? 'Record that you reviewed this alert. Work restrictions remain in effect.'
            : 'Confirm your review of site conditions and record the reason for closing this alert.'
        }
        confirmText={
          action === 'ACKNOWLEDGED' ? 'Acknowledge' : 'Confirm & clear'
        }
        isLoading={mutation.isPending}
        disabled={
          reason.trim().length < 3 || (action === 'RESOLVED' && !canResolve)
        }
        handleConfirm={() => {
          if (
            action &&
            reason.trim().length >= 3 &&
            (action !== 'RESOLVED' || canResolve)
          )
            mutation.mutate({
              alertId: alert.id,
              status: action,
              reason: reason.trim(),
            })
        }}
      >
        <div className='space-y-2'>
          <Label htmlFor={`alert-reason-${alert.id}`}>Review reason</Label>
          <Textarea
            id={`alert-reason-${alert.id}`}
            value={reason}
            maxLength={1000}
            onChange={(event) => setReason(event.target.value)}
            disabled={mutation.isPending}
          />
          {mutation.isError ? (
            <p role='alert' className='text-sm text-destructive'>
              {mutation.error instanceof ApiError
                ? mutation.error.detail || mutation.error.message
                : 'Could not update this alert. Please try again.'}
            </p>
          ) : null}
        </div>
      </ConfirmDialog>
    </>
  )
}
