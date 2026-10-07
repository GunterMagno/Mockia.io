import { legalConfigProblem, missingLegalFields, readLegalEntity } from '@mockia/shared';

// @mockia/shared no tiene runner propio (ruling R5): su logica se prueba aqui.
const FULL = {
  VITE_LEGAL_NAME: 'Acme SL',
  VITE_LEGAL_NIF: 'B12345678',
  VITE_LEGAL_ADDRESS: 'Calle Mayor 1, 28001 Madrid',
  VITE_LEGAL_EMAIL: 'legal@acme.test',
};

describe('readLegalEntity', () => {
  it('lee los campos con el prefijo, recorta espacios y omite registry vacio', () => {
    const entity = readLegalEntity({ ...FULL, VITE_LEGAL_NAME: '  Acme SL  ', VITE_LEGAL_REGISTRY: '   ' });
    expect(entity).toEqual({
      name: 'Acme SL',
      nif: 'B12345678',
      address: 'Calle Mayor 1, 28001 Madrid',
      email: 'legal@acme.test',
    });
  });

  it('incluye registry cuando existe y acepta otro prefijo (backend)', () => {
    const entity = readLegalEntity({ LEGAL_NAME: 'Acme', LEGAL_REGISTRY: 'RM Madrid, T. 1' }, 'LEGAL_');
    expect(entity.name).toBe('Acme');
    expect(entity.registry).toBe('RM Madrid, T. 1');
  });
});

describe('missingLegalFields / legalConfigProblem', () => {
  it('con los cuatro datos no hay problema', () => {
    expect(missingLegalFields(readLegalEntity(FULL))).toEqual([]);
    expect(legalConfigProblem(FULL)).toBeNull();
  });

  it('nombra cada variable que falta o esta en blanco', () => {
    const message = legalConfigProblem({ ...FULL, VITE_LEGAL_NIF: '', VITE_LEGAL_EMAIL: '  ' });
    expect(message).toContain('VITE_LEGAL_NIF');
    expect(message).toContain('VITE_LEGAL_EMAIL');
    expect(message).not.toContain('VITE_LEGAL_NAME,');
    expect(message).toContain('VITE_LEGAL_ALLOW_PLACEHOLDER=1');
  });

  it('sin ningun dato falla; solo ALLOW_PLACEHOLDER=1 lo permite', () => {
    expect(legalConfigProblem({})).toContain('VITE_LEGAL_NAME, VITE_LEGAL_NIF, VITE_LEGAL_ADDRESS, VITE_LEGAL_EMAIL');
    expect(legalConfigProblem({ VITE_LEGAL_ALLOW_PLACEHOLDER: '1' })).toBeNull();
    expect(legalConfigProblem({ VITE_LEGAL_ALLOW_PLACEHOLDER: 'true' })).not.toBeNull();
  });

  it('registry no es obligatorio', () => {
    expect(legalConfigProblem(FULL)).toBeNull();
  });
});
