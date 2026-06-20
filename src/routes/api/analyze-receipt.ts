import { createFileRoute } from "@tanstack/react-router";
import { handleAnalyzeReceiptRequest } from "../../lib/api/analyze-receipt-handler.js";

export const Route = createFileRoute("/api/analyze-receipt")({
  server: {
    handlers: {
      GET: ({ request }) => handleAnalyzeReceiptRequest(request),
      PUT: ({ request }) => handleAnalyzeReceiptRequest(request),
      PATCH: ({ request }) => handleAnalyzeReceiptRequest(request),
      DELETE: ({ request }) => handleAnalyzeReceiptRequest(request),
      OPTIONS: ({ request }) => handleAnalyzeReceiptRequest(request),
      POST: ({ request }) => handleAnalyzeReceiptRequest(request),
    },
  },
});
