(function () {
  "use strict";

  var DEFAULT_STORAGE_KEY = "course_completed_lessons_v1";
  var DEFAULT_LEGACY_KEY = "completedLessons";

  var state = {
    initialized: false,
    isVkMiniApp: false,
    bridgeReady: false,
    storageMode: "localStorage",
    user: null,
    progress: [],
    storageKey: DEFAULT_STORAGE_KEY,
    legacyStorageKey: DEFAULT_LEGACY_KEY
  };

  function log(message, extra) {
    if (typeof extra === "undefined") {
      console.log("[PlatformAdapter] " + message);
      return;
    }
    console.log("[PlatformAdapter] " + message, extra);
  }

  function parseCompletedRaw(raw) {
    if (!raw) return [];
    try {
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function detectPlatform() {
    var params = new URLSearchParams(window.location.search || "");
    var hasVkParams = params.has("vk_platform") || params.has("vk_app_id") || params.has("sign");
    var hasBridge = Boolean(window.vkBridge && typeof window.vkBridge.send === "function");
    var isVkWebView = Boolean(hasBridge && typeof window.vkBridge.isWebView === "function" && window.vkBridge.isWebView());

    state.isVkMiniApp = hasBridge && (hasVkParams || isVkWebView);
    log("platform detected: " + (state.isVkMiniApp ? "vk-mini-app" : "web-browser"), {
      hasVkParams: hasVkParams,
      isVkWebView: isVkWebView,
      hasBridge: hasBridge
    });

    return state.isVkMiniApp ? "vk" : "web";
  }

  async function initVkBridge() {
    if (!state.isVkMiniApp) return;

    try {
      await window.vkBridge.send("VKWebAppInit");
      state.bridgeReady = true;
      log("VK Bridge initialized");
    } catch (error) {
      state.bridgeReady = false;
      state.isVkMiniApp = false;
      state.storageMode = "localStorage";
      log("VK Bridge init failed, fallback to localStorage", error);
    }
  }

  async function loadVkUser() {
    if (!state.bridgeReady) return null;

    try {
      var user = await window.vkBridge.send("VKWebAppGetUserInfo");
      state.user = user || null;
      log("VK user loaded", state.user ? { id: state.user.id } : null);
      return state.user;
    } catch (error) {
      state.user = null;
      log("VK user unavailable, fallback behavior", error);
      return null;
    }
  }

  function loadLocalProgress() {
    var rawPrimary = localStorage.getItem(state.storageKey);
    var primary = parseCompletedRaw(rawPrimary);
    if (primary.length) {
      state.progress = primary;
      state.storageMode = "localStorage";
      log("progress loaded from localStorage key " + state.storageKey);
      return state.progress;
    }

    var rawLegacy = localStorage.getItem(state.legacyStorageKey);
    state.progress = parseCompletedRaw(rawLegacy);
    state.storageMode = "localStorage";
    log("progress loaded from localStorage key " + state.legacyStorageKey);
    return state.progress;
  }

  async function loadVkProgress() {
    if (!state.bridgeReady) return loadLocalProgress();

    try {
      var response = await window.vkBridge.send("VKWebAppStorageGet", {
        keys: [state.storageKey, state.legacyStorageKey]
      });

      var values = Array.isArray(response && response.keys) ? response.keys : [];
      var primaryItem = values.find(function (item) { return item.key === state.storageKey; });
      var legacyItem = values.find(function (item) { return item.key === state.legacyStorageKey; });

      var primary = parseCompletedRaw(primaryItem && primaryItem.value);
      var legacy = parseCompletedRaw(legacyItem && legacyItem.value);

      state.progress = primary.length ? primary : legacy;
      state.storageMode = "vkStorage";
      log("progress loaded from VK storage");

      if (state.progress.length) {
        localStorage.setItem(state.storageKey, JSON.stringify(state.progress));
        localStorage.setItem(state.legacyStorageKey, JSON.stringify(state.progress));
      }

      return state.progress;
    } catch (error) {
      log("VK storage read failed, fallback to localStorage", error);
      return loadLocalProgress();
    }
  }

  async function setProgress(ids) {
    var clean = Array.from(new Set(ids));
    state.progress = clean;

    if (state.bridgeReady && state.isVkMiniApp) {
      try {
        var raw = JSON.stringify(clean);
        await window.vkBridge.send("VKWebAppStorageSet", { key: state.storageKey, value: raw });
        await window.vkBridge.send("VKWebAppStorageSet", { key: state.legacyStorageKey, value: raw });
        state.storageMode = "vkStorage";
        log("progress saved to VK storage");
      } catch (error) {
        log("VK storage write failed, fallback to localStorage", error);
        localStorage.setItem(state.storageKey, JSON.stringify(clean));
        localStorage.setItem(state.legacyStorageKey, JSON.stringify(clean));
        state.storageMode = "localStorage";
      }
      return clean;
    }

    localStorage.setItem(state.storageKey, JSON.stringify(clean));
    localStorage.setItem(state.legacyStorageKey, JSON.stringify(clean));
    state.storageMode = "localStorage";
    log("progress saved to localStorage");
    return clean;
  }

  async function init(options) {
    var settings = options || {};
    state.storageKey = settings.storageKey || DEFAULT_STORAGE_KEY;
    state.legacyStorageKey = settings.legacyStorageKey || DEFAULT_LEGACY_KEY;

    detectPlatform();
    await initVkBridge();

    if (state.isVkMiniApp && state.bridgeReady) {
      await loadVkUser();
      await loadVkProgress();

      if (!state.progress.length) {
        var localProgress = loadLocalProgress();
        if (localProgress.length) {
          await setProgress(localProgress);
          log("VK storage hydrated from existing localStorage progress");
        }
      }
    } else {
      loadLocalProgress();
    }

    state.initialized = true;
    return {
      platform: state.isVkMiniApp ? "vk" : "web",
      storage: state.storageMode,
      user: state.user
    };
  }

  function getPlatformUser() {
    return state.user;
  }

  function getProgress() {
    return Array.isArray(state.progress) ? state.progress.slice() : [];
  }

  function getStorageSource() {
    return state.storageMode;
  }

  window.PlatformAdapter = {
    init: init,
    detectPlatform: detectPlatform,
    getPlatformUser: getPlatformUser,
    getProgress: getProgress,
    setProgress: setProgress,
    getStorageSource: getStorageSource
  };
})();
