import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ADMIN_METRICS_DAYS, ADMIN_METRICS_DEFAULT_DAYS } from '@mockia/shared';
import Layout from '../../layouts/Layout';
import NotFound from '../NotFound/NotFound';
import ModalErrorAlert from '../../components/ui/ModalErrorAlert/ModalErrorAlert';
import StatCard from '../../components/admin/StatCard';
import LineChart from '../../components/admin/LineChart';
import BarChart from '../../components/admin/BarChart';
import {
  getAdminMetrics,
  type AdminMetrics,
  type AdminMetricsDays,
} from '../../services/adminService';
import { useIsAdmin } from '../../hooks/useIsAdmin';
import { useI18n } from '../../i18n/I18nProvider';
import styles from './Admin.module.scss';

/** Mientras la pantalla esta montada le pide a los buscadores que no la indexen (tambien en la 404 de quien no es titular). */
function useNoindex(): void {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
    return () => {
      meta.remove();
    };
  }, []);
}

const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);

type Load = { data: AdminMetrics | null; loading: boolean; failed: boolean };

/**
 * Panel de metricas del titular. Quien no es administrador ve exactamente la 404 de la app y no se pide nada a
 * /admin/metrics (la API tambien lo rechazaria con 403). Todo son agregados: ni correos ni ids.
 */
const Admin: React.FC = () => {
  useNoindex();
  const { t, formatNumber, formatDate } = useI18n();
  const { status, retry: retryAccess } = useIsAdmin();
  const [days, setDays] = useState<AdminMetricsDays>(ADMIN_METRICS_DEFAULT_DAYS);
  const [load, setLoad] = useState<Load>({ data: null, loading: true, failed: false });
  const latest = useRef(0);

  const fetchMetrics = useCallback(async (window: AdminMetricsDays) => {
    const id = ++latest.current;
    setLoad((prev) => ({ ...prev, loading: true, failed: false }));
    try {
      const data = await getAdminMetrics(window);
      if (id === latest.current) setLoad({ data, loading: false, failed: false });
    } catch {
      // Una respuesta vieja que llega tarde no pisa a la nueva
      if (id === latest.current) setLoad({ data: null, loading: false, failed: true });
    }
  }, []);

  useEffect(() => {
    if (status === 'admin') void fetchMetrics(days);
  }, [status, days, fetchMetrics]);

  if (status === 'not-admin') return <NotFound />;

  const { data, loading, failed } = load;
  const money = (value: number) =>
    formatNumber(value, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: value < 1 ? 4 : 2,
    });
  const percent = (value: number) =>
    formatNumber(value, { style: 'percent', maximumFractionDigits: 1 });

  const head = (
    <header className={styles.pageHead}>
      <div>
        <h1>{t('admin.title')}</h1>
        <p>{t('admin.subtitle')}</p>
      </div>
      {status === 'admin' && (
        <div className={styles.range} role="group" aria-label={t('admin.range.label')}>
          {ADMIN_METRICS_DAYS.map((option) => (
            <button
              key={option}
              type="button"
              className={styles.rangeBtn}
              aria-pressed={days === option}
              onClick={() => setDays(option)}
            >
              {t('admin.range.option', { days: option })}
            </button>
          ))}
        </div>
      )}
    </header>
  );

  let body: React.ReactNode = null;
  if (status === 'checking') {
    body = (
      <p className={styles.loading} role="status">
        {t('admin.checking')}
      </p>
    );
  } else if (status === 'error') {
    body = (
      <div className={styles.loadError}>
        <ModalErrorAlert message={t('admin.accessFailed')} />
        <button type="button" className={styles.secondaryBtn} onClick={retryAccess}>
          {t('admin.retry')}
        </button>
      </div>
    );
  } else if (failed) {
    body = (
      <div className={styles.loadError}>
        <ModalErrorAlert message={t('admin.loadFailed')} />
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={() => void fetchMetrics(days)}
        >
          {t('admin.retry')}
        </button>
      </div>
    );
  } else if (!data) {
    body = (
      <p className={styles.loading} role="status">
        {t('admin.loading')}
      </p>
    );
  } else {
    const calls = sum(data.ai.perDay.map((d) => d.calls));
    const errors = sum(data.ai.perDay.map((d) => d.errors));
    const paying = data.billing.paying;
    const funnel = data.funnel;
    const steps = [
      { key: 'registered', value: funnel.registered },
      { key: 'verified', value: funnel.verified },
      { key: 'withProject', value: funnel.withProject },
      { key: 'withAiGeneration', value: funnel.withAiGeneration },
    ] as const;
    const planKeys = ['free', 'starter', 'pro', 'team'] as const;

    body = (
      <div className={styles.content} aria-busy={loading} data-testid="admin-content">
        <p className={styles.updated}>
          {t('admin.updated', {
            date: formatDate(data.generatedAt, { dateStyle: 'medium', timeStyle: 'short' }),
          })}
        </p>

        <section className={styles.stats} aria-label={t('admin.title')}>
          <StatCard
            testId="stat-users"
            label={t('admin.cards.users')}
            value={formatNumber(data.users.total)}
            note={t('admin.cards.usersNote', { count: formatNumber(data.users.verified) })}
          />
          <StatCard
            testId="stat-paying"
            label={t('admin.cards.paying')}
            value={formatNumber(sum(Object.values(paying)))}
            note={t('admin.cards.payingNote', {
              starter: formatNumber(paying.starter),
              pro: formatNumber(paying.pro),
              team: formatNumber(paying.team),
            })}
          />
          <StatCard
            testId="stat-mrr"
            label={t('admin.cards.mrr')}
            value={money(data.billing.mrrUsdEstimate)}
            note={t('admin.cards.mrrNote')}
          />
          <StatCard
            testId="stat-ai-calls"
            label={t('admin.cards.aiCalls')}
            value={formatNumber(calls)}
            note={t('admin.cards.aiCallsNote', { days: data.days })}
          />
          <StatCard
            testId="stat-error-rate"
            label={t('admin.cards.errorRate')}
            value={percent(data.ai.errorRatio)}
            note={t('admin.cards.errorRateNote', {
              errors: formatNumber(errors),
              calls: formatNumber(calls),
            })}
          />
          <StatCard
            testId="stat-cost"
            label={t('admin.cards.cost')}
            textValue={data.ai.estimatedCostUsd === null}
            value={
              data.ai.estimatedCostUsd === null
                ? t('admin.cards.costNone')
                : money(data.ai.estimatedCostUsd)
            }
            note={t('admin.cards.costNote', {
              input: formatNumber(data.ai.tokens.input),
              output: formatNumber(data.ai.tokens.output),
            })}
          >
            {data.ai.unpriced.length > 0 && (
              <p className={styles.unpriced} data-testid="unpriced">
                {t('admin.cards.unpriced', { models: data.ai.unpriced.join(', ') })}
              </p>
            )}
          </StatCard>
        </section>

        <section className={styles.charts} data-testid="admin-charts">
          <LineChart
            title={t('admin.charts.newUsers')}
            days={data.users.newPerDay.map((d) => d.day)}
            series={[
              {
                key: 'new',
                label: t('admin.series.newUsers'),
                tone: 'accent',
                values: data.users.newPerDay.map((d) => d.count),
              },
            ]}
          />
          <BarChart
            title={t('admin.charts.aiCalls')}
            days={data.ai.perDay.map((d) => d.day)}
            series={(['users', 'demo', 'byok'] as const).map((scope, i) => ({
              key: scope,
              label: t(`admin.scope.${scope}`),
              tone: (['accent', 'warn', 'ok'] as const)[i],
              values: data.ai.perDay.map((d) => d.byScope[scope]),
            }))}
            extraColumns={[
              {
                key: 'errors',
                label: t('admin.series.errors'),
                values: data.ai.perDay.map((d) => d.errors),
              },
            ]}
          />
          <BarChart
            title={t('admin.charts.demo')}
            days={data.demo.generationsPerDay.map((d) => d.day)}
            series={[
              {
                key: 'demo',
                label: t('admin.series.demo'),
                tone: 'warn',
                values: data.demo.generationsPerDay.map((d) => d.count),
              },
            ]}
          />
        </section>

        <section className={styles.lower}>
          <article className={styles.panel} aria-labelledby="admin-funnel-title">
            <h2 id="admin-funnel-title" className={styles.panelTitle}>
              {t('admin.funnel.title')}
            </h2>
            <p className={styles.muted}>{t('admin.funnel.hint', { days: data.days })}</p>
            <ol className={styles.funnel} data-testid="funnel">
              {steps.map((step) => {
                const share = funnel.registered > 0 ? step.value / funnel.registered : 0;
                return (
                  <li key={step.key}>
                    <div className={styles.funnelHead}>
                      <span>{t(`admin.funnel.${step.key}`)}</span>
                      <span className={styles.funnelValue}>
                        {formatNumber(step.value)}
                        {step.key !== 'registered' && (
                          <span className={styles.muted}>
                            {' · '}
                            {t('admin.funnel.share', {
                              percent: formatNumber(share, {
                                style: 'percent',
                                maximumFractionDigits: 0,
                              }),
                            })}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className={styles.funnelTrack} aria-hidden="true">
                      <span
                        className={styles.funnelFill}
                        style={{ width: `${Math.min(share, 1) * 100}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ol>
          </article>

          <article className={styles.panel} aria-labelledby="admin-plans-title">
            <h2 id="admin-plans-title" className={styles.panelTitle}>
              {t('admin.plans.title')}
            </h2>
            <dl className={styles.planList}>
              {planKeys.map((plan) => (
                <div key={plan} className={styles.planRow}>
                  <dt>{t(`pricing.plans.${plan}.name`)}</dt>
                  <dd>{formatNumber(data.users.byPlan[plan])}</dd>
                </div>
              ))}
            </dl>
          </article>
        </section>
      </div>
    );
  }

  return (
    <Layout>
      {head}
      {body}
    </Layout>
  );
};

export default Admin;
