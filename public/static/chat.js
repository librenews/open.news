// Vanilla JS chat component — handles SSE streaming, message sending, and block rendering
(function() {
  const messagesEl = document.getElementById('chat-messages');
  const inputEl = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  const convoId = Number(document.getElementById('chat-data')?.dataset.conversationId);

  if (!messagesEl || !inputEl || !sendBtn || !convoId) return;

  let sending = false;
  let evtSource = null;
  const streamingMessages = {};  // msgId -> DOM element

  // ── Markdown → HTML ───────────────────────────────────────────────────────
  function renderMarkdown(text) {
    if (!text) return '';
    // Escape HTML first
    let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Headers (### h3, ## h2, # h1) — must be before bold/italic
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h3>$1</h3>');
    // Bold **text**
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic *text*
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Inline code `text`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Markdown links [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    // Numbered lists: lines starting with "1. ", "2. ", etc.
    html = html.replace(/^(\d+)\.\s+(.+)$/gm, '<li>$2</li>');
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ol>$1</ol>');
    // Bullet lists: lines starting with "- "
    html = html.replace(/^[-•]\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, function(m) {
      // Only wrap in <ul> if not already in <ol>
      return m.indexOf('<ol>') === -1 ? '<ul>' + m + '</ul>' : m;
    });
    // Paragraphs: double newlines
    html = html.replace(/\n\n+/g, '</p><p>');
    // Single newlines → <br>
    html = html.replace(/\n/g, '<br>');
    return '<p>' + html + '</p>';
  }

  function scrollToBottom() {
    requestAnimationFrame(function() {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function renderArticleCard(a) {
    var img = a.image_url
      ? '<img src="https://images.weserv.nl/?url=' + encodeURIComponent(a.image_url) + '&w=160&h=112&fit=cover&output=webp" alt="" loading="lazy" onerror="this.style.display=\'none\'">'
      : '';
    var desc = a.description ? '<p style="margin:0.2rem 0;font-size:0.85rem">' + escapeHtml(a.description) + '</p>' : '';
    var meta = [a.site_name, a.published_at ? new Date(a.published_at).toLocaleDateString() : null].filter(Boolean).join(' · ');
    return '<div class="article-card-block">' + img + '<div><a href="' + escapeHtml(a.url) + '" target="_blank" rel="noopener noreferrer"><strong>' + escapeHtml(a.title || a.url) + '</strong></a>' + desc + '<p class="meta">' + escapeHtml(meta) + '</p></div></div>';
  }

  function renderBlocks(blocks) {
    return blocks.map(function(block) {
      if (block.type === 'article_list') {
        return '<div class="article-list">' +
          (block.heading ? '<p><strong>' + escapeHtml(block.heading) + '</strong></p>' : '') +
          (block.articles || []).map(renderArticleCard).join('') +
          '</div>';
      }
      if (block.type === 'article_card') return renderArticleCard(block);
      if (block.type === 'preference_confirm') {
        return '<div class="pref-confirm">✓ ' + escapeHtml(block.message) + '</div>';
      }
      if (block.type === 'suggestion') {
        return '<div class="suggestions">' +
          (block.suggestions || []).map(function(s) {
            return '<button class="suggestion-chip" data-suggestion="' + escapeHtml(s) + '">' + escapeHtml(s) + '</button>';
          }).join('') +
          '</div>';
      }
      if (block.type === 'link_list') {
        return '<div class="article-list">' +
          (block.heading ? '<p><strong>' + escapeHtml(block.heading) + '</strong></p>' : '') +
          (block.links || []).map(function(lnk) {
            var desc = lnk.description ? '<p style="margin:0.2rem 0;font-size:0.85rem">' + escapeHtml(lnk.description) + '</p>' : '';
            var meta = lnk.site_name ? '<p class="meta">' + escapeHtml(lnk.site_name) + '</p>' : '';
            return '<div class="article-card-block"><div><a href="' + escapeHtml(lnk.url) + '" target="_blank" rel="noopener noreferrer"><strong>' + escapeHtml(lnk.title) + '</strong></a>' + desc + meta + '</div></div>';
          }).join('') +
          '</div>';
      }
      return '';
    }).join('');
  }

  function addUserMessage(text) {
    var div = document.createElement('div');
    div.className = 'msg-user';
    div.textContent = text;
    messagesEl.appendChild(div);
    scrollToBottom();
  }

  function createAssistantMessage(msgId) {
    var wrapper = document.createElement('div');
    wrapper.className = 'msg-assistant';
    wrapper.id = 'msg-' + msgId;

    var textDiv = document.createElement('div');
    textDiv.className = 'text msg-streaming';
    wrapper.appendChild(textDiv);

    var blocksDiv = document.createElement('div');
    blocksDiv.className = 'blocks-container';
    wrapper.appendChild(blocksDiv);

    messagesEl.appendChild(wrapper);
    streamingMessages[msgId] = { wrapper: wrapper, textDiv: textDiv, blocksDiv: blocksDiv, text: '' };
    scrollToBottom();
  }

  function appendToken(msgId, token) {
    var msg = streamingMessages[msgId];
    if (!msg) return;
    msg.text += token;
    // During streaming, show as plain text (will be replaced with rendered HTML on completion)
    msg.textDiv.textContent = msg.text;
    scrollToBottom();
  }

  function updateText(msgId, cleanText) {
    var msg = streamingMessages[msgId];
    if (!msg) return;
    msg.text = cleanText;
    // Replace raw text with rendered markdown HTML
    msg.textDiv.innerHTML = renderMarkdown(cleanText);
    scrollToBottom();
  }

  function setBlocks(msgId, blocks) {
    var msg = streamingMessages[msgId];
    if (!msg) return;
    msg.blocksDiv.innerHTML = renderBlocks(blocks);
    // Wire up suggestion chip clicks
    msg.blocksDiv.querySelectorAll('.suggestion-chip').forEach(function(chip) {
      chip.addEventListener('click', function() {
        inputEl.value = chip.dataset.suggestion;
        inputEl.focus();
      });
    });
    scrollToBottom();
  }

  function finishMessage(msgId) {
    var msg = streamingMessages[msgId];
    if (!msg) return;
    msg.textDiv.classList.remove('msg-streaming');
    // If text_update hasn't arrived yet, strip XML tags as fallback
    if (msg.text.indexOf('<articles') !== -1 || msg.text.indexOf('<suggestions') !== -1 || msg.text.indexOf('<links') !== -1) {
      var cleaned = msg.text
        .replace(/<articles[^>]*>[\s\S]*?<\/articles>/g, '')
        .replace(/<links[^>]*>[\s\S]*?<\/links>/g, '')
        .replace(/<suggestions>[\s\S]*?<\/suggestions>/g, '')
        .trim();
      msg.textDiv.innerHTML = renderMarkdown(cleaned);
    }
    sending = false;
    inputEl.disabled = false;
    sendBtn.disabled = false;
    inputEl.focus();
    delete streamingMessages[msgId];
  }

  // SSE connection
  function connectSSE() {
    evtSource = new EventSource('/api/stream');

    evtSource.addEventListener('message', function(e) {
      var data = JSON.parse(e.data);
      if (data.conversation_id !== convoId) return;
      createAssistantMessage(data.message.id);
      if (data.message.text) {
        appendToken(data.message.id, data.message.text);
      }
    });

    evtSource.addEventListener('token', function(e) {
      var data = JSON.parse(e.data);
      appendToken(data.message_id, data.token);
    });

    evtSource.addEventListener('text_update', function(e) {
      var data = JSON.parse(e.data);
      updateText(data.message_id, data.text);
    });

    evtSource.addEventListener('blocks', function(e) {
      var data = JSON.parse(e.data);
      setBlocks(data.message_id, data.blocks);
    });

    evtSource.addEventListener('done', function(e) {
      var data = JSON.parse(e.data);
      finishMessage(data.message_id);
    });

    evtSource.onerror = function() {
      evtSource.close();
      setTimeout(connectSSE, 3000);
    };
  }

  // Send message
  async function sendMessage() {
    var text = inputEl.value.trim();
    if (!text || sending) return;
    sending = true;
    inputEl.value = '';
    inputEl.disabled = true;
    sendBtn.disabled = true;

    addUserMessage(text);

    try {
      await fetch('/api/conversations/' + convoId + '/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text }),
      });
    } catch (err) {
      console.error('Failed to send message:', err);
      sending = false;
      inputEl.disabled = false;
      sendBtn.disabled = false;
    }
  }

  // Event listeners
  sendBtn.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') sendMessage();
  });

  // ── Auto-briefing ──────────────────────────────────────────────────────────
  var BRIEFING_AWAY_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
  var lastVisibleAt = Date.now();
  var briefingInFlight = false;

  function requestBriefing() {
    if (briefingInFlight || sending) return;
    briefingInFlight = true;
    fetch('/api/conversations/' + convoId + '/briefing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }).catch(function(err) {
      console.error('Briefing request failed:', err);
    }).finally(function() {
      // Allow another briefing after 30s cooldown
      setTimeout(function() { briefingInFlight = false; }, 30000);
    });
  }

  // Page Visibility API — detect user returning after being away
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') {
      lastVisibleAt = Date.now();
    } else if (document.visibilityState === 'visible') {
      var awayMs = Date.now() - lastVisibleAt;
      if (awayMs >= BRIEFING_AWAY_THRESHOLD_MS) {
        requestBriefing();
      }
    }
  });

  // Initialize
  connectSSE();
  scrollToBottom();

  // Trigger briefing on page load if flagged (login or first visit)
  var chatDataEl = document.getElementById('chat-data');
  if (chatDataEl && chatDataEl.dataset.triggerBriefing === 'true') {
    // Small delay to let SSE connect first
    setTimeout(requestBriefing, 1000);
  }
})();
