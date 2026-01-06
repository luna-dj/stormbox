import { ref, computed } from 'vue'
import { useEmailStore } from './useEmailStore.js'

export function useCalendarStore(emailStore = null) {
  // If emailStore is provided, use it; otherwise create a new instance
  // This allows sharing the same store instance across components
  let client, connected
  if (emailStore) {
    client = emailStore.client
    connected = emailStore.connected
  } else {
    // Fallback: create a new instance if not provided
    const emailStoreInstance = useEmailStore()
    client = emailStoreInstance.client
    connected = emailStoreInstance.connected
  }

  // Calendar state
  const calendars = ref([])
  const events = ref([])
  const loadingCalendars = ref(false)
  const loadingEvents = ref(false)
  const selectedCalendarIds = ref([])
  const calendarViewMode = ref('month') // 'month', 'week', 'day', 'agenda'
  const currentDate = ref(new Date())
  const selectedEventId = ref(null)
  const eventEditorOpen = ref(false)
  const editingEvent = ref(null)

  // Refresh calendars
  const refreshCalendars = async () => {
    if (!client.value || !connected.value) return
    
    loadingCalendars.value = true
    try {
      calendars.value = await client.value.listCalendars()
      // Select all visible calendars by default
      selectedCalendarIds.value = calendars.value
        .filter(c => c.isVisible !== false)
        .map(c => c.id)
    } catch (e) {
      console.error('[CalendarStore] Failed to refresh calendars:', e)
    } finally {
      loadingCalendars.value = false
    }
  }

  // Refresh events for selected calendars
  const refreshEvents = async (start = null, end = null) => {
    if (!client.value || !connected.value) {
      events.value = []
      return
    }
    
    // If no calendars selected, try to get all calendars first
    if (selectedCalendarIds.value.length === 0) {
      if (calendars.value.length === 0) {
        await refreshCalendars()
      }
      // If still no calendars, return empty
      if (calendars.value.length === 0) {
        events.value = []
        return
      }
      // Select all visible calendars
      selectedCalendarIds.value = calendars.value
        .filter(c => c.isVisible !== false)
        .map(c => c.id)
    }

    loadingEvents.value = true
    try {
      // Default to current month if no dates provided
      if (!start) {
        const now = currentDate.value
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
        start = firstDay.toISOString()
      }
      if (!end) {
        const now = currentDate.value
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
        end = lastDay.toISOString()
      }

      events.value = await client.value.getEvents(selectedCalendarIds.value, start, end)
    } catch (e) {
      console.error('[CalendarStore] Failed to refresh events:', e)
      events.value = []
    } finally {
      loadingEvents.value = false
    }
  }

  // Create event
  const createEvent = async (eventData) => {
    if (!client.value) throw new Error('Not connected')
    
    // Extract calendarId from eventData
    const calendarId = eventData.calendarId || selectedCalendarIds.value[0]
    if (!calendarId) {
      throw new Error('No calendar selected')
    }
    
    try {
      const created = await client.value.createEvent(calendarId, eventData)
      await refreshEvents()
      return created
    } catch (e) {
      console.error('[CalendarStore] Failed to create event:', e)
      throw e
    }
  }

  // Update event
  const updateEvent = async (eventId, updates) => {
    if (!client.value) throw new Error('Not connected')
    
    // Find the event to get its calendarId
    const event = events.value.find(e => e.id === eventId)
    const calendarId = updates.calendarId || event?.calendarId || selectedCalendarIds.value[0]
    if (!calendarId) {
      throw new Error('No calendar found for event')
    }
    
    try {
      const updated = await client.value.updateEvent(calendarId, eventId, updates)
      await refreshEvents()
      return updated
    } catch (e) {
      console.error('[CalendarStore] Failed to update event:', e)
      throw e
    }
  }

  // Delete event
  const deleteEvent = async (eventId) => {
    if (!client.value) throw new Error('Not connected')
    
    // Find the event to get its calendarId
    const event = events.value.find(e => e.id === eventId)
    const calendarId = event?.calendarId || selectedCalendarIds.value[0]
    if (!calendarId) {
      throw new Error('No calendar found for event')
    }
    
    try {
      await client.value.deleteEvent(calendarId, eventId)
      await refreshEvents()
      selectedEventId.value = null
    } catch (e) {
      console.error('[CalendarStore] Failed to delete event:', e)
      throw e
    }
  }

  // Open event editor
  const openEventEditor = (event = null) => {
    if (calendars.value.length === 0) {
      refreshCalendars()
    }
    editingEvent.value = event
    eventEditorOpen.value = true
  }

  // Close event editor
  const closeEventEditor = () => {
    eventEditorOpen.value = false
    editingEvent.value = null
  }

  // Navigate calendar
  const navigateDate = (direction) => {
    const date = new Date(currentDate.value)
    if (calendarViewMode.value === 'month') {
      date.setMonth(date.getMonth() + direction)
    } else if (calendarViewMode.value === 'week') {
      date.setDate(date.getDate() + (direction * 7))
    } else if (calendarViewMode.value === 'day') {
      date.setDate(date.getDate() + direction)
    }
    currentDate.value = date
    refreshEvents()
  }

  // Go to today
  const goToToday = () => {
    currentDate.value = new Date()
    refreshEvents()
  }

  // Set view mode
  const setViewMode = (view) => {
    calendarViewMode.value = view
    refreshEvents()
  }

  // Toggle calendar selection
  const toggleCalendar = (calendarId) => {
    const index = selectedCalendarIds.value.indexOf(calendarId)
    if (index > -1) {
      selectedCalendarIds.value.splice(index, 1)
    } else {
      selectedCalendarIds.value.push(calendarId)
    }
    refreshEvents()
  }

  // Computed: events for current view
  const visibleEvents = computed(() => {
    return events.value.filter(event => {
      const eventStart = new Date(event.start)
      const eventEnd = new Date(event.end || event.start)
      const viewStart = new Date(currentDate.value)
      const viewEnd = new Date(currentDate.value)

      if (calendarViewMode.value === 'month') {
        viewStart.setDate(1)
        viewStart.setHours(0, 0, 0, 0)
        viewEnd.setMonth(viewEnd.getMonth() + 1)
        viewEnd.setDate(0)
        viewEnd.setHours(23, 59, 59, 999)
      } else if (calendarViewMode.value === 'week') {
        const day = viewStart.getDay()
        viewStart.setDate(viewStart.getDate() - day)
        viewStart.setHours(0, 0, 0, 0)
        viewEnd.setDate(viewStart.getDate() + 6)
        viewEnd.setHours(23, 59, 59, 999)
      } else if (calendarViewMode.value === 'day') {
        viewStart.setHours(0, 0, 0, 0)
        viewEnd.setHours(23, 59, 59, 999)
      }

      return (eventStart <= viewEnd && eventEnd >= viewStart)
    })
  })

  return {
    // State
    calendars,
    events,
    visibleEvents,
    loadingCalendars,
    loadingEvents,
    selectedCalendarIds,
    calendarViewMode,
    currentDate,
    selectedEventId,
    eventEditorOpen,
    editingEvent,

    // Actions
    refreshCalendars,
    refreshEvents,
    createEvent,
    updateEvent,
    deleteEvent,
    openEventEditor,
    closeEventEditor,
    navigateDate,
    goToToday,
    setViewMode,
    toggleCalendar,
  }
}
