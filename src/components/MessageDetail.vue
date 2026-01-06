<script>
import { computed, ref, onMounted, watch, nextTick } from 'vue'
import DOMPurify from 'dompurify'
import FolderSelector from './FolderSelector.vue'

export default {
  name: 'MessageDetail',
  components: {
    FolderSelector
  },
  props: {
    detail: Object,
    attachments: Array,
    bodyHtml: String,
    bodyText: String,
    headers: Object,
    rawMessage: String,
    showHeaders: Boolean,
    showRawMessage: Boolean,
    mailboxes: Array,
    currentMailboxId: String
  },
  emits: ['back-to-list', 'reply', 'delete', 'download', 'load-headers', 'load-raw-message', 'move-to-folder'],
  setup(props, { emit }) {
    const fmtSize = (n) => {
      if (n == null) return "";
      const u = ["B", "KB", "MB", "GB"];
      let i = 0, x = Number(n);
      while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; }
      return `${x.toFixed(i ? 1 : 0)} ${u[i]}`;
    }

    const safeBody = computed(() => {
      const fallback = (() => {
        const esc = s => String(s || "").replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
        return `<pre style="white-space:pre-wrap;margin:0">${esc(props.bodyText || "")}</pre>`;
      })();

      let html = props.bodyHtml || fallback;

      const purifier = (typeof window !== 'undefined' && (window.DOMPurify || window.dompurify)) ||
        (typeof DOMPurify !== 'undefined' ? DOMPurify : null);

      if (!purifier) return html;

      try {
        html = purifier.sanitize(html, {
          ALLOW_UNKNOWN_PROTOCOLS: true,
          ADD_ATTR: ["target", "download", "rel"]
        });
        
        // Wrap long quoted sections (content after <hr> or with ">" prefix patterns) in scrollable containers
        // This helps ensure quoted content gets scrollbars when long
        if (html) {
          // Wrap content after <hr> tags in a scrollable div
          html = html.replace(/<hr[^>]*>([\s\S]*?)(?=<hr|$)/gi, (match, content) => {
            if (content.trim().length > 500) { // Only wrap if content is substantial
              return match + `<div class="quoted-content-scrollable">${content}</div>`;
            }
            return match;
          });
        }
        
        return html;
      } catch {
        return fallback;
      }
    });

    const formatHeaders = (headers) => {
      if (!headers || typeof headers !== 'object') return '';
      
      const formatValue = (val) => {
        if (val === null || val === undefined) return '';
        if (typeof val === 'string') return val;
        if (typeof val === 'number' || typeof val === 'boolean') return String(val);
        if (Array.isArray(val)) {
          return val.map(v => formatValue(v)).join(', ');
        }
        if (typeof val === 'object') {
          // Try to stringify, but handle circular references
          try {
            return JSON.stringify(val, null, 2);
          } catch (e) {
            return String(val);
          }
        }
        return String(val);
      };
      
      return Object.entries(headers)
        .map(([key, value]) => {
          // Handle array values (like multiple Received headers)
          if (Array.isArray(value)) {
            return value.map(v => `${key}: ${formatValue(v)}`).join('\n');
          }
          return `${key}: ${formatValue(value)}`;
        })
        .join('\n');
    };

    const showFolderSelector = ref(false);

    const openFolderSelector = () => {
      showFolderSelector.value = true;
    };

    const selectFolder = (targetMailboxId) => {
      showFolderSelector.value = false;
      emit('move-to-folder', targetMailboxId);
    };

    // Process DOM after render to wrap long quoted sections
    const processQuotedContent = () => {
      nextTick(() => {
        const preview = document.getElementById('d-preview');
        if (!preview) return;

        // First, find all <hr> elements and wrap content after them
        const hrs = preview.querySelectorAll('hr');
        hrs.forEach((hr) => {
          // Skip if already wrapped
          if (hr.closest('.quoted-content-scrollable')) return;
          
          let nextSibling = hr.nextElementSibling;
          const quotedElements = [];
          
          // Collect all siblings until next hr or end
          while (nextSibling && nextSibling.tagName !== 'HR') {
            quotedElements.push(nextSibling);
            nextSibling = nextSibling.nextElementSibling;
          }
          
          // If we have content, wrap it
          if (quotedElements.length > 0) {
            const wrapper = document.createElement('div');
            wrapper.className = 'quoted-content-scrollable';
            quotedElements.forEach(el => {
              if (el.parentNode) {
                wrapper.appendChild(el);
              }
            });
            if (hr.parentNode && wrapper.children.length > 0) {
              hr.parentNode.insertBefore(wrapper, hr.nextSibling);
            }
          }
        });

        // Wrap any pre elements that are long (likely quoted text)
        const pres = preview.querySelectorAll('pre');
        pres.forEach((pre) => {
          if (pre.closest('.quoted-content-scrollable')) return;
          
          // Check if it's likely quoted content (has ">" prefix or is after hr)
          const text = pre.textContent || '';
          const isQuoted = text.includes('>') || text.includes('On ') || text.includes('Van:') || text.includes('From:');
          
          if (isQuoted || pre.offsetHeight > 200) {
            const wrapper = document.createElement('div');
            wrapper.className = 'quoted-content-scrollable';
            if (pre.parentNode) {
              pre.parentNode.replaceChild(wrapper, pre);
              wrapper.appendChild(pre);
            }
          }
        });

        // Also wrap any divs or sections that contain quoted text patterns
        const allDivs = preview.querySelectorAll('div, p, section');
        allDivs.forEach((el) => {
          if (el.closest('.quoted-content-scrollable')) return;
          
          const text = el.textContent || '';
          // Check for common quote indicators
          const hasQuoteIndicators = text.includes('Van:') || 
                                     text.includes('From:') || 
                                     text.includes('Sent:') || 
                                     text.includes('Verzonden:') ||
                                     text.includes('On ') ||
                                     (text.match(/>/g) && text.match(/>/g).length > 5);
          
          if (hasQuoteIndicators && el.offsetHeight > 200) {
            const wrapper = document.createElement('div');
            wrapper.className = 'quoted-content-scrollable';
            if (el.parentNode) {
              el.parentNode.replaceChild(wrapper, el);
              wrapper.appendChild(el);
            }
          }
        });
      });
    };

    // Watch for changes to bodyHtml/bodyText and process
    watch(() => [props.bodyHtml, props.bodyText], () => {
      processQuotedContent();
    });

    onMounted(() => {
      processQuotedContent();
    });

    return {
      fmtSize,
      safeBody,
      formatHeaders,
      showFolderSelector,
      openFolderSelector,
      selectFolder
    }
  }
}
</script>

<template>
  <div class="detail">
    <!-- Read panel -->
    <div class="head">
      <div class="detailbar">
        <button id="backToList" class="btn-ghost backbtn" title="Back" @click="$emit('back-to-list')">
          ←
        </button>

        <div class="actbtns">
          <button id="replyBtn" class="btn-primary" title="Reply" @click="$emit('reply')">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px;">
              <path d="M10 19l-7-7 7-7" />
              <path d="M20 18v-1a4 4 0 0 0-4-4H3" />
            </svg>
            Reply
          </button>
          <button 
            id="headersBtn" 
            class="btn-ghost" 
            title="Show Headers" 
            @click="$emit('load-headers')"
            :class="{ active: showHeaders }"
          >
            Headers
          </button>
          <button 
            id="rawBtn" 
            class="btn-ghost" 
            title="Show Raw Message" 
            @click="$emit('load-raw-message')"
            :class="{ active: showRawMessage }"
          >
            Raw
          </button>
          <button 
            id="moveBtn" 
            class="btn-ghost" 
            title="Move to Folder" 
            @click="openFolderSelector"
          >
            Move
          </button>
          <button id="deleteBtn" class="btn-primary" title="Delete" @click="$emit('delete')">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px;">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
            </svg>
            Delete
          </button>
        </div>

        <span></span>
      </div>
      <div class="midline"></div>
      <h2 id="d-subject">{{ detail.subject || '(select a message)' }}</h2>

      <div class="grid" style="margin-top:8px">
        <div>From</div>
        <div class="v">{{ detail.from }}</div>
        <div>To</div>
        <div class="v">{{ detail.to }}</div>
        <div>CC</div>
        <div class="v">{{ detail.cc }}</div>
        <div>Date</div>
        <div class="v">{{ detail.date }}</div>
        <div>Flags</div>
        <div class="v">{{ detail.flags }}</div>
        <div>Size</div>
        <div class="v">{{ detail.size }}</div>
        <div>ID</div>
        <div class="v">{{ detail.id }}</div>
      </div>
    </div>

    <!-- Headers view -->
    <div v-if="showHeaders && headers" class="headers-view">
      <h3>Email Headers</h3>
      <pre class="headers-content">{{ formatHeaders(headers) }}</pre>
    </div>

    <!-- Raw message view -->
    <div v-if="showRawMessage && rawMessage" class="raw-message-view">
      <h3>Raw Message</h3>
      <pre class="raw-message-content">{{ rawMessage }}</pre>
    </div>

    <!-- Email body (sanitized HTML or text) -->
    <div class="preview" id="d-preview" v-html="safeBody" v-if="!showHeaders && !showRawMessage"></div>

    <div id="attachments" class="attachments" :class="{ visible: attachments.length }">
      <div class="atitle">Attachments</div>
      <div class="attlist" id="attlist">
        <div v-for="a in attachments" :key="a.blobId" class="att">
          <div class="meta">
            <div class="name" :title="a.name">{{ a.name }}</div>
            <div class="type">{{ a.type }}</div>
          </div>
          <div class="size">{{ fmtSize(a.size) }}</div>
          <div><button @click="$emit('download', a)">Download</button></div>
        </div>
      </div>
    </div>
    
    <FolderSelector
      :mailboxes="mailboxes"
      :current-mailbox-id="currentMailboxId"
      :show="showFolderSelector"
      @select-folder="selectFolder"
      @close="showFolderSelector = false"
    />
  </div>
</template>

<style scoped>
.detail {
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  background: var(--panel);
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.detail>* {
  min-height: 0;
}

.head {
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  max-height: 32vh;
  overflow: auto;
}

.detailbar {
  display: grid;
  grid-template-columns: auto auto 1fr;
  align-items: center;
  gap: .6rem;
}

.actbtns {
  display: flex;
  gap: .5rem;
  align-items: center;
}

/* Buttons */
.btn-ghost {
  padding: .35rem .6rem;
  border: 1px solid var(--border);
  border-radius: .6rem;
  background: transparent;
  color: #9aa3b2;
  cursor: pointer;
}

.btn-ghost:hover {
  background: #14182a;
  color: #e6e8ef;
}

.btn-ghost.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.btn-primary {
  padding: .55rem .9rem;
  border: 0;
  border-radius: .6rem;
  background: var(--accent);
  color: #fff;
  cursor: pointer;
}

.btn-primary:hover {
  filter: brightness(1.08);
}

.backbtn {
  font-size: 18px;
  line-height: 1;
}

.midline {
  border-bottom: 1px solid var(--border);
  margin: 8px 0;
}

.head h2 {
  margin: 0;
  font-size: 16px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.grid {
  display: grid;
  grid-template-columns: 100px 1fr;
  row-gap: 6px;
  column-gap: 10px;
  color: var(--muted);
  font-size: 13px;
}

.grid .v {
  color: var(--text);
  overflow-wrap: anywhere;
}

/* Email HTML/text viewer */
.preview {
  padding: 14px 16px;
  overflow-y: scroll;
  overflow-x: hidden;
  min-height: 0;
  max-height: 100%;
  scrollbar-gutter: stable both-edges;
  white-space: normal;
  color: #e6e8ef; /* Light text for dark mode */
  word-break: break-word;
  overscroll-behavior: contain;
  /* Custom scrollbar for Webkit browsers */
  scrollbar-width: auto; /* Firefox */
  scrollbar-color: #c6cedb #0c0f16; /* Firefox: thumb track */
  /* Ensure scrollbar is always visible when content overflows */
  scrollbar-gutter: stable;
}

.preview::-webkit-scrollbar {
  width: 14px; /* Wider scrollbar */
}

.preview::-webkit-scrollbar-track {
  background: #11131a; /* Darker track for contrast */
  border-left: 1px solid #1e2230; /* Add a border for separation */
}

.preview::-webkit-scrollbar-thumb {
  background: #9aa3b2; /* Light gray thumb */
  border-radius: 7px; /* Half of width for rounded ends */
  border: 3px solid #11131a; /* Padding around thumb */
}

.preview::-webkit-scrollbar-thumb:hover {
  background: #b0b8c5; /* Lighter on hover */
}

/* Light theme overrides for scrollbar */
:root[data-theme="light"] .preview::-webkit-scrollbar-track,
@media (prefers-color-scheme: light) {
  :root .preview::-webkit-scrollbar-track {
    background: #f4f7fb; /* Light track */
    border-left-color: #dbe1ea;
  }
}

:root[data-theme="light"] .preview::-webkit-scrollbar-thumb,
@media (prefers-color-scheme: light) {
  :root .preview::-webkit-scrollbar-thumb {
    background: #9ca3af; /* Darker thumb */
    border-color: #f4f7fb;
  }
}

:root[data-theme="light"] .preview::-webkit-scrollbar-thumb:hover,
@media (prefers-color-scheme: light) {
  :root .preview::-webkit-scrollbar-thumb:hover {
    background: #6b7280; /* Darker on hover */
  }
}

:root[data-theme="light"] .preview {
  scrollbar-color: #9ca3af #f4f7fb; /* Firefox light theme */
}

/* Light mode: dark text for email preview */
:root[data-theme="light"] .preview,
[data-theme="light"] .preview {
  color: #111827; /* Dark text for light mode */
}

/* System light mode preference */
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) .preview {
    color: #111827; /* Dark text for light mode */
  }
}

/* Ensure HTML email content respects theme colors */
.preview p,
.preview div,
.preview span,
.preview td,
.preview th,
.preview li {
  color: inherit;
}

/* Dark mode: force light text for HTML emails */
.preview * {
  color: #e6e8ef !important;
}

/* Light mode: force dark text for HTML emails */
:root[data-theme="light"] .preview *,
[data-theme="light"] .preview * {
  color: #111827 !important;
}

@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) .preview * {
    color: #111827 !important;
  }
}

/* Preserve link colors but ensure visibility */
.preview a {
  color: var(--accent) !important;
}

.preview img {
  max-width: 100%;
  height: auto;
}

.preview table {
  max-width: 100%;
  display: block;
  overflow: auto;
}

/* Quoted content scrollbar styling - target all possible quote patterns */
.preview blockquote,
.preview div[style*="border-left"],
.preview div[style*="border-left-color"],
.preview .gmail_quote,
.preview [class*="quote"],
.preview [class*="QuotedText"],
.preview pre[style*="border"],
.preview div[class*="quoted"],
.preview pre,
.preview hr + *,
.preview hr ~ * {
  max-height: 250px; /* Reduced height to trigger scrollbar sooner */
  overflow-y: auto;
  overflow-x: hidden;
  /* Custom scrollbar for quoted content */
  scrollbar-width: thin; /* Firefox */
  scrollbar-color: #9aa3b2 #1e2230; /* Firefox: thumb track */
  position: relative; /* Ensure scrollbar positioning */
}

/* Target content after horizontal rules (common quote separator) */
.preview hr {
  margin: 16px 0;
}

/* Style any div or section that comes after an hr (likely quoted content) */
.preview hr + div,
.preview hr + p,
.preview hr + pre,
.preview hr ~ div,
.preview hr ~ p,
.preview hr ~ pre {
  max-height: 250px;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: #9aa3b2 #1e2230;
  padding: 8px;
  margin: 8px 0;
}

/* Wrapper for quoted content added by JavaScript */
.preview .quoted-content-scrollable {
  max-height: 250px;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: #9aa3b2 #1e2230;
  padding: 8px 12px;
  margin: 8px 0;
  border-left: 3px solid var(--border);
  padding-left: 12px;
}

.preview .quoted-content-scrollable::-webkit-scrollbar {
  width: 14px;
}

.preview .quoted-content-scrollable::-webkit-scrollbar-track {
  background: #1e2230;
  border-left: 1px solid #2a2f3f;
}

.preview .quoted-content-scrollable::-webkit-scrollbar-thumb {
  background: #9aa3b2;
  border-radius: 7px;
  border: 3px solid #1e2230;
}

.preview .quoted-content-scrollable::-webkit-scrollbar-thumb:hover {
  background: #b0b8c5;
}

/* Light theme for quoted-content-scrollable */
:root[data-theme="light"] .preview .quoted-content-scrollable {
  scrollbar-color: #9ca3af #dbe1ea;
  border-left-color: #dbe1ea;
}

:root[data-theme="light"] .preview .quoted-content-scrollable::-webkit-scrollbar-track {
  background: #f4f7fb;
  border-left-color: #dbe1ea;
}

:root[data-theme="light"] .preview .quoted-content-scrollable::-webkit-scrollbar-thumb {
  background: #9ca3af;
  border-color: #f4f7fb;
}

:root[data-theme="light"] .preview .quoted-content-scrollable::-webkit-scrollbar-thumb:hover {
  background: #6b7280;
}

/* Also style any container that might wrap quoted text */
.preview > div:has(blockquote),
.preview > div:has([style*="border-left"]) {
  max-height: 500px;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: #9aa3b2 #1e2230;
}

.preview blockquote::-webkit-scrollbar,
.preview div[style*="border-left"]::-webkit-scrollbar,
.preview .gmail_quote::-webkit-scrollbar,
.preview [class*="quote"]::-webkit-scrollbar,
.preview pre::-webkit-scrollbar,
.preview div:has(> pre)::-webkit-scrollbar,
.preview div:has(> blockquote)::-webkit-scrollbar {
  width: 14px; /* Make it more visible */
}

.preview blockquote::-webkit-scrollbar-track,
.preview div[style*="border-left"]::-webkit-scrollbar-track,
.preview .gmail_quote::-webkit-scrollbar-track,
.preview [class*="quote"]::-webkit-scrollbar-track,
.preview pre::-webkit-scrollbar-track,
.preview div:has(> pre)::-webkit-scrollbar-track,
.preview div:has(> blockquote)::-webkit-scrollbar-track {
  background: #1e2230;
  border-left: 1px solid #2a2f3f;
}

.preview blockquote::-webkit-scrollbar-thumb,
.preview div[style*="border-left"]::-webkit-scrollbar-thumb,
.preview .gmail_quote::-webkit-scrollbar-thumb,
.preview [class*="quote"]::-webkit-scrollbar-thumb,
.preview pre::-webkit-scrollbar-thumb,
.preview div:has(> pre)::-webkit-scrollbar-thumb,
.preview div:has(> blockquote)::-webkit-scrollbar-thumb {
  background: #9aa3b2;
  border-radius: 7px;
  border: 3px solid #1e2230;
}

.preview blockquote::-webkit-scrollbar-thumb:hover,
.preview div[style*="border-left"]::-webkit-scrollbar-thumb:hover,
.preview .gmail_quote::-webkit-scrollbar-thumb:hover,
.preview [class*="quote"]::-webkit-scrollbar-thumb:hover,
.preview pre::-webkit-scrollbar-thumb:hover,
.preview div:has(> pre)::-webkit-scrollbar-thumb:hover,
.preview div:has(> blockquote)::-webkit-scrollbar-thumb:hover {
  background: #b0b8c5;
}

/* Light theme overrides for quoted content scrollbar */
:root[data-theme="light"] .preview blockquote,
:root[data-theme="light"] .preview div[style*="border-left"],
:root[data-theme="light"] .preview .gmail_quote,
:root[data-theme="light"] .preview [class*="quote"] {
  scrollbar-color: #9ca3af #dbe1ea; /* Firefox light theme */
}

:root[data-theme="light"] .preview blockquote::-webkit-scrollbar-track,
:root[data-theme="light"] .preview div[style*="border-left"]::-webkit-scrollbar-track,
:root[data-theme="light"] .preview .gmail_quote::-webkit-scrollbar-track,
:root[data-theme="light"] .preview [class*="quote"]::-webkit-scrollbar-track {
  background: #f4f7fb;
  border-left-color: #dbe1ea;
}

:root[data-theme="light"] .preview blockquote::-webkit-scrollbar-thumb,
:root[data-theme="light"] .preview div[style*="border-left"]::-webkit-scrollbar-thumb,
:root[data-theme="light"] .preview .gmail_quote::-webkit-scrollbar-thumb,
:root[data-theme="light"] .preview [class*="quote"]::-webkit-scrollbar-thumb {
  background: #9ca3af;
  border-color: #f4f7fb;
}

:root[data-theme="light"] .preview blockquote::-webkit-scrollbar-thumb:hover,
:root[data-theme="light"] .preview div[style*="border-left"]::-webkit-scrollbar-thumb:hover,
:root[data-theme="light"] .preview .gmail_quote::-webkit-scrollbar-thumb:hover,
:root[data-theme="light"] .preview [class*="quote"]::-webkit-scrollbar-thumb:hover {
  background: #6b7280;
}

@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) .preview blockquote,
  :root:not([data-theme="dark"]) .preview div[style*="border-left"],
  :root:not([data-theme="dark"]) .preview .gmail_quote,
  :root:not([data-theme="dark"]) .preview [class*="quote"] {
    scrollbar-color: #9ca3af #dbe1ea;
  }
  
  :root:not([data-theme="dark"]) .preview blockquote::-webkit-scrollbar-track,
  :root:not([data-theme="dark"]) .preview div[style*="border-left"]::-webkit-scrollbar-track,
  :root:not([data-theme="dark"]) .preview .gmail_quote::-webkit-scrollbar-track,
  :root:not([data-theme="dark"]) .preview [class*="quote"]::-webkit-scrollbar-track {
    background: #f4f7fb;
    border-left-color: #dbe1ea;
  }
  
  :root:not([data-theme="dark"]) .preview blockquote::-webkit-scrollbar-thumb,
  :root:not([data-theme="dark"]) .preview div[style*="border-left"]::-webkit-scrollbar-thumb,
  :root:not([data-theme="dark"]) .preview .gmail_quote::-webkit-scrollbar-thumb,
  :root:not([data-theme="dark"]) .preview [class*="quote"]::-webkit-scrollbar-thumb {
    background: #9ca3af;
    border-color: #f4f7fb;
  }
  
  :root:not([data-theme="dark"]) .preview blockquote::-webkit-scrollbar-thumb:hover,
  :root:not([data-theme="dark"]) .preview div[style*="border-left"]::-webkit-scrollbar-thumb:hover,
  :root:not([data-theme="dark"]) .preview .gmail_quote::-webkit-scrollbar-thumb:hover,
  :root:not([data-theme="dark"]) .preview [class*="quote"]::-webkit-scrollbar-thumb:hover {
    background: #6b7280;
  }
}

/* Attachments */
.attachments {
  padding: 8px 16px 14px;
  border-top: 1px solid var(--border);
  display: none;
  max-height: 35vh;
  overflow: auto;
}

.attachments.visible {
  display: block;
}

.attachments .atitle {
  color: var(--muted);
  font-size: 12px;
  margin: 0 0 8px 0;
}

.attlist {
  display: grid;
  gap: 6px;
}

.att {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border: 1px solid var(--border);
  background: #0e1220;
  border-radius: .5rem;
  padding: 8px 10px;
}

.att .meta {
  display: flex;
  gap: 10px;
  align-items: center;
  min-width: 0;
}

.att .name {
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 360px;
}

.att .type {
  color: var(--muted);
  font-size: 12px;
}

.att .size {
  color: var(--muted);
  font-size: 12px;
}

.att button {
  border: 0;
  background: var(--accent);
  color: #fff;
  border-radius: .45rem;
  padding: .35rem .6rem;
  cursor: pointer;
}

.headers-view,
.raw-message-view {
  padding: 16px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  max-height: 60vh;
  overflow: auto;
}

.headers-view h3,
.raw-message-view h3 {
  margin: 0 0 14px 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}

.headers-content,
.raw-message-content {
  margin: 0;
  padding: 16px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: .5rem;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'Courier New', 'Monaco', 'Consolas', monospace;
  font-size: 14px;
  line-height: 1.8;
  color: #e6e8ef; /* Light text for dark mode */
  overflow-x: auto;
  max-width: 100%;
}

/* Light mode: dark text */
:root[data-theme="light"] .headers-content,
:root[data-theme="light"] .raw-message-content,
[data-theme="light"] .headers-content,
[data-theme="light"] .raw-message-content {
  color: #111827; /* Dark text for light mode */
}

/* System light mode preference */
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) .headers-content,
  :root:not([data-theme="dark"]) .raw-message-content {
    color: #111827; /* Dark text for light mode */
  }
}

.btn-ghost.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
</style>
