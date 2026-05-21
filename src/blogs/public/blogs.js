// Compose modal + follow intercept JavaScript
// Served as /js/blogs.js to avoid TSX/Hono html-template escaping issues

(function () {
  // ── Compose Modal ──────────────────────────────────────────────────────────
  window.openCompose = function () {
    var overlay = document.getElementById('composeOverlay');
    if (!overlay) return;
    overlay.classList.add('open');
    var ed = document.getElementById('composeEditor');
    if (ed) ed.focus();
  };

  window.closeCompose = function () {
    var overlay = document.getElementById('composeOverlay');
    if (overlay) overlay.classList.remove('open');
  };

  window.closeComposeOutside = function (e) {
    if (e.target.id === 'composeOverlay') window.closeCompose();
  };

  window.execFmt = function (cmd) {
    var ed = document.getElementById('composeEditor');
    if (ed) ed.focus();
    document.execCommand(cmd, false, null);
  };

  window.insertLink = function () {
    var url = prompt('URL:');
    if (!url) return;
    var ed = document.getElementById('composeEditor');
    if (ed) ed.focus();
    document.execCommand('createLink', false, url);
  };

  window.updateCounter = function () {
    var ed = document.getElementById('composeEditor');
    var counter = document.getElementById('charCounter');
    if (ed && counter) counter.textContent = (ed.innerText || '').length.toString();
  };

  // DOM walker: convert contenteditable nodes to markdown
  function nodeToMd(node) {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return '';
    var ch = Array.from(node.childNodes).map(nodeToMd).join('');
    var t = node.tagName.toLowerCase();
    if (t === 'b' || t === 'strong') return '**' + ch + '**';
    if (t === 'i' || t === 'em') return '_' + ch + '_';
    if (t === 'a') {
      var h = node.getAttribute('href');
      return h ? '[' + ch + '](' + h + ')' : ch;
    }
    if (t === 'br') return '\n';
    if (t === 'div' || t === 'p') return ch + '\n';
    return ch;
  }

  window.submitCompose = function (e) {
    var editor = document.getElementById('composeEditor');
    var content = Array.from(editor.childNodes).map(nodeToMd).join('').trim();
    document.getElementById('composeContent').value = content;
    var titleEl = document.querySelector('.bl-compose-title-input');
    if (!content && !(titleEl && titleEl.value.trim())) {
      e.preventDefault();
      return;
    }
    var btn = document.getElementById('composeSubmit');
    if (btn) { btn.textContent = 'Publishing...'; btn.disabled = true; }
  };

  // Image previews
  var attachedFiles = new DataTransfer();

  window.previewImages = function (e) {
    var files = e.target.files;
    var container = document.getElementById('imagePreviews');
    Array.from(files).forEach(function (file) {
      attachedFiles.items.add(file);
      var reader = new FileReader();
      reader.onload = function (ev) {
        var wrap = document.createElement('div');
        wrap.className = 'bl-compose-preview';
        var img = document.createElement('img');
        img.src = ev.target.result;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = '\u2715';
        btn.onclick = function () { window.removePreview(btn, file.name); };
        wrap.appendChild(img);
        wrap.appendChild(btn);
        container.appendChild(wrap);
      };
      reader.readAsDataURL(file);
    });
    document.getElementById('imageInput').files = attachedFiles.files;
  };

  window.removePreview = function (btn, name) {
    btn.parentElement.remove();
    var dt = new DataTransfer();
    Array.from(attachedFiles.files).forEach(function (f) {
      if (f.name !== name) dt.items.add(f);
    });
    attachedFiles = dt;
    document.getElementById('imageInput').files = attachedFiles.files;
  };

  // ── Keyboard: Escape closes modal ──────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') window.closeCompose();
  });

  // ── Follow/Unfollow form intercept ─────────────────────────────────────────
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form) return;
    var action = form.getAttribute('action') || '';
    if (!action.startsWith('/follow/') && !action.startsWith('/unfollow/')) return;
    e.preventDefault();
    var isFollow = action.startsWith('/follow/');
    var did = action.split('/').pop();
    fetch(action, { method: 'POST', redirect: 'manual' }).catch(function () {});
    var newAction = isFollow ? '/unfollow/' + did : '/follow/' + did;
    form.setAttribute('action', newAction);
    var btn = form.querySelector('button');
    if (btn) {
      btn.className = isFollow ? 'bl-btn-following' : 'bl-btn-follow';
      btn.innerHTML = isFollow ? '<span>Following</span>' : 'Follow';
    }
  });
}());
