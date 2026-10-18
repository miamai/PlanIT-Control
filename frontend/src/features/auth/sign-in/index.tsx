import { Logo } from '@/assets/logo'
import { ThemeSwitch } from '@/components/theme-switch'
import { UserAuthForm } from './components/user-auth-form'

export function SignIn() {
  return (
    <main className='grid min-h-svh bg-background lg:grid-cols-[1.1fr_1fr]'>
      <section className='flex flex-col bg-[#12332f] px-7 py-8 text-white sm:px-12 lg:min-h-svh lg:px-16 lg:py-12 xl:px-20'>
        <div className='flex items-center gap-3'>
          <Logo className='size-12' alt='' />
          <div>
            <p className='text-lg font-semibold tracking-tight'>
              Precognition
            </p>
            <p className='mt-1 text-xs text-white/55'>
              Field operations intelligence
            </p>
          </div>
        </div>

        <div className='max-w-lg pt-8 pb-2 sm:py-8 lg:my-auto lg:py-20'>
          <h1 className='text-3xl leading-[1.2] font-medium tracking-tight sm:text-4xl xl:text-5xl'>
            A clearer view.
            <br />
            <span className='text-[#b8d4c7]'>A safer workday.</span>
          </h1>
          <p className='mt-6 hidden max-w-sm text-sm leading-7 text-white/60 lg:block'>
            Site conditions, weather risks, and crew reports in one place. Make
            the next call with confidence.
          </p>
        </div>

        <p className='hidden border-t border-white/10 pt-5 text-xs text-white/45 lg:block'>
          Site conditions{' '}
          <span className='mx-2' aria-hidden='true'>
            ·
          </span>{' '}
          Weather alerts{' '}
          <span className='mx-2' aria-hidden='true'>
            ·
          </span>{' '}
          Crew reports
        </p>
      </section>

      <section
        aria-label='Account sign in'
        className='relative flex flex-col px-7 py-8 sm:px-12 lg:px-16 lg:py-12'
      >
        <div className='absolute top-5 right-5 sm:top-8 sm:right-8'>
          <ThemeSwitch />
        </div>
        <div className='mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-6 sm:py-8 lg:py-16'>
          <h2 className='text-3xl font-semibold tracking-tight'>
            Welcome back.
          </h2>
          <p className='mt-3 text-sm leading-6 text-muted-foreground'>
            Sign in to your Precognition workspace.
          </p>
          <UserAuthForm className='mt-8' />
          <p className='mt-8 border-t pt-5 text-xs leading-5 text-muted-foreground'>
            Need an account or a password reset? Contact your administrator.
          </p>
        </div>
        <p className='text-center text-[11px] text-muted-foreground'>
          Precognition
        </p>
      </section>
    </main>
  )
}
