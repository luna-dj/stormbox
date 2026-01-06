<script>
import { ref, onMounted } from 'vue'

const STORAGE_KEY_USERNAME = 'thundermail_remember_username'
const STORAGE_KEY_PASSWORD = 'thundermail_remember_password'
const STORAGE_KEY_REMEMBER = 'thundermail_remember_me'

export default {
  name: 'LoginForm',
  props: {
    connected: Boolean,
    visible: Boolean,
    canCancel: Boolean,
    status: String,
    error: String
  },
  emits: ['connect', 'cancel'],
  setup(props, { emit }) {
    const username = ref('')
    const password = ref('')
    const rememberMe = ref(false)

    // Load saved credentials on mount
    onMounted(() => {
      const savedRemember = localStorage.getItem(STORAGE_KEY_REMEMBER) === 'true'
      rememberMe.value = savedRemember
      
      if (savedRemember) {
        const savedUsername = localStorage.getItem(STORAGE_KEY_USERNAME)
        const savedPassword = localStorage.getItem(STORAGE_KEY_PASSWORD)
        
        if (savedUsername) {
          username.value = savedUsername
        }
        if (savedPassword) {
          password.value = savedPassword
        }
      }
    })

    const connect = () => {
      if (!username.value.trim() || !password.value) {
        return
      }
      
      // Save or clear credentials based on remember me checkbox
      if (rememberMe.value) {
        localStorage.setItem(STORAGE_KEY_USERNAME, username.value.trim())
        localStorage.setItem(STORAGE_KEY_PASSWORD, password.value)
        localStorage.setItem(STORAGE_KEY_REMEMBER, 'true')
      } else {
        localStorage.removeItem(STORAGE_KEY_USERNAME)
        localStorage.removeItem(STORAGE_KEY_PASSWORD)
        localStorage.removeItem(STORAGE_KEY_REMEMBER)
      }
      
      emit('connect', { username: username.value, password: password.value })
    }

    return {
      username,
      password,
      rememberMe,
      connect
    }
  }
}
</script>

<template>
  <section id="auth" v-if="visible ?? !connected">
    <div class="auth-shell">
      <div class="auth-panel">
        <aside class="auth-hero">
          <div class="brand-row">
            <div class="logo-wrap">
              <img class="logo" src="https://www.thunderbird.net/media/svg/logo.svg" alt="Thunderbird logo">
            </div>
            <div class="brand-text">
              <p class="brand-kicker">Hivepost</p>
              <p class="brand-title">Mail Console</p>
            </div>
          </div>
          <h2>{{ canCancel ? 'New session' : 'Welcome back' }}</h2>
          <p class="hero-copy">
            Connect with an app password. Each session stays isolated, so accounts never mix.
          </p>
          <div class="hero-chips">
            <span>Mail</span>
            <span>Contacts</span>
            <span>Calendar</span>
          </div>
        </aside>
        <form class="auth-form" @submit.prevent="connect">
          <div class="form-head">
            <p class="form-kicker">{{ canCancel ? 'Add account' : 'Secure login' }}</p>
            <h1>{{ canCancel ? 'Create a new login session' : 'Sign in to Hivepost' }}</h1>
            <p class="sub">Use your full email address and an app password.</p>
          </div>
          <label class="field">
            <span>Email address</span>
            <input v-model.trim="username" placeholder="name@hivepost.nl" autocomplete="username" />
          </label>
          <label class="field">
            <span>App password</span>
            <input v-model="password" placeholder="••••••••" type="password" autocomplete="current-password" />
          </label>
          <label class="remember-me">
            <input type="checkbox" v-model="rememberMe" />
            <span>Remember this device</span>
          </label>
          <div class="actions">
            <button type="submit" class="primary" :disabled="!username.trim() || !password">Connect</button>
            <button v-if="canCancel" type="button" class="ghost" @click="$emit('cancel')">Cancel</button>
          </div>
          <div class="form-meta">
            <div id="authMeta" class="meta">{{ status }}</div>
            <div id="authErr" class="err" v-if="error">{{ error }}</div>
          </div>
        </form>
      </div>
    </div>
  </section>
</template>

<style scoped>
@import url("https://fonts.googleapis.com/css2?family=Fraunces:wght@600;700&family=Space+Grotesk:wght@400;500;600&display=swap");

#auth {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px;
  overflow: auto;
  z-index: 1000;
  background:
    linear-gradient(
      165deg,
      #2f6fa6 0%,
      #3b78a8 16%,
      #7a4d6a 32%,
      #4b3f52 48%,
      #6a3e4e 64%,
      #4a3f78 80%,
      #7a2f5a 100%
    );
  backdrop-filter: blur(14px);
  font-family: "Space Grotesk", "Segoe UI", sans-serif;
}

.auth-shell {
  width: min(980px, 100%);
  position: relative;
  z-index: 1;
}

.auth-shell::before {
  content: "";
  position: absolute;
  inset: -20px;
  border-radius: 28px;
  background-image:
    linear-gradient(120deg, rgba(255, 255, 255, 0.05) 0%, transparent 60%),
    linear-gradient(0deg, rgba(255, 255, 255, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.04) 1px, transparent 1px);
  background-size: auto, 32px 32px, 32px 32px;
  opacity: 0.25;
  pointer-events: none;
}

.auth-panel {
  position: relative;
  display: grid;
  grid-template-columns: minmax(240px, 1.05fr) minmax(320px, 1fr);
  gap: 24px;
  padding: 22px;
  border-radius: 22px;
  border: 1px solid var(--border);
  background: linear-gradient(150deg, rgba(17, 19, 26, 0.96), rgba(11, 12, 15, 0.96));
  box-shadow: 0 30px 60px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(10px);
}

.auth-hero {
  position: relative;
  padding: 20px;
  border-radius: 18px;
  background: linear-gradient(145deg, rgba(20, 35, 75, 0.9), rgba(9, 12, 18, 0.95));
  border: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.brand-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo-wrap {
  width: 54px;
  height: 54px;
  border-radius: 16px;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.08);
}

.logo {
  width: 34px;
  height: auto;
}

.brand-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.brand-kicker {
  margin: 0;
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.6);
}

.brand-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #f1f5ff;
}

.auth-hero h2 {
  margin: 0;
  font-size: 28px;
  font-family: "Fraunces", serif;
  letter-spacing: 0.01em;
}

.hero-copy {
  margin: 0;
  color: rgba(255, 255, 255, 0.72);
  font-size: 14px;
}

.hero-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.hero-chips span {
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  font-size: 12px;
  color: rgba(255, 255, 255, 0.8);
  letter-spacing: 0.02em;
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 10px 6px 6px;
}

.form-head h1 {
  margin: 0 0 6px;
  font-size: 26px;
  font-family: "Fraunces", serif;
}

.form-kicker {
  margin: 0 0 6px;
  font-size: 12px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
}

.sub {
  color: var(--muted);
  font-size: 13px;
  margin: 0 0 8px;
}

.field {
  display: grid;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}

.field input {
  padding: 0.72rem 0.85rem;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--panel2);
  color: var(--text);
  font-size: 14px;
}

.field input:focus {
  outline: 2px solid rgba(79, 140, 255, 0.35);
  border-color: rgba(79, 140, 255, 0.6);
}

.remember-me {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  font-size: 13px;
  color: var(--text);
  cursor: pointer;
  user-select: none;
}

.remember-me input[type="checkbox"] {
  width: auto;
  margin: 0;
  cursor: pointer;
}

.remember-me span {
  color: var(--muted);
}

.actions {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  align-items: center;
  margin-top: 4px;
}

button {
  padding: 0.75rem 1.1rem;
  border: 0;
  border-radius: 12px;
  background: var(--accent);
  color: #fff;
  cursor: pointer;
  font-weight: 600;
}

button.primary {
  width: 100%;
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.ghost {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text);
}

.ghost:hover {
  background: var(--rowHover);
}

.form-meta {
  margin-top: 4px;
}

.meta {
  color: var(--muted);
  font-size: 12px;
  margin-top: 4px;
}

.err {
  color: #ff6b6b;
  white-space: pre-wrap;
  font-size: 13px;
  margin-top: 6px;
}

@media (max-width: 840px) {
  .auth-panel {
    grid-template-columns: 1fr;
  }

  .actions {
    grid-template-columns: 1fr;
  }
}

</style>
