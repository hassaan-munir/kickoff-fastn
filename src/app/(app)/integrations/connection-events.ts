// A tiny browser event so the status panel refreshes when the widget reports a change.
const EVENT = "kickoff:connections-changed";

export function notifyConnectionsChanged() {
  window.dispatchEvent(new Event(EVENT));
}

export function onConnectionsChanged(handler: () => void) {
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
