import React, { useEffect, useRef, useState } from "react";
import { createChart } from "lightweight-charts";
import { numberText } from "./Common";

function movingAverage(bars, length) {
  const points = [];
  let sum = 0;
  bars.forEach((bar, index) => {
    sum += bar.close;
    if (index >= length) sum -= bars[index - length].close;
    if (index >= length - 1) {
      points.push({ time: bar.date, value: sum / length });
    }
  });
  return points;
}

export default function KlineChart({ bars = [], height = 360 }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleRef = useRef(null);
  const volumeRef = useRef(null);
  const averageRef = useRef(null);
  const [hovered, setHovered] = useState(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { color: getComputedStyle(container).getPropertyValue("--ashares-chart-bg").trim() },
        textColor: getComputedStyle(container).getPropertyValue("--ashares-muted").trim(),
        fontFamily: "inherit",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(128, 142, 145, 0.08)" },
        horzLines: { color: "rgba(128, 142, 145, 0.1)" },
      },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { borderVisible: false, timeVisible: false, rightOffset: 3 },
      crosshair: { vertLine: { labelVisible: true }, horzLine: { labelVisible: true } },
    });
    const candle = chart.addCandlestickSeries({
      upColor: "#d45659",
      downColor: "#249273",
      borderUpColor: "#d45659",
      borderDownColor: "#249273",
      wickUpColor: "#d45659",
      wickDownColor: "#249273",
    });
    const volume = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.79, bottom: 0 } });
    const average = chart.addLineSeries({
      color: "#d2ab57",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    chart.subscribeCrosshairMove((param) => {
      const value = param.seriesData.get(candle);
      setHovered(value && param.time ? { ...value, date: param.time } : null);
    });
    const observer = new ResizeObserver(([entry]) => {
      chart.applyOptions({ width: entry.contentRect.width });
    });
    observer.observe(container);

    chartRef.current = chart;
    candleRef.current = candle;
    volumeRef.current = volume;
    averageRef.current = average;
    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    if (!chartRef.current || !candleRef.current) return;
    candleRef.current.setData(
      bars.map((bar) => ({
        time: bar.date,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      }))
    );
    volumeRef.current.setData(
      bars.map((bar) => ({
        time: bar.date,
        value: bar.volume || 0,
        color: bar.close >= bar.open ? "rgba(212, 86, 89, 0.42)" : "rgba(36, 146, 115, 0.42)",
      }))
    );
    averageRef.current.setData(movingAverage(bars, 20));
    chartRef.current.timeScale().fitContent();
  }, [bars]);

  return (
    <div className="ashares-chart" style={{ height }}>
      <div className="ashares-chart-readout" aria-live="off">
        {hovered ? (
          <>
            <strong>{hovered.date}</strong>
            <span>开 {numberText(hovered.open)}</span>
            <span>高 {numberText(hovered.high)}</span>
            <span>低 {numberText(hovered.low)}</span>
            <span>收 {numberText(hovered.close)}</span>
          </>
        ) : (
          <span>OHLC · MA20 · 成交量</span>
        )}
      </div>
      <div ref={containerRef} className="ashares-chart-canvas" />
    </div>
  );
}
