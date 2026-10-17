import { useLayout } from '@/context/layout-provider'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

const selectClass =
  'h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:w-64'

export function DisplayForm() {
  const { variant, setVariant, collapsible, setCollapsible, resetLayout } =
    useLayout()
  return (
    <div className='space-y-6'>
      <div className='space-y-2'>
        <Label htmlFor='sidebar-style'>Sidebar style</Label>
        <select
          id='sidebar-style'
          className={selectClass}
          value={variant}
          onChange={(event) => setVariant(event.target.value as typeof variant)}
        >
          <option value='inset'>Inset</option>
          <option value='sidebar'>Sidebar</option>
          <option value='floating'>Floating</option>
        </select>
      </div>
      <div className='space-y-2'>
        <Label htmlFor='sidebar-collapse'>Sidebar collapse behavior</Label>
        <select
          id='sidebar-collapse'
          className={selectClass}
          value={collapsible}
          onChange={(event) =>
            setCollapsible(event.target.value as typeof collapsible)
          }
        >
          <option value='icon'>Collapse to icons</option>
          <option value='offcanvas'>Hide completely</option>
          <option value='none'>Always expanded</option>
        </select>
        <p className='text-xs leading-relaxed text-muted-foreground'>
          Collapse behavior applies on desktop. Mobile navigation uses a drawer.
        </p>
      </div>
      <p role='status' className='text-xs text-muted-foreground'>
        Changes apply immediately and are saved on this browser.
      </p>
      <Button variant='outline' onClick={resetLayout}>
        Reset layout
      </Button>
    </div>
  )
}
