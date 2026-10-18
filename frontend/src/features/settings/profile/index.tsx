import { ContentSection } from '../components/content-section'
import { ProfileForm } from './profile-form'

export function SettingsProfile() {
  return (
    <ContentSection
      title='Profile'
      desc='Your display name and profile note on this browser.'
    >
      <ProfileForm />
    </ContentSection>
  )
}
