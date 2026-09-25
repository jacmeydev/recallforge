// ============================================================================
// RecallForge — Domain errors
// ============================================================================
// Thrown by core services; REST and MCP adapters translate them into
// HTTP statuses or tool errors.
// ============================================================================

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function notFound(what: string, ref: string): AppError {
  return new AppError(404, 'not_found', `${what} not found: ${ref}`);
}

export function badRequest(message: string, details?: unknown): AppError {
  return new AppError(400, 'bad_request', message, details);
}

export function conflict(message: string, details?: unknown): AppError {
  return new AppError(409, 'conflict', message, details);
}
