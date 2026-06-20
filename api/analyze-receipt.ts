import type { IncomingMessage, ServerResponse } from "node:http";
import { runNodeApi } from "./_utils.js";
import { handleAnalyzeReceiptRequest } from "../src/lib/api/analyze-receipt-handler.js";

export const config = { maxDuration: 60 };

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return runNodeApi(req, res, handleAnalyzeReceiptRequest);
}
