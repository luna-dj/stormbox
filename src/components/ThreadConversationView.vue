<script>
import { ref, computed, watch, onMounted } from 'vue'
import DOMPurify from 'dompurify'
import Avatar from './Avatar.vue'

export default {
  name: 'ThreadConversationView',
  components: {
    Avatar
  },
  props: {
    threadId: String,
    threadEmails: Array,
    initialEmailId: String,
    client: Object,
  },
  emits: ['back', 'reply', 'reply-all', 'forward', 'download', 'mark-as-read'],
  setup(props, { emit }) {
    const emails = ref([])
    const loading = ref(false)
    const expandedIds = ref(new Set())
    const allowExternalContent = ref(new Set())
    const hasBlockedContent = ref(new Set())
    const showOlder = ref(false)

    // Auto-expand most recent email when thread loads
    watch(() => emails.value, (newEmails) => {
      if (newEmails.length > 0) {
        const idsToExpand = new Set()
        
        // Always expand most recent
        idsToExpand.add(newEmails[0].id)
        expandedIds.value = idsToExpand
      }
    }, { immediate: true })

    const loadThread = async () => {
      if (props.threadEmails?.length) {
        emails.value = props.threadEmails
        return
      }
      if (!props.threadId || !props.client) return
      
      loading.value = true
      try {
        const threadEmails = await props.client.getThreadEmails(props.threadId)
        emails.value = threadEmails
      } catch (e) {
        console.error('[ThreadConversationView] Failed to load thread:', e)
      } finally {
        loading.value = false
      }
    }

    onMounted(() => {
      loadThread()
    })

    watch([() => props.threadId, () => props.threadEmails], () => {
      loadThread()
    })

    const toggleExpanded = (emailId) => {
      const next = new Set(expandedIds.value)
      if (next.has(emailId)) {
        next.delete(emailId)
      } else {
        next.add(emailId)
      }
      expandedIds.value = next
    }

    const toggleAllowExternal = (emailId) => {
      const next = new Set(allowExternalContent.value)
      next.add(emailId)
      allowExternalContent.value = next
    }

    const formatDate = (iso) => {
      try {
        return new Date(iso).toLocaleString()
      } catch {
        return iso || ""
      }
    }

    const getFileIcon = (name, type) => {
      const ext = name?.split('.').pop()?.toLowerCase()
      const mimeType = type?.toLowerCase()

      if (mimeType?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(ext || '')) {
        return '🖼️'
      }
      if (mimeType?.startsWith('video/') || ['mp4', 'avi', 'mov', 'wmv'].includes(ext || '')) {
        return '🎥'
      }
      if (mimeType?.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac'].includes(ext || '')) {
        return '🎵'
      }
      if (mimeType === 'application/pdf' || ext === 'pdf') {
        return '📄'
      }
      if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext || '')) {
        return '📦'
      }
      return '📎'
    }

    const formatFileSize = (bytes) => {
      if (!bytes) return ''
      const units = ['B', 'KB', 'MB', 'GB']
      let i = 0
      let size = Number(bytes)
      while (size >= 1024 && i < units.length - 1) {
        size /= 1024
        i++
      }
      return `${size.toFixed(i ? 1 : 0)} ${units[i]}`
    }

    const getEmailContent = (email) => {
      if (!email) return ''
      
      let htmlContent = email.bodyHtml || ''
      const textContent = email.bodyText || ''
      
      // If we have HTML, sanitize it
      if (htmlContent) {
        const purifier = (typeof window !== 'undefined' && (window.DOMPurify || window.dompurify)) ||
          (typeof DOMPurify !== 'undefined' ? DOMPurify : null)
        
        if (purifier) {
          const sanitizeConfig = {
            ADD_TAGS: ['style'],
            ADD_ATTR: ['target', 'style', 'class', 'width', 'height', 'align', 'valign', 'bgcolor', 'color'],
            FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'meta', 'link', 'base'],
            FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur', 'onchange', 'onsubmit'],
          }
          
          // Block external content if not allowed
          if (!allowExternalContent.value.has(email.id)) {
            let blocked = false
            DOMPurify.addHook('afterSanitizeAttributes', (node) => {
              if (node.tagName === 'IMG') {
                const src = node.getAttribute('src')
                if (src && (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//'))) {
                  node.setAttribute('data-blocked-src', src)
                  node.removeAttribute('src')
                  node.setAttribute('alt', '[Image blocked]')
                  blocked = true
                }
              }
              if (node.hasAttribute('style')) {
                const style = node.getAttribute('style')
                if (style && /url\s*\(/i.test(style)) {
                  const cleanStyle = style.replace(/url\s*\([^)]*\)/gi, 'none')
                  node.setAttribute('style', cleanStyle)
                  blocked = true
                }
              }
            })
            
            htmlContent = purifier.sanitize(htmlContent, sanitizeConfig)
            DOMPurify.removeHook('afterSanitizeAttributes')
            
            if (blocked) {
              hasBlockedContent.value.add(email.id)
            }
          } else {
            htmlContent = purifier.sanitize(htmlContent, sanitizeConfig)
          }
        }
        
        return htmlContent
      }
      
      // Plain text fallback
      if (textContent) {
        return textContent
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, '<br>')
          .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
      }
      
      // Fallback to preview
      if (email.preview) {
        return email.preview.replace(/\n/g, '<br>')
      }
      
      return ''
    }

    // Mark as read when email is expanded
    watch(() => expandedIds.value, (newExpanded) => {
      newExpanded.forEach(emailId => {
        const email = emails.value.find(e => e.id === emailId)
        if (email && !email.keywords?.$seen) {
          // Auto-mark as read after a short delay
          setTimeout(() => {
            emit('mark-as-read', emailId, true)
          }, 1000)
        }
      })
    }, { deep: true })

    return {
      emails,
      loading,
      expandedIds,
      showOlder,
      allowExternalContent,
      hasBlockedContent,
      toggleExpanded,
      toggleAllowExternal,
      formatDate,
      getFileIcon,
      formatFileSize,
      getEmailContent,
    }
  }
}
</script>

<template>
  <div class="thread-conversation-view">
    <!-- Header -->
    <div class="thread-header">
      <button class="back-btn" @click="emit('back')">
        ←
      </button>
      <div class="thread-header-info">
        <h1 class="thread-subject">
          {{ emails[0]?.subject || '(No Subject)' }}
        </h1>
        <p class="thread-count">
          {{ emails.length }} {{ emails.length === 1 ? 'message' : 'messages' }}
        </p>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="thread-loading">
      <div class="loading-spinner"></div>
      <p>Loading conversation...</p>
    </div>

    <!-- Email Cards -->
    <div v-else class="thread-emails">
      <button
        v-if="emails.length > 1"
        class="thread-toggle"
        @click="showOlder = !showOlder"
        type="button"
      >
        <span class="thread-toggle-icon">{{ showOlder ? 'v' : '>' }}</span>
        <span class="thread-toggle-text">
          {{ showOlder ? 'Hide earlier messages' : `Show earlier messages (${emails.length - 1})` }}
        </span>
      </button>

      <div v-for="(email, index) in emails" :key="email.id" class="email-card"
        :class="{ 
          expanded: expandedIds.has(email.id),
          unread: !email.keywords?.$seen,
          latest: index === 0
        }"
        v-show="index === 0 || showOlder">
        
        <!-- Card Header - Always visible -->
        <button class="email-card-header" @click="toggleExpanded(email.id)">
          <Avatar 
            :name="email.from?.[0]?.name" 
            :email="email.from?.[0]?.email"
            class="email-avatar"
          />
          <div class="email-header-info">
            <div class="email-header-top">
              <span class="email-sender" :class="{ unread: !email.keywords?.$seen }">
                {{ email.from?.[0]?.name || email.from?.[0]?.email || 'Unknown' }}
              </span>
              <span v-if="email.keywords?.$flagged" class="star-icon">⭐</span>
              <span v-if="email.hasAttachment" class="attach-icon">📎</span>
            </div>
            <div class="email-date">{{ formatDate(email.receivedAt) }}</div>
            <p v-if="!expandedIds.has(email.id)" class="email-preview">
              {{ email.preview || 'No preview available' }}
            </p>
          </div>
          <div class="email-expand-icon">
            {{ expandedIds.has(email.id) ? '▲' : '▼' }}
          </div>
        </button>

        <!-- Expanded Content -->
        <div v-if="expandedIds.has(email.id)" class="email-card-content">
          <!-- External content warning -->
          <div v-if="hasBlockedContent.has(email.id) && !allowExternalContent.has(email.id)" 
            class="external-content-warning">
            <span>External content blocked</span>
            <button class="allow-external-btn" @click.stop="toggleAllowExternal(email.id)">
              Load external content
            </button>
          </div>

          <!-- Email Body -->
          <div class="email-body" v-html="getEmailContent(email)"></div>

          <!-- Attachments -->
          <div v-if="email.attachments && email.attachments.length > 0" class="email-attachments">
            <div v-for="(attachment, idx) in email.attachments" :key="idx" 
              class="attachment-item"
              @click.stop="$emit('download', attachment.blobId, attachment.name, attachment.type)">
              <span class="attachment-icon">{{ getFileIcon(attachment.name, attachment.type) }}</span>
              <span class="attachment-name">{{ attachment.name || 'Attachment' }}</span>
              <span class="attachment-size">{{ formatFileSize(attachment.size) }}</span>
              <span class="download-icon">⬇️</span>
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="email-actions">
            <button class="action-btn" @click.stop="$emit('reply', email)">
              Reply
            </button>
            <button class="action-btn" @click.stop="$emit('reply-all', email)">
              Reply All
            </button>
            <button class="action-btn" @click.stop="$emit('forward', email)">
              Forward
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>


<style scoped>
.thread-conversation-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
}

.thread-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  position: sticky;
  top: 0;
  z-index: 10;
}

.back-btn {
  padding: 8px;
  border: none;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  font-size: 18px;
  border-radius: 4px;
  transition: background-color 0.15s;
}

.back-btn:hover {
  background: var(--rowHover);
}

.thread-header-info {
  flex: 1;
  min-width: 0;
}

.thread-subject {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.thread-count {
  font-size: 13px;
  color: var(--muted);
  margin: 2px 0 0 0;
}

.thread-loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--muted);
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.thread-emails {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.thread-toggle {
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  border-radius: 8px;
  padding: 8px 12px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  width: fit-content;
}

.thread-toggle:hover {
  background: var(--rowHover);
}

.thread-toggle-icon {
  font-weight: 600;
  font-size: 13px;
}

.thread-toggle-text {
  font-size: 13px;
}

.email-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  transition: all 0.2s;
  background: var(--panel2);
}

.email-card.unread:not(.expanded) {
  border-left: 3px solid var(--accent);
}

.email-card.expanded {
  background: var(--panel);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.email-card-header {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  text-align: left;
  border: none;
  background: transparent;
  cursor: pointer;
  transition: background-color 0.15s;
}

.email-card-header:hover {
  background: var(--rowHover);
}

.email-avatar {
  flex-shrink: 0;
}

.email-header-info {
  flex: 1;
  min-width: 0;
}

.email-header-top {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.email-sender {
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.email-sender.unread {
  color: var(--text);
  font-weight: 600;
}

.star-icon, .attach-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.email-date {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 4px;
}

.email-preview {
  font-size: 13px;
  color: var(--muted);
  margin: 4px 0 0 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.email-expand-icon {
  flex-shrink: 0;
  color: var(--muted);
  font-size: 12px;
}

.email-card-content {
  border-top: 1px solid var(--border);
  animation: slideDown 0.2s ease-out;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.external-content-warning {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--panel2);
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}

.external-content-warning span {
  color: var(--muted);
}

.allow-external-btn {
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  font-size: 12px;
  transition: background-color 0.15s;
}

.allow-external-btn:hover {
  background: var(--rowHover);
}

.email-body {
  padding: 16px;
  color: var(--text);
  line-height: 1.6;
  word-wrap: break-word;
}

.email-body :deep(p) {
  margin: 8px 0;
}

.email-body :deep(a) {
  color: var(--accent);
  text-decoration: none;
}

.email-body :deep(a:hover) {
  text-decoration: underline;
}

.email-body :deep(table) {
  border-collapse: collapse;
  width: 100%;
}

.email-body :deep(td),
.email-body :deep(th) {
  padding: 8px;
  border: 1px solid var(--border);
}

.email-body :deep(img) {
  max-width: 100%;
  height: auto;
}

.email-attachments {
  padding: 0 16px 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.attachment-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--panel2);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.15s;
  font-size: 13px;
}

.attachment-item:hover {
  background: var(--rowHover);
}

.attachment-icon {
  font-size: 16px;
}

.attachment-name {
  color: var(--text);
  max-width: 150px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.attachment-size {
  color: var(--muted);
  font-size: 11px;
}

.download-icon {
  font-size: 14px;
  color: var(--muted);
}

.email-actions {
  display: flex;
  gap: 8px;
  padding: 16px;
  border-top: 1px solid var(--border);
}

.action-btn {
  flex: 1;
  padding: 8px 16px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  font-size: 13px;
  transition: background-color 0.15s;
}

.action-btn:hover {
  background: var(--rowHover);
}
</style>
