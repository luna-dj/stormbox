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

    // Get favicon URLs - try direct paths first (no CORS issues), then services
    const getFaviconUrls = (domain) => {
      if (!domain) return []
      const base = `https://${domain}`
      return [
        // Direct paths first - no CORS issues
        `${base}/favicon.ico`,
        `${base}/favicon.png`,
        `${base}/apple-touch-icon.png`,
        `${base}/apple-touch-icon-precomposed.png`,
        `${base}/icon.png`,
        `${base}/icons/favicon.ico`,
        `${base}/images/favicon.ico`,
        `${base}/static/favicon.ico`,
        `${base}/assets/favicon.ico`,
        `${base}/img/favicon.ico`,
        `${base}/favicon-32x32.png`,
        `${base}/favicon-16x16.png`,
        `${base}/favicon.svg`,
        `${base}/favicon/favicon.ico`,
        `${base}/favicon/favicon.png`,
        // Then try DuckDuckGo's favicon service (more reliable than Google)
        `https://icons.duckduckgo.com/ip3/${domain}.ico`,
      ]
    }

    // Load favicon - try all common paths
    const loadFavicon = async () => {
      if (!domain.value || faviconError.value) {
        tryingFavicon.value = false
        return
      }
      
      const urls = getFaviconUrls(domain.value)
      if (!urls.length) {
        tryingFavicon.value = false
        return
      }

      tryingFavicon.value = true

      // Try each URL in sequence
      let currentIndex = 0
      
      const tryNextUrl = () => {
        if (currentIndex >= urls.length) {
          // All URLs failed, try Libravatar
          faviconError.value = true
          tryingFavicon.value = false
          hasImg.value = true // Now try Libravatar
          return
        }

        const url = urls[currentIndex]
        currentFaviconUrl.value = url
        hasImg.value = true // Show image while trying
        
        const img = new Image()
        
        // Set a timeout to prevent waiting too long
        const timeout = setTimeout(() => {
          currentIndex++
          tryNextUrl()
        }, 2000) // 2 second timeout per URL
        
        img.onload = () => {
          clearTimeout(timeout)
          if (!faviconLoaded.value) {
            faviconUrl.value = url
            faviconLoaded.value = true
            hasImg.value = true
            tryingFavicon.value = false
            currentFaviconUrl.value = null
          }
        }
        
        img.onerror = () => {
          clearTimeout(timeout)
          currentFaviconUrl.value = null
          currentIndex++
          tryNextUrl()
        }
        
        img.src = url
      }

      tryNextUrl()
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
