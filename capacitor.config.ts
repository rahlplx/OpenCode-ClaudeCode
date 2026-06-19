import type { CapacitorConfig } from '@capacitor/cli';

// Set OPENCODE_SERVER_URL at build time to point the APK at your self-hosted instance.
// Example: OPENCODE_SERVER_URL=https://opencode.example.com pnpm build:android
const serverUrl = process.env.OPENCODE_SERVER_URL;

const config: CapacitorConfig = {
  appId: 'com.opencode.claudecode',
  appName: 'OpenCode',
  webDir: serverUrl ? 'dist' : 'android-no-server',
  server: serverUrl
    ? {
        url: serverUrl,
        // Only allow cleartext (HTTP) if the URL is explicitly http://
        cleartext: serverUrl.startsWith('http://'),
      }
    : undefined,
};

export default config;
