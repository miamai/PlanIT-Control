import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  profileSchema,
  usePreferencesStore,
  type LocalProfile,
} from '@/stores/preferences-store'
import { toastError, toastSuccess } from '@/lib/toast'
import { useProfile } from '@/hooks/use-profile'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

export function ProfileForm() {
  const profile = useProfile()
  const saveProfile = usePreferencesStore((state) => state.saveProfile)
  const form = useForm<LocalProfile>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: profile.name, bio: profile.bio },
  })

  function onSubmit(data: LocalProfile) {
    try {
      saveProfile(profile.email, data)
      form.reset(data)
      toastSuccess('Profile saved on this browser')
    } catch {
      toastError(
        'Could not save profile',
        'Browser storage is unavailable. Your changes have not been saved.'
      )
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-6'>
        <FormField
          control={form.control}
          name='name'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Display name</FormLabel>
              <FormControl>
                <Input autoComplete='name' {...field} />
              </FormControl>
              <FormDescription>
                Used in the account menus and as the default reporter name for
                new hazard reports.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='bio'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Bio</FormLabel>
              <FormControl>
                <Textarea
                  rows={3}
                  placeholder='Your field experience or responsibilities (optional)'
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Optional profile note. Up to 160 characters.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <p className='text-xs leading-relaxed text-muted-foreground'>
          Saved only on this browser for {profile.email}. Profile sync across
          devices is not connected.
        </p>
        <Button type='submit'>Save profile</Button>
      </form>
    </Form>
  )
}
