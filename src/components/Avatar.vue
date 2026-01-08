<script>
import { ref, computed, watch, onMounted } from 'vue'
import { md5 } from '../utils/md5.js'

export default {
  name: 'Avatar',
  props: {
    name: String,
    email: String
  },
  setup(props) {
    const hasImg = ref(false) // Start with false, will be set to true when image loads
    const faviconUrl = ref(null)
    const faviconLoaded = ref(false)
    const faviconError = ref(false)
    const tryingFavicon = ref(false)
    const currentFaviconUrl = ref(null) // Track the current URL being tried

    // Extract domain from email
    const domain = computed(() => {
      const email = (props.email || "").trim()
      if (!email || !email.includes('@')) return null
      const parts = email.split('@')
      return parts.length > 1 ? parts[1].toLowerCase() : null
    })

    // Cloudflare Worker favicon proxy URL (set to your deployed worker URL)
    // Example: 'https://favicon-proxy.YOUR_SUBDOMAIN.workers.dev'
    // Leave empty to disable Cloudflare Worker proxy
    const CLOUDFLARE_WORKER_URL = 'https://stormbox.luiv.workers.dev'

    // Helper function to try loading an image with timeout
    const tryLoadImage = async (url, timeout = 2000) => {
      return new Promise((resolve, reject) => {
        const img = new Image()
        const timer = setTimeout(() => {
          img.onload = null
          img.onerror = null
          reject(new Error('Timeout'))
        }, timeout)
        
        img.onload = () => {
          clearTimeout(timer)
          resolve(url)
        }
        img.onerror = () => {
          clearTimeout(timer)
          reject(new Error('Failed to load'))
        }
        img.src = url
      })
    }

    // Get favicon URLs - use services only (avoid ORB errors from direct domain requests)
    // The Cloudflare Worker handles direct domain requests server-side
    const getFaviconUrls = (domain) => {
      if (!domain) return []
      
      return [
        // 1. Cloudflare Worker first (handles HTML parsing for hashed favicons, avoids ORB)
        ...(CLOUDFLARE_WORKER_URL ? [
          `${CLOUDFLARE_WORKER_URL}/?url=${domain}`,
          `${CLOUDFLARE_WORKER_URL}/?url=https://${domain}`,
          `${CLOUDFLARE_WORKER_URL}/icon?url=${domain}`,
        ] : []),
        // 2. DuckDuckGo's favicon service (reliable, no ORB issues)
        `https://icons.duckduckgo.com/ip3/${domain}.ico`,
        `https://icons.duckduckgo.com/ip2/${domain}.ico`,
        `https://icons.duckduckgo.com/ip/${domain}.ico`,
        // 3. Google favicon service (reliable, no ORB issues)
        `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
        // Additional services (all handle CORS properly)
        `https://icon.horse/icon/${domain}`,
        `https://icon.horse/icon/https://${domain}`,
        `https://favicon.vemetric.com/${domain}`,
        `https://fetchfavicon.com/i/${domain}`,
        `https://ico.faviconkit.net/favicon/${domain}`,
        `https://favicone.com/${domain}`,
      ]
    }

    // Load favicon via proxy server
    // Global request tracking to prevent duplicates across all Avatar instances
    if (!window.__faviconRequests) {
      window.__faviconRequests = new Map()
    }
    const ongoingRequests = window.__faviconRequests
    
    // Load favicon - try all URLs in parallel
    const loadFavicon = async () => {
      if (!domain.value || faviconError.value) {
        tryingFavicon.value = false
        return
      }

      // Prevent duplicate concurrent requests for the same domain (global check)
      if (ongoingRequests.has(domain.value)) {
        // Wait for the existing request to complete
        const existingPromise = ongoingRequests.get(domain.value)
        if (existingPromise instanceof Promise) {
          try {
            await existingPromise
            // Check if favicon was loaded by the other request
            if (faviconLoaded.value && faviconUrl.value) {
              return
            }
          } catch {
            // Other request failed, continue to try Libravatar
          }
        }
        return
      }

      tryingFavicon.value = true
      hasImg.value = true // Set to true so Libravatar can show while trying favicons
      
      // Create a promise for this request and store it globally
      const requestPromise = (async () => {
        const urls = getFaviconUrls(domain.value)
        if (!urls.length) {
          return false
        }

        // Try all URLs in parallel
        const promises = urls.map(url => 
          tryLoadImage(url, 2000)
            .then(result => ({ success: true, url: result }))
            .catch(() => ({ success: false }))
        )
        
        // Wait for all promises and find first success
        const results = await Promise.allSettled(promises)
        for (const result of results) {
          if (result.status === 'fulfilled') {
            const value = result.value
            if (value && value.success && value.url) {
              faviconUrl.value = value.url
              faviconLoaded.value = true
              tryingFavicon.value = false
              currentFaviconUrl.value = null
              return true
            }
          }
        }

        return false
      })()
      
      ongoingRequests.set(domain.value, requestPromise)

      try {
        const success = await requestPromise
        if (success) {
          // Favicon loaded successfully
          return
        }
      } catch (error) {
        // Request failed
        console.debug('[Avatar] Favicon loading failed:', error)
      } finally {
        // Always clear the ongoing request flag after a delay
        setTimeout(() => {
          ongoingRequests.delete(domain.value)
        }, 1000)
      }

      // Favicon failed, fall back to Libravatar
      faviconError.value = true
      tryingFavicon.value = false
      // hasImg is already true, so Libravatar will be shown
    }

    // Handle image error - try Libravatar if favicon failed
    const handleImageError = () => {
      if (faviconLoaded.value && faviconUrl.value) {
        // Favicon loaded but failed to display, try Libravatar
        faviconLoaded.value = false
        faviconUrl.value = null
        hasImg.value = true // Try Libravatar
      } else {
        // Libravatar also failed, show initials
        hasImg.value = false
      }
    }

    // Watch for email changes to reload favicon
    watch(() => props.email, () => {
      faviconUrl.value = null
      faviconLoaded.value = false
      faviconError.value = false
      tryingFavicon.value = false
      currentFaviconUrl.value = null
      hasImg.value = false
      if (domain.value) {
        // Has domain, try favicon first
        loadFavicon()
      } else {
        // No domain, try Libravatar immediately
        hasImg.value = true
      }
    }, { immediate: true })

    onMounted(() => {
      if (domain.value) {
        // Has domain, try favicon first
        loadFavicon()
      } else {
        // No domain, try Libravatar immediately
        hasImg.value = true
      }
    })

    const hash = computed(() => {
      return (props.email || "").trim() ? md5((props.email || "").trim().toLowerCase()) : ""
    })

    const libravatarUrl = computed(() => {
      return hash.value ? `https://seccdn.libravatar.org/avatar/${hash.value}?d=404&s=80` : ""
    })

    // Use favicon if available, otherwise use Libravatar
    const url = computed(() => {
      if (faviconLoaded.value && faviconUrl.value) {
        return faviconUrl.value
      }
      // Return Libravatar URL (while trying favicons, on error, or no domain)
      return libravatarUrl.value
    })

    const initials = computed(() => {
      const src = (props.name || "").trim() || (props.email || "").trim()
      if (!src) return "?"
      const parts = src.replace(/\s+/g, " ").split(" ")
      if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase()
      return src[0].toUpperCase()
    })

    const backgroundColor = computed(() => {
      const source = props.email || props.name || 'x'
      const hash = Math.abs(source.split('').reduce((h, c) => ((h * 31 + c.charCodeAt(0)) >>> 0), 0))
      const hue = hash % 360
      return `hsl(${hue} 40% 25%)`
    })

    // Determine if we're showing a favicon (not Libravatar or initials)
    const isShowingFavicon = computed(() => {
      return faviconLoaded.value && faviconUrl.value
    })

    // Background color: white/light for favicons, colored for initials
    const avatarBackground = computed(() => {
      if (isShowingFavicon.value) {
        return '#ffffff' // White background for favicons
      }
      return backgroundColor.value // Colored background for initials
    })

    return {
      hasImg,
      hash,
      url,
      initials,
      backgroundColor,
      avatarBackground,
      faviconUrl,
      faviconLoaded,
      handleImageError
    }
  }
}
</script>

<template>
  <div class="avatar" :style="{ background: avatarBackground }">
    <img 
      v-if="hasImg && url" 
      :src="url" 
      referrerpolicy="no-referrer" 
      @error="handleImageError" 
    />
    <span v-else>{{ initials }}</span>
  </div>
</template>

<style scoped>
.avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: #22273a;
  color: #cfd5e6;
  font-weight: 700;
  font-size: 12px;
  user-select: none;
}

.avatar img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}
</style>
