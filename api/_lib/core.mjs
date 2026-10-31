// СОБРАНО АВТОМАТИЧЕСКИ из src/App.jsx (scripts/bot/build-core.mjs) — не править вручную

var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../../opt/npm-tools/node_modules/react/cjs/react.production.js
var require_react_production = __commonJS({
  "../../../opt/npm-tools/node_modules/react/cjs/react.production.js"(exports) {
    "use strict";
    var REACT_ELEMENT_TYPE = /* @__PURE__ */ Symbol.for("react.transitional.element");
    var REACT_PORTAL_TYPE = /* @__PURE__ */ Symbol.for("react.portal");
    var REACT_FRAGMENT_TYPE = /* @__PURE__ */ Symbol.for("react.fragment");
    var REACT_STRICT_MODE_TYPE = /* @__PURE__ */ Symbol.for("react.strict_mode");
    var REACT_PROFILER_TYPE = /* @__PURE__ */ Symbol.for("react.profiler");
    var REACT_CONSUMER_TYPE = /* @__PURE__ */ Symbol.for("react.consumer");
    var REACT_CONTEXT_TYPE = /* @__PURE__ */ Symbol.for("react.context");
    var REACT_FORWARD_REF_TYPE = /* @__PURE__ */ Symbol.for("react.forward_ref");
    var REACT_SUSPENSE_TYPE = /* @__PURE__ */ Symbol.for("react.suspense");
    var REACT_MEMO_TYPE = /* @__PURE__ */ Symbol.for("react.memo");
    var REACT_LAZY_TYPE = /* @__PURE__ */ Symbol.for("react.lazy");
    var REACT_ACTIVITY_TYPE = /* @__PURE__ */ Symbol.for("react.activity");
    var MAYBE_ITERATOR_SYMBOL = Symbol.iterator;
    function getIteratorFn(maybeIterable) {
      if (null === maybeIterable || "object" !== typeof maybeIterable) return null;
      maybeIterable = MAYBE_ITERATOR_SYMBOL && maybeIterable[MAYBE_ITERATOR_SYMBOL] || maybeIterable["@@iterator"];
      return "function" === typeof maybeIterable ? maybeIterable : null;
    }
    var ReactNoopUpdateQueue = {
      isMounted: function() {
        return false;
      },
      enqueueForceUpdate: function() {
      },
      enqueueReplaceState: function() {
      },
      enqueueSetState: function() {
      }
    };
    var assign = Object.assign;
    var emptyObject = {};
    function Component(props, context, updater) {
      this.props = props;
      this.context = context;
      this.refs = emptyObject;
      this.updater = updater || ReactNoopUpdateQueue;
    }
    Component.prototype.isReactComponent = {};
    Component.prototype.setState = function(partialState, callback) {
      if ("object" !== typeof partialState && "function" !== typeof partialState && null != partialState)
        throw Error(
          "takes an object of state variables to update or a function which returns an object of state variables."
        );
      this.updater.enqueueSetState(this, partialState, callback, "setState");
    };
    Component.prototype.forceUpdate = function(callback) {
      this.updater.enqueueForceUpdate(this, callback, "forceUpdate");
    };
    function ComponentDummy() {
    }
    ComponentDummy.prototype = Component.prototype;
    function PureComponent(props, context, updater) {
      this.props = props;
      this.context = context;
      this.refs = emptyObject;
      this.updater = updater || ReactNoopUpdateQueue;
    }
    var pureComponentPrototype = PureComponent.prototype = new ComponentDummy();
    pureComponentPrototype.constructor = PureComponent;
    assign(pureComponentPrototype, Component.prototype);
    pureComponentPrototype.isPureReactComponent = true;
    var isArrayImpl = Array.isArray;
    function noop() {
    }
    var ReactSharedInternals = { H: null, A: null, T: null, S: null };
    var hasOwnProperty = Object.prototype.hasOwnProperty;
    function ReactElement(type, key, props) {
      var refProp = props.ref;
      return {
        $$typeof: REACT_ELEMENT_TYPE,
        type,
        key,
        ref: void 0 !== refProp ? refProp : null,
        props
      };
    }
    function cloneAndReplaceKey(oldElement, newKey) {
      return ReactElement(oldElement.type, newKey, oldElement.props);
    }
    function isValidElement(object) {
      return "object" === typeof object && null !== object && object.$$typeof === REACT_ELEMENT_TYPE;
    }
    function escape(key) {
      var escaperLookup = { "=": "=0", ":": "=2" };
      return "$" + key.replace(/[=:]/g, function(match) {
        return escaperLookup[match];
      });
    }
    var userProvidedKeyEscapeRegex = /\/+/g;
    function getElementKey(element, index) {
      return "object" === typeof element && null !== element && null != element.key ? escape("" + element.key) : index.toString(36);
    }
    function resolveThenable(thenable) {
      switch (thenable.status) {
        case "fulfilled":
          return thenable.value;
        case "rejected":
          throw thenable.reason;
        default:
          switch ("string" === typeof thenable.status ? thenable.then(noop, noop) : (thenable.status = "pending", thenable.then(
            function(fulfilledValue) {
              "pending" === thenable.status && (thenable.status = "fulfilled", thenable.value = fulfilledValue);
            },
            function(error) {
              "pending" === thenable.status && (thenable.status = "rejected", thenable.reason = error);
            }
          )), thenable.status) {
            case "fulfilled":
              return thenable.value;
            case "rejected":
              throw thenable.reason;
          }
      }
      throw thenable;
    }
    function mapIntoArray(children, array, escapedPrefix, nameSoFar, callback) {
      var type = typeof children;
      if ("undefined" === type || "boolean" === type) children = null;
      var invokeCallback = false;
      if (null === children) invokeCallback = true;
      else
        switch (type) {
          case "bigint":
          case "string":
          case "number":
            invokeCallback = true;
            break;
          case "object":
            switch (children.$$typeof) {
              case REACT_ELEMENT_TYPE:
              case REACT_PORTAL_TYPE:
                invokeCallback = true;
                break;
              case REACT_LAZY_TYPE:
                return invokeCallback = children._init, mapIntoArray(
                  invokeCallback(children._payload),
                  array,
                  escapedPrefix,
                  nameSoFar,
                  callback
                );
            }
        }
      if (invokeCallback)
        return callback = callback(children), invokeCallback = "" === nameSoFar ? "." + getElementKey(children, 0) : nameSoFar, isArrayImpl(callback) ? (escapedPrefix = "", null != invokeCallback && (escapedPrefix = invokeCallback.replace(userProvidedKeyEscapeRegex, "$&/") + "/"), mapIntoArray(callback, array, escapedPrefix, "", function(c) {
          return c;
        })) : null != callback && (isValidElement(callback) && (callback = cloneAndReplaceKey(
          callback,
          escapedPrefix + (null == callback.key || children && children.key === callback.key ? "" : ("" + callback.key).replace(
            userProvidedKeyEscapeRegex,
            "$&/"
          ) + "/") + invokeCallback
        )), array.push(callback)), 1;
      invokeCallback = 0;
      var nextNamePrefix = "" === nameSoFar ? "." : nameSoFar + ":";
      if (isArrayImpl(children))
        for (var i = 0; i < children.length; i++)
          nameSoFar = children[i], type = nextNamePrefix + getElementKey(nameSoFar, i), invokeCallback += mapIntoArray(
            nameSoFar,
            array,
            escapedPrefix,
            type,
            callback
          );
      else if (i = getIteratorFn(children), "function" === typeof i)
        for (children = i.call(children), i = 0; !(nameSoFar = children.next()).done; )
          nameSoFar = nameSoFar.value, type = nextNamePrefix + getElementKey(nameSoFar, i++), invokeCallback += mapIntoArray(
            nameSoFar,
            array,
            escapedPrefix,
            type,
            callback
          );
      else if ("object" === type) {
        if ("function" === typeof children.then)
          return mapIntoArray(
            resolveThenable(children),
            array,
            escapedPrefix,
            nameSoFar,
            callback
          );
        array = String(children);
        throw Error(
          "Objects are not valid as a React child (found: " + ("[object Object]" === array ? "object with keys {" + Object.keys(children).join(", ") + "}" : array) + "). If you meant to render a collection of children, use an array instead."
        );
      }
      return invokeCallback;
    }
    function mapChildren(children, func, context) {
      if (null == children) return children;
      var result = [], count = 0;
      mapIntoArray(children, result, "", "", function(child) {
        return func.call(context, child, count++);
      });
      return result;
    }
    function lazyInitializer(payload) {
      if (-1 === payload._status) {
        var ctor = payload._result;
        ctor = ctor();
        ctor.then(
          function(moduleObject) {
            if (0 === payload._status || -1 === payload._status)
              payload._status = 1, payload._result = moduleObject;
          },
          function(error) {
            if (0 === payload._status || -1 === payload._status)
              payload._status = 2, payload._result = error;
          }
        );
        -1 === payload._status && (payload._status = 0, payload._result = ctor);
      }
      if (1 === payload._status) return payload._result.default;
      throw payload._result;
    }
    var reportGlobalError = "function" === typeof reportError ? reportError : function(error) {
      if ("object" === typeof window && "function" === typeof window.ErrorEvent) {
        var event = new window.ErrorEvent("error", {
          bubbles: true,
          cancelable: true,
          message: "object" === typeof error && null !== error && "string" === typeof error.message ? String(error.message) : String(error),
          error
        });
        if (!window.dispatchEvent(event)) return;
      } else if ("object" === typeof process && "function" === typeof process.emit) {
        process.emit("uncaughtException", error);
        return;
      }
      console.error(error);
    };
    var Children = {
      map: mapChildren,
      forEach: function(children, forEachFunc, forEachContext) {
        mapChildren(
          children,
          function() {
            forEachFunc.apply(this, arguments);
          },
          forEachContext
        );
      },
      count: function(children) {
        var n = 0;
        mapChildren(children, function() {
          n++;
        });
        return n;
      },
      toArray: function(children) {
        return mapChildren(children, function(child) {
          return child;
        }) || [];
      },
      only: function(children) {
        if (!isValidElement(children))
          throw Error(
            "React.Children.only expected to receive a single React element child."
          );
        return children;
      }
    };
    exports.Activity = REACT_ACTIVITY_TYPE;
    exports.Children = Children;
    exports.Component = Component;
    exports.Fragment = REACT_FRAGMENT_TYPE;
    exports.Profiler = REACT_PROFILER_TYPE;
    exports.PureComponent = PureComponent;
    exports.StrictMode = REACT_STRICT_MODE_TYPE;
    exports.Suspense = REACT_SUSPENSE_TYPE;
    exports.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = ReactSharedInternals;
    exports.__COMPILER_RUNTIME = {
      __proto__: null,
      c: function(size) {
        return ReactSharedInternals.H.useMemoCache(size);
      }
    };
    exports.cache = function(fn) {
      return function() {
        return fn.apply(null, arguments);
      };
    };
    exports.cacheSignal = function() {
      return null;
    };
    exports.cloneElement = function(element, config, children) {
      if (null === element || void 0 === element)
        throw Error(
          "The argument must be a React element, but you passed " + element + "."
        );
      var props = assign({}, element.props), key = element.key;
      if (null != config)
        for (propName in void 0 !== config.key && (key = "" + config.key), config)
          !hasOwnProperty.call(config, propName) || "key" === propName || "__self" === propName || "__source" === propName || "ref" === propName && void 0 === config.ref || (props[propName] = config[propName]);
      var propName = arguments.length - 2;
      if (1 === propName) props.children = children;
      else if (1 < propName) {
        for (var childArray = Array(propName), i = 0; i < propName; i++)
          childArray[i] = arguments[i + 2];
        props.children = childArray;
      }
      return ReactElement(element.type, key, props);
    };
    exports.createContext = function(defaultValue) {
      defaultValue = {
        $$typeof: REACT_CONTEXT_TYPE,
        _currentValue: defaultValue,
        _currentValue2: defaultValue,
        _threadCount: 0,
        Provider: null,
        Consumer: null
      };
      defaultValue.Provider = defaultValue;
      defaultValue.Consumer = {
        $$typeof: REACT_CONSUMER_TYPE,
        _context: defaultValue
      };
      return defaultValue;
    };
    exports.createElement = function(type, config, children) {
      var propName, props = {}, key = null;
      if (null != config)
        for (propName in void 0 !== config.key && (key = "" + config.key), config)
          hasOwnProperty.call(config, propName) && "key" !== propName && "__self" !== propName && "__source" !== propName && (props[propName] = config[propName]);
      var childrenLength = arguments.length - 2;
      if (1 === childrenLength) props.children = children;
      else if (1 < childrenLength) {
        for (var childArray = Array(childrenLength), i = 0; i < childrenLength; i++)
          childArray[i] = arguments[i + 2];
        props.children = childArray;
      }
      if (type && type.defaultProps)
        for (propName in childrenLength = type.defaultProps, childrenLength)
          void 0 === props[propName] && (props[propName] = childrenLength[propName]);
      return ReactElement(type, key, props);
    };
    exports.createRef = function() {
      return { current: null };
    };
    exports.forwardRef = function(render) {
      return { $$typeof: REACT_FORWARD_REF_TYPE, render };
    };
    exports.isValidElement = isValidElement;
    exports.lazy = function(ctor) {
      return {
        $$typeof: REACT_LAZY_TYPE,
        _payload: { _status: -1, _result: ctor },
        _init: lazyInitializer
      };
    };
    exports.memo = function(type, compare) {
      return {
        $$typeof: REACT_MEMO_TYPE,
        type,
        compare: void 0 === compare ? null : compare
      };
    };
    exports.startTransition = function(scope) {
      var prevTransition = ReactSharedInternals.T, currentTransition = {};
      ReactSharedInternals.T = currentTransition;
      try {
        var returnValue = scope(), onStartTransitionFinish = ReactSharedInternals.S;
        null !== onStartTransitionFinish && onStartTransitionFinish(currentTransition, returnValue);
        "object" === typeof returnValue && null !== returnValue && "function" === typeof returnValue.then && returnValue.then(noop, reportGlobalError);
      } catch (error) {
        reportGlobalError(error);
      } finally {
        null !== prevTransition && null !== currentTransition.types && (prevTransition.types = currentTransition.types), ReactSharedInternals.T = prevTransition;
      }
    };
    exports.unstable_useCacheRefresh = function() {
      return ReactSharedInternals.H.useCacheRefresh();
    };
    exports.use = function(usable) {
      return ReactSharedInternals.H.use(usable);
    };
    exports.useActionState = function(action, initialState, permalink) {
      return ReactSharedInternals.H.useActionState(action, initialState, permalink);
    };
    exports.useCallback = function(callback, deps) {
      return ReactSharedInternals.H.useCallback(callback, deps);
    };
    exports.useContext = function(Context) {
      return ReactSharedInternals.H.useContext(Context);
    };
    exports.useDebugValue = function() {
    };
    exports.useDeferredValue = function(value, initialValue) {
      return ReactSharedInternals.H.useDeferredValue(value, initialValue);
    };
    exports.useEffect = function(create, deps) {
      return ReactSharedInternals.H.useEffect(create, deps);
    };
    exports.useEffectEvent = function(callback) {
      return ReactSharedInternals.H.useEffectEvent(callback);
    };
    exports.useId = function() {
      return ReactSharedInternals.H.useId();
    };
    exports.useImperativeHandle = function(ref, create, deps) {
      return ReactSharedInternals.H.useImperativeHandle(ref, create, deps);
    };
    exports.useInsertionEffect = function(create, deps) {
      return ReactSharedInternals.H.useInsertionEffect(create, deps);
    };
    exports.useLayoutEffect = function(create, deps) {
      return ReactSharedInternals.H.useLayoutEffect(create, deps);
    };
    exports.useMemo = function(create, deps) {
      return ReactSharedInternals.H.useMemo(create, deps);
    };
    exports.useOptimistic = function(passthrough, reducer) {
      return ReactSharedInternals.H.useOptimistic(passthrough, reducer);
    };
    exports.useReducer = function(reducer, initialArg, init) {
      return ReactSharedInternals.H.useReducer(reducer, initialArg, init);
    };
    exports.useRef = function(initialValue) {
      return ReactSharedInternals.H.useRef(initialValue);
    };
    exports.useState = function(initialState) {
      return ReactSharedInternals.H.useState(initialState);
    };
    exports.useSyncExternalStore = function(subscribe, getSnapshot, getServerSnapshot) {
      return ReactSharedInternals.H.useSyncExternalStore(
        subscribe,
        getSnapshot,
        getServerSnapshot
      );
    };
    exports.useTransition = function() {
      return ReactSharedInternals.H.useTransition();
    };
    exports.version = "19.2.8";
  }
});

// ../../../opt/npm-tools/node_modules/react/index.js
var require_react = __commonJS({
  "../../../opt/npm-tools/node_modules/react/index.js"(exports, module) {
    "use strict";
    if (true) {
      module.exports = require_react_production();
    } else {
      module.exports = null;
    }
  }
});

// ../../../opt/npm-tools/node_modules/react/cjs/react-jsx-runtime.production.js
var require_react_jsx_runtime_production = __commonJS({
  "../../../opt/npm-tools/node_modules/react/cjs/react-jsx-runtime.production.js"(exports) {
    "use strict";
    var REACT_ELEMENT_TYPE = /* @__PURE__ */ Symbol.for("react.transitional.element");
    var REACT_FRAGMENT_TYPE = /* @__PURE__ */ Symbol.for("react.fragment");
    function jsxProd(type, config, maybeKey) {
      var key = null;
      void 0 !== maybeKey && (key = "" + maybeKey);
      void 0 !== config.key && (key = "" + config.key);
      if ("key" in config) {
        maybeKey = {};
        for (var propName in config)
          "key" !== propName && (maybeKey[propName] = config[propName]);
      } else maybeKey = config;
      config = maybeKey.ref;
      return {
        $$typeof: REACT_ELEMENT_TYPE,
        type,
        key,
        ref: void 0 !== config ? config : null,
        props: maybeKey
      };
    }
    exports.Fragment = REACT_FRAGMENT_TYPE;
    exports.jsx = jsxProd;
    exports.jsxs = jsxProd;
  }
});

// ../../../opt/npm-tools/node_modules/react/jsx-runtime.js
var require_jsx_runtime = __commonJS({
  "../../../opt/npm-tools/node_modules/react/jsx-runtime.js"(exports, module) {
    "use strict";
    if (true) {
      module.exports = require_react_jsx_runtime_production();
    } else {
      module.exports = null;
    }
  }
});

// src/App.jsx
var import_react = __toESM(require_react(), 1);

// scripts/nightly/supabase-stub.js
var unavailable = () => {
  throw new Error("Supabase-\u043A\u043B\u0438\u0435\u043D\u0442 \u0432 \u043D\u043E\u0447\u043D\u043E\u043C \u0431\u044D\u043A\u0430\u043F\u0435 \u043D\u0435 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u0442\u0441\u044F");
};
function createClient() {
  return new Proxy({}, { get: (_, k) => k === "then" ? void 0 : unavailable });
}

// src/db.js
var TE_SESSION = null;
var teFetch = (input, init = {}) => {
  let opts = init;
  if (TE_SESSION) {
    const h = new Headers(init.headers || (typeof Request !== "undefined" && input instanceof Request ? input.headers : void 0));
    h.set("x-te-session", TE_SESSION);
    opts = { ...init, headers: h };
  }
  return fetch(input, opts).then((res) => {
    if (!res.ok && (res.status === 401 || res.status === 403)) {
      res.clone().json().then((j) => {
        if (j && /te_session_required/.test(String(j.message || ""))) {
          try {
            window.dispatchEvent(new Event("te-session-lost"));
          } catch (e) {
          }
        }
      }).catch(() => {
      });
    }
    return res;
  });
};
var supabase = createClient(
  "http://localhost",
  "x",
  { global: { fetch: teFetch } }
);
var Query = class {
  constructor(table) {
    this.table = table;
    this.op = "select";
    this.rows = null;
    this.patch = null;
    this.filters = [];
    this.ord = null;
  }
  select() {
    this.op = "select";
    return this;
  }
  insert(rows) {
    this.op = "insert";
    this.rows = rows;
    return this;
  }
  update(patch) {
    this.op = "update";
    this.patch = patch;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(k, v) {
    this.filters.push(["eq", k, v]);
    return this;
  }
  neq(k, v) {
    this.filters.push(["neq", k, v]);
    return this;
  }
  ilike(k, v) {
    this.filters.push(["ilike", k, "%" + String(v).replace(/%/g, "") + "%"]);
    return this;
  }
  order(k, o) {
    this.ord = [k, !o || o.ascending !== false];
    return this;
  }
  _apply(q) {
    for (const [fn, k, v] of this.filters) q = q[fn](k, v);
    if (this.ord) q = q.order(this.ord[0], { ascending: this.ord[1] });
    return q;
  }
  async _exec() {
    let q;
    if (this.op === "select") {
      q = this._apply(supabase.from(this.table).select("*"));
    } else if (this.op === "insert") {
      q = supabase.from(this.table).insert(this.rows).select();
    } else if (this.op === "update") {
      q = this._apply(supabase.from(this.table).update(this.patch)).select();
    } else if (this.op === "delete") {
      q = this._apply(supabase.from(this.table).delete());
    }
    const { data, error } = await q;
    if (error) console.error("[db]", this.table, error.message);
    return { data: data || [], error };
  }
  then(res, rej) {
    return this._exec().then(res, rej);
  }
};
var db = { from: (t) => new Query(t) };

// src/App.jsx
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
var DB_MISSING = {};
var _lastDbErr = { m: "", at: 0 };
function dbErrText(t, e) {
  const m = String(e && e.message || e || "");
  if (e && e.code === "23503" || /foreign key/i.test(m)) return "\u0417\u0430\u043F\u0438\u0441\u044C \u0432 \xAB" + t + "\xBB \u043D\u0435 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0430: \u043D\u0430 \u043D\u0435\u0451 \u0441\u0441\u044B\u043B\u0430\u044E\u0442\u0441\u044F \u0434\u0440\u0443\u0433\u0438\u0435 \u0434\u0430\u043D\u043D\u044B\u0435.";
  if (/te_forbidden:/.test(m)) return "\u041D\u0435\u043B\u044C\u0437\u044F: " + m.replace(/^.*te_forbidden:\s*/, "") + ".";
  if (/row-level security|permission denied/i.test(m) || e && e.code === "42501") return "\u041D\u0435\u0442 \u043F\u0440\u0430\u0432 \u043D\u0430 \u0437\u0430\u043F\u0438\u0441\u044C \u0432 \u0442\u0430\u0431\u043B\u0438\u0446\u0443 \xAB" + t + "\xBB (\u043F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 RLS \u0432 Supabase).";
  if (e && e.code === "NO_COLUMNS") return "\u041D\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E: " + m + ".";
  return "\u041E\u0448\u0438\u0431\u043A\u0430 \u0431\u0430\u0437\u044B (\xAB" + t + "\xBB): " + m;
}
function dbReport(t, e) {
  const msg = dbErrText(t, e), now = Date.now();
  if (msg === _lastDbErr.m && now - _lastDbErr.at < 4e3) return;
  _lastDbErr = { m: msg, at: now };
  try {
    window.dispatchEvent(new CustomEvent("te-db-error", { detail: msg }));
  } catch (x) {
  }
}
var BUSY_N = 0;
var BUSY_SUBS = /* @__PURE__ */ new Set();
var busyEmit = () => BUSY_SUBS.forEach((f) => {
  try {
    f(BUSY_N);
  } catch (e) {
  }
});
var BUSY_SILENT = 0;
var busyInc = () => {
  if (BUSY_SILENT) return;
  BUSY_N++;
  busyEmit();
};
var busyDec = () => {
  BUSY_N = Math.max(0, BUSY_N - 1);
  busyEmit();
};
async function busyWrap(p) {
  if (BUSY_SILENT) return p;
  busyInc();
  try {
    return await p;
  } finally {
    busyDec();
  }
}
if (typeof window !== "undefined" && window.fetch && !window.__teFetchPatched) {
  window.__teFetchPatched = true;
  const f0 = window.fetch.bind(window);
  window.fetch = (...a) => {
    if (BUSY_SILENT) return f0(...a);
    busyInc();
    return f0(...a).finally(busyDec);
  };
}
function dbWrap(real) {
  return {
    from(t) {
      const calls = [];
      const strip = (col) => {
        let hit = false;
        calls.forEach(([m, a]) => {
          if (m !== "insert" && m !== "update") return;
          (Array.isArray(a[0]) ? a[0] : [a[0]]).forEach((o) => {
            if (o && Object.prototype.hasOwnProperty.call(o, col)) {
              delete o[col];
              hit = true;
            }
          });
        });
        return hit;
      };
      const run = async () => {
        const miss = DB_MISSING[t] || (DB_MISSING[t] = /* @__PURE__ */ new Set());
        const dropped = [];
        miss.forEach((c) => {
          if (strip(c)) dropped.push(c);
        });
        for (let attempt = 0; attempt < 15; attempt++) {
          const w = calls.find(([m]) => m === "insert" || m === "update");
          if (w && (Array.isArray(w[1][0]) ? w[1][0].some((o) => !Object.keys(o).length) : !Object.keys(w[1][0] || {}).length)) {
            const r2 = { data: [], error: { message: "\u0432 \u0442\u0430\u0431\u043B\u0438\u0446\u0435 \xAB" + t + "\xBB \u043D\u0435\u0442 \u043A\u043E\u043B\u043E\u043D\u043E\u043A: " + dropped.join(", "), code: "NO_COLUMNS" }, dropped };
            dbReport(t, r2.error);
            return r2;
          }
          let qq = real.from(t);
          for (const [m, a] of calls) qq = qq[m](...a);
          const r = await qq;
          const e = r && r.error;
          const mm = e && /Could not find the '([^']+)' column/i.exec(e.message || "");
          if (mm && strip(mm[1])) {
            miss.add(mm[1]);
            dropped.push(mm[1]);
            console.warn("[db] \u0432 \u0442\u0430\u0431\u043B\u0438\u0446\u0435 " + t + " \u043D\u0435\u0442 \u043A\u043E\u043B\u043E\u043D\u043A\u0438 \xAB" + mm[1] + "\xBB \u2014 \u0437\u0430\u043F\u0438\u0441\u044C \u043F\u043E\u0432\u0442\u043E\u0440\u0435\u043D\u0430 \u0431\u0435\u0437 \u043D\u0435\u0451");
            continue;
          }
          if (e) dbReport(t, e);
          if (r && dropped.length) r.dropped = dropped;
          return r;
        }
        return { data: [], error: { message: "\u0441\u043B\u0438\u0448\u043A\u043E\u043C \u043C\u043D\u043E\u0433\u043E \u043E\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u044E\u0449\u0438\u0445 \u043A\u043E\u043B\u043E\u043D\u043E\u043A \u0432 \xAB" + t + "\xBB" } };
      };
      const q = new Proxy({}, {
        get(_, prop) {
          if (prop === "then") return (res, rej) => busyWrap(run()).then(res, rej);
          if (prop === "catch") return (rej) => busyWrap(run()).catch(rej);
          if (typeof prop === "symbol") return void 0;
          return (...args) => {
            if ((prop === "insert" || prop === "update") && args[0] && typeof args[0] === "object")
              args = [Array.isArray(args[0]) ? args[0].map((r) => ({ ...r })) : { ...args[0] }, ...args.slice(1)];
            calls.push([prop, args]);
            return q;
          };
        }
      });
      return q;
    }
  };
}
var db2 = dbWrap(db);
var OBJ_STATUSES = [
  { id: "draft", label: "\u0427\u0435\u0440\u043D\u043E\u0432\u0438\u043A", c: "var(--t-neutral)" },
  { id: "approved", label: "\u0421\u043E\u0433\u043B\u0430\u0441\u043E\u0432\u0430\u043D\u043E", c: "var(--t-strong)" },
  { id: "payment", label: "\u0412 \u043F\u0440\u043E\u0446\u0435\u0441\u0441\u0435", c: "var(--t-info)" },
  // «Оплачено» ставится сам, когда клиент оплатил 100%; вручную — только при оплате 100%
  { id: "paid", label: "\u041E\u043F\u043B\u0430\u0447\u0435\u043D\u043E", c: "var(--t-ok)" }
];
var IDLE_STATUSES = ["draft", "approved", "tender", "cancelled"];
var isLive = (o) => !!o && !IDLE_STATUSES.includes(o.status || "draft");
var payLive = (o) => isLive(o);
var OP_TYPES = [
  { id: "client_payment", label: "\u041E\u043F\u043B\u0430\u0442\u0430 \u043A\u043B\u0438\u0435\u043D\u0442\u0430" },
  { id: "supplier_payment", label: "\u041E\u043F\u043B\u0430\u0442\u0430 \u043F\u043E\u0441\u0442\u0430\u0432\u0449\u0438\u043A\u0443" },
  { id: "return", label: "\u0412\u043E\u0437\u0432\u0440\u0430\u0442 \u0442\u043E\u0432\u0430\u0440\u0430" },
  { id: "discount", label: "\u0421\u043A\u0438\u0434\u043A\u0430" },
  { id: "expense", label: "\u0414\u043E\u043F. \u0440\u0430\u0441\u0445\u043E\u0434" },
  { id: "bonus", label: "\u0411\u043E\u043D\u0443\u0441 \u043C\u0430\u0441\u0442\u0435\u0440\u0443 (\u043D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u0435)" },
  { id: "bonus_payment", label: "\u0412\u044B\u043F\u043B\u0430\u0442\u0430 \u0431\u043E\u043D\u0443\u0441\u0430 \u043C\u0430\u0441\u0442\u0435\u0440\u0443" },
  { id: "company_expense", label: "\u0420\u0430\u0441\u0445\u043E\u0434 \u043A\u043E\u043C\u043F\u0430\u043D\u0438\u0438" },
  { id: "company_income", label: "\u041F\u0440\u0438\u0445\u043E\u0434 \u043A\u043E\u043C\u043F\u0430\u043D\u0438\u0438" },
  { id: "wh_purchase", label: "\u041F\u0440\u0438\u0445\u043E\u0434 \u043D\u0430 \u0441\u043A\u043B\u0430\u0434 (\u0437\u0430\u043A\u0443\u043F\u043A\u0430)" }
];
var ROLES = [
  { id: "manager", label: "\u041C\u0435\u043D\u0435\u0434\u0436\u0435\u0440", tabs: ["request", "objects", "products", "wh", "suppliers", "masters", "finance"] },
  { id: "boss", label: "\u0420\u0443\u043A\u043E\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u044C", tabs: ["dash", "request", "objects", "products", "wh", "suppliers", "masters", "finance", "log", "admin"] },
  // доставщик: только объекты для доставки (без цен) и Склад Thermo (без цен)
  { id: "driver", label: "\u0414\u043E\u0441\u0442\u0430\u0432\u0449\u0438\u043A", tabs: ["delivery", "wh"] }
];
var ROLE_CFG_MODE = "te_roles";
var GRANT_TABS = ["dash", "request", "objects", "products", "wh", "suppliers", "masters", "finance", "log", "delivery"];
var PERMS = [
  { id: "fin", label: "\u0421\u0435\u0431\u0435\u0441\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C, \u043F\u0440\u0438\u0431\u044B\u043B\u044C, \u0432\u0441\u0435 \u0444\u0438\u043D\u0430\u043D\u0441\u043E\u0432\u044B\u0435 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0438" },
  { id: "del", label: "\u0423\u0434\u0430\u043B\u0435\u043D\u0438\u0435: \u043E\u0431\u044A\u0435\u043A\u0442\u044B \u0441 \u043E\u043F\u043B\u0430\u0442\u0430\u043C\u0438, \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0438, \u043C\u0430\u0441\u0442\u0435\u0440\u0430" },
  { id: "salary", label: "\u0417\u0430\u0440\u043F\u043B\u0430\u0442\u0430 \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u043E\u0432" },
  { id: "backup", label: "\u0411\u044D\u043A\u0430\u043F \u0431\u0430\u0437\u044B \u0438 Excel-\u0430\u0440\u0445\u0438\u0432" },
  { id: "accounts", label: "\u0410\u043A\u043A\u0430\u0443\u043D\u0442\u044B: \u0441\u043E\u0437\u0434\u0430\u0432\u0430\u0442\u044C \u0438 \u043C\u0435\u043D\u044F\u0442\u044C (\u043A\u0440\u043E\u043C\u0435 \u0440\u0443\u043A\u043E\u0432\u043E\u0434\u0438\u0442\u0435\u043B\u0435\u0439)" }
];
var ALL_PERMS = { fin: true, del: true, salary: true, backup: true, accounts: true };
var rolesCfgRow = (data) => (data && data.requests || []).find((x) => x.mode === ROLE_CFG_MODE) || null;
function allRoles(data) {
  const row = rolesCfgRow(data);
  const saved = row && Array.isArray(row.lines) ? row.lines : [];
  const get = (id) => saved.find((x) => x && x.id === id);
  const out = [{ ...ROLES[1], base: "boss", perms: ALL_PERMS, fixed: true }];
  ["manager", "driver"].forEach((id) => {
    const b = ROLES.find((x) => x.id === id), o = get(id) || {};
    out.push({ id, base: id, builtin: true, label: o.label || b.label, tabs: Array.isArray(o.tabs) ? o.tabs.filter((t) => GRANT_TABS.includes(t)) : b.tabs, perms: { ...o.perms || {} } });
  });
  saved.forEach((r) => {
    if (r && r.id && !["boss", "manager", "driver"].includes(r.id)) out.push({ id: r.id, label: r.label || "\u0420\u043E\u043B\u044C", base: r.base === "driver" ? "driver" : "manager", tabs: (r.tabs || []).filter((t) => GRANT_TABS.includes(t)), perms: { ...r.perms || {} }, custom: true });
  });
  return out;
}
var PERMS_MODE = "te_perms";
var userPermsOf = (data) => {
  const r = (data && data.requests || []).find((x) => x.mode === PERMS_MODE);
  return r && r.lines && !Array.isArray(r.lines) && r.lines || {};
};
function accessOf(u, roles, uperms) {
  const r = u && roles.find((x) => x.id === u.role) || roles.find((x) => x.id === "manager");
  const own = r.base !== "boss" && u && uperms && uperms[u.id];
  const t0 = own && Array.isArray(own.tabs) ? own.tabs.filter((t) => GRANT_TABS.includes(t)) : r.tabs;
  const tabs0 = r.base === "boss" ? r.tabs : t0.length ? t0 : r.base === "driver" ? ["delivery"] : ["objects"];
  const perms = r.base === "boss" ? ALL_PERMS : own ? own.perms || {} : r.perms || {};
  const tabs1 = r.base !== "boss" && perms.accounts && !tabs0.includes("admin") ? [...tabs0, "admin"] : tabs0;
  const tabs = tabs1.filter((t) => t !== "notes");
  return { id: r.id, label: r.label, base: r.base, tabs, perms };
}
var EXPENSE_CATEGORIES = ["\u0417\u0430\u0440\u043F\u043B\u0430\u0442\u0430", "\u0410\u0440\u0435\u043D\u0434\u0430", "\u041A\u043E\u043C\u043C\u0443\u043D\u0430\u043B\u044C\u043D\u044B\u0435", "\u041E\u0431\u0435\u0434", "\u0414\u043E\u0441\u0442\u0430\u0432\u043A\u0430", "\u0417\u0430\u043F\u0440\u0430\u0432\u043A\u0430 \u0442\u0440\u0430\u043D\u0441\u043F\u043E\u0440\u0442\u0430", "\u041E\u0441\u0432\u0435\u0436\u0435\u043D\u0438\u044F", "\u0414\u043B\u044F showroom", "\u0421\u0432\u044F\u0437\u044C / \u0438\u043D\u0442\u0435\u0440\u043D\u0435\u0442", "\u041D\u0430\u043B\u043E\u0433\u0438", "\u0420\u0435\u043A\u043B\u0430\u043C\u0430", "\u0425\u043E\u0437\u0440\u0430\u0441\u0445\u043E\u0434\u044B", "\u041F\u0440\u043E\u0447\u0435\u0435"];
var SALARY_CAT = "\u0417\u0430\u0440\u043F\u043B\u0430\u0442\u0430";
var isSalary = (o) => o && o.type === "company_expense" && o.category === SALARY_CAT;
var SALARY_KINDS = ["\u0417\u0430\u0440\u043F\u043B\u0430\u0442\u0430", "\u0410\u0432\u0430\u043D\u0441", "\u041F\u0440\u0435\u043C\u0438\u044F"];
var SAL_NOTE_RE = /^\[([^·\]]+?)\s*·\s*([^\]]+)\]\s*/;
var EXP_CAT_RENAME = { "\u041E\u0431\u0435\u0434 / \u043F\u0438\u0442\u0430\u043D\u0438\u0435": "\u041E\u0431\u0435\u0434" };
function normFinOp(o) {
  if (o && o.type === "company_expense" && EXP_CAT_RENAME[o.category]) return { ...o, category: EXP_CAT_RENAME[o.category] };
  if (!o || o.type !== "company_expense" || o.category) return o;
  let cat = "";
  if (o.size && (EXPENSE_CATEGORIES.includes(o.size) || EXP_CAT_RENAME[o.size])) cat = EXP_CAT_RENAME[o.size] || o.size;
  else if (SALARY_KINDS.includes(o.item_name) && o.product_name || SAL_NOTE_RE.test(o.note || "")) cat = SALARY_CAT;
  return cat ? { ...o, category: cat } : o;
}
function salaryInfo(o) {
  if (!isSalary(o)) return null;
  let kind = o.item_name || "", emp = o.product_name || "", note = o.note || "";
  const m = SAL_NOTE_RE.exec(note);
  if (m) {
    kind = kind || m[1].trim();
    emp = emp || m[2].trim();
    note = note.slice(m[0].length);
  }
  return { kind: kind || "\u0417\u0430\u0440\u043F\u043B\u0430\u0442\u0430", emp, note };
}
var TABLES = ["products", "suppliers", "objects", "finance_ops", "requests", "masters", "warehouse", "wh_moves", "users", "audit_log"];
var BOOT_TABLES = TABLES.filter((t) => t !== "products" && t !== "audit_log");
var TRASH_ACT = "te_trash";
var TRASH_DONE = "te_restored";
var LOG_HIDDEN = /* @__PURE__ */ new Set([TRASH_ACT, TRASH_DONE, "te_tg"]);
var fmt = (n) => (Number(n) || 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
var fmt2 = (n) => (Number(n) || 0).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
var DEFAULT_MARKUP = 15;
var marginK = (pct) => {
  const p = Number(pct) || 0;
  return p >= 99.99 ? 1 : 1 / (1 - p / 100);
};
var retailOf = (p) => Number(p && p.price) > 0 ? Number(p.price) : Math.round((Number(p && p.cost) || 0) * marginK(DEFAULT_MARKUP) * 100) / 100;
var localIso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
var isShipped = (i) => !!i && i.shipped !== false;
var OLD_STATUSES = [
  { id: "tender", label: "\u041D\u0430 \u0442\u0435\u043D\u0434\u0435\u0440\u0435 (\u0441\u0442\u0430\u0440\u044B\u0439 \u0441\u0442\u0430\u0442\u0443\u0441)", c: "var(--t-warn)" },
  { id: "review", label: "\u041D\u0430 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0435 (\u0441\u0442\u0430\u0440\u044B\u0439 \u0441\u0442\u0430\u0442\u0443\u0441)", c: "var(--t-neutral)" },
  { id: "waiting", label: "\u0412 \u043E\u0436\u0438\u0434\u0430\u043D\u0438\u0438 (\u0441\u0442\u0430\u0440\u044B\u0439 \u0441\u0442\u0430\u0442\u0443\u0441)", c: "var(--t-neutral)" },
  { id: "partial", label: "\u0427\u0430\u0441\u0442\u0438\u0447\u043D\u043E \u043E\u043F\u043B\u0430\u0447\u0435\u043D\u043E (\u0441\u0442\u0430\u0440\u044B\u0439 \u0441\u0442\u0430\u0442\u0443\u0441)", c: "var(--t-neutral)" },
  { id: "closed", label: "\u0417\u0430\u043A\u0440\u044B\u0442\u043E (\u0441\u0442\u0430\u0440\u044B\u0439 \u0441\u0442\u0430\u0442\u0443\u0441)", c: "var(--t-neutral)" },
  { id: "cancelled", label: "\u041E\u0442\u043C\u0435\u043D\u0435\u043D\u043E (\u0441\u0442\u0430\u0440\u044B\u0439 \u0441\u0442\u0430\u0442\u0443\u0441)", c: "var(--t-bad)" },
  { id: "shipped", label: "\u041E\u0442\u0433\u0440\u0443\u0436\u0435\u043D\u043E (\u0441\u0442\u0430\u0440\u044B\u0439 \u0441\u0442\u0430\u0442\u0443\u0441)", c: "var(--t-neutral)" },
  { id: "settled", label: "\u0420\u0430\u0441\u0441\u0447\u0438\u0442\u0430\u043D\u043E (\u0441\u0442\u0430\u0440\u044B\u0439 \u0441\u0442\u0430\u0442\u0443\u0441)", c: "var(--t-neutral)" }
];
var stById = (id) => OBJ_STATUSES.find((s) => s.id === id) || OLD_STATUSES.find((s) => s.id === id) || OBJ_STATUSES[0];
var opLabel = (id) => (OP_TYPES.find((o) => o.id === id) || {}).label || id;
var isRefund = (o) => !!o && o.type === "client_payment" && Number(o.amount) < 0;
var REFUND_LABEL = "\u0412\u043E\u0437\u0432\u0440\u0430\u0442 \u0434\u0435\u043D\u0435\u0433 \u043A\u043B\u0438\u0435\u043D\u0442\u0443";
var opName = (o) => isRefund(o) ? REFUND_LABEL : opLabel(o && o.type);
var _opsIdx = /* @__PURE__ */ new WeakMap();
var opsOf = (ops, objId) => {
  if (!ops || !ops.length) return [];
  let m = _opsIdx.get(ops);
  if (!m) {
    m = /* @__PURE__ */ new Map();
    ops.forEach((x) => {
      if (x.object_id) {
        let a = m.get(x.object_id);
        if (!a) m.set(x.object_id, a = []);
        a.push(x);
      }
    });
    _opsIdx.set(ops, m);
  }
  return m.get(objId) || [];
};
var EXP_CLIENT = "client";
function calcObject(obj, ops) {
  const items = obj.items || [];
  let sale = 0, cost = 0;
  items.forEach((i) => {
    sale += (i.qty || 0) * (i.price || 0);
    cost += (i.qty || 0) * (i.cost || 0);
  });
  const o = opsOf(ops, obj.id).filter((x) => !x.voided);
  const sum = (t, f = "amount") => o.filter((x) => x.type === t).reduce((a, x) => a + (x[f] || 0), 0);
  const retSale = sum("return"), retCost = sum("return", "cost_amount");
  const discount = sum("discount"), expense = sum("expense"), bonus = sum("bonus");
  const clientExp = round2(o.filter((x) => x.type === "expense" && x.size === EXP_CLIENT).reduce((a, x) => a + (x.amount || 0), 0));
  const paidAll = sum("client_payment"), paidSup = sum("supplier_payment");
  const paidClient = payLive(obj) ? paidAll : 0;
  const saleNet = sale - retSale - discount + clientExp;
  const costNet = cost - retCost;
  const gross = saleNet - costNet;
  const net = gross - expense - bonus;
  return {
    sale,
    cost,
    retSale,
    retCost,
    discount,
    expense,
    clientExp,
    bonus,
    paidClient,
    paidSup,
    paidIgnored: round2(paidAll - paidClient),
    saleNet,
    costNet,
    gross,
    net,
    margin: saleNet > 0 ? gross / saleNet * 100 : 0,
    clientDebt: round2(saleNet - paidClient),
    // округление: без «долга» 0,0000001 от сложения дробных сумм
    supplierDebt: Math.max(0, round2(costNet - paidSup))
  };
}
var _retCache = { ops: null, wh: null, ids: null };
function supplierReturnIds(ops, whMoves) {
  if (_retCache.ops === ops && _retCache.wh === whMoves && _retCache.ids) return _retCache.ids;
  const key = (o) => o.object_id + "|" + (o.product_id || "") + "|" + Number(o.qty || 0) + "|" + String(o.op_date || o.created_at || "").slice(0, 10);
  const inWh = {};
  (whMoves || []).forEach((w) => {
    if (w.dir === "in" && w.object_id) {
      const k = key(w);
      inWh[k] = (inWh[k] || 0) + 1;
    }
  });
  const rets = (ops || []).filter((x) => x.type === "return");
  const take = (x) => {
    const k = key(x);
    if (inWh[k]) {
      inWh[k]--;
      return true;
    }
    return false;
  };
  rets.forEach((x) => {
    if (x.object_id && !x.supplier_id) take(x);
  });
  rets.forEach((x) => {
    if (x.object_id && x.supplier_id && x.voided) take(x);
  });
  const ids = /* @__PURE__ */ new Set();
  rets.forEach((x) => {
    if (x.voided || !x.supplier_id) return;
    if (!x.object_id) {
      ids.add(x.id);
      return;
    }
    if (!take(x)) ids.add(x.id);
  });
  _retCache = { ops, wh: whMoves, ids };
  return ids;
}
function supplierStats(sup, objects, ops, whMoves) {
  let purchases = 0;
  objects.forEach((ob) => {
    if (!isLive(ob)) return;
    (ob.items || []).forEach((i) => {
      if (i.supplier_id === sup.id && !i.from_warehouse && isShipped(i)) purchases += (i.qty || 0) * (i.cost || 0);
    });
  });
  const ids = supplierReturnIds(ops, whMoves);
  const o = ops.filter((x) => !x.voided && x.supplier_id === sup.id);
  purchases += o.filter((x) => x.type === "wh_purchase").reduce((a, x) => a + (x.cost_amount || 0), 0);
  const paid = o.filter((x) => x.type === "supplier_payment").reduce((a, x) => a + (x.amount || 0), 0);
  const returns = o.filter((x) => x.type === "return" && ids.has(x.id)).reduce((a, x) => a + (x.cost_amount || 0), 0);
  const balance = round2(purchases - returns - paid);
  return { purchases: round2(purchases), paid: round2(paid), returns: round2(returns), balance, debt: Math.max(0, balance) };
}
var XL_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
var XL_FONT = (name, b, sz, red, it) => "<font>" + (b ? "<b/>" : "") + (it ? "<i/>" : "") + '<sz val="' + sz + '"/>' + (red === 2 ? '<color rgb="FF00873C"/>' : red ? '<color rgb="FFC00000"/>' : "") + '<name val="' + name + '"/></font>';
var XL_TXT = "Baskerville Old Face";
var XL_NUM = "Times New Roman";
var XL_XF = (num, font, border, extra = "", align = "") => '<xf numFmtId="' + num + '" fontId="' + font + '" fillId="' + (extra === "fill" ? 2 : 0) + '" borderId="' + border + '" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' + (align ? "<alignment " + align + "/>" : "") + "</xf>";
var XL_STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="#,##0.00##"/></numFmts><fonts count="12">' + XL_FONT(XL_TXT, 0, 11) + XL_FONT(XL_TXT, 1, 11) + XL_FONT(XL_TXT, 1, 14) + XL_FONT(XL_NUM, 0, 11) + XL_FONT(XL_NUM, 1, 11) + XL_FONT(XL_TXT, 0, 11, 1) + XL_FONT(XL_NUM, 0, 11, 1) + XL_FONT(XL_TXT, 1, 11, 1) + XL_FONT(XL_NUM, 1, 11, 1) + XL_FONT(XL_NUM, 0, 11, 2) + XL_FONT(XL_NUM, 1, 11, 2) + XL_FONT(XL_TXT, 1, 28, 1, 1) + '</fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8E8E8"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="32">' + XL_XF(0, 0, 0) + XL_XF(0, 2, 0) + XL_XF(0, 1, 0) + XL_XF(0, 1, 1, "fill", 'horizontal="center" vertical="center" wrapText="1"') + XL_XF(0, 0, 1, "", 'vertical="center" wrapText="1"') + XL_XF(0, 0, 1, "", 'horizontal="center" vertical="center"') + XL_XF(164, 0, 1, "", 'vertical="center"') + XL_XF(0, 1, 1, "", 'horizontal="right" vertical="center"') + XL_XF(164, 1, 1) + XL_XF(0, 0, 1, "", 'horizontal="center" vertical="center"') + XL_XF(0, 3, 1, "", 'horizontal="center" vertical="center"') + XL_XF(164, 3, 1, "", 'vertical="center"') + XL_XF(164, 4, 1) + XL_XF(0, 3, 1, "", 'horizontal="center" vertical="center"') + XL_XF(0, 3, 0) + XL_XF(0, 5, 1, "", 'vertical="center" wrapText="1"') + XL_XF(0, 6, 1, "", 'horizontal="center" vertical="center"') + XL_XF(164, 6, 1, "", 'vertical="center"') + XL_XF(0, 7, 1, "", 'horizontal="right" vertical="center"') + XL_XF(164, 8, 1) + XL_XF(0, 6, 1, "", 'horizontal="center" vertical="center"') + XL_XF(0, 5, 1, "", 'horizontal="center" vertical="center"') + XL_XF(0, 7, 0) + XL_XF(164, 9, 1, "", 'vertical="center"') + XL_XF(164, 10, 1) + XL_XF(0, 11, 1, "", 'horizontal="center" vertical="center"') + XL_XF(165, 3, 1, "", 'vertical="center"') + XL_XF(165, 6, 1, "", 'vertical="center"') + XL_XF(0, 1, 0, "", 'horizontal="center" vertical="center"') + XL_XF(164, 4, 0, "", 'vertical="center"') + XL_XF(0, 7, 0, "", 'horizontal="center" vertical="center"') + XL_XF(164, 8, 0, "", 'vertical="center"') + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
var PeopleCtx = (0, import_react.createContext)({ people: [], addPerson: () => {
} });
var PAY_METHODS = [
  { id: "usd", label: "\u041D\u0430\u043B\u0438\u0447\u043D\u044B\u0435 $", cur: "usd" },
  { id: "uzs", label: "\u041D\u0430\u043B\u0438\u0447\u043D\u044B\u0435 \u0441\u0443\u043C", cur: "uzs" },
  { id: "card", label: "\u041A\u0430\u0440\u0442\u0430", cur: null },
  // валюту выбирают
  { id: "transfer", label: "\u041F\u0435\u0440\u0435\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u0435", cur: null, def: "uzs" }
  // валюту выбирают, по умолчанию сум
];
var PAY_IN_TYPES = ["client_payment", "company_income"];
var PAY_OUT_TYPES = ["supplier_payment", "expense", "company_expense", "bonus_payment"];
var isPayType = (t) => PAY_IN_TYPES.includes(t) || PAY_OUT_TYPES.includes(t);
var RATE_KEY = "te:usd_rate";
var RATE_MIN = 1e3;
var rateOk = (r) => Number(r) >= RATE_MIN;
var round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
var parseNum = (x) => Number(String(x || "").replace(/[\s\u00a0\u202f]/g, "").replace(",", ".")) || 0;
var payMethod = (id) => PAY_METHODS.find((m) => m.id === id) || PAY_METHODS[0];
var SUM_RATE_RE = /([\d\s\u00a0\u202f.,]+)\s*\u0441\u0443\u043c\s*\u00d7\s*\u043a\u0443\u0440\u0441\s*([\d\s\u00a0\u202f.,]+)/;
function payInfo(op) {
  if (!op || op.type && !isPayType(op.type) && op.type !== "bonus") return { id: null, cur: null, uzs: 0, rate: 0 };
  let m = op.pay_method ? PAY_METHODS.find((x) => x.id === op.pay_method) : null;
  if (!m && op.type === "client_payment" && op.category) m = PAY_METHODS.find((x) => x.label === op.category);
  if (!m && op.reason) m = PAY_METHODS.find((x) => String(op.reason).startsWith(x.label));
  if (!m) return { id: null, cur: null, uzs: 0, rate: 0 };
  const r = op.reason ? SUM_RATE_RE.exec(op.reason) : null;
  const cur = op.pay_currency ? String(op.pay_currency).toLowerCase() : r ? "uzs" : m.cur || "usd";
  let uzs = cur === "uzs" ? op.pay_currency && Number(op.pay_amount) || (r ? parseNum(r[1]) : 0) : 0;
  if (Number(op.amount) < 0 && uzs > 0) uzs = -uzs;
  const rate = cur === "uzs" ? Number(op.pay_rate) || (r ? parseNum(r[2]) : 0) : 0;
  return { id: m.id, label: m.label, cur, uzs, rate };
}
function payText(op) {
  const i = payInfo(op);
  if (!i.id) return "";
  return i.cur === "uzs" ? i.label + ": " + fmt(Math.abs(i.uzs)) + " \u0441\u0443\u043C" + (i.rate ? " \xD7 \u043A\u0443\u0440\u0441 " + fmt(i.rate) + (rateOk(i.rate) ? "" : " \u26A0 \u043A\u0443\u0440\u0441 \u043D\u0435\u0432\u0435\u0440\u043D\u044B\u0439") : "") : i.label + (payMethod(i.id).cur === null ? " ($)" : "");
}
var uzsOk = (u) => Number(u) >= 1e3;
var payUsd = (p) => p.cur === "uzs" ? rateOk(p.rate) && uzsOk(p.uzs) ? round2(Number(p.uzs) / Number(p.rate)) : 0 : round2(p.usd);
function payPatch(p, type = "client_payment", remember = true) {
  const m = payMethod(p.method), usd = payUsd(p);
  const reason = p.cur === "uzs" ? m.label + ": " + fmt(p.uzs) + " \u0441\u0443\u043C \xD7 \u043A\u0443\u0440\u0441 " + fmt(p.rate) : m.label + (m.cur === null ? " ($)" : "");
  if (remember && p.cur === "uzs" && rateOk(p.rate)) {
    try {
      localStorage.setItem(RATE_KEY, String(p.rate));
    } catch (e) {
    }
  }
  const out = {
    amount: usd,
    reason,
    pay_method: m.id,
    pay_currency: p.cur.toUpperCase(),
    pay_amount: p.cur === "uzs" ? Number(p.uzs) || 0 : usd,
    pay_rate: p.cur === "uzs" ? Number(p.rate) || null : null
  };
  if (type === "client_payment") out.category = m.label;
  return out;
}
var SEL_SETTER = typeof HTMLSelectElement !== "undefined" ? Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set : null;
var TR_MAP = { \u0430: "a", \u0431: "b", \u0432: "v", \u0433: "g", \u0434: "d", \u0435: "e", \u0451: "yo", \u0436: "j", \u0437: "z", \u0438: "i", \u0439: "y", \u043A: "k", \u043B: "l", \u043C: "m", \u043D: "n", \u043E: "o", \u043F: "p", \u0440: "r", \u0441: "s", \u0442: "t", \u0443: "u", \u0444: "f", \u0445: "x", \u0446: "ts", \u0447: "ch", \u0448: "sh", \u0449: "shch", \u044A: "", \u044B: "i", \u044C: "", \u044D: "e", \u044E: "yu", \u044F: "ya", \u045E: "o\u2018", \u049B: "q", \u0493: "g\u2018", \u04B3: "h" };
var CYR_RE = /[а-яёўқғҳ]/i;
function translit(str) {
  const s = String(str == null ? "" : str);
  if (!CYR_RE.test(s)) return s;
  return s.replace(/[А-ЯЁЎҚҒҲа-яёўқғҳ]+/g, (w) => {
    const up = w.length > 1 && w === w.toUpperCase();
    let out = "";
    for (let i = 0; i < w.length; i++) {
      const ch = w[i], lo = ch.toLowerCase(), t = TR_MAP[lo] != null ? TR_MAP[lo] : ch;
      out += ch !== lo ? up ? t.toUpperCase() : t.charAt(0).toUpperCase() + t.slice(1) : t;
    }
    return out;
  });
}
var PROD_ROW_H = 46;
var normPName = (x) => String(x || "").toLowerCase().replace(/ё/g, "\u0435").replace(/[«»"“”„'`]/g, "").replace(/\s+/g, " ").trim();
var RU_COLLATOR = new Intl.Collator("ru");
var ProductRow = (0, import_react.memo)(function ProductRow2({ p, checked, sup, onToggle, onEdit }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { style: { height: PROD_ROW_H, opacity: p.status === "archive" ? 0.45 : 1, background: checked ? "var(--acc-tint)" : "none" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked, onChange: () => onToggle(p.id) }) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { className: "mono xs", children: p.code }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { className: "sm", children: p.brand }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { className: "sm", children: sup }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", { title: p.name, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontWeight: 600 }, children: p.name }),
      (p.category || p.alt_names) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "xs mut", children: [p.category, p.alt_names].filter(Boolean).join(" \xB7 ") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { className: "sm", children: p.unit }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { className: "num", children: fmt2(p.cost) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { className: "num", children: Number(p.price) > 0 ? fmt2(p.price) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "mut", title: "\u0420\u043E\u0437\u043D\u0438\u0447\u043D\u0430\u044F \u0446\u0435\u043D\u0430 \u043D\u0435 \u0437\u0430\u0434\u0430\u043D\u0430 \u2014 \u043F\u0440\u0438 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u0438 \u0432 \u043E\u0431\u044A\u0435\u043A\u0442: \u0441\u0435\u0431\u0435\u0441\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C + " + DEFAULT_MARKUP + "%", children: [
      "\u2248 ",
      fmt2(retailOf(p))
    ] }) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "btn xs", onClick: () => onEdit(p), children: "\u0440\u0435\u0434." }) })
  ] });
});
var INCOME_CATEGORIES = ["\u0418\u043D\u0432\u0435\u0441\u0442\u0438\u0446\u0438\u044F / \u0432\u043B\u043E\u0436\u0435\u043D\u0438\u0435", "\u0417\u0430\u0439\u043C", "\u0412\u043E\u0437\u0432\u0440\u0430\u0442 \u0434\u043E\u043B\u0433\u0430", "\u0410\u0440\u0435\u043D\u0434\u0430 (\u0434\u043E\u0445\u043E\u0434)", "\u041F\u0440\u043E\u0434\u0430\u0436\u0430 \u0438\u043C\u0443\u0449\u0435\u0441\u0442\u0432\u0430", "\u041F\u0440\u043E\u0447\u0435\u0435"];
var KASSA_TYPES = ["company_income", "client_payment", "company_expense", "expense", "bonus_payment", "supplier_payment"];
var KASSA_IN_T = ["company_income", "client_payment"];
var KASSA_DEF = ["company_income", "company_expense", "expense", "bonus_payment"];
var KASSA_KEYS = ["uzs", "usd", "card", "cardUsd"];
var fmtDot = (n) => {
  const r = Math.round(Math.abs(Number(n) || 0) * 100) / 100;
  const [i, d] = r.toFixed(2).split(".");
  return (Number(n) < 0 && r ? "-" : "") + i.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (d === "00" ? "" : "," + d.replace(/0$/, ""));
};
var isoAddDays = (iso, n) => {
  const d = /* @__PURE__ */ new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return localIso(d);
};
var kIsUsd = (b) => b === "usd" || b === "cardUsd";
var kLineAmt = (r) => fmtDot(r.amt) + (kIsUsd(r.bucket) ? " $" : " sum") + (r.transfer ? " (perechisleniye)" : r.bucket === "card" || r.bucket === "cardUsd" ? " (karta)" : "");
function kassaOps(data, ops, from, to = from) {
  const objById = {};
  (data.objects || []).forEach((o) => {
    objById[o.id] = o;
  });
  const supName = (id) => ((data.suppliers || []).find((s) => s.id === id) || {}).name || "";
  const mName = (id) => ((data.masters || []).find((s) => s.id === id) || {}).name || "";
  const list = [];
  ops.filter((x) => {
    if (x.voided || !KASSA_TYPES.includes(x.type)) return false;
    const d = String(x.op_date || x.created_at || "").slice(0, 10);
    return d >= from && d <= to;
  }).sort((a, b) => String(a.op_date || "").localeCompare(String(b.op_date || "")) || String(a.created_at || "").localeCompare(String(b.created_at || ""))).forEach((x) => {
    const o = x.object_id ? objById[x.object_id] : null;
    if (x.object_id && (!o || !isLive(o) || x.type === "client_payment" && !payLive(o))) return;
    const i = payInfo(x);
    const inUzs = i.cur === "uzs";
    const ref = isRefund(x);
    const raw = inUzs ? Number(i.uzs) || 0 : Number(x.amount) || 0;
    const amt = ref ? Math.abs(raw) : raw;
    if (!amt) return;
    const nonCash = i.id === "card" || i.id === "transfer";
    const bucket = nonCash ? inUzs ? "card" : "cardUsd" : inUzs ? "uzs" : "usd";
    const transfer = i.id === "transfer";
    const s = salaryInfo(x);
    let type, rest;
    if (ref) {
      type = REFUND_LABEL;
      rest = [o && o.name, x.note];
    } else if (x.type === "client_payment") {
      type = "\u041E\u043F\u043B\u0430\u0442\u0430 \u043A\u043B\u0438\u0435\u043D\u0442\u0430";
      rest = [o && o.name, x.note];
    } else if (x.type === "supplier_payment") {
      type = "\u041E\u043F\u043B\u0430\u0442\u0430 \u043F\u043E\u0441\u0442\u0430\u0432\u0449\u0438\u043A\u0443";
      rest = [supName(x.supplier_id) || "\u043F\u043E\u0441\u0442\u0430\u0432\u0449\u0438\u043A \u043D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D", x.note];
    } else if (x.type === "bonus_payment") {
      type = "\u0411\u043E\u043D\u0443\u0441 \u043C\u0430\u0441\u0442\u0435\u0440\u0443";
      rest = [mName(x.master_id) || x.product_name, x.note];
    } else if (x.type === "expense") {
      type = "\u0414\u043E\u043F. \u0440\u0430\u0441\u0445\u043E\u0434";
      rest = [o && o.name, x.note];
    } else if (s) {
      type = [x.category, s.kind && s.kind !== x.category ? s.kind.toLowerCase() : ""].filter(Boolean).join(" ");
      rest = [s.emp, s.note];
    } else {
      type = x.category || opLabel(x.type);
      rest = [x.note];
    }
    list.push({
      id: x.id,
      t: ref ? "client_refund" : x.type,
      dir: KASSA_IN_T.includes(x.type) && !ref ? "in" : "out",
      bucket,
      amt,
      transfer,
      label: [type, ...rest].filter(Boolean).join(", "),
      short: rest.filter(Boolean).join(", "),
      def: KASSA_DEF.includes(x.type) && !transfer
    });
  });
  return list;
}
function kassaBal(open, lines, conv) {
  const b = {};
  KASSA_KEYS.forEach((k) => {
    b[k] = parseNum(open[k]);
  });
  lines.forEach((r) => {
    b[r.bucket] += r.dir === "in" ? r.amt : -r.amt;
  });
  (conv || []).filter((c) => parseNum(c.usd) > 0 && parseNum(c.uzs) > 0).forEach((c) => {
    const a = parseNum(c.usd), u = parseNum(c.uzs);
    if (c.dir === "uzs2usd") {
      b.uzs -= u;
      b.usd += a;
    } else {
      b.usd -= a;
      b.uzs += u;
    }
  });
  KASSA_KEYS.forEach((k) => {
    b[k] = round2(b[k]);
  });
  return b;
}
function kassaText({ open, sys, manual, conv }) {
  const line = (r, what) => kLineAmt(r) + (what ? " - " + what : "");
  const on = sys.filter((r) => r.on);
  const man = (manual || []).filter((m) => parseNum(m.amt) > 0).map((m) => ({ dir: m.dir, bucket: m.bucket, amt: parseNum(m.amt), label: String(m.note || "").trim(), on: m.on !== false }));
  const counted = [...on, ...man.filter((m) => m.on)];
  const bal = kassaBal(open, counted, conv);
  const o = {};
  KASSA_KEYS.forEach((k) => {
    o[k] = parseNum(open[k]);
  });
  const showCard = KASSA_KEYS.slice(2).some((k) => o[k] || bal[k]) || counted.some((r) => r.bucket === "card" || r.bucket === "cardUsd");
  const money = (b) => fmtDot(b.uzs) + " sum va " + fmtDot(b.usd) + " $" + (showCard ? ", karta " + [b.card || !b.cardUsd ? fmtDot(b.card) + " sum" : "", b.cardUsd ? fmtDot(b.cardUsd) + " $" : ""].filter(Boolean).join(" va ") : "");
  const cv = (conv || []).filter((c) => parseNum(c.usd) > 0 && parseNum(c.uzs) > 0);
  const inc = counted.filter((r) => r.dir === "in"), out = counted.filter((r) => r.dir === "out");
  const parts = ["Kechagi kundan ostatka :\n" + money(o)];
  if (inc.length) parts[0] += "\nPrixod :\n" + inc.map((r) => line(r, r.label)).join("\n");
  if (cv.length) parts.push("Konvertatsiya :\n" + cv.map((c) => c.dir === "uzs2usd" ? fmtDot(parseNum(c.uzs)) + " sum - " + fmtDot(parseNum(c.usd)) + "$" : fmtDot(parseNum(c.usd)) + "$ - " + fmtDot(parseNum(c.uzs)) + " sum").join("\n"));
  if (out.length) parts.push("Rasxod :\n" + out.map((r) => line(r, r.label)).join("\n"));
  parts.push("Ostatka : " + money(bal));
  const off = sys.filter((r) => !r.on), info = [];
  const cli = off.filter((r) => r.t === "client_payment"), sup = off.filter((r) => r.t === "supplier_payment"), other = off.filter((r) => r.t !== "client_payment" && r.t !== "supplier_payment");
  if (cli.length) info.push("Klient to'lovlari :\n" + cli.map((r) => line(r, r.short)).join("\n"));
  if (sup.length) info.push("Postavshiklarga to'lov :\n" + sup.map((r) => line(r, r.short)).join("\n"));
  const rest = [...other, ...man.filter((m) => !m.on)];
  if (rest.length) info.push("Kassaga kirmagan :\n" + rest.map((r) => (r.dir === "in" ? "+" : "\u2212") + line(r, r.label)).join("\n"));
  const main = parts.join("\n\n"), supText = info.join("\n\n");
  return { text: main + (supText ? "\n\n" + supText : ""), main, supText, close: bal, showCard };
}
var ErrBoundary = class extends import_react.default.Component {
  constructor(p) {
    super(p);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  componentDidCatch(err, info) {
    console.error(err, info);
  }
  render() {
    if (this.state.err) {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { fontFamily: "monospace", background: "#101216", color: "#e25563", minHeight: "100vh", padding: 24, fontSize: 13 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { color: "#e8eaef", fontWeight: 700, marginBottom: 10 }, children: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u044F \u2014 \u043E\u0442\u043F\u0440\u0430\u0432\u044C \u044D\u0442\u043E\u0442 \u0442\u0435\u043A\u0441\u0442 \u0432 \u0447\u0430\u0442:" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { style: { whiteSpace: "pre-wrap" }, children: String(this.state.err && (this.state.err.stack || this.state.err.message || this.state.err)) })
      ] });
    }
    return this.props.children;
  }
};
export {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  KASSA_KEYS,
  LOG_HIDDEN,
  PAY_METHODS,
  PERMS,
  SALARY_CAT,
  accessOf,
  allRoles,
  calcObject,
  fmt,
  fmt2,
  fmtDot,
  isLive,
  isoAddDays,
  kassaBal,
  kassaOps,
  kassaText,
  normFinOp,
  normPName,
  opName,
  payInfo,
  payPatch,
  payText,
  retailOf,
  round2,
  stById,
  supplierStats,
  translit,
  userPermsOf
};
/*! Bundled license information:

react/cjs/react.production.js:
  (**
   * @license React
   * react.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

react/cjs/react-jsx-runtime.production.js:
  (**
   * @license React
   * react-jsx-runtime.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)
*/
