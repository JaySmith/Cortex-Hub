import http from "node:http";
import net from "node:net";
import { execSync } from "node:child_process";

export async function runChecks(targets) {
  const results = [];
  for (const target of targets) {
    const start = Date.now();
    try {
      let ok = false;
      let detail = "";

      switch (target.type) {
        case "http":
          ({ ok, detail } = await checkHttp(target));
          break;
        case "tcp":
          ({ ok, detail } = await checkTcp(target));
          break;
        case "ping":
          ({ ok, detail } = await checkPing(target));
          break;
        case "process":
          ({ ok, detail } = await checkProcess(target));
          break;
        case "command":
          ({ ok, detail } = await checkCommand(target));
          break;
        default:
          detail = `Unknown check type: ${target.type}`;
      }

      const latency = Date.now() - start;
      results.push({
        target: target.name,
        status: ok ? "up" : "down",
        latency,
        detail,
        tags: target.tags || [],
        severity: target.severity || (ok ? "info" : "critical"),
        checkedAt: new Date().toISOString(),
      });
    } catch (err) {
      const latency = Date.now() - start;
      results.push({
        target: target.name,
        status: "down",
        latency,
        detail: err.message,
        tags: target.tags || [],
        severity: "critical",
        checkedAt: new Date().toISOString(),
      });
    }
  }
  return results;
}

function checkHttp(target) {
  return new Promise((resolve) => {
    const url = new URL(target.endpoint);
    const opts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname + url.search,
      method: target.method || "GET",
      timeout: target.timeoutMs || 5000,
      rejectUnauthorized: false,
    };

    const req = http.request(opts, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        const ok = target.expectedStatus
          ? res.statusCode === target.expectedStatus
          : res.statusCode >= 200 && res.statusCode < 400;
        resolve({ ok, detail: `HTTP ${res.statusCode}${ok ? "" : `: ${body.slice(0, 200)}`}` });
      });
    });
    req.on("error", (err) => resolve({ ok: false, detail: err.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, detail: "Timeout" });
    });
    req.end();
  });
}

function checkTcp(target) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(target.timeoutMs || 3000);
    socket.on("connect", () => {
      socket.destroy();
      resolve({ ok: true, detail: `TCP ${target.host}:${target.port} reachable` });
    });
    socket.on("error", (err) => resolve({ ok: false, detail: err.message }));
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ ok: false, detail: "Connection timeout" });
    });
    socket.connect(target.port, target.host);
  });
}

async function checkPing(target) {
  try {
    const host = target.host;
    const isWin = process.platform === "win32";
    const cmd = isWin ? `ping -n 1 -w ${target.timeoutMs || 3000} ${host}` : `ping -c 1 -W ${Math.ceil((target.timeoutMs || 3000) / 1000)} ${host}`;
    execSync(cmd, { timeout: target.timeoutMs || 5000, stdio: "pipe" });
    return { ok: true, detail: `${host} responded to ping` };
  } catch (err) {
    return { ok: false, detail: `Ping failed: ${err.stderr?.toString().trim() || err.message}` };
  }
}

async function checkProcess(target) {
  try {
    const isWin = process.platform === "win32";
    const cmd = isWin
      ? `tasklist /FI "IMAGENAME eq ${target.process}" 2>NUL`
      : `pgrep -x "${target.process}"`;
    const out = execSync(cmd, { timeout: 5000, encoding: "utf8", stdio: "pipe" });
    const found = isWin ? out.includes(target.process) : out.trim().length > 0;
    return found
      ? { ok: true, detail: `Process ${target.process} is running` }
      : { ok: false, detail: `Process ${target.process} not found` };
  } catch {
    return { ok: false, detail: `Process ${target.process} not found` };
  }
}

async function checkCommand(target) {
  try {
    const out = execSync(target.command, { timeout: target.timeoutMs || 10000, encoding: "utf8", stdio: "pipe" });
    return { ok: true, detail: out.trim().slice(0, 500) };
  } catch (err) {
    return { ok: false, detail: err.stderr?.toString().trim().slice(0, 500) || err.message };
  }
}
