import { ContentSection } from '../components/content-section'
import { DisplayForm } from './display-form'

export function SettingsDisplay() {
  return (
    <ContentSection
      title='Display'
      desc='Customize the sidebar layout on this browser.'
    >
      <DisplayForm />
    </ContentSection>
  )
}
