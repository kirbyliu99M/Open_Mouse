import { en } from "@/lib/copy/errors";

/**
 * The English wording of the not-found and error screens, as constants (the
 * tests pin it). The words in both languages are in `@/lib/copy/errors`; use
 * `errorsCopy(locale)` there for what a visitor sees.
 */
export const ACTIONS = en.actions;
export const NOT_FOUND_COPY = en.notFound;
export const ERROR_COPY = en.error;
export const GLOBAL_ERROR_COPY = en.globalError;
export const REFERENCE_LABEL = en.referenceLabel;
/** Announced (role=status) while the Try again request is running. */
export const RETRYING = en.retrying;
