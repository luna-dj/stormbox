<script>
import { computed, onMounted, onUnmounted, ref, watch, inject } from 'vue'
import { useCalendarStore } from '../composables/useCalendarStore.js'
import { useEmailStore } from '../composables/useEmailStore.js'

export default {
  name: 'CalendarView',
  setup() {
    // Get calendarStore from parent via inject
    const emailStore = inject('emailStore', null)
    let calendarStore = inject('calendarStore', null)
    
    if (!calendarStore) {
      console.warn('[CalendarView] calendarStore not found via inject, creating new instance')
      // Fallback: create a new one if inject fails
      calendarStore = emailStore ? useCalendarStore(emailStore) : useCalendarStore()
    }

    // Initialize on mount
    onMounted(async () => {
      try {
        if (calendarStore.calendars.length === 0) {
          await calendarStore.refreshCalendars()
        }
        await calendarStore.refreshEvents()
      } catch (e) {
        console.error('[CalendarView] Failed to initialize:', e)
      }
    })

    const contextMenuOpen = ref(false)
    const contextMenuX = ref(0)
    const contextMenuY = ref(0)
    const contextMenuEvent = ref(null)

    const closeEventMenu = () => {
      contextMenuOpen.value = false
      contextMenuEvent.value = null
    }

    const openEventMenu = (evt, calendarEvent) => {
      evt.preventDefault()
      contextMenuX.value = evt.clientX
      contextMenuY.value = evt.clientY
      contextMenuEvent.value = calendarEvent
      contextMenuOpen.value = true
    }

    const editEventFromMenu = () => {
      if (!contextMenuEvent.value) return
      calendarStore.openEventEditor(contextMenuEvent.value)
      closeEventMenu()
    }

    const deleteEventFromMenu = async () => {
      if (!contextMenuEvent.value) return
      if (!confirm('Delete this event?')) return
      try {
        await calendarStore.deleteEvent(contextMenuEvent.value.id)
      } finally {
        closeEventMenu()
      }
    }

    const handleGlobalKey = (evt) => {
      if (evt.key === 'Escape') {
        closeEventMenu()
      }
    }

    onMounted(() => {
      window.addEventListener('click', closeEventMenu)
      window.addEventListener('keydown', handleGlobalKey)
    })

    onUnmounted(() => {
      window.removeEventListener('click', closeEventMenu)
      window.removeEventListener('keydown', handleGlobalKey)
    })

    // Watch for date changes
    watch(() => calendarStore.currentDate, () => {
      calendarStore.refreshEvents()
    })

    // Format date helpers
    const formatDate = (date) => {
      return new Date(date).toLocaleDateString()
    }

    const formatTime = (date) => {
      return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    // Get month view data
    const currentDateValue = computed(() => new Date(calendarStore.currentDate.value))

    const monthView = computed(() => {
      const date = new Date(currentDateValue.value)
      const year = date.getFullYear()
      const month = date.getMonth()
      
      const firstDay = new Date(year, month, 1)
      const lastDay = new Date(year, month + 1, 0)
      const daysInMonth = lastDay.getDate()
      const startingDayOfWeek = firstDay.getDay()

      const weeks = []
      let currentWeek = []

      // Add empty cells for days before month starts
      for (let i = 0; i < startingDayOfWeek; i++) {
        currentWeek.push(null)
      }

      // Add days of the month
      for (let day = 1; day <= daysInMonth; day++) {
        const dayDate = new Date(year, month, day)
        currentWeek.push(dayDate)

        if (currentWeek.length === 7) {
          weeks.push(currentWeek)
          currentWeek = []
        }
      }

      // Add remaining empty cells
      while (currentWeek.length < 7) {
        currentWeek.push(null)
      }
      if (currentWeek.length > 0) {
        weeks.push(currentWeek)
      }

      return weeks
    })

    // Get events for a specific date
    const getEventsForDate = (date) => {
      if (!date) return []
      const dateStr = date.toISOString().split('T')[0]
      return calendarStore.visibleEvents.value.filter(event => {
        const eventDate = new Date(event.start).toISOString().split('T')[0]
        return eventDate === dateStr
      })
    }

    // Check if date is today
    const isToday = (date) => {
      if (!date) return false
      const today = new Date()
      return date.getDate() === today.getDate() &&
             date.getMonth() === today.getMonth() &&
             date.getFullYear() === today.getFullYear()
    }

    const titleText = computed(() => {
      const date = new Date(currentDateValue.value)
      if (calendarStore.calendarViewMode.value === 'day') {
        return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      }
      if (calendarStore.calendarViewMode.value === 'week') {
        const start = new Date(date)
        const day = start.getDay()
        start.setDate(start.getDate() - day)
        const end = new Date(start)
        end.setDate(end.getDate() + 6)
        const sameMonth = start.getMonth() === end.getMonth()
        const startText = start.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric'
        })
        const endText = end.toLocaleDateString('en-US', {
          month: sameMonth ? undefined : 'short',
          day: 'numeric',
          year: 'numeric'
        })
        return `Week of ${startText}–${endText}`
      }
      return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    })

    const todayText = computed(() => {
      return new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    })

    return {
      ...calendarStore,
      monthView,
      formatDate,
      formatTime,
      getEventsForDate,
      isToday,
      titleText,
      todayText,
      contextMenuOpen,
      contextMenuX,
      contextMenuY,
      openEventMenu,
      editEventFromMenu,
      deleteEventFromMenu,
    }
  }
}
</script>

<template>
  <div class="calendar-view">
    <!-- Calendar Header -->
    <div class="calendar-header">
      <div class="calendar-nav">
        <button @click="navigateDate(-1)" class="nav-btn">←</button>
        <button @click="goToToday" class="today-btn">Today</button>
        <button @click="navigateDate(1)" class="nav-btn">→</button>
        <div class="calendar-title">
          <h2>{{ titleText }}</h2>
          <span class="calendar-today">Today: {{ todayText }}</span>
        </div>
      </div>
      <div class="calendar-actions">
        <div class="view-buttons">
          <button 
            @click="setViewMode('month')" 
            :class="{ active: calendarViewMode === 'month' }"
            class="view-btn"
          >
            Month
          </button>
          <button 
            @click="setViewMode('week')" 
            :class="{ active: calendarViewMode === 'week' }"
            class="view-btn"
          >
            Week
          </button>
          <button 
            @click="setViewMode('day')" 
            :class="{ active: calendarViewMode === 'day' }"
            class="view-btn"
          >
            Day
          </button>
        </div>
        <button @click="openEventEditor()" class="new-event-btn">+ New Event</button>
      </div>
    </div>

    <!-- Calendar List (Sidebar) -->
    <div class="calendar-sidebar">
      <h3>Calendars</h3>
      <div v-if="loadingCalendars" class="loading">Loading calendars...</div>
      <div v-else-if="calendars.length === 0" class="empty-state">
        No calendars found
      </div>
      <div v-else class="calendar-list">
        <div 
          v-for="calendar in calendars" 
          :key="calendar.id"
          class="calendar-item"
          @click="toggleCalendar(calendar.id)"
        >
          <input 
            type="checkbox" 
            :checked="selectedCalendarIds.includes(calendar.id)"
            @change="toggleCalendar(calendar.id)"
          />
          <span 
            class="calendar-color" 
            :style="{ backgroundColor: calendar.color || '#4f8cff' }"
          ></span>
          <span class="calendar-name">{{ calendar.name || 'Unnamed Calendar' }}</span>
        </div>
      </div>
    </div>

    <!-- Calendar Grid -->
    <div class="calendar-content">
      <div v-if="calendarViewMode === 'month'" class="month-view">
        <!-- Day headers -->
        <div class="calendar-weekdays">
          <div v-for="day in ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']" :key="day" class="weekday">
            {{ day }}
          </div>
        </div>

        <!-- Calendar grid -->
        <div class="calendar-grid">
          <div v-for="(week, weekIndex) in monthView" :key="weekIndex" class="calendar-week">
            <div 
              v-for="(day, dayIndex) in week" 
              :key="dayIndex"
              class="calendar-day"
              :class="{ 'other-month': !day, 'today': day && isToday(day) }"
            >
              <div class="day-number">{{ day ? day.getDate() : '' }}</div>
              <div class="day-events">
                <div 
                  v-for="event in getEventsForDate(day)" 
                  :key="event.id"
                  class="event-item"
                  :style="{ borderLeftColor: calendars.find(c => c.id === event.calendarId)?.color || '#4f8cff' }"
                  @click="selectedEventId = event.id"
                  @contextmenu="openEventMenu($event, event)"
                >
                  <span class="event-time" v-if="!event.showWithoutTime">
                    {{ formatTime(event.start) }}
                  </span>
                  <span class="event-title">{{ event.title || 'Untitled Event' }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Agenda View (fallback for week/day) -->
      <div v-else class="agenda-view">
        <div v-if="loadingEvents" class="loading">Loading events...</div>
        <div v-else-if="visibleEvents.length === 0" class="empty-state">
          No events in this period
        </div>
        <div v-else class="event-list">
          <div 
            v-for="event in visibleEvents" 
            :key="event.id"
            class="agenda-event"
            :style="{ borderLeftColor: calendars.find(c => c.id === event.calendarId)?.color || '#4f8cff' }"
            @click="selectedEventId = event.id"
            @contextmenu="openEventMenu($event, event)"
          >
            <div class="event-date">
              <div class="event-day">{{ formatDate(event.start) }}</div>
              <div class="event-time" v-if="!event.showWithoutTime">
                {{ formatTime(event.start) }} - {{ formatTime(event.end) }}
              </div>
            </div>
            <div class="event-details">
              <div class="event-title">{{ event.title || 'Untitled Event' }}</div>
              <div v-if="event.location" class="event-location">📍 {{ event.location }}</div>
              <div v-if="event.description" class="event-description">{{ event.description }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div
    v-if="contextMenuOpen"
    class="event-context-menu"
    :style="{ left: contextMenuX + 'px', top: contextMenuY + 'px' }"
    @click.stop
  >
    <button type="button" class="context-action" @click="editEventFromMenu">Edit</button>
    <button type="button" class="context-action danger" @click="deleteEventFromMenu">Delete</button>
  </div>
</template>

<style scoped>
.calendar-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
}

.calendar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}

.calendar-nav {
  display: flex;
  align-items: center;
  gap: 12px;
}

.nav-btn, .today-btn {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  font-size: 14px;
}

.nav-btn:hover, .today-btn:hover {
  background: var(--rowHover);
}

.calendar-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.calendar-title h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--text);
}

.calendar-today {
  font-size: 12px;
  color: var(--muted);
}

.calendar-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}

.view-buttons {
  display: flex;
  gap: 4px;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px;
}

.view-btn {
  padding: 6px 16px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  font-size: 14px;
}

.view-btn.active {
  background: var(--accent);
  color: white;
}

.new-event-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  background: var(--accent);
  color: white;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}

.new-event-btn:hover {
  filter: brightness(1.1);
}

.calendar-content {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.calendar-sidebar {
  width: 250px;
  border-right: 1px solid var(--border);
  padding: 16px;
  background: var(--panel2);
  overflow-y: auto;
}

.calendar-sidebar h3 {
  margin: 0 0 12px 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}

.calendar-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.calendar-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.15s;
}

.calendar-item:hover {
  background: var(--rowHover);
}

.calendar-color {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}

.calendar-name {
  flex: 1;
  font-size: 14px;
  color: var(--text);
}

.month-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.calendar-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  border-bottom: 1px solid var(--border);
  background: var(--panel2);
}

.weekday {
  padding: 12px;
  text-align: center;
  font-weight: 600;
  font-size: 12px;
  color: var(--muted);
  text-transform: uppercase;
}

.calendar-grid {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.calendar-week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  flex: 1;
  min-height: 120px;
}

.calendar-day {
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  padding: 8px;
  background: var(--panel);
  min-height: 120px;
}

.calendar-day.other-month {
  background: var(--panel2);
  opacity: 0.5;
}

.calendar-day.today {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.day-number {
  font-weight: 600;
  font-size: 14px;
  color: var(--text);
  margin-bottom: 4px;
}

.day-events {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.event-item {
  padding: 4px 6px;
  border-left: 3px solid;
  border-radius: 4px;
  background: var(--panel2);
  cursor: pointer;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.event-item:hover {
  background: var(--rowHover);
}

.event-time {
  color: var(--muted);
  margin-right: 4px;
}

.event-title {
  color: var(--text);
}

.agenda-view {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.loading, .empty-state {
  text-align: center;
  padding: 40px;
  color: var(--muted);
}

.event-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.agenda-event {
  display: flex;
  gap: 16px;
  padding: 16px;
  border-left: 4px solid;
  border-radius: 8px;
  background: var(--panel);
  cursor: pointer;
  transition: background-color 0.15s;
}

.agenda-event:hover {
  background: var(--rowHover);
}

.event-date {
  min-width: 120px;
  flex-shrink: 0;
}

.event-day {
  font-weight: 600;
  color: var(--text);
  margin-bottom: 4px;
}

.event-time {
  font-size: 12px;
  color: var(--muted);
}

.event-details {
  flex: 1;
}

.event-title {
  font-weight: 600;
  color: var(--text);
  margin-bottom: 4px;
}

.event-location, .event-description {
  font-size: 13px;
  color: var(--muted);
  margin-top: 4px;
}

.event-context-menu {
  position: fixed;
  z-index: 2000;
  min-width: 140px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
  padding: 6px;
}

.context-action {
  width: 100%;
  text-align: left;
  padding: 8px 10px;
  border: 0;
  background: transparent;
  color: var(--text);
  border-radius: 6px;
  font-size: 13px;
}

.context-action:hover {
  background: var(--panel2);
}

.context-action.danger {
  color: #d85c5c;
}
</style>
