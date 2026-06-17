import { createFileRoute } from "@tanstack/react-router";
import { handleEstimateMealRequest } from "@/lib/api/estimate-meal-handler";

export const Route = createFileRoute("/api/estimate-meal")({
  server: {
    handlers: {
      GET: ({ request }) => handleEstimateMealRequest(request),
      PUT: ({ request }) => handleEstimateMealRequest(request),
      PATCH: ({ request }) => handleEstimateMealRequest(request),
      DELETE: ({ request }) => handleEstimateMealRequest(request),
      OPTIONS: ({ request }) => handleEstimateMealRequest(request),
      POST: ({ request }) => handleEstimateMealRequest(request),
    },
  },
});
