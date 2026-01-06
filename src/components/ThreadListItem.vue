<script>
import { computed, ref } from 'vue'
import Avatar from './Avatar.vue'
import ThreadEmailItem from './ThreadEmailItem.vue'

export default {
  name: 'ThreadListItem',
  components: {
    Avatar,
    ThreadEmailItem
  },
  props: {
    thread: Object, // { threadId, emails: [], latestEmail, participantNames, hasUnread, hasStarred, hasAttachment, emailCount }
    isExpanded: Boolean,
    selectedEmailId: String,
    isLoading: Boolean,
    expandedEmails: Array, // Full thread emails when expanded
    showPreview: {
      type: Boolean,
      default: true
    }
  },
  emits: ['toggle-expand', 'email-select', 'context-menu'],
  setup(props, { emit }) {
    const isSelected = computed(() => {
      return props.selectedEmailId === props.thread.latestEmail.id ||
        props.thread.emails.some(e => e.id === props.selectedEmailId)
    })

    const handleHeaderClick = (e) => {
      const target = e.target
      if (target.closest('[data-expand-toggle]')) {
        emit('toggle-expand')
      } else {
        // Clicking on the row selects the latest email but also expands
        if (!props.isExpanded) {
          emit('toggle-expand')
        }
        emit('email-select', props.thread.latestEmail.id)
      }
    }

    const handleContextMenu = (e) => {
      emit('context-menu', e, props.thread.latestEmail)
    }

    const formatDate = (iso) => {
      try {
        return new Date(iso).toLocaleString()
      } catch {
        return iso || ""
      }
    }

    return {
      isSelected,
      handleHeaderClick,
      handleContextMenu,
      formatDate,
    }
  }
}
</script>

<template>
  <div class="thread-list-item" :class="{ expanded: isExpanded }">
    <!-- Single email thread - render as regular email, no expand -->
    <div v-if="thread.emailCount === 1" 
      class="single-email-item"
      :class="{ 
        selected: selectedEmailId === thread.latestEmail.id,
        unread: thread.hasUnread
      }"
      @click="$emit('email-select', thread.latestEmail.id)"
      @contextmenu="handleContextMenu">
      
      <div class="single-email-spacer"></div>
      
      <Avatar 
        :name="thread.latestEmail.from?.[0]?.name" 
        :email="thread.latestEmail.from?.[0]?.email"
        class="single-email-avatar"
      />
      
      <div class="single-email-content">
        <div class="single-email-header">
          <span class="single-email-sender" :class="{ unread: thread.hasUnread }">
            {{ thread.latestEmail.from?.[0]?.name || thread.latestEmail.from?.[0]?.email || 'Unknown' }}
          </span>
          <div class="single-email-icons">
            <span v-if="thread.hasStarred" class="star-icon">⭐</span>
            <span v-if="thread.hasAttachment" class="attach-icon">📎</span>
          </div>
          <span class="single-email-date">
            {{ formatDate(thread.latestEmail.receivedAt) }}
          </span>
        </div>
        <div class="single-email-subject" :class="{ unread: thread.hasUnread }">
          {{ thread.latestEmail.subject || '(no subject)' }}
        </div>
        <div v-if="showPreview" class="single-email-preview">
          {{ thread.latestEmail.preview || 'No preview available' }}
        </div>
      </div>
    </div>

    <!-- Multi-email thread -->
    <div v-else>
      <!-- Thread Header (collapsed view) -->
      <div
        class="thread-header"
        :class="{ 
          selected: isSelected,
          unread: thread.hasUnread,
          expanded: isExpanded
        }"
        @click="handleHeaderClick"
        @contextmenu="handleContextMenu"
      >
        <!-- Expand/Collapse Button -->
        <button
          data-expand-toggle
          @click.stop="$emit('toggle-expand')"
          class="expand-btn"
        >
          <span v-if="isLoading" class="loading-spinner">⟳</span>
          <span v-else>{{ isExpanded ? '▼' : '▶' }}</span>
        </button>

        <!-- Unread indicator -->
        <div v-if="thread.hasUnread" class="unread-indicator"></div>

        <!-- Avatar -->
        <Avatar
          :name="thread.latestEmail.from?.[0]?.name"
          :email="thread.latestEmail.from?.[0]?.email"
          class="thread-avatar"
        />

        <!-- Content -->
        <div class="thread-content">
          <!-- First Line: Participants and Date -->
          <div class="thread-header-top">
            <div class="thread-participants">
              <span class="participant-names" :class="{ unread: thread.hasUnread }">
                {{ thread.participantNames.join(', ') }}
              </span>
              <!-- Email count badge -->
              <span class="email-count-badge" :class="{ unread: thread.hasUnread }">
                {{ thread.emailCount }}
              </span>
              <div class="thread-icons">
                <span v-if="thread.hasStarred" class="star-icon">⭐</span>
                <span v-if="thread.hasAttachment" class="attach-icon">📎</span>
              </div>
            </div>
            <span class="thread-date" :class="{ unread: thread.hasUnread }">
              {{ formatDate(thread.latestEmail.receivedAt) }}
            </span>
          </div>

          <!-- Second Line: Subject -->
          <div class="thread-subject" :class="{ unread: thread.hasUnread }">
            {{ thread.latestEmail.subject || '(no subject)' }}
          </div>

          <!-- Third Line: Preview -->
          <div v-if="showPreview" class="thread-preview" :class="{ unread: thread.hasUnread }">
            {{ thread.latestEmail.preview || 'No preview available' }}
          </div>
        </div>
      </div>

      <!-- Expanded Thread Emails -->
      <div v-if="isExpanded" class="thread-expanded">
        <div v-if="isLoading" class="thread-loading">
          <span class="loading-spinner">⟳</span>
          Loading conversation...
        </div>
        <div v-else>
          <ThreadEmailItem
            v-for="(email, index) in (expandedEmails || thread.emails)"
            :key="email.id"
            :email="email"
            :selected="email.id === selectedEmailId"
            :is-last="index === (expandedEmails || thread.emails).length - 1"
            @click="$emit('email-select', email.id)"
            @context-menu="$emit('context-menu', $event, email)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.thread-list-item {
  border-bottom: 1px solid var(--border);
}

.thread-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  cursor: pointer;
  transition: background-color 0.15s;
  position: relative;
}

.thread-header:hover {
  background: var(--rowHover);
}

.thread-header.selected {
  background: var(--accent);
}

.thread-header.unread:not(.selected) {
  background: var(--accent) / 0.3;
}

.expand-btn {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.15s;
  font-size: 12px;
}

.expand-btn:hover {
  background: var(--panel2);
  color: var(--text);
}

.loading-spinner {
  display: inline-block;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.unread-indicator {
  position: absolute;
  left: 4px;
  top: 50%;
  transform: translateY(-50%);
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
}

.thread-avatar, .single-email-avatar {
  flex-shrink: 0;
}

.thread-content, .single-email-content {
  flex: 1;
  min-width: 0;
}

.thread-header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
}

.thread-participants {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.participant-names {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.participant-names.unread {
  font-weight: 600;
}

.email-count-badge {
  flex-shrink: 0;
  padding: 2px 6px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 10px;
  background: var(--muted);
  color: var(--text);
}

.email-count-badge.unread {
  background: var(--accent);
  color: var(--bg);
}

.thread-icons {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.star-icon, .attach-icon {
  font-size: 12px;
}

.thread-date {
  font-size: 11px;
  color: var(--muted);
  flex-shrink: 0;
  white-space: nowrap;
}

.thread-date.unread {
  color: var(--text);
  font-weight: 500;
}

.thread-subject {
  font-size: 13px;
  font-weight: 400;
  color: var(--text);
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.thread-subject.unread {
  font-weight: 600;
}

.thread-preview {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.thread-preview.unread {
  color: var(--muted);
}

.thread-expanded {
  background: var(--panel2);
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

.thread-loading {
  padding: 16px;
  text-align: center;
  color: var(--muted);
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

/* Single email item styles */
.single-email-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  cursor: pointer;
  transition: background-color 0.15s;
  position: relative;
}

.single-email-item:hover {
  background: var(--rowHover);
}

.single-email-item.selected {
  background: var(--accent);
}

.single-email-item.unread:not(.selected) {
  background: var(--accent) / 0.3;
}

.single-email-spacer {
  width: 24px;
  flex-shrink: 0;
}

.single-email-content {
  flex: 1;
  min-width: 0;
}

.single-email-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.single-email-sender {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.single-email-sender.unread {
  font-weight: 600;
}

.single-email-icons {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.single-email-date {
  font-size: 11px;
  color: var(--muted);
  flex-shrink: 0;
  white-space: nowrap;
}

.single-email-subject {
  font-size: 13px;
  font-weight: 400;
  color: var(--text);
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.single-email-subject.unread {
  font-weight: 600;
}

.single-email-preview {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>