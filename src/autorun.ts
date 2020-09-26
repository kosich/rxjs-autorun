// Created by Kostia Palchyk © MIT License
import { EMPTY, Observable, of, Subject, Subscription } from 'rxjs';
import { startWith, switchMap } from 'rxjs/operators';

interface TrackEntry<V> {
    hasValue: boolean;
    value: V;
    subscription: Subscription;
}

const ERROR_STUB = Object.create(null);

type $Fn = <T>(o: Observable<T>) => T;
type Cb<T> = () => T;

export function autorun<T>(fn: Cb<T>) {
    return run<T>(fn).subscribe();
}

export function run<T>(fn: Cb<T>): Observable<T> {
    const deps = new Map<Observable<unknown>, TrackEntry<unknown>>();
    const update$ = new Subject<void>();

    return new Observable((observer) => {
        const sub = update$
            .pipe(
                startWith(void 0), // run fn() instantly
                switchMap(() => {
                    const _$ = run['$'];
                    run['$'] = $;
                    try {
                        return of(fn());
                    } catch (e) {
                        // rethrow original errors
                        if (e != ERROR_STUB) {
                            throw e;
                        }

                        return EMPTY;
                    } finally {
                        run['$'] = _$;
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

    function $<O>(o: Observable<O>): O {
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
                update$.next(void 0);
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
    }
}

export const $:$Fn = o => run['$'](o);
