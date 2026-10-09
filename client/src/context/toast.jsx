// A short status message at the bottom of the screen.

import { createContext, useCallback, useContext, useRef, useState } from "react";

var ToastContext = createContext(function () {});

export function ToastProvider({ children }) {
  var [msg, setMsg] = useState("");
  var [shown, setShown] = useState(false);
  var timer = useRef(null);
  var toast = useCallback(function (text) {
    setMsg(text);
    setShown(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(function () { setShown(false); }, 2600);
  }, []);
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className={"toast" + (shown ? " show" : "")} role="status" aria-live="polite">{msg}</div>
    </ToastContext.Provider>
  );
}

export function useToast() { return useContext(ToastContext); }
