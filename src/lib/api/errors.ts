export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const unauthorized = () => new ApiError(401, "unauthorized", "Sign in to continue.");
export const forbidden = () => new ApiError(403, "forbidden", "That action is not allowed.");
export const notFound = (what = "Resource") => new ApiError(404, "not_found", `${what} not found.`);
