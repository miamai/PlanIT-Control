import { useEffect, useRef } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type SidebarNavProps = {
  items: readonly { href: string; title: string; icon: LucideIcon }[]
}

/** A single route-driven navigation works with links, back/forward, and mobile. */
export function SidebarNav({ items }: SidebarNavProps) {
  const pathname = useLocation({ select: (location) => location.pathname })
  const currentLink = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    const link = currentLink.current
    const nav = link?.parentElement
    if (!link || !nav) return
    const linkBounds = link.getBoundingClientRect()
    const navBounds = nav.getBoundingClientRect()
    if (linkBounds.left < navBounds.left)
      nav.scrollLeft += linkBounds.left - navBounds.left
    else if (linkBounds.right > navBounds.right)
      nav.scrollLeft += linkBounds.right - navBounds.right
  }, [pathname])
  return (
    <nav
      aria-label='Settings sections'
      className='flex gap-1 overflow-x-auto border-b'
    >
      {items.map(({ href, title, icon: Icon }) => (
        <Link
          key={href}
          to={href}
          activeOptions={{ exact: true }}
          ref={pathname === href ? currentLink : undefined}
          aria-current={pathname === href ? 'page' : undefined}
          className={cn(
            'flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring',
            pathname === href
              ? 'border-foreground text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          <Icon className='size-4' aria-hidden />
          {title}
        </Link>
      ))}
    </nav>
  )
}
