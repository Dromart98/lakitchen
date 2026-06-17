import type { IncomingMessage, ServerResponse } from "node:http";
import { runNodeApi } from "./_utils.js";
import { handleAnalyzeMealRequest } from "../src/lib/api/analyze-meal-handler.js";

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return runNodeApi(req, res, handleAnalyzeMealRequest);
}
