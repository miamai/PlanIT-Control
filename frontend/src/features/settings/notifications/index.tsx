import { ContentSection } from '../components/content-section'
import { NotificationsForm } from './notifications-form'

export function SettingsNotifications() {
  return (
    <ContentSection
      title='Notifications'
      desc='Control optional in-app banners and view delivery availability.'
    >
      <NotificationsForm />
    </ContentSection>
  )
}
