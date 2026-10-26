import { TERMS_SECTIONS } from '../copy/termsText'

/**
 * El texto de los términos, tal cual. Lo dibujan el cartel de aceptación y la página
 * `/terminos`, así lo que se acepta y lo que se puede releer son el mismo texto.
 */
export function TermsDocument({ headingLevel = 'h2' }: { headingLevel?: 'h2' | 'h3' }) {
  const Heading = headingLevel

  return (
    <div className="terms-document" lang="es">
      {TERMS_SECTIONS.map((section) => (
        <section key={section.title} className="terms-section">
          <Heading>{section.title}</Heading>
          {section.blocks.map((block, index) =>
            typeof block === 'string' ? (
              <p key={index}>{block}</p>
            ) : (
              <ul key={index}>
                {block.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ),
          )}
        </section>
      ))}
    </div>
  )
}
