import { toast } from 'sonner'

export function toastSuccess(title: string, description?: string) {
  toast.success(title, { description })
}

export function toastError(title: string, description?: string) {
  toast.error(title, { description })
}

export { toast }
