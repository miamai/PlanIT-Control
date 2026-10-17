import { ContentSection } from '../components/content-section'
import { AccountForm } from './account-form'

export function SettingsAccount() {
  return (
    <ContentSection
      title='Account'
      desc='View your session details and manage sign-out.'
    >
      <AccountForm />
    </ContentSection>
  )
}
