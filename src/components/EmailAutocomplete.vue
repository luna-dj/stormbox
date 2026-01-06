<script>
import { computed } from 'vue'

export default {
  name: 'EmailAutocomplete',
  props: {
    query: {
      type: String,
      required: true
    },
    contacts: {
      type: Array,
      default: () => []
    },
    show: {
      type: Boolean,
      default: false
    }
  },
  emits: ['select'],
  setup(props, { emit }) {
    const suggestions = computed(() => {
      if (!props.query || props.query.trim().length === 0) {
        return []
      }
      
      const queryLower = props.query.toLowerCase().trim()
      const lastComma = props.query.lastIndexOf(',')
      const currentQuery = lastComma >= 0 
        ? props.query.substring(lastComma + 1).trim() 
        : props.query.trim()
      
      if (currentQuery.length === 0) {
        return []
      }
      
      const queryLowerCurrent = currentQuery.toLowerCase()
      
      return props.contacts
        .filter(contact => {
          const email = contact.email || contact.emails?.[0] || ''
          const name = contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`.trim()
          
          return email.toLowerCase().includes(queryLowerCurrent) ||
                 name.toLowerCase().includes(queryLowerCurrent)
        })
        .slice(0, 10) // Limit to 10 suggestions
        .map(contact => ({
          name: contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.email || contact.emails?.[0] || 'Unknown',
          email: contact.email || contact.emails?.[0] || ''
        }))
        .filter(contact => contact.email) // Only include contacts with emails
    })
    
    const selectContact = (contact) => {
      emit('select', contact.email)
    }
    
    return {
      suggestions,
      selectContact
    }
  }
}
</script>

<template>
  <div 
    v-if="show && suggestions.length > 0" 
    class="email-autocomplete"
  >
    <button
      v-for="(contact, index) in suggestions"
      :key="index"
      type="button"
      @click="selectContact(contact)"
      class="autocomplete-item"
    >
      <svg class="mail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
        <polyline points="22,6 12,13 2,6"/>
      </svg>
      <div class="contact-info">
        <div class="contact-name">{{ contact.name }}</div>
        <div class="contact-email">{{ contact.email }}</div>
      </div>
    </button>
  </div>
</template>

<style scoped>
.email-autocomplete {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 4px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  max-height: 240px;
  overflow-y: auto;
}

.autocomplete-item {
  width: 100%;
  padding: 12px 16px;
  text-align: left;
  background: transparent;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 12px;
  transition: background-color 0.15s;
  color: var(--text);
}

.autocomplete-item:hover {
  background: var(--rowHover);
}

.autocomplete-item:first-child {
  border-top-left-radius: 6px;
  border-top-right-radius: 6px;
}

.autocomplete-item:last-child {
  border-bottom-left-radius: 6px;
  border-bottom-right-radius: 6px;
}

.mail-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--muted);
}

.contact-info {
  flex: 1;
  min-width: 0;
}

.contact-name {
  font-weight: 500;
  font-size: 14px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 2px;
}

.contact-email {
  font-size: 12px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
