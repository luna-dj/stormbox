<script>
import { computed } from 'vue'
import Avatar from './Avatar.vue'

export default {
  name: 'ThreadEmailItem',
  components: {
    Avatar
  },
  props: {
    email: Object,
    selected: Boolean,
    isLast: Boolean,
    onClick: Function,
    onContextMenu: Function,
  },
  setup(props) {
    const sender = computed(() => props.email?.from?.[0] || {})
    const isUnread = computed(() => !props.email?.keywords?.$seen)
    const isStarred = computed(() => props.email?.keywords?.$flagged)

    const formatDate = (iso) => {
      try {
        return new Date(iso).toLocaleString()
      } catch {
        return iso || ""
      }
    }

    return {
      sender,
      isUnread,
      isStarred,
      formatDate,
    }
  }
}
</script>

<template>
  <div
    class="thread-email-item"
    :class="{ 
      selected: selected,
      unread: isUnread,
      'is-last': isLast
    }"
    @click="onClick"
    @contextmenu="onContextMenu && onContextMenu($event, email)"
  >
    <div class="thread-email-content">
      <!-- Thread line indicator -->
      <div class="thread-line">
        <div class="thread-line-vertical"></div>
        <div class="thread-line-dot"></div>
      </div>

      <!-- Avatar -->
      <Avatar 
        :name="sender.name" 
        :email="sender.email"
        class="thread-email-avatar"
      />

      <!-- Content -->
      <div class="thread-email-info">
        <div class="thread-email-header">
          <span class="thread-email-sender" :class="{ unread: isUnread }">
            {{ sender.name || sender.email || 'Unknown' }}
          </span>
          <div class="thread-email-icons">
            <span v-if="isStarred" class="star-icon">⭐</span>
            <span v-if="email.hasAttachment" class="attach-icon">📎</span>
          </div>
          <span class="thread-email-date">
            {{ formatDate(email.receivedAt) }}
          </span>
        </div>
        <div class="thread-email-preview">
          {{ email.preview || 'No preview available' }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.thread-email-item {
  position: relative;
  padding: 12px 16px 12px 48px;
  cursor: pointer;
  transition: background-color 0.15s;
  border-bottom: 1px solid var(--border);
}

.thread-email-item:last-child {
  border-bottom: none;
}

.thread-email-item:hover {
  background: var(--rowHover);
}

.thread-email-item.selected {
  background: var(--accent);
}

.thread-email-item.unread {
  background: var(--accent) / 0.3;
}

.thread-email-content {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  position: relative;
}

.thread-line {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.thread-line-vertical {
  width: 2px;
  flex: 1;
  background: var(--border);
  margin-top: 20px;
}

.thread-line-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--muted);
  border: 2px solid var(--bg);
  margin-top: -4px;
}

.thread-email-item.is-last .thread-line-vertical {
  display: none;
}

.thread-email-avatar {
  flex-shrink: 0;
}

.thread-email-info {
  flex: 1;
  min-width: 0;
}

.thread-email-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.thread-email-sender {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.thread-email-sender.unread {
  font-weight: 600;
  color: var(--text);
}

.thread-email-icons {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.star-icon, .attach-icon {
  font-size: 12px;
}

.thread-email-date {
  font-size: 11px;
  color: var(--muted);
  flex-shrink: 0;
  white-space: nowrap;
}

.thread-email-preview {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>