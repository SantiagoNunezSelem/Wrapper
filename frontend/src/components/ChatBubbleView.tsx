import type { ChatBubble } from '../types'

export function ChatBubbleView({ bubble }: { bubble: ChatBubble }) {
  if (bubble.isDivider) {
    return <div className="chat-bubble-divider">{bubble.text}</div>
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
