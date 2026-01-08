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

    // Load favicon via proxy server
    // Global request tracking to prevent duplicates across all Avatar instances
    if (!window.__faviconRequests) {
      window.__faviconRequests = new Map()
    }
    const ongoingRequests = window.__faviconRequests
    
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
      
      // Create a promise for this request and store it globally
      const requestPromise = (async () => {
        // Client-side favicon fetching - try ALL possible favicon URLs
        // Generate comprehensive list of favicon paths to try
        const baseUrls = [
          `https://${domain.value}`,
          `https://www.${domain.value}`,
        ]
        
        const faviconPaths = [
          '/favicon.ico',
          '/favicon.png',
          '/favicon.svg',
          '/favicon.jpg',
          '/favicon.jpeg',
          '/favicon.gif',
          '/favicon.ico?1',
          '/favicon.ico?v=1',
          '/favicon.ico?v=2',
          '/favicon.ico?version=1',
          '/apple-touch-icon.png',
          '/apple-touch-icon-precomposed.png',
          '/apple-touch-icon-57x57.png',
          '/apple-touch-icon-60x60.png',
          '/apple-touch-icon-72x72.png',
          '/apple-touch-icon-76x76.png',
          '/apple-touch-icon-114x114.png',
          '/apple-touch-icon-120x120.png',
          '/apple-touch-icon-144x144.png',
          '/apple-touch-icon-152x152.png',
          '/apple-touch-icon-180x180.png',
          '/icon.png',
          '/icon.ico',
          '/icons/favicon.ico',
          '/icons/favicon.png',
          '/images/favicon.ico',
          '/images/favicon.png',
          '/img/favicon.ico',
          '/img/favicon.png',
          '/static/favicon.ico',
          '/static/favicon.png',
          '/assets/favicon.ico',
          '/assets/favicon.png',
          '/favicon-16x16.png',
          '/favicon-32x32.png',
          '/favicon-96x96.png',
          '/favicon-192x192.png',
        ]
        
        // Build comprehensive list of favicon URLs
        const faviconUrls = []
        
        // Add all base URL + path combinations
        for (const baseUrl of baseUrls) {
          for (const path of faviconPaths) {
            faviconUrls.push(`${baseUrl}${path}`)
          }
        }
        
        // Add favicon services (these are usually reliable fallbacks)
        faviconUrls.push(
          `https://www.google.com/s2/favicons?domain=${domain.value}&sz=64`,
          `https://www.google.com/s2/favicons?domain=${domain.value}&sz=128`,
          `https://icons.duckduckgo.com/ip3/${domain.value}.ico`,
          `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain.value}&size=64`,
          `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://${domain.value}&size=64`,
        )

        // Try each favicon URL sequentially
        // Use shorter timeout per URL since we're trying many URLs
        for (const url of faviconUrls) {
          try {
            currentFaviconUrl.value = url
            const img = new Image()
            const loadPromise = new Promise((resolve, reject) => {
              img.onload = () => resolve(url)
              img.onerror = () => reject(new Error('Failed to load'))
              // No crossOrigin needed - we're just displaying, not reading pixel data
              img.src = url
              // Shorter timeout (2 seconds) since we're trying many URLs
              setTimeout(() => reject(new Error('Timeout')), 2000)
            })

            const loadedUrl = await loadPromise
            // Success! Use this favicon URL directly
            faviconUrl.value = loadedUrl
            faviconLoaded.value = true
            hasImg.value = true
            tryingFavicon.value = false
            currentFaviconUrl.value = null
            return true
          } catch {
            // Try next URL
            continue
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
      } catch {
        // Request failed
      } finally {
        // Always clear the ongoing request flag after a delay
        setTimeout(() => {
          ongoingRequests.delete(domain.value)
        }, 1000)
      }

      // Proxy failed, try Libravatar
      faviconError.value = true
      tryingFavicon.value = false
      hasImg.value = true // Now try Libravatar
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
      // While trying favicon, show the current URL being tried
      if (tryingFavicon.value && currentFaviconUrl.value) {
        return currentFaviconUrl.value
      }
      // Return Libravatar URL if favicon failed or no domain
      if (faviconError.value || !domain.value) {
        return libravatarUrl.value
      }
      return null
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
