// Vanilla JS chat component — no Alpine.js dependency
// Handles SSE streaming, message sending, and block rendering
(function() {
  const messagesEl = document.getElementById('chat-messages');
  const inputEl = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  const convoId = Number(document.getElementById('chat-data')?.dataset.conversationId);

  if (!messagesEl || !inputEl || !sendBtn || !convoId) return;

  let sending = false;
  let evtSource = null;
  const streamingMessages = {};  // msgId -> DOM element

  function scrollToBottom() {
    requestAnimationFrame(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function renderArticleCard(a) {
    const img = a.image_url
      ? `<img src="https://images.weserv.nl/?url=${encodeURIComponent(a.image_url)}&w=160&h=112&fit=cover&output=webp" alt="" loading="lazy" onerror="this.style.display='none'">`
      : '';
    const desc = a.description ? `<p style="margin:0.2rem 0;font-size:0.85rem">${escapeHtml(a.description)}</p>` : '';
    const meta = [a.site_name, a.published_at ? new Date(a.published_at).toLocaleDateString() : null].filter(Boolean).join(' · ');
    return `<div class="article-card-block">${img}<div><a href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(a.title || a.url)}</strong></a>${desc}<p class="meta">${escapeHtml(meta)}</p></div></div>`;
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
      return '';
    }).join('');
  }

  function addUserMessage(text) {
    const div = document.createElement('div');
    div.className = 'msg-user';
    div.textContent = text;
    messagesEl.appendChild(div);
    scrollToBottom();
  }

  function createAssistantMessage(msgId) {
    const wrapper = document.createElement('div');
    wrapper.className = 'msg-assistant';
    wrapper.id = 'msg-' + msgId;

    const textDiv = document.createElement('div');
    textDiv.className = 'text msg-streaming';
    wrapper.appendChild(textDiv);

    const blocksDiv = document.createElement('div');
    blocksDiv.className = 'blocks-container';
    wrapper.appendChild(blocksDiv);

    messagesEl.appendChild(wrapper);
    streamingMessages[msgId] = { wrapper, textDiv, blocksDiv, text: '' };
    scrollToBottom();
  }

  function appendToken(msgId, token) {
    const msg = streamingMessages[msgId];
    if (!msg) return;
    msg.text += token;
    msg.textDiv.textContent = msg.text;
    scrollToBottom();
  }

  function setBlocks(msgId, blocks) {
    const msg = streamingMessages[msgId];
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
    const msg = streamingMessages[msgId];
    if (!msg) return;
    msg.textDiv.classList.remove('msg-streaming');
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
      // If message already has text (non-streaming response like greeting)
      if (data.message.text) {
        appendToken(data.message.id, data.message.text);
      }
    });

    evtSource.addEventListener('token', function(e) {
      var data = JSON.parse(e.data);
      appendToken(data.message_id, data.token);
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

  // Initialize
  connectSSE();
  scrollToBottom();
})();
