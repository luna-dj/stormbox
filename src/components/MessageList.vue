<script>
import { ref, computed, watch, onMounted } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import Avatar from './Avatar.vue'
import ThreadListItem from './ThreadListItem.vue'

export default {
  name: 'MessageList',
  components: {
    Avatar,
    ThreadListItem
  },
  props: {
    currentMailboxId: String,
    currentMailboxName: String,
    selectedEmailId: String,
    viewMode: String,
    visibleMessages: Array,
    groupedThreads: Array,
    listMode: {
      type: String,
      default: 'threads'
    },
    totalCount: Number
  },
  emits: ['set-view', 'select-message', 'virt-range', 'update:filterText', 'update:list-mode'],
  setup(props, { emit }) {
    const filterText = ref('')
    const listMode = ref(props.listMode || (props.viewMode === 'conversations' ? 'threads' : 'messages'))
    const expandedThreads = ref(new Set())
    const rows = ref(null)
    const colsRef = ref(null)
    const rowHeight = ref(56)
    const debugInfo = false

    const sortPropForBox = () => {
      const name = (props.currentMailboxName || "").toLowerCase()
      return name === "sent" || name === "sent items" ? "sentAt" : "receivedAt"
    }

    const dateForItem = (item) => {
      if (!item) return ""
      const sortProp = sortPropForBox()
      return sortProp === "sentAt"
        ? (item.sentAt || item.receivedAt || "")
        : (item.receivedAt || item.sentAt || "")
    }

    const fmtDate = (iso) => {
      try {
        return new Date(iso).toLocaleString();
      } catch {
        return iso || "";
      }
    }

    const corrFor = (m) => {
      const role = (props.currentMailboxId?.role || "").toLowerCase();
      const fname = (props.currentMailboxId?.name || "").toLowerCase();
      const sentish = role === "sent" || fname === "sent" || fname === "sent items";
      if (sentish) {
        const a = (m.to && m.to[0]) || {};
        return {
          name: (a.name || "").trim(),
          email: (a.email || "").trim(),
          display: a.name || a.email || ""
        };
      }
      const a = (m.from && m.from[0]) || {};
      return {
        name: (a.name || "").trim(),
        email: (a.email || "").trim(),
        display: a.name || a.email || ""
      };
    }

    // Removed onRowsScroll - no longer needed

    // Virtualizer over visibleMessages
    const items = computed(() => props.visibleMessages || [])
    const threads = computed(() => props.groupedThreads || [])
    const isFiltered = computed(() => !!filterText.value || (props.viewMode !== 'all' && props.viewMode !== 'conversations'))

    // Use total count when not filtering, otherwise use actual items length
    const virtualCount = computed(() => {
      if (isFiltered.value) {
        return items.value.length;
      }
      // Use the total count from the server if available
      return props.totalCount || items.value.length;
    })

    const updateRowHeight = () => {
      rowHeight.value = window.innerWidth <= 900 ? 92 : 56
    }

    onMounted(() => {
      updateRowHeight()
      window.addEventListener('resize', updateRowHeight)
    })

    const virtualizer = useVirtualizer(
      computed(() => ({
        count: virtualCount.value,
        getScrollElement: () => rows.value,
        estimateSize: () => rowHeight.value,
        overscan: 8,
        // Stable key by index avoids DOM reuse hazards during long jumps/sparse loads
        getItemKey: (i) => i,
        initialRect: { width: rows.value?.clientWidth || 0, height: rows.value?.clientHeight || 0 },
        initialOffset: 0
      }))
    )

    const virtualItems = computed(() => virtualizer.value.getVirtualItems())
    const totalSize = computed(() => virtualizer.value.getTotalSize())
    const size = computed(() => virtualizer.value.getSize())
    const scrollOffset = computed(() => virtualizer.value.getScrollOffset())
    const itemsLength = computed(() => items.value.length)

    const rowsMetrics = ref({ h: 0, ch: 0, sh: 0 })
    const updateRowsMetrics = () => {
      const el = rows.value
      if (!el) return
      rowsMetrics.value = {
        h: el.offsetHeight || 0,
        ch: el.clientHeight || 0,
        sh: el.scrollHeight || 0
      }
    }

    onMounted(() => {
      updateRowsMetrics()
      try {
        const ro = new ResizeObserver(() => updateRowsMetrics())
        if (rows.value) ro.observe(rows.value)
      } catch { }
    })

    // Compute filler height so the header stays pinned to the top when
    // there are fewer rows than the viewport height
    const headerHeight = computed(() => (colsRef.value?.offsetHeight) || 0)
    const fillerHeight = computed(() => Math.max(0, (size.value - totalSize.value - headerHeight.value)))

    const containerStyle = computed(() => ({
      height: totalSize.value + 'px',
      position: 'relative'
    }))

    const itemStyle = (v) => ({
      position: 'absolute',
      top: v.start + 'px',
      left: 0,
      right: 0,
      height: v.size + 'px'
    })

    // Watch for filter text changes and emit to parent
    watch(filterText, (newValue) => {
      emit('update:filterText', newValue)
    })

    watch(() => props.listMode, (value) => {
      if (value && value !== listMode.value) {
        listMode.value = value
      }
    })

    watch(() => props.viewMode, (value) => {
      // When switching to conversations view, automatically switch to threads mode
      if (value === 'conversations') {
        listMode.value = 'threads'
      } else {
        // When switching away from conversations, switch to messages if in threads mode
        if (listMode.value === 'threads') {
          listMode.value = 'messages'
        }
      }
    }, { immediate: true })

    watch(listMode, (value) => {
      emit('update:list-mode', value)
    })

    // Clear filter function
    const clearFilter = () => {
      filterText.value = ''
    }

    const isThreadView = computed(() => listMode.value === 'threads')

    const handleConversationsClick = () => {
      listMode.value = 'threads'
      emit('set-view', 'conversations')
    }

    const handleMessagesClick = () => {
      listMode.value = 'messages'
      emit('set-view', 'all')
    }

    const toggleThread = (threadId) => {
      const next = new Set(expandedThreads.value)
      if (next.has(threadId)) {
        next.delete(threadId)
      } else {
        next.add(threadId)
      }
      expandedThreads.value = next
    }

    // Console diagnostics
    watch([itemsLength, virtualCount, totalSize, size, scrollOffset], ([il, vc, ts, sz, off]) => {
      if (debugInfo) {
        // eslint-disable-next-line no-console
        console.log('[virt]', { items: il, virtual: vc, totalSize: ts, size: sz, offset: off })
      }
      updateRowsMetrics()
    })

    // Reset scroll and virtualizer on mailbox change to avoid stale measurements
    watch(() => props.currentMailboxId, async () => {
      if (rows.value) rows.value.scrollTop = 0
      await Promise.resolve()
      requestAnimationFrame(() => {
        try {
          if ((items.value?.length || 0) > 0) {
            virtualizer.value.scrollToIndex(0, { align: 'start' })
          }
          virtualizer.value.measure()
        } catch { }
      })
    })

    // Prefetch trigger based on virtual range
    let lastEmit = 0
    watch(virtualItems, (vis) => {
      const end = vis.length ? vis[vis.length - 1].index : 0
      const now = performance.now()
      if (now - lastEmit > 100) { // throttle to ~10/sec
        emit('virt-range', end)
        lastEmit = now
      }
    })

    return {
      filterText,
      clearFilter,
      listMode,
      isThreadView,
      threads,
      expandedThreads,
      toggleThread,
      handleConversationsClick,
      handleMessagesClick,
      totalCount: computed(() => props.totalCount),
      rows,
      colsRef,
      rowHeight,
      debugInfo,
      sortPropForBox,
      dateForItem,
      fmtDate,
      corrFor,
      virtualizer,
      virtualItems,
      items,
      totalSize,
      itemsLength,
      virtualCount,
      size,
      scrollOffset,
      rowsMetrics,
      headerHeight,
      fillerHeight,
      containerStyle,
      itemStyle
    }
  }
}
</script>

<template>
  <section class="list">
    <div class="list-header">
      <div class="folder-title">
        <span class="folder-name">{{ viewMode === 'conversations' ? 'Conversations' : (currentMailboxName || 'Mailbox') }}</span>
        <span class="folder-count">{{ totalCount ?? '…' }}</span>
      </div>
      <div class="folder-actions">
        <button class="icon-btn" title="Previous" type="button">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>
        </button>
        <button class="icon-btn" title="Next" type="button">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
        </button>
      </div>
    </div>
    <div class="list-topbar">
      <div class="searchbar">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15.5 14h-.8l-.3-.3a6.5 6.5 0 10-.7.7l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0a4.5 4.5 0 110-9 4.5 4.5 0 010 9z"/>
        </svg>
        <input id="q" type="search" v-model.trim="filterText" placeholder="Search messages">
        <button v-if="filterText" class="clear-filter" @click="clearFilter" title="Clear filter">×</button>
      </div>
      <div class="list-toolbar">
        <button class="icon-btn" title="Archive" type="button">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 7H3.5l1.2 12.5h14.6L20.5 7zm-3.8 4.5H7.3v-2h9.4v2zM20 5H4l-1-3h18l-1 3z"/></svg>
        </button>
        <button class="icon-btn" title="Delete" type="button">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12l-1 13H7L6 7zm4-3h4l1 2H9l1-2z"/></svg>
        </button>
        <button class="icon-btn" title="Mark read" type="button">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 8l-8 5-8-5V6l8 5 8-5v2zm0 3l-8 5-8-5v7h16v-7z"/></svg>
        </button>
      </div>
    </div>

    <div class="list-filters">
      <div class="seg">
        <button id="viewAll" :class="{ active: viewMode === 'all' }" @click="$emit('set-view', 'all')">
          All
        </button>
        <button id="viewRead" :class="{ active: viewMode === 'read' }" @click="$emit('set-view', 'read')">
          Read
        </button>
        <button id="viewUnread" :class="{ active: viewMode === 'unread' }" @click="$emit('set-view', 'unread')">
          Unread
        </button>
      </div>
      <div class="seg">
        <button :class="{ active: isThreadView }" @click="handleConversationsClick">
          Conversations
        </button>
        <button :class="{ active: !isThreadView }" @click="handleMessagesClick">
          Messages
        </button>
      </div>
      <div id="folderTotal" class="count">{{ totalCount ?? '…' }} messages</div>
    </div>

    <!-- Virtualization debug info -->
    <div class="vdbg" v-if="debugInfo">
      items: {{ itemsLength }}, virtual: {{ virtualCount }}, totalSize: {{ totalSize }}px, size: {{ size }}px, offset:
      {{ scrollOffset }}, hasEl: {{ !!rows }}
      | rows h/ch/sh: {{ rowsMetrics.h }}/{{ rowsMetrics.ch }}/{{ rowsMetrics.sh }}
    </div>

    <div v-if="isThreadView" class="thread-rows">
      <div v-if="threads.length === 0" class="empty-state">
        {{ viewMode === 'conversations' ? 'No conversations to show' : 'No threads to show' }}
      </div>
      <ThreadListItem
        v-for="thread in threads"
        :key="thread.threadId"
        :thread="thread"
        :is-expanded="expandedThreads.has(thread.threadId)"
        :selected-email-id="selectedEmailId"
        :expanded-emails="thread.emails"
        @toggle-expand="toggleThread(thread.threadId)"
        @email-select="$emit('select-message', $event)"
      />
    </div>
    <div v-else id="rows" ref="rows">
      <div class="cols" ref="colsRef">
        <div></div>
        <div>Correspondents</div>
        <div>Subject</div>
        <div>Date</div>
      </div>

      <!-- Virtualized rows -->
      <div :style="containerStyle">
        <div v-for="v in virtualItems" :key="v.key" :style="itemStyle(v)">
          <div v-if="items[v.index]" class="rowitem"
            :class="[{ unread: !items[v.index].isSeen }, { selected: items[v.index].id === selectedEmailId }, { 'has-attach': items[v.index].hasAttachment }]"
            @click="$emit('select-message', items[v.index].id)">
            <Avatar :name="corrFor(items[v.index]).name" :email="corrFor(items[v.index]).email" />
            <div class="who">{{ corrFor(items[v.index]).display }}</div>
            <div class="line">
              <div class="subject">{{ items[v.index].subject || '(no subject)' }}</div>
              <div class="snippet">{{ (items[v.index].preview || '').trim() }}</div>
            </div>
            <div class="date">
              <span>{{ fmtDate(dateForItem(items[v.index])) }}</span>
            </div>
          </div>
          <div v-else class="rowitem"></div>
        </div>
      </div>

      <!-- Bottom filler to keep header at top when list is shorter than viewport -->
      <div class="filler" :style="{ height: fillerHeight + 'px' }"></div>
    </div>
  </section>
</template>

<style scoped>
.list {
  border-right: 1px solid var(--border);
  display: grid;
  grid-template-rows: auto auto auto 1fr;
  background: var(--panel2);
  min-height: 0;
  height: 100%;
  --colspec: 40px 220px 1fr 140px;
}

.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}

.folder-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.folder-name {
  font-weight: 600;
  color: var(--text);
}

.folder-count {
  background: var(--accent);
  color: #fff;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 12px;
}

.folder-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

#rows {
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
  height: 100%;
}

/* Fixed row height for virtualization */
.rowitem {
  height: 56px;
}

.list-topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}

.searchbar {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--panel2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 6px 10px;
  flex: 1 1 auto;
}

.searchbar svg {
  width: 16px;
  height: 16px;
  fill: var(--muted);
}

.searchbar input {
  border: 0;
  background: transparent;
  color: var(--text);
  width: 100%;
  outline: none;
  font-size: 13px;
}

.searchbar input::placeholder {
  color: var(--muted);
}

.list-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
}

.icon-btn {
  width: 30px;
  height: 30px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
}

.icon-btn svg {
  fill: currentColor;
}

.icon-btn svg {
  width: 16px;
  height: 16px;
  fill: currentColor;
}

.list-filters {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--panel2);
}

.seg {
  display: inline-flex;
  background: var(--panel2);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 2px;
}

.seg button {
  background: transparent;
  border: 0;
  padding: .35rem .75rem;
  color: var(--muted);
  cursor: pointer;
  border-radius: 999px;
  font-weight: 600;
  font-size: 12px;
}

.seg button.active {
  background: var(--accent);
  color: #fff;
}

.count {
  color: var(--muted);
  font-size: 12px;
}

.thread-rows {
  overflow-y: auto;
  min-height: 0;
  height: 100%;
}

.thread-rows .empty-state {
  padding: 16px;
  color: var(--muted);
  font-size: 13px;
}

.clear-filter {
  background: none;
  border: none;
  font-size: 18px;
  line-height: 1;
  color: #8b93a7;
  cursor: pointer;
}


#rows .cols {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--panel2);
  padding: 10px 12px 10px 50px;
  border-bottom: 1px solid var(--border);
  color: var(--muted);
  font-size: 12px;
  display: grid;
  grid-template-columns: var(--colspec);
  gap: 10px;
  align-items: center;
}

.rowitem {
  position: relative;
  padding: 10px 12px 10px 50px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  display: grid;
  grid-template-columns: var(--colspec);
  gap: 10px;
  align-items: center;
}

.rowitem:hover {
  background: var(--rowHover);
}

.rowitem.selected {
  background: var(--rowActive);
}

.rowitem .who {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 400;
}

.rowitem .subject {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 400;
}

.rowitem .line {
  min-width: 0;
  overflow: hidden;
}

.rowitem.unread .who,
.rowitem.unread .subject {
  font-weight: 700;
}

@media (max-width: 900px) {
  .list {
    --colspec: 32px 1fr;
  }

  .list .viewbar,
  .list .countbar,
  .list .filterbar {
    padding-left: 12px;
    padding-right: 12px;
  }

  #rows .cols {
    grid-template-columns: var(--colspec);
    padding-left: 14px;
  }

  #rows .cols div:nth-child(3),
  #rows .cols div:nth-child(4),
  #rows .cols div:nth-child(1) {
    display: none;
  }

  #rows .cols div:nth-child(2) {
    grid-column: 2 / -1;
    text-align: left;
  }

  .rowitem {
    grid-template-columns: var(--colspec);
    row-gap: 4px;
    padding: 8px 12px 8px 14px;
    height: 92px;
  }

  .rowitem .line {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .rowitem .who,
  .rowitem .line {
    grid-column: 2 / -1;
  }

  .rowitem .date {
    display: block !important;
    grid-column: 2 / -1;
    justify-self: end;
    text-align: right;
    font-size: 11px;
    color: var(--muted);
  }

  .rowitem .who {
    font-size: 14px;
  }

  .rowitem .subject {
    font-size: 13px;
  }

  .rowitem .snippet {
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .rowitem .who,
  .rowitem .subject,
  .rowitem .snippet {
    line-height: 1.25;
  }

  .filterbar {
    grid-template-columns: 1fr;
  }

  .filter-input-container {
    width: 100%;
    max-width: none;
  }

  #rows {
    -webkit-overflow-scrolling: touch;
  }
}

.rowitem .snippet {
  color: var(--muted);
  font-weight: 400;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rowitem .date {
  color: var(--muted);
  justify-self: end;
  text-align: right;
  display: flex;
  align-items: center;
  gap: 6px;
}

/* Blue unread dot (left) */
.rowitem.unread::before {
  content: "";
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
}

/* Paperclip (after dot, left gutter) */
.rowitem.has-attach::after {
  content: "📎";
  position: absolute;
  left: 28px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 18px;
  line-height: 1;
  opacity: .9;
}

.loading {
  padding: 12px;
  text-align: center;
  color: var(--muted);
}
</style>
