import { useId, useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { type Site } from '@/api/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

/** Search the complete paginated API result; no separate seeded catalog. */
export function SiteCombobox({
  sites,
  value,
  onChange,
  disabled,
}: {
  sites: Site[]
  value: string
  onChange: (id: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const selected = sites.find((site) => site.id === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant='outline'
          role='combobox'
          aria-label='Site'
          aria-expanded={open}
          aria-controls={listId}
          disabled={disabled}
          className='h-auto min-h-9 w-full justify-between whitespace-normal sm:max-w-lg'
        >
          <span className='text-start'>
            {selected
              ? `${selected.name} · ${selected.state}`
              : 'Select a site…'}
          </span>
          <ChevronsUpDown className='ms-2 size-4 shrink-0 opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align='start'
        className='w-[var(--radix-popover-trigger-width)] p-0'
      >
        <Command>
          <CommandInput
            placeholder='Search name, state, county or plant ID…'
            aria-label='Search sites'
          />
          <CommandList id={listId}>
            <CommandEmpty>No matching sites.</CommandEmpty>
            <CommandGroup>
              {sites.map((site) => (
                <CommandItem
                  key={site.id}
                  value={site.id}
                  keywords={[
                    site.name,
                    site.state,
                    site.county,
                    site.eiaPlantId,
                  ]}
                  onSelect={() => {
                    onChange(site.id)
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn(
                      'size-4 shrink-0',
                      value === site.id ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span className='min-w-0 break-words'>
                    {site.name} · {site.state}
                    <span className='block text-xs text-muted-foreground'>
                      {site.county} · Plant {site.eiaPlantId}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          <p className='border-t px-3 py-2 text-xs text-muted-foreground'>
            {sites.length} sites loaded
          </p>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
