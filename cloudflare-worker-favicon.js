/**
 * Cloudflare Worker for Favicon Proxy
 * 
 * Usage:
 * - GET /?url=example.com
 * - GET /?url=https://example.com
 * - GET /icon?url=example.com
 * - GET /example.com
 * 
 * This worker fetches favicons from domains and serves them with proper CORS headers.
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    
    // Extract domain from query parameter or path
    let domain = url.searchParams.get('url') || url.pathname.slice(1)
    
    // Remove leading/trailing slashes and whitespace
    domain = domain.replace(/^\/+|\/+$/g, '').trim()
    
    // If no domain provided, return error
    if (!domain) {
      return new Response('Missing domain parameter. Usage: /?url=example.com', {
        status: 400,
        headers: { 'Content-Type': 'text/plain' }
      })
    }
    
    // Normalize domain (remove protocol if present, add https://)
    if (domain.startsWith('http://') || domain.startsWith('https://')) {
      domain = domain.replace(/^https?:\/\//, '')
    }
    
    // Remove trailing slash
    domain = domain.replace(/\/$/, '')
    
    // Build base URLs to try
    const baseUrls = [
      `https://${domain}`,
      `https://www.${domain}`,
    ]
    
    // Common favicon paths
    const faviconPaths = [
      '/favicon.ico',
      '/favicon.png',
      '/favicon.svg',
      '/apple-touch-icon.png',
      '/icon.png',
      '/favicon-32x32.png',
      '/favicon-16x16.png',
    ]
    
    // Try to fetch favicon from domain
    for (const baseUrl of baseUrls) {
      for (const path of faviconPaths) {
        const faviconUrl = `${baseUrl}${path}`
        
        try {
          const response = await fetch(faviconUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
            cf: {
              cacheTtl: 86400, // Cache for 24 hours
              cacheEverything: true,
            }
          })
          
          // Check if response is successful and is an image
          if (response.ok) {
            const contentType = response.headers.get('content-type') || ''
            
            // Verify it's an image
            if (contentType.startsWith('image/') || path.endsWith('.ico')) {
              // Clone response to modify headers
              const headers = new Headers(response.headers)
              
              // Set CORS headers
              headers.set('Access-Control-Allow-Origin', '*')
              headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
              headers.set('Access-Control-Allow-Headers', 'Content-Type')
              headers.set('Access-Control-Max-Age', '86400')
              
              // Ensure content-type is set
              if (!headers.has('content-type')) {
                if (path.endsWith('.ico')) {
                  headers.set('content-type', 'image/x-icon')
                } else if (path.endsWith('.png')) {
                  headers.set('content-type', 'image/png')
                } else if (path.endsWith('.svg')) {
                  headers.set('content-type', 'image/svg+xml')
                }
              }
              
              // Cache headers
              headers.set('Cache-Control', 'public, max-age=86400')
              
              return new Response(response.body, {
                status: response.status,
                headers: headers
              })
            }
          }
        } catch (error) {
          // Continue to next URL
          continue
        }
      }
    }
    
    // If no favicon found, try fallback services
    const fallbackServices = [
      `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
      `https://icons.duckduckgo.com/ip3/${domain}.ico`,
    ]
    
    for (const serviceUrl of fallbackServices) {
      try {
        const response = await fetch(serviceUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
          cf: {
            cacheTtl: 86400,
            cacheEverything: true,
          }
        })
        
        if (response.ok) {
          const headers = new Headers(response.headers)
          headers.set('Access-Control-Allow-Origin', '*')
          headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
          headers.set('Access-Control-Allow-Headers', 'Content-Type')
          headers.set('Access-Control-Max-Age', '86400')
          headers.set('Cache-Control', 'public, max-age=86400')
          
          return new Response(response.body, {
            status: response.status,
            headers: headers
          })
        }
      } catch (error) {
        continue
      }
    }
    
    // Return 404 if no favicon found
    return new Response('Favicon not found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
      }
    })
  },
  
  async handleOptions(request) {
    // Handle CORS preflight requests
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      }
    })
  }
}
