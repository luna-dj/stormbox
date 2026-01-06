<script>
import { computed } from 'vue'

export default {
  name: 'FolderSelector',
  props: {
    mailboxes: {
      type: Array,
      default: () => []
    },
    currentMailboxId: String,
    show: Boolean
  },
  emits: ['select-folder', 'close'],
  setup(props, { emit }) {
    const displayName = (m) => {
      const role = (m.role || "").toLowerCase();
      const mailboxName = (m.name || "").toLowerCase();
      if (role === "trash" || mailboxName === "deleted items" || mailboxName === "trash") return "Trash";
      if (role === "junk" || mailboxName === "spam" || mailboxName === "junk") return "Spam";
      if (role === "sent" || mailboxName === "sent" || mailboxName === "sent items") return "Sent";
      if (role === "drafts" || mailboxName === "drafts") return "Drafts";
      if (role === "archive" || mailboxName === "archive" || mailboxName === "archives") return "Archives";
      if (role === "inbox" || mailboxName === "inbox") return "Inbox";
      return m.name || "Mailbox";
    };

    const availableFolders = computed(() => {
      return props.mailboxes.filter(m => 
        m.id !== props.currentMailboxId && 
        (m.role || "").toLowerCase() !== "outbox"
      );
    });

    const selectFolder = (mailboxId) => {
      emit('select-folder', mailboxId);
      emit('close');
    };

    return {
      displayName,
      availableFolders,
      selectFolder
    }
  }
}
</script>

<template>
  <div v-if="show" class="folder-selector-overlay" @click.self="$emit('close')">
    <div class="folder-selector" @click.stop>
      <div class="folder-selector-header">
        <h3>Move to Folder</h3>
        <button class="close-btn" @click="$emit('close')" title="Close">×</button>
      </div>
      <div class="folder-list">
        <button
          v-for="mailbox in availableFolders"
          :key="mailbox.id"
          @click="selectFolder(mailbox.id)"
          class="folder-item"
        >
          {{ displayName(mailbox) }}
        </button>
        <div v-if="availableFolders.length === 0" class="no-folders">
          No other folders available
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.folder-selector-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.folder-selector {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  min-width: 300px;
  max-width: 400px;
  max-height: 500px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}

.folder-selector-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--border);
}

.folder-selector-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}

.close-btn {
  background: transparent;
  border: none;
  font-size: 24px;
  line-height: 1;
  color: var(--text);
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-btn:hover {
  color: var(--muted);
}

.folder-list {
  padding: 8px;
  overflow-y: auto;
  max-height: 400px;
}

.folder-item {
  width: 100%;
  padding: 12px 16px;
  text-align: left;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text);
  font-size: 14px;
  transition: background-color 0.15s;
}

.folder-item:hover {
  background: var(--rowHover);
}

.no-folders {
  padding: 20px;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}
</style>
