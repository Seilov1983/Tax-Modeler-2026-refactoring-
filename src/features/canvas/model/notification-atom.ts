/**
 * notification-atom.ts — Global toast notification for canvas validation errors.
 *
 * Used by spatial validation in CanvasZone/CanvasNode to alert users when
 * entities are placed outside their designated parent boundaries.
 */

import { atom } from 'jotai';

export interface CanvasNotification {
  id: string;
  message: string;
  type: 'error' | 'warning' | 'info';
}

/** Current active notification — null means no notification shown */
export const notificationAtom = atom<CanvasNotification | null>(null);

/** Write-only atom to show a notification with auto-dismiss after 4 seconds */
export const showNotificationAtom = atom(
  null,
  (_get, set, notification: Omit<CanvasNotification, 'id'>) => {
    const id = Date.now().toString(36);
    set(notificationAtom, { ...notification, id });
    setTimeout(() => {
      set(notificationAtom, (prev) => (prev?.id === id ? null : prev));
    }, 4000);
  },
);
