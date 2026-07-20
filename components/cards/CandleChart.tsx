"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type CandlestickData,
  type HistogramData,
  type MouseEventParams,
  type Time,
} from "lightweight-charts";
import { fmtPrice, fmtUsdCompact } from "@/lib/format";
import type { Candle } from "@/lib/sources/geckoterminal";

export type PriceMode = "price" | "mcap";

// ── Chart chrome, derived from the settled Wizardcore tokens (§3) ───────────
// Grid / axis / crosshair are very-low-alpha amethyst + pipe-smoke mauve, never
// the library's stock grey. Background is the panel color, flat (no gradient).
const PANEL = "#1a1321";
const MAUVE = "#9c8ba3"; // muted axis text
const GRID = "rgba(168, 99, 212, 0.06)"; // amethyst hairlines
const AXIS_BORDER = "rgba(168, 99, 212, 0.16)";
const CROSSHAIR = "rgba(207, 166, 234, 0.4)"; // violet-soft
const CROSSHAIR_LABEL_BG = "#2a1f36";

// Semantic candle colors (§3): green = up, rose = down. Volume echoes them, muted.
const UP = "#86efac";
const DOWN = "#fb7185";
const UP_VOL = "rgba(134, 239, 172, 0.38)";
const DOWN_VOL = "rgba(251, 113, 133, 0.38)";

const MONO_STACK = "ui-monospace, SFMono-Regular, Menlo, monospace";

function priceFormatterFor(mode: PriceMode): (v: number) => string {
  // Blank out non-positive / sub-threshold axis ticks. The candle price scale
  // reserves a bottom band for the volume overlay, so on a wide-range view its
  // gridlines can dip toward (or below) zero — labeling those "$-0.0002" reads
  // as broken. Real prices sit near 2e-4, so a 1e-7 floor never hides data.
  return mode === "mcap"
    ? (v) => (v > 0 ? fmtUsdCompact(v) : "")
    : (v) => (v >= 1e-7 ? fmtPrice(v) : "");
}

function setCell(root: HTMLElement, key: string, value: string) {
  const cell = root.querySelector<HTMLElement>(`[data-${key}]`);
  if (cell) cell.textContent = value;
}

/**
 * lightweight-charts candlestick + volume renderer. Client-only: the chart is
 * created in an effect (never on the server) and this module is loaded via a
 * `ssr:false` dynamic import from the card. Resizes with its container so the
 * bento layout stays responsive; the price⇄mcap toggle rescales in place with
 * no refetch (mcap = price × supply).
 */
export function CandleChart({
  candles,
  priceMode,
  supply,
  resetKey,
  className = "",
}: {
  candles: Candle[];
  priceMode: PriceMode;
  supply: number;
  /** `${pool}:${tf}` — a change means a new series, so refit the viewport. */
  resetKey: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  // Latest values the imperative crosshair callback needs, without re-binding it.
  const candlesRef = useRef<Candle[]>(candles);
  const priceModeRef = useRef<PriceMode>(priceMode);
  const lastResetKey = useRef<string>("");

  // Paint the OHLC legend imperatively so mouse-move never triggers a re-render.
  const paintLegend = useCallback(
    (candle: Candle | null) => {
      const el = legendRef.current;
      if (!el) return;
      if (!candle) {
        el.style.visibility = "hidden";
        return;
      }
      el.style.visibility = "visible";
      const scale = priceModeRef.current === "mcap" ? supply : 1;
      const fmt = priceFormatterFor(priceModeRef.current);
      const up = candle.close >= candle.open;

      setCell(el, "o", fmt(candle.open * scale));
      setCell(el, "h", fmt(candle.high * scale));
      setCell(el, "l", fmt(candle.low * scale));
      setCell(el, "c", fmt(candle.close * scale));
      setCell(el, "v", fmtUsdCompact(candle.volume));

      const cEl = el.querySelector<HTMLElement>("[data-c]");
      if (cEl) cEl.style.color = up ? UP : DOWN;
    },
    [supply],
  );

  const handleCrosshair = useCallback(
    (param: MouseEventParams<Time>) => {
      const rows = candlesRef.current;
      if (rows.length === 0) return;
      let candle: Candle | null = rows[rows.length - 1];
      if (param.time != null) {
        const hovered = rows.find((c) => c.time === (param.time as unknown as number));
        if (hovered) candle = hovered;
      }
      paintLegend(candle);
    },
    [paintLegend],
  );

  // ── Create the chart once, on mount ───────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: PANEL },
        textColor: MAUVE,
        fontFamily: MONO_STACK,
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: GRID },
        horzLines: { color: GRID },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: CROSSHAIR,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: CROSSHAIR_LABEL_BG,
        },
        horzLine: {
          color: CROSSHAIR,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: CROSSHAIR_LABEL_BG,
        },
      },
      rightPriceScale: {
        borderColor: AXIS_BORDER,
        scaleMargins: { top: 0.08, bottom: 0.28 },
      },
      timeScale: {
        borderColor: AXIS_BORDER,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 3,
      },
      handleScale: { axisPressedMouseMove: false },
      // Force English axis labels regardless of the viewer's browser locale
      // (dark-only English v1; i18n is backlog).
      localization: { locale: "en-US" },
      autoSize: false,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      priceFormat: { type: "custom", formatter: priceFormatterFor(priceMode), minMove: 1e-9 },
    });

    // Volume as an overlay on its own hidden scale, pinned to the bottom band.
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: "",
      priceFormat: { type: "custom", formatter: (v: number) => fmtUsdCompact(v), minMove: 0.01 },
      priceLineVisible: false,
      lastValueVisible: false,
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    chart.subscribeCrosshairMove(handleCrosshair);

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        chart.resize(el.clientWidth, el.clientHeight);
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.unsubscribeCrosshairMove(handleCrosshair);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
    // Create once; data + theme updates are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Push data + re-scale on candles / priceMode change ────────────────────
  useEffect(() => {
    candlesRef.current = candles;
    priceModeRef.current = priceMode;

    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!chart || !candleSeries || !volumeSeries) return;

    const scale = priceMode === "mcap" ? supply : 1;

    const candleData: CandlestickData<Time>[] = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      open: c.open * scale,
      high: c.high * scale,
      low: c.low * scale,
      close: c.close * scale,
    }));
    const volumeData: HistogramData<Time>[] = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      value: c.volume,
      color: c.close >= c.open ? UP_VOL : DOWN_VOL,
    }));

    candleSeries.applyOptions({
      priceFormat: { type: "custom", formatter: priceFormatterFor(priceMode), minMove: 1e-9 },
    });
    candleSeries.setData(candleData);
    volumeSeries.setData(volumeData);

    // Refit the viewport only when the series identity changes (pool/timeframe),
    // not on every 60s poll — a poll should extend the chart, not reset the zoom.
    if (resetKey !== lastResetKey.current) {
      chart.timeScale().fitContent();
      lastResetKey.current = resetKey;
    }

    paintLegend(candles.length ? candles[candles.length - 1] : null);
  }, [candles, priceMode, supply, resetKey, paintLegend]);

  return (
    <div className={`relative ${className}`}>
      <div
        ref={legendRef}
        aria-hidden
        className="pointer-events-none absolute left-2 top-2 z-10 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] leading-tight text-muted"
        style={{ visibility: "hidden" }}
      >
        <LegendCell k="o" label="O" />
        <LegendCell k="h" label="H" />
        <LegendCell k="l" label="L" />
        <LegendCell k="c" label="C" />
        <LegendCell k="v" label="Vol" />
      </div>
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

function LegendCell({ k, label }: { k: string; label: string }) {
  return (
    <span className="tabular-nums">
      <span className="text-violet-soft/70">{label} </span>
      <span {...{ [`data-${k}`]: "" }} className="text-ink/90">
        —
      </span>
    </span>
  );
}
