import { useState } from 'react'
import type { ChatBubble } from '../types'

export function ChatBubbleView({ bubble }: { bubble: ChatBubble }) {
  const [revealed, setRevealed] = useState(false)

  if (bubble.isDivider) {
    if (!bubble.expand) {
      return <div className="chat-bubble-divider">{bubble.text}</div>
    }

    if (revealed) {
      return (
        <>
          {bubble.expand.bubbles.map((nested, index) => (
            <ChatBubbleView key={index} bubble={nested} />
          ))}
        </>
      )
    }

    return (
      <button type="button" className="chat-bubble-divider is-expandable" onClick={() => setRevealed(true)}>
        {bubble.text}
        <ChevronIcon />
      </button>
    )
  }

  return (
    <div className={`chat-bubble ${bubble.isHighlight ? 'is-highlight' : 'is-context'}`}>
      <div className="chat-bubble-head">
        <span className="chat-bubble-sender">{bubble.sender}</span>
        <span className="chat-bubble-time">{bubble.timestampLabel}</span>
      </div>
      <p className="chat-bubble-text">{bubble.text}</p>
    </div>
  )
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 12 12" width={9} height={9} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 4.5l3 3 3-3" />
    </svg>
  )
}
