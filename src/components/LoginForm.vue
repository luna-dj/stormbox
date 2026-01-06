<script>
import { ref, onMounted } from 'vue'

const STORAGE_KEY_USERNAME = 'thundermail_remember_username'
const STORAGE_KEY_PASSWORD = 'thundermail_remember_password'
const STORAGE_KEY_REMEMBER = 'thundermail_remember_me'

export default {
  name: 'LoginForm',
  props: {
    connected: Boolean,
    status: String,
    error: String
  },
  emits: ['connect'],
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

    const handleKeydown = (e) => {
      if (e.key === 'Enter') {
        connect()
      }
    }

    return {
      username,
      password,
      rememberMe,
      connect,
      handleKeydown
    }
  }
}
</script>

<template>
  <section id="auth" v-if="!connected">
    <div class="card">
      <img class="logo" src="https://www.thunderbird.net/media/svg/logo.svg" alt="Thunderbird logo">
      <h1>Thundermail</h1>
      <div class="sub">Sign in with your username and app password.</div>
      <div class="row">
        <input v-model.trim="username" placeholder="Username" autocomplete="username" @keydown="handleKeydown" />
        <input v-model="password" placeholder="App password" type="password" autocomplete="current-password" @keydown="handleKeydown" />
        <label class="remember-me">
          <input type="checkbox" v-model="rememberMe" />
          <span>Remember me</span>
        </label>
        <button @click="connect" :disabled="!username.trim() || !password">Connect</button>
      </div>
      <div id="authMeta" class="meta">{{ status }}</div>
      <div id="authErr" class="err" v-if="error">{{ error }}</div>
    </div>
  </section>
</template>

<style scoped>
#auth {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.card {
  width: min(460px, 92vw);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 22px 22px 18px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, .35);
}

.logo {
  display: block;
  margin: 2px auto 10px;
  width: 84px;
  height: auto;
}

h1 {
  margin: 0 0 6px 0;
  font-size: 26px;
  text-align: center;
}

.sub {
  color: var(--muted);
  font-size: 12px;
  margin-bottom: 14px;
  text-align: center;
}

.row {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  margin-bottom: 8px;
}

input {
  padding: .65rem .8rem;
  border: 1px solid var(--border);
  border-radius: .6rem;
  background: var(--panel2);
  color: var(--text);
}

.remember-me {
  display: flex;
  align-items: center;
  gap: 0.5rem;
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

button {
  padding: .7rem .95rem;
  border: 0;
  border-radius: .6rem;
  background: var(--accent);
  color: #fff;
  cursor: pointer;
  width: 100%;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.meta {
  color: var(--muted);
  font-size: 12px;
  margin-top: 6px;
  text-align: center;
}

.err {
  color: #ff6b6b;
  white-space: pre-wrap;
  font-size: 13px;
  margin-top: 6px;
  text-align: center;
}
</style>
