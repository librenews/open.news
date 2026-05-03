import { html } from 'hono/html';

export function EditorPage() {
  return html`
    <div id="editor-container"></div>
    <div id="draft-status" style="position: fixed; bottom: 20px; right: 20px; background: rgba(0,0,0,0.8); color: white; padding: 6px 12px; border-radius: 6px; font-size: 13px; font-family: var(--font-sans); opacity: 0; transition: opacity 0.3s; pointer-events: none; z-index: 50;">Synced to network</div>
    
    <!-- Share Modal -->
    <div id="share-modal" class="modal-overlay" onclick="if(event.target===this)window.closeShareModal()">
      <div class="modal-content">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
          <h3 style="margin: 0; font-family: var(--font-body); font-weight: 600;">Share Document</h3>
          <button onclick="window.closeShareModal()" style="background: none; border: none; cursor: pointer; font-size: 1.2rem; color: var(--text-muted);">&times;</button>
        </div>
        
        <form onsubmit="window.addCollaborator(event)" style="display: flex; gap: 0.5rem; margin-bottom: 2rem;">
          <input type="text" id="collab-input" placeholder="Bluesky Handle or DID" required style="flex: 1; padding: 0.6rem 0.8rem; border: 1px solid rgba(0,0,0,0.2); border-radius: 6px; font-family: var(--font-sans);" />
          <select id="collab-permission" style="padding: 0.6rem; border: 1px solid rgba(0,0,0,0.2); border-radius: 6px; font-family: var(--font-sans);">
            <option value="write">Can Edit</option>
            <option value="read">View Only</option>
          </select>
          <button type="submit" style="background: #118156; color: white; border: none; padding: 0.6rem 1rem; border-radius: 6px; cursor: pointer; font-weight: 500;">Invite</button>
        </form>

        <div id="public-toggle-row" style="display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 0; border-bottom: 1px solid rgba(0,0,0,0.1); margin-bottom: 1.5rem;">
          <div style="display: flex; flex-direction: column;">
            <span style="font-weight: 600; font-size: 14px;">Anyone with the link can view</span>
            <span style="font-size: 12px; color: var(--text-muted);">Public read-only access</span>
          </div>
          <label style="position: relative; display: inline-block; width: 44px; height: 24px; cursor: pointer;">
            <input type="checkbox" id="public-toggle" onchange="window.togglePublicAccess(this.checked)" style="opacity: 0; width: 0; height: 0;" />
            <span style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.2); border-radius: 24px; transition: background 0.2s;"></span>
            <span id="public-toggle-knob" style="position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; background: white; border-radius: 50%; transition: transform 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.2);"></span>
          </label>
        </div>

        <h4 style="margin: 0 0 1rem 0; font-family: var(--font-sans); font-size: 14px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em;">People with access</h4>
        <div id="collab-list" style="display: flex; flex-direction: column; gap: 0.8rem;">
          <!-- Rendered via JS -->
        </div>
      </div>
    </div>
    
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
      import { Editor } from 'https://esm.sh/@tiptap/core@2.2.4?deps=yjs@13.6.8';
      import StarterKit from 'https://esm.sh/@tiptap/starter-kit@2.2.4?deps=yjs@13.6.8';
      import Placeholder from 'https://esm.sh/@tiptap/extension-placeholder@2.2.4?deps=yjs@13.6.8';
      import { BubbleMenu } from 'https://esm.sh/@tiptap/extension-bubble-menu@2.2.4?deps=yjs@13.6.8';
      import { FloatingMenu } from 'https://esm.sh/@tiptap/extension-floating-menu@2.2.4?deps=yjs@13.6.8';
      import Image from 'https://esm.sh/@tiptap/extension-image@2.2.4?deps=yjs@13.6.8';
      import Collaboration from 'https://esm.sh/@tiptap/extension-collaboration@2.2.4?deps=yjs@13.6.8';
      import CollaborationCursor from 'https://esm.sh/@tiptap/extension-collaboration-cursor@2.2.4?deps=yjs@13.6.8';
      import { HocuspocusProvider } from 'https://esm.sh/@hocuspocus/provider@2?deps=yjs@13.6.8';
      import { Node, mergeAttributes } from 'https://esm.sh/@tiptap/core@2.2.4?deps=yjs@13.6.8';
      import * as Y from 'https://esm.sh/yjs@13.6.8';

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
          var docId = urlParams.get('doc');
          if (!docId) {
            window.location.href = '/posts';
            return;
          }
          
          const isOwner = window.SESSION_DID && docId.includes(window.SESSION_DID);
          if (isOwner) {
             const shareBtn = document.getElementById('share-btn');
             if (shareBtn) shareBtn.style.display = 'block';
          }
          
          window.openShareModal = async () => {
             document.getElementById('share-modal').classList.add('active');
             await window.loadCollaborators();
          };
          window.closeShareModal = () => document.getElementById('share-modal').classList.remove('active');
          
           window.loadCollaborators = async () => {
              const list = document.getElementById('collab-list');
              list.innerHTML = '<div style="color: var(--text-muted); font-size: 14px;">Loading...</div>';
              try {
                 const res = await fetch('/api/acl?docId=' + encodeURIComponent(docId));
                 if (!res.ok) throw new Error('Failed to load ACLs');
                 const data = await res.json();

                 // Update public toggle
                 var publicEntry = data.acls.find(function(a) { return a.did === '*'; });
                 var toggle = document.getElementById('public-toggle');
                 var knob = document.getElementById('public-toggle-knob');
                 var track = toggle ? toggle.nextElementSibling : null;
                 if (toggle) {
                    toggle.checked = !!publicEntry;
                    if (knob) knob.style.transform = publicEntry ? 'translateX(20px)' : 'translateX(0)';
                    if (track) track.style.background = publicEntry ? '#118156' : 'rgba(0,0,0,0.2)';
                 }

                 // Owner entry
                 list.innerHTML =
                   '<div style="display: flex; align-items: center; justify-content: space-between;">' +
                     '<div style="display: flex; flex-direction: column;">' +
                       '<span style="font-weight: 600; font-size: 15px;">' + (window.SESSION_HANDLE || window.SESSION_DID) + ' (You)</span>' +
                     '</div>' +
                     '<span style="color: var(--text-muted); font-size: 14px;">Owner</span>' +
                   '</div>';
                 
                 // Filter out the wildcard entry from the list
                 var collabs = data.acls.filter(function(a) { return a.did !== '*'; });
                 for (const acl of collabs) {
                   var row = document.createElement('div');
                   row.style.cssText = 'display: flex; align-items: center; justify-content: space-between;';
                   var info = document.createElement('div');
                   info.style.cssText = 'display: flex; flex-direction: column;';
                   var nameSpan = document.createElement('span');
                   nameSpan.style.cssText = 'font-weight: 600; font-size: 15px;';
                   nameSpan.textContent = acl.handle || acl.did;
                   var didSpan = document.createElement('span');
                   didSpan.style.cssText = 'font-size: 12px; color: var(--text-muted);';
                   didSpan.textContent = acl.did;
                   info.appendChild(nameSpan);
                   info.appendChild(didSpan);
                   var actions = document.createElement('div');
                   actions.style.cssText = 'display: flex; align-items: center; gap: 1rem;';
                   var permSpan = document.createElement('span');
                   permSpan.style.cssText = 'color: var(--text-muted); font-size: 14px;';
                   permSpan.textContent = acl.permission === 'write' ? 'Can Edit' : 'View Only';
                   var removeBtn = document.createElement('button');
                   removeBtn.style.cssText = 'background: none; border: none; color: #f02050; cursor: pointer; font-size: 14px;';
                   removeBtn.textContent = 'Remove';
                   removeBtn.setAttribute('data-did', acl.did);
                   removeBtn.addEventListener('click', function() { window.removeCollaborator(this.getAttribute('data-did')); });
                   actions.appendChild(permSpan);
                   actions.appendChild(removeBtn);
                   row.appendChild(info);
                   row.appendChild(actions);
                   list.appendChild(row);
                 }
              } catch (err) {
                 list.innerHTML = '<div style="color: #f02050; font-size: 14px;">Error loading collaborators</div>';
              }
           };

           window.togglePublicAccess = async (enabled) => {
              try {
                 if (enabled) {
                    await fetch('/api/acl', {
                       method: 'POST',
                       headers: { 'Content-Type': 'application/json' },
                       body: JSON.stringify({ docId: docId, didOrHandle: '*', permission: 'read' })
                    });
                 } else {
                    await fetch('/api/acl', {
                       method: 'DELETE',
                       headers: { 'Content-Type': 'application/json' },
                       body: JSON.stringify({ docId: docId, did: '*' })
                    });
                 }
                 await window.loadCollaborators();
              } catch (err) {
                 alert('Failed to update public access');
                 await window.loadCollaborators();
              }
           };
          
          window.addCollaborator = async (e) => {
             e.preventDefault();
             const input = document.getElementById('collab-input');
             const perm = document.getElementById('collab-permission');
             const val = input.value;
             input.disabled = true;
             try {
                const res = await fetch('/api/acl', {
                   method: 'POST',
                   headers: { 'Content-Type': 'application/json' },
                   body: JSON.stringify({ docId, didOrHandle: val, permission: perm.value })
                });
                if (!res.ok) {
                   const err = await res.json();
                   throw new Error(err.error || 'Failed to add');
                }
                input.value = '';
                await window.loadCollaborators();
             } catch (err) {
                alert(err.message);
             } finally {
                input.disabled = false;
             }
          };
          
          window.removeCollaborator = async (did) => {
             if (!confirm('Remove this collaborator?')) return;
             try {
                await fetch('/api/acl', {
                   method: 'DELETE',
                   headers: { 'Content-Type': 'application/json' },
                   body: JSON.stringify({ docId, did })
                });
                await window.loadCollaborators();
             } catch (err) {
                alert('Failed to remove collaborator');
             }
          };

          const ydoc = new Y.Doc();

          const provider = new HocuspocusProvider({
            url: 'wss://' + window.location.host + '/collab/',
            name: docId,
            document: ydoc,
            token: 'cookie',
            onSynced() {
              const statusEl = document.getElementById('draft-status');
              if (statusEl) {
                statusEl.style.opacity = '1';
                clearTimeout(window._draftTimeout);
                window._draftTimeout = setTimeout(() => { statusEl.style.opacity = '0'; }, 2000);
              }
              // If document is empty after sync, insert an H1 for the title
              if (window.editor && window.editor.isEmpty) {
                window.editor.commands.setContent({ type: 'doc', content: [{ type: 'heading', attrs: { level: 1 } }, { type: 'paragraph' }] });
              }
            },
            onAuthenticationFailed(data) {
              var container = document.getElementById('editor-container');
              container.innerHTML = '<div style="text-align: center; padding: 4rem 2rem;">' +
                '<div style="font-size: 48px; margin-bottom: 1rem;">\uD83D\uDD12</div>' +
                '<h2 style="font-family: var(--font-sans); font-weight: 700; margin-bottom: 0.5rem;">Access Denied</h2>' +
                '<p style="color: var(--text-muted); font-family: var(--font-sans); font-size: 16px; max-width: 400px; margin: 0 auto;">You do not have permission to view this document. Ask the owner to share it with you.</p>' +
                '</div>';
              var publishBtn = document.getElementById('publish-btn');
              if (publishBtn) publishBtn.style.display = 'none';
            }
          });

          try {
            window.editor = new Editor({
            element: document.querySelector('#editor-container'),
            extensions: [
              StarterKit.configure({ heading: { levels: [1, 2, 3] }, history: false }),
              Image,
              EmbedNode,
              Placeholder.configure({
                showOnlyCurrent: false,
                includeChildren: true,
                placeholder: function(opts) {
                  if (opts.node.type.name === 'heading' && opts.node.attrs.level === 1) {
                    return 'Title';
                  }
                  if (opts.node.type.name === 'paragraph') {
                    var docFirstChild = opts.editor.state.doc.firstChild;
                    var isSecondNode = docFirstChild && docFirstChild.type.name === 'heading';
                    if (isSecondNode && opts.editor.state.doc.childCount <= 2 && opts.node.content.size === 0) {
                      return 'Tell your story...';
                    }
                  }
                  return '';
                },
              }),
              Collaboration.configure({
                document: ydoc,
              }),
              CollaborationCursor.configure({
                provider: provider,
                user: {
                  name: window.SESSION_HANDLE || window.SESSION_DID || 'Anonymous',
                  color: '#118156',
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
          } catch (e) {
            alert('Editor initialization failed: ' + e.message);
          }

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
         
         // Extract title from first heading in the document
         var editorJson = window.editor.getJSON();
         var title = 'Untitled';
         if (editorJson && editorJson.content) {
           for (var i = 0; i < editorJson.content.length; i++) {
             var node = editorJson.content[i];
             if (node.type === 'heading' && node.content) {
               var headingText = node.content.map(function(s) { return s.text || ''; }).join('').trim();
               if (headingText) { title = headingText; break; }
             }
           }
         }
         
         if (title === 'Untitled') {
           title = window.prompt('No heading found. Enter a title for your post:') || 'Untitled';
           if (title === 'Untitled') {
             btn.innerText = defaultTxt;
             btn.disabled = false;
             return;
           }
         }

         // Get the docId from the URL
         var publishDocId = new URLSearchParams(window.location.search).get('doc');

         try {
           const res = await fetch('/api/publish', {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({
               title: title,
               docId: publishDocId,
               document: editorJson
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
       .tiptap .is-empty::before {
         content: attr(data-placeholder);
         float: left;
         color: rgba(0, 0, 0, 0.25);
         pointer-events: none;
         height: 0;
       }
       .tiptap h1.is-empty::before {
         font-style: normal;
       }
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
       
       /* Collaboration cursor styles */
       .collaboration-cursor__caret {
         position: relative;
         margin-left: -1px;
         margin-right: -1px;
         border-left: 2px solid;
         border-right: 2px solid transparent;
         word-break: normal;
         pointer-events: none;
       }
       .collaboration-cursor__label {
         position: absolute;
         top: -1.4em;
         left: -1px;
         font-size: 12px;
         font-style: normal;
         font-weight: 600;
         line-height: normal;
         user-select: none;
         color: #fff;
         padding: 0.1rem 0.3rem;
         border-radius: 3px 3px 3px 0;
         white-space: nowrap;
         pointer-events: none;
       }
       
       /* Modal styles */
       .modal-overlay {
         position: fixed;
         top: 0; left: 0; width: 100%; height: 100%;
         background: rgba(0,0,0,0.5);
         backdrop-filter: blur(4px);
         display: flex;
         justify-content: center;
         align-items: center;
         z-index: 100;
         opacity: 0;
         pointer-events: none;
         transition: opacity 0.2s;
       }
       .modal-overlay.active {
         opacity: 1;
         pointer-events: auto;
       }
       .modal-content {
         background: #ffffff;
         padding: 2rem;
         border-radius: 12px;
         width: 100%;
         max-width: 500px;
         box-shadow: 0 10px 30px rgba(0,0,0,0.2);
         font-family: var(--font-sans);
       }
       @media (prefers-color-scheme: dark) {
         .modal-content { background: #1e1e1e; border: 1px solid rgba(255,255,255,0.1); }
         .modal-content input, .modal-content select { background: rgba(255,255,255,0.05); color: white; border-color: rgba(255,255,255,0.2) !important; }
       }
    </style>
  `;
}
