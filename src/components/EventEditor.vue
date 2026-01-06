<script>
import { ref, computed, watch, inject } from 'vue'
import { useCalendarStore } from '../composables/useCalendarStore.js'
import { useEmailStore } from '../composables/useEmailStore.js'

export default {
  name: 'EventEditor',
  props: {
    open: Boolean,
    event: Object, // null for new event
  },
  emits: ['close', 'save', 'delete'],
  setup(props, { emit }) {
    // Get calendarStore from parent via inject
    const emailStore = inject('emailStore', null)
    let calendarStoreRef = inject('calendarStore', null)
    
    if (!calendarStoreRef) {
      console.warn('[EventEditor] calendarStore not found via inject, creating new instance')
      // Fallback: create a new one if inject fails
      const fallbackStore = emailStore ? useCalendarStore(emailStore) : useCalendarStore()
      calendarStoreRef = ref(fallbackStore)
    }

    const title = ref('')
    const description = ref('')
    const location = ref('')
    const startDate = ref('')
    const startTime = ref('')
    const endDate = ref('')
    const endTime = ref('')
    const calendarId = ref('')
    const allDay = ref(false)

    const isEditing = computed(() => !!props.event)

    const readValue = (value) => (value && typeof value === 'object' && 'value' in value ? value.value : value)
    const calendarStore = computed(() => readValue(calendarStoreRef) || null)

    const formatDateInput = (date) => {
      const d = date instanceof Date ? date : new Date(date)
      if (Number.isNaN(d.getTime())) return ''
      const pad = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    }

    const formatTimeInput = (date) => {
      const d = date instanceof Date ? date : new Date(date)
      if (Number.isNaN(d.getTime())) return ''
      const pad = (n) => String(n).padStart(2, '0')
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`
    }

    // Initialize form from event
    watch(() => props.event, (event) => {
      if (event) {
        title.value = event.title || ''
        description.value = event.description || ''
        location.value = event.location || ''
        calendarId.value = event.calendarId || ''
        allDay.value = event.showWithoutTime || false

        const start = new Date(event.start)
        const end = new Date(event.end || event.start)
        
        startDate.value = formatDateInput(start)
        startTime.value = formatTimeInput(start)
        endDate.value = formatDateInput(end)
        endTime.value = formatTimeInput(end)
      } else {
        // Reset for new event
        const now = new Date()
        title.value = ''
        description.value = ''
        location.value = ''
        startDate.value = formatDateInput(now)
        startTime.value = formatTimeInput(now)
        endDate.value = formatDateInput(now)
        endTime.value = formatTimeInput(new Date(now.getTime() + 60 * 60 * 1000)) // +1 hour
        calendarId.value = readValue(calendarStore.value?.selectedCalendarIds)?.[0] ||
          readValue(calendarStore.value?.calendars)?.[0]?.id ||
          ''
        allDay.value = false
      }
    }, { immediate: true })

    const save = async () => {
      if (!title.value.trim()) {
        alert('Please enter a title')
        return
      }

      const startLocal = `${startDate.value}T${allDay.value ? '00:00' : startTime.value}:00`
      const endLocal = `${endDate.value}T${allDay.value ? '23:59' : endTime.value}:00`
      const start = new Date(startLocal)
      const end = new Date(endLocal)

      if (end <= start) {
        alert('End time must be after start time')
        return
      }

      const eventData = {
        calendarId: calendarId.value || readValue(calendarStore.value?.calendars)?.[0]?.id,
        title: title.value.trim(),
        description: description.value.trim(),
        location: location.value.trim(),
        start: startLocal,
        end: endLocal,
        showWithoutTime: allDay.value,
      }

      try {
        if (isEditing.value) {
          await calendarStore.value?.updateEvent?.(props.event.id, eventData)
        } else {
          await calendarStore.value?.createEvent?.(eventData)
        }
        emit('save')
        emit('close')
      } catch (e) {
        alert(`Failed to save event: ${e.message}`)
      }
    }

    const deleteEvent = async () => {
      if (!confirm('Are you sure you want to delete this event?')) return

      try {
        await calendarStore.value?.deleteEvent?.(props.event.id)
        emit('delete')
        emit('close')
      } catch (e) {
        alert(`Failed to delete event: ${e.message}`)
      }
    }

    return {
      title,
      description,
      location,
      startDate,
      startTime,
      endDate,
      endTime,
      calendarId,
      allDay,
      isEditing,
      calendars: computed(() => readValue(calendarStore.value?.calendars) || []),
      save,
      deleteEvent,
    }
  }
}
</script>

<template>
  <div v-if="open" class="event-editor-overlay" @click.self="$emit('close')">
    <div class="event-editor">
      <div class="event-editor-header">
        <h2>{{ isEditing ? 'Edit Event' : 'New Event' }}</h2>
        <button class="close-btn" @click="$emit('close')">×</button>
      </div>

      <div class="event-editor-form">
        <div class="form-group">
          <label>Title *</label>
          <input v-model="title" type="text" placeholder="Event title" />
        </div>

        <div class="form-group">
          <label>Calendar</label>
          <select v-model="calendarId">
            <option v-for="cal in calendars" :key="cal.id" :value="cal.id">
              {{ cal.name }}
            </option>
          </select>
        </div>

        <div class="form-group">
          <label>
            <input type="checkbox" v-model="allDay" />
            All day
          </label>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>Start Date</label>
            <input v-model="startDate" type="date" />
          </div>
          <div class="form-group" v-if="!allDay">
            <label>Start Time</label>
            <input v-model="startTime" type="time" />
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>End Date</label>
            <input v-model="endDate" type="date" />
          </div>
          <div class="form-group" v-if="!allDay">
            <label>End Time</label>
            <input v-model="endTime" type="time" />
          </div>
        </div>

        <div class="form-group">
          <label>Location</label>
          <input v-model="location" type="text" placeholder="Event location" />
        </div>

        <div class="form-group">
          <label>Description</label>
          <textarea v-model="description" rows="4" placeholder="Event description"></textarea>
        </div>
      </div>

      <div class="event-editor-actions">
        <button v-if="isEditing" class="btn-delete" @click="deleteEvent">Delete</button>
        <div class="action-buttons">
          <button class="btn-cancel" @click="$emit('close')">Cancel</button>
          <button class="btn-save" @click="save">Save</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.event-editor-overlay {
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

.event-editor {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  width: 90%;
  max-width: 600px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}

.event-editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--border);
}

.event-editor-header h2 {
  margin: 0;
  font-size: 18px;
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
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.close-btn:hover {
  background: var(--rowHover);
}

.event-editor-form {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
}

.form-group input[type="checkbox"] {
  margin-right: 8px;
}

.form-group input,
.form-group select,
.form-group textarea {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 14px;
}

.form-group textarea {
  resize: vertical;
  font-family: inherit;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.event-editor-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-top: 1px solid var(--border);
}

.action-buttons {
  display: flex;
  gap: 8px;
}

.btn-cancel,
.btn-save,
.btn-delete {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}

.btn-cancel {
  background: transparent;
  color: var(--text);
  border: 1px solid var(--border);
}

.btn-cancel:hover {
  background: var(--rowHover);
}

.btn-save {
  background: var(--accent);
  color: white;
}

.btn-save:hover {
  filter: brightness(1.1);
}

.btn-delete {
  background: #ef4444;
  color: white;
}

.btn-delete:hover {
  background: #dc2626;
}
</style>
