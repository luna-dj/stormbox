<script>
import { onMounted, watch } from 'vue'
import { useEmailStore } from '../composables/useEmailStore.js'
import { useCalendarStore } from '../composables/useCalendarStore.js'

export default {
  name: 'AccountProvider',
  props: {
    sessionId: {
      type: String,
      required: true
    },
    username: {
      type: String,
      required: true
    },
    password: {
      type: String,
      required: true
    }
  },
  emits: ['ready', 'status', 'error'],
  setup(props, { emit }) {
    const emailStore = useEmailStore({ sessionKey: props.sessionId })
    const calendarStore = useCalendarStore(emailStore)
    let readyEmitted = false

    watch(() => emailStore.status.value, (value) => {
      emit('status', { sessionId: props.sessionId, status: value })
    }, { immediate: true })

    watch(() => emailStore.error.value, (value) => {
      if (value) {
        emit('error', { sessionId: props.sessionId, error: value })
      }
    }, { immediate: true })

    watch(() => emailStore.connected.value, (value) => {
      if (value && !readyEmitted) {
        const primary = emailStore.identities.value?.[0] || {}
        readyEmitted = true
        emit('ready', {
          sessionId: props.sessionId,
          emailStore,
          calendarStore,
          label: primary.name || primary.email || props.username,
          email: primary.email || props.username
        })
      }
    }, { immediate: true })

    onMounted(async () => {
      try {
        await emailStore.connect({ username: props.username, password: props.password })
        if (!emailStore.connected.value) {
          emit('error', {
            sessionId: props.sessionId,
            error: emailStore.error.value || 'Failed to connect.'
          })
          return
        }

        if (!readyEmitted) {
          const primary = emailStore.identities.value?.[0] || {}
          readyEmitted = true
          emit('ready', {
            sessionId: props.sessionId,
            emailStore,
            calendarStore,
            label: primary.name || primary.email || props.username,
            email: primary.email || props.username
          })
        }
      } catch (e) {
        emit('error', { sessionId: props.sessionId, error: e.message || String(e) })
      }
    })

    return {}
  }
}
</script>

<template>
  <div class="account-provider" aria-hidden="true"></div>
</template>

<style scoped>
.account-provider {
  display: none;
}
</style>
