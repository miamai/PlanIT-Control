import { ContentSection } from '../components/content-section'
import { AccountForm } from './account-form'

export function SettingsAccount() {
  return (
    <ContentSection
      title='Account'
      desc='Manage your password and signed-in session.'
    >
      <AccountForm />
    </ContentSection>
  )
}
