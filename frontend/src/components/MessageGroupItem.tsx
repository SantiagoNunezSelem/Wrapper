import { useState } from 'react'
import type { MessageGroup } from '../types'
import { ChatBubbleView } from './ChatBubbleView'

function TriangleIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg viewBox="0 0 12 12" width={10} height={10} className={`group-triangle ${expanded ? 'is-expanded' : ''}`} fill="currentColor">
      <path d="M2 3l4 5 4-5z" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

export function MessageGroupItem({ group, isNew, isSharedStory = false }: { group: MessageGroup; isNew?: boolean; isSharedStory?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const [showPrivacyNotice, setShowPrivacyNotice] = useState(false)

  function handleClick() {
    if (isSharedStory) {
      setShowPrivacyNotice(true)
      return
    }
    setExpanded((value) => !value)
  }

  return (
    <div className={`message-group ${isNew ? 'is-new' : ''}`}>
      <button type="button" className="message-group-header" onClick={handleClick} aria-expanded={expanded && !isSharedStory}>
        <TriangleIcon expanded={expanded && !isSharedStory} />
        <span>{group.heading}</span>
      </button>
      {expanded && !isSharedStory ? (
        <div className="message-group-bubbles">
          {group.bubbles.map((bubble, index) => (
            <ChatBubbleView key={index} bubble={bubble} />
          ))}
        </div>
      ) : null}

      {showPrivacyNotice ? (
        <div className="message-group-privacy-notice">
          <div className="message-group-privacy-row">
            <span className="message-group-privacy-icon">
              <LockIcon />
            </span>
            <p>No se pueden visualizar los chats debido a políticas de privacidad. Únicamente el autor que generó el chat puede acceder a esta funcionalidad.</p>
          </div>
          <button type="button" className="message-group-privacy-action" onClick={() => setShowPrivacyNotice(false)}>
            Entendido
          </button>
        </div>
      ) : null}
    </div>
  )
}
