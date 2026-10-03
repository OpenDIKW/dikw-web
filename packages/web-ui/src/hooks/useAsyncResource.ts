import { useCallback, useEffect, useState } from "react";

export interface AsyncResource<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

export function useAsyncResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): AsyncResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [reloadId, setReloadId] = useState(0);

  const reload = useCallback(() => {
    setReloadId((value) => value + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    load(controller.signal)
      .then((nextData) => {
        if (!controller.signal.aborted) {
          setData(nextData);
        }
      })
      .catch((nextError: unknown) => {
        if (!controller.signal.aborted) {
          setError(nextError);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps is a caller-provided spread; the hook intentionally re-runs when any of them change
  }, [load, reloadId, ...deps]);

  return { data, error, loading, reload };
}
