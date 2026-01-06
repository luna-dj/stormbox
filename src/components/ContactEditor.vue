<script>
import { ref, watch, computed } from 'vue'

export default {
  name: 'ContactEditor',
  props: {
    open: Boolean,
    contact: Object, // null for new contact, or existing contact object
    saving: Boolean,
    status: String,
    addressBooks: {
      type: Array,
      default: () => []
    },
    selectedAddressBookId: {
      type: String,
      default: null
    }
  },
  emits: ['save', 'cancel', 'delete', 'select-address-book'],
  setup(props, { emit }) {
    const form = ref({
      firstName: '',
      lastName: '',
      name: '',
      email: '',
      emails: [],
      phone: '',
      company: '',
      jobTitle: '',
      notes: '',
      birthday: '',
      anniversary: ''
    })

    const emailInput = ref('')
    const emailsList = ref([])
    const manualAddressBookId = ref('')

    // Initialize form when contact changes
    watch(() => props.contact, (contact) => {
      if (contact) {
        form.value = {
          firstName: contact.firstName || '',
          lastName: contact.lastName || '',
          name: contact.name || '',
          email: contact.email || '',
          emails: contact.emails || [],
          phone: contact.phone || '',
          company: contact.company || '',
          jobTitle: contact.jobTitle || '',
          notes: contact.notes || '',
          birthday: contact.birthday ? contact.birthday.split('T')[0] : '',
          anniversary: contact.anniversary ? contact.anniversary.split('T')[0] : ''
        }
        emailsList.value = contact.emails || []
        if (contact.email && !emailsList.value.includes(contact.email)) {
          emailsList.value.push(contact.email)
        }
      } else {
        // Reset form for new contact
        form.value = {
          firstName: '',
          lastName: '',
          name: '',
          email: '',
          emails: [],
          phone: '',
          company: '',
          jobTitle: '',
          notes: '',
          birthday: '',
          anniversary: ''
        }
        emailsList.value = []
        emailInput.value = ''
      }
    }, { immediate: true })

    const isEditing = computed(() => !!props.contact)

    const addEmail = () => {
      const email = emailInput.value.trim()
      if (email && !emailsList.value.includes(email)) {
        emailsList.value.push(email)
        emailInput.value = ''
      }
    }

    const removeEmail = (index) => {
      emailsList.value.splice(index, 1)
    }

    const handleKeydown = (e) => {
      if (e.key === 'Enter' && e.target.type === 'text' && e.target.placeholder?.includes('Email')) {
        e.preventDefault()
        addEmail()
      }
    }

    const save = () => {
      // Build contact data
      const contactData = {
        firstName: form.value.firstName.trim() || null,
        lastName: form.value.lastName.trim() || null,
        name: form.value.name.trim() || form.value.firstName.trim() + ' ' + form.value.lastName.trim() || null,
        email: form.value.email.trim() || emailsList.value[0] || null,
        emails: emailsList.value.length > 0 ? emailsList.value : null,
        phone: form.value.phone.trim() || null,
        company: form.value.company.trim() || null,
        jobTitle: form.value.jobTitle.trim() || null,
        notes: form.value.notes.trim() || null,
        birthday: form.value.birthday || null,
        anniversary: form.value.anniversary || null
      }

      // Remove null values
      Object.keys(contactData).forEach(key => {
        if (contactData[key] === null || contactData[key] === '') {
          delete contactData[key]
        }
      })

      emit('save', contactData)
    }

    const cancel = () => {
      emit('cancel')
    }

    const deleteContact = () => {
      if (props.contact && confirm('Are you sure you want to delete this contact?')) {
        emit('delete', props.contact.id)
      }
    }

    return {
      form,
      emailInput,
      emailsList,
      isEditing,
      addEmail,
      removeEmail,
      handleKeydown,
      save,
      cancel,
      deleteContact
    }
  }
}
</script>

<template>
  <div v-if="open" class="contact-editor">
    <div class="editor-header">
      <h2>{{ isEditing ? 'Edit Contact' : 'New Contact' }}</h2>
      <div class="header-actions">
        <button v-if="isEditing" @click="deleteContact" class="btn-delete" :disabled="saving">
          Delete
        </button>
        <button @click="cancel" :disabled="saving">Cancel</button>
        <button @click="save" class="btn-save" :disabled="saving">
          {{ saving ? 'Saving...' : 'Save' }}
        </button>
      </div>
    </div>

    <div v-if="status" class="status" :class="{ error: status.includes('Failed') }">
      {{ status }}
    </div>

    <div class="editor-form">
      <!-- Address Book Selection (only for new contacts) -->
      <div v-if="!isEditing" class="form-group full-width">
        <label>Address Book</label>
        <select 
          v-if="addressBooks && addressBooks.length > 0"
          :value="selectedAddressBookId" 
          @change="$emit('select-address-book', $event.target.value)"
          class="address-book-select"
        >
          <option v-for="ab in addressBooks" :key="ab.id" :value="ab.id">
            {{ ab.name }}{{ ab.isDefault ? ' (Default)' : '' }}
          </option>
        </select>
        <div v-else-if="addressBooks === null" class="address-book-loading">
          Loading address books...
        </div>
        <div v-else class="address-book-error">
          <div>No address books found. You can manually enter an address book ID:</div>
          <input 
            type="text" 
            v-model="manualAddressBookId" 
            placeholder="Enter address book ID (e.g., 'b' or 't')"
            class="manual-address-book-input"
            @input="$emit('select-address-book', $event.target.value)"
          />
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>First Name</label>
          <input v-model="form.firstName" type="text" placeholder="First name" />
        </div>
        <div class="form-group">
          <label>Last Name</label>
          <input v-model="form.lastName" type="text" placeholder="Last name" />
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>Display Name</label>
          <input v-model="form.name" type="text" placeholder="Display name" />
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>Primary Email</label>
          <input v-model="form.email" type="email" placeholder="email@example.com" />
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>Additional Emails</label>
          <div class="email-list">
            <div v-for="(email, index) in emailsList" :key="index" class="email-tag">
              <span>{{ email }}</span>
              <button @click="removeEmail(index)" class="remove-email">×</button>
            </div>
            <div class="email-input-group">
              <input
                v-model="emailInput"
                type="email"
                placeholder="Add email (press Enter)"
                @keydown="handleKeydown"
              />
              <button @click="addEmail" class="btn-add-email">Add</button>
            </div>
          </div>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>Phone</label>
          <input v-model="form.phone" type="tel" placeholder="Phone number" />
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>Company</label>
          <input v-model="form.company" type="text" placeholder="Company" />
        </div>
        <div class="form-group">
          <label>Job Title</label>
          <input v-model="form.jobTitle" type="text" placeholder="Job title" />
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>Birthday</label>
          <input v-model="form.birthday" type="date" />
        </div>
        <div class="form-group">
          <label>Anniversary</label>
          <input v-model="form.anniversary" type="date" />
        </div>
      </div>

      <div class="form-row">
        <div class="form-group full-width">
          <label>Notes</label>
          <textarea v-model="form.notes" placeholder="Notes" rows="4"></textarea>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.contact-editor {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 20px;
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 15px;
  border-bottom: 1px solid var(--border);
}

.editor-header h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.header-actions button {
  padding: 8px 16px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel2);
  color: var(--text);
  cursor: pointer;
  font-size: 14px;
}

.header-actions button:hover:not(:disabled) {
  background: var(--hover);
}

.header-actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-save {
  background: var(--accent) !important;
  color: #fff !important;
  border-color: var(--accent) !important;
}

.btn-delete {
  background: #dc3545 !important;
  color: #fff !important;
  border-color: #dc3545 !important;
}

.status {
  padding: 10px;
  margin-bottom: 15px;
  border-radius: 6px;
  background: var(--panel2);
  color: var(--text);
  font-size: 14px;
}

.status.error {
  background: #fee;
  color: #c33;
}

.editor-form {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 15px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group.full-width {
  grid-column: 1 / -1;
}

.form-group label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}

.form-group input,
.form-group textarea,
.form-group select {
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel2);
  color: var(--text);
  font-size: 14px;
  font-family: inherit;
}

.address-book-select {
  width: 100%;
  cursor: pointer;
}

.address-book-loading {
  padding: 10px;
  color: var(--muted);
  font-size: 13px;
  font-style: italic;
}

.address-book-error {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.address-book-error > div:first-child {
  color: var(--muted);
  font-size: 13px;
}

.manual-address-book-input {
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel2);
  color: var(--text);
  font-size: 14px;
  font-family: inherit;
}

.manual-address-book-input:focus {
  outline: none;
  border-color: var(--accent);
}

.form-group input:focus,
.form-group textarea:focus {
  outline: none;
  border-color: var(--accent);
}

.form-group textarea {
  resize: vertical;
  min-height: 80px;
}

.email-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.email-tag {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: var(--panel2);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 14px;
}

.remove-email {
  background: none;
  border: none;
  color: var(--text);
  cursor: pointer;
  font-size: 20px;
  line-height: 1;
  padding: 0;
  margin-left: 10px;
  opacity: 0.6;
}

.remove-email:hover {
  opacity: 1;
}

.email-input-group {
  display: flex;
  gap: 8px;
}

.email-input-group input {
  flex: 1;
}

.btn-add-email {
  padding: 10px 16px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel2);
  color: var(--text);
  cursor: pointer;
  font-size: 14px;
  white-space: nowrap;
}

.btn-add-email:hover {
  background: var(--hover);
}
</style>
