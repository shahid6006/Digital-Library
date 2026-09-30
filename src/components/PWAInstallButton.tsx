import React, { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { Download, Share2, PlusSquare, X } from 'lucide-react';

interface PWAInstallButtonProps {
  className?: string;
  variant?: 'navbar' | 'banner' | 'card';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  className = '',
  variant = 'navbar',
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // If already running in standalone mode on home screen, hide
  if (isInstalled) {
    return null;
  }

  // If not installable and not iOS, return null
  if (!isInstallable && !isIOS) {
    return null;
  }

  const handleInstallClick = async () => {
    if (isInstallable) {
      await install();
    } else if (isIOS) {
      setShowIOSGuide(true);
    }
  };

  if (variant === 'banner') {
    return (
      <>
        <div className={`bg-gradient-to-r from-amber-800 to-amber-900 text-white rounded-xl p-4 shadow-md border border-amber-700/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${className}`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-700 flex items-center justify-center shrink-0 border border-amber-600/60 shadow-inner">
              <Download className="w-5 h-5 text-amber-200" />
            </div>
            <div>
              <h4 className="text-sm font-semibold tracking-wide">Install Digital Library App</h4>
              <p className="text-xs text-amber-200/90 mt-0.5">
                Add to your phone's home screen for one-tap attendance and live tracking.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleInstallClick}
            className="w-full sm:w-auto px-4 py-2 bg-white text-amber-950 hover:bg-amber-50 font-medium text-xs rounded-lg shadow-sm transition active:scale-98 cursor-pointer flex items-center justify-center gap-1.5 shrink-0"
          >
            <Download className="w-4 h-4 text-amber-800" />
            {isIOS ? 'Add to Home Screen' : 'Install App'}
          </button>
        </div>

        {/* iOS Step Guide Modal */}
        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-stone-200 animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between pb-3 border-b border-stone-100">
                <h3 className="text-base font-semibold text-stone-900 flex items-center gap-2">
                  <Download className="w-4 h-4 text-amber-700" />
                  Install on iPhone / iPad
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1 rounded-md text-stone-400 hover:text-stone-600 hover:bg-stone-100 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mt-4 space-y-3.5 text-xs text-stone-600 leading-relaxed">
                <div className="flex items-start gap-3 bg-stone-50 p-3 rounded-lg border border-stone-200/60">
                  <div className="w-6 h-6 rounded-full bg-amber-100 text-amber-800 font-bold flex items-center justify-center shrink-0 text-xs">
                    1
                  </div>
                  <div>
                    Tap the <strong className="text-stone-800 inline-flex items-center gap-1"><Share2 className="w-3.5 h-3.5 text-amber-700 inline" /> Share</strong> button in Safari's bottom toolbar.
                  </div>
                </div>

                <div className="flex items-start gap-3 bg-stone-50 p-3 rounded-lg border border-stone-200/60">
                  <div className="w-6 h-6 rounded-full bg-amber-100 text-amber-800 font-bold flex items-center justify-center shrink-0 text-xs">
                    2
                  </div>
                  <div>
                    Scroll down and tap <strong className="text-stone-800 inline-flex items-center gap-1"><PlusSquare className="w-3.5 h-3.5 text-amber-700 inline" /> Add to Home Screen</strong>.
                  </div>
                </div>

                <div className="flex items-start gap-3 bg-stone-50 p-3 rounded-lg border border-stone-200/60">
                  <div className="w-6 h-6 rounded-full bg-amber-100 text-amber-800 font-bold flex items-center justify-center shrink-0 text-xs">
                    3
                  </div>
                  <div>
                    Tap <strong className="text-stone-800">Add</strong> in the top right corner. The Digital Library icon will appear on your phone's home screen!
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-lg bg-amber-800 py-2.5 text-xs font-semibold text-white hover:bg-amber-900 transition cursor-pointer"
              >
                Got It
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  // Default navbar variant
  return (
    <>
      <button
        type="button"
        onClick={handleInstallClick}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200/80 transition active:scale-98 cursor-pointer shadow-2xs ${className}`}
        title="Install app to your home screen"
      >
        <Download className="w-3.5 h-3.5 text-amber-700" />
        <span className="hidden sm:inline">Install App</span>
        <span className="sm:hidden">Install</span>
      </button>

      {/* iOS Step Guide Modal */}
      {showIOSGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-stone-200 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-stone-100">
              <h3 className="text-base font-semibold text-stone-900 flex items-center gap-2">
                <Download className="w-4 h-4 text-amber-700" />
                Install on iPhone / iPad
              </h3>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="p-1 rounded-md text-stone-400 hover:text-stone-600 hover:bg-stone-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 space-y-3.5 text-xs text-stone-600 leading-relaxed">
              <div className="flex items-start gap-3 bg-stone-50 p-3 rounded-lg border border-stone-200/60">
                <div className="w-6 h-6 rounded-full bg-amber-100 text-amber-800 font-bold flex items-center justify-center shrink-0 text-xs">
                  1
                </div>
                <div>
                  Tap the <strong className="text-stone-800 inline-flex items-center gap-1"><Share2 className="w-3.5 h-3.5 text-amber-700 inline" /> Share</strong> button in Safari's bottom toolbar.
                </div>
              </div>

              <div className="flex items-start gap-3 bg-stone-50 p-3 rounded-lg border border-stone-200/60">
                <div className="w-6 h-6 rounded-full bg-amber-100 text-amber-800 font-bold flex items-center justify-center shrink-0 text-xs">
                  2
                </div>
                <div>
                  Scroll down and tap <strong className="text-stone-800 inline-flex items-center gap-1"><PlusSquare className="w-3.5 h-3.5 text-amber-700 inline" /> Add to Home Screen</strong>.
                </div>
              </div>

              <div className="flex items-start gap-3 bg-stone-50 p-3 rounded-lg border border-stone-200/60">
                <div className="w-6 h-6 rounded-full bg-amber-100 text-amber-800 font-bold flex items-center justify-center shrink-0 text-xs">
                  3
                </div>
                <div>
                  Tap <strong className="text-stone-800">Add</strong> in the top right corner. The Digital Library icon will appear on your phone's home screen!
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              className="mt-5 w-full rounded-lg bg-amber-800 py-2.5 text-xs font-semibold text-white hover:bg-amber-900 transition cursor-pointer"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </>
  );
};
