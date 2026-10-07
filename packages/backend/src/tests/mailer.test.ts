const sendMailMock = jest.fn().mockResolvedValue({ messageId: 'x' });
const createTransportMock = jest.fn(() => ({ sendMail: sendMailMock }));
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: (...args: unknown[]) => (createTransportMock as any)(...args) },
  createTransport: (...args: unknown[]) => (createTransportMock as any)(...args),
}));

import { sendMail, renderMail, getTestOutbox, clearTestOutbox } from '../services/mailer.js';

const LINK = 'https://app.example.com/reset-password?token=abc_DEF-123';

describe('mailer', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env = { ...saved };
    delete process.env.SMTP_URL;
    delete process.env.MAIL_FROM;
    delete process.env.E2E_EXPOSE_MAIL_OUTBOX;
    process.env.NODE_ENV = 'test';
    sendMailMock.mockClear();
    createTransportMock.mockClear();
    clearTestOutbox();
  });

  afterAll(() => {
    process.env = saved;
  });

  describe('renderMail', () => {
    it.each([
      ['en', 'reset', 'Reset your Mockia password'],
      ['es', 'reset', 'Restablece tu contraseña de Mockia'],
      ['zh', 'reset', '重置你的 Mockia 密码'],
      ['en', 'verify', 'Verify your email address'],
      ['es', 'verify', 'Verifica tu correo electrónico'],
      ['zh', 'verify', '验证你的邮箱地址'],
    ] as const)('%s / %s: subject, the link in text and in html', (locale, template, subject) => {
      const mail = renderMail(template, { link: LINK, username: 'Ana', locale });
      expect(mail.locale).toBe(locale);
      expect(mail.subject).toBe(subject);
      expect(mail.text).toContain(LINK);
      expect(mail.html).toContain(`href="${LINK}"`);
      expect(mail.text).toContain('Ana');
    });

    it('defaults to English when the locale is missing or unknown', () => {
      expect(renderMail('reset', { link: LINK }).locale).toBe('en');
      expect(renderMail('reset', { link: LINK, locale: 'fr' }).locale).toBe('en');
    });

    it('escapes html in the user name and the link', () => {
      const mail = renderMail('verify', { link: 'https://x.test/?a=1&b="2"', username: '<script>alert(1)</script>' });
      expect(mail.html).not.toContain('<script>');
      expect(mail.html).toContain('&lt;script&gt;');
      expect(mail.html).toContain('a=1&amp;b=&quot;2&quot;');
    });
  });

  describe('transport', () => {
    it('with SMTP_URL it sends through nodemailer using MAIL_FROM', async () => {
      process.env.SMTP_URL = 'smtp://user:pass@smtp.example.com:587';
      process.env.MAIL_FROM = 'Mockia <no-reply@example.com>';
      await sendMail('ana@example.com', 'reset', { link: LINK, locale: 'es' });

      expect(createTransportMock).toHaveBeenCalledWith('smtp://user:pass@smtp.example.com:587');
      expect(sendMailMock).toHaveBeenCalledTimes(1);
      const msg = sendMailMock.mock.calls[0][0];
      expect(msg).toMatchObject({
        from: 'Mockia <no-reply@example.com>',
        to: 'ana@example.com',
        subject: 'Restablece tu contraseña de Mockia',
      });
      expect(msg.text).toContain(LINK);
      expect(msg.html).toContain(LINK);
    });

    it('a transport failure rejects (callers decide whether it matters)', async () => {
      process.env.SMTP_URL = 'smtp://smtp.example.com';
      sendMailMock.mockRejectedValueOnce(new Error('connection refused'));
      await expect(sendMail('ana@example.com', 'verify', { link: LINK })).rejects.toThrow('connection refused');
    });

    it('in NODE_ENV=test without SMTP_URL it fills the in-memory outbox and sends nothing', async () => {
      await sendMail('ana@example.com', 'verify', { link: LINK, locale: 'zh', username: 'Ana' });
      expect(sendMailMock).not.toHaveBeenCalled();
      const outbox = getTestOutbox();
      expect(outbox).toHaveLength(1);
      expect(outbox[0]).toMatchObject({ to: 'ana@example.com', template: 'verify', locale: 'zh', link: LINK });
      clearTestOutbox();
      expect(getTestOutbox()).toHaveLength(0);
    });

    it('in production without SMTP_URL it logs an error, resolves, and never prints the link', async () => {
      process.env.NODE_ENV = 'production';
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        await expect(sendMail('ana@example.com', 'reset', { link: LINK })).resolves.toBeUndefined();
        expect(errorSpy).toHaveBeenCalled();
        const printed = [...errorSpy.mock.calls, ...logSpy.mock.calls].flat().join(' ');
        expect(printed).not.toContain('abc_DEF-123');
        expect(printed).not.toContain('ana@example.com');
        expect(getTestOutbox()).toHaveLength(0);
        expect(sendMailMock).not.toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
        logSpy.mockRestore();
      }
    });

    it('in development without SMTP_URL it logs the action link to the console', async () => {
      process.env.NODE_ENV = 'development';
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        await sendMail('ana@example.com', 'reset', { link: LINK });
        expect(logSpy.mock.calls.flat().join(' ')).toContain(LINK);
        expect(sendMailMock).not.toHaveBeenCalled();
      } finally {
        logSpy.mockRestore();
      }
    });

    it('E2E_EXPOSE_MAIL_OUTBOX=true fills the outbox outside NODE_ENV=test too', async () => {
      process.env.NODE_ENV = 'development';
      process.env.E2E_EXPOSE_MAIL_OUTBOX = 'true';
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        await sendMail('ana@example.com', 'verify', { link: LINK });
      } finally {
        logSpy.mockRestore();
      }
      expect(getTestOutbox()).toHaveLength(1);
    });

    it('the outbox is never filled in production, even if the e2e flag leaks in', async () => {
      process.env.NODE_ENV = 'production';
      process.env.E2E_EXPOSE_MAIL_OUTBOX = 'true';
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        await sendMail('ana@example.com', 'verify', { link: LINK });
      } finally {
        errorSpy.mockRestore();
      }
      expect(getTestOutbox()).toHaveLength(0);
    });
  });
});
