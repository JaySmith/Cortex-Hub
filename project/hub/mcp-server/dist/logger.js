import pino from "pino";
const level = process.env.HUB_LOG_LEVEL || "info";
export const logger = pino({
    level,
    transport: process.env.NODE_ENV !== "production"
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
