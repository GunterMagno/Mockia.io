import { Router } from 'express';
import * as NotificationController from '../controllers/notification.controller.js';
import { authenticateToken } from '../middlewares/authenticateToken.js';

const router = Router();

// All notification routes require authentication
router.use(authenticateToken);

router.get('/', NotificationController.getNotifications);
router.post('/mark-read', NotificationController.markAsRead);
router.delete('/:id', NotificationController.deleteNotification);

export default router;
