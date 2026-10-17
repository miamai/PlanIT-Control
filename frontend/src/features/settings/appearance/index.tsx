import { ContentSection } from '../components/content-section'
import { AppearanceForm } from './appearance-form'

export function SettingsAppearance() {
  return (
    <ContentSection
      title='Appearance'
      desc='Choose a theme and font for this browser.'
    >
      <AppearanceForm />
    </ContentSection>
  )
}
