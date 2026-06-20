import type { IncomingMessage, ServerResponse } from "node:http";
import { runNodeApi } from "./_utils.js";
import { handleEstimateProductMacrosRequest } from "../src/lib/api/estimate-product-macros-handler.js";

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return runNodeApi(req, res, handleEstimateProductMacrosRequest);
}
