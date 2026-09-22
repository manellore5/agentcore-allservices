/**
 * The smallest stand-in for the Python `logging` module, shared by the toolkit helpers.
 *
 * The course tunes verbosity with `gateway_client.logger.setLevel(logging.WARNING)`, so this keeps
 * that line translating one-to-one as `gatewayClient.logger.setLevel("WARNING")`.
 */
export type LogLevel = "DEBUG" | "INFO" | "WARNING" | "ERROR";

const LEVELS: Record<LogLevel, number> = { DEBUG: 10, INFO: 20, WARNING: 30, ERROR: 40 };

export class Logger {
  private level: LogLevel = "INFO";

  constructor(private readonly prefix: string) {}

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private log(level: LogLevel, ...args: unknown[]): void {
    if (LEVELS[level] < LEVELS[this.level]) return;
    console.error(`${this.prefix} - ${level} -`, ...args);
  }

  debug(...args: unknown[]): void {
    this.log("DEBUG", ...args);
  }
  info(...args: unknown[]): void {
    this.log("INFO", ...args);
  }
  warning(...args: unknown[]): void {
    this.log("WARNING", ...args);
  }
  error(...args: unknown[]): void {
    this.log("ERROR", ...args);
  }
}
