import type { Language } from '../types'
import { SubpageHeader } from './SubpageHeader'
import { termsUpdatedOn } from '../lib/terms'
import { TermsDocument } from './TermsDocument'

export interface TermsPageCopy {
  title: string
  pageEyebrow: string
  updatedOn: string
  backToApp: string
  languageNote: string
}

/** `/terminos`: los términos para releer cuando sea, con o sin sesión. */
export function TermsPage({
  language,
  copy,
  onBack,
  onLanguageToggle,
}: {
  language: Language
  copy: TermsPageCopy
  onBack: () => void
  onLanguageToggle: () => void
}) {
  return (
    <div className="subpage">
      <SubpageHeader language={language} backLabel={copy.backToApp} onBack={onBack} onLanguageToggle={onLanguageToggle} />

      <main className="subpage-content">
        <div className="subpage-hero">
          <p className="subpage-eyebrow">{copy.pageEyebrow}</p>
          <h1>{copy.title}</h1>
          <p className="subpage-lead">{copy.updatedOn.replace('{date}', termsUpdatedOn())}</p>
        </div>

        {copy.languageNote ? <p className="subpage-note">{copy.languageNote}</p> : null}

        <article className="subpage-section">
          <TermsDocument />
        </article>
      </main>
    </div>
  )
}
