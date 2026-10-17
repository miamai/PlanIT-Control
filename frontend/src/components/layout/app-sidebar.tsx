import { useLayout } from '@/context/layout-provider'
import { useProfile } from '@/hooks/use-profile'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '@/components/ui/sidebar'
import { sidebarData } from './data/sidebar-data'
import { NavGroup } from './nav-group'
import { NavUser } from './nav-user'
import { SidebarBrand } from './sidebar-brand'

export function AppSidebar() {
  const { collapsible, variant } = useLayout()
  const profile = useProfile()
  return (
    <Sidebar collapsible={collapsible} variant={variant}>
      <SidebarHeader>
        <SidebarBrand />
      </SidebarHeader>
      <SidebarContent>
        {sidebarData.navGroups.map((props) => (
          <NavGroup key={props.title} {...props} />
        ))}
      </SidebarContent>
      <SidebarFooter className='hidden md:flex'>
        <NavUser
          user={{
            ...sidebarData.user,
            name: profile.name,
            email: profile.email,
          }}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
