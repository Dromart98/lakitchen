import type { IncomingMessage, ServerResponse } from "node:http";
import { runNodeApi } from "./_utils";
import { handleAnalyzeMealRequest } from "../src/lib/api/analyze-meal-handler";

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return runNodeApi(req, res, handleAnalyzeMealRequest);
}
