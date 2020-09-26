import { EMPTY, Observable, of, Subject, Subscription } from 'rxjs';
import { startWith, switchMap } from 'rxjs/operators';

interface TrackEntry<V> {
    hasValue: boolean;
    value: V;
    subscription: Subscription;
}

const ERROR_STUB = Object.create(null);

type $Fn = <T>(o: Observable<T>) => T;
type Cb<T> = (...args: any[]) => T;

export function autorun<T>(fn: Cb<T>) {
    return run<T>(fn).subscribe();
}

const context = {
    _: void 0,
    $: void 0,
};

export function run<T>(fn: Cb<T>): Observable<T> {
    const deps = new Map<Observable<unknown>, TrackEntry<unknown>>();
    const update$ = new Subject<void>();
    const $ = createTracker(true);
    const _ = createTracker(false);

    return new Observable((observer) => {
        const sub = update$
            .pipe(
                startWith(void 0), // run fn() instantly
                switchMap(() => {
                    const prev$ = context.$;
                    const prev_ = context._;
                    context.$ = $;
                    context._ = _;
                    try {
                        return of(fn());
                    } catch (e) {
                        // rethrow original errors
                        if (e != ERROR_STUB) {
                            throw e;
                        }

                        return EMPTY;
                    } finally {
                        context.$ = prev$;
                        context._ = prev_;
                    }
                }),
            )
            .subscribe(observer);

        // destroy all subscriptions
        sub.add(() => {
            deps.forEach((entry) => {
                entry.subscription.unsubscribe();
            });
            update$.complete();
            deps.clear();
        });

        return sub;
    });

    function createTracker(track: boolean) {
        return function $<O>(o: Observable<O>): O {
            if (deps.has(o)) {
                const v = deps.get(o);
                if (v.hasValue) {
                    return v.value as O;
                } else {
                    throw ERROR_STUB;
                }
            }

            const v: TrackEntry<O> = {
                hasValue: false,
                value: void 0,
                subscription: void 0,
            };

            let isAsync = false;
            v.subscription = o.subscribe((value) => {
                if (isAsync) {
                    // a-la distinct until changed
                    if (v.hasValue && Object.is(v.value, value)) {
                        return;
                    }

                    v.hasValue = true;
                    v.value = value;
                    if (track) {
                        update$.next(void 0);
                    } else {
                        // NOTE: what to do if the value is absent?
                        // should we:
                        // - interrupt computation & w scheduling re-run when first value available
                        // - interrupt computation & w/o scheduling re-run
                        // - continue computation w/ undefined as value of _(o)
                    }
                } else {
                    v.hasValue = true;
                    v.value = value;
                }
            });
            isAsync = true;

            deps.set(o, v);

            if (v.hasValue) {
                return v.value;
            } else {
                throw ERROR_STUB;
            }
        };
    }
}

export const $: $Fn = (o) => context.$(o);
export const _: $Fn = (o) => context._(o);
