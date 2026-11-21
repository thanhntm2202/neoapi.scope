import React, { useEffect, useRef } from 'react';
import Plotly from 'plotly.js-dist-min';
import { C_GRID, C_TEXT } from '../lib/format';

interface PlotlyChartProps {
  data: any[];
  layout?: Record<string, any>;
  height?: number;
  title?: string | null;
  alt?: string;
  crosshair?: boolean;
  onHoverX?: (xVal: string | null) => void;
  onClickPoint?: (point: {
    x: any;
    y: any;
    customdata?: any;
    curveNumber?: number;
    pointIndex?: number;
  }) => void;
}

export const PlotlyChart: React.FC<PlotlyChartProps> = ({
  data,
  layout = {},
  height = 360,
  title = null,
  alt,
  crosshair = false,
  onHoverX,
  onClickPoint,
}) => {
  const elRef = useRef<HTMLDivElement | null>(null);
  const isMountedRef = useRef(true);
  const renderPromiseRef = useRef<Promise<any> | null>(null);
  const onHoverRef = useRef(onHoverX);
  onHoverRef.current = onHoverX;
  const onClickRef = useRef(onClickPoint);
  onClickRef.current = onClickPoint;

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    let cancelled = false;

    const spikeOpts = crosshair
      ? {
          showspikes: true,
          spikemode: 'across' as const,
          spikesnap: 'cursor' as const,
          spikecolor: '#787b86',
          spikethickness: 1,
          spikedash: 'dot' as const,
        }
      : {};

    const hasTitle = Boolean(title);
    const mergedLayout: Record<string, any> = {
      template: 'plotly_dark',
      height,
      margin: { l: 54, r: 24, t: hasTitle ? 70 : 28, b: 42 },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      font: {
        family: "'Plus Jakarta Sans', 'Segoe UI', sans-serif",
        size: 12,
        color: C_TEXT,
      },
      title: hasTitle
        ? {
            text: title,
            font: { size: 13.5, color: '#f0f3fa', family: "'Plus Jakarta Sans', sans-serif" },
            x: 0.01,
            y: 0.97,
            yanchor: 'top',
          }
        : undefined,
      legend: {
        orientation: 'h',
        yanchor: 'bottom',
        y: 1.01,
        x: 0,
        font: { size: 11, color: C_TEXT },
        bgcolor: 'rgba(19,23,34,0.68)',
      },
      hoverlabel: {
        font: { size: 12, color: '#f0f3fa', family: "'JetBrains Mono', monospace" },
        bgcolor: '#1e222d',
        bordercolor: '#363a45',
      },
      ...(crosshair ? { hovermode: 'x' as const } : {}),
      ...layout,
      xaxis: {
        gridcolor: C_GRID,
        zerolinecolor: C_GRID,
        linecolor: '#2a2e39',
        tickfont: { family: "'JetBrains Mono', monospace", size: 11, color: '#787b86' },
        ...spikeOpts,
        ...(layout.xaxis || {}),
      },
      yaxis: {
        gridcolor: C_GRID,
        zerolinecolor: C_GRID,
        linecolor: '#2a2e39',
        tickfont: { family: "'JetBrains Mono', monospace", size: 11, color: '#787b86' },
        ...spikeOpts,
        ...(layout.yaxis || {}),
      },
    };

    if (layout.yaxis2) {
      mergedLayout.yaxis2 = {
        gridcolor: C_GRID,
        zerolinecolor: C_GRID,
        linecolor: '#2a2e39',
        tickfont: { family: "'JetBrains Mono', monospace", size: 11, color: '#787b86' },
        ...spikeOpts,
        ...layout.yaxis2,
      };
    }

    if (layout.yaxis3) {
      mergedLayout.yaxis3 = {
        gridcolor: C_GRID,
        zerolinecolor: C_GRID,
        linecolor: '#2a2e39',
        tickfont: { family: "'JetBrains Mono', monospace", size: 11, color: '#787b86' },
        ...layout.yaxis3,
      };
    }

    const plotlyEl = el as any;
    const handleHover = (ev: any) => {
      if (cancelled || !isMountedRef.current || !onHoverRef.current) return;
      const pt = ev?.points?.[0];
      if (pt && pt.x !== undefined && pt.x !== null) {
        onHoverRef.current(String(pt.x));
      }
    };
    const handleUnhover = () => {
      if (cancelled || !isMountedRef.current) return;
      onHoverRef.current?.(null);
    };
    const handleClick = (ev: any) => {
      if (cancelled || !isMountedRef.current || !onClickRef.current) return;
      const pt = ev?.points?.[0];
      if (!pt) return;
      onClickRef.current({
        x: pt.x,
        y: pt.y,
        customdata: pt.customdata,
        curveNumber: pt.curveNumber,
        pointIndex: pt.pointIndex,
      });
    };

    try {
      const plotPromise = Promise.resolve(
        Plotly.react(el, data, mergedLayout, {
          responsive: true,
          displayModeBar: 'hover',
          displaylogo: false,
          modeBarButtonsToRemove: ['lasso2d', 'select2d'],
        })
      ).then(() => {
        if (!cancelled && isMountedRef.current && el.isConnected && typeof plotlyEl.on === 'function') {
          if (typeof plotlyEl.removeListener === 'function') {
            plotlyEl.removeListener('plotly_hover', handleHover);
            plotlyEl.removeListener('plotly_unhover', handleUnhover);
            plotlyEl.removeListener('plotly_click', handleClick);
          }
          plotlyEl.on('plotly_hover', handleHover);
          plotlyEl.on('plotly_unhover', handleUnhover);
          plotlyEl.on('plotly_click', handleClick);
        }
      }).catch(() => {
        // Ignore transient Plotly abort during rapid unmount
      });
      renderPromiseRef.current = plotPromise;
    } catch {
      // Ignore synchronous Plotly guard error during unmount
    }

    const safeResize = () => {
      if (
        !cancelled &&
        isMountedRef.current &&
        el &&
        el.isConnected &&
        el.offsetParent !== null &&
        el.clientWidth > 0 &&
        el.clientHeight > 0
      ) {
        try {
          Promise.resolve(Plotly.Plots.resize(el)).catch(() => {});
        } catch {
          // Ignore resize during teardown
        }
      }
    };

    const ro = new ResizeObserver(safeResize);
    ro.observe(el);
    window.addEventListener('resize', safeResize);

    return () => {
      cancelled = true;
      ro.disconnect();
      window.removeEventListener('resize', safeResize);
      if (typeof plotlyEl.removeListener === 'function') {
        plotlyEl.removeListener('plotly_hover', handleHover);
        plotlyEl.removeListener('plotly_unhover', handleUnhover);
        plotlyEl.removeListener('plotly_click', handleClick);
      }
    };
  }, [data, layout, height, title, crosshair]);

  useEffect(() => {
    isMountedRef.current = true;
    const el = elRef.current;
    return () => {
      isMountedRef.current = false;
      const pending = renderPromiseRef.current;
      const purgeSafely = () => {
        if (!el || isMountedRef.current) return;
        try {
          Plotly.purge(el);
        } catch {
          // Ignore purge if DOM node was already cleaned up
        }
      };
      if (pending) {
        Promise.resolve(pending).finally(purgeSafely);
      } else {
        purgeSafely();
      }
    };
  }, []);

  return (
    <div
      ref={elRef}
      aria-label={alt || title || 'Plotly chart'}
      style={{ width: '100%', maxWidth: '100%', minHeight: `${height}px`, overflow: 'hidden' }}
    />
  );
};
