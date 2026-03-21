/** @jsxImportSource hono/jsx */
import type { Message } from '../../../db/queries/conversations.js';

/** Convert basic markdown to HTML for server-rendered messages. */
function renderMarkdown(text: string): string {
  if (!text) return '';
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // Bold **text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic *text*
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Numbered lists
  html = html.replace(/^(\d+)\.\s+(.+)$/gm, '<li>$2</li>');
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ol>$1</ol>');
  // Paragraphs
  html = html.replace(/\n\n+/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  return '<p>' + html + '</p>';
}

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
  if (type === 'link_list') {
    const heading = block.heading as string | undefined;
    const links = (block.links as Record<string, unknown>[]) ?? [];
    return `<div class="article-list">${heading ? `<p><strong>${heading}</strong></p>` : ''}${links.map(lnk => {
      const desc = lnk.description ? `<p style="margin:0.2rem 0;font-size:0.85rem">${lnk.description}</p>` : '';
      const meta = lnk.site_name ? `<p class="meta">${lnk.site_name}</p>` : '';
      return `<div class="article-card-block"><div><a href="${lnk.url}" target="_blank" rel="noopener noreferrer"><strong>${lnk.title}</strong></a>${desc}${meta}</div></div>`;
    }).join('')}</div>`;
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
      {message.text && <div class="text" dangerouslySetInnerHTML={{ __html: renderMarkdown(message.text) }} />}
      {blocks.length > 0 && (
        <div dangerouslySetInnerHTML={{ __html: blocks.map(renderBlock).join('') }} />
      )}
    </div>
  );
};
