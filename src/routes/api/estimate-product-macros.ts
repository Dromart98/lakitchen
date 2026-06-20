import { createFileRoute } from "@tanstack/react-router";
import { handleEstimateProductMacrosRequest } from "@/lib/api/estimate-product-macros-handler";

export const Route = createFileRoute("/api/estimate-product-macros")({
  server: {
    handlers: {
      GET: ({ request }) => handleEstimateProductMacrosRequest(request),
      PUT: ({ request }) => handleEstimateProductMacrosRequest(request),
      PATCH: ({ request }) => handleEstimateProductMacrosRequest(request),
      DELETE: ({ request }) => handleEstimateProductMacrosRequest(request),
      OPTIONS: ({ request }) => handleEstimateProductMacrosRequest(request),
      POST: ({ request }) => handleEstimateProductMacrosRequest(request),
    },
  },
});
