import { FormGroup, AbstractControl } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Signal, signal } from '@angular/core';
import { startWith } from 'rxjs';

import {
  applyServerErrorsToForm,
  clearServerErrorsOnForm,
  parseServerValidationEnvelope,
  ServerValidationError,
} from '../utils/server-validation.utils';

/**
 * Violation pair carrying both the human-readable message AND the
 * source control name so the validation popover can render a
 * click-to-jump that focuses the offending field. The legacy
 * string[] shape stays on getViolations / collectViolations for
 * backward compat with the 50+ existing consumers; this richer
 * shape is opt-in via getViolationItems / collectViolationItems.
 */
export interface ViolationItem {
  controlName: string;
  message: string;
}

const ERROR_MESSAGES: Record<string, (label: string, error: unknown) => string> = {
  required: (label) => `${label} is required`,
  email: (label) => `${label} must be a valid email`,
  minlength: (label, err) => {
    const e = err as { requiredLength: number };
    return `${label} must be at least ${e.requiredLength} characters`;
  },
  maxlength: (label, err) => {
    const e = err as { requiredLength: number };
    return `${label} must be at most ${e.requiredLength} characters`;
  },
  min: (label, err) => {
    const e = err as { min: number };
    return `${label} must be at least ${e.min}`;
  },
  max: (label, err) => {
    const e = err as { max: number };
    return `${label} must be at most ${e.max}`;
  },
  pattern: (label) => `${label} format is invalid`,
};

export class FormValidationService {
  /**
   * Returns a signal of violation messages for the given form.
   * Safe to call from any context (constructor, effect, computed, etc.)
   * because it uses a plain subscription instead of toSignal().
   */
  static getViolations(
    form: FormGroup,
    labels: Record<string, string>,
  ): Signal<string[]> {
    const violations = signal<string[]>([]);

    form.statusChanges.pipe(startWith(form.status)).subscribe(() => {
      violations.set(FormValidationService.collectViolations(form, labels));
    });

    return violations.asReadonly();
  }

  static collectViolations(form: FormGroup, labels: Record<string, string>): string[] {
    return FormValidationService.collectViolationItems(form, labels).map(v => v.message);
  }

  /**
   * Same scan as collectViolations but returns each violation alongside
   * the control name that produced it. Powers the validation popover's
   * click-to-jump so a click on a violation can scroll/focus the source
   * field instead of leaving the user hunting.
   */
  static collectViolationItems(form: FormGroup, labels: Record<string, string>): ViolationItem[] {
    const items: ViolationItem[] = [];

    for (const [key, control] of Object.entries(form.controls)) {
      const errors = (control as AbstractControl).errors;
      if (!errors) continue;

      const label = labels[key] ?? key;

      for (const [errorKey, errorValue] of Object.entries(errors)) {
        if (errorValue && typeof errorValue === 'object' && 'message' in errorValue) {
          const message = (errorValue as { message: unknown }).message;
          if (typeof message === 'string') {
            items.push({
              controlName: key,
              message: errorKey === 'serverError' ? `${label}: ${message}` : message,
            });
          }
        } else if (ERROR_MESSAGES[errorKey]) {
          items.push({ controlName: key, message: ERROR_MESSAGES[errorKey](label, errorValue) });
        } else {
          items.push({ controlName: key, message: `${label} is invalid` });
        }
      }
    }

    return items;
  }

  /**
   * Item-aware sibling of getViolations(). Returns a Signal of
   * ViolationItem so consumers wiring click-to-jump can subscribe to a
   * structured stream instead of stringly-typed messages.
   */
  static getViolationItems(
    form: FormGroup,
    labels: Record<string, string>,
  ): Signal<ViolationItem[]> {
    const items = signal<ViolationItem[]>([]);

    form.statusChanges.pipe(startWith(form.status)).subscribe(() => {
      items.set(FormValidationService.collectViolationItems(form, labels));
    });

    return items.asReadonly();
  }

  /**
   * Phase 3 / WU-02 retrofit. Apply the server's standardized validation
   * envelope to a reactive form so per-field error messages render against
   * the right inputs. Returns the unmatched errors (for the caller to
   * surface as a generic toast / form-level message). Returns `null` when
   * the response body did not match the envelope shape — the caller should
   * fall back to its legacy error path.
   */
  static applyServerError(
    form: FormGroup,
    error: HttpErrorResponse | unknown,
  ): { matched: ServerValidationError[]; unmatched: ServerValidationError[] } | null {
    const errors = parseServerValidationEnvelope(error);
    if (errors === null) return null;
    // Drop any prior server messages first so re-submits don't accumulate.
    clearServerErrorsOnForm(form);
    const unmatched = applyServerErrorsToForm(form, errors);
    const matched = errors.filter(e => !unmatched.includes(e));
    return { matched, unmatched };
  }

  /** Clear any `serverError` previously written by `applyServerError`. */
  static clearServerErrors(form: FormGroup): void {
    clearServerErrorsOnForm(form);
  }
}
