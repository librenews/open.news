/** @jsxImportSource hono/jsx */
import type { Message } from '../../../db/queries/conversations.js';

/** Render a block of content based on its type. */
function renderBlock(block: Record<string, unknown>): string {
  const type = block.type as string;
  if (type === 'article_list') {
    const heading = block.heading as string | undefined;
    const articles = (block.articles as Record<string, unknown>[]) ?? [];
    return `<div class="article-list">${heading ? `<p><strong>${heading}</strong></p>` : ''}${articles.map(renderArticleCard).join('')}</div>`;
  }
  if (type === 'article_card') return renderArticleCard(block);
  if (type === 'preference_confirm') {
    return `<div class="pref-confirm">✓ ${block.message}</div>`;
  }
  if (type === 'suggestion') {
    const suggestions = (block.suggestions as string[]) ?? [];
    return `<div class="suggestions">${suggestions.map(s => `<button class="suggestion-chip">${s}</button>`).join('')}</div>`;
  }
  return '';
}

function renderArticleCard(a: Record<string, unknown>): string {
  const imgHtml = a.image_url
    ? `<img src="https://images.weserv.nl/?url=${encodeURIComponent(a.image_url as string)}&w=160&h=112&fit=cover&output=webp" alt="" loading="lazy" onerror="this.style.display='none'">`
    : '';
  const desc = a.description ? `<p style="margin:0.2rem 0;font-size:0.85rem">${a.description}</p>` : '';
  const meta = [a.site_name, a.published_at ? new Date(a.published_at as string).toLocaleDateString() : null].filter(Boolean).join(' · ');
  return `<div class="article-card-block">${imgHtml}<div><a href="${a.url}" target="_blank" rel="noopener noreferrer"><strong>${a.title || a.url}</strong></a>${desc}<p class="meta">${meta}</p></div></div>`;
}

export const MessageBubble = ({ message }: { message: Message }) => {
  const blocks = (message.blocks as Record<string, unknown>[] | null) ?? [];

  if (message.role === 'user') {
    return (
      <div class="msg-user">
        {message.text}
      </div>
    );
  }

  return (
    <div class="msg-assistant">
      {message.text && <div class="text">{message.text}</div>}
      {blocks.length > 0 && (
        <div dangerouslySetInnerHTML={{ __html: blocks.map(renderBlock).join('') }} />
      )}
    </div>
  );
};
