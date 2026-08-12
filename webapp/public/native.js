/**
 * The Capacitor bridge -- everything here is a no-op on the ordinary web.
 *
 * window.Capacitor only exists when this page is running inside the native
 * wrapper (see ../capacitor.config.json). A browser visitor never loads any
 * of the plugin code below; the very first line decides that.
 *
 * Three things happen here, and nothing else:
 *   1. Hide the native splash screen once the real page has painted.
 *   2. Set the native status bar to match the app's cream background.
 *   3. Ask for push permission and hand the resulting device token to
 *      POST /api/push/native-register, so lib/push.js has somewhere to
 *      eventually deliver to (see the schema comment there for what's
 *      still missing before delivery itself works: an APNs key, an FCM
 *      service account -- neither of which exists yet).
 *
 * Deliberately NOT wired here: native background geolocation. The existing
 * workout GPS flow already works via the browser Geolocation API through the
 * WebView, and swapping it for @capacitor/geolocation's background-capable
 * path touches real fitness-tracking logic (lib/segments.js, the live
 * workout recorder) that deserves its own careful pass, not a bolt-on here.
 * The plugin is installed and ready; NATIVE.md tracks this as the next step.
 */
'use strict';

(function () {
  if (!window.Capacitor || !window.Capacitor.isNativePlatform || !window.Capacitor.isNativePlatform()) return;

  var Plugins = window.Capacitor.Plugins || {};

  // --- splash + status bar --------------------------------------------------
  function settleChrome() {
    try { Plugins.SplashScreen && Plugins.SplashScreen.hide(); } catch (e) { /* plugin not present on this platform build */ }
    try {
      Plugins.StatusBar && Plugins.StatusBar.setBackgroundColor && Plugins.StatusBar.setBackgroundColor({ color: '#f6efdf' });
      Plugins.StatusBar && Plugins.StatusBar.setStyle && Plugins.StatusBar.setStyle({ style: 'DARK' });
    } catch (e) { /* Android-only APIs some builds omit; never fatal */ }
  }
  if (document.readyState === 'complete') settleChrome();
  else window.addEventListener('load', settleChrome, { once: true });

  // --- push registration -----------------------------------------------------
  var PushNotifications = Plugins.PushNotifications;
  if (!PushNotifications) return;

  function platform() {
    return (window.Capacitor.getPlatform && window.Capacitor.getPlatform()) || 'ios';
  }

  // Only after the member is actually signed in -- registering a token for
  // no one to notify is pointless, and the backend route requires a session.
  function registerWhenSignedIn() {
    if (!window.state || !window.state.me || !window.state.me.user) {
      setTimeout(registerWhenSignedIn, 2000);
      return;
    }
    requestAndRegister();
  }

  async function requestAndRegister() {
    try {
      var perm = await PushNotifications.checkPermissions();
      if (perm.receive !== 'granted') {
        perm = await PushNotifications.requestPermissions();
      }
      if (perm.receive !== 'granted') return; // declined -- respect it, don't ask again this session

      PushNotifications.addListener('registration', function (token) {
        api('/push/native-register', {
          method: 'POST',
          body: { platform: platform(), token: token.value, categories: undefined },
        }).catch(function () { /* best-effort -- the in-app bell still works */ });
      });

      PushNotifications.addListener('registrationError', function () {
        // Registration can fail (simulator, no APNs entitlement in a dev
        // build, network). Nothing to recover -- the app works without it.
      });

      PushNotifications.addListener('pushNotificationActionPerformed', function (action) {
        var url = action && action.notification && action.notification.data && action.notification.data.url;
        if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')) {
          location.href = url;
        }
      });

      await PushNotifications.register();
    } catch (e) {
      console.warn('[native] push registration skipped:', e && e.message);
    }
  }

  registerWhenSignedIn();
})();
