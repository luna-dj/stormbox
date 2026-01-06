<script>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'

export default {
  name: 'FolderList',
  props: {
    mailboxes: {
      type: Array,
      default: () => []
    },
    currentMailboxId: String,
    accounts: {
      type: Array,
      default: () => []
    },
    activeAccountId: String,
    profileName: String,
    profileEmail: String
  },
  emits: ['compose', 'reload', 'switch-mailbox', 'set-account', 'add-account', 'logout'],
  setup(props, { emit }) {
    const isMobile = ref(window.innerWidth <= 900)
    
    const checkMobile = () => {
      isMobile.value = window.innerWidth <= 900
    }
    
    onMounted(() => {
      window.addEventListener('resize', checkMobile)
      checkMobile()
    })
    
    onBeforeUnmount(() => {
      window.removeEventListener('resize', checkMobile)
    })
    
    const displayName = (m) => {
      const role = (m.role || "").toLowerCase(), mailboxName = (m.name || "").toLowerCase();
      if (role === "trash" || mailboxName === "deleted items" || mailboxName === "trash") return "Trash";
      if (role === "junk" || mailboxName === "spam" || mailboxName === "junk") return "Spam";
      if (role === "sent" || mailboxName === "sent" || mailboxName === "sent items") return "Sent";
      if (role === "drafts" || mailboxName === "drafts") return "Drafts";
      if (role === "archive" || mailboxName === "archive" || mailboxName === "archives") return "Archives";
      if (role === "inbox" || mailboxName === "inbox") return "Inbox";
      return m.name || "Mailbox";
    }

    const unreadBadge = (m) => (typeof m.unreadEmails === "number" && m.unreadEmails > 0) ? ` • ${m.unreadEmails}` : ""

    const byName = (a, b) => displayName(a).localeCompare(displayName(b))

    const orderedTop = computed(() => {
      const pick = (role, names) => props.mailboxes.find(x => (x.role || "").toLowerCase() === role) || props.mailboxes.find(x => names.includes((x.name || "").toLowerCase()));
      return [
        pick("inbox", ["inbox"]),
        pick("archive", ["archive", "archives"]),
        pick("drafts", ["drafts"]),
        pick("sent", ["sent", "sent items"]),
        pick("junk", ["junk", "spam"]),
        pick("trash", ["trash", "deleted items"])
      ].filter(Boolean);
    })

    const orderedOther = computed(() => {
      const picked = new Set(orderedTop.value.map(x => x.id));
      return props.mailboxes.filter(m => !picked.has(m.id) && (m.role || "") !== "outbox").slice().sort(byName);
    })

    const showQuickMenu = ref(false)
    const showAccountMenu = ref(false)

    const toggleQuickMenu = () => {
      showQuickMenu.value = !showQuickMenu.value
      if (showQuickMenu.value) showAccountMenu.value = false
    }

    const toggleAccountMenu = () => {
      showAccountMenu.value = !showAccountMenu.value
      if (showAccountMenu.value) showQuickMenu.value = false
    }

    const closeMenus = () => {
      showQuickMenu.value = false
      showAccountMenu.value = false
    }

    const handleSetAccount = (accountId) => {
      closeMenus()
      emit('set-account', accountId)
    }

    const handleAddAccount = () => {
      closeMenus()
      emit('add-account')
    }

    const handleCompose = () => {
      closeMenus()
      emit('compose')
    }

    const handleReload = () => {
      closeMenus()
      emit('reload')
    }

    const handleLogout = () => {
      closeMenus()
      emit('logout')
    }

    onMounted(() => {
      document.addEventListener('click', closeMenus)
    })

    onBeforeUnmount(() => {
      document.removeEventListener('click', closeMenus)
    })

    const findMailboxId = (role, names) => {
      const byRole = props.mailboxes.find(x => (x.role || "").toLowerCase() === role)
      if (byRole) return byRole.id
      const byName = props.mailboxes.find(x => names.includes((x.name || "").toLowerCase()))
      return byName ? byName.id : null
    }

    const viewMailboxIds = computed(() => ({
      inbox: findMailboxId("inbox", ["inbox"]),
      drafts: findMailboxId("drafts", ["drafts"]),
      sent: findMailboxId("sent", ["sent", "sent items"])
    }))

    return {
      displayName,
      unreadBadge,
      orderedTop,
      orderedOther,
      viewMailboxIds,
      showQuickMenu,
      showAccountMenu,
      toggleQuickMenu,
      toggleAccountMenu,
      closeMenus,
      handleSetAccount,
      handleAddAccount,
      handleCompose,
      handleReload,
      handleLogout,
      isMobile
    }
  }
}
</script>

<template>
  <aside class="folders">
    <div class="profile">
      <div class="avatar">{{ (profileName || profileEmail || 'ME').slice(0, 2).toUpperCase() }}</div>
      <div class="profile-text">
        <div class="profile-name">{{ profileName || 'Account' }}</div>
        <div class="profile-sub">Hivepost</div>
      </div>
      <div class="profile-actions">
        <button class="icon-btn" title="Quick actions" @click.stop="toggleQuickMenu">⋯</button>
        <button class="icon-btn" title="Accounts" @click.stop="toggleAccountMenu">☰</button>

        <div v-if="showQuickMenu" class="menu" @click.stop>
          <button class="menu-item" @click="handleCompose">New message</button>
          <button class="menu-item" @click="handleReload">Reload</button>
          <div class="menu-divider"></div>
          <button class="menu-item" @click="handleLogout">Logout</button>
        </div>

        <div v-if="showAccountMenu" class="menu" @click.stop>
          <div class="menu-title">Accounts</div>
          <button
            v-for="account in accounts"
            :key="account.id"
            class="menu-item"
            :class="{ active: account.id === activeAccountId }"
            @click="handleSetAccount(account.id)"
          >
            <span class="menu-main">{{ account.label || account.email || account.id }}</span>
            <span class="menu-sub">{{ account.email || account.id }}</span>
          </button>
          <div v-if="!accounts.length" class="menu-empty">No accounts added</div>
          <div class="menu-divider"></div>
          <button class="menu-item" @click="handleAddAccount">Add account…</button>
        </div>
      </div>
    </div>

    <div class="ftools">
      <button id="composeBtn" title="New message" @click="handleCompose">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
          stroke-linejoin="round" aria-hidden="true">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
        <span>New message</span>
      </button>
      <button id="reload" title="Reload" @click="$emit('reload')">Reload</button>
    </div>

    <div class="section-label">Views</div>
    <div class="view-list">
      <button
        class="view-item"
        :class="{ active: currentMailboxId === viewMailboxIds.inbox }"
        :disabled="!viewMailboxIds.inbox"
        @click="viewMailboxIds.inbox && $emit('switch-mailbox', viewMailboxIds.inbox)"
      >
        Inbox
      </button>
      <button
        class="view-item"
        :class="{ active: currentMailboxId === viewMailboxIds.drafts }"
        :disabled="!viewMailboxIds.drafts"
        @click="viewMailboxIds.drafts && $emit('switch-mailbox', viewMailboxIds.drafts)"
      >
        Drafts
      </button>
      <button
        class="view-item"
        :class="{ active: currentMailboxId === viewMailboxIds.sent }"
        :disabled="!viewMailboxIds.sent"
        @click="viewMailboxIds.sent && $emit('switch-mailbox', viewMailboxIds.sent)"
      >
        Sent
      </button>
    </div>

    <div class="fscroll">
      <div id="foldersTop">
        <div v-for="m in orderedTop" :key="m.id" class="mbox"
          :class="[{ active: m.id === currentMailboxId }, { unread: (m.unreadEmails || 0) > 0 }]"
          @click="$emit('switch-mailbox', m.id)">
          <div class="name">{{ displayName(m) }}</div>
          <div v-if="!isMobile" class="count" v-html="unreadBadge(m)"></div>
        </div>
      </div>

      <div id="otherHeader" class="title" v-show="orderedOther.length">Folders</div>
      <div id="foldersOther">
        <div v-for="m in orderedOther" :key="m.id" class="mbox"
          :class="[{ active: m.id === currentMailboxId }, { unread: (m.unreadEmails || 0) > 0 }]"
          @click="$emit('switch-mailbox', m.id)">
          <div class="name">{{ displayName(m) }}</div>
          <div v-if="!isMobile" class="count" v-html="unreadBadge(m)"></div>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.folders {
  border-right: 1px solid var(--border);
  display: grid;
  grid-template-rows: auto auto auto 1fr;
  background: var(--panel2);
  min-height: 0;
}

.profile {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 12px 12px 4px;
}

.avatar {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--accent);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 12px;
}

.profile-text {
  min-width: 0;
}

.profile-name {
  font-weight: 600;
  color: var(--text);
  font-size: 14px;
}

.profile-sub {
  font-size: 12px;
  color: var(--muted);
}

.profile-actions {
  display: flex;
  gap: 6px;
  position: relative;
}

.profile .icon-btn {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel2);
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.menu {
  position: absolute;
  right: 0;
  top: 36px;
  min-width: 200px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.35);
  padding: 6px;
  display: grid;
  gap: 4px;
  z-index: 10;
}

.menu-title {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  padding: 4px 6px 2px;
}

.menu-item {
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  color: var(--text);
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  display: grid;
  gap: 2px;
}

.menu-item:hover,
.menu-item.active {
  background: var(--rowHover);
}

.menu-item.active {
  font-weight: 600;
}

.menu-main {
  font-size: 13px;
}

.menu-sub {
  font-size: 12px;
  color: var(--muted);
}

.menu-divider {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}

.menu-empty {
  font-size: 12px;
  color: var(--muted);
  padding: 8px 10px;
}

.section-label {
  padding: 10px 12px 6px;
  color: var(--muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.view-list {
  display: grid;
  gap: 6px;
  padding: 0 10px 10px;
}

.view-item {
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  text-align: left;
  font-size: 13px;
}

.view-item.active {
  background: var(--rowActive);
  color: var(--text);
  border-color: var(--accent);
}

.ftools {
  display: flex;
  gap: .5rem;
  padding: 8px;
  border-bottom: 1px solid var(--border);
}

.ftools button {
  padding: .6rem .9rem;
  border: 0;
  border-radius: .6rem;
  background: var(--accent);
  color: #fff;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: .45rem;
  width: 100%;
  justify-content: center;
}

.ftools button:hover {
  filter: brightness(1.08);
}

.ftools svg {
  width: 16px;
  height: 16px;
  display: block;
}

.fscroll {
  overflow: auto;
  min-height: 0;
}

#foldersTop,
#foldersOther {
  padding: 6px;
  overflow: visible;
}

.title {
  padding: 10px 12px;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  font-weight: 600;
}

.mbox {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: .5rem;
  cursor: pointer;
  color: var(--text);
}

.mbox:hover {
  background: var(--rowHover);
}

.mbox.active {
  background: var(--rowActive);
  color: var(--text);
}

.mbox .name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mbox .count {
  color: var(--muted);
  font-size: 12px;
}

@media (max-width: 900px) {
  .mbox .count,
  .mobile-hide {
    display: none !important;
  }
}

.mbox.unread .name {
  font-weight: 700;
  color: var(--text);
}

.mbox.unread .count {
  font-weight: 700;
  color: var(--text);
}

@media (max-width: 900px) {
  .mbox .count,
  .mbox.unread .count,
  .mobile-hide {
    display: none !important;
  }

  .folders {
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }
}
</style>
