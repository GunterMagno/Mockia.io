import React from 'react';
import ChartFrame, { type ChartFrameProps } from './ChartFrame';
import { niceScale, labelIndexes } from './chartScale';
import { useI18n } from '../../i18n/I18nProvider';
import styles from './Charts.module.scss';

const MARGIN = { top: 12, right: 12, bottom: 28, left: 44 };

/** Grafico de barras en SVG propio; con varias series las apila (la suma de cada dia es la altura). */
const BarChart: React.FC<Omit<ChartFrameProps, 'render'>> = (props) => {
  const { days, series } = props;
  const { formatDate, formatNumber } = useI18n();

  const render = (width: number, height: number) => {
    const innerW = width - MARGIN.left - MARGIN.right;
    const innerH = height - MARGIN.top - MARGIN.bottom;
    const n = days.length;
    const totals = days.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
    const { top, ticks } = niceScale(Math.max(0, ...totals));
    const band = n > 0 ? innerW / n : innerW;
    const barW = Math.max(1, band * 0.72);
    const y = (v: number) => MARGIN.top + innerH - (v / top) * innerH;
    const cx = (i: number) => MARGIN.left + band * i + band / 2;
    const slots = Math.max(2, Math.floor(innerW / 64));

    return (
      <>
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              className={styles.grid}
              x1={MARGIN.left}
              x2={width - MARGIN.right}
              y1={y(tick)}
              y2={y(tick)}
            />
            <text
              className={styles.axis}
              x={MARGIN.left - 8}
              y={y(tick)}
              textAnchor="end"
              dy="0.32em"
            >
              {formatNumber(tick, { notation: 'compact' })}
            </text>
          </g>
        ))}
        {labelIndexes(n, slots).map((i, k, all) => (
          <text
            key={days[i]}
            className={styles.axis}
            x={cx(i)}
            y={height - 8}
            textAnchor={
              k === 0 && n > 1 ? 'start' : k === all.length - 1 && n > 1 ? 'end' : 'middle'
            }
          >
            {formatDate(`${days[i]}T00:00:00Z`, {
              month: 'short',
              day: 'numeric',
              timeZone: 'UTC',
            })}
          </text>
        ))}
        {days.map((day, i) => {
          let acc = 0;
          return (
            <g key={day}>
              {series.map((s) => {
                const v = s.values[i] ?? 0;
                const y0 = y(acc);
                acc += v;
                const h = y0 - y(acc);
                if (h <= 0) return null;
                return (
                  <rect
                    key={s.key}
                    className={styles[`bar-${s.tone}`]}
                    x={cx(i) - barW / 2}
                    y={y(acc)}
                    width={barW}
                    height={h}
                  />
                );
              })}
            </g>
          );
        })}
      </>
    );
  };

  return <ChartFrame {...props} render={render} />;
};

export default BarChart;
