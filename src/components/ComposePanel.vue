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
    const isMobile = ref(window.innerWidth <= 900)
    
    const handleWindowResize = () => {
      isMobile.value = window.innerWidth <= 900
    }
    
    onMounted(() => {
      window.addEventListener('resize', handleWindowResize)
    })
    
    onBeforeUnmount(() => {
      window.removeEventListener('resize', handleWindowResize)
    })
    
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
    // Global Quill instance tracker - use WeakMap to track by element
    const quillInstances = new WeakMap()
    // Global lock to prevent concurrent initializations across all instances
    if (!window.__quillInitLock) {
      window.__quillInitLock = false
    }
    let quill = null
    let isInitializingQuill = false
          window.__quillInitLock = false
    let isTogglingMode = false
    let quillInitialized = false // Track if Quill has been initialized at least once
    const plainTextMode = ref(false)
    const plainTextContent = ref('')
    const plainTextTextareaRef = ref(null)
    
    // Helper function to convert HTML to plain text
    const htmlToPlainText = (html) => {
      if (!html) return ''
      const tmp = document.createElement('div')
      tmp.innerHTML = html
      return tmp.textContent || tmp.innerText || ''
    }
    
    // Helper function to convert plain text to HTML (preserving line breaks)
    const plainTextToHtml = (text) => {
      if (!text) return ''
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>')
    }
    
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
    const handleFullscreenResize = () => {
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
        window.addEventListener('resize', handleFullscreenResize)
      } else {
        window.removeEventListener('resize', handleFullscreenResize)
      }
    })
    
    // Cleanup event listeners on unmount
    onBeforeUnmount(() => {
      stopResize()
      window.removeEventListener('resize', handleFullscreenResize)
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
      
      if (plainTextMode.value) {
        // Insert signature in plain text mode
        const signatureText = `\n\n---\n${signatureValue}`
        const currentContent = plainTextContent.value || ''
        plainTextContent.value = currentContent + signatureText
        updateComposeFromPlainText()
        // Focus the textarea
        nextTick(() => {
          if (plainTextTextareaRef.value) {
            plainTextTextareaRef.value.focus()
            const len = plainTextTextareaRef.value.value.length
            plainTextTextareaRef.value.setSelectionRange(len, len)
          }
        })
        return
      }
      
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
    
    const togglePlainTextMode = async () => {
      // Prevent multiple rapid toggles
      if (isTogglingMode || isInitializingQuill) {
        return
      }
      
      isTogglingMode = true
      
      if (plainTextMode.value) {
        // Switching from plain text to rich text (HTML)
        const plainText = plainTextContent.value || ''
        const html = plainTextToHtml(plainText)
        
        // Set flag to prevent multiple initializations
        isInitializingQuill = true
        
        // Clean up any existing Quill instances first - be very aggressive
        await nextTick() // Wait for Vue to finish current render
        await nextTick() // Double wait to ensure DOM is stable
        
        const editorElement = document.getElementById('c-editor')
        if (editorElement) {
          // Remove ALL Quill elements - be very thorough
          const allContainers = editorElement.querySelectorAll('.ql-container')
          const allToolbars = editorElement.querySelectorAll('.ql-toolbar')
          const allEditors = editorElement.querySelectorAll('.ql-editor')
          
          // Remove ALL instances
          allContainers.forEach(el => {
            try { 
              if (el && el.parentNode) {
                el.parentNode.removeChild(el)
              }
            } catch(e) {}
          })
          allToolbars.forEach(el => {
            try { 
              if (el && el.parentNode) {
                el.parentNode.removeChild(el)
              }
            } catch(e) {}
          })
          allEditors.forEach(el => {
            try { 
              if (el && el.parentNode && el.parentNode !== editorElement) {
                el.parentNode.removeChild(el)
              }
            } catch(e) {}
          })
          
          // Always clear the element completely
          editorElement.innerHTML = ''
        }
        quill = null
        quillInitialized = false
        
        plainTextMode.value = false
        
        // Wait for DOM to update so the editor element is visible
        await nextTick()
        await nextTick() // Double nextTick to ensure Vue has finished
        
        emit('update:compose', {
          ...props.compose,
          html: html,
          text: plainText
        })
        
        // Wait a bit more for DOM to be stable, then initialize Quill ONCE
        setTimeout(() => {
          // Check if Quill already exists before initializing
          const editorElement = document.getElementById('c-editor')
          if (editorElement) {
            const existingContainers = editorElement.querySelectorAll('.ql-container')
            const existingToolbars = editorElement.querySelectorAll('.ql-toolbar')
            
            // If Quill already exists, don't initialize again
            if (existingContainers.length > 0 || existingToolbars.length > 0) {
              // Quill exists - just update content
              if (quill && quill.root) {
                const delta = quill.clipboard.convert(html)
                quill.setContents(delta)
                quill.setSelection(0)
                quill.focus()
              }
              isTogglingMode = false
              return
            }
          }
          
          // Reset flag before calling ensureEditor
          isInitializingQuill = false
          window.__quillInitLock = false
          ensureEditor()
          
          // Update Quill once it's initialized
          const updateQuill = () => {
            if (quill && !plainTextMode.value) {
              const delta = quill.clipboard.convert(html)
              quill.setContents(delta)
              quill.setSelection(0)
              quill.focus()
            } else if (!quill && !plainTextMode.value && !isInitializingQuill) {
              // Quill not ready yet, try again
              setTimeout(updateQuill, 50)
            }
          }
          setTimeout(updateQuill, 200)
        }, 150)
        
        // Reset toggle flag after a delay
        setTimeout(() => {
          isTogglingMode = false
        }, 500)
      } else {
        // Switching from rich text (HTML) to plain text
        let html = ''
        if (quill) {
          html = quill.root.innerHTML
        } else {
          html = props.compose.html || ''
        }
        const plainText = htmlToPlainText(html)
        plainTextContent.value = plainText
        
        // Clean up ALL Quill instances before switching to plain text
        await nextTick() // Wait for Vue
        const editorElement = document.getElementById('c-editor')
        if (editorElement) {
            // Clear WeakMap entry
            if (quillInstances.has(editorElement)) {
              quillInstances.delete(editorElement)
            }
            
            // Clear initialization marker
            editorElement.dataset.quillInitialized = 'false'
            
            const allContainers = editorElement.querySelectorAll('.ql-container')
            const allToolbars = editorElement.querySelectorAll('.ql-toolbar')
            // Remove all instances
            allContainers.forEach(el => {
              try { if (el && el.parentNode) el.parentNode.removeChild(el) } catch(e) {}
            })
            allToolbars.forEach(el => {
              try { if (el && el.parentNode) el.parentNode.removeChild(el) } catch(e) {}
            })
            // Clear element
            editorElement.innerHTML = ''
        }
        quill = null
        quillInitialized = false
        isInitializingQuill = false
          window.__quillInitLock = false
        
        plainTextMode.value = true
        
        // Wait for DOM to update
        await nextTick()
        
        emit('update:compose', {
          ...props.compose,
          html: html,
          text: plainText
        })
        
        // Focus plain text textarea
        setTimeout(() => {
          if (plainTextTextareaRef.value && plainTextMode.value) {
            plainTextTextareaRef.value.focus()
          }
        }, 100)
        
        // Reset toggle flag after a delay
        setTimeout(() => {
          isTogglingMode = false
        }, 300)
      }
    }
    
    let lastEmittedPlainText = null // Track last plain text we emitted
    
    const updateComposeFromPlainText = () => {
      const plainText = plainTextContent.value || ''
      // Track this to prevent watch handler from resetting cursor
      lastEmittedPlainText = plainText
      isUserTyping = true
      const html = plainTextToHtml(plainText)
      emit('update:compose', {
        ...props.compose,
        html: html,
        text: plainText
      })
      // Reset typing flag after a delay
      setTimeout(() => {
        isUserTyping = false
      }, 500)
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
    
    const cleanupQuillInstances = () => {
      // Clear references immediately
      quill = null
      quillInitialized = false
      isInitializingQuill = false
          window.__quillInitLock = false
      
      // Schedule DOM cleanup for after Vue finishes rendering
      // Use requestAnimationFrame to ensure we're not in Vue's render cycle
      requestAnimationFrame(() => {
        setTimeout(() => {
          try {
            const editorElement = document.getElementById('c-editor')
            if (!editorElement || !editorElement.parentNode) {
              return
            }
            
            // Clear WeakMap entry
            if (quillInstances.has(editorElement)) {
              quillInstances.delete(editorElement)
            }
            
            // Clear initialization marker
            editorElement.dataset.quillInitialized = 'false'
            
            // Only remove Quill-specific elements, not the container itself
            const allQuillContainers = editorElement.querySelectorAll('.ql-container')
            const allQuillToolbars = editorElement.querySelectorAll('.ql-toolbar')
            
            // Remove Quill elements safely
            allQuillContainers.forEach(el => {
              try { 
                if (el && el.parentNode && el.parentNode !== editorElement) {
                  el.parentNode.removeChild(el)
                } else if (el && el.parentNode === editorElement) {
                  editorElement.removeChild(el)
                }
              } catch(e) {
                // Silently ignore errors
              }
            })
            allQuillToolbars.forEach(el => {
              try { 
                if (el && el.parentNode && el.parentNode !== editorElement) {
                  el.parentNode.removeChild(el)
                } else if (el && el.parentNode === editorElement) {
                  editorElement.removeChild(el)
                }
              } catch(e) {
                // Silently ignore errors
              }
            })
          } catch(e) {
            // Silently ignore all errors during cleanup
          }
        }, 100)
      })
    }

    const ensureEditor = (retries = 0) => {
      // Don't initialize Quill if we're in plain text mode
      if (plainTextMode.value) {
        isInitializingQuill = false
          window.__quillInitLock = false
        return
      }
      
      // Prevent multiple simultaneous initializations (both local and global)
      if (isInitializingQuill || window.__quillInitLock) {
        return
      }
      
      // Prevent infinite retries
      if (retries > 20) {
        console.warn('Failed to initialize Quill after multiple retries')
        isInitializingQuill = false
          window.__quillInitLock = false
        return
      }
      
      const editorElement = document.getElementById('c-editor')
      if (!editorElement) {
        // Element not ready, try again
        setTimeout(() => ensureEditor(retries + 1), 50)
        return
      }
      
      // Check if element is visible (not hidden by v-if)
      const computedStyle = window.getComputedStyle(editorElement)
      if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden') {
        // Element is hidden, wait a bit and try again
        setTimeout(() => ensureEditor(retries + 1), 50)
        return
      }
      
      // CRITICAL: Check for ANY existing Quill instances FIRST - before any async operations
      // Quill creates .ql-toolbar and .ql-container as direct children of the target element
      // But they can also be siblings if Quill appends them to parent
      const composeBody = editorElement.closest('.compose-body')
      
      // Check inside the editor element
      const allQuillContainers = editorElement.querySelectorAll('.ql-container')
      const allQuillToolbars = editorElement.querySelectorAll('.ql-toolbar')
      
      // Check for toolbars/containers that are siblings of editorElement (Quill sometimes creates them as siblings)
      const siblingToolbars = []
      const siblingContainers = []
      if (editorElement.parentNode) {
        Array.from(editorElement.parentNode.children).forEach(child => {
          if (child !== editorElement) {
            if (child.classList.contains('ql-toolbar')) {
              siblingToolbars.push(child)
            }
            if (child.classList.contains('ql-container')) {
              siblingContainers.push(child)
            }
          }
        })
      }
      
      // Also check in compose-body for any escaped Quill elements
      const escapedToolbars = composeBody ? Array.from(composeBody.querySelectorAll('.ql-toolbar')).filter(el => 
        !editorElement.contains(el) && el !== editorElement
      ) : []
      const escapedContainers = composeBody ? Array.from(composeBody.querySelectorAll('.ql-container')).filter(el => 
        !editorElement.contains(el) && el !== editorElement
      ) : []
      
      const allToolbars = [...allQuillToolbars, ...siblingToolbars, ...escapedToolbars]
      const allContainers = [...allQuillContainers, ...siblingContainers, ...escapedContainers]
      
      // If we find ANY Quill elements anywhere, abort and clean up
      if (allToolbars.length > 0 || allContainers.length > 0) {
        console.warn(`Found Quill elements: ${allContainers.length} containers, ${allToolbars.length} toolbars - removing ALL`)
        
        // Remove ALL Quill elements from everywhere
        allContainers.forEach(el => {
          try { 
            if (el && el.parentNode) {
              el.parentNode.removeChild(el)
            }
          } catch(e) {}
        })
        allToolbars.forEach(el => {
          try { 
            if (el && el.parentNode) {
              el.parentNode.removeChild(el)
            }
          } catch(e) {}
        })
        
        // Clear WeakMap entry
        quillInstances.delete(editorElement)
        // Clear the element completely
        editorElement.innerHTML = ''
        quill = null
        quillInitialized = false
        editorElement.dataset.quillInitialized = 'false'
        isInitializingQuill = false
          window.__quillInitLock = false
        
        // Wait a moment for DOM to settle, then retry
        setTimeout(() => {
          if (!plainTextMode.value && !isInitializingQuill) {
            ensureEditor(0)
          }
        }, 150)
        return
      }
      
      // Check if element is marked as initialized
      if (editorElement.dataset.quillInitialized === 'true') {
        // Element is marked as initialized - check if Quill instance exists
        const existingQuill = quillInstances.get(editorElement)
        if (existingQuill && existingQuill.root && existingQuill.root.parentElement === editorElement) {
          quill = existingQuill
          if (!quill.isEnabled()) {
            quill.enable(true)
          }
          isInitializingQuill = false
          window.__quillInitLock = false
          return
        }
        // Marked but no instance - clear the mark and continue
        editorElement.dataset.quillInitialized = 'false'
      }
      
      // Check WeakMap for existing instance
      const existingQuill = quillInstances.get(editorElement)
      if (existingQuill && existingQuill.root && existingQuill.root.parentElement === editorElement) {
        quill = existingQuill
        if (!quill.isEnabled()) {
          quill.enable(true)
        }
        isInitializingQuill = false
          window.__quillInitLock = false
        return
      }
      
      // If we have a quill reference but it's not attached to this element, clean it up
      if (quill && quill.root && quill.root.parentElement !== editorElement) {
        quill = null
      }
      
      // Mark element as initializing to prevent concurrent calls (both local and global)
      editorElement.dataset.quillInitialized = 'initializing'
      isInitializingQuill = true
      window.__quillInitLock = true
      
      // Import Quill dynamically
      import('quill').then(({ default: Quill }) => {
        // Double-check we're not in plain text mode before initializing
        if (plainTextMode.value) {
          isInitializingQuill = false
          window.__quillInitLock = false
          window.__quillInitLock = false
          return
        }
        
        // Final check - make sure element still exists and is still empty
        const finalCheck = document.getElementById('c-editor')
        if (!finalCheck) {
          isInitializingQuill = false
          window.__quillInitLock = false
          window.__quillInitLock = false
          return
        }
        
        // Final safety check - if anything Quill-related exists ANYWHERE, abort
        const hasContainers = finalCheck.querySelector('.ql-container')
        const hasToolbars = finalCheck.querySelector('.ql-toolbar')
        const composeBody = finalCheck.closest('.compose-body')
        const hasEscapedToolbars = composeBody ? composeBody.querySelector('.ql-toolbar') : null
        
        if (hasContainers || hasToolbars || hasEscapedToolbars) {
          console.warn('Quill elements detected during initialization, aborting')
          isInitializingQuill = false
          window.__quillInitLock = false
          window.__quillInitLock = false
          editorElement.dataset.quillInitialized = 'false'
          return
        }
        
        // Clear the element completely before initializing
        finalCheck.innerHTML = ''
        
        // Final check - make absolutely sure no Quill elements exist
        if (finalCheck.querySelector('.ql-container') || finalCheck.querySelector('.ql-toolbar')) {
          console.warn('Quill elements detected at initialization time - aborting')
          finalCheck.dataset.quillInitialized = 'false'
          isInitializingQuill = false
          window.__quillInitLock = false
          window.__quillInitLock = false
          return
        }
        
        // Double-check the element is still the same and not marked as initialized
        if (finalCheck.dataset.quillInitialized === 'true') {
          console.warn('Element already marked as initialized - aborting')
          isInitializingQuill = false
          window.__quillInitLock = false
          window.__quillInitLock = false
          return
        }
        
        // Initialize Quill
        try {
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
          
          // Mark as initialized BEFORE storing in WeakMap
          finalCheck.dataset.quillInitialized = 'true'
          
          // Store in WeakMap for future reference
          quillInstances.set(editorElement, quill)

          // Sync Quill content to compose object
          quill.on('text-change', () => {
            if (quill && !plainTextMode.value) {
              // Mark that user is typing
              isUserTyping = true
              const html = quill.root.innerHTML
              const text = quill.getText()
              // Track this HTML so the watch handler can ignore it
              lastEmittedHtml = html
              isInitialLoad = false // User has started typing
              emit('update:compose', {
                ...props.compose,
                html: html,
                text: text
              })
              // Reset typing flag after a longer delay to prevent cursor reset
              setTimeout(() => {
                isUserTyping = false
              }, 500)
            }
          })
          
          // Also track focus/blur to prevent updates when user is interacting
          quill.on('selection-change', (range) => {
            if (range) {
              isUserTyping = true
              isInitialLoad = false
              setTimeout(() => {
                isUserTyping = false
              }, 300)
            }
          })
          
          // Track when user clicks/focuses the editor
          quill.root.addEventListener('focus', () => {
            isUserTyping = true
            isInitialLoad = false
            setTimeout(() => {
              isUserTyping = false
            }, 100)
          })
          
          // Mark as initialized
          quillInitialized = true
          
          // Release the lock immediately after successful initialization
          isInitializingQuill = false
          window.__quillInitLock = false
          window.__quillInitLock = false
          
          // Set initial content if it exists (for replies)
          if (props.compose.html && props.composeOpen && !plainTextMode.value) {
            setTimeout(() => {
              if (quill && props.compose.html && !plainTextMode.value) {
                quill.root.innerHTML = props.compose.html
                quill.setSelection(0)
              }
            }, 50)
          } else {
            // No initial content - ensure editor is ready and focusable
            setTimeout(() => {
              if (quill && !plainTextMode.value) {
                quill.focus()
              }
            }, 100)
          }
        } catch (error) {
          console.error('Failed to initialize Quill:', error)
          quill = null
          isInitializingQuill = false
          window.__quillInitLock = false
          // Retry initialization
          if (retries < 10) {
            setTimeout(() => ensureEditor(retries + 1), 100)
          }
        }
      }).catch((error) => {
        console.error('Failed to import Quill:', error)
        isInitializingQuill = false
          window.__quillInitLock = false
      })
    }

    onMounted(() => {
      if (props.composeOpen && !plainTextMode.value) {
        ensureEditor()
      }
    })

    watch(() => props.composeOpen, async (newValue) => {
      if (newValue) {
        // Reset initial load flag when panel opens (allows initial content to be set)
        isInitialLoad = true
        lastEmittedHtml = null
        lastEmittedPlainText = null
        isUserTyping = false
        
        // Wait for Vue to finish rendering
        await nextTick()
        await nextTick() // Double nextTick to ensure DOM is stable
        
        if (!plainTextMode.value) {
          // Clean up any existing Quill instances before initializing
          // But do it after Vue has rendered
          setTimeout(() => {
            const editorElement = document.getElementById('c-editor')
            if (editorElement) {
              const allQuillContainers = editorElement.querySelectorAll('.ql-container')
              const allQuillToolbars = editorElement.querySelectorAll('.ql-toolbar')
              if (allQuillContainers.length > 0 || allQuillToolbars.length > 0) {
                quill = null
                isInitializingQuill = false
          window.__quillInitLock = false
                // Let Quill reinitialize cleanly
              }
            }
            ensureEditor()
          }, 200)
        }
        
        // Wait for DOM to update
        await nextTick()
        const setContent = () => {
          if (plainTextMode.value) {
            // Plain text mode - set plain text content
            const text = props.compose.text || ''
            plainTextContent.value = text
            if (plainTextTextareaRef.value) {
              plainTextTextareaRef.value.focus()
            }
          } else if (quill) {
            // Set initial content if provided
            const html = props.compose.html
            const text = props.compose.text
            if (html && html.trim() && html !== '<p><br></p>' && html !== '<p></p>') {
              // Use Quill's clipboard to properly parse HTML
              const delta = quill.clipboard.convert(html)
              quill.setContents(delta)
              quill.setSelection(0)
              // Mark that content was set, so watch handler won't interfere
              isInitialLoad = false
              lastEmittedHtml = html
            } else if (text && text.trim()) {
              quill.setText(text)
              quill.setSelection(0)
              isInitialLoad = false
            } else {
              // No content provided - clear the editor to ensure it's empty
              const currentHtml = quill.root.innerHTML.trim()
              if (currentHtml && currentHtml !== '<p><br></p>' && currentHtml !== '<p></p>') {
                quill.setText('')
              quill.setSelection(0)
              }
            }
            quill.focus()
          } else if (!plainTextMode.value) {
            // Quill not ready yet, but we're in rich text mode - ensure it gets initialized and try again
            ensureEditor()
            setTimeout(setContent, 100)
          }
        }
        setTimeout(setContent, 200)
      } else {
        // Panel closed - clear the editor to prevent content persisting
        if (quill && !plainTextMode.value) {
          const currentHtml = quill.root.innerHTML.trim()
          if (currentHtml && currentHtml !== '<p><br></p>' && currentHtml !== '<p></p>') {
            quill.setText('')
            quill.setSelection(0)
          }
        }
        if (plainTextMode.value) {
          plainTextContent.value = ''
        }
        // Reset flags when panel closes
        isInitialLoad = true
        lastEmittedHtml = null
        lastEmittedPlainText = null
        isUserTyping = false
      }
    })
    
    // Watch for compose.html changes to update editor (for replies set after panel opens)
    // This should only update when HTML changes externally, not from Quill's own text-change events
    let lastEmittedHtml = null // Track the last HTML we emitted from Quill
    let isUserTyping = false // Track if user is actively typing
    let isInitialLoad = true // Track if this is the initial load
    
    watch(() => props.compose.html, (newHtml) => {
      if (!props.composeOpen) return
      
      // If this update matches what we just emitted from Quill, ignore it completely
      if (lastEmittedHtml !== null && lastEmittedHtml === newHtml) {
        return
      }
      
      if (plainTextMode.value) {
        // In plain text mode, only update if this is an external change (not from our own input)
        const newPlainText = newHtml && newHtml.trim() && newHtml !== '<p><br></p>' && newHtml !== '<p></p>'
          ? htmlToPlainText(newHtml)
          : ''
        
        // If this matches what we just emitted, ignore it (prevents cursor reset)
        if (lastEmittedPlainText !== null && lastEmittedPlainText === newPlainText) {
          return
        }
        
        // If user is typing or textarea has focus, don't update (prevents cursor reset)
        if (plainTextTextareaRef.value && (
          document.activeElement === plainTextTextareaRef.value ||
          isUserTyping
        )) {
          return
        }
        
        // Only update if this is an external change (like initial load or reply)
        if (isInitialLoad || !plainTextContent.value || plainTextContent.value.trim() === '') {
          plainTextContent.value = newPlainText
        }
        return
      }
      
      if (!quill) return
      
      // CRITICAL: If Quill has focus or user is typing, NEVER update (prevents cursor reset)
      const hasFocus = document.activeElement === quill.root || quill.root.contains(document.activeElement)
      if (hasFocus || isUserTyping) {
        return
      }
      
      // Get current HTML from Quill
      const currentHtml = quill.root.innerHTML.trim()
      
      // Normalize HTML for comparison (remove extra whitespace)
      const normalizedCurrent = currentHtml.replace(/\s+/g, ' ').trim()
      const normalizedNew = (newHtml || '').replace(/\s+/g, ' ').trim()
      
      // If the HTML hasn't actually changed (normalized), don't update (prevents cursor reset)
      if (normalizedCurrent === normalizedNew) {
        return
      }
      
      // CRITICAL: If user has ever typed (not initial load), NEVER update Quill content from watch
      // This prevents cursor reset during typing
      if (!isInitialLoad) {
        // User has typed before - only allow clearing, never content updates
        if (!newHtml || newHtml.trim() === '' || newHtml === '<p><br></p>' || newHtml === '<p></p>') {
          if (currentHtml && currentHtml !== '<p><br></p>' && currentHtml !== '<p></p>') {
            quill.setText('')
            quill.setSelection(0)
            lastEmittedHtml = null
          }
        }
        return
      }
      
      // CRITICAL: If editor has ANY real content, NEVER update from watch (prevents cursor reset)
      // Only allow updates when editor is truly empty (for initial load/replies)
      const isEmpty = !currentHtml || 
                      currentHtml === '<p><br></p>' || 
                      currentHtml === '<p></p>' ||
                      currentHtml === '<p></p><p></p>' ||
                      currentHtml.replace(/<[^>]*>/g, '').trim() === ''
      
      if (!isEmpty) {
        // Editor has content - don't update, user is probably typing
        isInitialLoad = false // Mark that content exists
        return
      }
      
      // If compose.html is cleared (empty), clear the editor
      if (!newHtml || newHtml.trim() === '' || newHtml === '<p><br></p>' || newHtml === '<p></p>') {
        if (currentHtml && currentHtml !== '<p><br></p>' && currentHtml !== '<p></p>') {
          quill.setText('')
          quill.setSelection(0)
        }
        lastEmittedHtml = null // Reset tracking
        isInitialLoad = false
        return
      }
      
      // Only update if editor is empty (for initial load/replies)
      if (isEmpty) {
        nextTick(() => {
          if (quill) {
            const selection = quill.getSelection()
            quill.root.innerHTML = newHtml
            // Preserve cursor position if possible, otherwise set to end
            if (selection) {
              const newLength = quill.getLength()
              quill.setSelection(Math.min(selection.index, newLength - 1))
            } else {
              quill.setSelection(quill.getLength() - 1)
            }
            // Update tracking to prevent feedback loop
            lastEmittedHtml = newHtml
            isInitialLoad = false
          }
        })
      }
    })

    // Watch for plain text mode changes to clean up Quill
    watch(() => plainTextMode.value, async (isPlainText) => {
      if (isPlainText) {
        // Switching to plain text - wait for Vue to update, then clean up
        await nextTick()
        setTimeout(() => {
          cleanupQuillInstances()
        }, 50)
      }
    })
    
    // Watch for sending to complete and clear editor on success
    let wasSending = false
    watch(() => props.sending, (isSending) => {
      if (wasSending && !isSending && props.composeOpen) {
        // Sending just completed - check if it was successful
        const status = props.composeStatus || ''
        // Clear the editor if status indicates success
        if (status === 'Sent.' || (status && !status.toLowerCase().includes('error') && !status.toLowerCase().includes('missing') && !status.toLowerCase().includes('failed'))) {
          // Success - clear the editor immediately
          if (plainTextMode.value) {
            plainTextContent.value = ''
          } else if (quill) {
            quill.setText('')
            quill.setSelection(0)
          }
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
      plainTextMode,
      plainTextContent,
      plainTextTextareaRef,
      showAutocomplete,
      toInputRef,
      currentQuery,
      shouldShowAutocomplete,
      selectEmail,
      insertSignature,
      togglePlainTextMode,
      updateComposeFromPlainText,
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
      isMobile,
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
      <div class="subject-row">
        <input id="c-subj" v-model="compose.subject" placeholder="Subject">
        <button type="button" class="btn-ghost plain-text-toggle" @click="togglePlainTextMode" :title="plainTextMode ? 'Switch to rich text editor' : 'Switch to plain text editor'">
          {{ plainTextMode ? 'Rich Text' : 'Plain Text' }}
        </button>
      </div>
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
      <div v-if="!plainTextMode" id="c-editor" class="editor"></div>
      <textarea
        v-else
        ref="plainTextTextareaRef"
        v-model="plainTextContent"
        @input="updateComposeFromPlainText"
        class="plain-text-editor"
        placeholder="Write your message in plain text…"
      ></textarea>
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

.subject-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: center;
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
  box-sizing: border-box;
}

.compose-body .plain-text-editor {
  flex: 1 1 auto;
  min-height: 0;
}

.compose-body #c-editor {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}

/* Hide Quill elements when in plain text mode */
.compose-body:has(.plain-text-editor) #c-editor,
.compose-body:has(.plain-text-editor) .ql-toolbar,
.compose-body:has(.plain-text-editor) .ql-container {
  display: none !important;
}

.plain-text-editor {
  width: 100%;
  min-height: 200px;
  max-height: 100%;
  padding: 12px 16px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  color: var(--text);
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', 'source-code-pro', monospace;
  font-size: 14px;
  line-height: 1.6;
  resize: none;
  outline: none;
  box-sizing: border-box;
  overflow-y: auto;
  flex: 1 1 auto;
  min-width: 0;
}

.plain-text-editor:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(var(--accent-rgb, 100, 150, 255), 0.1);
}

.plain-text-toggle {
  white-space: nowrap;
  flex-shrink: 0;
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
  display: flex;
  flex-wrap: wrap;
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

/* Mobile simplifications */
@media (max-width: 900px) {
  /* Hide signature section on mobile */
  .signature-field {
    display: none;
  }
  
  /* Hide complex toolbar items on mobile - only show bold, italic, and bullet list */
  .compose-body #c-editor :deep(.ql-toolbar .ql-picker.ql-header),
  .compose-body #c-editor :deep(.ql-toolbar .ql-underline),
  .compose-body #c-editor :deep(.ql-toolbar .ql-list[value="ordered"]),
  .compose-body #c-editor :deep(.ql-toolbar .ql-link),
  .compose-body #c-editor :deep(.ql-toolbar .ql-blockquote),
  .compose-body #c-editor :deep(.ql-toolbar .ql-code-block),
  .compose-body #c-editor :deep(.ql-toolbar .ql-clean) {
    display: none !important;
  }
  
  /* Simplify toolbar - larger buttons, less spacing */
  .compose-body #c-editor :deep(.ql-toolbar) {
    padding: 8px;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: center;
  }
  
  .compose-body #c-editor :deep(.ql-toolbar button),
  .compose-body #c-editor :deep(.ql-toolbar .ql-picker) {
    width: 44px;
    height: 44px;
    padding: 10px;
  }
  
  .compose-body #c-editor :deep(.ql-toolbar .ql-formats) {
    margin-right: 4px;
    padding-right: 4px;
    gap: 6px;
  }
  
  /* Larger editor text on mobile */
  .compose-body #c-editor :deep(.ql-editor) {
    font-size: 16px;
    padding: 12px;
    min-height: 200px;
  }
  
  /* Simplify header on mobile */
  .compose-header {
    padding: 10px 12px;
  }
  
  .compose-header label {
    font-size: 12px;
  }
  
  .compose-header input {
    font-size: 14px;
    padding: 8px 10px;
  }
  
  /* Larger send button on mobile */
  .compose-actions #c-send {
    padding: 12px 28px;
    font-size: 16px;
    font-weight: 600;
  }
  
  .compose-actions #c-cancel {
    width: 44px;
    height: 44px;
  }
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
