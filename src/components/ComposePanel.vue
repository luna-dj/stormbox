<script>
import { ref, onMounted, onBeforeUnmount, watch, nextTick, computed } from 'vue'
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
    
    // Fullscreen and resize state
    const isFullscreen = ref(false)
    const composeRef = ref(null)
    const composeStyle = ref({})
    const isResizing = ref(false)
    const resizeDirection = ref(null)
    const resizeStartPos = ref({ x: 0, y: 0 })
    const resizeStartSize = ref({ width: 0, height: 0 })
    const resizeStartPosition = ref({ left: 0, top: 0 })
    
    // Load saved size/position from localStorage
    const loadComposeState = () => {
      try {
        const saved = localStorage.getItem('compose.state')
        if (saved) {
          const state = JSON.parse(saved)
          composeStyle.value = {}
          if (state.width) composeStyle.value.width = state.width + 'px'
          if (state.height) composeStyle.value.height = state.height + 'px'
          if (state.left !== undefined && state.left !== null) {
            composeStyle.value.left = state.left + 'px'
            composeStyle.value.right = ''
          } else if (state.right !== undefined && state.right !== null) {
            composeStyle.value.right = state.right + 'px'
            composeStyle.value.left = ''
          }
          if (state.top !== undefined && state.top !== null) {
            composeStyle.value.top = state.top + 'px'
            composeStyle.value.bottom = ''
          } else if (state.bottom !== undefined && state.bottom !== null) {
            composeStyle.value.bottom = state.bottom + 'px'
            composeStyle.value.top = ''
          }
        }
      } catch (e) {
        console.debug('Failed to load compose state:', e)
      }
    }
    
    // Save size/position to localStorage
    const saveComposeState = () => {
      if (isFullscreen.value) return // Don't save when fullscreen
      try {
        const rect = composeRef.value?.getBoundingClientRect()
        if (!rect) return
        
        const state = {
          width: rect.width,
          height: rect.height,
          left: rect.left,
          top: rect.top,
        }
        localStorage.setItem('compose.state', JSON.stringify(state))
      } catch (e) {
        console.debug('Failed to save compose state:', e)
      }
    }
    
    const toggleFullscreen = () => {
      isFullscreen.value = !isFullscreen.value
      if (isFullscreen.value) {
        // Save current position/size before going fullscreen
        saveComposeState()
        // Set inline styles to match reading pane width (930px) and center it
        const maxWidth = window.innerWidth <= 930 ? '100vw' : '930px'
        composeStyle.value = {
          top: '0px',
          left: window.innerWidth <= 930 ? '0px' : '50%',
          right: window.innerWidth <= 930 ? '0px' : 'auto',
          bottom: '0px',
          width: maxWidth,
          height: '100vh',
          maxWidth: maxWidth,
          maxHeight: '100vh',
          minWidth: '0px',
          minHeight: '0px',
          transform: window.innerWidth <= 930 ? 'none' : 'translateX(-50%)'
        }
      } else {
        // Clear inline styles first, then restore saved position/size
        composeStyle.value = {}
        nextTick(() => {
          loadComposeState()
        })
      }
    }
    
    const handleHeaderDoubleClick = (e) => {
      // Only exit fullscreen on double-click, don't enter it
      if (isFullscreen.value) {
        e.preventDefault()
        e.stopPropagation()
        toggleFullscreen()
      }
    }
    
    const startResize = (direction, e) => {
      if (isFullscreen.value) return
      // Only start resize on left mouse button
      if (e.button !== 0) return
      
      e.preventDefault()
      e.stopPropagation()
      isResizing.value = true
      resizeDirection.value = direction
      resizeStartPos.value = { x: e.clientX, y: e.clientY }
      
      const rect = composeRef.value?.getBoundingClientRect()
      if (rect) {
        resizeStartSize.value = { width: rect.width, height: rect.height }
        resizeStartPosition.value = { left: rect.left, top: rect.top, right: window.innerWidth - rect.right, bottom: window.innerHeight - rect.bottom }
      }
      
      document.addEventListener('mousemove', handleResize, { passive: false })
      document.addEventListener('mouseup', stopResize, { once: true })
    }
    
    const handleResize = (e) => {
      if (!isResizing.value || !composeRef.value) return
      e.preventDefault()
      
      const deltaX = e.clientX - resizeStartPos.value.x
      const deltaY = e.clientY - resizeStartPos.value.y
      
      if (resizeDirection.value === 'right') {
        const newWidth = resizeStartSize.value.width + deltaX
        const minWidth = 400
        const maxWidth = window.innerWidth - resizeStartPosition.value.left
        if (newWidth >= minWidth && newWidth <= maxWidth) {
          composeStyle.value.width = newWidth + 'px'
        }
      } else if (resizeDirection.value === 'bottom') {
        const newHeight = resizeStartSize.value.height + deltaY
        const minHeight = 300
        const maxHeight = window.innerHeight - resizeStartPosition.value.top
        if (newHeight >= minHeight && newHeight <= maxHeight) {
          composeStyle.value.height = newHeight + 'px'
        }
      } else if (resizeDirection.value === 'corner') {
        const newWidth = resizeStartSize.value.width + deltaX
        const newHeight = resizeStartSize.value.height + deltaY
        const minWidth = 400
        const maxWidth = window.innerWidth - resizeStartPosition.value.left
        const minHeight = 300
        const maxHeight = window.innerHeight - resizeStartPosition.value.top
        
        if (newWidth >= minWidth && newWidth <= maxWidth) {
          composeStyle.value.width = newWidth + 'px'
        }
        if (newHeight >= minHeight && newHeight <= maxHeight) {
          composeStyle.value.height = newHeight + 'px'
        }
      }
    }
    
    const stopResize = () => {
      if (!isResizing.value) return
      isResizing.value = false
      resizeDirection.value = null
      document.removeEventListener('mousemove', handleResize)
      saveComposeState()
    }
    
    // Load saved state on mount
    onMounted(() => {
      if (!isFullscreen.value) {
        loadComposeState()
      }
    })
    
    // Watch for composeOpen to load state
    watch(() => props.composeOpen, (open) => {
      if (open && !isFullscreen.value) {
        loadComposeState()
      } else if (!open) {
        // Cleanup when compose panel closes
        stopResize()
      }
    })
    
    // Update fullscreen size on window resize
    const handleWindowResize = () => {
      if (isFullscreen.value) {
        const maxWidth = window.innerWidth <= 930 ? '100vw' : '930px'
        composeStyle.value = {
          ...composeStyle.value,
          left: window.innerWidth <= 930 ? '0px' : '50%',
          right: window.innerWidth <= 930 ? '0px' : 'auto',
          width: maxWidth,
          maxWidth: maxWidth,
          transform: window.innerWidth <= 930 ? 'none' : 'translateX(-50%)'
        }
      }
    }
    
    // Watch for fullscreen changes and window resize
    watch(isFullscreen, (fullscreen) => {
      if (fullscreen) {
        window.addEventListener('resize', handleWindowResize)
      } else {
        window.removeEventListener('resize', handleWindowResize)
      }
    })
    
    // Cleanup event listeners on unmount
    onBeforeUnmount(() => {
      stopResize()
      window.removeEventListener('resize', handleWindowResize)
    })

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
            } else {
              // No content provided - clear the editor to ensure it's empty
              const currentHtml = quill.root.innerHTML.trim()
              if (currentHtml && currentHtml !== '<p><br></p>' && currentHtml !== '<p></p>') {
                quill.setText('')
                quill.setSelection(0)
              }
            }
            quill.focus()
          } else {
            // Quill not ready yet, try again
            setTimeout(setContent, 50)
          }
        }
        setTimeout(setContent, 200)
      } else {
        // Panel closed - clear the editor to prevent content persisting
        if (quill) {
          const currentHtml = quill.root.innerHTML.trim()
          if (currentHtml && currentHtml !== '<p><br></p>' && currentHtml !== '<p></p>') {
            quill.setText('')
            quill.setSelection(0)
          }
        }
      }
    })
    
    // Watch for compose.html changes to update editor (for replies set after panel opens)
    watch(() => props.compose.html, (newHtml) => {
      if (!quill || !props.composeOpen) return
      
      // If compose.html is cleared (empty), clear the editor
      if (!newHtml || newHtml.trim() === '' || newHtml === '<p><br></p>' || newHtml === '<p></p>') {
        const currentHtml = quill.root.innerHTML.trim()
        if (currentHtml && currentHtml !== '<p><br></p>' && currentHtml !== '<p></p>') {
          quill.setText('')
          quill.setSelection(0)
        }
        return
      }
      
      // Only update if editor is empty or has minimal content
      const currentHtml = quill.root.innerHTML.trim()
      if (!currentHtml || currentHtml === '<p><br></p>' || currentHtml === '<p></p>') {
        setTimeout(() => {
          if (quill) {
            quill.root.innerHTML = newHtml
            quill.setSelection(0)
          }
        }, 100)
      }
    })

    // Watch for sending to complete and clear editor on success
    let wasSending = false
    watch(() => props.sending, (isSending) => {
      if (wasSending && !isSending && quill && props.composeOpen) {
        // Sending just completed - check if it was successful
        const status = props.composeStatus || ''
        // Clear the editor if status indicates success
        if (status === 'Sent.' || (status && !status.toLowerCase().includes('error') && !status.toLowerCase().includes('missing') && !status.toLowerCase().includes('failed'))) {
          // Success - clear the editor immediately
          quill.setText('')
          quill.setSelection(0)
          // Also ensure compose object is cleared
          emit('update:compose', {
            ...props.compose,
            html: '',
            text: ''
          })
        }
      }
      wasSending = isSending
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
      hideAutocomplete,
      isFullscreen,
      composeRef,
      composeStyle,
      toggleFullscreen,
      startResize,
      handleHeaderDoubleClick
    }
  }
}
</script>

<template>
  <div id="compose" class="compose" :class="{ visible: composeOpen, fullscreen: isFullscreen }" :style="composeStyle" ref="composeRef">
    <div class="compose-shell">
      <div class="compose-window-header" @dblclick="handleHeaderDoubleClick">
        <div class="compose-window-title">New message</div>
        <div class="compose-window-actions" @mousedown.stop @dblclick.stop>
          <button class="compose-window-btn" @click="toggleFullscreen" :title="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'" aria-label="Toggle fullscreen">
            <svg v-if="!isFullscreen" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
            </svg>
            <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
            </svg>
          </button>
          <button class="compose-window-close" @click="$emit('discard')" aria-label="Close">
            ×
          </button>
        </div>
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
    <!-- Resize handles -->
    <div v-if="!isFullscreen" class="resize-handle resize-handle-right" @mousedown="startResize('right', $event)"></div>
    <div v-if="!isFullscreen" class="resize-handle resize-handle-bottom" @mousedown="startResize('bottom', $event)"></div>
    <div v-if="!isFullscreen" class="resize-handle resize-handle-corner" @mousedown="startResize('corner', $event)"></div>
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
  min-width: 400px;
  min-height: 300px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--panel) !important;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55);
  z-index: 1400;
  isolation: isolate;
}

.compose.visible {
  display: block;
}

.compose.fullscreen {
  top: 0 !important;
  left: 50% !important;
  right: auto !important;
  bottom: 0 !important;
  width: 930px !important;
  max-width: 930px !important;
  height: 100vh !important;
  max-height: 100vh !important;
  min-width: 0 !important;
  min-height: 0 !important;
  border-radius: 0;
  margin: 0 !important;
  transform: translateX(-50%) !important;
}

@media (max-width: 930px) {
  .compose.fullscreen {
    left: 0 !important;
    right: 0 !important;
    width: 100vw !important;
    max-width: 100vw !important;
    transform: none !important;
  }
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
  background: var(--panel2) !important;
  border-radius: 12px 12px 0 0;
}

.compose.fullscreen .compose-window-header {
  border-radius: 0;
}

.compose-window-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.compose-window-btn {
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 14px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  position: relative;
  z-index: 10;
}

.compose-window-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text);
}

.compose-window-btn:active {
  background: rgba(255, 255, 255, 0.2);
}

@media (max-width: 900px) {
  .compose-window-header {
    border-radius: 0;
  }
}

.compose-window-title {
  font-weight: 600;
  color: var(--text);
  font-size: 14px;
  letter-spacing: 0.02em;
}

.compose-window-close {
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: all 0.2s ease;
}

.compose-window-close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text);
}

/* Resize handles */
.resize-handle {
  position: absolute;
  background: transparent;
  z-index: 1500;
  transition: background 0.2s ease;
}

.resize-handle:hover {
  background: rgba(255, 255, 255, 0.1);
}

.resize-handle-right {
  right: 0;
  top: 0;
  bottom: 0;
  width: 8px;
  cursor: ew-resize;
}

.resize-handle-right:hover {
  background: rgba(255, 255, 255, 0.15);
}

.resize-handle-bottom {
  bottom: 0;
  left: 0;
  right: 0;
  height: 8px;
  cursor: ns-resize;
}

.resize-handle-bottom:hover {
  background: rgba(255, 255, 255, 0.15);
}

.resize-handle-corner {
  right: 0;
  bottom: 0;
  width: 20px;
  height: 20px;
  cursor: nwse-resize;
  background: linear-gradient(135deg, transparent 0%, transparent 30%, rgba(255, 255, 255, 0.3) 30%, rgba(255, 255, 255, 0.3) 70%, transparent 70%);
  border-radius: 0 0 12px 0;
}

.resize-handle-corner:hover {
  background: linear-gradient(135deg, transparent 0%, transparent 30%, rgba(255, 255, 255, 0.5) 30%, rgba(255, 255, 255, 0.5) 70%, transparent 70%);
}

.compose.fullscreen .resize-handle {
  display: none;
}

.compose-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  display: grid;
  gap: 10px;
  background: var(--panel2) !important;
}

.compose .row {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  margin: 0;
}

.compose-header .row {
  padding: 8px 0;
  border-bottom: 1px solid rgba(46, 52, 72, 0.6);
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
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  color: var(--text);
  padding: 8px 10px;
}

.compose .row label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
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

.btn-ghost {
  border: 1px solid rgba(84, 92, 118, 0.8);
  background: transparent;
  color: var(--text);
  border-radius: 10px;
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
}

.btn-ghost:hover {
  background: rgba(255, 255, 255, 0.06);
}

.signature-row {
  align-items: start;
}

.compose-body {
  background: var(--panel2) !important;
  color: var(--text);
  min-height: 0;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  overflow: hidden;
  padding: 12px 16px;
}

.compose-body #c-editor {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}

#c-signature {
  width: 100%;
  padding: 0.6rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel);
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
    left: 0 !important;
    right: 0 !important;
    top: 0 !important;
    bottom: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    max-width: 100vw !important;
    max-height: 100vh !important;
    min-width: 0 !important;
    min-height: 0 !important;
    border-radius: 0;
    margin: 0 !important;
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
  
  .compose-window-header {
    border-radius: 0;
  }
  
  .resize-handle {
    display: none !important;
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
  order: 999;
  background: var(--panel) !important;
  border: 1px solid var(--border) !important;
  border-top: 1px solid var(--border) !important;
  border-radius: 0 0 10px 10px;
  padding: 10px 12px;
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text);
  box-shadow: none;
}

.compose-body #c-editor :deep(.ql-toolbar.ql-snow) {
  border-color: var(--border) !important;
}

.compose-body #c-editor :deep(.ql-toolbar .ql-stroke) {
  stroke: var(--text);
}

.compose-body #c-editor :deep(.ql-toolbar .ql-fill) {
  fill: var(--text);
}

.compose-body #c-editor :deep(.ql-toolbar .ql-picker) {
  color: var(--text);
}

.compose-body #c-editor :deep(.ql-toolbar .ql-formats) {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-right: 8px;
  padding-right: 8px;
  border-right: 1px solid rgba(46, 52, 72, 0.5);
}

.compose-body #c-editor :deep(.ql-toolbar .ql-formats:last-child) {
  margin-right: 0;
  padding-right: 0;
  border-right: 0;
}

.compose-body #c-editor :deep(.ql-toolbar button),
.compose-body #c-editor :deep(.ql-toolbar .ql-picker) {
  width: 32px;
  height: 32px;
  padding: 6px;
  border-radius: 6px;
  transition: all 0.2s ease;
  background: transparent;
  border: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.compose-body #c-editor :deep(.ql-toolbar button:hover),
.compose-body #c-editor :deep(.ql-toolbar button.ql-active),
.compose-body #c-editor :deep(.ql-toolbar .ql-picker:hover),
.compose-body #c-editor :deep(.ql-toolbar .ql-picker.ql-active) {
  background: rgba(255, 255, 255, 0.08);
  border-radius: 6px;
}

.compose-body #c-editor :deep(.ql-toolbar .ql-picker-label) {
  border-radius: 6px;
  padding: 6px 10px;
  min-width: 80px;
  color: var(--text);
}

.compose-body #c-editor :deep(.ql-toolbar .ql-picker-label:hover) {
  background: rgba(255, 255, 255, 0.08);
}

.compose :deep(.ql-snow .ql-picker-options),
.compose-body #c-editor :deep(.ql-toolbar.ql-snow .ql-picker-options),
.compose-body #c-editor :deep(.ql-toolbar .ql-picker-options) {
  background: var(--panel) !important;
  border: 1px solid var(--border) !important;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  padding: 4px;
  color: var(--text);
}

.compose :deep(.ql-snow .ql-picker-item),
.compose-body #c-editor :deep(.ql-toolbar.ql-snow .ql-picker-item),
.compose-body #c-editor :deep(.ql-toolbar .ql-picker-item) {
  border-radius: 4px;
  padding: 6px 10px;
  color: var(--text) !important;
  background: transparent;
}

.compose-body #c-editor :deep(.ql-toolbar .ql-picker-item:hover) {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text);
}

.compose-body #c-editor :deep(.ql-toolbar .ql-picker-item.ql-selected) {
  background: rgba(255, 255, 255, 0.12);
  color: var(--text);
}

.compose :deep(.ql-snow .ql-picker.ql-expanded .ql-picker-label) {
  color: var(--text) !important;
}

.compose-body #c-editor :deep(.ql-container) {
  order: 1;
  background: transparent;
  border: 0;
  border-radius: 0;
  flex: 1 1 auto;
  min-height: 0;
}

.compose-body #c-editor :deep(.ql-editor) {
  color: var(--text);
  min-height: 120px;
  padding: 10px 12px;
  font-size: 14px;
  font-family: "Space Grotesk", system-ui, Segoe UI, Roboto, sans-serif;
  line-height: 1.4;
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
  background: var(--panel2) !important;
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
  padding: 8px 18px;
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
