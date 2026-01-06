<script>
import { computed, provide } from 'vue'
import { useEmailStore } from './composables/useEmailStore.js'
import { useCalendarStore } from './composables/useCalendarStore.js'
import { useTheme } from './composables/useTheme.js'
import LoginForm from './components/LoginForm.vue'
import FolderList from './components/FolderList.vue'
import MessageList from './components/MessageList.vue'
import ComposePanel from './components/ComposePanel.vue'
import MessageDetail from './components/MessageDetail.vue'
import ContactEditor from './components/ContactEditor.vue'
import ContactManager from './components/ContactManager.vue'
import DraftsList from './components/DraftsList.vue'
import CalendarView from './components/CalendarView.vue'
import EventEditor from './components/EventEditor.vue'

export default {
  name: 'App',
  components: {
    LoginForm,
    FolderList,
    MessageList,
    ComposePanel,
    MessageDetail,
    ContactEditor,
    ContactManager,
    DraftsList,
    CalendarView,
    EventEditor
  },
  setup() {
    const emailStore = useEmailStore()
    const calendarStore = useCalendarStore(emailStore)
    const { theme, cycle } = useTheme()

    const serverName = computed(() => {
      const url = "https://hivepost.nl"
      try {
        return new URL(url).hostname
      } catch {
        return url
      }
    })

    // Override switchView to handle calendar
    const switchView = (view) => {
      if (view === 'calendar') {
        calendarStore.calendarViewMode.value = 'month' // Reset calendar view to month
        emailStore.currentView.value = 'calendar'
        // Refresh calendars when switching to calendar view
        calendarStore.refreshCalendars()
      } else {
        emailStore.switchView(view)
      }
    }

    // Provide stores to child components
    provide('emailStore', emailStore)
    provide('calendarStore', calendarStore)

    // Event editor handlers
    const saveEvent = async () => {
      await calendarStore.refreshEvents()
    }

    const deleteEvent = async () => {
      await calendarStore.refreshEvents()
    }

    return {
      ...emailStore,
      ...calendarStore,
      switchView,
      saveEvent,
      deleteEvent,
      currentTheme: theme,
      cycle,
      serverName,
      themeTitle: computed(() => theme.value === 'system' ? 'Theme: system (click to light)' : (theme.value === 'light' ? 'Theme: light (click to dark)' : 'Theme: dark (click to system)'))
    }
  }
}
</script>

<template>
  <div id="app">
    <!-- Login Form -->
    <LoginForm :connected="connected" :status="status" :error="error" @connect="connect" />

    <!-- Header -->
    <header v-if="connected">
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
      (!selectedEmailId && !composeOpen && !contactEditorOpen && currentView !== 'calendar') ? 'hide-detail' : ''
    ]" v-if="connected">
      <!-- Mail View -->
      <template v-if="currentView === 'mail'">
        <!-- Folder List -->
        <div style="display: flex; flex-direction: column; border-right: 1px solid var(--border);">
          <FolderList :mailboxes="mailboxes" :current-mailbox-id="currentMailboxId" @compose="toggleCompose"
            @reload="refreshCurrentMailbox" @switch-mailbox="switchMailbox" />
          <DraftsList 
            :drafts="drafts" 
            :loading="loadingDrafts"
            @resume-draft="loadDraft"
            @refresh="refreshDrafts"
          />
        </div>

        <!-- Message List -->
        <MessageList :current-mailbox-id="currentMailboxId" :selected-email-id="selectedEmailId" :view-mode="viewMode"
          :visible-messages="visibleMessages" :total-count="totalEmailsCount" @set-view="setViewMode"
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
          @update:identity="({ id, name, email }) => updateIdentity(id, { name, email })"
        />

        <!-- Message Detail -->
        <MessageDetail 
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

    <!-- Event Editor (keep outside .detail so it's visible in calendar view) -->
    <EventEditor 
      v-if="connected"
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
