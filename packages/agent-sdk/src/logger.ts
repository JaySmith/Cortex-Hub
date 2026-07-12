import pino from "pino";

export function createLogger(agentName: string): pino.Logger {
  const level = process.env.CORTEX_LOG_LEVEL || "info";
  return pino({
    level,
    name: agentName,
    transport:
      process.env.NODE_ENV !== "production"
        ? {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "SYS:standard" },
          }
        : undefined,
    serializers: {
      err: pino.stdSerializers.err,
    },
    redact: {
      paths: ["req.headers.authorization", "req.headers.cookie"],
      censor: "[REDACTED]",
    },
  });
}
