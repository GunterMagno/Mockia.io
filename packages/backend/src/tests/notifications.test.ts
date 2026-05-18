import request from 'supertest';
import app from '../index.js';
import { UserModel } from '../models/User.js';
import { NotificationModel } from '../models/Notification.js';
import * as NotificationService from '../services/notification.service.js';
import { connectDB, disconnectDB } from '../config/connection.js';
import { NotificationType } from '@mockia/shared';
import bcrypt from 'bcrypt';

describe('Notifications API (notification.routes)', () => {
  let accessToken: string;
  let userId: string;
  let testNotificationId: string;

  beforeAll(async () => {
    try {
      await connectDB();
      await UserModel.deleteMany({});
      await NotificationModel.deleteMany({});

      // 1. Create a test user
      const hashedPassword = await bcrypt.hash('testpassword123', 10);
      const user = await UserModel.create({
        email: 'testnotifications@example.com',
        username: 'testnotificationsuser',
        passwordHash: hashedPassword,
      });
      userId = user._id.toString();

      // 2. Log in to retrieve JWT token
      const loginRes = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send({
          email: 'testnotifications@example.com',
          password: 'testpassword123',
        });

      accessToken = loginRes.body.data.tokens.accessToken;

      // 3. Create dummy notifications for the user
      const notif1 = await NotificationService.createNotification({
        userId,
        type: NotificationType.SYSTEM,
        title: 'Project Imported',
        message: 'Your project has been successfully imported from GitHub.',
      });
      testNotificationId = notif1.id;

      await NotificationService.createNotification({
        userId,
        type: NotificationType.PROJECT_UPDATE,
        title: 'Welcome!',
        message: 'Welcome to Mockia.io final project evaluation.',
      });

    } catch (error) {
      console.error('Error in beforeAll of notifications test:', error);
    }
  });

  afterAll(async () => {
    try {
      await UserModel.deleteMany({});
      await NotificationModel.deleteMany({});
      await disconnectDB();
    } catch (error) {
      console.error('Error in afterAll of notifications test:', error);
    }
  });

  describe('GET /api/notifications', () => {
    it('should block retrieval without token (401)', async () => {
      const response = await request(app)
        .get('/api/notifications');

      expect(response.status).toBe(401);
    });

    it('should retrieve list of notifications for the active user (200)', async () => {
      const response = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data.length).toBe(2);
      expect(response.body.data[0]).toHaveProperty('title');
      expect(response.body.data[0]).toHaveProperty('isRead', false);
    });
  });

  describe('POST /api/notifications/mark-read', () => {
    it('should block updates without token (401)', async () => {
      const response = await request(app)
        .post('/api/notifications/mark-read')
        .send({ notificationIds: [testNotificationId] });

      expect(response.status).toBe(401);
    });

    it('should mark specified notifications as read (200)', async () => {
      const response = await request(app)
        .post('/api/notifications/mark-read')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ notificationIds: [testNotificationId] });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message', 'Notifications marked as read');

      // Double check in DB
      const updatedNotif = await NotificationModel.findById(testNotificationId);
      expect(updatedNotif?.isRead).toBe(true);
    });
  });

  describe('DELETE /api/notifications/:id', () => {
    it('should block deletion without token (401)', async () => {
      const response = await request(app)
        .delete(`/api/notifications/${testNotificationId}`);

      expect(response.status).toBe(401);
    });

    it('should delete a specific notification (200)', async () => {
      const response = await request(app)
        .delete(`/api/notifications/${testNotificationId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message', 'Notification deleted');

      // Verify deletion in DB
      const deletedNotif = await NotificationModel.findById(testNotificationId);
      expect(deletedNotif).toBeNull();
    });
  });
});
