import { ZodError } from "zod";

export function formatValidationError(error) {
  if (!(error instanceof ZodError)) {
    throw new TypeError("Expected a Zod validation error");
  }

  return {
    message: "Please correct the highlighted fields",
    errors: error.issues.map(issue => ({
      field: issue.path.length > 0 ? issue.path.join(".") : "body",
      message:
        issue.code === "unrecognized_keys"
          ? "Remove unexpected fields from the request"
          : issue.message,
    })),
  };
}

export function formatError(error) {
  if (error instanceof ZodError) {
    return formatValidationError(error);
  }

  // Internal error messages and stack traces belong in server logs only.
  return { message: "Something went wrong. Please try again later." };
}
