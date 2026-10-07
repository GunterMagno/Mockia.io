import { assertProdConfig } from '../config/assertProdConfig.js';

const validProd = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  CORS_ORIGIN: 'https://app.mockia.io',
  MONGODB_URI: 'mongodb://mockia:s3cr3t-Pr0d-pass@mongo:27017/mockia?authSource=admin',
  APP_URL: 'https://app.mockia.io',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'b'.repeat(48),
});

describe('assertProdConfig', () => {
  describe('production', () => {
    it('accepts a safe configuration', () => {
      expect(() => assertProdConfig(validProd())).not.toThrow();
    });

    it('accepts several explicit origins', () => {
      const env = { ...validProd(), CORS_ORIGIN: 'https://app.mockia.io, https://www.mockia.io' };
      expect(() => assertProdConfig(env)).not.toThrow();
    });

    it("rejects CORS_ORIGIN='*'", () => {
      expect(() => assertProdConfig({ ...validProd(), CORS_ORIGIN: '*' })).toThrow(/CORS_ORIGIN/);
    });

    it('rejects a wildcard hidden inside a list of origins', () => {
      const env = { ...validProd(), CORS_ORIGIN: 'https://app.mockia.io, *' };
      expect(() => assertProdConfig(env)).toThrow(/CORS_ORIGIN/);
    });

    it.each([undefined, '', '   ', ' , '])('rejects an empty CORS_ORIGIN (%p)', (value) => {
      expect(() => assertProdConfig({ ...validProd(), CORS_ORIGIN: value })).toThrow(/CORS_ORIGIN/);
    });

    it('rejects the default Mongo password in MONGODB_URI', () => {
      const env = {
        ...validProd(),
        MONGODB_URI: 'mongodb://root:password@mongo:27017/mockia?authSource=admin',
      };
      expect(() => assertProdConfig(env)).toThrow(/MONGODB_URI/);
    });

    it.each([undefined, ''])('rejects a missing APP_URL (%p)', (value) => {
      expect(() => assertProdConfig({ ...validProd(), APP_URL: value })).toThrow(/APP_URL/);
    });

    it.each([
      ['JWT_SECRET', 'production_secret_key_change_me'],
      ['JWT_ACCESS_SECRET', 'production_access_key'],
      ['JWT_REFRESH_SECRET', 'production_refresh_key'],
      ['JWT_ACCESS_SECRET', 'your-jwt-secret-key-change-this-in-production'],
      ['JWT_ACCESS_SECRET', 'dev_access_token_secret_change_in_production'],
      ['JWT_REFRESH_SECRET', 'Change-Me-generate-with-openssl-rand-hex-48'],
    ])('rejects the known default value of %s', (name, value) => {
      expect(() => assertProdConfig({ ...validProd(), [name]: value })).toThrow(new RegExp(name));
    });

    it.each(['true', 'TRUE', '1', ' true '])('rejects E2E_EXPOSE_MAIL_OUTBOX=%p (it would expose password reset links)', (value) => {
      expect(() => assertProdConfig({ ...validProd(), E2E_EXPOSE_MAIL_OUTBOX: value })).toThrow(/E2E_EXPOSE_MAIL_OUTBOX/);
    });

    it.each([undefined, '', 'false', '0'])('accepts E2E_EXPOSE_MAIL_OUTBOX=%p', (value) => {
      expect(() => assertProdConfig({ ...validProd(), E2E_EXPOSE_MAIL_OUTBOX: value })).not.toThrow();
    });

    it('rejects a short JWT secret', () => {
      const env = { ...validProd(), JWT_REFRESH_SECRET: 'too-short' };
      expect(() => assertProdConfig(env)).toThrow(/JWT_REFRESH_SECRET/);
    });

    it('reports every problem at once and never echoes secret values', () => {
      const env = {
        NODE_ENV: 'production',
        CORS_ORIGIN: '*',
        MONGODB_URI: 'mongodb://root:password@mongo:27017/mockia',
        JWT_ACCESS_SECRET: 'production_access_key',
      };
      let message = '';
      try {
        assertProdConfig(env);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toMatch(/CORS_ORIGIN/);
      expect(message).toMatch(/MONGODB_URI/);
      expect(message).toMatch(/APP_URL/);
      expect(message).toMatch(/JWT_ACCESS_SECRET/);
      expect(message).not.toContain('production_access_key');
      expect(message).not.toContain(':password@');
    });
  });

  describe('outside production', () => {
    const insecure: NodeJS.ProcessEnv = {
      CORS_ORIGIN: '*',
      MONGODB_URI: 'mongodb://root:password@mongo:27017/mockia',
      JWT_ACCESS_SECRET: 'production_access_key',
    };

    it.each(['development', 'test', '', undefined])('never throws when NODE_ENV=%p', (nodeEnv) => {
      expect(() => assertProdConfig({ ...insecure, NODE_ENV: nodeEnv })).not.toThrow();
    });
  });

  describe('default argument', () => {
    const saved = { ...process.env };
    afterEach(() => {
      process.env = { ...saved };
    });

    it('reads process.env when no argument is given', () => {
      process.env = { ...saved, ...validProd(), CORS_ORIGIN: '*' };
      expect(() => assertProdConfig()).toThrow(/CORS_ORIGIN/);
      process.env = { ...saved, ...validProd() };
      expect(() => assertProdConfig()).not.toThrow();
    });
  });
});
