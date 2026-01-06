<script>
import { computed, provide, ref, reactive, watch, unref } from 'vue'
import { useTheme } from './composables/useTheme.js'
import LoginForm from './components/LoginForm.vue'
import AccountProvider from './components/AccountProvider.vue'
import FolderList from './components/FolderList.vue'
import MessageList from './components/MessageList.vue'
import ComposePanel from './components/ComposePanel.vue'
import MessageDetail from './components/MessageDetail.vue'
import ThreadConversationView from './components/ThreadConversationView.vue'
import ContactEditor from './components/ContactEditor.vue'
import ContactManager from './components/ContactManager.vue'
import DraftsList from './components/DraftsList.vue'
import CalendarView from './components/CalendarView.vue'
import EventEditor from './components/EventEditor.vue'

export default {
  name: 'App',
  components: {
    LoginForm,
    AccountProvider,
    FolderList,
    MessageList,
    ComposePanel,
    MessageDetail,
    ThreadConversationView,
    ContactEditor,
    ContactManager,
    DraftsList,
    CalendarView,
    EventEditor
  },
  setup() {
    const { theme, cycle } = useTheme()
    const foldersOpen = ref(false)
    const sessions = ref([])
    const accounts = computed(() =>
      sessions.value
        .filter((s) => s.connected)
        .map((s) => ({ id: s.id, label: s.label, email: s.email }))
    )
    const activeAccountId = ref(null)
    const addAccountOpen = ref(false)
    const loginSessionId = ref(null)
    const loginStatus = ref('Not connected.')
    const loginError = ref('')

    const activeAccount = computed(() => {
      if (!sessions.value.length) return null
      const byId = sessions.value.find((a) => a.id === activeAccountId.value && a.connected)
      return byId || sessions.value.find((a) => a.connected) || null
    })

    const activeEmailStore = computed(() => activeAccount.value?.emailStore || null)
    const activeCalendarStore = computed(() => activeAccount.value?.calendarStore || null)

    const emailStoreProxy = reactive({})
    const calendarStoreProxy = ref(null)

    const syncProxy = (proxy, store) => {
      Object.keys(proxy).forEach((key) => delete proxy[key])
      if (store) Object.assign(proxy, store)
    }

    watch(activeEmailStore, (store) => syncProxy(emailStoreProxy, store), { immediate: true })
    watch(activeCalendarStore, (store) => {
      calendarStoreProxy.value = store || null
    }, { immediate: true })
    const initializedStores = new WeakSet()
    const getInboxId = (store) => {
      const boxes = store?.mailboxes?.value || []
      const byRole = boxes.find((m) => (m.role || '').toLowerCase() === 'inbox')
      if (byRole?.id) return byRole.id
      const byName = boxes.find((m) => (m.name || '').toLowerCase() === 'inbox')
      return byName?.id || null
    }
    watch(
      () => ({
        store: activeEmailStore.value,
        connected: activeEmailStore.value?.connected?.value,
        mailboxId: activeEmailStore.value?.currentMailboxId?.value,
        mailboxCount: activeEmailStore.value?.mailboxes?.value?.length || 0
      }),
      ({ store, connected, mailboxId, mailboxCount }) => {
        if (!store || !connected || !mailboxId || mailboxCount === 0) return
        if (initializedStores.has(store)) return
        initializedStores.add(store)
        const inboxId = getInboxId(store) || mailboxId
        if (store.currentMailboxId?.value !== inboxId) {
          store.currentMailboxId.value = inboxId
        }
        store.switchMailbox?.(inboxId)
      },
      { immediate: true }
    )

    const serverName = computed(() => {
      const url = "https://hivepost.nl"
      try {
        return new URL(url).hostname
      } catch {
        return url
      }
    })

    const openFolders = () => {
      foldersOpen.value = true
    }

    const closeFolders = () => {
      foldersOpen.value = false
    }

    const toggleFolders = () => {
      foldersOpen.value = !foldersOpen.value
    }

    const switchMailboxAndClose = (mailboxId) => {
      switchMailbox(mailboxId)
      foldersOpen.value = false
    }

    // Provide stores to child components
    provide('emailStore', emailStoreProxy)
    provide('calendarStore', calendarStoreProxy)

    // Event editor handlers
    const saveEvent = async () => {
      await refreshEvents()
    }

    const deleteEvent = async () => {
      await refreshEvents()
    }

    const handleIdentityUpdate = async ({ id, updates }) => {
      try {
        await updateIdentity(id, updates)
      } catch (e) {
        alert(`Failed to update identity: ${e.message}`)
      }
    }

    const connect = async ({ username, password }) => {
      const sessionId = `acc-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
      sessions.value.push({
        id: sessionId,
        username: username.trim(),
        password,
        connected: false,
        label: username.trim(),
        email: username.trim(),
        emailStore: null,
        calendarStore: null
      })
      loginSessionId.value = sessionId
      loginStatus.value = 'Connecting…'
      loginError.value = ''
    }

    const openAddAccount = () => {
      addAccountOpen.value = true
      loginSessionId.value = 'pending'
      loginStatus.value = 'Not connected.'
      loginError.value = ''
    }

    const setActiveAccount = (accountId) => {
      activeAccountId.value = accountId
    }

    const logout = () => {
      const current = activeEmailStore.value
      if (!current) return
      const id = activeAccountId.value
      current.logout()
      sessions.value = sessions.value.filter((a) => a.id !== id)
      activeAccountId.value = sessions.value.find((a) => a.connected)?.id || null
    }

    const activeAccountLabel = computed(() => activeAccount.value?.label || '')
    const activeAccountEmail = computed(() => activeAccount.value?.email || activeAccount.value?.id || '')

    const connected = computed(() => !!unref(activeEmailStore.value?.connected))
    const hasAccounts = computed(() => sessions.value.some((s) => s.connected))
    const loginVisible = computed(() => addAccountOpen.value || !hasAccounts.value)

    watch(connected, (value) => {
      if (value) {
        document.body.classList.add('connected')
      } else {
        document.body.classList.remove('connected')
      }
    }, { immediate: true })
    const status = computed(() => unref(activeEmailStore.value?.status) || 'Not connected.')
    const error = computed(() => unref(activeEmailStore.value?.error) || '')
    const mailboxes = computed(() => unref(activeEmailStore.value?.mailboxes) || [])
    const identities = computed(() => unref(activeEmailStore.value?.identities) || [])
    const contacts = computed(() => unref(activeEmailStore.value?.contacts) || [])
    const currentMailboxId = computed({
      get: () => unref(activeEmailStore.value?.currentMailboxId) || null,
      set: (value) => {
        if (activeEmailStore.value?.currentMailboxId) {
          activeEmailStore.value.currentMailboxId.value = value
        }
      }
    })
    const selectedEmailId = computed({
      get: () => unref(activeEmailStore.value?.selectedEmailId) || null,
      set: (value) => {
        const store = activeEmailStore.value
        if (!store) return
        // Use selectMessage to properly set the selected email and load its details
        if (value) {
          store.selectMessage?.(value)
        } else {
          // Clear selection
          if (store.selectedEmailId && typeof store.selectedEmailId === 'object' && 'value' in store.selectedEmailId) {
            store.selectedEmailId.value = null
          } else if (store.backToList) {
            store.backToList()
          }
        }
      }
    })
    const composeOpen = computed({
      get: () => !!unref(activeEmailStore.value?.composeOpen),
      set: (value) => {
        if (activeEmailStore.value?.composeOpen) {
          activeEmailStore.value.composeOpen.value = !!value
        }
      }
    })
    const compose = computed(() => activeEmailStore.value?.compose || {
      fromIdx: 0,
      to: '',
      subject: '',
      html: '',
      text: ''
    })
    const sending = computed(() => !!unref(activeEmailStore.value?.sending))
    const composeStatus = computed(() => unref(activeEmailStore.value?.composeStatus) || '')
    const composeDebug = computed(() => unref(activeEmailStore.value?.composeDebug) || '')
    const signatureText = computed(() => unref(activeEmailStore.value?.signatureText) || '')
    const signatureEnabled = computed(() => unref(activeEmailStore.value?.signatureEnabled) ?? true)
    const drafts = computed(() => unref(activeEmailStore.value?.drafts) || [])
    const loadingDrafts = computed(() => !!unref(activeEmailStore.value?.loadingDrafts))
    const contactEditorOpen = computed({
      get: () => !!unref(activeEmailStore.value?.contactEditorOpen),
      set: (value) => {
        if (activeEmailStore.value?.contactEditorOpen) {
          activeEmailStore.value.contactEditorOpen.value = !!value
        }
      }
    })
    const editingContact = computed(() => unref(activeEmailStore.value?.editingContact) || null)
    const savingContact = computed(() => !!unref(activeEmailStore.value?.savingContact))
    const contactStatus = computed(() => unref(activeEmailStore.value?.contactStatus) || '')
    const addressBooks = computed(() => unref(activeEmailStore.value?.addressBooks) || [])
    const selectedAddressBookId = computed({
      get: () => unref(activeEmailStore.value?.selectedAddressBookId) || null,
      set: (value) => {
        if (activeEmailStore.value?.selectedAddressBookId) {
          activeEmailStore.value.selectedAddressBookId.value = value
        }
      }
    })
    const currentView = ref('mail')
    const selectedContactId = computed({
      get: () => unref(activeEmailStore.value?.selectedContactId) || null,
      set: (value) => {
        if (activeEmailStore.value?.selectedContactId) {
          activeEmailStore.value.selectedContactId.value = value
        }
      }
    })
    const viewMode = computed(() => unref(activeEmailStore.value?.viewMode) || 'all')
    const filterText = computed({
      get: () => unref(activeEmailStore.value?.filterText) || '',
      set: (value) => {
        if (activeEmailStore.value?.filterText) {
          activeEmailStore.value.filterText.value = value
        }
      }
    })
    const visibleMessages = computed(() => unref(activeEmailStore.value?.visibleMessages) || [])
    const groupedThreads = computed(() => unref(activeEmailStore.value?.groupedThreads) || [])
    const totalEmailsCount = computed(() => unref(activeEmailStore.value?.totalEmailsCount) || 0)
    const detail = computed(() => unref(activeEmailStore.value?.detail) || {})
    const attachments = computed(() => unref(activeEmailStore.value?.attachments) || [])
    const bodyHtml = computed(() => unref(activeEmailStore.value?.bodyHtml) || '')
    const bodyText = computed(() => unref(activeEmailStore.value?.bodyText) || '')
    const emailHeaders = computed(() => unref(activeEmailStore.value?.emailHeaders) || null)
    const rawMessage = computed(() => unref(activeEmailStore.value?.rawMessage) || null)
    const showHeaders = computed(() => !!unref(activeEmailStore.value?.showHeaders))
    const showRawMessage = computed(() => !!unref(activeEmailStore.value?.showRawMessage))
    const listMode = ref('threads')
    const selectedThreadId = computed(() => {
      if (!selectedEmailId.value) return null
      const match = groupedThreads.value.find((thread) =>
        (thread.emails || []).some((email) => email.id === selectedEmailId.value)
      )
      return match?.realThreadId || match?.threadId || null
    })
    const selectedThread = computed(() => {
      if (!selectedThreadId.value) return null
      return groupedThreads.value.find((thread) =>
        thread.threadId === selectedThreadId.value || thread.realThreadId === selectedThreadId.value
      ) || null
    })
    const showThreadDetail = computed(() => (selectedThread.value?.emailCount || 0) > 1)
    const emailClient = computed(() => unref(activeEmailStore.value?.client) || null)

    const eventEditorOpen = computed(() => !!unref(activeCalendarStore.value?.eventEditorOpen))
    const editingEvent = computed(() => unref(activeCalendarStore.value?.editingEvent) || null)
    const calendarViewMode = computed({
      get: () => unref(activeCalendarStore.value?.calendarViewMode),
      set: (value) => {
        const target = activeCalendarStore.value?.calendarViewMode
        if (!target) return
        if (typeof target === 'object' && 'value' in target) {
          target.value = value
        } else {
          activeCalendarStore.value.calendarViewMode = value
        }
      }
    })

    watch(currentView, (view) => {
      if (view !== 'mail') {
        foldersOpen.value = false
      }
    })

    watch(
      () => unref(activeEmailStore.value?.currentView),
      (value) => {
        if (!value) return
        if (currentView.value !== 'calendar') {
          currentView.value = value
        }
      },
      { immediate: true }
    )

    const switchViewMode = (view) => {
      activeEmailStore.value?.switchView?.(view)
    }

    const currentMailboxName = computed(() => {
      const box = mailboxes.value.find((m) => m.id === currentMailboxId.value)
      if (!box) return 'Mailbox'
      const role = (box.role || '').toLowerCase()
      const name = (box.name || '').toLowerCase()
      if (role === 'inbox' || name === 'inbox') return 'Inbox'
      if (role === 'sent' || name === 'sent' || name === 'sent items') return 'Sent'
      if (role === 'drafts' || name === 'drafts') return 'Drafts'
      if (role === 'trash' || name === 'trash' || name === 'deleted items') return 'Trash'
      if (role === 'junk' || name === 'junk' || name === 'spam') return 'Spam'
      if (role === 'archive' || name === 'archive' || name === 'archives') return 'Archive'
      return box.name || 'Mailbox'
    })

    // Override switchView to handle calendar
    const switchView = (view) => {
      if (view === 'calendar') {
        if (calendarViewMode.value) {
          calendarViewMode.value = 'month'
        }
        currentView.value = 'calendar'
        // Refresh calendars when switching to calendar view
        refreshCalendars()
        foldersOpen.value = false
      } else {
        currentView.value = view
        const emailView = activeEmailStore.value?.currentView
        if (emailView) {
          if (typeof emailView === 'object' && 'value' in emailView) {
            emailView.value = view
          } else {
            activeEmailStore.value.currentView = view
          }
        }
        switchViewMode(view)
        foldersOpen.value = false
      }
    }

    const switchMailbox = (mailboxId) => {
      activeEmailStore.value?.switchMailbox?.(mailboxId)
    }

    const refreshCurrentMailbox = () => activeEmailStore.value?.refreshCurrentMailbox?.()
    const refreshContacts = () => activeEmailStore.value?.refreshContacts?.()
    const refreshAddressBooks = () => activeEmailStore.value?.refreshAddressBooks?.()
    const setSelectedAddressBook = (id) => activeEmailStore.value?.setSelectedAddressBook?.(id)
    const openContactEditor = (contact) => activeEmailStore.value?.openContactEditor?.(contact)
    const closeContactEditor = () => activeEmailStore.value?.closeContactEditor?.()
    const saveContact = (contact) => activeEmailStore.value?.saveContact?.(contact)
    const deleteContact = (contactId) => activeEmailStore.value?.deleteContact?.(contactId)
    const selectContact = (contact) => activeEmailStore.value?.selectContact?.(contact)
    const setViewMode = (mode) => activeEmailStore.value?.setViewMode?.(mode)
    const selectMessage = (id) => activeEmailStore.value?.selectMessage?.(id)
    const backToList = () => activeEmailStore.value?.backToList?.()
    const replyToCurrent = () => activeEmailStore.value?.replyToCurrent?.()
    const replyToEmail = (email) => {
      if (email?.id) {
        // Use selectMessage instead of directly setting selectedEmailId
        selectMessage(email.id)
      }
      replyToCurrent()
    }
    const deleteCurrent = () => activeEmailStore.value?.deleteCurrent?.()
    const moveEmailToFolder = (mailboxId) => activeEmailStore.value?.moveEmailToFolder?.(mailboxId)
    const toggleCompose = () => activeEmailStore.value?.toggleCompose?.()
    const discard = () => activeEmailStore.value?.discard?.()
    const send = () => activeEmailStore.value?.send?.()
    const updateIdentity = (id, updates) => activeEmailStore.value?.updateIdentity?.(id, updates)
    const download = (attachment) => activeEmailStore.value?.download?.(attachment)
    const downloadThreadAttachment = (blobId, name, type) => {
      if (!blobId) return
      activeEmailStore.value?.download?.({ blobId, name, type })
    }
    const markThreadRead = (emailId, seen) => {
      if (!emailId) return
      activeEmailStore.value?.client?.setSeen?.(emailId, !!seen)
    }
    const onVirtRange = (idx) => activeEmailStore.value?.onVirtRange?.(idx)
    const setSignatureText = (value) => activeEmailStore.value?.setSignatureText?.(value)
    const setSignatureEnabled = (value) => activeEmailStore.value?.setSignatureEnabled?.(value)
    const loadHeaders = () => activeEmailStore.value?.loadHeaders?.()
    const loadRawMessage = () => activeEmailStore.value?.loadRawMessage?.()
    const loadDraft = (draft) => activeEmailStore.value?.loadDraft?.(draft)
    const refreshDrafts = () => activeEmailStore.value?.refreshDrafts?.()

    const refreshCalendars = () => activeCalendarStore.value?.refreshCalendars?.()
    const refreshEvents = () => activeCalendarStore.value?.refreshEvents?.()
    const closeEventEditor = () => activeCalendarStore.value?.closeEventEditor?.()

    const handleAccountReady = ({ sessionId, emailStore, calendarStore, label, email }) => {
      const idx = sessions.value.findIndex((s) => s.id === sessionId)
      if (idx === -1) return
      const existing = sessions.value[idx]
      const isNewLogin = loginSessionId.value === sessionId
      const next = {
        ...existing,
        emailStore,
        calendarStore,
        connected: true,
        label: label || existing.label,
        email: email || existing.email,
        password: ''
      }
      sessions.value = [
        ...sessions.value.slice(0, idx),
        next,
        ...sessions.value.slice(idx + 1)
      ]
      if (isNewLogin) {
        activeAccountId.value = sessionId
      } else {
        activeAccountId.value = activeAccountId.value || sessionId
      }
      addAccountOpen.value = false
      if (isNewLogin) {
        loginSessionId.value = null
        loginStatus.value = 'Connected.'
        loginError.value = ''
      }
    }

    const handleAccountStatus = ({ sessionId, status: value }) => {
      if (loginSessionId.value === sessionId) {
        if (value === 'Not connected.' && loginStatus.value === 'Connecting…') return
        loginStatus.value = value || loginStatus.value
      }
    }

    const handleAccountError = ({ sessionId, error: value }) => {
      if (loginSessionId.value === sessionId) {
        loginError.value = value || loginError.value
        addAccountOpen.value = true
        loginSessionId.value = null
        sessions.value = sessions.value.filter((s) => s.id !== sessionId)
      }
    }

    watch([hasAccounts, loginSessionId], ([has, session]) => {
      if (has && !session) {
        addAccountOpen.value = false
      }
    }, { immediate: true })

    return {
      accounts,
      sessions,
      activeAccountId,
      hasAccounts,
      loginVisible,
      loginStatus,
      loginError,
      addAccountOpen,
      openAddAccount,
      setActiveAccount,
      activeAccountLabel,
      activeAccountEmail,
      connected,
      status,
      error,
      mailboxes,
      identities,
      contacts,
      currentMailboxId,
      selectedEmailId,
      composeOpen,
      compose,
      sending,
      composeStatus,
      composeDebug,
      signatureText,
      signatureEnabled,
      drafts,
      loadingDrafts,
      contactEditorOpen,
      editingContact,
      savingContact,
      contactStatus,
      addressBooks,
      selectedAddressBookId,
      currentView,
      selectedContactId,
      viewMode,
      filterText,
      visibleMessages,
      groupedThreads,
      totalEmailsCount,
      detail,
      attachments,
      bodyHtml,
      bodyText,
      emailHeaders,
      rawMessage,
      showHeaders,
      showRawMessage,
      listMode,
      selectedThreadId,
      selectedThread,
      showThreadDetail,
      emailClient,
      eventEditorOpen,
      editingEvent,
      connect,
      logout,
      refreshCurrentMailbox,
      refreshContacts,
      refreshAddressBooks,
      setSelectedAddressBook,
      openContactEditor,
      closeContactEditor,
      saveContact,
      deleteContact,
      selectContact,
      setViewMode,
      selectMessage,
      backToList,
      replyToCurrent,
      replyToEmail,
      deleteCurrent,
      moveEmailToFolder,
      toggleCompose,
      discard,
      send,
      updateIdentity,
      download,
      downloadThreadAttachment,
      markThreadRead,
      onVirtRange,
      setSignatureText,
      setSignatureEnabled,
      loadHeaders,
      loadRawMessage,
      loadDraft,
      refreshDrafts,
      refreshCalendars,
      refreshEvents,
      closeEventEditor,
      calendarViewMode,
      handleAccountReady,
      handleAccountStatus,
      handleAccountError,
      switchView,
      saveEvent,
      deleteEvent,
      handleIdentityUpdate,
      foldersOpen,
      openFolders,
      closeFolders,
      toggleFolders,
      switchMailboxAndClose,
      currentTheme: theme,
      cycle,
      serverName,
      currentMailboxName,
      themeTitle: computed(() => theme.value === 'system' ? 'Theme: system (click to light)' : (theme.value === 'light' ? 'Theme: light (click to dark)' : 'Theme: dark (click to system)'))
    }
  }
}
</script>

<template>
  <div id="app">
    <!-- Login Form -->
    <LoginForm
      :connected="connected"
      :status="loginStatus"
      :error="loginError"
      :visible="loginVisible"
      :can-cancel="addAccountOpen"
      @connect="connect"
      @cancel="addAccountOpen = false"
    />

    <AccountProvider
      v-for="session in sessions"
      :key="session.id"
      :session-id="session.id"
      :username="session.username"
      :password="session.password"
      @ready="handleAccountReady"
      @status="handleAccountStatus"
      @error="handleAccountError"
    />

    <!-- Header -->
    <header v-if="hasAccounts">
      <div class="header-nav">
        <button
          class="nav-btn"
          :class="{ active: currentView === 'mail' }"
          @click="switchView('mail')"
        >
          Mail
        </button>
        <button
          class="nav-btn"
          :class="{ active: currentView === 'contacts' }"
          @click="switchView('contacts')"
        >
          Contacts
        </button>
        <button
          class="nav-btn"
          :class="{ active: currentView === 'calendar' }"
          @click="switchView('calendar')"
        >
          Calendar
        </button>
      </div>
      <strong>{{ currentView === 'mail' ? 'Mail' : currentView === 'contacts' ? 'Contacts' : 'Calendar' }} — {{ serverName }}</strong>
      <span class="spacer"></span>
      <button class="header-btn mobile-only" @click="toggleFolders" title="Folders" aria-label="Folders">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M3 6a2 2 0 012-2h5l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V6z"/>
        </svg>
        <span>Folders</span>
      </button>
      <button class="header-btn" @click="openContactEditor()" title="New Contact" aria-label="New Contact">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M20 0H4a4 4 0 00-4 4v16a4 4 0 004 4h16a4 4 0 004-4V4a4 4 0 00-4-4zm-2 12h-6v6h-4v-6H4v-4h4V2h4v6h6v4z"/>
        </svg>
        <span>New Contact</span>
      </button>
      <button class="theme-toggle" @click="cycle" :title="themeTitle" aria-label="Theme: system/light/dark">
        <!-- System icon (computer) -->
        <svg v-if="currentTheme === 'system'" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"
          aria-hidden="true">
          <path d="M4 5h16a1 1 0 011 1v10a1 1 0 01-1 1h-6l1.5 2h-6L9 17H4a1 1 0 01-1-1V6a1 1 0 011-1zm1 2v8h14V7H5z" />
        </svg>
        <!-- Sun icon for light -->
        <svg v-else-if="currentTheme === 'light'" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"
          aria-hidden="true">
          <path
            d="M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.8 1.42-1.42zM1 13h3v-2H1v2zm10 10h2v-3h-2v3zm9-10v-2h-3v2h3zM6.76 19.16l-1.42 1.42-1.79-1.8 1.41-1.41 1.8 1.79zM13 1h-2v3h2V1zm7.66 3.46l-1.41-1.41-1.8 1.79 1.42 1.42 1.79-1.8zM12 6a6 6 0 100 12 6 6 0 000-12z" />
        </svg>
        <!-- Moon icon for dark -->
        <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M21.64 13a9 9 0 11-10.63-10.6A9 9 0 0021.64 13z" />
        </svg>
      </button>
      <button class="header-btn" @click="logout" title="Logout" aria-label="Logout">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M16 13v-2H7V8l-5 4 5 4v-3h9zm5-9H9a2 2 0 00-2 2v3h2V6h12v12H9v-3H7v3a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2z"/>
        </svg>
        <span>Logout</span>
      </button>
      <div id="err" class="err" v-if="error">{{ error }}</div>
    </header>

    <!-- Main Content -->
    <main id="main" :class="[
      currentView === 'contacts' ? 'contacts-view' : '',
      currentView === 'calendar' ? 'calendar-view-main' : '',
      (!selectedEmailId && !composeOpen && !contactEditorOpen && currentView !== 'calendar') ? 'hide-detail' : '',
      (currentView === 'mail' && (selectedEmailId || composeOpen)) ? 'mobile-detail-open' : '',
      (currentView === 'contacts' && (contactEditorOpen || selectedContactId)) ? 'mobile-contact-open' : ''
    ]" v-if="hasAccounts">
      <!-- Mail View -->
      <template v-if="currentView === 'mail'">
        <!-- Folder List -->
        <div class="folders-panel" :class="{ open: foldersOpen }">
          <FolderList
            :mailboxes="mailboxes"
            :current-mailbox-id="currentMailboxId"
            :accounts="accounts"
            :active-account-id="activeAccountId"
            :profile-name="activeAccountLabel"
            :profile-email="activeAccountEmail"
            @compose="toggleCompose"
            @reload="refreshCurrentMailbox"
            @switch-mailbox="switchMailboxAndClose"
            @set-account="setActiveAccount"
            @add-account="openAddAccount"
            @logout="logout"
          />
          <DraftsList 
            :drafts="drafts" 
            :loading="loadingDrafts"
            @resume-draft="loadDraft"
            @refresh="refreshDrafts"
          />
        </div>
        <div class="folders-scrim" :class="{ open: foldersOpen }" @click="closeFolders"></div>

        <!-- Message List -->
        <MessageList :current-mailbox-id="currentMailboxId" :current-mailbox-name="currentMailboxName" :selected-email-id="selectedEmailId" :view-mode="viewMode"
          :visible-messages="visibleMessages" :grouped-threads="groupedThreads" :list-mode="listMode" :total-count="totalEmailsCount" @set-view="setViewMode"
          @update:list-mode="listMode = $event"
          @select-message="selectMessage" @virt-range="onVirtRange" @update:filter-text="filterText = $event" />
      </template>

      <!-- Contacts View -->
      <template v-else-if="currentView === 'contacts'">
        <ContactManager
          :contacts="contacts"
          :selected-contact-id="selectedContactId"
          @select-contact="selectContact"
          @new-contact="openContactEditor"
          @edit-contact="openContactEditor"
          @delete-contact="(contact) => deleteContact(contact.id)"
        />
      </template>

      <!-- Calendar View -->
      <template v-else-if="currentView === 'calendar'">
        <CalendarView />
      </template>

      <!-- Detail & Compose -->
      <section class="detail">
        <!-- Contact Editor -->
        <ContactEditor :open="contactEditorOpen" :contact="editingContact" :saving="savingContact"
          :status="contactStatus" :address-books="addressBooks" :selected-address-book-id="selectedAddressBookId"
          @save="saveContact" @cancel="closeContactEditor" @delete="deleteContact"
          @select-address-book="setSelectedAddressBook" />

        <!-- Compose Panel -->
        <ComposePanel
          :compose-open="composeOpen"
          :compose="compose"
          :identities="identities"
          :contacts="contacts"
          :sending="sending"
          :compose-status="composeStatus"
          :compose-debug="composeDebug"
          :signature-text="signatureText"
          :signature-enabled="signatureEnabled"
          @send="send"
          @discard="discard"
          @update:compose="Object.assign(compose, $event)"
          @update:signature="setSignatureText"
          @update:signature-enabled="setSignatureEnabled"
          @update:identity="handleIdentityUpdate"
        />

        <!-- Message Detail -->
        <ThreadConversationView
          v-if="selectedThreadId && showThreadDetail"
          :thread-id="selectedThreadId"
          :thread-emails="selectedThread?.emails"
          :initial-email-id="selectedEmailId"
          :client="emailClient"
          @back="backToList"
          @reply="replyToEmail"
          @reply-all="replyToEmail"
          @forward="replyToEmail"
          @download="downloadThreadAttachment"
          @mark-as-read="markThreadRead"
        />

        <MessageDetail 
          v-else
          :detail="detail" 
          :attachments="attachments" 
          :body-html="bodyHtml" 
          :body-text="bodyText"
          :headers="emailHeaders"
          :raw-message="rawMessage"
          :show-headers="showHeaders"
          :show-raw-message="showRawMessage"
          :mailboxes="mailboxes"
          :current-mailbox-id="currentMailboxId"
          @back-to-list="backToList" 
          @reply="replyToCurrent" 
          @delete="deleteCurrent" 
          @download="download"
          @load-headers="loadHeaders"
          @load-raw-message="loadRawMessage"
          @move-to-folder="moveEmailToFolder"
        />
      </section>
    </main>

    <nav v-if="hasAccounts" class="mobile-tabs" aria-label="Primary">
      <button
        class="tab-btn"
        :class="{ active: currentView === 'mail' }"
        @click="switchView('mail')"
      >
        Mail
      </button>
      <button
        class="tab-btn"
        :class="{ active: currentView === 'contacts' }"
        @click="switchView('contacts')"
      >
        Contacts
      </button>
      <button
        class="tab-btn"
        :class="{ active: currentView === 'calendar' }"
        @click="switchView('calendar')"
      >
        Calendar
      </button>
    </nav>

    <!-- Event Editor (keep outside .detail so it's visible in calendar view) -->
    <EventEditor 
      v-if="hasAccounts"
      :open="eventEditorOpen" 
      :event="editingEvent"
      @close="closeEventEditor"
      @save="saveEvent"
      @delete="deleteEvent"
    />
  </div>
</template>

<style>
/* Global styles are imported from assets/styles.css */
</style>
