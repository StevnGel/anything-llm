import { useEffect, useState } from "react";
import AShares from "@/models/ashares";

export default function useBars(symbol, options) {
  const { period = "1d", start = "", end = "" } = options;
  const [state, setState] = useState({
    data: null,
    error: null,
    loading: false,
  });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!symbol) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    const controller = new AbortController();
    setState({ data: null, loading: true, error: null });
    AShares.bars(
      symbol,
      { period, ...(start ? { start } : {}), ...(end ? { end } : {}) },
      controller.signal
    )
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error) => {
        if (error.name !== "AbortError") {
          setState({ data: null, error: error.message, loading: false });
        }
      });
    return () => controller.abort();
  }, [symbol, period, start, end, revision]);

  return { ...state, refresh: () => setRevision((value) => value + 1) };
}
