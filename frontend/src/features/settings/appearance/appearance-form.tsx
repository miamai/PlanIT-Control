import { fonts } from '@/config/fonts'
import { useFont } from '@/context/font-provider'
import { useTheme } from '@/context/theme-provider'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

export function AppearanceForm() {
  const { font, setFont } = useFont()
  const { theme, setTheme } = useTheme()
  return (
    <div className='space-y-6'>
      <fieldset className='space-y-3'>
        <legend className='text-sm font-medium'>Theme</legend>
        <RadioGroup
          value={theme}
          onValueChange={(value) => setTheme(value as typeof theme)}
          className='grid gap-2 sm:grid-cols-3'
          aria-label='Theme'
        >
          {(['light', 'dark', 'system'] as const).map((value) => (
            <label
              key={value}
              className='flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 focus-within:ring-2 focus-within:ring-ring/50 has-[[data-state=checked]]:border-foreground/50 has-[[data-state=checked]]:bg-muted'
            >
              <RadioGroupItem
                value={value}
                aria-label={value.charAt(0).toUpperCase() + value.slice(1)}
              />
              <span className='text-sm capitalize'>{value}</span>
            </label>
          ))}
        </RadioGroup>
      </fieldset>
      <div className='space-y-2'>
        <Label htmlFor='appearance-font'>Font</Label>
        <select
          id='appearance-font'
          value={font}
          onChange={(event) => setFont(event.target.value as typeof font)}
          className='h-10 w-full rounded-md border bg-background px-3 text-sm capitalize outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:w-64'
        >
          {fonts.map((value) => (
            <option key={value} value={value}>
              {value === 'system'
                ? 'System default'
                : value === 'inter'
                  ? 'Inter'
                  : 'Manrope'}
            </option>
          ))}
        </select>
      </div>
      <p role='status' className='text-xs text-muted-foreground'>
        Changes apply immediately and are saved on this browser.
      </p>
    </div>
  )
}
