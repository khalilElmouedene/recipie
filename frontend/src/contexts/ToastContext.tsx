"use client";
import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { CheckCircle, XCircle, Clock, AlertTriangle, X } from "lucide-react";

type ToastType = "success" | "error" | "info" | "warning";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: ToastType) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 6000);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value: ToastContextValue = {
    success: (msg) => addToast(msg, "success"),
    error: (msg) => addToast(msg, "error"),
    info: (msg) => addToast(msg, "info"),
    warning: (msg) => addToast(msg, "warning"),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed top-6 right-6 z-[200] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-3 px-5 py-3 rounded-xl shadow-2xl border backdrop-blur-sm animate-in slide-in-from-top-2 duration-300 max-w-sm ${
              t.type === "success" ? "bg-green-950/90 border-green-700/50 text-green-200" :
              t.type === "error"   ? "bg-red-950/90 border-red-700/50 text-red-200" :
              t.type === "warning" ? "bg-amber-950/90 border-amber-700/50 text-amber-200" :
                                     "bg-blue-950/90 border-blue-700/50 text-blue-200"
            }`}
          >
            {t.type === "success" && <CheckCircle size={18} className="text-green-400 flex-shrink-0" />}
            {t.type === "error"   && <XCircle size={18} className="text-red-400 flex-shrink-0" />}
            {t.type === "warning" && <AlertTriangle size={18} className="text-amber-400 flex-shrink-0" />}
            {t.type === "info"    && <Clock size={18} className="text-blue-400 flex-shrink-0" />}
            <span className="text-sm font-medium">{t.message}</span>
            <button onClick={() => dismiss(t.id)} className="ml-2 text-gray-400 hover:text-white transition flex-shrink-0">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
