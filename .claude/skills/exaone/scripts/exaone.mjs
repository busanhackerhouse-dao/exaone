#!/usr/bin/env node
// EXAONE API CLI for the Claude Code `exaone` skill. No dependencies (Node 18+).
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";

const BASE_URL = "https://api.exaone.ai";
const MODEL = "k-exaone_v2.5";
const MAX_RETRIES = 5;

class CliError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

const log = (msg) => process.stderr.write(`[exaone] ${msg}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function apiKey() {
  const key = process.env.EXAONE_API_KEY?.trim();
  if (!key) throw new CliError("EXAONE_API_KEY 환경변수가 설정되어 있지 않습니다.", 2);
  return key;
}

function readText(path) {
  try {
    return readFileSync(path, "utf8").replace(/^﻿/, "");
  } catch (err) {
    throw new CliError(`파일을 읽을 수 없습니다: ${path} (${err.code ?? err.message})`, 2);
  }
}

function readBinary(path) {
  try {
    return readFileSync(path);
  } catch (err) {
    throw new CliError(`파일을 읽을 수 없습니다: ${path} (${err.code ?? err.message})`, 2);
  }
}

function toNumber(value, name) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new CliError(`--${name} 값은 숫자여야 합니다: ${value}`, 2);
  return n;
}

function emit(text, out) {
  if (out) {
    writeFileSync(out, text, "utf8");
    log(`저장됨: ${out}`);
  } else {
    process.stdout.write(`${text}\n`);
  }
}

function retryDelay(res, attempt) {
  const ms = Number(res.headers.get("retry-after-ms"));
  if (ms > 0) return ms;
  const sec = Number(res.headers.get("retry-after"));
  if (sec > 0) return sec * 1000;
  return 1200 * attempt + Math.random() * 300;
}

function describeHttpError(status, body) {
  let detail = body.slice(0, 1000);
  try {
    const j = JSON.parse(body);
    detail = j.error?.message ?? j.description ?? j.detail ?? detail;
  } catch {
    // Not JSON: keep the raw excerpt.
  }
  const hint =
    status === 401 || status === 403
      ? " (키가 잘못되었거나 만료되었을 수 있습니다. 키 유효기간은 발급 후 30일입니다.)"
      : "";
  return `API 오류 HTTP ${status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}${hint}`;
}

async function request(path, init, timeoutSec) {
  const headers = { Authorization: `Bearer ${apiKey()}`, ...init.headers };
  const deadline = AbortSignal.timeout(timeoutSec * 1000);
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(BASE_URL + path, { ...init, headers, signal: deadline });
    } catch (err) {
      throw networkError(err, timeoutSec);
    }
    if ((res.status === 429 || res.status === 503) && attempt <= MAX_RETRIES) {
      await res.body?.cancel();
      const wait = retryDelay(res, attempt);
      log(`HTTP ${res.status}, ${Math.ceil(wait)}ms 후 재시도 (${attempt}/${MAX_RETRIES})`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new CliError(describeHttpError(res.status, await res.text()));
    return res;
  }
}

function networkError(err, timeoutSec) {
  if (err.name === "TimeoutError") return new CliError(`${timeoutSec}초 안에 끝나지 않아 중단했습니다.`, 4);
  return new CliError(`네트워크 오류: ${err.cause?.code ?? err.cause?.message ?? err.message}`, 4);
}

// Chat always streams internally so long reasoning runs don't hit fetch's 300s headers timeout.
async function readChatStream(res, timeoutSec) {
  const result = { content: "", reasoning: "", finish: null, usage: null };
  const handleLine = (raw) => {
    const line = raw.trim();
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    const chunk = JSON.parse(data);
    if (chunk.error) throw new CliError(`API 오류: ${chunk.error.message ?? JSON.stringify(chunk.error)}`);
    if (chunk.usage) result.usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (!choice) return;
    result.content += choice.delta?.content ?? "";
    result.reasoning += choice.delta?.reasoning_content ?? "";
    result.finish = choice.finish_reason ?? result.finish;
  };

  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for await (const bytes of res.body) {
      buffer += decoder.decode(bytes, { stream: true });
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        handleLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    }
  } catch (err) {
    if (err instanceof CliError) throw err;
    throw networkError(err, timeoutSec);
  }
  handleLine(buffer);
  return result;
}

async function chat(argv) {
  const { values: o } = parseArgs({
    args: argv,
    options: {
      prompt: { type: "string" },
      "prompt-file": { type: "string" },
      system: { type: "string" },
      "system-file": { type: "string" },
      effort: { type: "string", default: "high" },
      "max-tokens": { type: "string" },
      temperature: { type: "string" },
      "top-p": { type: "string" },
      "json-schema": { type: "string" },
      "show-reasoning": { type: "boolean", default: false },
      out: { type: "string" },
      timeout: { type: "string", default: "570" },
    },
  });

  const prompt = o["prompt-file"] ? readText(o["prompt-file"]) : o.prompt;
  if (!prompt?.trim()) throw new CliError("--prompt 또는 --prompt-file 이 필요합니다.", 2);
  const system = o["system-file"] ? readText(o["system-file"]) : o.system;
  const timeoutSec = toNumber(o.timeout, "timeout");

  const body = {
    model: MODEL,
    messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }],
    stream: true,
    stream_options: { include_usage: true },
    reasoning_effort: o.effort,
    // Schema mode occasionally runs away until the cap, so it gets a lower default.
    max_tokens: toNumber(o["max-tokens"] ?? (o["json-schema"] ? "4096" : "16384"), "max-tokens"),
  };
  const temperature = toNumber(o.temperature, "temperature");
  const topP = toNumber(o["top-p"], "top-p");
  if (temperature !== undefined) body.temperature = temperature;
  if (topP !== undefined) body.top_p = topP;
  if (o["json-schema"]) {
    let schema;
    try {
      schema = JSON.parse(readText(o["json-schema"]));
    } catch (err) {
      if (err instanceof CliError) throw err;
      throw new CliError(`JSON Schema 파일이 올바른 JSON이 아닙니다: ${err.message}`, 2);
    }
    body.response_format = { type: "json_schema", json_schema: { name: "response", strict: true, schema } };
  }

  const res = await request(
    "/v1/chat/completions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    },
    timeoutSec,
  );
  const r = await readChatStream(res, timeoutSec);
  const content = r.content.trim();

  if (o["show-reasoning"] && r.reasoning.trim()) {
    process.stderr.write(`--- reasoning ---\n${r.reasoning.trim()}\n--- end reasoning ---\n`);
  }
  if (r.usage) {
    log(
      `tokens: prompt=${r.usage.prompt_tokens} completion=${r.usage.completion_tokens} ` +
        `reasoning=${r.usage.reasoning_tokens ?? "?"} finish=${r.finish}`,
    );
  }
  if (!content) throw new CliError("모델이 빈 응답을 반환했습니다.", 3);
  if (o["json-schema"]) {
    try {
      JSON.parse(content);
    } catch {
      throw new CliError(`모델 응답이 유효한 JSON이 아닙니다 (finish=${r.finish}): ${content.slice(0, 300)}`, 3);
    }
  }
  emit(content, o.out);
  if (r.finish === "length") {
    log("경고: max_tokens에 도달해 응답이 잘렸습니다. 위 출력은 일부입니다.");
    process.exitCode = 3;
  }
}

async function tabular(task, argv) {
  const defaults = { classification: "class", regression: "point" };
  const allowed = { classification: ["class", "probability"], regression: ["point", "full"] };
  const { values: o } = parseArgs({
    args: argv,
    options: {
      train: { type: "string" },
      test: { type: "string" },
      target: { type: "string" },
      output: { type: "string", default: defaults[task] },
      out: { type: "string" },
      timeout: { type: "string", default: "280" },
    },
  });
  if (!o.train || !o.test || !o.target) throw new CliError("--train, --test, --target 이 모두 필요합니다.", 2);
  if (!allowed[task].includes(o.output)) {
    throw new CliError(`--output 값은 ${allowed[task].join(" 또는 ")} 이어야 합니다.`, 2);
  }

  const form = new FormData();
  form.append("train_file", new Blob([readBinary(o.train)], { type: "text/csv" }), basename(o.train));
  form.append("test_file", new Blob([readBinary(o.test)], { type: "text/csv" }), basename(o.test));
  form.append("mode", "default");
  form.append("output_type", o.output);
  form.append("target_columns", o.target);

  const res = await request(`/v1/tabular/${task}`, { method: "POST", body: form }, toNumber(o.timeout, "timeout"));
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new CliError(`JSON이 아닌 응답을 받았습니다: ${text.slice(0, 500)}`);
  }
  if (json.description) throw new CliError(`API 오류 ${json.result_code}: ${json.description}`);
  emit(JSON.stringify(json.data ?? json, null, 2), o.out);
}

const USAGE = `사용법:
  exaone.mjs chat (--prompt TEXT | --prompt-file PATH) [--system TEXT | --system-file PATH]
             [--effort low|high|max] [--max-tokens N] [--temperature N] [--top-p N]
             [--json-schema PATH] [--show-reasoning] [--out PATH] [--timeout SEC]
  exaone.mjs classify --train CSV --test CSV --target COLUMN [--output class|probability] [--out PATH]
  exaone.mjs regress  --train CSV --test CSV --target COLUMN [--output point|full] [--out PATH]`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "chat") return chat(rest);
  if (command === "classify") return tabular("classification", rest);
  if (command === "regress") return tabular("regression", rest);
  throw new CliError(USAGE, 2);
}

main().catch((err) => {
  log(err instanceof CliError ? err.message : `실행 오류: ${err.message}`);
  process.exitCode = err instanceof CliError ? err.code : 2;
});
