import { Observable, Subscription } from 'rxjs';
import { distinctUntilChanged } from 'rxjs/operators';
import { Expression, forwardTracker, runner, Tracker, Trackers } from './core';


/**
 * Function to track Observable inside rxjs-autorun expressions
 *
 * Also provides `.weak`, `.normal` (default), and `.strong` types of tracking
 */
export const $ = forwardTracker('$');

/**
 * Function to read latest Observable value inside rxjs-autorun expressions
 *
 * Also provides `.weak`, `.normal` (default), and `.strong` types of tracking
 */
export const _ = forwardTracker('_');

/**
 * Automatically run `fn` when tracked inner Observables emit
 *
 * ```js
 * autorun(() => _(a) + $(b))
 * ```
 *
 * @param fn Function that uses tracked (`$`) or untracked (`_`) Observables
 * @returns RxJS Subscription of distinct execution results
 */
export function autorun<T>(fn: Expression<T>): Subscription {
    return combined<T>(fn).subscribe();
}

/**
 * Automatically run `fn` when tracked inner Observables emit
 *
 * ```js
 * combined(() => _(a) + $(b))
 * ```
 *
 * @param fn Function that uses tracked (`$`) or untracked (`_`) Observables
 * @returns Observable of execution results
 */
export function combined<T>(fn: Expression<T>): Observable<T> {
    return runner(fn);
}

/**
 * Automatically run `fn` when tracked inner Observables emit a **distinct value**
 *
 * ```js
 * computed(() => _(a) + $(b))
 * ```
 *
 * @param fn Function that uses tracked (`$`) or untracked (`_`) Observables
 * @returns Observable of distinct execution results
 */
export function computed<T>(fn: Expression<T>): Observable<T> {
    return runner(fn, true).pipe(distinctUntilChanged());
}

// export TS types
export { Expression, Trackers, Tracker };
