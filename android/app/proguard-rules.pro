# Preserve source info for crash diagnostics
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# ── Capacitor bridge ──────────────────────────────────────────────────────────
# Keep all Capacitor classes — the WebView JS bridge reflects into these
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * {
    @com.getcapacitor.annotation.Permission *;
    @com.getcapacitor.annotation.PluginMethod public *;
}
-keep public class * extends com.getcapacitor.Plugin { *; }

# ── Cordova plugins ───────────────────────────────────────────────────────────
-keep class org.apache.cordova.** { *; }
-keep public class * extends org.apache.cordova.CordovaPlugin { *; }

# ── App entry point ───────────────────────────────────────────────────────────
-keep class com.opencode.claudecode.MainActivity { *; }

# ── WebView JavaScript interface ──────────────────────────────────────────────
# Any method annotated @JavascriptInterface must survive shrinking
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ── AndroidX / support library ────────────────────────────────────────────────
-keep class androidx.core.app.CoreComponentFactory { *; }
-dontwarn androidx.**

# ── Kotlin (transitive dep of Capacitor) ─────────────────────────────────────
-dontwarn kotlin.**
-keep class kotlin.Metadata { *; }
