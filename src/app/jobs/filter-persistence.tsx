"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { JobHistoryFilter } from "@/lib/job-history";

const STORAGE_KEY = "jobs-filter";

export function FilterPersistence({ currentFilter }: { currentFilter: JobHistoryFilter }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const filterParam = searchParams.get("filter");

    if (filterParam) {
      sessionStorage.setItem(STORAGE_KEY, filterParam);
    } else if (currentFilter !== "active") {
      sessionStorage.setItem(STORAGE_KEY, currentFilter);
    } else {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored && stored !== "active") {
        const params = new URLSearchParams(searchParams);
        params.set("filter", stored);
        router.replace(`/jobs?${params.toString()}`);
      }
    }
  }, [currentFilter, searchParams, router]);

  return null;
}
