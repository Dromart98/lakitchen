import type { IncomingMessage, ServerResponse } from "node:http";
import { runNodeApi } from "./_utils.js";
import { handleEstimateMealRequest } from "../src/lib/api/estimate-meal-handler.js";

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return runNodeApi(req, res, handleEstimateMealRequest);
}
