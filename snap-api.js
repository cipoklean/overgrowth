/*! @snap/web-lens-api v0.1.2 | Copyright © 2026 Snap Inc. | MIT License */
"use strict";
(() => {
  // src/errors.ts
  var errors = Object.freeze({
    MALFORMED_REQUEST: "ERR_MALFORMED_REQUEST",
    UNKNOWN_CAPABILITY: "ERR_UNKNOWN_CAPABILITY",
    INVALID_PARAMS: "ERR_INVALID_PARAMS",
    INTERNAL: "ERR_INTERNAL",
    QUOTA_EXCEEDED: "ERR_QUOTA_EXCEEDED",
    STORAGE_UNAVAILABLE: "ERR_STORAGE_UNAVAILABLE",
    UNSUPPORTED_HOST: "ERR_UNSUPPORTED_HOST"
  });
  function bridgeError(code) {
    return new Error(code);
  }
  function normalizeRejection(reason) {
    const message = reason && typeof reason.message === "string" ? reason.message : typeof reason === "string" ? reason : "";
    return bridgeError(message.indexOf("ERR_") === 0 ? message : errors.INTERNAL);
  }

  // src/stub.ts
  var STUB_VARIANTS = ["10226807", "20061402", "31151407", "30060626"];
  var PNG_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  var GLB_URL = "data:model/gltf-binary;base64,Z2xURgIAAABgAAAATAAAAEpTT057ImFzc2V0Ijp7InZlcnNpb24iOiIyLjAifSwic2NlbmUiOjAsInNjZW5lcyI6W3sibm9kZXMiOlswXX1dLCJub2RlcyI6W3t9XX0g";
  var STORAGE_LIMITS = { byteLimit: 100 * 1024, keyLimit: 256, valueLimit: 32 * 1024, keyLengthLimit: 256 };
  var ok = (value) => Promise.resolve(value);
  var fail = (code) => Promise.reject(bridgeError(code));
  var isNonEmptyString = (v) => typeof v === "string" && v.length > 0;
  var isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  var hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  function utf8Length(s) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s).length;
    return encodeURIComponent(s).replace(/%[0-9A-F]{2}/g, "x").length;
  }
  var jsonBytes = (v) => utf8Length(JSON.stringify(v));
  var isValidKey = (k) => isNonEmptyString(k) && utf8Length(k) <= STORAGE_LIMITS.keyLengthLimit;
  function hasExactly(params, keys) {
    const own = Object.keys(params);
    return own.length === keys.length && keys.every((k) => hasOwn(params, k));
  }
  function createStub() {
    let store = /* @__PURE__ */ new Map();
    let storeBytes = 0;
    const leaderboards = (action, p) => {
      if (action === "submitScore") {
        const orderingOk = p.ordering === void 0 || p.ordering === "ascending" || p.ordering === "descending";
        if (!isNonEmptyString(p.leaderboardId) || !Number.isInteger(p.score) || !orderingOk) return fail(errors.INVALID_PARAMS);
        return ok({ ok: true, submittedScore: p.score, newScore: p.score });
      }
      if (action === "present") return ok({ ok: true, presented: true });
      return fail(errors.INVALID_PARAMS);
    };
    const bitmoji = (action, p) => {
      if (hasOwn(p, "participant")) return fail(errors.INVALID_PARAMS);
      if (action === "getAvatarInfo") return ok({ hasAvatar: true });
      if (action === "getVariants") return ok({ variants: STUB_VARIANTS.slice() });
      if (action === "get2DAvatar") {
        if (p.variant !== void 0 && STUB_VARIANTS.indexOf(p.variant) === -1) return fail(errors.INVALID_PARAMS);
        if (p.size !== void 0 && ["small", "normal", "large"].indexOf(p.size) === -1) return fail(errors.INVALID_PARAMS);
        return ok({ url: PNG_URL });
      }
      if (action === "get3DAvatar") return ok({ url: GLB_URL });
      return fail(errors.INVALID_PARAMS);
    };
    const storage = (action, p) => {
      const key = p.key;
      switch (action) {
        case "get":
          if (!hasExactly(p, ["key"]) || !isValidKey(key)) return fail(errors.INVALID_PARAMS);
          return ok(store.has(key) ? { found: true, value: JSON.parse(store.get(key)) } : { found: false });
        case "set": {
          if (!hasExactly(p, ["key", "value"]) || !isValidKey(key) || p.value === void 0) return fail(errors.INVALID_PARAMS);
          let encoded;
          try {
            encoded = JSON.stringify(p.value);
          } catch {
            return fail(errors.INVALID_PARAMS);
          }
          if (encoded === void 0 || utf8Length(encoded) > STORAGE_LIMITS.valueLimit) return fail(errors.INVALID_PARAMS);
          const previous = store.has(key) ? jsonBytes(key) + utf8Length(store.get(key)) : 0;
          const next = storeBytes - previous + jsonBytes(key) + utf8Length(encoded);
          const keyCount = store.size + (previous ? 0 : 1);
          if (next > STORAGE_LIMITS.byteLimit || keyCount > STORAGE_LIMITS.keyLimit) return fail(errors.QUOTA_EXCEEDED);
          store.set(key, encoded);
          storeBytes = next;
          return ok({});
        }
        case "remove":
          if (!hasExactly(p, ["key"]) || !isValidKey(key)) return fail(errors.INVALID_PARAMS);
          if (store.has(key)) {
            storeBytes -= jsonBytes(key) + utf8Length(store.get(key));
            store.delete(key);
          }
          return ok({});
        case "clear":
          if (!hasExactly(p, [])) return fail(errors.INVALID_PARAMS);
          store = /* @__PURE__ */ new Map();
          storeBytes = 0;
          return ok({});
        case "keys":
          if (!hasExactly(p, [])) return fail(errors.INVALID_PARAMS);
          return ok({ keys: Array.from(store.keys()).sort() });
        case "getInfo":
          if (!hasExactly(p, [])) return fail(errors.INVALID_PARAMS);
          return ok({
            bytesUsed: storeBytes,
            byteLimit: STORAGE_LIMITS.byteLimit,
            keyCount: store.size,
            keyLimit: STORAGE_LIMITS.keyLimit,
            valueLimit: STORAGE_LIMITS.valueLimit,
            persistenceMode: "inMemory"
          });
        default:
          return fail(errors.INVALID_PARAMS);
      }
    };
    const capabilities = {
      sdk: (action) => {
        if (action !== "getCapabilities") return fail(errors.INVALID_PARAMS);
        return ok({ capabilities: { leaderboards: 1, bitmoji: 1, games_storage: 1 } });
      },
      leaderboards,
      bitmoji,
      games_storage: storage
    };
    return (message) => {
      const [capability, action] = message.uri.replace("app://", "").split("/");
      const handler = hasOwn(capabilities, capability) ? capabilities[capability] : void 0;
      const params = isObject(message.params) ? message.params : {};
      const result = handler ? handler(action, params) : fail(errors.UNKNOWN_CAPABILITY);
      if (typeof console !== "undefined") {
        result.then(
          (v) => console.info("[snapchat stub]", message.uri, params, "->", v),
          (e) => console.info("[snapchat stub]", message.uri, params, "->", e.message)
        );
      }
      return result;
    };
  }

  // src/transport.ts
  function getGlobal() {
    return typeof window !== "undefined" ? window : globalThis;
  }
  function iosTransport(bridge) {
    return (message) => {
      let reply;
      try {
        reply = bridge.postMessage(message);
      } catch {
        return Promise.reject(bridgeError(errors.INTERNAL));
      }
      return Promise.resolve(reply).catch((reason) => {
        throw normalizeRejection(reason);
      });
    };
  }
  function androidTransport(bridge) {
    const pending = /* @__PURE__ */ new Map();
    let seq = 0;
    const prefix = `${Math.random().toString(36).slice(2, 8)}-`;
    bridge.addEventListener("message", (event) => {
      let reply;
      try {
        reply = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!reply || reply.requestId == null) return;
      const entry = pending.get(String(reply.requestId));
      if (!entry) return;
      pending.delete(String(reply.requestId));
      if (reply.ok) entry.resolve(reply.payload);
      else entry.reject(bridgeError(typeof reply.error === "string" ? reply.error : errors.INTERNAL));
    });
    return (message) => new Promise((resolve, reject) => {
      const id = prefix + ++seq;
      let serialized;
      try {
        serialized = JSON.stringify({ requestId: id, uri: message.uri, params: message.params });
      } catch {
        reject(bridgeError(errors.INTERNAL));
        return;
      }
      pending.set(id, { resolve, reject });
      try {
        bridge.postMessage(serialized);
      } catch {
        pending.delete(id);
        reject(bridgeError(errors.INTERNAL));
      }
    });
  }
  var noBridgeTransport = () => Promise.reject(bridgeError(errors.UNSUPPORTED_HOST));
  var ANDROID_LENS_HOST = /(?:^|\.)web-lens\.snap\.local$/;
  function isLensHostContext(loc) {
    if (!loc) return false;
    if (typeof loc.protocol === "string" && loc.protocol.toLowerCase() === "weblens:") return true;
    return ANDROID_LENS_HOST.test((typeof loc.hostname === "string" ? loc.hostname : "").toLowerCase());
  }
  function selectTransport(global, makeStub) {
    const ios = global.webkit && global.webkit.messageHandlers && global.webkit.messageHandlers.snapWebLensBridge;
    if (ios) return { transport: iosTransport(ios), isStub: false };
    const android = global.snapWebLensBridge;
    if (android && typeof android.postMessage === "function") return { transport: androidTransport(android), isStub: false };
    if (isLensHostContext(global.location)) return { transport: noBridgeTransport, isStub: false };
    if (typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn("[snapchat] No native bridge. Using the DESKTOP STUB: every value is a canned fixture.");
    }
    return { transport: makeStub(), isStub: true };
  }

  // src/index.ts
  var VERSION = "0.1.2";
  var WIRE_STORAGE = "games_storage";
  var API_NAMES = /* @__PURE__ */ new Map([[WIRE_STORAGE, "storage"]]);
  function toSubmitScoreResult(reply) {
    const best = reply?.newScore;
    return typeof best === "number" ? { bestScore: best } : {};
  }
  function toStorageInfo(reply) {
    const info = reply ?? {};
    return {
      usedBytes: info.bytesUsed,
      maxBytes: info.byteLimit,
      keyCount: info.keyCount,
      maxKeys: info.keyLimit,
      maxValueBytes: info.valueLimit,
      persistenceMode: info.persistenceMode === "inMemory" ? "memory" : info.persistenceMode
    };
  }
  var PLACEHOLDER_BOARD_ID = "main";
  var nothing = () => void 0;
  function get2DAvatarWireParams(params) {
    if (params === null || typeof params !== "object" || Array.isArray(params)) return {};
    const { size, ...rest } = params;
    if (size === "normal") return null;
    return size === void 0 ? rest : { ...rest, size: size === "medium" ? "normal" : size };
  }
  function createApi(global) {
    const { transport, isStub } = selectTransport(global, createStub);
    let caps = null;
    function call(capability, action, params) {
      const p = params !== null && typeof params === "object" && !Array.isArray(params) ? params : {};
      return transport({ uri: `app://${capability}/${action}`, params: p });
    }
    const api = {
      version: VERSION,
      errors,
      get isStub() {
        return isStub;
      },
      init() {
        return call("sdk", "getCapabilities").then((reply) => {
          const discovered = reply && typeof reply === "object" ? reply.capabilities : void 0;
          const next = {};
          if (discovered && typeof discovered === "object") {
            for (const name of Object.keys(discovered)) {
              const version = discovered[name];
              if (typeof version === "number") next[API_NAMES.get(name) ?? name] = version;
            }
          }
          caps = next;
          return caps;
        }).catch((e) => {
          const code = e && typeof e.message === "string" ? e.message : "";
          if (code === errors.UNSUPPORTED_HOST || code === errors.UNKNOWN_CAPABILITY) {
            caps = {};
            return caps;
          }
          throw e;
        });
      },
      isSupported(capability, minVersion) {
        if (!caps || !Object.prototype.hasOwnProperty.call(caps, capability)) return false;
        const required = typeof minVersion === "number" && minVersion >= 1 ? minVersion : 1;
        return caps[capability] >= required;
      },
      leaderboards: {
        submitScore: (params) => call("leaderboards", "submitScore", {
          ...params,
          leaderboardId: params?.leaderboardId || PLACEHOLDER_BOARD_ID
        }).then(toSubmitScoreResult),
        // The hosts call this action `present`.
        show: () => call("leaderboards", "present", {}).then(nothing)
      },
      bitmoji: {
        getAvatarInfo: () => call("bitmoji", "getAvatarInfo", {}),
        get2DAvatar: (params) => {
          const wire = get2DAvatarWireParams(params);
          return wire ? call("bitmoji", "get2DAvatar", wire) : Promise.reject(bridgeError(errors.INVALID_PARAMS));
        },
        get3DAvatar: () => call("bitmoji", "get3DAvatar", {}),
        getVariants: () => call("bitmoji", "getVariants", {})
      },
      storage: {
        get: (key) => call(WIRE_STORAGE, "get", { key }),
        set: (key, value) => call(WIRE_STORAGE, "set", { key, value }).then(nothing),
        remove: (key) => call(WIRE_STORAGE, "remove", { key }).then(nothing),
        clear: () => call(WIRE_STORAGE, "clear", {}).then(nothing),
        keys: () => call(WIRE_STORAGE, "keys", {}),
        getInfo: () => call(WIRE_STORAGE, "getInfo", {}).then(toStorageInfo)
      }
    };
    Object.defineProperty(api, "__isSnapchatWebLensAPI", { value: true });
    return api;
  }
  function installed(global) {
    const candidate = global.snapchat;
    return candidate && candidate.__isSnapchatWebLensAPI === true ? candidate : void 0;
  }
  var host = getGlobal();
  var existing = installed(host);
  var snapchat = existing || createApi(host);
  if (!existing) {
    host.snapchat = snapchat;
    if (!host.SnapSDK) host.SnapSDK = snapchat;
  }
  var index_default = snapchat;
})();
