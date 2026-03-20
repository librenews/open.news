/** @jsxImportSource hono/jsx */
import type { Message } from '../../db/queries/conversations.js';
import { MessageBubble } from './components/MessageBubble.js';

export const ChatPage = ({ user, conversation, messages }: {
  user: { handle: string };
  conversation: { id: number | bigint };
  messages: Message[];
}) => {
  const convoId = Number(conversation.id);
  return (
    <>
      <div id="chat-data" data-conversation-id={convoId.toString()} />

      <div id="chat-messages">
        {messages.map(m => <MessageBubble message={m} />)}
      </div>

      <div id="chat-input-row">
        <input type="text" id="chat-input" placeholder="Ask anything about the news..." />
        <button id="chat-send">Send</button>
      </div>

      <script src="/static/chat.js"></script>
    </>
  );
};
