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
      identityEditorOpen.value = true
    }

    const closeIdentityEditor = () => {
      identityEditorOpen.value = false
      identityId.value = null
      identityName.value = ''
      identityEmail.value = ''
    }

    const saveIdentity = () => {
      if (!identityId.value) return
      emit('update:identity', {
        id: identityId.value,
        name: identityName.value.trim(),
        email: identityEmail.value.trim()
      })
      closeIdentityEditor()
    }

    const ensureEditor = () => {
      if (!quill) {
        // Import Quill dynamically
        import('quill').then(({ default: Quill }) => {
          quill = new Quill('#c-editor', {
            theme: 'snow',
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
      openIdentityEditor,
      closeIdentityEditor,
      saveIdentity
    }
  }
}
</script>

<template>
  <div id="compose" class="compose" :class="{ visible: composeOpen }">
    <div class="actions">
      <!-- Send on the left -->
      <button id="c-send" type="button" :disabled="sending" @click="$emit('send')" title="Send">
        <!-- paper plane -->
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
          stroke-linejoin="round" aria-hidden="true">
          <path d="M22 2L11 13" />
          <path d="M22 2l-7 20-4-9-9-4 20-7z" />
        </svg>
        <span>Send</span>
      </button>

      <!-- Discard on the right -->
      <button id="c-cancel" type="button" @click="$emit('discard')" title="Discard draft">
        <!-- trash -->
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
          stroke-linejoin="round" aria-hidden="true">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6M14 11v6" />
          <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
        </svg>
        <span>Discard</span>
      </button>
    </div>

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
        @blur="setTimeout(() => showAutocomplete = false, 200)"
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

    <div class="row">
      <label>Signature</label>
      <div class="signature-field">
        <textarea
          id="c-signature"
          :value="signatureText"
          rows="3"
          placeholder="Add a signature"
          @input="$emit('update:signature', $event.target.value)"
        ></textarea>
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

    <div class="row">
      <label>Body</label>
      <div id="c-editor" class="editor"></div>
    </div>

    <div class="meta" id="c-status">{{ composeStatus }}</div>
    <pre id="c-debug" class="debug" style="display:block; white-space:pre-wrap;" v-if="composeDebug">
      {{ composeDebug }}
    </pre>
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
        <label>Email</label>
        <input v-model="identityEmail" type="email" placeholder="address@example.com">
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
  border-bottom: 1px solid var(--border);
  padding: 12px 16px;
}

.compose.visible {
  display: block;
}

.compose .row {
  grid-template-columns: 80px minmax(0, 1fr);
}

.compose .row>* {
  min-width: 0;
}

.compose .row input,
.compose .row select {
  width: 100%;
}

.from-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
}

.compose .actions {
  display: flex;
  gap: .6rem;
  justify-content: flex-start;
  order: -1;
  padding: 0 0 8px 0;
}

.compose .actions button {
  padding: .55rem .9rem;
  border: 0;
  border-radius: .6rem;
  background: var(--accent);
  color: #fff;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: .45rem;
}

.compose .actions svg {
  width: 16px;
  height: 16px;
  display: block;
}

.compose .actions button:hover {
  filter: brightness(1.08);
}

.compose .actions #c-send[disabled] {
  opacity: .6;
  cursor: not-allowed;
}

/* Text inputs */
#c-to,
#c-subj,
#c-from {
  padding: .5rem .65rem;
  border: 1px solid var(--border);
  border-radius: .5rem;
  background: var(--panel2);
  color: var(--text);
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
  background: #0e1220;
  border-radius: .5rem;
}

/* Make the Quill wrapper fill the column */
#c-editor {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  min-height: 320px;
  /* larger default editor */
  grid-column: 2 / 3;
  /* ensure full width of the input column */
}

/* Ensure all Quill pieces stretch (scoped -> deep to reach Quill DOM) */
#c-editor :deep(.ql-toolbar),
#c-editor :deep(.ql-container),
#c-editor :deep(.ql-editor) {
  width: 100%;
}

/* Give the editor body a sensible height within the compose area */
#c-editor :deep(.ql-container) {
  flex: 1 1 auto;
  min-height: 280px;
}

/* Dark theme tweaks for Quill toolbar */
#c-editor :deep(.ql-toolbar) {
  background: var(--panel2);
  border: 1px solid var(--border);
  border-radius: .5rem .5rem 0 0;
}

#c-editor :deep(.ql-container) {
  background: var(--panel2);
  border: 1px solid var(--border);
  border-top: 0;
  border-radius: 0 0 .5rem .5rem;
}

#c-editor :deep(.ql-editor) {
  color: var(--text);
}
</style>
