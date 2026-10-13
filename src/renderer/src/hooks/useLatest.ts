import { useLayoutEffect, useRef } from 'react';

/** Ref that always holds the latest value, so long-lived listeners never see stale state. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => { ref.current = value; });
  return ref;
}
