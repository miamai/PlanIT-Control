import { Outlet } from '@tanstack/react-router'
import { Main } from '@/components/layout/main'
import { PageHeading } from '@/components/planit/page-heading'
import { PlanitHeader } from '@/components/planit/planit-header'
import { SidebarNav } from './components/sidebar-nav'
import { settingsSections } from './data'

export function Settings() {
  return (
    <>
      <PlanitHeader />
      <Main>
        <PageHeading title='Settings' />
        <SidebarNav items={settingsSections} />
        <div className='pt-6'>
          <Outlet />
        </div>
      </Main>
    </>
  )
}
