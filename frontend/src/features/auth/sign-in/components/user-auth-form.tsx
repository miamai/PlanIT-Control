import { useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { ArrowRight, Loader2, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { login } from '@/api/auth'
import { ApiError } from '@/api/client'
import { displayName } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/password-input'

const formSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, 'Please enter your username.')
    .max(64, 'Username must be at most 64 characters.'),
  password: z.string().min(1, 'Please enter your password.'),
})

type UserAuthFormProps = React.HTMLAttributes<HTMLFormElement>

export function UserAuthForm({ className, ...props }: UserAuthFormProps) {
  const [isLoading, setIsLoading] = useState(false)
  const navigate = useNavigate()

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      username: '',
      password: '',
    },
  })

  async function onSubmit(data: z.infer<typeof formSchema>) {
    setIsLoading(true)
    try {
      const session = await login(data.username, data.password)
      toast.success(`Welcome back, ${displayName(session.user)}!`)
      navigate({ to: '/', replace: true })
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        form.setError('password', {
          message: 'Invalid username or password.',
        })
      } else {
        toast.error(
          error instanceof ApiError
            ? error.message
            : 'Could not reach the PlanIT API. Check that it is running.'
        )
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn('grid gap-5', className)}
        aria-busy={isLoading}
        {...props}
      >
        <FormField
          control={form.control}
          name='username'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Username</FormLabel>
              <div className='relative'>
                <UserRound
                  aria-hidden='true'
                  className='pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground'
                />
                <FormControl>
                  <Input
                    autoComplete='username'
                    placeholder='Enter your username'
                    className='h-12 rounded-lg bg-muted/20 pl-10 shadow-none'
                    disabled={isLoading}
                    {...field}
                  />
                </FormControl>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='password'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <PasswordInput
                  placeholder='Enter your password'
                  autoComplete='current-password'
                  className='bg-muted/20 [&>input]:h-12 [&>input]:rounded-lg [&>input]:pr-10 [&>input]:shadow-none'
                  disabled={isLoading}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          className='group mt-1 h-12 rounded-lg bg-teal-800 text-white shadow-sm hover:bg-teal-900 dark:bg-teal-300 dark:text-teal-950 dark:hover:bg-teal-200'
          disabled={isLoading}
        >
          {isLoading ? <Loader2 className='animate-spin' /> : null}
          {isLoading ? 'Signing in…' : 'Sign in'}
          {!isLoading ? (
            <ArrowRight className='transition-transform group-hover:translate-x-1 motion-reduce:transition-none' />
          ) : null}
        </Button>
      </form>
    </Form>
  )
}
