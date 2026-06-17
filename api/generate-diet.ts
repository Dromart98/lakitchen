import type { IncomingMessage, ServerResponse } from "node:http";
import { runNodeApi } from "./_utils.js";
import { handleGenerateDietRequest } from "../src/lib/api/generate-diet-handler.js";

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return runNodeApi(req, res, handleGenerateDietRequest);
}
