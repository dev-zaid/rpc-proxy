"use strict";

const { jsonRpcError } = require("../utils/formatters");

function getUpstreamUrl() {
  return process.env.EVMOS_RPC_URL || "http://18.60.158.87:8545";
}

async function proxyJson(payload, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(getUpstreamUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const text = await response.text();

    try {
      return JSON.parse(text);
    } catch (err) {
      return jsonRpcError(payload.id, -32002, "Upstream returned invalid JSON", {
        status: response.status
      });
    }
  } catch (err) {
    return jsonRpcError(payload.id, -32003, "Upstream request failed");
  } finally {
    clearTimeout(timeoutId);
  }
}

async function proxyStream(payload, timeoutMs, res) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(getUpstreamUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    res.status(response.status);
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === "content-length") return;
      res.setHeader(key, value);
    });

    if (!response.body) {
      res.end();
      return;
    }

    const { Readable } = require("stream");
    Readable.fromWeb(response.body).pipe(res);
  } catch (err) {
    const errorPayload = jsonRpcError(payload.id, -32003, "Upstream request failed");
    res.status(502).json(errorPayload);
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = {
  proxyJson,
  proxyStream
};
