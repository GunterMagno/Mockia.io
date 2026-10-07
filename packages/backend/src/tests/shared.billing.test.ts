import {
  ANNUAL_DISCOUNT_PERCENT,
  ANNUAL_MONTHS_CHARGED,
  BILLING_INTERVALS,
  PLAN_PRICE_USD,
  annualDiscountPercent,
  annualMonthlyEquivalentUsd,
  isBillingInterval,
  planPriceUsd,
} from '@mockia/shared';

// @mockia/shared no tiene runner propio (ruling R5): su logica se prueba aqui.
describe('catalogo de precios con intervalo', () => {
  it('cada plan de pago tiene precio mensual y anual; el anual es 10 meses (dos gratis)', () => {
    for (const plan of ['pro', 'team'] as const) {
      const { monthly, annual } = PLAN_PRICE_USD[plan];
      expect(monthly).toBeGreaterThan(0);
      expect(annual).toBe(monthly * ANNUAL_MONTHS_CHARGED);
    }
    expect(PLAN_PRICE_USD.free).toEqual({ monthly: 0, annual: 0 });
  });

  it('planPriceUsd devuelve lo que se cobra en cada intervalo', () => {
    expect(planPriceUsd('pro', 'month')).toBe(PLAN_PRICE_USD.pro.monthly);
    expect(planPriceUsd('pro', 'year')).toBe(PLAN_PRICE_USD.pro.annual);
    expect(planPriceUsd('free', 'year')).toBe(0);
  });

  it('el descuento anual visible sale del catalogo y se redondea al entero mas cercano', () => {
    // 1 - 10/12 = 16,67 %
    expect(annualDiscountPercent('pro')).toBe(17);
    expect(annualDiscountPercent('team')).toBe(17);
    expect(ANNUAL_DISCOUNT_PERCENT).toBe(17);
    expect(Number.isInteger(ANNUAL_DISCOUNT_PERCENT)).toBe(true);
  });

  it('el plan gratuito no tiene descuento anual', () => {
    expect(annualDiscountPercent('free')).toBe(0);
  });

  it('el equivalente mensual del precio anual es anual / 12', () => {
    expect(annualMonthlyEquivalentUsd('pro')).toBeCloseTo(290 / 12, 10);
    expect(annualMonthlyEquivalentUsd('team')).toBeCloseTo(990 / 12, 10);
    expect(annualMonthlyEquivalentUsd('free')).toBe(0);
  });

  it('isBillingInterval solo acepta month y year', () => {
    expect(BILLING_INTERVALS).toEqual(['month', 'year']);
    expect(isBillingInterval('month')).toBe(true);
    expect(isBillingInterval('year')).toBe(true);
    for (const bad of ['monthly', 'annual', '', 'YEAR', undefined, null, 1, {}]) expect(isBillingInterval(bad)).toBe(false);
  });
});
