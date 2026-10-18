import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { deleteHazardReport, updateHazardReport } from '@/api'
import { ApiError } from '@/api/client'
import { type HazardReport } from '@/api/types'
import { hasRole, useAuthStore } from '@/stores/auth-store'
import { toastSuccess } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/confirm-dialog'

export function ReportControls({ report }: { report: HazardReport }) {
  const user = useAuthStore((state) => state.auth.user)
  return hasRole(user, 'admin') ? <AdminReportControls report={report} /> : null
}

function AdminReportControls({ report }: { report: HazardReport }) {
  const client = useQueryClient()
  const [action, setAction] = useState<'edit' | 'delete' | null>(null)
  const [note, setNote] = useState(report.note)
  const mutation = useMutation({
    mutationFn: async () => {
      if (action === 'edit')
        await updateHazardReport({ reportId: report.id, note: note.trim() })
      else if (action === 'delete') await deleteHazardReport(report.id)
    },
    onSuccess: async () => {
      setAction(null)
      toastSuccess('Report updated')
      // Wildlife reports may have been shared with several nearby sites.
      await Promise.all(
        ['hazard-reports', 'site', 'alerts', 'rankings', 'briefings'].map(
          (key) => client.invalidateQueries({ queryKey: [key] })
        )
      )
    },
  })
  function open(next: 'edit' | 'delete') {
    mutation.reset()
    setNote(report.note)
    setAction(next)
  }
  return (
    <>
      <div className='flex flex-wrap gap-2'>
        <Button size='sm' variant='ghost' onClick={() => open('edit')}>
          Edit report
        </Button>
        <Button
          size='sm'
          variant='ghost'
          className='text-destructive'
          onClick={() => open('delete')}
        >
          Delete report
        </Button>
      </div>
      <ConfirmDialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setAction(null)
        }}
        title={action === 'edit' ? 'Edit report' : 'Delete report?'}
        desc={
          action === 'edit'
            ? 'Correct the report description. The original hazard type, location and report time are preserved.'
            : 'This permanently removes the report and its shared wildlife observations. Alerts created from those observations will be resolved; their transition history is retained.'
        }
        confirmText={action === 'edit' ? 'Save changes' : 'Delete report'}
        destructive={action === 'delete'}
        isLoading={mutation.isPending}
        disabled={
          action === 'edit' &&
          (note.trim().length < 3 || note.trim() === report.note)
        }
        handleConfirm={() => mutation.mutate()}
      >
        {action === 'edit' ? (
          <div className='space-y-2'>
            <Label htmlFor={`report-note-${report.id}`}>
              Report description
            </Label>
            <Textarea
              id={`report-note-${report.id}`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={2000}
              disabled={mutation.isPending}
            />
          </div>
        ) : null}
        {mutation.isError ? (
          <p role='alert' className='text-sm text-destructive'>
            {mutation.error instanceof ApiError
              ? mutation.error.detail || mutation.error.message
              : 'Could not update this report. Please try again.'}
          </p>
        ) : null}
      </ConfirmDialog>
    </>
  )
}
