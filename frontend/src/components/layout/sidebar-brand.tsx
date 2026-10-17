import { RadioTower } from 'lucide-react'

export function SidebarBrand() {
  return (
    <div className='flex h-12 items-center gap-2 overflow-hidden rounded-md p-2 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:p-0'>
      <div className='flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground'>
        <RadioTower className='size-4' aria-hidden />
      </div>
      <div className='grid text-sm leading-tight group-data-[collapsible=icon]:sr-only'>
        <span className='truncate font-semibold'>PlanIT Control</span>
        <span className='truncate text-xs text-muted-foreground'>
          Control Center
        </span>
      </div>
    </div>
  )
}
