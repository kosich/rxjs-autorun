import { BehaviorSubject, of, Subject, Subscription } from 'rxjs';
import { $, run, _ } from '../src';

describe('autorun', () => {
    let observer: {
        next: jest.Mock;
        error: jest.Mock;
        complete: jest.Mock;
    };
    let sub: Subscription;

    beforeEach(() => {
        observer = {
            next: jest.fn(),
            error: jest.fn(),
            complete: jest.fn(),
        };
    });

    afterEach(() => {
        if (sub) {
            sub.unsubscribe();
        }
    });

    test('Simple instant/cold track', () => {
        const o = of(1);
        const r = run(() => $(o));
        sub = r.subscribe(observer);
        expect(observer.next.mock.calls).toEqual([[1]]);
    });

    test('Simple hot track', () => {
        const o = new Subject();
        const r = run(() => $(o));
        sub = r.subscribe(observer);
        o.next('test');
        expect(observer.next.mock.calls).toEqual([['test']]);
    });

    test('Simple instant/cold untrack', () => {
        const o = of(1);
        const r = run(() => _(o));
        sub = r.subscribe(observer);
        expect(observer.next.mock.calls.length).toEqual(1);
    });

    test('Simple untrack', () => {
        const o = new Subject();
        const r = run(() => _(o));
        sub = r.subscribe(observer);
        o.next('test');
        expect(observer.next.mock.calls.length).toEqual(0);
    });

    test('Dependant runners', () => {
        const o = of(1);
        const r1 = run(() => $(o));
        const r2 = run(() => $(r1));
        sub = r2.subscribe(observer);
        expect(observer.next.mock.calls).toEqual([[1]]);
    });

    test('Silent with trackable', () => {
        const a = new BehaviorSubject('#');
        const b = new BehaviorSubject(1);
        const c = run(() => _(a) + $(b));
        sub = c.subscribe(observer); // instant update
        expect(observer.next.mock.calls.length).toBe(1);
        expect(observer.next.mock.calls[0]).toEqual(['#1']);
        a.next('💡'); // no update
        expect(observer.next.mock.calls.length).toBe(1);
        b.next(42); // > 💡42
        expect(observer.next.mock.calls.length).toBe(2);
        expect(observer.next.mock.calls[1]).toEqual(['💡42']);
    });

    it('should only react to distinctive value changes', () => {
        const o = new Subject<number>();
        const fn = jest.fn(() => 0);
        const r = run(() => $(o) + fn());
        sub = r.subscribe(observer);
        o.next(0);
        o.next(0);
        expect(fn.mock.calls.length).toBe(1);
    });

    it('should only emit distinctive results', () => {
        const o = new Subject<number>();
        const r = run(() => $(o) - $(o));
        sub = r.subscribe(observer);
        o.next(0);
        o.next(1);
        o.next(2);
        expect(observer.next.mock.calls.length).toBe(1);
    });

    // TODO: implement this
    // it('should complete with tracked observables', () => {
    //     const o = of(1);
    //     const r = run(() => $(o));
    //     r.subscribe(observer);
    //     expect(observer.complete.mock.calls.length).toBe(1);
    // });
});
