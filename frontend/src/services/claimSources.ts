import { useEffect, useState } from "react";
import { api } from "./api";

// Original text behind each extracted fact, from its first evidence. Cached per page load.
const cache = new Map<string, Promise<string | null>>();

export function claimSource(id: string): Promise<string | null> {
  let p = cache.get(id);
  if (!p) {
    p = api.getClaimDetail(id).then(
      (d) => {
        const v = d.current_version ?? d.versions[0];
        return v?.evidences.find((e) => e.quote)?.quote ?? null;
      },
      () => null,
    );
    cache.set(id, p);
  }
  return p;
}

/** Extracted statements can read awkwardly; screens prefer the words the person actually wrote. */
export function useClaimSources(ids: string[]): Map<string, string> {
  const [sources, setSources] = useState<Map<string, string>>(new Map());
  const key = [...new Set(ids)].sort().join(",");
  useEffect(() => {
    let active = true;
    const list = key ? key.split(",") : [];
    Promise.all(list.map(async (id) => [id, await claimSource(id)] as const)).then((pairs) => {
      if (active) setSources(new Map(pairs.filter((p): p is readonly [string, string] => !!p[1])));
    });
    return () => {
      active = false;
    };
  }, [key]);
  return sources;
}
