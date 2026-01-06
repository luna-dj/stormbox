<script>
import { ref, onMounted, watch, nextTick, computed } from 'vue'
import EmailAutocomplete from './EmailAutocomplete.vue'

export default {
  name: 'ComposePanel',
  components: {
    EmailAutocomplete
  },
  props: {
    composeOpen: Boolean,
    compose: Object,
    identities: Array,
    contacts: Array,
    sending: Boolean,
    composeStatus: String,
    composeDebug: String,
    signatureText: String,
    signatureEnabled: Boolean
  },
  emits: ['send', 'discard', 'update:compose', 'update:signature', 'update:signatureEnabled', 'update:identity'],
  setup(props, { emit }) {
    const showAutocomplete = ref(false)
    const toInputRef = ref(null)
    
    const currentQuery = computed(() => {
      if (!props.compose.to) return ''
      const lastComma = props.compose.to.lastIndexOf(',')
      return lastComma >= 0 
        ? props.compose.to.substring(lastComma + 1).trim() 
        : props.compose.to.trim()
    })
    
    const shouldShowAutocomplete = computed(() => {
      return showAutocomplete.value && currentQuery.value.length > 0
    })
    
    const selectEmail = (email) => {
      const to = props.compose.to || ''
      const lastComma = to.lastIndexOf(',')
      const before = lastComma >= 0 ? to.substring(0, lastComma + 1) + ' ' : ''
      const newTo = before + email
      emit('update:compose', {
        ...props.compose,
        to: newTo
      })
      showAutocomplete.value = false
    }
    let quill = null
    const identityEditorOpen = ref(false)
    const identityName = ref('')
    const identityEmail = ref('')
    const identityId = ref(null)
    const identityOriginalName = ref('')
    const identityOriginalEmail = ref('')

    const escapeHtml = (str) => {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
    }

    const insertSignature = () => {
      const signatureValue = (props.signatureText || '').trim()
      if (!signatureValue) return
      const signatureHtml = `<p><br></p><p>--<br>${escapeHtml(signatureValue).replace(/\n/g, '<br>')}</p>`

      if (quill) {
        const insertAt = Math.max(0, quill.getLength() - 1)
        quill.setSelection(insertAt, 0)
        quill.clipboard.dangerouslyPasteHTML(insertAt, signatureHtml)
        return
      }

      emit('update:compose', {
        ...props.compose,
        html: (props.compose.html || '') + signatureHtml,
        text: (props.compose.text || '') + `\n\n-- \n${signatureValue}`
      })
    }

    const openIdentityEditor = () => {
      const identity = props.identities?.[props.compose.fromIdx] || props.identities?.[0]
      if (!identity) return
      identityId.value = identity.id
      identityName.value = identity.name || ''
      identityEmail.value = identity.email || ''
      identityOriginalName.value = identity.name || ''
      identityOriginalEmail.value = identity.email || ''
      identityEditorOpen.value = true
    }

    const closeIdentityEditor = () => {
      identityEditorOpen.value = false
      identityId.value = null
      identityName.value = ''
      identityEmail.value = ''
      identityOriginalName.value = ''
      identityOriginalEmail.value = ''
    }

    const saveIdentity = () => {
      if (!identityId.value) return
      const name = identityName.value.trim()
      const email = identityEmail.value.trim()
      const updates = {}
      if (name !== identityOriginalName.value) updates.name = name
      if (email !== identityOriginalEmail.value) updates.email = email
      if (Object.keys(updates).length === 0) {
        closeIdentityEditor()
        return
      }
      emit('update:identity', { id: identityId.value, updates })
      closeIdentityEditor()
    }

    const hideAutocomplete = () => {
      window.setTimeout(() => {
        showAutocomplete.value = false
      }, 200)
    }

    const ensureEditor = () => {
      if (!quill) {
        // Import Quill dynamically
        import('quill').then(({ default: Quill }) => {
          quill = new Quill('#c-editor', {
            theme: 'snow',
            placeholder: 'Body…',
            modules: {
              toolbar: [
                [{ header: [1, 2, false] }],
                ['bold', 'italic', 'underline'],
                [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                ['link', 'blockquote', 'code-block'],
                ['clean']
              ]
            }
          })

          // Sync Quill content to compose object
          quill.on('text-change', () => {
            if (quill) {
              const html = quill.root.innerHTML
              const text = quill.getText()
              emit('update:compose', {
                ...props.compose,
                html: html,
                text: text
              })
            }
          })
          
          // Set initial content if it exists (for replies)
          if (props.compose.html && props.composeOpen) {
            setTimeout(() => {
              if (quill && props.compose.html) {
                quill.root.innerHTML = props.compose.html
                quill.setSelection(0)
              }
            }, 50)
          }
          
          // Set initial content if it exists (for replies)
          if (props.compose.html && props.composeOpen && props.compose.html.trim() && props.compose.html !== '<p><br></p>') {
            setTimeout(() => {
              if (quill && props.compose.html) {
                console.debug('[ComposePanel] Setting initial content in Quill:', props.compose.html.substring(0, 200))
                quill.root.innerHTML = props.compose.html
                quill.setSelection(0)
              }
            }, 100)
          }
        })
      }
    }

    onMounted(() => {
      if (props.composeOpen) {
        ensureEditor()
      }
    })

    watch(() => props.composeOpen, async (newValue) => {
      if (newValue) {
        ensureEditor()
        // Wait for Quill to be initialized, then set content
        await nextTick()
        const setContent = () => {
          if (quill) {
            // Set initial content if provided
            const html = props.compose.html
            const text = props.compose.text
            if (html && html.trim() && html !== '<p><br></p>' && html !== '<p></p>') {
              // Use Quill's clipboard to properly parse HTML
              const delta = quill.clipboard.convert(html)
              quill.setContents(delta)
              quill.setSelection(0)
            } else if (text && text.trim()) {
              quill.setText(text)
              quill.setSelection(0)
            }
            quill.focus()
          } else {
            // Quill not ready yet, try again
            setTimeout(setContent, 50)
          }
        }
        setTimeout(setContent, 200)
      }
    })
    
    // Watch for compose.html changes to update editor (for replies set after panel opens)
    watch(() => props.compose.html, (newHtml) => {
      if (quill && props.composeOpen && newHtml && newHtml.trim() && newHtml !== '<p><br></p>' && newHtml !== '<p></p>') {
        const currentHtml = quill.root.innerHTML.trim()
        // Only update if editor is empty or has minimal content
        if (!currentHtml || currentHtml === '<p><br></p>' || currentHtml === '<p></p>') {
          setTimeout(() => {
            if (quill) {
              quill.root.innerHTML = newHtml
              quill.setSelection(0)
            }
          }, 100)
        }
      }
    })

    return {
      quill,
      showAutocomplete,
      toInputRef,
      currentQuery,
      shouldShowAutocomplete,
      selectEmail,
      insertSignature,
      identityEditorOpen,
      identityName,
      identityEmail,
      identityOriginalName,
      identityOriginalEmail,
      openIdentityEditor,
      closeIdentityEditor,
      saveIdentity,
      hideAutocomplete
    }
  }
}
</script>

<template>
  <div id="compose" class="compose" :class="{ visible: composeOpen }">
    <div class="compose-shell">
      <div class="compose-window-header">
        <div class="compose-window-title">New message</div>
        <button class="compose-window-close" @click="$emit('discard')" aria-label="Close">
          ×
        </button>
      </div>
      <div class="compose-header">
        <div class="row">
          <label>From</label>
          <div class="from-row">
            <select id="c-from" v-model="compose.fromIdx">
              <option v-for="(id, idx) in identities" :key="id.id" :value="idx">
                {{ (id.name ? (id.name + ' ') : '') + '<' + id.email + '>' }} </option>
            </select>
            <button type="button" class="btn-ghost" :disabled="!identities.length" @click="openIdentityEditor">
              Edit
            </button>
          </div>
        </div>

        <div class="row" style="position: relative;">
          <label>To</label>
          <input 
            id="c-to" 
            ref="toInputRef"
            v-model="compose.to" 
            placeholder="alice@example.com, Bob &lt;bob@example.com&gt;"
            autocomplete="off"
            @focus="showAutocomplete = true"
            @blur="hideAutocomplete"
            @input="$emit('update:compose', { ...compose, to: $event.target.value })"
          >
          <EmailAutocomplete
            :query="currentQuery"
            :contacts="contacts"
            :show="shouldShowAutocomplete"
            @select="selectEmail"
          />
        </div>

        <div class="row">
          <label>Subject</label>
          <input id="c-subj" v-model="compose.subject" placeholder="Subject">
        </div>

        <div class="row signature-row">
          <label>Signature</label>
          <div class="signature-field">
            <textarea
              id="c-signature"
              :value="signatureText"
              rows="3"
              placeholder="Add a signature"
              @input="$emit('update:signature', $event.target.value)"
            ></textarea>
            <div class="signature-actions">
              <label class="signature-toggle">
                <input
                  type="checkbox"
                  :checked="signatureEnabled"
                  @change="$emit('update:signatureEnabled', $event.target.checked)"
                />
                Use signature when sending
              </label>
              <button type="button" class="btn-ghost" @click="insertSignature">
                Insert signature into body
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="compose-body">
        <div id="c-editor" class="editor"></div>
      </div>

      <div class="compose-footer">
        <div class="compose-meta">
          <span id="c-status">{{ composeStatus }}</span>
        </div>
        <div class="compose-actions">
          <button id="c-cancel" type="button" @click="$emit('discard')" title="Discard draft">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
              stroke-linejoin="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
          <button id="c-send" type="button" :disabled="sending" @click="$emit('send')" title="Send">
            <span>Send</span>
          </button>
        </div>
      </div>

      <pre id="c-debug" class="debug" style="display:block; white-space:pre-wrap;" v-if="composeDebug">
        {{ composeDebug }}
      </pre>
    </div>
  </div>

  <div v-if="identityEditorOpen" class="identity-editor-overlay" @click.self="closeIdentityEditor">
    <div class="identity-editor">
      <div class="identity-editor-header">
        <h3>Edit Identity</h3>
        <button class="close-btn" @click="closeIdentityEditor">×</button>
      </div>
      <div class="identity-editor-body">
        <label>Name</label>
        <input v-model="identityName" type="text" placeholder="Display name">
        <label>Email (read-only)</label>
        <input v-model="identityEmail" type="email" placeholder="address@example.com" readonly>
        <div class="identity-hint">Email updates are disabled by the server.</div>
      </div>
      <div class="identity-editor-actions">
        <button class="btn-ghost" @click="closeIdentityEditor">Cancel</button>
        <button class="btn-primary" @click="saveIdentity">Save</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.compose {
  display: none;
  position: fixed;
  right: 16px;
  bottom: 16px;
  width: 520px;
  max-width: 92vw;
  height: 72vh;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--panel);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
  z-index: 1400;
}

.compose.visible {
  display: block;
}

.compose-shell {
  display: grid;
  grid-template-rows: auto auto minmax(120px, 1fr) auto;
  height: 100%;
  min-height: 0;
}

.compose-window-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--panel2);
  border-radius: 12px 12px 0 0;
}

@media (max-width: 900px) {
  .compose-window-header {
    border-radius: 0;
  }
}

.compose-window-title {
  font-weight: 600;
  color: var(--text);
  font-size: 13px;
}

.compose-window-close {
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 18px;
  cursor: pointer;
}

.compose-window-close:hover {
  color: var(--text);
}

.compose-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  display: grid;
  gap: 8px;
}

.compose .row {
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  margin: 0;
}

.compose-header .row {
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
}

.compose-header .row:last-child {
  border-bottom: 0;
}

.compose .row>* {
  min-width: 0;
}

.compose .row input,
.compose .row select {
  width: 100%;
  background: transparent;
  border: 0;
  color: var(--text);
  padding: 6px 0;
}

/* Text inputs */
#c-to,
#c-subj,
#c-from {
  font-size: 14px;
}

.from-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
}

.signature-row {
  align-items: start;
}

.compose-body {
  background: var(--compose-editor-bg);
  color: var(--compose-editor-text);
  min-height: 0;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  overflow: hidden;
}

#c-signature {
  width: 100%;
  padding: .5rem .65rem;
  border: 1px solid var(--border);
  border-radius: .5rem;
  background: var(--panel2);
  color: var(--text);
  resize: vertical;
}

.signature-field {
  display: grid;
  gap: 8px;
}

.signature-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
  font-size: 13px;
}

.signature-actions {
  display: grid;
  gap: 8px;
  align-items: start;
}

@media (max-width: 900px) {
  .signature-actions {
    grid-template-columns: 1fr;
    gap: 6px;
  }

  .signature-toggle {
    width: 100%;
    justify-content: flex-start;
  }

  .signature-actions .btn-ghost {
    width: 100%;
    justify-content: center;
  }
}

.identity-editor-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.identity-editor {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  width: 90%;
  max-width: 420px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
}

.identity-editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.identity-editor-header h3 {
  margin: 0;
  font-size: 16px;
}

.identity-editor-header .close-btn {
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: 18px;
  cursor: pointer;
}

.identity-editor-body {
  display: grid;
  gap: 8px;
  padding: 12px 16px;
}

.identity-editor-body input {
  padding: .5rem .65rem;
  border: 1px solid var(--border);
  border-radius: .5rem;
  background: var(--panel2);
  color: var(--text);
}

.identity-editor-body input[readonly] {
  opacity: 0.75;
  cursor: not-allowed;
}

.identity-hint {
  font-size: 12px;
  color: var(--muted);
}

@media (max-width: 900px) {
  .compose {
    left: 0;
    right: 0;
    top: 0;
    bottom: 0;
    width: auto;
    height: auto;
    max-width: none;
    border-radius: 0;
  }

  .compose .row {
    grid-template-columns: 1fr;
  }

  .from-row {
    grid-template-columns: 1fr;
  }

  .compose-header {
    padding: 10px 12px;
  }

  .compose-footer {
    padding: 10px 12px;
    border-radius: 0;
  }
}

.identity-editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}

/* Compose debug output scroll */
.debug {
  max-height: 35vh;
  overflow: auto;
  padding: 8px;
  border: 1px solid var(--border);
  background: var(--panel2);
  border-radius: .5rem;
}

/* Make the Quill wrapper fill the column */
#c-editor {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  min-height: 0;
  height: 100%;
}

/* Ensure all Quill pieces stretch (scoped -> deep to reach Quill DOM) */
#c-editor :deep(.ql-toolbar),
#c-editor :deep(.ql-container),
#c-editor :deep(.ql-editor) {
  width: 100%;
}

.compose-body #c-editor :deep(.ql-toolbar) {
  order: 2;
  background: var(--compose-toolbar-bg);
  border: 1px solid var(--compose-toolbar-border);
  border-radius: 0 0 8px 8px;
}

.compose-body #c-editor :deep(.ql-toolbar .ql-stroke) {
  stroke: var(--compose-editor-text);
}

.compose-body #c-editor :deep(.ql-toolbar .ql-fill) {
  fill: var(--compose-editor-text);
}

.compose-body #c-editor :deep(.ql-toolbar .ql-picker) {
  color: var(--compose-editor-text);
}

.compose-body #c-editor :deep(.ql-container) {
  order: 1;
  background: var(--compose-editor-bg);
  border: 1px solid var(--compose-toolbar-border);
  border-bottom: 0;
  border-radius: 0;
  flex: 1 1 auto;
  min-height: 0;
}

.compose-body #c-editor :deep(.ql-editor) {
  color: var(--compose-editor-text);
  min-height: 120px;
}

#c-editor :deep(.ql-editor.ql-blank::before) {
  color: var(--muted);
  font-style: normal;
}

.compose-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-top: 1px solid var(--border);
  background: var(--panel2);
  border-radius: 0 0 12px 12px;
}

.compose-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.compose-actions #c-cancel {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  width: 34px;
  height: 34px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.compose-actions #c-send {
  border: 0;
  background: var(--accent);
  color: #fff;
  padding: 8px 16px;
  border-radius: 8px;
  font-weight: 600;
  min-width: 88px;
}

.compose-actions #c-send[disabled] {
  opacity: .6;
  cursor: not-allowed;
}

.compose-actions svg {
  width: 16px;
  height: 16px;
}

.compose-meta {
  color: var(--muted);
  font-size: 12px;
}
</style>
