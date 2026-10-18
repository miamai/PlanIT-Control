import { Logo } from '@/assets/logo'

export function SidebarBrand() {
  return (
    <div className='flex h-12 items-center gap-2 overflow-hidden rounded-md p-2 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:p-0'>
      <Logo alt='' />
      <div className='grid text-sm leading-tight group-data-[collapsible=icon]:sr-only'>
        <span className='truncate font-semibold'>Precognition</span>
        <span className='truncate text-xs text-muted-foreground'>
          Control Center
        </span>
      </div>
    </div>
  )
}
