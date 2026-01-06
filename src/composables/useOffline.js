import { ref, onMounted, onBeforeUnmount } from 'vue'

export function useOffline() {
  const isOnline = ref(navigator.onLine)
  const isLocalMode = ref(false)
  
  const updateOnlineStatus = () => {
    isOnline.value = navigator.onLine
    if (!isOnline.value) {
      isLocalMode.value = true
    }
  }
  
  const enableLocalMode = () => {
    isLocalMode.value = true
    localStorage.setItem('stormbox.localMode', 'true')
  }
  
  const disableLocalMode = () => {
    isLocalMode.value = false
    localStorage.removeItem('stormbox.localMode')
  }
  
  onMounted(() => {
    // Check if local mode was previously enabled
    const savedLocalMode = localStorage.getItem('stormbox.localMode')
    if (savedLocalMode === 'true') {
      isLocalMode.value = true
    }
    
    // Listen for online/offline events
    window.addEventListener('online', updateOnlineStatus)
    window.addEventListener('offline', updateOnlineStatus)
    
    // Initial check
    updateOnlineStatus()
  })
  
  onBeforeUnmount(() => {
    window.removeEventListener('online', updateOnlineStatus)
    window.removeEventListener('offline', updateOnlineStatus)
  })
  
  return {
    isOnline,
    isLocalMode,
    enableLocalMode,
    disableLocalMode
  }
}
