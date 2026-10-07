/**
 * Notification Types
 */

export enum NotificationType {
  PROJECT_INVITE = 'PROJECT_INVITE',
  PROJECT_REMOVAL = 'PROJECT_REMOVAL',
  PROJECT_UPDATE = 'PROJECT_UPDATE',
  PROJECT_LEAVE = 'PROJECT_LEAVE',
  SYSTEM = 'SYSTEM',
  /** Avisos de facturacion de la cuenta (pago fallido, fin de prueba, reembolso). No pertenecen a ningun proyecto. */
  BILLING = 'BILLING',
}

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  isRead: boolean;
  projectId?: string;
  createdAt: string;
}

export interface MarkReadRequest {
  notificationIds: string[];
}
