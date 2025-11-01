/**
 * Toast Notification System
 * 
 * This file provides a simple way to show temporary messages to the user.
 * Think of it like a pop-up notification that appears briefly and then disappears.
 * 
 * A "toast" is named after toast popping out of a toaster - it briefly appears,
 * shows you a message, then disappears automatically.
 * 
 * This is used throughout the app to show success messages, errors, or helpful hints.
 */

// Keep track of the timer that will hide the toast
// We need this so we can cancel it if a new toast appears before the old one finishes
let toastTimer = null;

/**
 * Creates or finds the toast element in the HTML page.
 * 
 * The toast element is a div that's hidden by default and appears when we want to show a message.
 * This function makes sure it exists before we try to use it.
 * 
 * @returns {HTMLElement|null} The toast element, or null if we can't create/find it
 */
function ensureToastEl() {
  // Try to find an existing toast element (it might already be in the HTML)
  let el = null;
  try { el = document.getElementById('toast'); } catch (_) { el = null; }
  
  // If it doesn't exist and we're in a browser environment, create it
  if (!el && typeof document !== 'undefined') {
    el = document.createElement('div');
    el.id = 'toast';
    // Add it to the page so it can be displayed
    document.body.appendChild(el);
  }
  return el;
}

/**
 * Show a toast message to the user.
 * 
 * This displays a temporary message at the bottom of the screen.
 * The message will automatically disappear after the specified duration.
 * 
 * If you call this while another toast is showing, it will replace the old message.
 * 
 * Examples:
 *   showToast('Settings saved!')           // Shows for 3 seconds (default)
 *   showToast('Loading...', 5000)          // Shows for 5 seconds
 *   showToast('Error: File not found', 2000) // Shows for 2 seconds
 * 
 * @param {string} message - The text to display in the toast
 * @param {number} [durationMs=3000] - How long to show the message in milliseconds (default: 3000 = 3 seconds)
 */
export function showToast(message, durationMs = 3000) {
  // Get the toast element (create it if needed)
  const el = ensureToastEl();
  if (!el) return; // Can't show toast if we can't create the element
  
  // Set the message text
  // We use String() to make sure it's text, and ?? '' handles null/undefined
  try { el.textContent = String(message ?? ''); } catch(_) {}
  
  // Make it visible by adding the 'visible' CSS class
  // The CSS file controls how this looks (fade in, position, etc.)
  try { el.classList.add('visible'); } catch(_) {}
  
  // Cancel any existing timer so multiple toasts don't overlap
  try {
    clearTimeout(toastTimer);
    // Also check for legacy timer (in case old code is still using it)
    if (typeof window !== 'undefined') clearTimeout(window.__toastTimer);
  } catch(_) {}
  
  // Calculate how long to show the message
  // Make sure it's a valid number, and default to 3000ms (3 seconds) if not
  const ms = (typeof durationMs === 'number' && isFinite(durationMs) && durationMs > 0) ? durationMs : 3000;
  
  // Set a timer to hide the toast after the specified duration
  toastTimer = setTimeout(() => {
    // Remove the 'visible' class to hide it (CSS handles the fade-out animation)
    try { el.classList.remove('visible'); } catch(_) {}
  }, ms);
  
  // Also store it in window for backward compatibility (in case old code uses it)
  if (typeof window !== 'undefined') window.__toastTimer = toastTimer;
}

/**
 * Cleanup toast resources.
 *
 * Clears the active toast timer to prevent memory leaks.
 * This should be called when the application is shutting down.
 */
export function cleanupToast() {
  try {
    clearTimeout(toastTimer);
    toastTimer = null;
    if (typeof window !== 'undefined') {
      clearTimeout(window.__toastTimer);
      delete window.__toastTimer;
    }
  } catch (_) {}
}
