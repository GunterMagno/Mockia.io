import React, { useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import styles from './Charts.module.scss';

export type ChartTone = 'accent' | 'ok' | 'warn';

export interface ChartSeries {
  key: string;
  label: string;
  values: number[];
  tone: ChartTone;
}

export interface ChartTableColumn {
  key: string;
  label: string;
  values: number[];
}

export interface ChartFrameProps {
  title: string;
  /** Dias 'YYYY-MM-DD' (UTC), uno por punto. */
  days: string[];
  /** Series dibujadas (tambien columnas de la tabla). */
  series: ChartSeries[];
  /** Columnas que solo van en la tabla (p. ej. los errores). */
  extraColumns?: ChartTableColumn[];
  /** Dibuja el contenido del SVG dentro del area (ancho real en px). */
  render: (width: number, height: number) => React.ReactNode;
}

export const CHART_HEIGHT = 220;
const FALLBACK_WIDTH = 320;

/** Ancho real del contenedor (el SVG se dibuja en pixeles: asi el texto no se encoge en moviles). */
function useWidth(ref: React.RefObject<HTMLElement>): number {
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(200, Math.floor(el.getBoundingClientRect().width)));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/**
 * Marco accesible de un grafico: <figure> con titulo, el SVG como imagen (role="img" + aria-label con el resumen),
 * leyenda y, plegada, la misma informacion en una tabla (focalizable con el teclado).
 */
const ChartFrame: React.FC<ChartFrameProps> = ({
  title,
  days,
  series,
  extraColumns = [],
  render,
}) => {
  const { t, formatDate, formatNumber } = useI18n();
  const plotRef = useRef<HTMLDivElement>(null);
  const width = useWidth(plotRef);

  const dayLabel = (day: string) =>
    formatDate(`${day}T00:00:00Z`, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const total = (values: number[]) => values.reduce((sum, v) => sum + v, 0);
  const from = days.length ? dayLabel(days[0]) : '';
  const to = days.length ? dayLabel(days[days.length - 1]) : '';
  const summary = series.map((s) => `${s.label}: ${formatNumber(total(s.values))}`).join(', ');
  const ariaLabel = `${title}. ${t('admin.chart.range', { from, to })} ${summary}.`;

  const columns: ChartTableColumn[] = [...series, ...extraColumns];

  return (
    <figure className={styles.frame}>
      <figcaption className={styles.title}>{title}</figcaption>
      <div className={styles.plot} ref={plotRef}>
        <svg
          role="img"
          aria-label={ariaLabel}
          width={width}
          height={CHART_HEIGHT}
          viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
          className={styles.svg}
        >
          {render(width, CHART_HEIGHT)}
        </svg>
      </div>
      <ul className={styles.legend}>
        {series.map((s) => (
          <li key={s.key}>
            <span className={`${styles.swatch} ${styles[`fill-${s.tone}`]}`} aria-hidden="true" />
            {s.label}
          </li>
        ))}
      </ul>
      <details className={styles.data}>
        <summary>{t('admin.chart.showTable')}</summary>
        <div
          className={styles.tableWrap}
          role="region"
          aria-label={t('admin.chart.tableRegion', { title })}
          tabIndex={0}
        >
          <table className={styles.table}>
            <caption>{title}</caption>
            <thead>
              <tr>
                <th scope="col">{t('admin.chart.day')}</th>
                {columns.map((c) => (
                  <th scope="col" key={c.key}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((day, i) => (
                <tr key={day}>
                  <th scope="row">{dayLabel(day)}</th>
                  {columns.map((c) => (
                    <td key={c.key}>{formatNumber(c.values[i] ?? 0)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
};

export default ChartFrame;
