# Cloudflare Worker Favicon Proxy

A Cloudflare Worker that proxies favicon requests, handling CORS issues and providing fallback services.

## Features

- ✅ Fetches favicons directly from domains
- ✅ Handles CORS headers automatically
- ✅ Tries multiple favicon paths (`/favicon.ico`, `/favicon.png`, etc.)
- ✅ Falls back to Google and DuckDuckGo favicon services
- ✅ Caches responses for 24 hours
- ✅ Supports multiple URL patterns

## Deployment

### Prerequisites

1. Install Wrangler CLI:
```bash
npm install -g wrangler
```

2. Login to Cloudflare:
```bash
wrangler login
```

### Deploy

1. Update `wrangler.toml` with your account ID (optional, can be set via CLI)

2. Deploy the worker:
```bash
wrangler deploy
```

3. The worker will be available at: `https://favicon-proxy.YOUR_SUBDOMAIN.workers.dev`

## Usage

### URL Patterns

The worker accepts favicon requests in multiple formats:

```
GET /?url=example.com
GET /?url=https://example.com
GET /icon?url=example.com
GET /example.com
```

### Examples

```javascript
// In your Avatar.vue component
const faviconUrl = `https://favicon-proxy.YOUR_SUBDOMAIN.workers.dev/?url=${domain}`
```

Or update the Avatar.vue to use your worker:

```javascript
const allServices = [
  `https://favicon-proxy.YOUR_SUBDOMAIN.workers.dev/?url=${domain.value}`,
  // ... other services
]
```

## Configuration

### Custom Domain

To use a custom domain, add a route in `wrangler.toml`:

```toml
routes = [
  { pattern = "favicon.yourdomain.com/*", zone_name = "yourdomain.com" }
]
```

Then update your Avatar.vue:

```javascript
`https://favicon.yourdomain.com/?url=${domain.value}`
```

### Cache Settings

The worker caches responses for 24 hours (86400 seconds). To change this, modify the `cacheTtl` value in `cloudflare-worker-favicon.js`:

```javascript
cf: {
  cacheTtl: 86400, // Change this value (in seconds)
  cacheEverything: true,
}
```

## How It Works

1. **Direct Fetch**: Tries to fetch favicon directly from the domain using common paths
2. **Fallback Services**: If direct fetch fails, tries Google and DuckDuckGo favicon services
3. **CORS Headers**: Automatically adds CORS headers to all responses
4. **Caching**: Caches successful responses for 24 hours

## Testing

Test locally with Wrangler:

```bash
wrangler dev
```

Then visit: `http://localhost:8787/?url=example.com`

## Troubleshooting

### Worker not finding favicons

- Check that the domain is accessible
- Verify the domain doesn't block Cloudflare IPs
- Try accessing the favicon URL directly in a browser

### CORS errors

The worker automatically adds CORS headers. If you still see errors, check:
- The worker URL is correct
- The request is using GET method
- No custom headers are being sent that might trigger preflight

## License

Same as the main project.
