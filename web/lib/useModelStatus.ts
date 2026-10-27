"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type CurrentModelStatusResponse } from "@/lib/api";

export type ModelStatusState = {
  /** Latest successful GET /model-status body, or null before the first one. */
  data: CurrentModelStatusResponse | null;
  /** True once a request has returned (successfully or not). */
  checked: boolean;
  offline: boolean;
  error: string | null;
  /** A trained global model is loaded and can serve /predict. */
  ready: boolean;
  /** A training job is queued or running on the backend right now. */
  training: boolean;
  starting: boolean;
  initialize: (force?: boolean) => Promise<void>;
  refresh: () => Promise<void>;
};

/**
 * Single source of model state for every page. Everything shown comes from
 * GET /model-status; nothing is inferred client-side. Polls every 1s while a
 * job is in flight so round progress is live, otherwise every `idleMs`.
 */
export function useModelStatus(idleMs = 8000): ModelStatusState {
  const [data, setData] = useState<CurrentModelStatusResponse | null>(null);
  const [checked, setChecked] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const fetchStatus = useCallback(async () => {
    const res = await api.currentModelStatus();
    setChecked(true);
    if (res.ok) {
      setData(res.data);
      setOffline(false);
      setError(null);
    } else {
      setOffline(res.kind === "offline");
      setError(res.message);
    }
  }, []);

  const training = Boolean(data?.active_job);
  const interval = training || starting ? 1000 : idleMs;

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (alive) await fetchStatus();
    };
    tick();
    const id = setInterval(tick, interval);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [fetchStatus, interval]);

  const initialize = useCallback(
    async (force = false) => {
      setStarting(true);
      setError(null);
      const res = await api.demoWarmup(force);
      if (!res.ok) setError(res.message);
      await fetchStatus();
      setStarting(false);
    },
    [fetchStatus]
  );

  return {
    data,
    checked,
    offline,
    error,
    ready: Boolean(data && data.status === "complete" && data.job_id),
    training,
    starting,
    initialize,
    refresh: fetchStatus,
  };
}
