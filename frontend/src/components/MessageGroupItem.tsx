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

export function MessageGroupItem({ group, isNew }: { group: MessageGroup; isNew?: boolean }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={`message-group ${isNew ? 'is-new' : ''}`}>
      <button type="button" className="message-group-header" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        <TriangleIcon expanded={expanded} />
        <span>{group.heading}</span>
      </button>
      {expanded ? (
        <div className="message-group-bubbles">
          {group.bubbles.map((bubble, index) => (
            <ChatBubbleView key={index} bubble={bubble} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
