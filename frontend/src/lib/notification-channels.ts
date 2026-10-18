/** Delivery availability shared by Settings and Alerts; no external service is connected yet. */
export const DELIVERY_CHANNELS = [
  { id: 'in-app', label: 'In-app alerts', available: true },
  { id: 'sms', label: 'SMS alerts', available: false },
  { id: 'email', label: 'Email briefings', available: false },
  { id: 'browser-push', label: 'Browser push', available: false },
] as const
