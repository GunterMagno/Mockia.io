jest.mock('../services/mailer.js', () => ({
  ...jest.requireActual('../services/mailer.js'),
  sendMail: jest.fn(),
}));
jest.mock('../services/notification.service.js', () => ({
  createNotification: jest.fn().mockResolvedValue({}),
}));

import { sendMail } from '../services/mailer.js';
import { notifyPaymentFailed } from '../modules/billing/notices.js';

/**
 * An SMTP error message usually quotes the recipient ("550 5.1.1 <ana@example.com>: Recipient address rejected"):
 * personal data must not reach the logs. Only the error class and code are logged.
 */
describe('billing notices: a failed email is logged without its message', () => {
  it('logs the error class / code, never the SMTP message or the address', async () => {
    const smtpError = Object.assign(new Error('550 5.1.1 <ana@example.com>: Recipient address rejected'), { code: 'EENVELOPE' });
    (sendMail as unknown as jest.Mock).mockRejectedValue(smtpError);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await notifyPaymentFailed({ _id: { toString: () => 'u1' }, email: 'ana@example.com', locale: 'en', plan: 'pro' }, new Date());
      const logged = errorSpy.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
      expect(logged).toContain('EENVELOPE');
      expect(logged).not.toContain('ana@example.com');
      expect(logged).not.toContain('Recipient address rejected');
    } finally {
      errorSpy.mockRestore();
    }
  });
});
