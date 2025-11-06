export class AgentCoordinatorError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message);
    this.name = "AgentCoordinatorError";
    if (options.cause !== undefined) {
      // @ts-expect-error cause is supported in modern runtimes
      this.cause = options.cause;
    }
  }
}

export class PersonaNotFoundError extends AgentCoordinatorError {
  readonly personaId: string;

  constructor(personaId: string) {
    super(`Persona template '${personaId}' was not found.`);
    this.name = "PersonaNotFoundError";
    this.personaId = personaId;
  }
}

export class TransportUnavailableError extends AgentCoordinatorError {
  readonly transportId: string;

  constructor(transportId: string) {
    super(`No transport registered for '${transportId}'.`);
    this.name = "TransportUnavailableError";
    this.transportId = transportId;
  }
}

export class ValidationFailureError extends AgentCoordinatorError {
  readonly raw: string;
  readonly latencyMs: number;

  constructor(message: string, raw: string, latencyMs: number, cause?: unknown) {
    super(message, { cause });
    this.name = "ValidationFailureError";
    this.raw = raw;
    this.latencyMs = latencyMs;
  }
}
