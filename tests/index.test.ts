import { BehaviorSubject, of, Subject } from 'rxjs';
import { $, run, _ } from '../src';

describe('autorun', () => {
    let observer: {
        next: jest.Mock;
        error: jest.Mock;
        complete: jest.Mock;
    };

    beforeEach(() => {
        observer = {
            next: jest.fn(),
            error: jest.fn(),
            complete: jest.fn(),
        };
    });

    test('Simple instant/cold track', () => {
        const o = of(1);
        const r = run(() => $(o));
        r.subscribe(observer);
        expect(observer.next.mock.calls).toEqual([[1]]);
    });

    test('Simple hot track', () => {
        const o = new Subject();
        const r = run(() => $(o));
        r.subscribe(observer);
        o.next('test');
        expect(observer.next.mock.calls).toEqual([['test']]);
    });

    test('Simple instant/cold untrack', () => {
        const o = of(1);
        const r = run(() => _(o));
        r.subscribe(observer);
        expect(observer.next.mock.calls.length).toEqual(1);
    });

    test('Simple untrack', () => {
        const o = new Subject();
        const r = run(() => _(o));
        r.subscribe(observer);
        o.next('test');
        expect(observer.next.mock.calls.length).toEqual(0);
    });

    test('Dependant runners', () => {
        const o = of(1);
        const r1 = run(() => $(o));
        const r2 = run(() => $(r1));
        r2.subscribe(observer);
        expect(observer.next.mock.calls).toEqual([[1]]);
    });

    test('Silent with trackable', () => {
        const a = new BehaviorSubject('#');
        const b = new BehaviorSubject(1);
        const c = run(() => _(a) + $(b));
        c.subscribe(observer); // instant update
        expect(observer.next.mock.calls.length).toBe(1);
        expect(observer.next.mock.calls[0]).toEqual(['#1']);
        a.next('💡'); // no update
        expect(observer.next.mock.calls.length).toBe(1);
        b.next(42); // > 💡42
        expect(observer.next.mock.calls.length).toBe(2);
        expect(observer.next.mock.calls[1]).toEqual(['💡42']);
    });

    // TODO: implement this
    // it('should complete with tracked observables', () => {
    //     const o = of(1);
    //     const r = run(() => $(o));
    //     r.subscribe(observer);
    //     expect(observer.complete.mock.calls.length).toBe(1);
    // });
});
