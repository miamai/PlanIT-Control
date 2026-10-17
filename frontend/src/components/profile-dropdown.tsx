import { Link } from '@tanstack/react-router'
import useDialogState from '@/hooks/use-dialog-state'
import { useProfile } from '@/hooks/use-profile'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SignOutDialog } from '@/components/sign-out-dialog'

export function ProfileDropdown() {
  const [open, setOpen] = useDialogState()
  const { email, name, initials, role } = useProfile()
  const roleLabel = role === 'supervisor' ? 'Supervisor' : 'Crew'

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label='Open account menu'
            variant='ghost'
            className='relative h-8 w-8 rounded-full'
          >
            <Avatar className='h-8 w-8'>
              <AvatarImage src='/avatars/01.png' alt={email} />
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className='w-56' align='end' forceMount>
          <DropdownMenuLabel className='font-normal'>
            <div className='flex flex-col gap-1.5'>
              <p className='text-sm leading-none font-medium'>{name}</p>
              <p className='text-xs text-muted-foreground'>{roleLabel}</p>
              <p className='text-xs leading-none text-muted-foreground'>
                {email}
              </p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <Link to='/settings'>Profile</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to='/settings/account'>Account</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to='/settings/appearance'>Appearance</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to='/settings/notifications'>Notifications</Link>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant='destructive' onClick={() => setOpen(true)}>
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SignOutDialog open={!!open} onOpenChange={setOpen} />
    </>
  )
}
