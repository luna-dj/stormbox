const CORE = "urn:ietf:params:jmap:core";
const MAIL = "urn:ietf:params:jmap:mail";
const SUBMIT = "urn:ietf:params:jmap:submission";
const CONTACTS = "urn:ietf:params:jmap:contacts"; // RFC 9610
const CALENDARS = "urn:ietf:params:jmap:calendars"; // RFC 8984

const te = new TextEncoder();
const b64 = (s) => btoa(String.fromCharCode(...te.encode(s)));

export class JMAPClient {
  constructor({ baseUrl, username, password }) {
    this.base = (baseUrl || "").replace(/\/$/, "");
    this.sessionUrl = this.base + "/.well-known/jmap";
    this.AUTH = "Basic " + b64(`${username}:${password}`);
    this._username = username; // Store username for potential use as accountId

    this.apiUrl = null;
    this.accountId = null;
    this.downloadUrlTpl = null;
    this._username = username; // Store for potential use as accountId
    this._possibleAccountIds = null;
    this._sessionData = null; // Store session data for calendar accountId lookup

    this.ids = {
      outbox: null,
      sent: null,
      drafts: null,
      trash: null,
      inbox: null,
    };

    // Track active fetch controllers for cancellation on mailbox switch
    this._controllers = new Set();
  }

  /* ---------- low-level ---------- */
  async fetchSession() {
    let r = await fetch(this.sessionUrl, {
      headers: { Accept: "application/json" },
      mode: "cors",
      credentials: "omit",
    });
    if (r.status === 401) {
      r = await fetch(this.sessionUrl, {
        headers: { Accept: "application/json", Authorization: this.AUTH },
        mode: "cors",
        credentials: "omit",
      });
    }
    if (!r.ok) {
      if (r.status === 401 || r.status === 403) {
        throw new Error(`Authentication failed: ${r.status} ${r.statusText}. Please check your username and password.`);
      }
      const errorText = await r.text().catch(() => "");
      throw new Error(`Session fetch failed: ${r.status} ${r.statusText}${errorText ? `\n${errorText}` : ""}`);
    }
    const s = await r.json();
    
    // Store session data for later use (e.g., calendar accountId lookup)
    this._sessionData = s;
    
    // Debug: log the session response structure (remove in production if needed)
    console.debug('[JMAP] Session response:', {
      keys: Object.keys(s),
      hasApiUrl: !!s.apiUrl,
      hasApiURL: !!s.apiURL,
      hasAccounts: !!s.accounts,
      hasPrimaryAccounts: !!s.primaryAccounts,
      primaryAccounts: s.primaryAccounts,
      accountKeys: s.accounts ? Object.keys(s.accounts) : null,
      accountsValue: s.accounts,
      fullResponse: s
    });
    
    // Handle different possible response structures
    // Some servers return apiUrl directly, others might need construction
    this.apiUrl = s.apiUrl || s.apiURL || null;
    
    // If apiUrl is relative, make it absolute
    if (this.apiUrl && !this.apiUrl.startsWith('http')) {
      this.apiUrl = new URL(this.apiUrl, this.base).href;
    }
    
    // If still no apiUrl, try constructing from base URL as fallback
    if (!this.apiUrl) {
      // Try common JMAP API endpoints
      const possibleEndpoints = [`${this.base}/jmap`, `${this.base}/api/jmap`, `${this.base}/.well-known/jmap`];
      // We'll use the first one as default, but this might need server-specific configuration
      this.apiUrl = possibleEndpoints[0];
      console.warn('[JMAP] No apiUrl in session response, using fallback:', this.apiUrl);
    }
    
    this.downloadUrlTpl = s.downloadUrl || s.downloadURL || null;
    
    // Try multiple ways to find accountId
    // First try primaryAccounts with MAIL capability
    if (s.primaryAccounts && s.primaryAccounts[MAIL]) {
      this.accountId = s.primaryAccounts[MAIL];
    }
    // Try any value in primaryAccounts
    else if (s.primaryAccounts && typeof s.primaryAccounts === 'object') {
      const primaryValues = Object.values(s.primaryAccounts);
      if (primaryValues.length > 0) {
        this.accountId = primaryValues[0];
      }
    }
    // Try accounts object keys
    else if (s.accounts && typeof s.accounts === 'object') {
      const accountKeys = Object.keys(s.accounts);
      if (accountKeys.length > 0) {
        this.accountId = accountKeys[0];
      }
    }
    
    // If still no accountId, try to get it from a different field or make a call
    if (!this.accountId) {
      // Some servers might have accountId in a different location
      // Check for common alternative field names
      if (s.accountId) {
        this.accountId = s.accountId;
      } else if (s.defaultAccountId) {
        this.accountId = s.defaultAccountId;
      } else if (s.username && s.accounts) {
        // Try username-based lookup
        const usernameKey = Object.keys(s.accounts).find(key => 
          s.accounts[key]?.name === s.username || 
          s.accounts[key]?.username === s.username
        );
        if (usernameKey) {
          this.accountId = usernameKey;
        }
      }
    }
    
    // Note: Stalwart and some other servers don't support Account/get
    // We'll try to discover accountId from mailbox queries instead
    
    // For Stalwart and similar servers, accountId might not be in session
    // Try using username as accountId (some servers use username as accountId)
    if (!this.accountId && this._username) {
      console.debug('[JMAP] Attempting to use username as accountId:', this._username);
      // Try username directly, or common variations (remove duplicates)
      const usernameLower = this._username.toLowerCase();
      const localPart = this._username.split('@')[0];
      const possibleAccountIds = [
        this._username,
        usernameLower !== this._username ? usernameLower : null,
        localPart !== this._username ? localPart : null,
      ].filter(Boolean); // Remove nulls and duplicates
      
      // Remove duplicates
      this._possibleAccountIds = [...new Set(possibleAccountIds)];
      console.warn('[JMAP] No accountId found in session. Will try username-based accountIds:', this._possibleAccountIds);
    }
    
    return s;
  }

  async jmap(body) {
    const ctrl = new AbortController();
    this._controllers.add(ctrl);
    const r = await fetch(this.apiUrl, {
      method: "POST",
      headers: {
        Authorization: this.AUTH,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      mode: "cors",
      credentials: "omit",
      signal: ctrl.signal,
    });
    this._controllers.delete(ctrl);
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`JMAP error ${r.status} ${r.statusText}\n${txt}`);
    }
    return r.json();
  }

  async jmapRaw(body) {
    const req = JSON.stringify(body);
    const started = new Date().toISOString();
    const ctrl = new AbortController();
    this._controllers.add(ctrl);
    const r = await fetch(this.apiUrl, {
      method: "POST",
      headers: {
        Authorization: this.AUTH,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: req,
      mode: "cors",
      credentials: "omit",
      signal: ctrl.signal,
    });
    this._controllers.delete(ctrl);
    const text = await r.text().catch(() => "");
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return {
      started,
      status: r.status,
      statusText: r.statusText,
      ok: r.ok,
      text,
      json,
      req,
    };
  }

  cancelAll() {
    for (const c of Array.from(this._controllers)) {
      try {
        c.abort();
      } catch {}
      this._controllers.delete(c);
    }
  }

  _getAccountIdForCapability(capability) {
    const primary = this._sessionData?.primaryAccounts?.[capability];
    if (primary) return primary;

    const accounts = this._sessionData?.accounts;
    if (accounts && typeof accounts === "object") {
      const match = Object.entries(accounts).find(([, data]) => {
        const caps = data?.accountCapabilities || data?.capabilities;
        return !!caps?.[capability];
      });
      if (match) return match[0];
    }

    return this.accountId || null;
  }

  _toLocalDateTime(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate()
    )}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
      date.getSeconds()
    )}`;
  }

  async _jmapCall(methodName, params, callId = "c1") {
    const response = await this.jmap({
      using: [CORE, MAIL],
      methodCalls: [
        [methodName, { accountId: this.accountId, ...params }, callId],
      ],
    });
    return (
      response.methodResponses?.find((x) => x[0] === methodName)?.[1] || null
    );
  }

  _extractResponse(response, methodName) {
    return (
      response.methodResponses?.find((x) => x[0] === methodName)?.[1] || null
    );
  }
  /* ---------- mailboxes & identities ---------- */
  async listMailboxes() {
    // If accountId is not set, try possible accountIds from username
    if (!this.accountId && this._possibleAccountIds) {
      console.debug('[JMAP] Trying possible accountIds:', this._possibleAccountIds);
      for (const possibleId of this._possibleAccountIds) {
        try {
          const testQuery = {
            accountId: possibleId,
            sort: [{ property: "name", isAscending: true }],
            limit: 1,
          };
          const testResponse = await this.jmap({
            using: [CORE, MAIL],
            methodCalls: [["Mailbox/query", testQuery, "test1"]],
          });
          const result = testResponse.methodResponses.find((x) => x[0] === "Mailbox/query");
          const errorResult = testResponse.methodResponses.find((x) => x[0] === "error");
          
          if (result && result[0] !== "error") {
            this.accountId = possibleId;
            console.debug('[JMAP] Successfully discovered accountId:', this.accountId);
            break;
          } else if (errorResult) {
            // Check if error message contains accountId hint
            const errorDesc = errorResult[1]?.description || '';
            console.debug('[JMAP] accountId', possibleId, 'returned error:', errorDesc);
            // Some servers return accountId in error messages
            const accountIdMatch = errorDesc.match(/account[_\s]?id[:\s]+([^\s,}]+)/i);
            if (accountIdMatch) {
              this.accountId = accountIdMatch[1];
              console.debug('[JMAP] Extracted accountId from error message:', this.accountId);
              break;
            }
          }
        } catch (e) {
          console.debug('[JMAP] accountId', possibleId, 'failed:', e.message);
          // Check error message for accountId hints
          const errorText = e.message || '';
          const accountIdMatch = errorText.match(/account[_\s]?id[:\s]+([^\s,}]+)/i);
          if (accountIdMatch) {
            this.accountId = accountIdMatch[1];
            console.debug('[JMAP] Extracted accountId from exception:', this.accountId);
            break;
          }
          continue;
        }
      }
    }
    
    // If still no accountId, try querying without accountId (some servers allow this)
    if (!this.accountId) {
      console.debug('[JMAP] Trying mailbox query without accountId...');
      try {
        const testResponse = await this.jmap({
          using: [CORE, MAIL],
          methodCalls: [["Mailbox/query", { sort: [{ property: "name", isAscending: true }], limit: 1 }, "test2"]],
        });
        const result = testResponse.methodResponses.find((x) => x[0] === "Mailbox/query");
        if (result && result[0] !== "error" && result[1]?.accountId) {
          this.accountId = result[1].accountId;
          console.debug('[JMAP] Got accountId from mailbox query response:', this.accountId);
        }
      } catch (e) {
        console.debug('[JMAP] Query without accountId failed:', e.message);
      }
    }
    
    // If still no accountId, we can't proceed
    if (!this.accountId) {
      throw new Error(
        "Cannot query mailboxes: accountId is required but not found. " +
        "Tried: " + (this._possibleAccountIds?.join(', ') || 'none') + ". " +
        "Please ensure your account is properly configured on the server. " +
        "For Stalwart, you may need to create a mail account first via the web admin interface."
      );
    }
    
    const q = {
      accountId: this.accountId,
      sort: [
        { property: "sortOrder", isAscending: true },
        { property: "name", isAscending: true },
      ],
      limit: 500,
    };
    const Rq = await this.jmap({
      using: [CORE, MAIL],
      methodCalls: [["Mailbox/query", q, "m1"]],
    });
    const queryResponse = Rq.methodResponses.find((x) => x[0] === "Mailbox/query");
    if (!queryResponse) {
      // Check for error response
      const errorResponse = Rq.methodResponses.find((x) => x[0] === "error");
      if (errorResponse) {
        throw new Error(
          errorResponse[1]?.description || errorResponse[1]?.type || "Failed to query mailboxes"
        );
      }
      throw new Error("Failed to query mailboxes: no response found");
    }
    const ids = queryResponse[1]?.ids || [];
    const props = [
      "id",
      "name",
      "role",
      "sortOrder",
      "totalEmails",
      "unreadEmails",
      "parentId",
    ];
    const Rg = ids.length
      ? await this.jmap({
          using: [CORE, MAIL],
          methodCalls: [
            [
              "Mailbox/get",
              { accountId: this.accountId, ids, properties: props },
              "m2",
            ],
          ],
        })
      : null;
    const getResponse = Rg
      ? Rg.methodResponses.find((x) => x[0] === "Mailbox/get")
      : null;
    if (Rg && !getResponse) {
      // Check for error response
      const errorResponse = Rg.methodResponses.find((x) => x[0] === "error");
      if (errorResponse) {
        throw new Error(
          errorResponse[1]?.description || errorResponse[1]?.type || "Failed to get mailbox details"
        );
      }
      throw new Error("Failed to get mailbox details: no response found");
    }
    const list = getResponse?.[1]?.list || [];

    // Map special folders
    const byRole = (role) =>
      list.find((m) => (m.role || "").toLowerCase() === role);
    const byName = (...names) =>
      list.find((m) => names.includes((m.name || "").toLowerCase()));

    this.ids.outbox = (byRole("outbox") || {}).id || null;
    this.ids.sent =
      (byRole("sent") || byName("sent", "sent items") || {}).id || null;
    this.ids.drafts = (byRole("drafts") || {}).id || null;
    this.ids.trash =
      (byRole("trash") || byName("deleted items", "trash") || {}).id || null;
    const inbox = byRole("inbox") || list[0];
    this.ids.inbox = inbox?.id || null;

    return list;
  }

  async listIdentities() {
    const R = await this.jmap({
      using: [CORE, MAIL, SUBMIT],
      methodCalls: [["Identity/get", { accountId: this.accountId }, "i1"]],
    });
    return (
      (R.methodResponses.find((x) => x[0] === "Identity/get") || [])[1]?.list ||
      []
    );
  }

  async updateIdentity(identityId, updates = {}) {
    if (!this.accountId) {
      throw new Error("accountId is required to update identity");
    }
    if (!identityId) {
      throw new Error("identityId is required to update identity");
    }

    const payload = {};
    if (updates.name !== undefined) payload.name = updates.name || "";
    if (updates.email !== undefined) payload.email = updates.email || "";
    if (updates.replyTo !== undefined) payload.replyTo = updates.replyTo || null;
    if (Object.keys(payload).length === 0) {
      throw new Error("No identity fields to update.");
    }

    const R = await this.jmap({
      using: [CORE, MAIL, SUBMIT],
      methodCalls: [
        ["Identity/set", { accountId: this.accountId, update: { [identityId]: payload } }, "is1"],
      ],
    });

    const setResponse = R.methodResponses.find((x) => x[0] === "Identity/set");
    if (!setResponse || setResponse[0] === "error") {
      const errorResponse = R.methodResponses.find((x) => x[0] === "error");
      throw new Error(errorResponse?.[1]?.description || "Failed to update identity");
    }

    const updatedMap = setResponse[1]?.updated;
    const updated =
      updatedMap && Object.prototype.hasOwnProperty.call(updatedMap, identityId)
        ? updatedMap[identityId]
        : null;
    if (!updatedMap || !Object.prototype.hasOwnProperty.call(updatedMap, identityId)) {
      const notUpdated = setResponse[1]?.notUpdated?.[identityId];
      if (notUpdated?.properties) {
        const propErrors = Object.entries(notUpdated.properties)
          .map(([prop, err]) => `${prop}: ${err}`)
          .join(", ");
        throw new Error(`Invalid property: ${propErrors}`);
      }
      const detail =
        notUpdated?.description ||
        notUpdated?.type ||
        setResponse[1]?.description ||
        setResponse[1]?.type;
      if (detail) {
        throw new Error(detail);
      }
      throw new Error(
        `Failed to update identity: ${JSON.stringify(setResponse[1] || {})}`
      );
    }

    return updated ?? true;
  }

  /* ---------- queries & changes ---------- */
  sortPropForBox(box) {
    const name = (box?.name || "").toLowerCase();
    const role = (box?.role || "").toLowerCase();
    return role === "sent" || name.startsWith("sent") ? "sentAt" : "receivedAt";
  }

  async emailQuery({
    mailboxId,
    position = 0,
    limit = 50,
    sortProp = "receivedAt",
  }) {
    const query = {
      accountId: this.accountId,
      filter: { inMailbox: mailboxId },
      sort: [{ property: sortProp, isAscending: false }],
      position,
      limit,
      calculateTotal: true,
    };
    const Rq = await this.jmap({
      using: [CORE, MAIL],
      methodCalls: [["Email/query", query, "q1"]],
    });
    return (
      Rq.methodResponses.find((x) => x[0] === "Email/query")?.[1] ?? {
        ids: [],
        total: 0,
        queryState: null,
        position: 0,
      }
    );
  }

  async emailGet(ids, properties) {
    if (!ids?.length) return [];
    const Rg = await this.jmap({
      using: [CORE, MAIL],
      methodCalls: [
        ["Email/get", { accountId: this.accountId, ids, properties }, "g1"],
      ],
    });
    return (
      Rg.methodResponses?.find((x) => x[0] === "Email/get")?.[1]?.list || []
    );
  }

  async getThreadEmails(threadId) {
    if (!threadId) return [];
    const query = {
      accountId: this.accountId,
      filter: { inThread: threadId },
      sort: [{ property: "receivedAt", isAscending: false }],
      limit: 100, // Reasonable limit for a thread
    };
    const Rq = await this.jmap({
      using: [CORE, MAIL],
      methodCalls: [["Email/query", query, "qt1"]],
    });
    const queryResponse = Rq.methodResponses.find((x) => x[0] === "Email/query")?.[1];
    if (!queryResponse || !queryResponse.ids?.length) return [];
    
    const props = [
      "id",
      "threadId",
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
      "bodyStructure",
      "textBody",
      "htmlBody",
    ];
    
    const emails = await this.emailGet(queryResponse.ids, props);
    
    // Fetch body values for all emails in the thread
    const emailsWithBodies = await Promise.all(
      emails.map(async (email) => {
        try {
          const detail = await this.emailDetail(email.id);
          return {
            ...email,
            bodyHtml: detail.html || "",
            bodyText: detail.text || "",
            attachments: detail.attachments || [],
          };
        } catch (e) {
          console.warn(`[JMAP] Failed to fetch body for email ${email.id}:`, e);
          return {
            ...email,
            bodyHtml: "",
            bodyText: "",
            attachments: [],
          };
        }
      })
    );
    
    return emailsWithBodies;
  }

  async emailQueryChanges({
    mailboxId,
    sinceQueryState,
    sortProp = "receivedAt",
  }) {
    const body = {
      using: [CORE, MAIL],
      methodCalls: [
        [
          "Email/queryChanges",
          {
            accountId: this.accountId,
            filter: { inMailbox: mailboxId },
            sort: [{ property: sortProp, isAscending: false }],
            sinceQueryState,
            maxChanges: 500,
          },
          "qc1",
        ],
      ],
    };
    const Jr = await this.jmap(body);
    return (
      Jr.methodResponses?.find((x) => x[0] === "Email/queryChanges")?.[1] || {}
    );
  }

  async setSeen(emailId, seen = true) {
    return this.jmap({
      using: [CORE, MAIL],
      methodCalls: [
        [
          "Email/set",
          {
            accountId: this.accountId,
            update: { [emailId]: { "keywords/$seen": !!seen } },
          },
          "u1",
        ],
      ],
    });
  }

  async moveToTrashOrDestroy(emailId, currentMailboxId) {
    const params = this.ids.trash
      ? {
          update: {
            [emailId]: {
              [`mailboxIds/${this.ids.trash}`]: true,
              [`mailboxIds/${currentMailboxId}`]: null,
            },
          },
        }
      : { destroy: [emailId] };

    return this.jmap({
      using: [CORE, MAIL],
      methodCalls: [
        ["Email/set", { ...params, accountId: this.accountId }, "d1"],
      ],
    });
  }

  async moveEmail(emailId, targetMailboxId, currentMailboxId) {
    if (!targetMailboxId || targetMailboxId === currentMailboxId) {
      throw new Error("Invalid target mailbox");
    }

    const update = {
      [emailId]: {
        [`mailboxIds/${targetMailboxId}`]: true,
      },
    };

    // Remove from current mailbox if specified
    if (currentMailboxId) {
      update[emailId][`mailboxIds/${currentMailboxId}`] = null;
    }

    return this.jmap({
      using: [CORE, MAIL],
      methodCalls: [
        ["Email/set", { 
          accountId: this.accountId,
          update 
        }, "m1"],
      ],
    });
  }

  /* ---------- downloads ---------- */
  makeDownloadUrl(blobId, name) {
    const nm = encodeURIComponent(name || "attachment");
    return (
      this.downloadUrlTpl || `${this.base}/download/{accountId}/{blobId}/{name}`
    )
      .replace("{accountId}", encodeURIComponent(this.accountId))
      .replace("{blobId}", encodeURIComponent(blobId))
      .replace("{name}", nm);
  }

  async downloadAttachment(blobId, name, type) {
    const url = this.makeDownloadUrl(blobId, name);
    const r = await fetch(url, {
      headers: { Authorization: this.AUTH, Accept: type || "*/*" },
      mode: "cors",
      credentials: "omit",
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const blob = await r.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = name || "attachment";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  }

  async downloadPartText(part) {
    // Download the raw part and decode using declared charset (fallback utf-8).
    const url = this.makeDownloadUrl(part.blobId, part.name || "body.txt");
    const r = await fetch(url, {
      headers: { Authorization: this.AUTH },
      mode: "cors",
      credentials: "omit",
    });
    if (!r.ok)
      throw new Error(`Blob download failed: ${r.status} ${r.statusText}`);
    const buf = await r.arrayBuffer();
    let dec;
    try {
      dec = new TextDecoder((part.charset || "utf-8").toLowerCase());
    } catch {
      dec = new TextDecoder("utf-8");
    }
    return dec.decode(buf);
  }

  /* ---------- drafts ---------- */
  async listDrafts({ limit = 50 } = {}) {
    if (!this.ids.drafts) {
      return [];
    }
    
    const queryResult = await this.emailQuery({
      mailboxId: this.ids.drafts,
      limit,
      sortProp: "sentAt",
    });
    
    if (!queryResult.ids?.length) {
      return [];
    }
    
    const emails = await this.emailGet(queryResult.ids, [
      "id",
      "subject",
      "from",
      "to",
      "cc",
      "bcc",
      "sentAt",
      "preview",
    ]);
    
    return emails.map((em) => ({
      id: em.id,
      subject: em.subject || "(No subject)",
      from: em.from?.[0] || {},
      to: em.to || [],
      cc: em.cc || [],
      bcc: em.bcc || [],
      sentAt: em.sentAt,
      preview: em.preview || "",
    }));
  }

  async loadDraft(draftId) {
    const info = await this.emailDetail(draftId);
    const emails = await this.emailGet([draftId], [
      "id",
      "subject",
      "from",
      "to",
      "cc",
      "bcc",
    ]);
    
    const em = emails[0] || {};
    
    return {
      id: draftId,
      subject: em.subject || "",
      from: em.from?.[0] || {},
      to: em.to || [],
      cc: em.cc || [],
      bcc: em.bcc || [],
      html: info.html || "",
      text: info.text || "",
    };
  }

  /* ---------- detail (full HTML/text with truncation fallback) ---------- */
  async emailDetail(emailId) {
    const R = await this.jmap({
      using: [CORE, MAIL],
      methodCalls: [
        [
          "Email/get",
          {
            accountId: this.accountId,
            ids: [emailId],
            properties: [
              "id",
              "bodyStructure",
              "textBody",
              "htmlBody",
              "headers",
            ],
            fetchTextBodyValues: true,
            fetchHTMLBodyValues: true,
            maxBodyValueBytes: 10_485_760, // 10 MB; still fall back to blob download if truncated
            bodyProperties: [
              "partId",
              "type",
              "size",
              "name",
              "blobId",
              "disposition",
              "cid",
              "charset",
              "subParts",
            ],
          },
          "gd",
        ],
      ],
    });
    const em =
      (R.methodResponses.find((x) => x[0] === "Email/get") || [])[1]
        ?.list?.[0] || {};
    const bv = em.bodyValues || {};

    const attachments = [],
      htmlParts = [],
      textParts = [],
      cidMap = {};
    const walk = (p) => {
      if (!p) return;
      const type = (p.type || "").toLowerCase();

      // Collect attachments
      if (
        p.disposition?.toLowerCase() === "attachment" ||
        (p.name && p.blobId)
      ) {
        attachments.push({
          blobId: p.blobId,
          name: p.name || "attachment",
          type: p.type || "application/octet-stream",
          size: p.size,
        });
      }

      // Collect parts by type
      if (type === "text/html") htmlParts.push(p);
      if (type === "text/plain") textParts.push(p);
      if (p.cid && p.blobId) cidMap[p.cid.replace(/^<|>$/g, "")] = p.blobId;

      // Recurse into subparts
      (p.subParts || []).forEach(walk);
    };
    walk(em.bodyStructure);

    const pickLargest = (arr) =>
      [...arr].sort((a, b) => (b.size || 0) - (a.size || 0))[0];
    const hp = pickLargest(htmlParts);
    const tp = pickLargest(textParts);

    let html = (hp && bv[hp.partId]?.value) || "";
    let text = (tp && bv[tp.partId]?.value) || "";

    const isTrunc = (p) =>
      p &&
      bv[p.partId] &&
      (bv[p.partId].isTruncated || bv[p.partId].valueIsTruncated);

    // If missing or truncated, fetch full content via blobId
    try {
      if (hp && (!html || isTrunc(hp))) html = await this.downloadPartText(hp);
    } catch {}
    try {
      if (tp && (!text || isTrunc(tp))) text = await this.downloadPartText(tp);
    } catch {}

    return { html, text, attachments, cidMap, headers: em.headers };
  }

  // Get email headers
  async getEmailHeaders(emailId) {
    const R = await this.jmap({
      using: [CORE, MAIL],
      methodCalls: [
        [
          "Email/get",
          {
            accountId: this.accountId,
            ids: [emailId],
            properties: ["id", "headers"],
          },
          "gh",
        ],
      ],
    });
    const em =
      (R.methodResponses.find((x) => x[0] === "Email/get") || [])[1]
        ?.list?.[0] || {};
    return em.headers || {};
  }

  // Get raw message (download full message as text)
  async getRawMessage(emailId) {
    if (!this.downloadUrlTpl) {
      throw new Error("Download URL template not available");
    }
    
    // First get the blobId for the message
    // Note: JMAP emails don't have a direct blobId, but we can try to get it
    // or use the email's bodyStructure to find the root part's blobId
    const R = await this.jmap({
      using: [CORE, MAIL],
      methodCalls: [
        [
          "Email/get",
          {
            accountId: this.accountId,
            ids: [emailId],
            properties: ["id", "blobId", "bodyStructure"],
          },
          "gr",
        ],
      ],
    });
    
    const em =
      (R.methodResponses.find((x) => x[0] === "Email/get") || [])[1]
        ?.list?.[0] || {};
    
    // Try to find blobId from email or bodyStructure
    let blobId = em.blobId;
    if (!blobId && em.bodyStructure) {
      // Try to find blobId in bodyStructure (root part)
      const findBlobId = (part) => {
        if (part.blobId) return part.blobId;
        if (part.subParts) {
          for (const subPart of part.subParts) {
            const found = findBlobId(subPart);
            if (found) return found;
          }
        }
        return null;
      };
      blobId = findBlobId(em.bodyStructure);
    }
    
    if (!blobId) {
      throw new Error("No blobId found for email. Raw message download may not be supported.");
    }
    
    // Download the raw message using the blobId
    const downloadUrl = this.makeDownloadUrl(blobId, "message.eml");
    
    const response = await fetch(downloadUrl, {
      headers: { Authorization: this.AUTH },
    });
    
    if (!response.ok) {
      throw new Error(`Failed to download raw message: ${response.status} ${response.statusText}`);
    }
    
    return await response.text();
  }

  /* ---------- compose (multipart/alternative, Outbox-first) ---------- */
  async sendMultipartAlternative({
    from,
    identityId,
    toList,
    subject,
    text,
    html,
    draftsId,
    sentId,
  }) {
    const createId = "m1",
      submitId = "s1";
    const hasHtml = html && !/^\s*<p>\s*(<br\s*\/?>)?\s*<\/p>\s*$/i.test(html);
    const targetBox = this.ids.outbox || draftsId || this.ids.drafts || null;

    // Build body structure and values based on content type
    const [bodyStructure, bodyValues] = hasHtml
      ? [
          {
            type: "multipart/alternative",
            subParts: [
              { type: "text/plain", partId: "p1" },
              { type: "text/html", partId: "h1" },
            ],
          },
          { p1: { value: text || "" }, h1: { value: html } },
        ]
      : [{ type: "text/plain", partId: "p1" }, { p1: { value: text || "" } }];

    // Build email create object
    const emailCreate = {
      ...(targetBox && { mailboxIds: { [targetBox]: true } }),
      ...(targetBox === this.ids.drafts && { keywords: { $draft: true } }),
      from: [{ ...(from.name && { name: from.name }), email: from.email }],
      to: toList,
      subject,
      bodyStructure,
      bodyValues,
    };

    // Build submission update object
    const onSuccessUpdate = {
      ...(sentId && { [`mailboxIds/${sentId}`]: true }),
      ...(targetBox && { [`mailboxIds/${targetBox}`]: null }),
      "keywords/$draft": null,
    };

    return this.jmapRaw({
      using: [CORE, MAIL, SUBMIT],
      methodCalls: [
        [
          "Email/set",
          { accountId: this.accountId, create: { [createId]: emailCreate } },
          "c1",
        ],
        [
          "EmailSubmission/set",
          {
            accountId: this.accountId,
            create: {
              [submitId]: {
                identityId,
                emailId: `#${createId}`,
                envelope: {
                  mailFrom: { email: from.email },
                  rcptTo: toList.map((x) => ({ email: x.email })),
                },
              },
            },
            onSuccessUpdateEmail: { [`#${submitId}`]: onSuccessUpdate },
          },
          "c2",
        ],
      ],
    });
  }

  /* ---------- contacts ---------- */
  async listAddressBooks() {
    if (!this.accountId) {
      throw new Error("accountId is required to list address books");
    }

    // Try AddressBook/get with ids: null first (simpler, works on Stalwart)
    try {
      const Rg = await this.jmap({
        using: [CORE, CONTACTS],
        methodCalls: [
          ["AddressBook/get", { 
            accountId: this.accountId, 
            ids: null, // Get all address books
            properties: ["id", "name", "isDefault", "description"] 
          }, "abg1"],
        ],
      });
      
      const getResponse = Rg.methodResponses.find((x) => x[0] === "AddressBook/get");
      if (!getResponse || getResponse[0] === "error") {
        const errorResponse = Rg.methodResponses.find((x) => x[0] === "error");
        if (errorResponse) {
          console.warn('[JMAP] AddressBook/get with null ids failed, trying query method:', errorResponse[1]);
          // Fall through to query method
        } else {
          console.warn('[JMAP] AddressBook/get: no response found');
          // Fall through to query method
        }
      } else {
        const books = getResponse[1]?.list || [];
        if (books.length > 0) {
          console.log('[JMAP] listAddressBooks found:', books.length, 'address books via get');
          return books;
        }
      }
    } catch (e) {
      console.warn('[JMAP] AddressBook/get failed, trying query method:', e.message);
    }

    // Fallback: Try AddressBook/query method
    try {
      const query = {
        accountId: this.accountId,
        sort: [{ property: "name", isAscending: true }],
        limit: 100,
      };
      
      const Rq = await this.jmap({
        using: [CORE, CONTACTS],
        methodCalls: [["AddressBook/query", query, "abq1"]],
      });
      
      const queryResponse = Rq.methodResponses.find((x) => x[0] === "AddressBook/query");
      if (!queryResponse || queryResponse[0] === "error") {
        const errorResponse = Rq.methodResponses.find((x) => x[0] === "error");
        if (errorResponse) {
          console.warn('[JMAP] AddressBook/query error:', errorResponse[1]);
          // Don't throw, try fallback method
        } else {
          console.warn('[JMAP] AddressBook/query: no response found');
          // Don't throw, try fallback method
        }
      } else {
        const ids = queryResponse[1]?.ids || [];
        
        if (ids.length === 0) {
          console.debug('[JMAP] AddressBook/query returned no IDs');
          return [];
        }
        
        const Rg = await this.jmap({
          using: [CORE, CONTACTS],
          methodCalls: [
            ["AddressBook/get", { accountId: this.accountId, ids, properties: ["id", "name", "isDefault"] }, "abg2"],
          ],
        });
        
        const getResponse = Rg.methodResponses.find((x) => x[0] === "AddressBook/get");
        if (!getResponse || getResponse[0] === "error") {
          const errorResponse = Rg.methodResponses.find((x) => x[0] === "error");
          if (errorResponse) {
            console.warn('[JMAP] AddressBook/get error:', errorResponse[1]);
            // Don't throw, try fallback method
          }
        } else {
          const books = getResponse[1]?.list || [];
          console.log('[JMAP] listAddressBooks found:', books.length, 'address books via query');
          return books;
        }
      }
    } catch (e) {
      console.warn('[JMAP] AddressBook/query failed, trying fallback:', e.message);
    }
    
    // Fallback: try direct query without sort
    try {
      console.log('[JMAP] Trying fallback AddressBook/query...');
      const queryResult = await this.jmap({
        using: [CORE, CONTACTS],
        methodCalls: [["AddressBook/query", {
          accountId: this.accountId,
          limit: 100
        }, "abq2"]],
      });
      
      const queryResponse = queryResult.methodResponses.find((x) => x[0] === "AddressBook/query");
      if (queryResponse && queryResponse[0] !== "error") {
        const ids = queryResponse[1]?.ids || [];
        if (ids.length > 0) {
          // Get the address books
          const getResult = await this.jmap({
            using: [CORE, CONTACTS],
            methodCalls: [
              ["AddressBook/get", { accountId: this.accountId, ids, properties: ["id", "name", "isDefault"] }, "abg2"],
            ],
          });
          
          const getResponse = getResult.methodResponses.find((x) => x[0] === "AddressBook/get");
          if (getResponse && getResponse[0] !== "error") {
            const books = getResponse[1]?.list || [];
            console.log('[JMAP] Fallback query found:', books.length, 'address books');
            return books;
          }
        }
      }
    } catch (e) {
      console.warn('[JMAP] Fallback query also failed:', e.message);
    }
    
    // Fallback: Try to get address book IDs from existing contacts
    try {
      console.log('[JMAP] Trying to get address books from existing contacts...');
      const contacts = await this.listContacts({ limit: 100 });
      const addressBookIdsSet = new Set();
      
      for (const contact of contacts) {
        if (contact.addressBookIds && Array.isArray(contact.addressBookIds)) {
          contact.addressBookIds.forEach(id => addressBookIdsSet.add(id));
        } else if (contact.addressBookIds && typeof contact.addressBookIds === 'object') {
          // addressBookIds is an object with keys as IDs
          Object.keys(contact.addressBookIds).forEach(id => addressBookIdsSet.add(id));
        }
      }
      
      if (addressBookIdsSet.size > 0) {
        const addressBookIds = Array.from(addressBookIdsSet);
        console.log('[JMAP] Found address book IDs from contacts:', addressBookIds);
        
        // Try to get address book details
        try {
          const getResult = await this.jmap({
            using: [CORE, CONTACTS],
            methodCalls: [
              ["AddressBook/get", { accountId: this.accountId, ids: addressBookIds, properties: ["id", "name", "isDefault"] }, "abg3"],
            ],
          });
          
          const getResponse = getResult.methodResponses.find((x) => x[0] === "AddressBook/get");
          if (getResponse && getResponse[0] !== "error") {
            const books = getResponse[1]?.list || [];
            if (books.length > 0) {
              console.log('[JMAP] Got address books from AddressBook/get:', books.length);
              return books;
            }
          }
        } catch (e) {
          console.warn('[JMAP] AddressBook/get failed, creating placeholder entries:', e.message);
        }
        
        // If AddressBook/get doesn't work, create placeholder entries with just IDs
        return addressBookIds.map(id => ({
          id: id,
          name: `Address Book ${id}`,
          isDefault: false
        }));
      }
    } catch (e) {
      console.warn('[JMAP] Failed to get address books from contacts:', e.message);
    }
    
    // If all methods fail, return empty array
    console.warn('[JMAP] No address books found after all attempts');
    return [];
  }

  async listContacts({ limit = 500, sort = [{ property: "name", isAscending: true }] } = {}) {
    if (!this.accountId) {
      throw new Error("accountId is required to list contacts");
    }

    // Use ContactCard/get with ids: null to get all contacts directly
    // This is simpler and works on Stalwart servers
    // Request JSContact properties (RFC 9610)
    const props = [
      "id",
      "name",
      "emails",
      "phones",
      "organizations",  // JSContact uses organizations array, not company
      "titles",          // JSContact uses titles array, not jobTitle
      "notes",
      "birthday",
      "anniversary",
      "addressBookIds",
      "blobId",
    ];
    
    try {
      const Rg = await this.jmap({
        using: [CORE, CONTACTS],
        methodCalls: [
          ["ContactCard/get", { 
            accountId: this.accountId, 
            ids: null, // Get all contacts
            properties: props 
          }, "cg1"],
        ],
      });
      
      const getResponse = Rg.methodResponses.find((x) => x[0] === "ContactCard/get");
      if (!getResponse || getResponse[0] === "error") {
        const errorResponse = Rg.methodResponses.find((x) => x[0] === "error");
        if (errorResponse) {
          // If direct get fails, fall back to query method
          console.warn('[JMAP] ContactCard/get with null ids failed, trying query method:', errorResponse[1]);
          return this.listContactsViaQuery({ limit, sort });
        }
        throw new Error("Failed to get contact details: no response found");
      }
      
      const cards = getResponse[1]?.list || [];
      
      // Transform cards to extract readable properties from name array and emails object
      return cards.map(card => this.transformContactCard(card));
    } catch (e) {
      // If direct get fails, fall back to query method
      console.warn('[JMAP] ContactCard/get failed, trying query method:', e.message);
      return this.listContactsViaQuery({ limit, sort });
    }
  }

  // Fallback method using query (original implementation)
  async listContactsViaQuery({ limit = 500, sort = [{ property: "name", isAscending: true }] } = {}) {
    if (!this.accountId) {
      throw new Error("accountId is required to list contacts");
    }

    // First, query for contact IDs
    const query = {
      accountId: this.accountId,
      sort,
      limit,
      calculateTotal: true,
    };
    
    const Rq = await this.jmap({
      using: [CORE, CONTACTS],
      methodCalls: [["ContactCard/query", query, "cq1"]],
    });
    
    const queryResponse = Rq.methodResponses.find((x) => x[0] === "ContactCard/query");
    if (!queryResponse) {
      const errorResponse = Rq.methodResponses.find((x) => x[0] === "error");
      if (errorResponse) {
        throw new Error(
          errorResponse[1]?.description || errorResponse[1]?.type || "Failed to query contacts"
        );
      }
      throw new Error("Failed to query contacts: no response found");
    }
    
    if (queryResponse[0] === "error") {
      throw new Error(
        queryResponse[1]?.description || queryResponse[1]?.type || "Failed to query contacts"
      );
    }
    
    const ids = queryResponse[1]?.ids || [];
    
    if (ids.length === 0) {
      return [];
    }
    
    // Get contact details - ContactCard uses structured properties
    // RFC 9610: name is an array of NameComponent objects
    // emails is an object with email IDs as keys
    // JSContact uses organizations and titles, not company and jobTitle
    const props = [
      "id",
      "name",
      "emails",
      "phones",
      "organizations",  // JSContact uses organizations array, not company
      "titles",          // JSContact uses titles array, not jobTitle
      "notes",
      "birthday",
      "anniversary",
      "addressBookIds",
      "blobId",
    ];
    
    const Rg = await this.jmap({
      using: [CORE, CONTACTS],
      methodCalls: [
        ["ContactCard/get", { accountId: this.accountId, ids, properties: props }, "cg1"],
      ],
    });
    
    const getResponse = Rg.methodResponses.find((x) => x[0] === "ContactCard/get");
    if (!getResponse || getResponse[0] === "error") {
      const errorResponse = Rg.methodResponses.find((x) => x[0] === "error");
      if (errorResponse) {
        throw new Error(
          errorResponse[1]?.description || errorResponse[1]?.type || "Failed to get contact details"
        );
      }
      throw new Error("Failed to get contact details: no response found");
    }
    
    const cards = getResponse[1]?.list || [];
    
    // Transform cards to extract readable properties from name array and emails object
    return cards.map(card => this.transformContactCard(card));
  }

  // Transform ContactCard from RFC 9610 format to readable format
  transformContactCard(card) {
    const result = {
      id: card.id,
      addressBookIds: card.addressBookIds || [],
      blobId: card.blobId || null,
    };
    
    // Extract name from JSContact format (RFC 9610)
    // name can be an object with components array or full property
    if (card.name && typeof card.name === 'object' && !Array.isArray(card.name)) {
      const nameObj = card.name;
      
      // Use full name if available
      if (nameObj.full) {
        result.name = nameObj.full;
      }
      
      // Extract from components array
      if (nameObj.components && Array.isArray(nameObj.components)) {
        const given = nameObj.components.find(c => c.kind === 'given')?.value || '';
        const surname = nameObj.components.find(c => c.kind === 'surname')?.value || '';
        result.firstName = given;
        result.lastName = surname;
        
        // Use full name if available, otherwise construct from components
        if (!result.name) {
          result.name = [given, surname].filter(Boolean).join(' ').trim() || '';
        }
      } else if (nameObj.full) {
        // If we only have full name, try to split it
        const parts = nameObj.full.trim().split(/\s+/);
        if (parts.length > 1) {
          result.firstName = parts[0];
          result.lastName = parts.slice(1).join(' ');
        } else {
          result.firstName = nameObj.full;
          result.lastName = '';
        }
      }
    } else if (card.name && Array.isArray(card.name)) {
      // Legacy format: array of NameComponent objects
      const personal = card.name.find(n => n.type === "personal");
      const surname = card.name.find(n => n.type === "surname");
      result.firstName = personal?.value || "";
      result.lastName = surname?.value || "";
      result.name = card.name.map(n => n.value).join(" ").trim() || 
                    `${result.firstName} ${result.lastName}`.trim();
    } else if (card.name) {
      // Fallback if name is a string
      result.name = card.name;
      const parts = card.name.trim().split(/\s+/);
      if (parts.length > 1) {
        result.firstName = parts[0];
        result.lastName = parts.slice(1).join(' ');
      } else {
        result.firstName = card.name;
        result.lastName = '';
      }
    }
    
    // Extract emails from emails object (object with email IDs as keys)
    if (card.emails && typeof card.emails === 'object' && !Array.isArray(card.emails)) {
      const emailList = Object.values(card.emails).map(e => {
        // Handle both { address: "..." } and direct string values
        return (typeof e === 'object' && e.address) ? e.address : e;
      }).filter(Boolean);
      result.email = emailList[0] || null;
      result.emails = emailList;
    }
    
    // Extract phones from phones object (object with phone IDs as keys)
    if (card.phones && typeof card.phones === 'object' && !Array.isArray(card.phones)) {
      const phoneList = Object.values(card.phones).map(p => {
        // Handle both { number: "..." } and direct string values
        return (typeof p === 'object' && p.number) ? p.number : p;
      }).filter(Boolean);
      result.phone = phoneList[0] || null;
      result.phones = phoneList;
    } else if (card.phone) {
      result.phone = card.phone;
      result.phones = [card.phone];
    }
    
    // Extract company from organizations array (JSContact format)
    if (card.organizations && Array.isArray(card.organizations) && card.organizations.length > 0) {
      result.company = card.organizations[0].name || card.organizations[0] || null;
    } else if (card.company !== undefined) {
      // Fallback for legacy format
      result.company = card.company;
    }
    
    // Extract jobTitle from titles array (JSContact format)
    if (card.titles && Array.isArray(card.titles) && card.titles.length > 0) {
      result.jobTitle = card.titles[0].name || card.titles[0] || null;
    } else if (card.jobTitle !== undefined) {
      // Fallback for legacy format
      result.jobTitle = card.jobTitle;
    }
    
    // Copy other properties directly
    if (card.notes !== undefined) result.notes = card.notes;
    if (card.birthday !== undefined) result.birthday = card.birthday;
    if (card.anniversary !== undefined) result.anniversary = card.anniversary;
    
    return result;
  }

  async contactQuery({
    filter = null,
    sort = [{ property: "name", isAscending: true }],
    position = 0,
    limit = 500,
  }) {
    if (!this.accountId) {
      throw new Error("accountId is required to query contacts");
    }

    const query = {
      accountId: this.accountId,
      sort,
      position,
      limit,
      calculateTotal: true,
    };
    
    if (filter) {
      query.filter = filter;
    }
    
    const Rq = await this.jmap({
      using: [CORE, CONTACTS],
      methodCalls: [["ContactCard/query", query, "cq1"]],
    });
    
    const queryResponse = Rq.methodResponses.find((x) => x[0] === "ContactCard/query");
    if (!queryResponse || queryResponse[0] === "error") {
      const errorResponse = Rq.methodResponses.find((x) => x[0] === "error");
      if (errorResponse) {
        throw new Error(
          errorResponse[1]?.description || errorResponse[1]?.type || "Failed to query contacts"
        );
      }
      throw new Error("Failed to query contacts: no response found");
    }
    
    return queryResponse[1] || {
      ids: [],
      total: 0,
      queryState: null,
      position: 0,
    };
  }

  async contactGet(ids, properties = null) {
    if (!ids?.length) return [];
    if (!this.accountId) {
      throw new Error("accountId is required to get contacts");
    }

    const defaultProps = [
      "id",
      "name",
      "emails",
      "phones",        // JSContact uses phones, not phone
      "organizations", // JSContact uses organizations, not company
      "titles",        // JSContact uses titles, not jobTitle
      "notes",
      "birthday",
      "anniversary",
      "addressBookIds",
      "blobId",
    ];
    
    const Rg = await this.jmap({
      using: [CORE, CONTACTS],
      methodCalls: [
        [
          "ContactCard/get",
          {
            accountId: this.accountId,
            ids,
            properties: properties || defaultProps,
          },
          "cg1",
        ],
      ],
    });
    
    const getResponse = Rg.methodResponses.find((x) => x[0] === "ContactCard/get");
    if (!getResponse || getResponse[0] === "error") {
      const errorResponse = Rg.methodResponses.find((x) => x[0] === "error");
      if (errorResponse) {
        throw new Error(
          errorResponse[1]?.description || errorResponse[1]?.type || "Failed to get contacts"
        );
      }
      throw new Error("Failed to get contacts: no response found");
    }
    
    const cards = getResponse[1]?.list || [];
    
    // Transform cards to extract readable properties from name array and emails object
    return cards.map(card => this.transformContactCard(card));
  }

  async contactSet(create = {}, update = {}, destroy = []) {
    if (!this.accountId) {
      throw new Error("accountId is required to set contacts");
    }

    const params = {
      accountId: this.accountId,
    };

    if (Object.keys(create).length > 0) {
      params.create = create;
    }
    if (Object.keys(update).length > 0) {
      params.update = update;
    }
    if (destroy.length > 0) {
      params.destroy = destroy;
    }

    const R = await this.jmap({
      using: [CORE, CONTACTS],
      methodCalls: [["ContactCard/set", params, "cs1"]],
    });

    const setResponse = R.methodResponses.find((x) => x[0] === "ContactCard/set");
    if (!setResponse || setResponse[0] === "error") {
      const errorResponse = R.methodResponses.find((x) => x[0] === "error");
      if (errorResponse) {
        console.error('[JMAP] ContactCard/set error:', errorResponse);
        const errorDetails = errorResponse[1];
        const errorMsg = errorDetails?.description || errorDetails?.type || "Failed to set contacts";
        // Include property errors if available
        if (errorDetails?.properties) {
          const propErrors = Object.entries(errorDetails.properties).map(([prop, err]) => 
            `${prop}: ${err}`
          ).join(', ');
          throw new Error(`${errorMsg} (${propErrors})`);
        }
        throw new Error(errorMsg);
      }
      throw new Error("Failed to set contacts: no response found");
    }

    const responseData = setResponse[1] || {
      created: {},
      updated: {},
      destroyed: [],
      notCreated: {},
      notUpdated: {},
      notDestroyed: {},
    };
    
    console.debug('[JMAP] ContactCard/set response:', {
      hasCreated: !!responseData.created,
      hasUpdated: !!responseData.updated,
      hasNotUpdated: !!responseData.notUpdated,
      createdCount: responseData.created ? Object.keys(responseData.created).length : 0,
      updatedCount: responseData.updated ? Object.keys(responseData.updated).length : 0,
      notUpdatedCount: responseData.notUpdated ? Object.keys(responseData.notUpdated).length : 0,
      fullResponse: responseData
    });
    
    return responseData;
  }

  // Build vCard string from contact data
  // Escape vCard value (escape backslash, semicolon, comma, newline)
  escapeVCardValue(value) {
    if (!value) return "";
    return String(value)
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "");
  }

  buildVCard(contactData) {
    const lines = ["BEGIN:VCARD", "VERSION:3.0"];
    
    // Name (FN for formatted name, N for structured name)
    const firstName = contactData.firstName || "";
    const lastName = contactData.lastName || "";
    const fullName = contactData.name || `${firstName} ${lastName}`.trim() || "Unnamed";
    
    lines.push(`FN:${this.escapeVCardValue(fullName)}`);
    if (firstName || lastName) {
      lines.push(`N:${this.escapeVCardValue(lastName)};${this.escapeVCardValue(firstName)};;;`);
    }
    
    // Email
    if (contactData.email) {
      lines.push(`EMAIL:${this.escapeVCardValue(contactData.email)}`);
    }
    if (contactData.emails && Array.isArray(contactData.emails)) {
      contactData.emails.forEach(email => {
        if (email && email !== contactData.email) {
          lines.push(`EMAIL:${this.escapeVCardValue(email)}`);
        }
      });
    }
    
    // Phone
    if (contactData.phone) {
      lines.push(`TEL:${this.escapeVCardValue(contactData.phone)}`);
    }
    
    // Organization
    if (contactData.company) {
      lines.push(`ORG:${this.escapeVCardValue(contactData.company)}`);
    }
    
    // Title
    if (contactData.jobTitle) {
      lines.push(`TITLE:${this.escapeVCardValue(contactData.jobTitle)}`);
    }
    
    // Notes
    if (contactData.notes) {
      lines.push(`NOTE:${this.escapeVCardValue(contactData.notes)}`);
    }
    
    // Birthday
    if (contactData.birthday) {
      lines.push(`BDAY:${this.escapeVCardValue(contactData.birthday)}`);
    }
    
    // Anniversary (custom property)
    if (contactData.anniversary) {
      lines.push(`X-ANNIVERSARY:${this.escapeVCardValue(contactData.anniversary)}`);
    }
    
    lines.push("END:VCARD");
    return lines.join("\r\n");
  }

  async getOrCreateDefaultAddressBook() {
    // Try to get existing address books - try multiple times with different approaches
    try {
      const addressBooks = await this.listAddressBooks();
      if (addressBooks.length > 0) {
        // Prefer "Stalwart Address Book" if it exists
        const stalwartBook = addressBooks.find(ab => 
          ab.name && ab.name.toLowerCase().includes('stalwart')
        );
        if (stalwartBook) {
          console.log('[JMAP] Using Stalwart Address Book:', {
            id: stalwartBook.id,
            name: stalwartBook.name,
            isDefault: stalwartBook.isDefault
          });
          return stalwartBook.id;
        }
        
        // Then prefer address book with isDefault: true
        const defaultBook = addressBooks.find(ab => ab.isDefault === true);
        if (defaultBook) {
          console.log('[JMAP] Using default address book:', {
            id: defaultBook.id,
            name: defaultBook.name,
            isDefault: defaultBook.isDefault
          });
          return defaultBook.id;
        }
        
        // Otherwise use the first one
        const firstBook = addressBooks[0];
        console.log('[JMAP] Using first address book:', {
          id: firstBook.id,
          name: firstBook.name,
          isDefault: firstBook.isDefault,
          totalAvailable: addressBooks.length
        });
        return firstBook.id;
      }
    } catch (e) {
      console.warn('[JMAP] Could not list address books via listAddressBooks, trying direct query:', e.message);
    }
    
    // Also try a direct query without get to see if we can find any address books
    try {
      const queryResult = await this.jmap({
        using: [CORE, CONTACTS],
        methodCalls: [["AddressBook/query", {
          accountId: this.accountId,
          limit: 100
        }, "abq2"]],
      });
      
      const queryResponse = queryResult.methodResponses.find((x) => x[0] === "AddressBook/query");
      if (queryResponse && queryResponse[0] !== "error") {
        const ids = queryResponse[1]?.ids || [];
        if (ids.length > 0) {
          // Get the address books to find Stalwart
          const getResult = await this.jmap({
            using: [CORE, CONTACTS],
            methodCalls: [
              ["AddressBook/get", { accountId: this.accountId, ids, properties: ["id", "name", "isDefault"] }, "abg2"],
            ],
          });
          
          const getResponse = getResult.methodResponses.find((x) => x[0] === "AddressBook/get");
          if (getResponse && getResponse[0] !== "error") {
            const addressBooks = getResponse[1]?.list || [];
            
            // Prefer "Stalwart Address Book"
            const stalwartBook = addressBooks.find(ab => 
              ab.name && ab.name.toLowerCase().includes('stalwart')
            );
            if (stalwartBook) {
              console.log('[JMAP] Found Stalwart Address Book via direct query:', {
                id: stalwartBook.id,
                name: stalwartBook.name
              });
              return stalwartBook.id;
            }
            
            // Use first available
            if (addressBooks.length > 0) {
              console.log('[JMAP] Found address book via direct query:', {
                id: addressBooks[0].id,
                name: addressBooks[0].name
              });
              return addressBooks[0].id;
            }
          }
        }
      }
    } catch (e) {
      console.warn('[JMAP] Direct address book query also failed:', e.message);
    }
    
    // Do NOT create a default address book - throw error instead
    throw new Error(`No address book found. Please ensure "Stalwart Address Book" exists. The server may not support automatic address book creation.`);
  }

  async createContact(contactData, addressBookId = null) {
    // Use provided address book ID, or get default
    if (!addressBookId) {
      try {
        addressBookId = await this.getOrCreateDefaultAddressBook();
      } catch (e) {
        // Re-throw with more context
        throw new Error(`Could not get or create address book. ContactCard requires addressBookIds. ${e.message}`);
      }
    }
    
    if (!addressBookId) {
      throw new Error("Could not get or create address book. ContactCard requires addressBookIds.");
    }
    
    // Create ContactCard with structured properties (not vCard format)
    // RFC 9610 Section 2.1: addressBookIds is an object/map, not an array
    // Format: { [addressBookId]: true }
    const createId = "c1";
    
    // Ensure addressBookId is valid
    if (!addressBookId || typeof addressBookId !== 'string') {
      throw new Error(`Invalid addressBookId: ${addressBookId}`);
    }
    
    const addressBookIds = { [addressBookId]: true };
    
    // Build ContactCard with JSContact format (RFC 9610)
    // Based on Node.js test script that works with Stalwart
    const cardData = {
      addressBookIds: addressBookIds
    };
    
    // Build name - can be string or object with components
    // Try to build from firstName/lastName first, then fall back to name string
    if (contactData.firstName || contactData.lastName) {
      const nameComponents = [];
      if (contactData.firstName) {
        nameComponents.push({ kind: "given", value: contactData.firstName });
      }
      if (contactData.lastName) {
        nameComponents.push({ kind: "surname", value: contactData.lastName });
      }
      if (nameComponents.length > 0) {
        const fullName = [contactData.firstName, contactData.lastName].filter(Boolean).join(' ');
        cardData.name = {
          full: fullName,
          components: nameComponents,
          isOrdered: true
        };
      }
    } else if (contactData.name) {
      // Use name as string (simpler format that Stalwart accepts)
      cardData.name = contactData.name;
    }
    
    // Build emails object - RFC 9610: emails is an object with email IDs as keys
    const emailsObj = {};
    if (contactData.email) {
      emailsObj["email-0"] = { address: contactData.email, contexts: ["personal"] };
    }
    if (contactData.emails && Array.isArray(contactData.emails)) {
      contactData.emails.forEach((email, index) => {
        if (email && email !== contactData.email) {
          emailsObj[`email-${index + (contactData.email ? 1 : 0)}`] = { 
            address: email, 
            contexts: ["personal"] 
          };
        }
      });
    }
    if (Object.keys(emailsObj).length > 0) {
      cardData.emails = emailsObj;
    }
    
    // Build phones object - RFC 9610: phones is an object with phone IDs as keys
    const phonesObj = {};
    if (contactData.phone) {
      phonesObj["phone-0"] = { 
        number: contactData.phone, 
        features: ["voice"],
        contexts: ["mobile"] 
      };
    }
    if (contactData.phones && Array.isArray(contactData.phones)) {
      contactData.phones.forEach((phone, index) => {
        if (phone && phone !== contactData.phone) {
          phonesObj[`phone-${index + (contactData.phone ? 1 : 0)}`] = { 
            number: phone, 
            features: ["voice"],
            contexts: ["mobile"] 
          };
        }
      });
    }
    if (Object.keys(phonesObj).length > 0) {
      cardData.phones = phonesObj;
    }
    
    // Use organizations array instead of company (JSContact format)
    if (contactData.company) {
      cardData.organizations = [{ name: contactData.company }];
    }
    
    // Use titles array instead of jobTitle (JSContact format)
    if (contactData.jobTitle) {
      cardData.titles = [{ name: contactData.jobTitle }];
    }
    
    // Add other properties
    if (contactData.notes) {
      cardData.notes = contactData.notes;
    }
    if (contactData.birthday) {
      cardData.birthday = contactData.birthday;
    }
    if (contactData.anniversary) {
      cardData.anniversary = contactData.anniversary;
    }
    
    // Log what we're sending for debugging
    console.log('[JMAP] Creating contact with address book:', {
      addressBookId: addressBookId,
      contactData: {
        name: cardData.name ? (typeof cardData.name === 'string' ? cardData.name : (cardData.name.full || cardData.name.components?.map(n => n.value).join(' ') || 'unknown')) : 'none',
        emails: Object.keys(cardData.emails || {}).length + ' email(s)',
        phones: Object.keys(cardData.phones || {}).length + ' phone(s)',
        organizations: cardData.organizations?.length || 0,
        titles: cardData.titles?.length || 0
      }
    });
    console.debug('[JMAP] Full contact data:', cardData);
    
    const result = await this.contactSet({ [createId]: cardData });
    const created = result.created?.[createId];
    if (!created) {
      const notCreated = result.notCreated?.[createId];
      // Log full error details
      console.error('[JMAP] Contact not created:', notCreated);
      
      // Check for property-specific errors
      if (notCreated?.properties) {
        const propErrors = Object.entries(notCreated.properties).map(([prop, err]) => 
          `${prop}: ${err}`
        ).join(', ');
        throw new Error(`Invalid property: ${propErrors}`);
      }
      
      throw new Error(
        notCreated?.description || notCreated?.type || "Failed to create contact"
      );
    }
    return created;
  }

  async updateContact(contactId, contactData) {
    // Get existing contact to preserve addressBookIds
    let existingCard = null;
    try {
      const existing = await this.contactGet([contactId], ["addressBookIds"]);
      existingCard = existing[0];
    } catch (e) {
      console.warn('[JMAP] Could not get existing contact, will try to preserve addressBookIds from contactData:', e.message);
      // If we can't get the existing contact, we'll try to use addressBookIds from contactData if provided
      if (contactData.addressBookIds) {
        existingCard = { addressBookIds: contactData.addressBookIds };
      }
    }
    
    // Update ContactCard with structured properties, preserve addressBookIds
    // RFC 9610 Section 2.1: addressBookIds is an object/map, not an array
    // Format: { [addressBookId]: true }
    const updateData = {};
    
    // Build name - can be string or object with components (JSContact format)
    if (contactData.firstName !== undefined || contactData.lastName !== undefined || contactData.name !== undefined) {
      if (contactData.firstName || contactData.lastName) {
        const nameComponents = [];
        if (contactData.firstName) {
          nameComponents.push({ kind: "given", value: contactData.firstName });
        }
        if (contactData.lastName) {
          nameComponents.push({ kind: "surname", value: contactData.lastName });
        }
        if (nameComponents.length > 0) {
          const fullName = [contactData.firstName, contactData.lastName].filter(Boolean).join(' ');
          updateData.name = {
            full: fullName,
            components: nameComponents,
            isOrdered: true
          };
        } else {
          updateData.name = null;
        }
      } else if (contactData.name) {
        // Use name as string
        updateData.name = contactData.name;
      } else {
        updateData.name = null;
      }
    }
    
    // Build emails object
    if (contactData.email !== undefined || contactData.emails !== undefined) {
      const emailsObj = {};
      if (contactData.email) {
        emailsObj["email-0"] = { address: contactData.email, contexts: ["personal"] };
      }
      if (contactData.emails && Array.isArray(contactData.emails)) {
        contactData.emails.forEach((email, index) => {
          if (email && email !== contactData.email) {
            emailsObj[`email-${index + (contactData.email ? 1 : 0)}`] = { 
              address: email, 
              contexts: ["personal"] 
            };
          }
        });
      }
      if (Object.keys(emailsObj).length > 0) {
        updateData.emails = emailsObj;
      } else {
        updateData.emails = null;
      }
    }
    
    // Build phones object (JSContact format)
    if (contactData.phone !== undefined || contactData.phones !== undefined) {
      const phonesObj = {};
      if (contactData.phone) {
        phonesObj["phone-0"] = { 
          number: contactData.phone, 
          features: ["voice"],
          contexts: ["mobile"] 
        };
      }
      if (contactData.phones && Array.isArray(contactData.phones)) {
        contactData.phones.forEach((phone, index) => {
          if (phone && phone !== contactData.phone) {
            phonesObj[`phone-${index + (contactData.phone ? 1 : 0)}`] = { 
              number: phone, 
              features: ["voice"],
              contexts: ["mobile"] 
            };
          }
        });
      }
      if (Object.keys(phonesObj).length > 0) {
        updateData.phones = phonesObj;
      } else {
        updateData.phones = null;
      }
    }
    
    // Use organizations array instead of company (JSContact format)
    if (contactData.company !== undefined) {
      if (contactData.company) {
        updateData.organizations = [{ name: contactData.company }];
      } else {
        updateData.organizations = null;
      }
    }
    
    // Use titles array instead of jobTitle (JSContact format)
    if (contactData.jobTitle !== undefined) {
      if (contactData.jobTitle) {
        updateData.titles = [{ name: contactData.jobTitle }];
      } else {
        updateData.titles = null;
      }
    }
    if (contactData.notes !== undefined) {
      updateData.notes = contactData.notes || null;
    }
    if (contactData.birthday !== undefined) {
      updateData.birthday = contactData.birthday || null;
    }
    if (contactData.anniversary !== undefined) {
      updateData.anniversary = contactData.anniversary || null;
    }
    
    // Preserve addressBookIds if they exist (check if it's an object with keys)
    if (existingCard?.addressBookIds && typeof existingCard.addressBookIds === 'object' && !Array.isArray(existingCard.addressBookIds)) {
      // Already in correct object format
      updateData.addressBookIds = existingCard.addressBookIds;
    } else if (existingCard?.addressBookIds && Array.isArray(existingCard.addressBookIds) && existingCard.addressBookIds.length > 0) {
      // Convert array format to object format (for backwards compatibility)
      const addressBookIdsObj = {};
      existingCard.addressBookIds.forEach(id => {
        addressBookIdsObj[id] = true;
      });
      updateData.addressBookIds = addressBookIdsObj;
    } else {
      // If no addressBookIds, get or create default
      const addressBookId = await this.getOrCreateDefaultAddressBook();
      if (addressBookId) {
        updateData.addressBookIds = { [addressBookId]: true };
      }
    }
    
    console.debug('[JMAP] Updating contact:', {
      contactId,
      updateData: {
        hasName: !!updateData.name,
        hasEmails: !!updateData.emails,
        hasPhones: !!updateData.phones,
        hasOrganizations: !!updateData.organizations,
        hasTitles: !!updateData.titles,
        hasAddressBookIds: !!updateData.addressBookIds
      }
    });
    console.debug('[JMAP] Full update data:', updateData);
    
    const result = await this.contactSet({}, { [contactId]: updateData });
    console.debug('[JMAP] ContactSet response:', result);
    
    const updated = result.updated?.[contactId];
    if (!updated) {
      const notUpdated = result.notUpdated?.[contactId];
      console.error('[JMAP] Contact update failed:', {
        notUpdated,
        fullResult: result,
        hasUpdated: !!result.updated,
        hasNotUpdated: !!result.notUpdated,
        updatedKeys: result.updated ? Object.keys(result.updated) : [],
        notUpdatedKeys: result.notUpdated ? Object.keys(result.notUpdated) : []
      });
      
      // Check for property-specific errors
      if (notUpdated?.properties) {
        const propErrors = Object.entries(notUpdated.properties).map(([prop, err]) => 
          `${prop}: ${err}`
        ).join(', ');
        throw new Error(`Invalid property: ${propErrors}`);
      }
      
      // Check if there's an error in the method response itself
      if (result.error) {
        throw new Error(result.error.description || result.error.type || "Failed to update contact");
      }
      
      throw new Error(
        notUpdated?.description || notUpdated?.type || "Failed to update contact (no error details available)"
      );
    }
    return updated;
  }

  async deleteContact(contactId) {
    const result = await this.contactSet({}, {}, [contactId]);
    const destroyed = result.destroyed?.includes(contactId);
    if (!destroyed) {
      const notDestroyed = result.notDestroyed?.[contactId];
      throw new Error(
        notDestroyed?.description || notDestroyed?.type || "Failed to delete contact"
      );
    }
    return true;
  }

  /* ---------- Calendar methods (RFC 8984) ---------- */
  
  async listCalendars() {
    const calendarCapability = 'urn:ietf:params:jmap:calendars';
    const calendarAccountId = this._getAccountIdForCapability(calendarCapability);
    
    if (!calendarAccountId) {
      console.error('[JMAP] No accountId available for calendars');
      return [];
    }

    try {
      console.log('[JMAP] Listing calendars with accountId:', calendarAccountId);
      // Match the test script format - Calendar/get with just accountId (no ids specified means get all)
      const R = await this.jmap({
        using: [CORE, CALENDARS],
        methodCalls: [
          ["Calendar/get", {
            accountId: calendarAccountId,
            // Don't specify ids - this means get all calendars (same as test script)
            // properties are optional - server will return default properties
          }, "cg1"],
        ],
      });

      const getResponse = R.methodResponses.find((x) => x[0] === "Calendar/get");
      if (!getResponse || getResponse[0] === "error") {
        const errorResponse = R.methodResponses.find((x) => x[0] === "error");
        if (errorResponse) {
          console.error('[JMAP] Calendar/get failed:', errorResponse[1]);
          console.error('[JMAP] Full error response:', JSON.stringify(errorResponse[1], null, 2));
        }
        return [];
      }

      const calendars = getResponse[1]?.list || [];
      console.log('[JMAP] Found calendars:', calendars.length);
      if (calendars.length > 0) {
        console.log('[JMAP] Calendar names:', calendars.map(c => c.name || c.id));
      }
      return calendars;
    } catch (e) {
      console.error('[JMAP] Failed to list calendars:', e);
      console.error('[JMAP] Error details:', e.message, e.stack);
      return [];
    }
  }

  async getEvents(calendarIds = null, start = null, end = null) {
    const calendarCapability = 'urn:ietf:params:jmap:calendars';
    const calendarAccountId = this._getAccountIdForCapability(calendarCapability);
    
    if (!calendarAccountId) {
      throw new Error("accountId is required to get events");
    }

    // If no calendarIds provided, get all calendars first
    if (!calendarIds) {
      const calendars = await this.listCalendars();
      calendarIds = calendars.map(c => c.id);
    }

    if (!calendarIds || calendarIds.length === 0) {
      return [];
    }

    // Build filter - Stalwart doesn't support calendarIds filter, so query all events and filter client-side
    const filter = {};

    if (start || end) {
      filter.after = start || new Date().toISOString();
      if (end) {
        filter.before = end;
      }
    }

    console.log('[JMAP] Querying events:');
    console.log('  - Calendar Account ID:', calendarAccountId);
    console.log('  - Calendar IDs (will filter client-side):', calendarIds);
    console.log('  - Filter:', JSON.stringify(filter, null, 2));
    console.log('  - Start:', start);
    console.log('  - End:', end);

    try {
      const runQuery = (queryFilter) =>
        this.jmap({
          using: [CORE, CALENDARS],
          methodCalls: [
            ["CalendarEvent/query", {
              accountId: calendarAccountId,
              filter: queryFilter,
              sort: [{ property: "start", isAscending: true }],
              limit: 1000
            }, "ceq1"],
          ],
        });

      // Query all events in the date range (Stalwart doesn't support calendarIds filter)
      let queryResponse = await runQuery(filter);
      let errorResponse = queryResponse.methodResponses.find((x) => x[0] === "error");
      if (errorResponse?.[1]?.type === "unsupportedFilter") {
        console.warn('[JMAP] CalendarEvent/query unsupportedFilter, retrying without filter:', errorResponse[1]);
        queryResponse = await runQuery({});
        errorResponse = queryResponse.methodResponses.find((x) => x[0] === "error");
      }

      const queryResult = queryResponse.methodResponses.find((x) => x[0] === "CalendarEvent/query")?.[1];
      
      if (errorResponse) {
        console.error('[JMAP] CalendarEvent/query error:', errorResponse[1]);
        throw new Error(errorResponse[1]?.description || 'CalendarEvent/query failed');
      }
      
      console.log('[JMAP] CalendarEvent/query response:', queryResult);
      
      if (!queryResult || !queryResult.ids || queryResult.ids.length === 0) {
        console.log('[JMAP] No event IDs found in query result');
        return [];
      }
      
      console.log('[JMAP] Found', queryResult.ids.length, 'event IDs (before calendar filtering)');

      // Then get the full event details
      const getResponse = await this.jmap({
        using: [CORE, CALENDARS],
        methodCalls: [
          ["CalendarEvent/get", {
            accountId: calendarAccountId,
            ids: queryResult.ids,
            properties: [
              "id",
              "calendarId",
              "calendarIds",  // Also request calendarIds to see the actual format
              "title",
              "description",
              "start",
              "end",
              "duration",  // Also request duration in case end is missing
              "timeZone",
              "location",
              "recurrenceRules",
              "participants",
              "keywords",
              "freeBusyStatus",
              "priority",
              "privacy",
              "showWithoutTime"
            ]
          }, "ceg1"],
        ],
      });

      const getResult = getResponse.methodResponses.find((x) => x[0] === "CalendarEvent/get")?.[1];
      let events = getResult?.list || [];
      
      console.log('[JMAP] Retrieved', events.length, 'events from CalendarEvent/get');
      if (events.length > 0) {
        console.log('[JMAP] First event structure:', JSON.stringify(events[0], null, 2));
      }
      
      // Filter by calendarIds client-side (Stalwart doesn't support calendarIds filter in query)
      if (calendarIds && calendarIds.length > 0) {
        const calendarIdSet = new Set(calendarIds);
        console.log('[JMAP] Filtering events for calendars:', Array.from(calendarIdSet));
        
        events = events.filter(event => {
          // Check if event belongs to any of the requested calendars
          let belongsToCalendar = false;
          
          // Check calendarIds object format
          if (event.calendarIds && typeof event.calendarIds === 'object' && !Array.isArray(event.calendarIds)) {
            const eventCalendarIds = Object.keys(event.calendarIds).filter(key => event.calendarIds[key] === true);
            belongsToCalendar = eventCalendarIds.some(id => calendarIdSet.has(id));
            if (belongsToCalendar) {
              console.log('[JMAP] Event', event.id, 'matches via calendarIds:', eventCalendarIds);
            }
          }
          
          // Check calendarId (singular) format
          if (!belongsToCalendar && event.calendarId) {
            belongsToCalendar = calendarIdSet.has(event.calendarId);
            if (belongsToCalendar) {
              console.log('[JMAP] Event', event.id, 'matches via calendarId:', event.calendarId);
            }
          }
          
          if (!belongsToCalendar) {
            console.log('[JMAP] Event', event.id, 'does not match - calendarIds:', event.calendarIds, 'calendarId:', event.calendarId);
          }
          
          return belongsToCalendar;
        });
        console.log('[JMAP] Filtered to', events.length, 'events for requested calendars');
      }
      
      // Transform JSCalendar format to our internal format
      return events.map(event => {
        const transformed = { ...event };
        
        // Convert calendarIds object to calendarId string
        if (event.calendarIds && typeof event.calendarIds === 'object' && !Array.isArray(event.calendarIds)) {
          const calendarIdKeys = Object.keys(event.calendarIds).filter(key => event.calendarIds[key] === true);
          if (calendarIdKeys.length > 0) {
            transformed.calendarId = calendarIdKeys[0]; // Use first calendar ID
          }
        }
        
        // Convert duration to end if end is missing
        if (event.start && event.duration && !event.end) {
          const startDate = new Date(event.start);
          const durationStr = event.duration; // e.g., "PT1H30M"
          
          // Parse ISO 8601 duration
          const durationMatch = durationStr.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
          if (durationMatch) {
            const hours = parseInt(durationMatch[1] || '0', 10);
            const minutes = parseInt(durationMatch[2] || '0', 10);
            const seconds = parseInt(durationMatch[3] || '0', 10);
            
            const endDate = new Date(startDate);
            endDate.setHours(endDate.getHours() + hours);
            endDate.setMinutes(endDate.getMinutes() + minutes);
            endDate.setSeconds(endDate.getSeconds() + seconds);
            
            transformed.end = endDate.toISOString();
          }
        }
        
        return transformed;
      });
    } catch (e) {
      console.error('[JMAP] Failed to get events:', e);
      return [];
    }
  }

  async createEvent(calendarId, eventData) {
    const calendarCapability = 'urn:ietf:params:jmap:calendars';
    const calendarAccountId = this._getAccountIdForCapability(calendarCapability);
    
    if (!calendarAccountId) {
      throw new Error("accountId is required to create event");
    }

    const eventId = `event-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Convert eventData to JSCalendar format (RFC 8984)
    const startDate = new Date(eventData.start);
    const endDate = new Date(eventData.end);
    const durationMs = endDate.getTime() - startDate.getTime();
    const durationSeconds = Math.floor(durationMs / 1000);
    const hours = Math.floor(durationSeconds / 3600);
    const minutes = Math.floor((durationSeconds % 3600) / 60);
    const seconds = durationSeconds % 60;
    
    // Format duration as PT1H30M (ISO 8601)
    let duration = 'PT';
    if (hours > 0) duration += `${hours}H`;
    if (minutes > 0) duration += `${minutes}M`;
    if (seconds > 0 && hours === 0 && minutes === 0) duration += `${seconds}S`;
    if (duration === 'PT') duration = 'PT1H'; // Default to 1 hour if no duration

    const jmapEvent = {
      '@type': 'Event',
      title: eventData.title || 'Untitled Event',
      start: this._toLocalDateTime(startDate),
      duration: duration,
      timeZone: eventData.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      calendarIds: {
        [calendarId]: true  // Object format: { "calendarId": true }
      },
      showWithoutTime: eventData.showWithoutTime || false
    };

    if (eventData.description) jmapEvent.description = eventData.description;
    if (eventData.location) jmapEvent.location = eventData.location;

    console.log('[JMAP] Creating event with data:', JSON.stringify(jmapEvent, null, 2));

    const R = await this.jmap({
      using: [CORE, CALENDARS],
      methodCalls: [
        ["CalendarEvent/set", {
          accountId: calendarAccountId,
          create: {
            [eventId]: jmapEvent
          }
        }, "ces1"],
      ],
    });

    const setResponse = R.methodResponses.find((x) => x[0] === "CalendarEvent/set");
    if (!setResponse || setResponse[0] === "error") {
      const errorResponse = R.methodResponses.find((x) => x[0] === "error");
      console.error('[JMAP] CalendarEvent/set error:', errorResponse?.[1]);
      throw new Error(
        errorResponse?.[1]?.description || "Failed to create event"
      );
    }

    const created = setResponse[1]?.created?.[eventId];
    if (!created) {
      const notCreated = setResponse[1]?.notCreated?.[eventId];
      console.error('[JMAP] Event not created:', notCreated);
      if (notCreated?.properties) {
        const propErrors = Object.entries(notCreated.properties)
          .map(([prop, err]) => `${prop}: ${err}`)
          .join(', ');
        throw new Error(`Invalid property: ${propErrors}`);
      }
      throw new Error(
        notCreated?.description || notCreated?.type || "Failed to create event"
      );
    }

    console.log('[JMAP] Event created successfully:', created.id);
    return created;
  }

  async updateEvent(calendarId, eventId, updates) {
    const calendarCapability = 'urn:ietf:params:jmap:calendars';
    const calendarAccountId = this._getAccountIdForCapability(calendarCapability);
    
    if (!calendarAccountId) {
      throw new Error("accountId is required to update event");
    }

    const jmapUpdates = {};
    const allowed = [
      "title",
      "description",
      "location",
      "showWithoutTime",
      "timeZone",
    ];

    for (const key of allowed) {
      if (updates[key] !== undefined && updates[key] !== null && updates[key] !== "") {
        jmapUpdates[key] = updates[key];
      }
    }

    if (updates.start) {
      jmapUpdates.start = this._toLocalDateTime(updates.start);
    }

    if (updates.start && updates.end) {
      const startDate = new Date(updates.start);
      const endDate = new Date(updates.end);
      const durationMs = endDate.getTime() - startDate.getTime();
      const durationSeconds = Math.floor(durationMs / 1000);
      const hours = Math.floor(durationSeconds / 3600);
      const minutes = Math.floor((durationSeconds % 3600) / 60);

      let duration = 'PT';
      if (hours > 0) duration += `${hours}H`;
      if (minutes > 0) duration += `${minutes}M`;
      if (duration === 'PT') duration = 'PT1H';

      jmapUpdates.duration = duration;
      if (!jmapUpdates.timeZone) {
        jmapUpdates.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      }
    }

    const targetCalendarId = updates.calendarId || calendarId;
    if (targetCalendarId) {
      jmapUpdates.calendarIds = { [targetCalendarId]: true };
    }

    const R = await this.jmap({
      using: [CORE, CALENDARS],
      methodCalls: [
        ["CalendarEvent/set", {
          accountId: calendarAccountId,
          update: {
            [eventId]: jmapUpdates
          }
        }, "ces2"],
      ],
    });

    const setResponse = R.methodResponses.find((x) => x[0] === "CalendarEvent/set");
    if (!setResponse || setResponse[0] === "error") {
      const errorResponse = R.methodResponses.find((x) => x[0] === "error");
      console.error('[JMAP] CalendarEvent/set update error:', errorResponse?.[1]);
      throw new Error(
        errorResponse?.[1]?.description || "Failed to update event"
      );
    }

    const updated = setResponse[1]?.updated?.[eventId];
    if (!updated) {
      const notUpdated = setResponse[1]?.notUpdated?.[eventId];
      console.error('[JMAP] Event not updated:', notUpdated);
      throw new Error(
        notUpdated?.description || notUpdated?.type || "Failed to update event"
      );
    }

    return updated;
  }

  async deleteEvent(calendarId, eventId) {
    const calendarCapability = 'urn:ietf:params:jmap:calendars';
    const calendarAccountId = this._getAccountIdForCapability(calendarCapability);
    
    if (!calendarAccountId) {
      throw new Error("accountId is required to delete event");
    }

    const R = await this.jmap({
      using: [CORE, CALENDARS],
      methodCalls: [
        ["CalendarEvent/set", {
          accountId: calendarAccountId,
          destroy: [eventId]
        }, "ces3"],
      ],
    });

    const setResponse = R.methodResponses.find((x) => x[0] === "CalendarEvent/set");
    if (!setResponse || setResponse[0] === "error") {
      const errorResponse = R.methodResponses.find((x) => x[0] === "error");
      console.error('[JMAP] CalendarEvent/set delete error:', errorResponse?.[1]);
      throw new Error(
        errorResponse?.[1]?.description || "Failed to delete event"
      );
    }

    const destroyed = setResponse[1]?.destroyed?.includes(eventId);
    if (!destroyed) {
      const notDestroyed = setResponse[1]?.notDestroyed?.[eventId];
      console.error('[JMAP] Event not destroyed:', notDestroyed);
      throw new Error(
        notDestroyed?.description || notDestroyed?.type || "Failed to delete event"
      );
    }

    return true;
  }
}

export const JMAP = { Client: JMAPClient, NS: { CORE, MAIL, SUBMIT, CONTACTS, CALENDARS } };
