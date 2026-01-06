<script>
import { ref, computed } from 'vue'

export default {
  name: 'ContactManager',
  props: {
    contacts: {
      type: Array,
      default: () => []
    },
    selectedContactId: String
  },
  emits: ['select-contact', 'new-contact', 'edit-contact', 'delete-contact'],
  setup(props, { emit }) {
    const filterText = ref('')
    const sortBy = ref('name') // 'name', 'email', 'company'
    const sortOrder = ref('asc') // 'asc', 'desc'

    const filteredAndSortedContacts = computed(() => {
      let result = [...props.contacts]

      // Filter
      if (filterText.value) {
        const ft = filterText.value.toLowerCase()
        result = result.filter(contact => {
          const name = (contact.name || contact.firstName + ' ' + contact.lastName || '').toLowerCase()
          const email = (contact.email || contact.emails?.[0] || '').toLowerCase()
          const company = (contact.company || '').toLowerCase()
          return name.includes(ft) || email.includes(ft) || company.includes(ft)
        })
      }

      // Sort
      result.sort((a, b) => {
        let aVal = ''
        let bVal = ''

        if (sortBy.value === 'name') {
          aVal = (a.name || a.firstName + ' ' + a.lastName || '').toLowerCase()
          bVal = (b.name || b.firstName + ' ' + b.lastName || '').toLowerCase()
        } else if (sortBy.value === 'email') {
          aVal = (a.email || a.emails?.[0] || '').toLowerCase()
          bVal = (b.email || b.emails?.[0] || '').toLowerCase()
        } else if (sortBy.value === 'company') {
          aVal = (a.company || '').toLowerCase()
          bVal = (b.company || '').toLowerCase()
        }

        const comparison = aVal.localeCompare(bVal)
        return sortOrder.value === 'asc' ? comparison : -comparison
      })

      return result
    })

    const getDisplayName = (contact) => {
      if (contact.name) return contact.name
      const firstName = contact.firstName || ''
      const lastName = contact.lastName || ''
      const fullName = (firstName + ' ' + lastName).trim()
      return fullName || contact.email || contact.emails?.[0] || 'Unnamed Contact'
    }

    const getDisplayEmail = (contact) => {
      return contact.email || contact.emails?.[0] || ''
    }

    const selectContact = (contact) => {
      emit('select-contact', contact)
    }

    const editContact = (contact, e) => {
      e.stopPropagation()
      emit('edit-contact', contact)
    }

    const deleteContact = (contact, e) => {
      e.stopPropagation()
      emit('delete-contact', contact)
    }

    const newContact = () => {
      emit('new-contact')
    }

    return {
      filterText,
      sortBy,
      sortOrder,
      filteredAndSortedContacts,
      getDisplayName,
      getDisplayEmail,
      selectContact,
      editContact,
      deleteContact,
      newContact
    }
  }
}
</script>

<template>
  <div class="contact-manager">
    <!-- Header -->
    <div class="manager-header">
      <h2>Contacts</h2>
      <button class="btn-new" @click="newContact" title="New Contact">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 0H4a4 4 0 00-4 4v16a4 4 0 004 4h16a4 4 0 004-4V4a4 4 0 00-4-4zm-2 12h-6v6h-4v-6H4v-4h4V2h4v6h6v4z"/>
        </svg>
        New
      </button>
    </div>

    <!-- Filter and Sort -->
    <div class="manager-controls">
      <div class="filter-group">
        <input
          v-model="filterText"
          type="text"
          placeholder="Search contacts..."
          class="filter-input"
        />
      </div>
      <div class="sort-group">
        <select v-model="sortBy" class="sort-select">
          <option value="name">Sort by Name</option>
          <option value="email">Sort by Email</option>
          <option value="company">Sort by Company</option>
        </select>
        <button
          @click="sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'"
          class="sort-toggle"
          :title="sortOrder === 'asc' ? 'Ascending' : 'Descending'"
        >
          <svg v-if="sortOrder === 'asc'" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 14l5-5 5 5z"/>
          </svg>
          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 10l5 5 5-5z"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Contact Count -->
    <div class="contact-count">
      {{ filteredAndSortedContacts.length }} of {{ contacts.length }} contact{{ contacts.length !== 1 ? 's' : '' }}
    </div>

    <!-- Contact List -->
    <div class="contact-list">
      <div
        v-for="contact in filteredAndSortedContacts"
        :key="contact.id"
        class="contact-item"
        :class="{ active: selectedContactId === contact.id }"
        @click="selectContact(contact)"
      >
        <div class="contact-avatar">
          <div class="avatar-circle">
            {{ getDisplayName(contact).charAt(0).toUpperCase() }}
          </div>
        </div>
        <div class="contact-info">
          <div class="contact-name">{{ getDisplayName(contact) }}</div>
          <div class="contact-email" v-if="getDisplayEmail(contact)">
            {{ getDisplayEmail(contact) }}
          </div>
          <div class="contact-company" v-if="contact.company">
            {{ contact.company }}
            <span v-if="contact.jobTitle"> • {{ contact.jobTitle }}</span>
          </div>
        </div>
        <div class="contact-actions">
          <button
            @click="editContact(contact, $event)"
            class="btn-action"
            title="Edit"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
            </svg>
          </button>
          <button
            @click="deleteContact(contact, $event)"
            class="btn-action btn-delete"
            title="Delete"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
          </button>
        </div>
      </div>

      <div v-if="filteredAndSortedContacts.length === 0" class="empty-state">
        <p v-if="filterText">{{ filterText ? 'No contacts match your search.' : 'No contacts found.' }}</p>
        <p v-else>No contacts yet. Click "New" to create your first contact.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.contact-manager {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-height: 100%;
  overflow: hidden;
  background: var(--panel);
  border-right: 1px solid var(--border);
}

.manager-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--border);
}

.manager-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.btn-new {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--accent);
  color: #fff;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}

.btn-new:hover {
  opacity: 0.9;
}

.manager-controls {
  display: flex;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.filter-group {
  flex: 1;
}

.filter-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel2);
  color: var(--text);
  font-size: 13px;
}

.filter-input:focus {
  outline: none;
  border-color: var(--accent);
}

.sort-group {
  display: flex;
  gap: 4px;
  align-items: center;
}

.sort-select {
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel2);
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
}

.sort-toggle {
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel2);
  color: var(--text);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.sort-toggle:hover {
  background: var(--hover);
}

.contact-count {
  padding: 8px 16px;
  font-size: 12px;
  color: var(--muted);
  border-bottom: 1px solid var(--border);
}

.contact-list {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
}

/* Custom scrollbar for contact list */
.contact-list::-webkit-scrollbar {
  width: 14px;
}

.contact-list::-webkit-scrollbar-track {
  background: var(--panel2);
  border-left: 1px solid var(--border);
}

.contact-list::-webkit-scrollbar-thumb {
  background: #6b7280;
  border-radius: 7px;
  border: 3px solid var(--panel2);
  min-height: 40px;
}

.contact-list::-webkit-scrollbar-thumb:hover {
  background: #9ca3af;
}

/* Dark mode scrollbar */
:root[data-theme="dark"] .contact-list::-webkit-scrollbar-thumb,
[data-theme="dark"] .contact-list::-webkit-scrollbar-thumb {
  background: #9aa3b2;
}

:root[data-theme="dark"] .contact-list::-webkit-scrollbar-thumb:hover,
[data-theme="dark"] .contact-list::-webkit-scrollbar-thumb:hover {
  background: #cbd5e1;
}

/* Light mode scrollbar */
:root[data-theme="light"] .contact-list::-webkit-scrollbar-thumb,
[data-theme="light"] .contact-list::-webkit-scrollbar-thumb {
  background: #9ca3af;
}

:root[data-theme="light"] .contact-list::-webkit-scrollbar-thumb:hover,
[data-theme="light"] .contact-list::-webkit-scrollbar-thumb:hover {
  background: #6b7280;
}

/* Firefox scrollbar */
.contact-list {
  scrollbar-width: auto;
  scrollbar-color: #9aa3b2 var(--panel2);
}

:root[data-theme="light"] .contact-list,
[data-theme="light"] .contact-list {
  scrollbar-color: #9ca3af var(--panel2);
}

.contact-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background-color 0.15s;
}

.contact-item:hover {
  background: var(--rowHover);
}

.contact-item.active {
  background: var(--rowActive);
}

.contact-avatar {
  flex-shrink: 0;
}

.avatar-circle {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 16px;
}

.contact-info {
  flex: 1;
  min-width: 0;
}

.contact-name {
  font-weight: 500;
  font-size: 14px;
  color: var(--text);
  margin-bottom: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contact-email {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contact-company {
  font-size: 12px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contact-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s;
}

.contact-item:hover .contact-actions {
  opacity: 1;
}

.btn-action {
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--panel2);
  color: var(--text);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-action:hover {
  background: var(--hover);
}

.btn-delete:hover {
  background: #fee;
  border-color: #fcc;
  color: #c33;
}

.empty-state {
  padding: 40px 20px;
  text-align: center;
  color: var(--muted);
  font-size: 14px;
}

.empty-state p {
  margin: 0;
}
</style>
