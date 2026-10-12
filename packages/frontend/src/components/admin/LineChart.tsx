import React from 'react';
import ChartFrame, { type ChartFrameProps } from './ChartFrame';
import { niceScale, labelIndexes } from './chartScale';
import { useI18n } from '../../i18n/I18nProvider';
import styles from './Charts.module.scss';

const MARGIN = { top: 12, right: 12, bottom: 28, left: 44 };

/** Grafico de lineas en SVG propio (sin dependencias). La primera serie lleva ademas un relleno suave. */
const LineChart: React.FC<Omit<ChartFrameProps, 'render'>> = (props) => {
  const { days, series } = props;
  const { formatDate, formatNumber } = useI18n();

  const render = (width: number, height: number) => {
    const innerW = width - MARGIN.left - MARGIN.right;
    const innerH = height - MARGIN.top - MARGIN.bottom;
    const max = Math.max(0, ...series.flatMap((s) => s.values));
    const { top, ticks } = niceScale(max);
    const n = days.length;
    const x = (i: number) => MARGIN.left + (n <= 1 ? innerW / 2 : (i * innerW) / (n - 1));
    const y = (v: number) => MARGIN.top + innerH - (v / top) * innerH;
    const slots = Math.max(2, Math.floor(innerW / 72));
    const showDots = n > 0 && innerW / n >= 9;

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
        {labelIndexes(n, slots).map((i) => (
          <text
            key={days[i]}
            className={styles.axis}
            x={x(i)}
            y={height - 8}
            textAnchor={i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'}
          >
            {formatDate(`${days[i]}T00:00:00Z`, {
              month: 'short',
              day: 'numeric',
              timeZone: 'UTC',
            })}
          </text>
        ))}
        {series.map((s, si) => {
          const points = s.values.map((v, i) => `${x(i)},${y(v)}`);
          return (
            <g key={s.key} className={styles[`tone-${s.tone}`]}>
              {si === 0 && n > 1 && (
                <polygon
                  className={styles.area}
                  points={`${x(0)},${y(0)} ${points.join(' ')} ${x(n - 1)},${y(0)}`}
                />
              )}
              {n > 1 && <polyline className={styles.line} points={points.join(' ')} />}
              {(showDots || n === 1) &&
                s.values.map((v, i) => (
                  <circle key={days[i]} className={styles.dot} cx={x(i)} cy={y(v)} r={3} />
                ))}
            </g>
          );
        })}
      </>
    );
  };

  return <ChartFrame {...props} render={render} />;
};

export default LineChart;
