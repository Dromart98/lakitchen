import { createFileRoute } from "@tanstack/react-router";
import { handleAnalyzeMealRequest } from "../../lib/api/analyze-meal-handler.js";

export const Route = createFileRoute("/api/analyze-meal")({
  server: {
    handlers: {
      GET: ({ request }) => handleAnalyzeMealRequest(request),
      PUT: ({ request }) => handleAnalyzeMealRequest(request),
      PATCH: ({ request }) => handleAnalyzeMealRequest(request),
      DELETE: ({ request }) => handleAnalyzeMealRequest(request),
      OPTIONS: ({ request }) => handleAnalyzeMealRequest(request),
      POST: ({ request }) => handleAnalyzeMealRequest(request),
    },
  },
});
