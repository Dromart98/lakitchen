import { createFileRoute } from "@tanstack/react-router";
import { handleGenerateDietRequest } from "@/lib/api/generate-diet-handler";

export const Route = createFileRoute("/api/generate-diet")({
  server: {
    handlers: {
      GET: ({ request }) => handleGenerateDietRequest(request),
      PUT: ({ request }) => handleGenerateDietRequest(request),
      PATCH: ({ request }) => handleGenerateDietRequest(request),
      DELETE: ({ request }) => handleGenerateDietRequest(request),
      OPTIONS: ({ request }) => handleGenerateDietRequest(request),
      POST: ({ request }) => handleGenerateDietRequest(request),
    },
  },
});
