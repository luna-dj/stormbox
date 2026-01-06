<script>
export default {
  name: 'DraftsList',
  props: {
    drafts: {
      type: Array,
      default: () => []
    },
    loading: Boolean
  },
  emits: ['resume-draft'],
  setup(props, { emit }) {
    const formatDate = (dateStr) => {
      if (!dateStr) return '';
      const date = new Date(dateStr);
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const formatRecipients = (to) => {
      if (!to || to.length === 0) return 'No recipients';
      if (to.length === 1) {
        return to[0].name ? `${to[0].name} <${to[0].email}>` : to[0].email;
      }
      return `${to.length} recipients`;
    };

    const resumeDraft = (draft) => {
      emit('resume-draft', draft.id);
    };

    return {
      formatDate,
      formatRecipients,
      resumeDraft
    }
  }
}
</script>

<template>
  <div class="drafts-list">
    <div class="drafts-header">
      <h3>Drafts</h3>
      <button 
        v-if="drafts.length > 0" 
        @click="$emit('refresh')" 
        class="refresh-btn"
        title="Refresh drafts"
      >
        ↻
      </button>
    </div>
    
    <div v-if="loading" class="drafts-loading">
      Loading drafts...
    </div>
    
    <div v-else-if="drafts.length === 0" class="drafts-empty">
      No drafts
    </div>
    
    <div v-else class="drafts-items">
      <button
        v-for="draft in drafts"
        :key="draft.id"
        @click="resumeDraft(draft)"
        class="draft-item"
        :title="`Resume: ${draft.subject}`"
      >
        <div class="draft-subject">{{ draft.subject }}</div>
        <div class="draft-meta">
          <span class="draft-to">{{ formatRecipients(draft.to) }}</span>
          <span class="draft-date">{{ formatDate(draft.sentAt) }}</span>
        </div>
        <div v-if="draft.preview" class="draft-preview">{{ draft.preview }}</div>
      </button>
    </div>
  </div>
</template>

<style scoped>
.drafts-list {
  padding: 12px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}

.drafts-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.drafts-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.refresh-btn {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 8px;
  cursor: pointer;
  color: var(--text);
  font-size: 14px;
}

.refresh-btn:hover {
  background: var(--rowHover);
}

.drafts-loading,
.drafts-empty {
  padding: 20px;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}

.drafts-items {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.draft-item {
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel2);
  cursor: pointer;
  text-align: left;
  transition: background-color 0.15s;
}

.draft-item:hover {
  background: var(--rowHover);
}

.draft-subject {
  font-weight: 500;
  font-size: 13px;
  color: var(--text);
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.draft-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 4px;
}

.draft-to {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  margin-right: 8px;
}

.draft-date {
  flex-shrink: 0;
}

.draft-preview {
  font-size: 12px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 4px;
}
</style>
