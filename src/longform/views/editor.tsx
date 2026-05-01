import { html } from 'hono/html';

export function EditorPage() {
  return html`
    <div id="editor-container"></div>
    <div id="draft-status" style="position: fixed; bottom: 20px; right: 20px; background: rgba(0,0,0,0.8); color: white; padding: 6px 12px; border-radius: 6px; font-size: 13px; font-family: var(--font-sans); opacity: 0; transition: opacity 0.3s; pointer-events: none; z-index: 50;">Synced to network</div>
    
    <!-- Floating 'New Block' Context Menu (Medium '+') -->
    <div class="floating-menu" id="floating-menu" style="visibility: hidden;">
      <button class="add-btn" title="Add new block">
        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>
      <div class="expand-menu">
        <button data-type="image" title="Upload Image">🖼️</button>
        <button data-type="embed" title="Embed URL">🔗</button>
        <button data-type="codeBlock" title="Code">{}</button>
        <input type="file" id="image-upload" accept="image/png, image/jpeg, image/gif, image/webp" style="display: none;" />
      </div>
    </div>

    <!-- Bubble contextual text-selection menu -->
    <div class="bubble-menu" id="bubble-menu" style="visibility: hidden;">
      <button data-command="bold"><b>B</b></button>
      <button data-command="italic"><i>i</i></button>
      <button data-command="strike"><s>S</s></button>
      <span class="divider">|</span>
      <button data-command="h2" style="font-weight:700">T</button>
      <button data-command="h3" style="font-weight:600">t</button>
      <span class="divider">|</span>
      <button data-command="blockquote">”</button>
    </div>

    <script type="module">
      import { Editor } from 'https://esm.sh/@tiptap/core@2.2.4';
      import StarterKit from 'https://esm.sh/@tiptap/starter-kit@2.2.4';
      import Placeholder from 'https://esm.sh/@tiptap/extension-placeholder@2.2.4';
      import { BubbleMenu } from 'https://esm.sh/@tiptap/extension-bubble-menu@2.2.4';
      import { FloatingMenu } from 'https://esm.sh/@tiptap/extension-floating-menu@2.2.4';
      import Image from 'https://esm.sh/@tiptap/extension-image@2.2.4';
      import Collaboration from 'https://esm.sh/@tiptap/extension-collaboration@2.2.4';
      import CollaborationCursor from 'https://esm.sh/@tiptap/extension-collaboration-cursor@2.2.4';
      import { HocuspocusProvider } from 'https://esm.sh/@hocuspocus/provider@2.14.3';
      import { Node, mergeAttributes } from 'https://esm.sh/@tiptap/core@2.2.4';

      const EmbedNode = Node.create({
        name: 'embed',
        group: 'block',
        atom: true,
        addAttributes() {
          return { src: { default: null } };
        },
        parseHTML() {
          return [{ tag: 'div[data-embed]' }];
        },
        renderHTML({ HTMLAttributes }) {
          return ['div', mergeAttributes(HTMLAttributes, { 'data-embed': '', class: 'embed-placeholder' }), 
            ['div', { class: 'embed-label' }, 'Embed:'],
            ['a', { href: HTMLAttributes.src, target: '_blank', contenteditable: 'false' }, HTMLAttributes.src]
          ];
        },
      });

      document.addEventListener('DOMContentLoaded', () => {
        try {
          const bubbleMenuEl = document.getElementById('bubble-menu');
          const floatingMenuEl = document.getElementById('floating-menu');
          
          window.processImageFile = async (file) => {
             const img = new window.Image();
             const reader = new FileReader();
             reader.onload = (event) => {
                img.onload = () => {
                   try {
                     const canvas = document.createElement('canvas');
                     const MAX_WIDTH = 1200;
                     const MAX_HEIGHT = 1200;
                     let width = img.width;
                     let height = img.height;
                     if (width > height) { if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; } }
                     else { if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; } }
                     canvas.width = width;
                     canvas.height = height;
                     const ctx = canvas.getContext('2d');
                     ctx.drawImage(img, 0, 0, width, height);
                     const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.8);
                     window.editor.commands.setImage({ src: compressedDataUrl });
                   } catch (err) {
                     alert('Error compressing image: ' + err.message);
                   }
                };
                img.onerror = () => alert('Invalid image file');
                img.src = event.target.result;
             };
             reader.readAsDataURL(file);
          };

          const urlParams = new URLSearchParams(window.location.search);
          let docId = urlParams.get('doc');
          if (!docId) {
            docId = Math.random().toString(36).substring(2, 15);
            const newUrl = new URL(window.location);
            newUrl.searchParams.set('doc', docId);
            window.history.replaceState({}, '', newUrl);
          }

          const provider = new HocuspocusProvider({
            url: 'wss://' + window.location.host + '/collab/',
            name: docId,
            onSynced() {
              const statusEl = document.getElementById('draft-status');
              if (statusEl) {
                statusEl.style.opacity = '1';
                clearTimeout(window._draftTimeout);
                window._draftTimeout = setTimeout(() => { statusEl.style.opacity = '0'; }, 2000);
              }
            }
          });

          window.editor = new Editor({
          element: document.querySelector('#editor-container'),
          extensions: [
            StarterKit.configure({ heading: { levels: [2, 3] }, history: false }),
            Image,
            EmbedNode,
            Placeholder.configure({
              placeholder: 'Tell your story...',
            }),
            Collaboration.configure({
              document: provider.document,
            }),
            CollaborationCursor.configure({
              provider: provider,
              user: {
                name: 'Anonymous',
                color: '#f02050',
              },
            }),
            BubbleMenu.configure({
              element: bubbleMenuEl,
              tippyOptions: { duration: 150, animation: 'shift-away' },
            }),
            FloatingMenu.configure({
              element: floatingMenuEl,
              tippyOptions: { duration: 150, placement: 'left-start' },
            }),
          ],

          editorProps: {
            attributes: {
              class: 'prose mx-auto focus:outline-none',
            },
            handleDrop: function(view, event, slice, moved) {
              if (!moved && event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length > 0) {
                window.processImageFile(event.dataTransfer.files[0]);
                event.preventDefault();
                return true;
              }
              return false;
            },
            handlePaste: function(view, event, slice) {
              if (event.clipboardData && event.clipboardData.files && event.clipboardData.files.length > 0) {
                window.processImageFile(event.clipboardData.files[0]);
                event.preventDefault();
                return true;
              }
              return false;
            }
          },
          onTransaction({ editor }) {
            // Update active states
            bubbleMenuEl.querySelectorAll('button').forEach(btn => {
              const cmd = btn.dataset.command;
              let isActive = false;
              if (['bold', 'italic', 'strike', 'blockquote'].includes(cmd)) {
                 isActive = editor.isActive(cmd);
              } else if (cmd === 'h2') {
                 isActive = editor.isActive('heading', { level: 2 });
              } else if (cmd === 'h3') {
                 isActive = editor.isActive('heading', { level: 3 });
              }
              btn.classList.toggle('is-active', isActive);
            });
          },
          onUpdate() {
            // Note: Hocuspocus handles sync automatically
          }
        });

        // Event bindings for bubble menu
        bubbleMenuEl.addEventListener('click', (e) => {
          const btn = e.target.closest('button');
          if (!btn) return;
          const cmd = btn.dataset.command;
          const chain = window.editor.chain().focus();
          switch(cmd) {
            case 'bold': chain.toggleBold().run(); break;
            case 'italic': chain.toggleItalic().run(); break;
            case 'strike': chain.toggleStrike().run(); break;
            case 'h2': chain.toggleHeading({ level: 2 }).run(); break;
            case 'h3': chain.toggleHeading({ level: 3 }).run(); break;
            case 'blockquote': chain.toggleBlockquote().run(); break;
          }
        });

        // Floating menu hover expand
        const addBtn = floatingMenuEl.querySelector('.add-btn');
        addBtn.addEventListener('click', () => {
           floatingMenuEl.classList.toggle('expanded');
        });
        
        // Wire up Floating Menu functional component inserts
        const imageInput = floatingMenuEl.querySelector('input[type="file"]');
        floatingMenuEl.querySelector('[data-type="image"]').addEventListener('click', () => {
           floatingMenuEl.classList.remove('expanded');
           if (imageInput) imageInput.click();
        });
        
        if (imageInput) {
          imageInput.addEventListener('change', (e) => {
             const file = e.target.files[0];
             if (file) {
                window.processImageFile(file);
             }
             // Safely reset after pushing to the queue
             setTimeout(() => { e.target.value = ''; }, 500);
          });
        }

        floatingMenuEl.querySelector('[data-type="codeBlock"]').addEventListener('click', () => {
           floatingMenuEl.classList.remove('expanded');
           window.editor.chain().focus().toggleCodeBlock().run();
        });

        floatingMenuEl.querySelector('[data-type="embed"]').addEventListener('click', () => {
           floatingMenuEl.classList.remove('expanded');
           const url = window.prompt('Enter a URL to embed (e.g. YouTube, Bluesky):');
           if (url) {
             window.editor.chain().focus().insertContent({ type: 'embed', attrs: { src: url } }).run();
           }
        });
        
        } catch (e) {
          console.error("Tiptap Initialization Error:", e);
          document.getElementById('editor-container').innerHTML = '<p style="color:red">Failed to load editor: ' + e.message + '</p>';
        }
      });

      window.publishDraft = async function() {
         const btn = document.getElementById('publish-btn');
         const defaultTxt = btn.innerText;
         btn.innerText = 'Publishing...';
         btn.disabled = true;
         
         const title = window.prompt("Enter a title for your post:");
         if (!title) {
            btn.innerText = defaultTxt;
            btn.disabled = false;
            return;
         }

         try {
           const res = await fetch('/api/publish', {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({
               title,
               document: window.editor.getJSON()
             })
           });
           const data = await res.json();
           if (data.success) {
             try { window.localStorage.removeItem('longform_draft'); } catch(e) {}
             window.editor.commands.setContent('');
             
             // Redirect to the newly published post
             const parts = data.uri.split('/');
             const authorDid = parts[2];
             const rkey = parts[4];
             window.location.href = '/post/' + authorDid + '/' + rkey;
           } else {
             alert('Failed to publish: ' + data.error);
           }
         } catch (e) {
             alert('Network error during publishing.');
         }
         
         btn.innerText = defaultTxt;
         btn.disabled = false;
      };
    </script>

    <style>
       .prose { min-height: 500px; width: 100%; position: relative; }
       .prose:focus { outline: none; }
       
       /* Medium style bubble menu */
       .bubble-menu {
         display: flex;
         background-color: #242424;
         border-radius: 6px;
         padding: 0.2rem 0.5rem;
         box-shadow: 0 4px 12px rgba(0,0,0,0.15);
         align-items: center;
         color: white;
       }
       .bubble-menu button {
         background: none;
         border: none;
         color: #fff;
         cursor: pointer;
         font-size: 16px;
         padding: 0.4rem 0.6rem;
         opacity: 0.7;
         transition: opacity 0.2s;
       }
       .bubble-menu button:hover, .bubble-menu button.is-active {
         opacity: 1;
       }
       .bubble-menu .divider {
         color: rgba(255,255,255,0.2);
         margin: 0 0.2rem;
         font-size: 14px;
       }

       /* Medium style floating action menu */
       .floating-menu {
         display: flex;
         align-items: center;
         margin-top: -0.25rem;
       }
       .floating-menu .add-btn {
         background: none;
         border: 1px solid rgba(0,0,0,0.4);
         color: rgba(0,0,0,0.4);
         border-radius: 50%;
         width: 34px;
         height: 34px;
         cursor: pointer;
         display: flex;
         justify-content: center;
         align-items: center;
         transition: transform 0.2s, border-color 0.2s, color 0.2s;
       }
       .floating-menu.expanded .add-btn {
          transform: rotate(45deg);
       }
       .floating-menu .add-btn:hover {
          color: rgba(0,0,0,0.8);
          border-color: rgba(0,0,0,0.8);
       }
       
       .floating-menu .expand-menu {
         display: flex;
         opacity: 0;
         pointer-events: none;
         transform: translateX(-10px);
         transition: opacity 0.2s, transform 0.2s;
         margin-left: 0.5rem;
       }
       .floating-menu.expanded .expand-menu {
         opacity: 1;
         pointer-events: auto;
         transform: translateX(0);
       }
       .floating-menu .expand-menu button {
         background: none;
         border: 1px solid rgba(0,0,0,0.1);
         border-radius: 50%;
         width: 34px;
         height: 34px;
         margin-right: 0.3rem;
         cursor: pointer;
         color: #242424;
       }
       .floating-menu .expand-menu button:hover {
         border-color: rgba(0,0,0,0.3);
       }

       @media (prefers-color-scheme: dark) {
         .floating-menu .add-btn { border-color: rgba(255,255,255,0.4); color: rgba(255,255,255,0.4); }
         .floating-menu .add-btn:hover { color: #fff; border-color: #fff; }
         .floating-menu .expand-menu button { border-color: rgba(255,255,255,0.2); color: #fff; }
       }
       
       /* Fix unstyled prosemirror margins */
       .prose p { margin-top: 1.25rem; margin-bottom: 1.25rem; min-height: 1.5rem; }
       .prose ul, .prose ol { padding-left: 1.5rem; margin-bottom: 2rem; }
       .prose blockquote { border-left: 3px solid rgba(0,0,0,0.8); padding-left: 1rem; font-style: italic; margin-left: 0; }
       .prose img { max-width: 100%; border-radius: 8px; margin: 1rem 0; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
       .prose pre { background: #1a1a1a; color: #fff; padding: 1rem; border-radius: 8px; overflow-x: auto; font-family: monospace; }
       .prose .embed-placeholder {
         background: rgba(0,0,0,0.03);
         border: 1px dashed rgba(0,0,0,0.2);
         padding: 1rem 1.5rem;
         border-radius: 8px;
         margin: 1.5rem 0;
         display: flex;
         align-items: center;
         gap: 0.5rem;
       }
       .prose .embed-label { font-weight: 600; font-family: var(--font-sans); font-size: 14px; color: var(--text-muted); }
       .prose .embed-placeholder a { color: #118156; text-decoration: none; word-break: break-all; }
       @media (prefers-color-scheme: dark) { 
         .prose blockquote { border-left-color: rgba(255,255,255,0.8); } 
         .prose .embed-placeholder { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.2); }
       }
    </style>
  `;
}
