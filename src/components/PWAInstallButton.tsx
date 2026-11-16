import React, { useState } from 'react';
import { Download, Smartphone } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWA';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-blue-500 hover:bg-blue-400 text-white text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
      >
        <Download className="w-3.5 h-3.5" />
        Install MAHAVIR App
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="min-h-[40px] px-3.5 py-1.5 rounded-xl border border-slate-700 bg-[#0A0F18] hover:bg-slate-800 text-slate-200 text-xs font-medium flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
        >
          <Smartphone className="w-3.5 h-3.5 text-blue-400" />
          Install Mobile App
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="w-full max-w-sm rounded-2xl bg-[#111827] border border-slate-800 p-6 space-y-4">
              <h3 className="text-base font-semibold text-white">Install MAHAVIR on Mobile</h3>
              <p className="text-sm text-slate-300 leading-relaxed">
                1. Tap the <strong>Share</strong> button in your browser toolbar.
                <br />
                2. Scroll down and tap <strong>Add to Home Screen</strong> for full-screen offline
                editing.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full min-h-[44px] rounded-xl bg-emerald-500 text-slate-950 font-semibold text-sm"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
