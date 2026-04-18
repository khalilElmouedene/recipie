"use client";
import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { AlertTriangle, X } from "lucide-react";

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

interface Pending extends ConfirmOptions {
  resolve: (v: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setPending({ ...opts, resolve });
    });
  }, []);

  const respond = (value: boolean) => {
    pending?.resolve(value);
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {pending && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => respond(false)} />
          <div className="relative bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
            <button onClick={() => respond(false)} className="absolute top-4 right-4 text-gray-500 hover:text-gray-300">
              <X size={18} />
            </button>
            <div className="flex items-start gap-3">
              <AlertTriangle size={22} className={pending.danger ? "text-red-400 flex-shrink-0 mt-0.5" : "text-amber-400 flex-shrink-0 mt-0.5"} />
              <div>
                {pending.title && <p className="text-white font-semibold text-base mb-1">{pending.title}</p>}
                <p className="text-gray-300 text-sm leading-relaxed">{pending.message}</p>
              </div>
            </div>
            <div className="flex gap-3 justify-end mt-1">
              <button
                onClick={() => respond(false)}
                className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium transition"
              >
                Cancel
              </button>
              <button
                onClick={() => respond(true)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  pending.danger
                    ? "bg-red-600 hover:bg-red-500 text-white"
                    : "bg-brand-500 hover:bg-brand-400 text-white"
                }`}
              >
                {pending.confirmLabel || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside ConfirmProvider");
  return ctx.confirm;
}
