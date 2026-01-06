import { ref, reactive, computed, onMounted } from "vue";
import { useInfiniteQuery, useQueryClient } from "@tanstack/vue-query";
import { JMAPClient } from "../services/jmap.js";

export function useEmailStore() {
  // Connection state
  const connected = ref(false);
  const status = ref("Not connected.");
  const error = ref("");
  const client = ref(null);

  // Data
  const mailboxes = ref([]);
  const identities = ref([]);
  const contacts = ref([]);
  const currentMailboxId = ref(null);
  const selectedEmailId = ref(null);

  // Compose state
  const composeOpen = ref(false);
  const sending = ref(false);
  const composeStatus = ref("");
  const composeDebug = ref("");
  const drafts = ref([]);
  const loadingDrafts = ref(false);
  const currentDraftId = ref(null);

  // Contact editor state
  const contactEditorOpen = ref(false);
  const editingContact = ref(null);
  const savingContact = ref(false);
  const contactStatus = ref("");
  
  // Address books state
  const addressBooks = ref([]);
  const selectedAddressBookId = ref(null);

  const compose = reactive({
    fromIdx: 0,
    to: "",
    subject: "",
    html: "",
    text: "",
  });

  const signatureText = ref(localStorage.getItem("jmap.signature") || "");
  const signatureEnabled = ref(
    localStorage.getItem("jmap.signatureEnabled") !== "false"
  );

  // View state
  const viewMode = ref("all");
  const filterText = ref("");
  const currentView = ref("mail"); // "mail" or "contacts"
  const selectedContactId = ref(null);

  // Config
  const PAGE_SIZE = 100;
  const INITIAL_LOAD_COUNT = 50;
  const INITIAL_PREFETCH_TARGET = 500;
  const DEBUG_LOAD = false;

  // Email content
  const bodyHtml = ref("");
  const bodyText = ref("");
  const cidUrls = reactive({});
  const emailHeaders = ref(null);
  const rawMessage = ref(null);
  const showHeaders = ref(false);
  const showRawMessage = ref(false);

  // Computed properties
  const currentBox = computed(
    () => mailboxes.value.find((m) => m.id === currentMailboxId.value) || null
  );

  const visibleMessages = computed(() => {
    let arr = emailsFromQuery.value || [];

    if (viewMode.value === "unread") arr = arr.filter((m) => !m.isSeen);

    if (filterText.value) {
      const ft = filterText.value.toLowerCase();
      arr = arr.filter(
        (m) =>
          (m.fromText || "").toLowerCase().includes(ft) ||
          (m.subject || "").toLowerCase().includes(ft)
      );
    }

    return arr;
  });

  // Group emails by threadId
  const groupedThreads = computed(() => {
    const emails = visibleMessages.value || [];
    const threadMap = new Map();

    emails.forEach((email) => {
      const threadId = email.threadId || email.id; // Fallback to email.id if no threadId
      
      if (!threadMap.has(threadId)) {
        threadMap.set(threadId, {
          threadId,
          emails: [],
        });
      }
      
      threadMap.get(threadId).emails.push(email);
    });

    // Convert to array and process each thread
    return Array.from(threadMap.values()).map((thread) => {
      // Sort emails by receivedAt (most recent first)
      thread.emails.sort((a, b) => {
        const aDate = new Date(a.receivedAt || a.sentAt || 0);
        const bDate = new Date(b.receivedAt || b.sentAt || 0);
        return bDate - aDate;
      });

      const latestEmail = thread.emails[0];
      
      // Get unique participant names
      const participants = new Set();
      thread.emails.forEach((e) => {
        const from = e.from?.[0];
        if (from) {
          const name = from.name || from.email || 'Unknown';
          participants.add(name);
        }
      });

      return {
        threadId: thread.threadId,
        emails: thread.emails,
        latestEmail,
        participantNames: Array.from(participants),
        hasUnread: thread.emails.some((e) => !e.isSeen),
        hasStarred: thread.emails.some((e) => e.keywords?.$flagged),
        hasAttachment: thread.emails.some((e) => e.hasAttachment),
        emailCount: thread.emails.length,
      };
    }).sort((a, b) => {
      // Sort threads by latest email date (most recent first)
      const aDate = new Date(a.latestEmail.receivedAt || a.latestEmail.sentAt || 0);
      const bDate = new Date(b.latestEmail.receivedAt || b.latestEmail.sentAt || 0);
      return bDate - aDate;
    });
  });

  // Utility functions
  const fmtDate = (iso) => {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso || "";
    }
  };

  const sortPropForBox = (box) => {
    const b = box || currentBox.value;
    if (!b) return "receivedAt";
    const role = (b.role || "").toLowerCase();
    const name = (b.name || "").toLowerCase();
    return role === "sent" || name === "sent" || name === "sent items"
      ? "sentAt"
      : "receivedAt";
  };

  const joinAddrs = (list) => {
    return (list || [])
      .map((a) => {
        const n = (a.name || "").trim();
        const e = (a.email || "").trim();
        return e ? (n ? `${n} <${e}>` : e) : "";
      })
      .filter(Boolean)
      .join(", ");
  };

  // Connect to JMAP server
  const connect = async (credentials) => {
    if (!credentials || !credentials.username || !credentials.password) {
      error.value = "Username and password required.";
      return;
    }

    error.value = "";
    status.value = "Connecting…";

    try {
      client.value = new JMAPClient({
        baseUrl: "https://hivepost.nl",
        username: credentials.username.trim(),
        password: credentials.password,
      });
      
      status.value = "Fetching session…";
      await client.value.fetchSession();

      status.value = "Loading mailboxes…";
      mailboxes.value = await client.value.listMailboxes();
      
      status.value = "Loading identities…";
      identities.value = await client.value.listIdentities();
      
      // Load address books
      await refreshAddressBooks();
      
      // Load contacts
      await refreshContacts();
      
      // Load drafts
      await refreshDrafts();

      // Ensure we have a valid inbox ID
      if (!client.value.ids.inbox && mailboxes.value.length === 0) {
        throw new Error("No mailboxes found. Cannot connect to inbox.");
      }
      
      currentMailboxId.value = client.value.ids.inbox || mailboxes.value[0]?.id;
      
      if (!currentMailboxId.value) {
        throw new Error("Failed to determine inbox mailbox ID.");
      }
      
      status.value = "Connected.";
      connected.value = true;
      document.body.classList.add("connected");

      // Save username only for auto-connect (password not stored for security)
      localStorage.setItem("jmap.username", credentials.username.trim());

      // Start automatic delta updates
      startDeltaUpdates();

      // Prime Vue Query pages for the initial mailbox
      if (DEBUG_LOAD)
        console.debug(
          "[vue-query] Priming initial mailbox",
          currentMailboxId.value
        );

      try {
        await mailboxInfinite.refetch();
        if (DEBUG_LOAD) console.debug("[vue-query] Refetch completed");
      } catch (e) {
        if (DEBUG_LOAD) console.debug("[vue-query] Refetch error", e);
      }

      // Load initial pages
      for (let i = 0; i < 3; i++) {
        try {
          await mailboxInfinite.fetchNextPage();
          if (DEBUG_LOAD)
            console.debug("[vue-query] fetchNextPage completed", i + 1);
        } catch (e) {
          if (DEBUG_LOAD) console.debug("[vue-query] fetchNextPage error", e);
          break;
        }
      }
    } catch (e) {
      status.value = "Failed.";
      let errorMsg = e.message;
      
      if (e.message?.includes("Failed to fetch")) {
        errorMsg += "\nLikely CORS/network issue.";
      } else if (e.message?.includes("accountId is required") || e.message?.includes("Cannot query mailboxes")) {
        errorMsg += "\n\nThis may mean:\n" +
          "1. No mail account exists for this user yet\n" +
          "2. The account needs to be created via Stalwart's web admin interface\n" +
          "3. The accountId format is different than expected\n\n" +
          "Please check your Stalwart server configuration and ensure a mail account is set up for this user.";
      } else if (e.message?.includes("trailing characters")) {
        errorMsg += "\n\nThis JSON parsing error may indicate:\n" +
          "1. The accountId format is incorrect\n" +
          "2. A mail account needs to be created first\n" +
          "3. Check Stalwart server logs for more details";
      }
      
      error.value = errorMsg;
    }
  };

  const normalizeEmails = (emails) =>
    emails.map((m) => ({
      ...m,
      fromText: joinAddrs(m.from),
      isSeen: !!m.keywords?.["$seen"],
      hasAttachment: !!m.hasAttachment,
      size: m.size,
      preview: (m.preview || "").trim(),
    }));

  // Vue Query: infinite list per mailbox
  const queryClient = useQueryClient();
  const emailListKey = (boxId, sortProp) => ["emails", boxId, sortProp];

  const mailboxInfinite = useInfiniteQuery({
    queryKey: computed(() =>
      emailListKey(currentMailboxId.value, sortPropForBox(currentBox.value))
    ),
    queryFn: async ({ pageParam = 0 }) => {
      const boxId = currentMailboxId.value;
      if (!boxId || !client.value) {
        return { qr: { ids: [], total: 0 }, list: [] };
      }
      const sortProp = sortPropForBox(currentBox.value);
      const qr = await client.value.emailQuery({
        mailboxId: boxId,
        position: pageParam,
        limit: PAGE_SIZE,
        sortProp,
      });
      const ids = qr.ids || [];
      let emails = [];
      if (ids.length) {
        const props = [
          "id",
          "threadId",
          "mailboxIds",
          "subject",
          "from",
          "to",
          "cc",
          "bcc",
          "replyTo",
          "sender",
          "receivedAt",
          "sentAt",
          "preview",
          "keywords",
          "hasAttachment",
          "size",
        ];
        emails = await client.value.emailGet(ids, props);
      }
      const list = normalizeEmails(emails);
      return { qr, list };
    },
    initialPageParam: 0,
    getNextPageParam: (last) => {
      const qr = last?.qr || {};
      const ids = qr.ids || [];
      const pos =
        typeof qr.position === "number" ? qr.position + ids.length : ids.length;
      const more =
        typeof qr.total === "number"
          ? pos < qr.total
          : ids.length === PAGE_SIZE;
      return more ? pos : undefined;
    },
    staleTime: 30_000, // Consider data stale after 30 seconds
    gcTime: 5 * 60_000, // Keep in cache for 5 minutes
    refetchInterval: false, // We'll use custom delta updates instead
    refetchOnWindowFocus: false, // We'll handle this with delta updates
    refetchOnMount: true, // Refetch when component mounts
    refetchOnReconnect: true, // Refetch when network reconnects
    enabled: computed(() => connected.value && !!currentMailboxId.value),
  });

  const emailsFromQuery = computed(
    () => mailboxInfinite.data?.value?.pages?.flatMap((p) => p.list || []) || []
  );

  const totalEmailsCount = computed(() => {
    const firstPage = mailboxInfinite.data?.value?.pages?.[0];
    return (
      firstPage?.qr?.total ??
      mailboxes.value.find((m) => m.id === currentMailboxId.value)
        ?.totalEmails ??
      emailsFromQuery.value.length
    );
  });

  // Switch mailbox
  const switchMailbox = async (id) => {
    if (DEBUG_LOAD) console.debug("[vue-query] Switching mailbox to", id);

    currentMailboxId.value = id;
    selectedEmailId.value = null;

    // Cancel ongoing requests
    try {
      client.value?.cancelAll?.();
    } catch {}

    await new Promise((r) => setTimeout(r, 50)); // Let Vue Query react

    // Vue Query: Check if we have cached data for this folder
    const queryKey = emailListKey(id, sortPropForBox(currentBox.value));
    const cachedData = queryClient.getQueryData(queryKey);

    if (cachedData) {
      // We have cached data - invalidate to mark as stale and trigger background refetch
      if (DEBUG_LOAD)
        console.debug(
          "[vue-query] Have cached data for",
          queryKey,
          "- invalidating to check for updates"
        );
      await queryClient.invalidateQueries({ queryKey, refetchType: "active" });
    } else if (DEBUG_LOAD) {
      console.debug(
        "[vue-query] No cached data for",
        queryKey,
        "- fetching fresh"
      );
    }

    // Prime first page and load a few more
    try {
      await mailboxInfinite.refetch();
      if (DEBUG_LOAD)
        console.debug("[vue-query] Refetch completed for mailbox", id);
    } catch (e) {
      if (DEBUG_LOAD) console.debug("[vue-query] Refetch error", e);
    }

    // Load initial pages
    for (let i = 0; i < 3; i++) {
      try {
        await mailboxInfinite.fetchNextPage();
        if (DEBUG_LOAD)
          console.debug("[vue-query] fetchNextPage completed", i + 1);
      } catch (e) {
        if (DEBUG_LOAD) console.debug("[vue-query] fetchNextPage error", e);
        break;
      }
    }
  };

  // Handle virtual scroll range changes
  const onVirtRange = async (endIndex) => {
    const pages = mailboxInfinite.data?.value?.pages || [];
    const loaded = pages.reduce((sum, p) => sum + (p.list?.length || 0), 0);

    // Prefetch ahead when approaching the end of loaded data
    if (
      endIndex > loaded - Math.floor(PAGE_SIZE / 2) &&
      mailboxInfinite.hasNextPage?.value
    ) {
      try {
        await mailboxInfinite.fetchNextPage();
      } catch (e) {
        console.debug("[vue-query] Error fetching next page:", e);
      }
    }
  };

  // Message detail
  const detail = reactive({
    subject: "(select a message)",
    from: "",
    to: "",
    cc: "",
    date: "",
    flags: "",
    size: "",
    id: "",
    preview: "",
  });
  const attachments = reactive([]);

  const selectMessage = async (id) => {
    selectedEmailId.value = id;
    // Look for message in Vue Query data first
    const emails = emailsFromQuery.value || [];
    let m = emails.find((x) => x.id === id);

    if (!m) return clearDetail();

    detail.subject = m.subject || "(no subject)";
    detail.from = m.fromText || "";
    detail.to = joinAddrs(m.to) || "";
    detail.cc = joinAddrs(m.cc) || "";
    const dp =
      sortPropForBox(currentBox.value) === "sentAt" ? "sentAt" : "receivedAt";
    detail.date = fmtDate(m[dp]);
    const flags =
      Object.keys(m.keywords || {})
        .filter((k) => m.keywords[k])
        .join(", ") || (m.isSeen ? "$seen" : "");
    detail.flags = flags;
    detail.size = m.size != null ? `${m.size} bytes` : "";
    detail.id = m.id || "";
    detail.preview = (m.preview || "").trim();

    // reset previous body/cid URLs
    Object.keys(cidUrls).forEach((k) => {
      URL.revokeObjectURL(cidUrls[k]);
      delete cidUrls[k];
    });
    bodyHtml.value = "";
    bodyText.value = "";
    emailHeaders.value = null;
    rawMessage.value = null;
    showHeaders.value = false;
    showRawMessage.value = false;

    try {
      const info = await client.value.emailDetail(m.id);
      attachments.splice(0, attachments.length, ...info.attachments);
      bodyText.value = info.text || "";
      bodyHtml.value = info.html
        ? await resolveCidImages(info.html, info.cidMap || {})
        : "";
      if (!bodyHtml.value && !bodyText.value) bodyText.value = m.preview || "";
      
      // Store headers if available
      if (info.headers) {
        emailHeaders.value = info.headers;
      }
    } catch (e) {
      console.debug("Failed to load email detail:", e);
      attachments.splice(0);
      bodyHtml.value = "";
      bodyText.value = m.preview || "";
      emailHeaders.value = null;
    }

    if (!m.isSeen) {
      // Update the mailbox unread count
      const mb = mailboxes.value.find((x) => x.id === currentMailboxId.value);
      if (mb && typeof mb.unreadEmails === "number" && mb.unreadEmails > 0)
        mb.unreadEmails--;

      // Optimistically update the Vue Query cache
      const queryKey = [
        "emails",
        currentMailboxId.value,
        sortPropForBox(currentBox.value),
      ];
      queryClient.setQueryData(queryKey, (oldData) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          pages: oldData.pages.map((page) => ({
            ...page,
            list: page.list?.map((email) =>
              email.id === m.id
                ? {
                    ...email,
                    isSeen: true,
                    keywords: { ...email.keywords, $seen: true },
                  }
                : email
            ),
          })),
        };
      });

      // Mark as read on the server
      try {
        await client.value.setSeen(m.id, true);
      } catch (e) {
        // On error, revert the optimistic update
        await queryClient.invalidateQueries({ queryKey });
      }
    }
  };

  const clearDetail = () => {
    detail.subject = "(select a message)";
    detail.from =
      detail.to =
      detail.cc =
      detail.date =
      detail.flags =
      detail.size =
      detail.id =
      detail.preview =
        "";
    attachments.splice(0);
    Object.keys(cidUrls).forEach((k) => {
      URL.revokeObjectURL(cidUrls[k]);
      delete cidUrls[k];
    });
    bodyHtml.value = bodyText.value = "";
  };

  // Manual refresh function to check for updates
  const refreshCurrentMailbox = async () => {
    if (!currentMailboxId.value) return;

    const queryKey = emailListKey(
      currentMailboxId.value,
      sortPropForBox(currentBox.value)
    );

    // Try to do an efficient delta update first
    const success = await checkForDeltaUpdates();

    if (!success) {
      // Fall back to full refresh if delta update failed
      await queryClient.invalidateQueries({
        queryKey,
        refetchType: "active",
      });

      // Also refetch the infinite query
      await mailboxInfinite.refetch();
    }
  };

  // Efficient delta update using JMAP queryChanges
  const checkForDeltaUpdates = async () => {
    if (!currentMailboxId.value || !client.value) return false;

    const queryKey = emailListKey(
      currentMailboxId.value,
      sortPropForBox(currentBox.value)
    );

    const currentData = queryClient.getQueryData(queryKey);
    if (!currentData?.pages?.length) return false;

    // Get the queryState from the first page
    const queryState = currentData.pages[0]?.qr?.queryState;
    if (!queryState) return false;

    try {
      // Fetch only changes since our last sync
      const changes = await client.value.emailQueryChanges({
        mailboxId: currentMailboxId.value,
        sinceQueryState: queryState,
        sortProp: sortPropForBox(currentBox.value),
      });

      if (changes.error || !changes.newQueryState) {
        // State is too old, need full refresh
        return false;
      }

      // Apply the changes to our cached data
      await applyDeltaChanges(queryKey, changes);
      return true;
    } catch (e) {
      console.debug("[delta] Failed to get changes:", e);
      return false;
    }
  };

  // Apply delta changes to the cached query data
  const applyDeltaChanges = async (queryKey, changes) => {
    const { added = [], removed = [], newQueryState, total } = changes;

    if (DEBUG_LOAD) {
      console.debug("[delta] Applying changes:", {
        added: added.length,
        removed: removed.length,
        newState: newQueryState,
        total,
      });
    }

    // Fetch details for added emails if any
    let newEmails = [];
    if (added.length > 0) {
      const addedIds = added.map((a) => a.id);
      const props = [
        "id",
        "threadId",
        "mailboxIds",
        "subject",
        "from",
        "to",
        "cc",
        "bcc",
        "replyTo",
        "sender",
        "receivedAt",
        "sentAt",
        "preview",
        "keywords",
        "hasAttachment",
        "size",
      ];
      const emails = await client.value.emailGet(addedIds, props);
      newEmails = normalizeEmails(emails);
    }

    // Update the cached data with the changes
    queryClient.setQueryData(queryKey, (oldData) => {
      if (!oldData) return oldData;

      return {
        ...oldData,
        pages: oldData.pages.map((page, pageIndex) => {
          if (pageIndex === 0) {
            // Update the first page with new queryState and total
            let updatedList = page.list || [];

            // Remove deleted emails
            if (removed.length > 0) {
              const removedSet = new Set(removed);
              updatedList = updatedList.filter(
                (email) => !removedSet.has(email.id)
              );
            }

            // Add new emails at their correct positions
            for (const addedItem of added) {
              const { id, index } = addedItem;
              const newEmail = newEmails.find((e) => e.id === id);
              if (newEmail && index != null) {
                // Insert at the specified index
                updatedList.splice(index, 0, newEmail);
              }
            }

            return {
              ...page,
              list: updatedList,
              qr: {
                ...page.qr,
                queryState: newQueryState,
                total: total != null ? total : page.qr?.total,
              },
            };
          }
          return page;
        }),
      };
    });
  };

  const backToList = () => {
    selectedEmailId.value = null;
    clearDetail();
  };

  const deleteCurrent = async () => {
    if (!selectedEmailId.value) return;

    // Look for message in Vue Query data first
    const emails = emailsFromQuery.value || [];
    let m = emails.find((x) => x.id === selectedEmailId.value);

    if (!m) return;
    try {
      const wasUnread = !m.isSeen;

      // Optimistically update the Vue Query cache
      const queryKey = [
        "emails",
        currentMailboxId.value,
        sortPropForBox(currentBox.value),
      ];
      queryClient.setQueryData(queryKey, (oldData) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          pages: oldData.pages.map((page) => ({
            ...page,
            list: page.list?.filter((email) => email.id !== m.id),
            qr: page.qr
              ? {
                  ...page.qr,
                  total: Math.max(0, (page.qr.total || 0) - 1),
                }
              : page.qr,
          })),
        };
      });

      // Update mailbox unread count if needed
      if (wasUnread) {
        const mb = mailboxes.value.find((x) => x.id === currentMailboxId.value);
        if (mb && mb.unreadEmails > 0) mb.unreadEmails--;
      }

      selectedEmailId.value = null;
      clearDetail();

      // Delete on the server
      await client.value.moveToTrashOrDestroy(m.id, currentMailboxId.value);
    } catch (e) {
      error.value = "Delete failed: " + e.message;
      // On error, revert the optimistic update
      await queryClient.invalidateQueries({
        queryKey: [
          "emails",
          currentMailboxId.value,
          sortPropForBox(currentBox.value),
        ],
      });
    }
  };

  const moveEmailToFolder = async (targetMailboxId) => {
    if (!selectedEmailId.value || !targetMailboxId) return;

    try {
      await client.value.moveEmail(
        selectedEmailId.value,
        targetMailboxId,
        currentMailboxId.value
      );

      // Optimistically update the Vue Query cache - remove from current mailbox
      const queryKey = [
        "emails",
        currentMailboxId.value,
        sortPropForBox(currentBox.value),
      ];
      queryClient.setQueryData(queryKey, (oldData) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          pages: oldData.pages.map((page) => ({
            ...page,
            list: page.list?.filter((email) => email.id !== selectedEmailId.value) || [],
          })),
        };
      });

      // Update mailbox counts
      const mb = mailboxes.value.find((x) => x.id === currentMailboxId.value);
      if (mb && typeof mb.totalEmails === "number" && mb.totalEmails > 0) {
        mb.totalEmails--;
      }

      // Clear selection and go back to list
      selectedEmailId.value = null;
      clearDetail();
      
      // Refresh current mailbox to update counts
      await refreshCurrentMailbox();
    } catch (e) {
      console.error('[EmailStore] Failed to move email:', e);
      error.value = "Failed to move email: " + e.message;
    }
  };

  // CID image resolution
  const resolveCidImages = async (html, cidMap) => {
    const re = /src=["']cid:([^"']+)["']/gi;
    let result = html;
    let match;
    while ((match = re.exec(html))) {
      const cid = match[1];
      const blobId = cidMap?.[cid];
      if (!blobId) continue;
      if (!cidUrls[cid]) {
        try {
          const url = client.value.makeDownloadUrl(blobId, cid + ".bin");
          const r = await fetch(url, {
            headers: { Authorization: client.value.AUTH },
            mode: "cors",
            credentials: "omit",
          });
          if (r.ok) {
            const blob = await r.blob();
            cidUrls[cid] = URL.createObjectURL(blob);
          }
        } catch {}
      }
      if (cidUrls[cid]) {
        result = result.replaceAll(`cid:${cid}`, cidUrls[cid]);
      }
    }
    return result;
  };

  const ensureReSubject = (s) => {
    const t = (s || "(no subject)").trim();
    return /^re:/i.test(t) ? t : `Re: ${t}`;
  };

  const replyToCurrent = async () => {
    if (!selectedEmailId.value) return;

    // Look for message in Vue Query data first
    const emails = emailsFromQuery.value || [];
    let m = emails.find((x) => x.id === selectedEmailId.value);

    if (!m) return;

    let quotedHtml = "";
    let quotedText = "";

    // Always fetch the full email body for proper quoting
    try {
      // Prefer already-loaded content (user has viewed the email)
      if (bodyHtml.value || bodyText.value) {
        quotedHtml = bodyHtml.value || "";
        quotedText = bodyText.value || "";
      } else {
        // Fetch the full email body for quoting
        const info = await client.value.emailDetail(m.id);
        quotedHtml = info.html || "";
        quotedText = info.text || "";
      }
      
      // Ensure we have content
      if (!quotedHtml && !quotedText) {
        quotedHtml = m.preview || "";
        quotedText = m.preview || "";
      }
    } catch (e) {
      // If fetching fails, try using already loaded content
      console.debug("Failed to fetch email body for reply:", e);
      quotedHtml = bodyHtml.value || bodyText.value || m.preview || "";
      quotedText = bodyText.value || m.preview || "";
    }

    const who = m.fromText || m.from?.[0]?.name || m.from?.[0]?.email || "the sender";
    const when = fmtDate(m.receivedAt || m.sentAt);
    
    // Convert HTML to plain text if we only have HTML
    let plainTextBody = quotedText;
    if (!plainTextBody && quotedHtml) {
      // Strip HTML tags to get plain text
      const tmp = document.createElement('div');
      tmp.innerHTML = quotedHtml;
      plainTextBody = tmp.textContent || tmp.innerText || '';
    }
    if (!plainTextBody) {
      plainTextBody = m.preview || '';
    }
    
    // Format reply text with > prefix (standard email quote format) - like React code
    // Split by newlines and add > prefix to each line
    const quotedLines = plainTextBody.split('\n');
    const quotedTextWithPrefix = quotedLines.map(line => `> ${line}`).join('\n');
    const replyText = `\n\nOn ${when}, ${who} wrote:\n${quotedTextWithPrefix}`;
    
    // For HTML, convert the plain text format to HTML with proper line breaks
    const quotedHtmlFormatted = quotedTextWithPrefix.replace(/\n/g, '<br>');
    const replyHtml = `<p><br></p><p><br></p><p>On ${when}, ${who} wrote:</p>${quotedHtmlFormatted}`;

    // Set compose fields BEFORE opening the panel
    compose.to = joinAddrs(
      m.replyTo && m.replyTo.length ? m.replyTo : m.from || []
    );
    compose.subject = ensureReSubject(m.subject);
    compose.html = replyHtml;
    compose.text = replyText;
    composeStatus.value = "";
    composeDebug.value = "";
    
    // Open compose panel after content is set
    toggleCompose(true);
  };

  const toggleCompose = async (forceOpen) => {
    composeOpen.value = forceOpen === true ? true : !composeOpen.value;
    composeStatus.value = "";
    composeDebug.value = "";
    // Clear compose content when opening fresh (not called from reply)
    if (composeOpen.value && forceOpen !== true) {
      compose.to = "";
      compose.subject = "";
      compose.html = "";
      compose.text = "";
      
      // Ensure contacts are loaded for autocomplete
      if (contacts.value.length === 0 && client.value) {
        try {
          await refreshContacts();
        } catch (e) {
          console.debug("Failed to refresh contacts on compose open:", e);
        }
      }
    }
  };

  const discard = () => {
    composeOpen.value = false;
    composeStatus.value = "";
    composeDebug.value = "";
    compose.to = "";
    compose.subject = "";
    compose.html = "";
    compose.text = "";
    currentDraftId.value = null;
  };

  const parseAddrList = (input) =>
    (input || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((p) => {
        const m = p.match(/^(.+?)\s*<(.+?)>$/);
        return m
          ? { name: m[1].trim().replace(/^"|"$/g, ""), email: m[2].trim() }
          : { email: p };
      });

  const sanitizeForDebug = (obj) => {
    const copy = JSON.parse(JSON.stringify(obj));
    try {
      const calls = copy.methodCalls || [];
      for (const c of calls) {
        if (c[0] === "Email/set" && c[1]?.create) {
          for (const k of Object.keys(c[1].create)) {
            if (c[1].create[k]?.bodyValues) {
              for (const pid of Object.keys(c[1].create[k].bodyValues)) {
                const v = c[1].create[k].bodyValues[pid].value || "";
                c[1].create[k].bodyValues[pid].value =
                  v.length > 500 ? v.slice(0, 500) + "…[truncated]" : v;
              }
            }
          }
        }
      }
    } catch {}
    return copy;
  };

  const extractMethodErrors = (json) => {
    if (!json) return "";
    const issues = [];
    try {
      for (const [name, payload] of json.methodResponses || []) {
        ["notCreated", "notUpdated", "notDestroyed", "notSubmitted"].forEach(
          (k) => {
            if (payload?.[k]) {
              Object.entries(payload[k]).forEach(([id, err]) => {
                issues.push(
                  `${name}/${k}/${id}: ${err.type || "error"} - ${
                    err.description || "unknown"
                  }`
                );
              });
            }
          }
        );
      }
    } catch {}
    return issues.join("\n");
  };

  const send = async () => {
    if (!identities.value.length) {
      composeStatus.value = "No identities.";
      return;
    }
    const id = identities.value[compose.fromIdx] || identities.value[0];
    const from = {
      email: (id.email || "").trim(),
      name: (id.name || "").trim() || undefined,
    };
    const toList = parseAddrList(compose.to);
    if (!from.email || !id.id) {
      composeStatus.value = "From/Identity missing.";
      return;
    }
    if (!toList.length) {
      composeStatus.value = "Add at least one recipient.";
      return;
    }

    try {
      sending.value = true;
      composeStatus.value = "Sending…";
      composeDebug.value = "";

      const signatureValue = signatureText.value.trim();
      let textBody = compose.text || "";
      let htmlBody = compose.html || "";

      if (signatureEnabled.value && signatureValue) {
        const signatureBlock = `\n\n-- \n${signatureValue}`;
        if (!textBody.includes(signatureValue)) {
          textBody = (textBody || "") + signatureBlock;
        }

        const escapeHtml = (str) =>
          str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
        const signatureHtml =
          "<p><br></p><p>--<br>" +
          escapeHtml(signatureValue).replace(/\n/g, "<br>") +
          "</p>";
        if (!htmlBody.includes(signatureValue)) {
          htmlBody = (htmlBody || "") + signatureHtml;
        }
      }

      const res = await client.value.sendMultipartAlternative({
        from,
        identityId: id.id,
        toList,
        subject: compose.subject || "",
        text: textBody || "",
        html: htmlBody || "",
        draftsId: client.value.ids.drafts,
        sentId: client.value.ids.sent,
      });

      const methodIssues = extractMethodErrors(res.json);
      composeDebug.value = `Started: ${res.started}\nStatus: ${res.status} ${
        res.statusText
      }\n\nRequest:\n${JSON.stringify(
        sanitizeForDebug(JSON.parse(res.req)),
        null,
        2
      )}\n\nResponse:\n${res.text}${
        methodIssues ? "\nMethod issues:\n" + methodIssues : ""
      }`;

      if (!res.ok) {
        composeStatus.value = `Send failed: ${res.status} ${res.statusText}`;
        return;
      }
      if (methodIssues) {
        const firstLine =
          String(methodIssues).split("\n").find(Boolean) ||
          "Unknown method error";
        composeStatus.value = "Send may have failed: " + firstLine;
        return;
      }
      
      // Extract the sent email ID from the response and mark it as read
      try {
        if (res.json?.methodResponses) {
          // Find Email/set response to get the created email ID
          const emailSetResponse = res.json.methodResponses.find(
            (r) => r[0] === "Email/set"
          );
          if (emailSetResponse && emailSetResponse[1]?.created) {
            const createdEmail = Object.values(emailSetResponse[1].created)[0];
            if (createdEmail?.id && client.value.ids.sent) {
              // Mark the sent email as read
              await client.value.setSeen(createdEmail.id, true);
              console.debug('[EmailStore] Marked sent email as read:', createdEmail.id);
            }
          }
        }
      } catch (e) {
        // Don't fail the send if marking as read fails
        console.warn('[EmailStore] Failed to mark sent email as read:', e.message);
      }
      
      composeStatus.value = "Sent.";
      discard();
      if (currentMailboxId.value === client.value.ids.sent)
        await refreshCurrentMailbox();
    } catch (e) {
      composeStatus.value = "Send failed: " + e.message;
    } finally {
      sending.value = false;
    }
  };

  const updateIdentity = async (identityId, updates) => {
    if (!client.value) throw new Error("Not connected");
    const result = await client.value.updateIdentity(identityId, updates);
    identities.value = await client.value.listIdentities();
    return result;
  };

  const download = (a) => {
    client.value
      .downloadAttachment(a.blobId, a.name, a.type)
      .catch((e) => (error.value = "Download failed: " + e.message));
  };

  const setViewMode = (mode) => {
    if (["all", "unread"].includes(mode)) viewMode.value = mode;
  };

  // Contact editor functions
  const openContactEditor = async (contact = null) => {
    console.debug('[EmailStore] Opening contact editor', contact ? 'for contact' : 'for new contact', contact);
    editingContact.value = contact;
    contactEditorOpen.value = true;
    contactStatus.value = "";
    
    // If opening for new contact and address books haven't loaded, try loading them
    if (!contact && addressBooks.value.length === 0) {
      await refreshAddressBooks();
    }
  };

  const closeContactEditor = () => {
    contactEditorOpen.value = false;
    editingContact.value = null;
    contactStatus.value = "";
  };

  const refreshAddressBooks = async () => {
    if (!client.value) return;
    try {
      addressBooks.value = await client.value.listAddressBooks();
      console.log('[EmailStore] Refreshed address books:', addressBooks.value.length, addressBooks.value);
      
      // Load selected address book from localStorage
      const savedAddressBookId = localStorage.getItem('thundermail_selected_address_book_id');
      if (savedAddressBookId && addressBooks.value.find(ab => ab.id === savedAddressBookId)) {
        selectedAddressBookId.value = savedAddressBookId;
      } else if (addressBooks.value.length > 0) {
        // Prefer Stalwart Address Book, then default, then first
        const stalwartBook = addressBooks.value.find(ab => 
          ab.name && ab.name.toLowerCase().includes('stalwart')
        );
        if (stalwartBook) {
          selectedAddressBookId.value = stalwartBook.id;
        } else {
          const defaultBook = addressBooks.value.find(ab => ab.isDefault === true);
          selectedAddressBookId.value = defaultBook?.id || addressBooks.value[0].id;
        }
        // Save selection
        localStorage.setItem('thundermail_selected_address_book_id', selectedAddressBookId.value);
      }
    } catch (e) {
      console.error('[EmailStore] Failed to refresh address books:', e);
      // Keep addressBooks as empty array so UI shows loading state
      addressBooks.value = [];
    }
  };

  const setSelectedAddressBook = (addressBookId) => {
    selectedAddressBookId.value = addressBookId;
    localStorage.setItem('thundermail_selected_address_book_id', addressBookId);
    console.debug('[EmailStore] Selected address book:', addressBookId);
  };

  const refreshContacts = async () => {
    if (!client.value) return;
    try {
      contacts.value = await client.value.listContacts();
      console.debug('[EmailStore] Refreshed contacts:', contacts.value.length);
    } catch (e) {
      console.warn('[EmailStore] Failed to refresh contacts:', e.message);
    }
  };

  const refreshDrafts = async () => {
    if (!client.value || !client.value.ids.drafts) return;
    try {
      loadingDrafts.value = true;
      drafts.value = await client.value.listDrafts({ limit: 50 });
      console.debug('[EmailStore] Refreshed drafts:', drafts.value.length);
    } catch (e) {
      console.error('[EmailStore] Failed to load drafts:', e);
      drafts.value = [];
    } finally {
      loadingDrafts.value = false;
    }
  };

  const loadDraft = async (draftId) => {
    if (!client.value) return;
    try {
      const draft = await client.value.loadDraft(draftId);
      
      // Find the identity index that matches the draft's from address
      const fromEmail = draft.from?.email;
      let fromIdx = 0;
      if (fromEmail) {
        const idx = identities.value.findIndex(id => id.email === fromEmail);
        if (idx >= 0) fromIdx = idx;
      }
      
      // Parse addresses
      const to = draft.to.map(addr => addr.name ? `${addr.name} <${addr.email}>` : addr.email).join(', ');
      const cc = draft.cc.map(addr => addr.name ? `${addr.name} <${addr.email}>` : addr.email).join(', ');
      const bcc = draft.bcc.map(addr => addr.name ? `${addr.name} <${addr.email}>` : addr.email).join(', ');
      
      // Set compose fields
      compose.fromIdx = fromIdx;
      compose.to = to;
      compose.subject = draft.subject || '';
      compose.html = draft.html || '';
      compose.text = draft.text || '';
      currentDraftId.value = draftId;
      
      // Open compose panel
      toggleCompose(true);
    } catch (e) {
      console.error('[EmailStore] Failed to load draft:', e);
      composeStatus.value = "Failed to load draft: " + e.message;
    }
  };

  const saveContact = async (contactData) => {
    if (!client.value) return;
    
    savingContact.value = true;
    contactStatus.value = "Saving...";
    
    try {
      if (editingContact.value) {
        // Update existing contact
        await client.value.updateContact(editingContact.value.id, contactData);
        contactStatus.value = "Contact updated.";
      } else {
        // Create new contact with selected address book
        await client.value.createContact(contactData, selectedAddressBookId.value);
        contactStatus.value = "Contact created.";
      }
      
      // Refresh contacts list
      await refreshContacts();
      
      // Close editor after a short delay
      setTimeout(() => {
        closeContactEditor();
      }, 1000);
    } catch (e) {
      contactStatus.value = "Failed: " + e.message;
      console.error('[EmailStore] Failed to save contact:', e);
    } finally {
      savingContact.value = false;
    }
  };

  const deleteContact = async (contactId) => {
    if (!client.value) return;
    
    savingContact.value = true;
    contactStatus.value = "Deleting...";
    
    try {
      await client.value.deleteContact(contactId);
      contactStatus.value = "Contact deleted.";
      
      // Refresh contacts list
      await refreshContacts();
      
      // Close editor after a short delay
      setTimeout(() => {
        closeContactEditor();
      }, 1000);
    } catch (e) {
      contactStatus.value = "Failed: " + e.message;
      console.error('[EmailStore] Failed to delete contact:', e);
    } finally {
      savingContact.value = false;
    }
  };

  // Set up automatic delta updates
  let deltaUpdateInterval = null;

  const startDeltaUpdates = () => {
    // Clear any existing interval
    if (deltaUpdateInterval) {
      clearInterval(deltaUpdateInterval);
    }

    // Check for updates every 30 seconds
    deltaUpdateInterval = setInterval(() => {
      if (connected.value && currentMailboxId.value) {
        checkForDeltaUpdates();
      }
    }, 30_000);
  };

  const stopDeltaUpdates = () => {
    if (deltaUpdateInterval) {
      clearInterval(deltaUpdateInterval);
      deltaUpdateInterval = null;
    }
  };

  const logout = () => {
    stopDeltaUpdates();
    try {
      client.value?.cancelAll?.();
    } catch {}

    connected.value = false;
    status.value = "Not connected.";
    error.value = "";
    client.value = null;

    mailboxes.value = [];
    identities.value = [];
    contacts.value = [];
    addressBooks.value = [];
    drafts.value = [];
    loadingDrafts.value = false;
    currentDraftId.value = null;

    currentMailboxId.value = null;
    selectedEmailId.value = null;
    selectedContactId.value = null;
    currentView.value = "mail";
    viewMode.value = "list";
    filterText.value = "";

    composeOpen.value = false;
    composeStatus.value = "";
    composeDebug.value = "";

    detail.value = null;
    attachments.value = [];
    bodyHtml.value = "";
    bodyText.value = "";
    emailHeaders.value = null;
    rawMessage.value = null;
    showHeaders.value = false;
    showRawMessage.value = false;

    document.body.classList.remove("connected");
    localStorage.removeItem("jmap.username");
  };

  // Handle window focus for delta updates
  const handleWindowFocus = () => {
    if (connected.value && currentMailboxId.value) {
      checkForDeltaUpdates();
    }
  };

  // Keyboard shortcuts and lifecycle
  onMounted(() => {
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && composeOpen.value)
        send();
      if (e.key === "Escape") {
        if (composeOpen.value) discard();
        else if (selectedEmailId.value) {
          selectedEmailId.value = null;
          clearDetail();
        }
      }
    });

    // Listen for window focus
    window.addEventListener("focus", handleWindowFocus);
  });

  return {
    // State
    client,
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
    currentDraftId,
    refreshDrafts,
    loadDraft,
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

    // Actions
    connect,
    switchMailbox,
    refreshCurrentMailbox,
    refreshContacts,
    refreshAddressBooks,
    setSelectedAddressBook,
    openContactEditor,
    closeContactEditor,
    saveContact,
    deleteContact,
    selectContact: (contact) => {
      selectedContactId.value = contact?.id || null;
      if (contact) {
        openContactEditor(contact);
      }
    },
    switchView: (view) => {
      if (view === "mail" || view === "contacts") {
        currentView.value = view;
        if (view === "mail") {
          selectedContactId.value = null;
        }
      }
    },
    setViewMode,
    selectMessage,
    backToList,
    replyToCurrent,
    deleteCurrent,
    moveEmailToFolder,
    toggleCompose,
    discard,
    send,
    updateIdentity,
    download,
    onVirtRange,
    logout,
    setSignatureText: (value) => {
      signatureText.value = value;
      localStorage.setItem("jmap.signature", value || "");
    },
    setSignatureEnabled: (value) => {
      signatureEnabled.value = !!value;
      localStorage.setItem("jmap.signatureEnabled", String(!!value));
    },
    
    // Headers and raw message
    emailHeaders,
    rawMessage,
    showHeaders,
    showRawMessage,
    async loadHeaders() {
      if (!selectedEmailId.value || !client.value) return;
      if (emailHeaders.value) {
        showHeaders.value = !showHeaders.value;
        return;
      }
      try {
        emailHeaders.value = await client.value.getEmailHeaders(selectedEmailId.value);
        showHeaders.value = true;
      } catch (e) {
        console.error('[EmailStore] Failed to load headers:', e);
        error.value = "Failed to load headers: " + e.message;
      }
    },
    async loadRawMessage() {
      if (!selectedEmailId.value || !client.value) return;
      if (rawMessage.value) {
        showRawMessage.value = !showRawMessage.value;
        return;
      }
      try {
        rawMessage.value = await client.value.getRawMessage(selectedEmailId.value);
        showRawMessage.value = true;
      } catch (e) {
        console.error('[EmailStore] Failed to load raw message:', e);
        error.value = "Failed to load raw message: " + e.message;
      }
    },
  };
}
